import crypto from 'crypto';
import { Router, raw } from 'express';
import { addEntry, allocatePort, getLatestEntries, makeId, releasePort, removeEntry, updateEntry } from './cache-manager.js';
import { pullLatest } from './runner.js';
import { cloneAndStart, stopServer } from './runner.js';
import { getBranchHead, DEFAULT_OWNER } from './github.js';
import { validateOwner, validateRepo } from './validators.js';

const isProduction = process.env.NODE_ENV === 'production';
const configuredWebhookSecret = process.env.WEBHOOK_SECRET;
const WEBHOOK_SECRET = configuredWebhookSecret || (isProduction ? undefined : 'dev-only-insecure');
const TOKEN = process.env.GITHUB_TOKEN;
const registeredWebhookRepos = new Set<string>();

type GitHubPushPayload = {
  ref?: string;
  repository?: {
    name?: string;
    owner?: {
      login?: string;
    };
  };
  organization?: {
    login?: string;
  };
};
type GitHubHook = {
  id?: number;
  config?: {
    url?: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e ?? '');
}

export function toGitHubPushPayload(value: unknown): GitHubPushPayload {
  if (!isRecord(value)) return {};

  const repositoryValue = value.repository;
  const repository = isRecord(repositoryValue) ? repositoryValue : undefined;
  const repositoryOwnerValue = repository?.owner;
  const repositoryOwner = isRecord(repositoryOwnerValue) ? repositoryOwnerValue : undefined;

  const organizationValue = value.organization;
  const organization = isRecord(organizationValue) ? organizationValue : undefined;

  return {
    ref: readString(value, 'ref'),
    repository: repository ? {
      name: readString(repository, 'name'),
      owner: repositoryOwner ? {
        login: readString(repositoryOwner, 'login'),
      } : undefined,
    } : undefined,
    organization: organization ? {
      login: readString(organization, 'login'),
    } : undefined,
  };
}

export function toGitHubHooks(value: unknown): GitHubHook[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((hook): GitHubHook[] => {
    if (!isRecord(hook)) return [];

    const configValue = hook.config;
    const config = isRecord(configValue) ? configValue : undefined;
    return [{
      id: typeof hook.id === 'number' ? hook.id : undefined,
      config: config ? {
        url: readString(config, 'url'),
      } : undefined,
    }];
  });
}

if (!configuredWebhookSecret) {
  if (isProduction) {
    console.warn('[webhook] WEBHOOK_SECRET is not configured; webhook requests will return 503');
  } else {
    console.warn('[webhook] WEBHOOK_SECRET is not configured; using dev-only-insecure placeholder for local development');
  }
}

export function verifySignature(payload: Buffer, signature: string | undefined): boolean {
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
    const { dir, pid, type } = await cloneAndStart(entry.owner, entry.repo, headSha, port, {
      branch: entry.branch,
      isLatest: true,
    });
    if (type === 'static') await releasePort(port);
    await removeEntry(oldId);
    await addEntry({
      ...entry,
      id: makeId(entry.owner, entry.repo, headSha),
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

  let payload: GitHubPushPayload;
  try {
    payload = toGitHubPushPayload(JSON.parse(body.toString()));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  const repoName = payload.repository?.name;
  const ownerName = payload.repository?.owner?.login || payload.organization?.login || DEFAULT_OWNER;
  const ref = payload.ref as string | undefined; // e.g. "refs/heads/main"

  if (!repoName || !ref) {
    return res.status(200).json({ ok: true, skipped: true });
  }
  let owner: string;
  let repo: string;
  try {
    owner = validateOwner(ownerName);
    repo = validateRepo(repoName);
  } catch {
    return res.status(200).json({ ok: true, skipped: true });
  }

  const branch = ref.replace('refs/heads/', '');
  console.log(`[webhook] Push event: ${owner}/${repo}/${branch}`);

  const matches = getLatestEntries().filter(e => e.owner === owner && e.repo === repo && e.branch === branch);
  for (const entry of matches) {
    try {
      const headSha = await getBranchHead(entry.owner, entry.repo, entry.branch!);
      if (headSha !== entry.sha) {
        console.log(`[webhook] ${entry.repo}/${entry.branch}: ${entry.sha.slice(0, 7)} → ${headSha.slice(0, 7)}`);
        await refreshLatestEntry(entry, headSha);
      }
    } catch (e: unknown) {
      console.error(`[webhook] Error updating ${entry.repo}/${entry.branch}:`, errorMessage(e));
    }
  }

  res.json({ ok: true, updated: matches.length });
});

export async function registerWebhook(owner: string, repo: string, webhookUrl: string): Promise<void> {
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

  const safeOwner = validateOwner(owner);
  const safeRepo = validateRepo(repo);
  const repoKey = `${safeOwner}/${safeRepo}`;
  if (registeredWebhookRepos.has(repoKey)) {
    console.log(`[webhook] Hook already registered for ${repoKey}`);
    return;
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${TOKEN}`,
    'User-Agent': 'live-edit-ts',
  };

  try {
    // Check existing hooks
    const listRes = await fetch(`https://api.github.com/repos/${safeOwner}/${safeRepo}/hooks`, { headers });
    if (listRes.ok) {
      const hooks = toGitHubHooks(await listRes.json());
      if (hooks.some(h => h.config?.url === webhookUrl)) {
        console.log(`[webhook] Hook already exists for ${repoKey}`);
        registeredWebhookRepos.add(repoKey);
        return;
      }
    }

    // Create hook
    const createRes = await fetch(`https://api.github.com/repos/${safeOwner}/${safeRepo}/hooks`, {
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
      console.log(`[webhook] Registered hook for ${repoKey} → ${webhookUrl}`);
      registeredWebhookRepos.add(repoKey);
    } else {
      console.warn(`[webhook] Failed to register hook for ${safeOwner}/${safeRepo}: ${createRes.status}`);
    }
  } catch (e: unknown) {
    console.error(`[webhook] Registration error for ${owner}/${repo}:`, errorMessage(e));
  }
}

export async function unregisterWebhook(owner: string, repo: string): Promise<void> {
  if (!TOKEN) return;

  const webhookUrl = process.env.WEBHOOK_URL;
  if (!webhookUrl) return;

  const safeOwner = validateOwner(owner);
  const safeRepo = validateRepo(repo);
  registeredWebhookRepos.delete(`${safeOwner}/${safeRepo}`);
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${TOKEN}`,
    'User-Agent': 'live-edit-ts',
  };

  try {
    // Check if any other latest entries still use this repo
    const remaining = getLatestEntries().filter(e => e.owner === safeOwner && e.repo === safeRepo);
    if (remaining.length > 0) {
      console.log(`[webhook] Keeping hook for ${safeOwner}/${safeRepo} — ${remaining.length} latest entries still active`);
      return;
    }

    const listRes = await fetch(`https://api.github.com/repos/${safeOwner}/${safeRepo}/hooks`, { headers });
    if (!listRes.ok) return;

    const hooks = toGitHubHooks(await listRes.json());
    const hook = hooks.find(h => h.config?.url === webhookUrl);
    if (!hook) return;

    const delRes = await fetch(`https://api.github.com/repos/${safeOwner}/${safeRepo}/hooks/${hook.id}`, {
      method: 'DELETE',
      headers,
    });

    if (delRes.ok || delRes.status === 204) {
      console.log(`[webhook] Removed hook for ${safeOwner}/${safeRepo}`);
    } else {
      console.warn(`[webhook] Failed to remove hook for ${safeOwner}/${safeRepo}: ${delRes.status}`);
    }
  } catch (e: unknown) {
    console.error(`[webhook] Unregister error for ${owner}/${repo}:`, errorMessage(e));
  }
}
