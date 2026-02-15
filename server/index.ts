import express from 'express';
import cors from 'cors';
import http from 'http';
import httpProxy from 'http-proxy';
import fs from 'fs';
import pathModule from 'path';
import multer from 'multer';
// Using native FormData + Blob (Node 22)
import { listRepos, listBranches, listCommits, getBranchHead, getCommit, createBranch, getDefaultBranch, compareBranches, createPullRequest, OWNER } from './github.js';
import { getEntry, addEntry, evictIfNeeded, allocatePort, removeEntry, listEntries, makeId, getEntryByPort, getLatestEntries, updateEntry, getEntryById } from './cache-manager.js';
import { cloneAndStart, getTargetDir, pullLatest, getServerLog } from './runner.js';
import { webhookRouter, registerWebhook, unregisterWebhook } from './webhook.js';

const app = express();
app.use(cors());
// Webhook route MUST come before express.json() — it needs raw body
app.use(webhookRouter);
app.use(express.json());

// Multer configuration for voice uploads
const upload = multer({ storage: multer.memoryStorage() });

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
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/repos/:repo/branches', async (req, res) => {
  try {
    res.json(await listBranches(req.params.repo));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/repos/:repo/branches', async (req, res) => {
  const { name, from } = req.body;
  if (!name || !from) return res.status(400).json({ error: 'name and from required' });
  try {
    const sha = await getBranchHead(req.params.repo, from);
    const ref = await createBranch(req.params.repo, name, sha);
    res.json({ name, sha, ref: ref.ref });
  } catch (e: any) {
    const status = e.message.includes('already exists') ? 409 : 500;
    res.status(status).json({ error: e.message });
  }
});

app.get('/api/repos/:repo/branches/:branch/compare', async (req, res) => {
  try {
    const defaultBranch = await getDefaultBranch(req.params.repo);
    if (req.params.branch === defaultBranch) {
      return res.json({ ahead: 0, behind: 0, defaultBranch });
    }
    const cmp = await compareBranches(req.params.repo, defaultBranch, req.params.branch);
    res.json({ ahead: cmp.ahead_by, behind: cmp.behind_by, defaultBranch });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/repos/:repo/pulls', async (req, res) => {
  const { head, base, title, body } = req.body;
  if (!head || !base || !title) return res.status(400).json({ error: 'head, base, and title required' });
  try {
    const pr = await createPullRequest(req.params.repo, title, head, base, body);
    res.json({ url: pr.html_url, number: pr.number });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/repos/:repo/branches/:branch/commits', async (req, res) => {
  try {
    res.json(await listCommits(req.params.repo, req.params.branch));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/cache', (_req, res) => {
  res.json(listEntries());
});

app.post('/api/run', async (req, res) => {
  const { repo, sha, envVars, startMode } = req.body;
  if (!repo || !sha) return res.status(400).json({ error: 'repo and sha required' });

  const existing = getEntry(repo, sha);
  if (existing) return res.json(existing);

  await evictIfNeeded();

  const port = allocatePort();
  if (!port) return res.status(503).json({ error: 'No ports available' });

  try {
    const [{ dir, pid, type }, commitInfo] = await Promise.all([
      cloneAndStart(repo, sha, port, { envVars, startMode }),
      getCommit(repo, sha).catch(() => ({ message: '', date: '' })),
    ]);
    const entry = {
      id: makeId(repo, sha),
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
    addEntry(entry);
    res.json(entry);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/run-latest', async (req, res) => {
  const { repo, branch, envVars, startMode } = req.body;
  if (!repo || !branch) return res.status(400).json({ error: 'repo and branch required' });

  try {
    const sha = await getBranchHead(repo, branch);

    // Check if we already have a latest entry for this repo+branch
    const existing = getLatestEntries().find(e => e.repo === repo && e.branch === branch);
    if (existing) {
      existing.lastAccessed = Date.now();
      return res.json(existing);
    }

    await evictIfNeeded();
    const port = allocatePort();
    if (!port) return res.status(503).json({ error: 'No ports available' });

    const [{ dir, pid, type }, commitInfo] = await Promise.all([
      cloneAndStart(repo, sha, port, { branch, isLatest: true, envVars, startMode }),
      getCommit(repo, sha).catch(() => ({ message: '', date: '' })),
    ]);
    const entry = {
      id: makeId(repo, sha),
      repo, sha, port, dir, pid,
      lastAccessed: Date.now(),
      branch,
      isLatest: true,
      type,
      commitMessage: commitInfo.message,
      commitDate: commitInfo.date,
    };
    addEntry(entry);

    // Auto-register webhook for this repo
    registerWebhook(repo, req.get('host'));

    res.json(entry);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/cache/:id/log', (req, res) => {
  const entry = getEntryById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Entry not found' });
  const log = getServerLog(entry.dir);
  res.json({ log });
});

app.delete('/api/cache/:id', async (req, res) => {
  const entry = getEntryById(req.params.id);
  const ok = await removeEntry(req.params.id);
  // Clean up webhook if this was a latest entry
  if (ok && entry?.isLatest && entry.repo) {
    unregisterWebhook(entry.repo).catch(() => {});
  }
  res.json({ ok });
});

// File explorer endpoints for static repos
app.get('/api/cache/:id/files', (req, res) => {
  const entry = getEntryById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Not found' });

  const files: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.name === '.git' || item.name === 'node_modules') continue;
      const rel = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) {
        files.push(rel + '/');
        walk(pathModule.join(dir, item.name), rel);
      } else {
        files.push(rel);
      }
    }
  };
  try {
    walk(entry.dir, '');
    files.sort();
    res.json(files);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/cache/:id/files/*', (req, res) => {
  const entry = getEntryById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Not found' });

  const filePath = (req.params as any)[0] as string;
  const fullPath = pathModule.join(entry.dir, filePath);

  // Prevent path traversal
  if (!fullPath.startsWith(entry.dir)) return res.status(403).json({ error: 'Forbidden' });

  try {
    const stat = fs.statSync(fullPath);
    if (stat.size > 500_000) return res.json({ binary: true, path: filePath });

    const buf = fs.readFileSync(fullPath);
    // Check if binary by looking for null bytes in first 8KB
    const sample = buf.subarray(0, 8192);
    if (sample.includes(0)) return res.json({ binary: true, path: filePath });

    res.json({ content: buf.toString('utf-8'), path: filePath });
  } catch (e: any) {
    res.status(404).json({ error: 'File not found' });
  }
});

// Voice-to-OpenClaw endpoint
app.post('/api/voice', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const OPENCLAW_GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL;
    const OPENCLAW_GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;

    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
    }
    if (!OPENCLAW_GATEWAY_URL || !OPENCLAW_GATEWAY_TOKEN) {
      return res.status(500).json({ error: 'OpenClaw gateway not configured' });
    }

    // Step 1: Transcribe audio using OpenAI Whisper
    const blob = new Blob([new Uint8Array(req.file.buffer)], { type: req.file.mimetype || 'audio/webm' });
    const formData = new FormData();
    formData.append('file', blob, 'audio.webm');
    formData.append('model', 'whisper-1');

    const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: formData,
    });

    if (!whisperResponse.ok) {
      const errorText = await whisperResponse.text();
      console.error('Whisper API error:', errorText);
      return res.status(500).json({ error: 'Transcription failed', details: errorText });
    }

    const whisperData = await whisperResponse.json() as { text: string };
    const transcript = whisperData.text;

    console.log('[voice] Transcribed:', transcript);

    // Step 2: Send transcript to OpenClaw gateway (OpenAI-compatible endpoint)
    const gatewayResponse = await fetch(`${OPENCLAW_GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENCLAW_GATEWAY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openclaw:main',
        messages: [{ role: 'user', content: transcript }],
      }),
    });

    if (!gatewayResponse.ok) {
      const errorText = await gatewayResponse.text();
      console.error('OpenClaw gateway error:', errorText);
      // Don't fail the request - we got the transcript, that's what matters
      console.warn('[voice] Gateway send failed, but returning transcript anyway');
    } else {
      console.log('[voice] Sent to OpenClaw');
    }

    // Step 3: Return transcript immediately
    res.json({ transcript, status: 'sent' });
  } catch (e: any) {
    console.error('[voice] Error:', e);
    res.status(500).json({ error: e.message });
  }
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
  proxy.web(req, res, { target: `http://localhost:${port}` });
});

const server = http.createServer(app);

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

server.listen(3000, () => {
  console.log('API server on :3000');

  // Poll latest entries every 10 seconds
  setInterval(async () => {
    for (const entry of getLatestEntries()) {
      try {
        const headSha = await getBranchHead(entry.repo, entry.branch!);
        if (headSha !== entry.sha) {
          console.log(`[latest] ${entry.repo}/${entry.branch}: ${entry.sha.slice(0, 7)} → ${headSha.slice(0, 7)}`);
          await pullLatest(entry, headSha);
          updateEntry(entry.id, { sha: headSha });
        }
      } catch (e: any) {
        console.error(`[latest] poll error for ${entry.repo}/${entry.branch}:`, e.message);
      }
    }
  }, 30_000);
});
