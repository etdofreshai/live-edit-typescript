import crypto from 'crypto';
import { Router, raw } from 'express';
import { addEntry, allocatePort, getLatestEntries, makeId, releasePort, removeEntry, updateEntry } from './cache-manager.js';
import { pullLatest } from './runner.js';
import { cloneAndStart, stopServer } from './runner.js';
import { getBranchHead, OWNER } from './github.js';

const isProduction = process.env.NODE_ENV === 'production';
const configuredWebhookSecret = process.env.WEBHOOK_SECRET;
const WEBHOOK_SECRET = configuredWebhookSecret || (isProduction ? undefined : 'dev-only-insecure');
const TOKEN = process.env.GITHUB_TOKEN;

if (!configuredWebhookSecret) {
  if (isProduction) {
    console.warn('[webhook] WEBHOOK_SECRET is not configured; webhook requests will return 503');
  } else {
    console.warn('[webhook] WEBHOOK_SECRET is not configured; using dev-only-insecure placeholder for local development');
  }
}

function verifySignature(payload: Buffer, signature: string | undefined): boolean {
  if (!WEBHOOK_SECRET || !signature?.startsWith('sha256=')) return false;

  const actualSig = signature.slice('sha256='.length);
  const expectedSig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');
  if (actualSig.length !== expectedSig.length) return false;

  const actual = Buffer.from(actualSig, 'hex');
  const expected = Buffer.from(expectedSig, 'hex');
  if (actual.length !== expected.length) return false;

  return crypto.timingSafeEqual(actual, expected);
}

function isProcessAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function requiresRestart(changedFiles: string[]): boolean {
  const restartFiles = new Set(['package.json', 'package-lock.json', 'vite.config.ts', 'vite.config.js']);
  return changedFiles.some(file => restartFiles.has(file));
}

async function refreshLatestEntry(entry: ReturnType<typeof getLatestEntries>[number], headSha: string) {
  const { changedFiles } = await pullLatest(entry, headSha);
  const shouldRestart = requiresRestart(changedFiles) || !isProcessAlive(entry.pid);

  if (!shouldRestart) {
    updateEntry(entry.id, { sha: headSha });
    return;
  }

  const oldId = entry.id;
  const port = entry.port || await allocatePort();
  if (!port) throw new Error('No ports available');

  try {
    await stopServer(entry);
    const { dir, pid, type } = await cloneAndStart(entry.repo, headSha, port, {
      branch: entry.branch,
      isLatest: true,
    });
    if (type === 'static') await releasePort(port);
    await removeEntry(oldId);
    await addEntry({
      ...entry,
      id: makeId(entry.repo, headSha),
      sha: headSha,
      port: type === 'static' ? 0 : port,
      dir,
      pid,
      type,
      lastAccessed: Date.now(),
    });
  } catch (e) {
    if (!entry.port) await releasePort(port);
    throw e;
  }
}

export const webhookRouter = Router();

// Use raw body for signature verification
webhookRouter.post('/api/webhook', raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['x-hub-signature-256'] as string | undefined;
  const body = req.body as Buffer;

  if (!WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Webhook secret not configured' });
  }

  if (!verifySignature(body, sig)) {
    console.warn('[webhook] Invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let payload: any;
  try {
    payload = JSON.parse(body.toString());
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  const repoName = payload.repository?.name;
  const ref = payload.ref as string | undefined; // e.g. "refs/heads/main"

  if (!repoName || !ref) {
    return res.status(200).json({ ok: true, skipped: true });
  }

  const branch = ref.replace('refs/heads/', '');
  console.log(`[webhook] Push event: ${repoName}/${branch}`);

  const matches = getLatestEntries().filter(e => e.repo === repoName && e.branch === branch);
  for (const entry of matches) {
    try {
      const headSha = await getBranchHead(entry.repo, entry.branch!);
      if (headSha !== entry.sha) {
        console.log(`[webhook] ${entry.repo}/${entry.branch}: ${entry.sha.slice(0, 7)} → ${headSha.slice(0, 7)}`);
        await refreshLatestEntry(entry, headSha);
      }
    } catch (e: any) {
      console.error(`[webhook] Error updating ${entry.repo}/${entry.branch}:`, e.message);
    }
  }

  res.json({ ok: true, updated: matches.length });
});

// Auto-register webhook on a GitHub repo
export async function registerWebhook(repo: string, webhookUrl: string): Promise<void> {
  if (!TOKEN) {
    console.warn('[webhook] No GITHUB_TOKEN, skipping webhook registration');
    return;
  }
  if (!WEBHOOK_SECRET) {
    console.warn('[webhook] No WEBHOOK_SECRET, skipping webhook registration');
    return;
  }

  if (!webhookUrl) {
    console.warn('[webhook] No WEBHOOK_URL, skipping registration');
    return;
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${TOKEN}`,
    'User-Agent': 'live-edit-ts',
  };

  try {
    // Check existing hooks
    const listRes = await fetch(`https://api.github.com/repos/${OWNER}/${repo}/hooks`, { headers });
    if (listRes.ok) {
      const hooks = await listRes.json() as any[];
      if (hooks.some((h: any) => h.config?.url === webhookUrl)) {
        console.log(`[webhook] Hook already exists for ${repo}`);
        return;
      }
    }

    // Create hook
    const createRes = await fetch(`https://api.github.com/repos/${OWNER}/${repo}/hooks`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'web',
        active: true,
        events: ['push'],
        config: {
          url: webhookUrl,
          content_type: 'json',
          secret: WEBHOOK_SECRET,
        },
      }),
    });

    if (createRes.ok) {
      console.log(`[webhook] Registered hook for ${repo} → ${webhookUrl}`);
    } else {
      console.warn(`[webhook] Failed to register hook for ${repo}: ${createRes.status}`);
    }
  } catch (e: any) {
    console.error(`[webhook] Registration error for ${repo}:`, e.message);
  }
}

// Remove webhook from a GitHub repo
export async function unregisterWebhook(repo: string): Promise<void> {
  if (!TOKEN) return;

  const webhookUrl = process.env.WEBHOOK_URL;
  if (!webhookUrl) return;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${TOKEN}`,
    'User-Agent': 'live-edit-ts',
  };

  try {
    // Check if any other latest entries still use this repo
    const remaining = getLatestEntries().filter(e => e.repo === repo);
    if (remaining.length > 0) {
      console.log(`[webhook] Keeping hook for ${repo} — ${remaining.length} latest entries still active`);
      return;
    }

    const listRes = await fetch(`https://api.github.com/repos/${OWNER}/${repo}/hooks`, { headers });
    if (!listRes.ok) return;

    const hooks = await listRes.json() as any[];
    const hook = hooks.find((h: any) => h.config?.url === webhookUrl);
    if (!hook) return;

    const delRes = await fetch(`https://api.github.com/repos/${OWNER}/${repo}/hooks/${hook.id}`, {
      method: 'DELETE',
      headers,
    });

    if (delRes.ok || delRes.status === 204) {
      console.log(`[webhook] Removed hook for ${repo}`);
    } else {
      console.warn(`[webhook] Failed to remove hook for ${repo}: ${delRes.status}`);
    }
  } catch (e: any) {
    console.error(`[webhook] Unregister error for ${repo}:`, e.message);
  }
}
