import crypto from 'crypto';
import { Router, raw } from 'express';
import { getLatestEntries, updateEntry } from './cache-manager.js';
import { pullLatest } from './runner.js';
import { getBranchHead, OWNER } from './github.js';

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'live-edit-webhook-secret';
const TOKEN = process.env.GITHUB_TOKEN;

function verifySignature(payload: Buffer, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export const webhookRouter = Router();

// Use raw body for signature verification
webhookRouter.post('/api/webhook', raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['x-hub-signature-256'] as string | undefined;
  const body = req.body as Buffer;

  if (!verifySignature(body, sig)) {
    console.warn('[webhook] Invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const payload = JSON.parse(body.toString());
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
        await pullLatest(entry, headSha);
        updateEntry(entry.id, { sha: headSha });
      }
    } catch (e: any) {
      console.error(`[webhook] Error updating ${entry.repo}/${entry.branch}:`, e.message);
    }
  }

  res.json({ ok: true, updated: matches.length });
});

// Auto-register webhook on a GitHub repo
export async function registerWebhook(repo: string, requestHost?: string): Promise<void> {
  if (!TOKEN) {
    console.warn('[webhook] No GITHUB_TOKEN, skipping webhook registration');
    return;
  }

  const webhookUrl = process.env.WEBHOOK_URL || (requestHost ? `https://${requestHost}/api/webhook` : null);
  if (!webhookUrl) {
    console.warn('[webhook] No WEBHOOK_URL and no host header, skipping registration');
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
