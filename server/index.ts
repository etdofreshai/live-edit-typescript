import express from 'express';
import cors from 'cors';
import http from 'http';
import httpProxy from 'http-proxy';
import fs from 'fs';
import pathModule from 'path';
import multer from 'multer';
// Using native FormData + Blob (Node 22)
import { listRepos, listBranches, listCommits, getBranchHead, getCommit, createBranch, getDefaultBranch, compareBranches, createPullRequest, DEFAULT_OWNER } from './github.js';
import { getEntry, addEntry, allocatePort, releasePort, removeEntry, listEntries, makeId, getEntryByPort, getLatestEntries, updateEntry, getEntryById } from './cache-manager.js';
import { events as cacheEvents } from './cache-manager.js';
import { cloneAndStart, pullLatest, getServerLog, stopServer } from './runner.js';
import { webhookRouter, registerWebhook, unregisterWebhook } from './webhook.js';
import { assertInsideTargets } from './path-safety.js';
import { validateBranch, validateOwner, validateRepo, validateSha } from './validators.js';
import { walkBounded } from './file-walk.js';
import { createRequireAdmin } from './admin-middleware.js';
import type { CacheEntry } from './cache-manager.js';

import { execFileSync } from 'child_process';

const app = express();
app.use(cors());

const packageInfo = JSON.parse(fs.readFileSync(pathModule.join(process.cwd(), 'package.json'), 'utf-8')) as { version?: string };
const version = packageInfo.version || '0.0.0';
let warnedDevWebhookUrl = false;
const inflight = new Map<string, Promise<CacheEntry>>();
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const requireAdmin = createRequireAdmin(ADMIN_TOKEN);

type ErrorLike = { message?: string };
type WildcardParams = express.Request['params'] & { 0?: string };
type SelfHandleRequest = http.IncomingMessage & {
  __selfHandle?: boolean;
  originalUrl?: string;
};
type VoiceContext = {
  owner?: string;
  repo?: string;
  branch?: string;
  sha?: string;
};
type GatewayInputContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; source: { type: 'base64'; media_type: string; data: string } };
type GatewayInput = {
  type: 'message';
  role: 'user';
  content: GatewayInputContentPart[];
};
type GatewayResponseContentPart = {
  type?: string;
  text?: string;
};
type GatewayResponseOutputItem = {
  type?: string;
  role?: string;
  content?: GatewayResponseContentPart[];
};
type GatewayResponseBody = {
  output?: GatewayResponseOutputItem[];
  choices?: Array<{ message?: { content?: string } }>;
};
type MulterErrorLike = ErrorLike & {
  name?: string;
  code?: string;
};

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e ?? '');
}

function isErrorLike(e: unknown): e is ErrorLike {
  return typeof e === 'object' && e !== null && 'message' in e;
}

function parseJsonObject(value: string | undefined): unknown {
  return value ? JSON.parse(value) : undefined;
}

function isVoiceContext(value: unknown): value is VoiceContext {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function toGatewayResponseBody(value: unknown): GatewayResponseBody | null {
  return typeof value === 'object' && value !== null ? value as GatewayResponseBody : null;
}

function validationMessage(e: unknown): string {
  const message = errorMessage(e);
  if (message.startsWith('invalid repo:')) return 'invalid repo';
  if (message.startsWith('invalid owner:')) return 'invalid owner';
  if (message.startsWith('invalid sha:')) return 'invalid sha';
  if (message.startsWith('invalid branch:')) return 'invalid branch';
  if (message === 'path outside targets' || message === 'path outside entry') return 'invalid path';
  return 'invalid input';
}

function markLegacyOwner(res: express.Response) {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Warning', `299 - "owner-less repository API routes are deprecated; using ${DEFAULT_OWNER}"`);
}

function isInsideDir(absPath: string, dir: string): boolean {
  const resolved = pathModule.resolve(absPath);
  const root = pathModule.resolve(dir);
  return resolved === root || resolved.startsWith(root + pathModule.sep);
}

function getWebhookCallbackUrl(): string | null {
  if (process.env.WEBHOOK_URL) return process.env.WEBHOOK_URL;
  if (process.env.NODE_ENV === 'production') return null;

  if (!warnedDevWebhookUrl) {
    console.warn('[webhook] WEBHOOK_URL is not configured; using localhost callback URL for development');
    warnedDevWebhookUrl = true;
  }

  const port = process.env.PORT || '3000';
  return `http://localhost:${port}/api/webhook`;
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

async function refreshLatestEntry(entry: CacheEntry, headSha: string) {
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

// Git info for footer
const gitInfo = (() => {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
    const date = execFileSync('git', ['log', '-1', '--format=%aI'], { encoding: 'utf8' }).trim();
    return { owner: DEFAULT_OWNER, repo: 'live-edit-typescript', branch, sha, date };
  } catch { return null; }
})();
app.get('/api/info', (_req, res) => res.json(gitInfo));
// Webhook route MUST come before express.json() — it needs raw body
app.use(webhookRouter);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, version, uptime: Math.round(process.uptime()) });
});

// Multer configuration for voice uploads (audio + optional screenshot)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 4, fields: 20 },
});

// Single reusable proxy instance
const proxy = httpProxy.createProxyServer({ ws: true, changeOrigin: true });
proxy.on('error', (err, _req, res) => {
  console.error('Proxy error:', err.message);
  if (res && 'writeHead' in res) {
    (res as http.ServerResponse).writeHead(502, { 'Content-Type': 'text/plain' });
    (res as http.ServerResponse).end('Proxy error');
  }
});

app.get('/api/repos', async (_req, res) => {
  try {
    const repos = await listRepos();
    res.json(repos);
  } catch (e: unknown) {
    if (errorMessage(e).startsWith('invalid ')) return res.status(400).json({ error: validationMessage(e) });
    res.status(500).json({ error: errorMessage(e) });
  }
});

app.get('/api/repos/:owner', async (req, res) => {
  try {
    const owner = validateOwner(req.params.owner);
    res.json(await listRepos(owner));
  } catch (e: unknown) {
    if (errorMessage(e).startsWith('invalid ')) return res.status(400).json({ error: validationMessage(e) });
    res.status(500).json({ error: errorMessage(e) });
  }
});

app.get('/api/repos/:owner/:repo/branches', async (req, res) => {
  try {
    const owner = validateOwner(req.params.owner);
    const repo = validateRepo(req.params.repo);
    res.json(await listBranches(owner, repo));
  } catch (e: unknown) {
    if (errorMessage(e).startsWith('invalid ')) return res.status(400).json({ error: validationMessage(e) });
    res.status(500).json({ error: errorMessage(e) });
  }
});

app.get('/api/repos/:repo/branches', async (req, res) => {
  try {
    markLegacyOwner(res);
    const repo = validateRepo(req.params.repo);
    res.json(await listBranches(DEFAULT_OWNER, repo));
  } catch (e: unknown) {
    if (errorMessage(e).startsWith('invalid ')) return res.status(400).json({ error: validationMessage(e) });
    res.status(500).json({ error: errorMessage(e) });
  }
});

app.post('/api/repos/:owner/:repo/branches', requireAdmin, async (req, res) => {
  const { name, from } = req.body;
  if (!name || !from) return res.status(400).json({ error: 'name and from required' });
  try {
    const owner = validateOwner(req.params.owner);
    const repo = validateRepo(req.params.repo);
    const branchName = validateBranch(name);
    const fromBranch = validateBranch(from);
    const sha = await getBranchHead(owner, repo, fromBranch);
    const ref = await createBranch(owner, repo, branchName, sha);
    res.json({ name, sha, ref: ref.ref });
  } catch (e: unknown) {
    if (errorMessage(e).startsWith('invalid ')) return res.status(400).json({ error: validationMessage(e) });
    const status = errorMessage(e).includes('already exists') ? 409 : 500;
    res.status(status).json({ error: errorMessage(e) });
  }
});

app.post('/api/repos/:repo/branches', requireAdmin, async (req, res) => {
  const { name, from } = req.body;
  if (!name || !from) return res.status(400).json({ error: 'name and from required' });
  try {
    markLegacyOwner(res);
    const repo = validateRepo(req.params.repo);
    const branchName = validateBranch(name);
    const fromBranch = validateBranch(from);
    const sha = await getBranchHead(DEFAULT_OWNER, repo, fromBranch);
    const ref = await createBranch(DEFAULT_OWNER, repo, branchName, sha);
    res.json({ name, sha, ref: ref.ref });
  } catch (e: unknown) {
    if (errorMessage(e).startsWith('invalid ')) return res.status(400).json({ error: validationMessage(e) });
    const status = errorMessage(e).includes('already exists') ? 409 : 500;
    res.status(status).json({ error: errorMessage(e) });
  }
});

app.get('/api/repos/:owner/:repo/branches/:branch/compare', async (req, res) => {
  try {
    const owner = validateOwner(req.params.owner);
    const repo = validateRepo(req.params.repo);
    const branch = validateBranch(req.params.branch);
    const defaultBranch = await getDefaultBranch(owner, repo);
    if (branch === defaultBranch) {
      return res.json({ ahead: 0, behind: 0, defaultBranch });
    }
    const cmp = await compareBranches(owner, repo, defaultBranch, branch);
    res.json({ ahead: cmp.ahead_by, behind: cmp.behind_by, defaultBranch });
  } catch (e: unknown) {
    if (errorMessage(e).startsWith('invalid ')) return res.status(400).json({ error: validationMessage(e) });
    res.status(500).json({ error: errorMessage(e) });
  }
});

app.get('/api/repos/:repo/branches/:branch/compare', async (req, res) => {
  try {
    markLegacyOwner(res);
    const repo = validateRepo(req.params.repo);
    const branch = validateBranch(req.params.branch);
    const defaultBranch = await getDefaultBranch(DEFAULT_OWNER, repo);
    if (branch === defaultBranch) {
      return res.json({ ahead: 0, behind: 0, defaultBranch });
    }
    const cmp = await compareBranches(DEFAULT_OWNER, repo, defaultBranch, branch);
    res.json({ ahead: cmp.ahead_by, behind: cmp.behind_by, defaultBranch });
  } catch (e: unknown) {
    if (errorMessage(e).startsWith('invalid ')) return res.status(400).json({ error: validationMessage(e) });
    res.status(500).json({ error: errorMessage(e) });
  }
});

app.post('/api/repos/:owner/:repo/pulls', requireAdmin, async (req, res) => {
  const { head, base, title, body } = req.body;
  if (!head || !base || !title) return res.status(400).json({ error: 'head, base, and title required' });
  try {
    const owner = validateOwner(req.params.owner);
    const repo = validateRepo(req.params.repo);
    const headBranch = validateBranch(head);
    const baseBranch = validateBranch(base);
    const pr = await createPullRequest(owner, repo, title, headBranch, baseBranch, body);
    res.json({ url: pr.html_url, number: pr.number });
  } catch (e: unknown) {
    if (errorMessage(e).startsWith('invalid ')) return res.status(400).json({ error: validationMessage(e) });
    res.status(500).json({ error: errorMessage(e) });
  }
});

app.post('/api/repos/:repo/pulls', requireAdmin, async (req, res) => {
  const { head, base, title, body } = req.body;
  if (!head || !base || !title) return res.status(400).json({ error: 'head, base, and title required' });
  try {
    markLegacyOwner(res);
    const repo = validateRepo(req.params.repo);
    const headBranch = validateBranch(head);
    const baseBranch = validateBranch(base);
    const pr = await createPullRequest(DEFAULT_OWNER, repo, title, headBranch, baseBranch, body);
    res.json({ url: pr.html_url, number: pr.number });
  } catch (e: unknown) {
    if (errorMessage(e).startsWith('invalid ')) return res.status(400).json({ error: validationMessage(e) });
    res.status(500).json({ error: errorMessage(e) });
  }
});

app.get('/api/repos/:owner/:repo/branches/:branch/commits', async (req, res) => {
  try {
    const owner = validateOwner(req.params.owner);
    const repo = validateRepo(req.params.repo);
    const branch = validateBranch(req.params.branch);
    res.json(await listCommits(owner, repo, branch));
  } catch (e: unknown) {
    if (errorMessage(e).startsWith('invalid ')) return res.status(400).json({ error: validationMessage(e) });
    res.status(500).json({ error: errorMessage(e) });
  }
});

app.get('/api/repos/:repo/branches/:branch/commits', async (req, res) => {
  try {
    markLegacyOwner(res);
    const repo = validateRepo(req.params.repo);
    const branch = validateBranch(req.params.branch);
    res.json(await listCommits(DEFAULT_OWNER, repo, branch));
  } catch (e: unknown) {
    if (errorMessage(e).startsWith('invalid ')) return res.status(400).json({ error: validationMessage(e) });
    res.status(500).json({ error: errorMessage(e) });
  }
});

app.get('/api/cache', (_req, res) => {
  res.json(listEntries());
});

app.get('/api/cache/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const sendSnapshot = () => res.write(`data: ${JSON.stringify(listEntries())}\n\n`);
  sendSnapshot();

  const onChange = () => sendSnapshot();
  cacheEvents.on('change', onChange);

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);

  req.on('close', () => {
    cacheEvents.off('change', onChange);
    clearInterval(heartbeat);
  });
});

app.post('/api/run', requireAdmin, async (req, res) => {
  const { envVars, startMode } = req.body;
  let owner: string;
  let repo: string;
  let sha: string;
  if (!req.body.owner || !req.body.repo || !req.body.sha) return res.status(400).json({ error: 'owner, repo, and sha required' });
  try {
    owner = validateOwner(req.body.owner);
    repo = validateRepo(req.body.repo);
    sha = validateSha(req.body.sha);
  } catch (e) {
    return res.status(400).json({ error: validationMessage(e) });
  }

  const inflightKey = `${owner}:${repo}:${sha}`;
  const pending = inflight.get(inflightKey);
  if (pending) {
    try {
      return res.json(await pending);
    } catch (e: unknown) {
      if (errorMessage(e).startsWith('invalid ')) return res.status(400).json({ error: validationMessage(e) });
      return res.status(500).json({ error: errorMessage(e) });
    }
  }

  const promise = (async (): Promise<CacheEntry> => {
    const existing = getEntry(owner, repo, sha);
    if (existing) return existing;

    const port = await allocatePort();
    if (!port) throw new Error('No ports available');

    try {
      const [{ dir, pid, type }, commitInfo] = await Promise.all([
        cloneAndStart(owner, repo, sha, port, { envVars, startMode }),
        getCommit(owner, repo, sha).catch(() => ({ message: '', date: '' })),
      ]);
      const entry: CacheEntry = {
        id: makeId(owner, repo, sha),
        owner,
        repo,
        sha,
        port: type === 'static' ? 0 : port,
        dir,
        lastAccessed: Date.now(),
        pid,
        type,
        commitMessage: commitInfo.message,
        commitDate: commitInfo.date,
      };
      if (type === 'static') await releasePort(port);
      await addEntry(entry);
      return entry;
    } catch (e) {
      await releasePort(port);
      throw e;
    }
  })();
  inflight.set(inflightKey, promise);
  try {
    res.json(await promise);
  } catch (e: unknown) {
    if (errorMessage(e).startsWith('invalid ')) return res.status(400).json({ error: validationMessage(e) });
    const status = errorMessage(e) === 'No ports available' ? 503 : 500;
    res.status(status).json({ error: errorMessage(e) });
  } finally {
    inflight.delete(inflightKey);
  }
});

app.post('/api/run-latest', requireAdmin, async (req, res) => {
  const { envVars, startMode } = req.body;
  let owner: string;
  let repo: string;
  let branch: string;
  if (!req.body.owner || !req.body.repo || !req.body.branch) return res.status(400).json({ error: 'owner, repo, and branch required' });
  try {
    owner = validateOwner(req.body.owner);
    repo = validateRepo(req.body.repo);
    branch = validateBranch(req.body.branch);
  } catch (e) {
    return res.status(400).json({ error: validationMessage(e) });
  }

  const webhookUrl = getWebhookCallbackUrl();
  if (!webhookUrl) return res.status(500).json({ error: 'webhook URL not configured' });

  const inflightKey = `${owner}:${repo}:${branch}`;
  const pending = inflight.get(inflightKey);
  if (pending) {
    try {
      return res.json(await pending);
    } catch (e: unknown) {
      if (errorMessage(e).startsWith('invalid ')) return res.status(400).json({ error: validationMessage(e) });
      return res.status(500).json({ error: errorMessage(e) });
    }
  }

  const promise = (async (): Promise<CacheEntry> => {
    const sha = await getBranchHead(owner, repo, branch);

    // Check if we already have a latest entry for this repo+branch
    const existing = getLatestEntries().find(e => e.owner === owner && e.repo === repo && e.branch === branch);
    if (existing) {
      existing.lastAccessed = Date.now();
      return existing;
    }

    const port = await allocatePort();
    if (!port) throw new Error('No ports available');

    let entry: CacheEntry;
    try {
      const [{ dir, pid, type }, commitInfo] = await Promise.all([
        cloneAndStart(owner, repo, sha, port, { branch, isLatest: true, envVars, startMode }),
        getCommit(owner, repo, sha).catch(() => ({ message: '', date: '' })),
      ]);
      entry = {
        id: makeId(owner, repo, sha),
        owner,
        repo, sha, port: type === 'static' ? 0 : port, dir, pid,
        lastAccessed: Date.now(),
        branch,
        isLatest: true,
        type,
        commitMessage: commitInfo.message,
        commitDate: commitInfo.date,
      };
      if (type === 'static') await releasePort(port);
      await addEntry(entry);
    } catch (e) {
      await releasePort(port);
      throw e;
    }

    // Auto-register webhook for this repo
    registerWebhook(owner, repo, webhookUrl);

    return entry;
  })();
  inflight.set(inflightKey, promise);
  try {
    res.json(await promise);
  } catch (e: unknown) {
    if (errorMessage(e).startsWith('invalid ')) return res.status(400).json({ error: validationMessage(e) });
    const status = errorMessage(e) === 'No ports available' ? 503 : 500;
    res.status(status).json({ error: errorMessage(e) });
  } finally {
    inflight.delete(inflightKey);
  }
});

app.get('/api/cache/:id/log', requireAdmin, (req, res) => {
  const entry = getEntryById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  const log = getServerLog(entry.dir);
  res.json({ log });
});

app.delete('/api/cache/:id', requireAdmin, async (req, res) => {
  const entry = getEntryById(req.params.id);
  const ok = await removeEntry(req.params.id);
  // Clean up webhook if this was a latest entry
  if (ok && entry?.isLatest && entry.repo) {
    unregisterWebhook(entry.owner, entry.repo).catch(() => {});
  }
  res.json({ ok });
});

// File explorer endpoints for static repos
app.get('/api/cache/:id/files', requireAdmin, async (req, res) => {
  const entry = getEntryById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  try {
    assertInsideTargets(entry.dir);
  } catch (e) {
    return res.status(400).json({ error: validationMessage(e) });
  }

  try {
    const result = await walkBounded(entry.dir);
    res.json(result);
  } catch (e: unknown) {
    res.status(500).json({ error: errorMessage(e) });
  }
});

app.get('/api/cache/:id/files/*', requireAdmin, async (req, res) => {
  const entry = getEntryById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Not found' });

  const filePath = (req.params as WildcardParams)[0] ?? '';
  if (pathModule.isAbsolute(filePath)) return res.status(403).json({ error: 'Forbidden' });
  const fullPath = pathModule.resolve(entry.dir, filePath);

  try {
    assertInsideTargets(fullPath);
    if (!isInsideDir(fullPath, entry.dir)) throw new Error('path outside entry');
    const stat = await fs.promises.stat(fullPath);
    if (stat.size > 500_000) return res.json({ binary: true, path: filePath });

    const buf = await fs.promises.readFile(fullPath);
    // Check if binary by looking for null bytes in first 8KB
    const sample = buf.subarray(0, 8192);
    if (sample.includes(0)) return res.json({ binary: true, path: filePath });

    res.json({ content: buf.toString('utf-8'), path: filePath });
  } catch (e: unknown) {
    const message = errorMessage(e);
    if (message === 'path outside targets' || message === 'path outside entry') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.status(404).json({ error: 'File not found' });
  }
});

// ─── Voice Jobs (server-side state) ───
interface VoiceJob {
  id: string;
  status: 'transcribing' | 'sending' | 'sent' | 'error';
  text: string;
  startedAt: number;
  error?: string;
}

const voiceJobs: Map<string, VoiceJob> = new Map();

// ─── Transcript History ───
interface TranscriptEntry {
  id: string;
  timestamp: number;
  userText: string;
  screenshot?: boolean;
  consoleLogs?: number;
  response?: string;
  status: 'pending' | 'complete' | 'error';
}

const transcriptHistory: TranscriptEntry[] = [];

function addToHistory(entry: TranscriptEntry) {
  transcriptHistory.push(entry);
  // Cap at 100 entries (drop oldest)
  while (transcriptHistory.length > 100) transcriptHistory.shift();
}

app.get('/api/transcript-history', requireAdmin, (_req, res) => {
  res.json(transcriptHistory.slice(-50));
});

// Clean up old completed jobs after 30s
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of voiceJobs) {
    if ((job.status === 'sent' || job.status === 'error') && now - job.startedAt > 30_000) {
      voiceJobs.delete(id);
    }
  }
}, 5000);

// GET /api/voice/jobs — poll current job states
app.get('/api/voice/jobs', requireAdmin, (_req, res) => {
  res.json(Array.from(voiceJobs.values()));
});

// DELETE /api/voice/jobs/:id — dismiss a job
app.delete('/api/voice/jobs/:id', requireAdmin, (req, res) => {
  voiceJobs.delete(req.params.id);
  res.json({ ok: true });
});

// POST /api/voice — upload audio + optional screenshot, creates a job, processes async
app.post('/api/voice', requireAdmin, upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'screenshot', maxCount: 1 }]), (req, res) => {
  const files = req.files as { [fieldname: string]: Express.Multer.File[] };
  if (!files?.audio?.[0]) return res.status(400).json({ error: 'No audio file provided' });

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  let context: VoiceContext | undefined;
  let consoleLogs: string[] | undefined;
  try {
    try {
      const parsedContext = parseJsonObject(req.body.context);
      if (parsedContext !== undefined && !isVoiceContext(parsedContext)) return res.status(400).json({ error: 'invalid context' });
      context = parsedContext;
    }
    catch { return res.status(400).json({ error: 'invalid context' }); }
    try {
      const parsedConsoleLogs = parseJsonObject(req.body.consoleLogs);
      if (parsedConsoleLogs !== undefined && !isStringArray(parsedConsoleLogs)) return res.status(400).json({ error: 'invalid consoleLogs' });
      consoleLogs = parsedConsoleLogs;
    }
    catch { return res.status(400).json({ error: 'invalid consoleLogs' }); }
    if (context?.repo) validateRepo(context.repo);
    if (context?.owner) validateOwner(context.owner);
    if (context?.branch) validateBranch(context.branch);
    if (context?.sha) validateSha(context.sha);
  } catch (e) {
    return res.status(400).json({ error: validationMessage(e) });
  }
  const audioFile = files.audio[0];
  const screenshotFile = files.screenshot?.[0];
  console.log(`[voice] Received: audio=${audioFile.size}b, screenshot=${screenshotFile ? screenshotFile.size + 'b' : 'none'}, consoleLogs=${consoleLogs ? consoleLogs.length : 0}`);
  
  const jobId = `voice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const job: VoiceJob = { id: jobId, status: 'transcribing', text: '', startedAt: Date.now() };
  voiceJobs.set(jobId, job);

  // Return job ID immediately
  res.json({ jobId });

  // Process async
  (async () => {
    try {
      // Step 1: Transcribe
      const blob = new Blob([new Uint8Array(audioFile.buffer)], { type: audioFile.mimetype || 'audio/webm' });
      const formData = new FormData();
      formData.append('file', blob, 'audio.webm');
      formData.append('model', 'whisper-1');

      const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
        body: formData,
      });

      if (!whisperRes.ok) {
        const err = await whisperRes.text();
        console.error('Whisper API error:', err);
        job.status = 'error'; job.error = 'Transcription failed';
        return;
      }

      const { text } = await whisperRes.json() as { text: string };
      console.log('[voice] Transcribed:', text);

      if (!text?.trim()) {
        job.status = 'error'; job.text = '(no speech detected)';
        return;
      }

      job.text = `"${text}"`;
      job.status = 'sending';

      // Create transcript history entry
      const transcriptId = `tr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const transcriptEntry: TranscriptEntry = {
        id: transcriptId,
        timestamp: Date.now(),
        userText: text,
        screenshot: !!screenshotFile,
        consoleLogs: consoleLogs?.length || undefined,
        status: 'pending',
      };
      addToHistory(transcriptEntry);

      // Step 2: Send to OpenClaw
      const OPENCLAW_GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL;
      const OPENCLAW_GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
      if (!OPENCLAW_GATEWAY_URL || !OPENCLAW_GATEWAY_TOKEN) {
        job.status = 'error'; job.error = 'Gateway not configured';
        return;
      }

      // Build message text
      let messageText = text;
      if (context?.repo) {
        messageText = `[Live Edit: ${context.owner || 'etdofreshai'}/${context.repo}${context.branch ? ` @ ${context.branch}` : ''}${context.sha ? ` (${context.sha.slice(0, 7)})` : ''}]\n[If you make changes, commit and push to the repo.]\n\n${text}`;
      }
      if (consoleLogs && consoleLogs.length > 0) {
        messageText += `\n\n**Console logs (last ${consoleLogs.length} entries):**\n${consoleLogs.join('\n')}`;
      }

      // Build input for OpenResponses API
      const contentParts: GatewayInputContentPart[] = [
        { type: 'input_text', text: messageText }
      ];
      
      // If we have a screenshot, add as input_image content part
      if (screenshotFile) {
        const base64 = screenshotFile.buffer.toString('base64');
        contentParts.push({
          type: 'input_image',
          source: { type: 'base64', media_type: 'image/png', data: base64 }
        });
        console.log(`[voice] Screenshot attached (${Math.round(base64.length / 1024)}KB base64)`);
      }
      
      const input: GatewayInput[] = [
        { type: 'message', role: 'user', content: contentParts }
      ];

      console.log(`[voice] Sending to gateway via /v1/responses (${input.length} input items)`);
      const gatewayRes = await fetch(`${OPENCLAW_GATEWAY_URL}/v1/responses`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENCLAW_GATEWAY_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'openclaw:main',
          input,
        }),
      });

      // Parse response body (for transcript history) before checking status
      let responseBody: GatewayResponseBody | null = null;
      try { responseBody = toGatewayResponseBody(await gatewayRes.json()); } catch {}

      if (!gatewayRes.ok) {
        console.error('OpenClaw gateway error:', responseBody);
        job.status = 'error'; job.error = 'Gateway send failed';
        // Mark transcript as error
        const histEntry = transcriptHistory.find(e => e.id === transcriptId);
        if (histEntry) histEntry.status = 'error';
        return;
      }

      // Extract assistant response text from OpenAI Responses API format
      let responseText: string | undefined;
      try {
        const outputItems = responseBody?.output || [];
        for (const item of outputItems) {
          if (item?.type === 'message' && item?.role === 'assistant') {
            const contentParts = Array.isArray(item.content) ? item.content : [];
            const textPart = contentParts.find(c => c.type === 'output_text' || c.type === 'text');
            if (textPart?.text) { responseText = textPart.text; break; }
          }
        }
        // Fallback: chat-completions style
        if (!responseText) {
          responseText = responseBody?.choices?.[0]?.message?.content || undefined;
        }
      } catch {}

      // Update transcript entry
      const histEntry = transcriptHistory.find(e => e.id === transcriptId);
      if (histEntry) {
        histEntry.status = 'complete';
        if (responseText) histEntry.response = responseText;
      }

      console.log('[voice] Sent to OpenClaw:', text.slice(0, 50));
      job.status = 'sent';
    } catch (e: unknown) {
      console.error('[voice] Error:', e);
      job.status = 'error'; job.error = errorMessage(e);
      // Also mark transcript entry as error if it exists
      const histEntry = transcriptHistory.find(e => e.status === 'pending');
      if (histEntry) histEntry.status = 'error';
    }
  })();
});

// Multer error handler — catches file-too-large, too-many-files, etc.
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (isErrorLike(err) && (err as MulterErrorLike).name === 'MulterError') {
    const multerError = err as MulterErrorLike;
    const code = multerError.code;
    if (code === 'LIMIT_FILE_SIZE' || code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(413).json({ error: 'File too large' });
    }
    return res.status(400).json({ error: 'Upload error' });
  }
  next(err);
});

// SHA endpoint for live-reload polling
app.get('/api/cache/:id/sha', (req, res) => {
  const entry = getEntryById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'not found' });
  res.json({ sha: entry.sha });
});

// Inject live-reload script into proxied HTML responses
proxy.on('proxyRes', (proxyRes, req, res) => {
  // For non-selfHandleResponse requests, this is just informational — skip
  const proxyReq = req as SelfHandleRequest;
  if (!proxyReq.__selfHandle) return;

  const ct = proxyRes.headers['content-type'] || '';
  const isHtml = ct.includes('text/html');

  // Extract port and find cache entry
  const portMatch = proxyReq.originalUrl?.match(/^\/proxy\/(\d+)/);
  const port = portMatch ? parseInt(portMatch[1]) : 0;
  const entry = port ? getEntryByPort(port) : null;

  if (!isHtml || !entry) {
    // Pass through non-HTML responses unchanged
    (res as http.ServerResponse).writeHead(proxyRes.statusCode || 200, proxyRes.headers);
    proxyRes.pipe(res);
    return;
  }

  // Buffer HTML response, inject reload script
  const chunks: Buffer[] = [];
  delete proxyRes.headers['content-length'];
  (res as http.ServerResponse).writeHead(proxyRes.statusCode || 200, proxyRes.headers);

  proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
  proxyRes.on('end', () => {
    let html = Buffer.concat(chunks).toString('utf-8');
    const reloadScript = `
<script>
(function() {
  var cacheId = ${JSON.stringify(entry.id)};
  var lastSha = ${JSON.stringify(entry.sha)};
  setInterval(function() {
    fetch('/api/cache/' + cacheId + '/sha')
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.sha && d.sha !== lastSha) {
          console.log('[live-reload] SHA changed:', lastSha.slice(0,7), '->', d.sha.slice(0,7));
          lastSha = d.sha;
          setTimeout(function() { location.reload(); }, 1000);
        }
      })
      .catch(function() {});
  }, 3000);
})();
</script>`;
    if (html.includes('</body>')) {
      html = html.replace('</body>', reloadScript + '</body>');
    } else if (html.includes('</html>')) {
      html = html.replace('</html>', reloadScript + '</html>');
    } else {
      html += reloadScript;
    }
    (res as http.ServerResponse).end(html);
  });
});

// Proxy /proxy/:port/* → target Vite dev server
// Target Vite runs with --base /proxy/{port}/ so it expects the full prefixed path
// Do NOT strip the prefix — forward as-is
app.use('/proxy/:port', (req, res) => {
  const port = parseInt(req.params.port);
  if (!port || !getEntryByPort(port)) {
    return res.status(404).json({ error: 'No server on that port' });
  }
  // Reconstruct the full URL with the /proxy/{port} prefix
  req.url = `/proxy/${port}${req.url || '/'}`;
  (req as SelfHandleRequest).__selfHandle = true;
  proxy.web(req, res, { target: `http://localhost:${port}`, selfHandleResponse: true });
});

app.use(express.static(pathModule.join(process.cwd(), 'dist')));

// SPA fallback - serve index.html for all other routes (must be last)
// This allows React Router to handle client-side routing
app.get('*', (req, res) => {
  // Don't serve index.html for API routes (they should have been handled above)
  if (req.path.startsWith('/api/') || req.path.startsWith('/proxy/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  
  // In production, serve built index.html
  // In development, let Vite handle it (this won't be hit in dev mode)
  res.sendFile(pathModule.join(process.cwd(), 'dist', 'index.html'), (err) => {
    if (err) {
      // If dist doesn't exist, we're in dev mode - Vite handles this
      res.status(404).send('Not found - run in dev mode with Vite');
    }
  });
});

const server = http.createServer(app);
let shuttingDown = false;

// WebSocket upgrade for HMR — also keep prefix intact
server.on('upgrade', (req, socket, head) => {
  const match = req.url?.match(/^\/proxy\/(\d+)(\/.*)?$/);
  if (match) {
    const port = parseInt(match[1]);
    if (getEntryByPort(port)) {
      proxy.ws(req, socket, head, { target: `http://localhost:${port}` });
      return;
    }
  }
  socket.destroy();
});

const shutdown = (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received; closing API server and target processes`);

  const forceExit = setTimeout(() => {
    console.error('[shutdown] timed out; exiting');
    process.exit(0);
  }, 8000);
  forceExit.unref();

  const stopTargets = Promise.allSettled(listEntries().map(entry => stopServer(entry)));
  server.close(async () => {
    await stopTargets;
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(3000, () => {
  console.log('API server on :3000');

  // Poll latest entries every 10 seconds
  setInterval(async () => {
    for (const entry of getLatestEntries()) {
      try {
        const headSha = await getBranchHead(entry.owner, entry.repo, entry.branch!);
        if (headSha !== entry.sha) {
          console.log(`[latest] ${entry.repo}/${entry.branch}: ${entry.sha.slice(0, 7)} → ${headSha.slice(0, 7)}`);
          await refreshLatestEntry(entry, headSha);
        }
      } catch (e: unknown) {
        console.error(`[latest] poll error for ${entry.repo}/${entry.branch}:`, errorMessage(e));
      }
    }
  }, 10_000);
});
