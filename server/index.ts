import express from 'express';
import cors from 'cors';
import http from 'http';
import httpProxy from 'http-proxy';
import fs from 'fs';
import pathModule from 'path';
import { listRepos, listBranches, listCommits, getBranchHead } from './github.js';
import { getEntry, addEntry, evictIfNeeded, allocatePort, removeEntry, listEntries, makeId, getEntryByPort, getLatestEntries, updateEntry, getEntryById } from './cache-manager.js';
import { cloneAndStart, getTargetDir, pullLatest } from './runner.js';
import { webhookRouter, registerWebhook } from './webhook.js';

const app = express();
app.use(cors());
// Webhook route MUST come before express.json() — it needs raw body
app.use(webhookRouter);
app.use(express.json());

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
  const { repo, sha } = req.body;
  if (!repo || !sha) return res.status(400).json({ error: 'repo and sha required' });

  const existing = getEntry(repo, sha);
  if (existing) return res.json(existing);

  await evictIfNeeded();

  const port = allocatePort();
  if (!port) return res.status(503).json({ error: 'No ports available' });

  try {
    const { dir, pid, type } = await cloneAndStart(repo, sha, port);
    const entry = {
      id: makeId(repo, sha),
      repo,
      sha,
      port,
      dir,
      lastAccessed: Date.now(),
      pid,
      type,
    };
    addEntry(entry);
    res.json(entry);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/run-latest', async (req, res) => {
  const { repo, branch } = req.body;
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

    const { dir, pid, type } = await cloneAndStart(repo, sha, port, { branch, isLatest: true });
    const entry = {
      id: makeId(repo, sha),
      repo, sha, port, dir, pid,
      lastAccessed: Date.now(),
      branch,
      isLatest: true,
      type,
    };
    addEntry(entry);

    // Auto-register webhook for this repo
    registerWebhook(repo, req.get('host'));

    res.json(entry);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/cache/:id', async (req, res) => {
  const ok = await removeEntry(req.params.id);
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

  const filePath = req.params[0];
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
  }, 10_000);
});
