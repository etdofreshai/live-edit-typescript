import express from 'express';
import cors from 'cors';
import http from 'http';
import httpProxy from 'http-proxy';
import { listRepos, listBranches, listCommits } from './github.js';
import { getEntry, addEntry, evictIfNeeded, allocatePort, removeEntry, listEntries, makeId, getEntryByPort } from './cache-manager.js';
import { cloneAndStart, getTargetDir } from './runner.js';

const app = express();
app.use(cors());
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
    const { dir, pid } = await cloneAndStart(repo, sha, port);
    const entry = {
      id: makeId(repo, sha),
      repo,
      sha,
      port,
      dir,
      lastAccessed: Date.now(),
      pid,
    };
    addEntry(entry);
    res.json(entry);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/cache/:id', async (req, res) => {
  const ok = await removeEntry(req.params.id);
  res.json({ ok });
});

// Proxy /proxy/:port/* to target Vite dev servers
// Strip /proxy/:port prefix and inject <base> tag so absolute paths resolve correctly
app.use('/proxy/:port', (req, res) => {
  const port = parseInt(req.params.port);
  if (!port || !getEntryByPort(port)) {
    return res.status(404).json({ error: 'No server on that port' });
  }
  req.url = req.url || '/';

  // For HTML requests (initial page load), intercept and inject <base> tag
  const isHtmlRequest = req.url === '/' || req.url === '/index.html' || req.headers.accept?.includes('text/html');
  if (isHtmlRequest && req.method === 'GET') {
    // Make a sub-request to the target
    const targetReq = http.request({
      hostname: 'localhost',
      port,
      path: req.url,
      method: 'GET',
      headers: { ...req.headers, host: `localhost:${port}` },
    }, (targetRes) => {
      const chunks: Buffer[] = [];
      targetRes.on('data', (chunk: Buffer) => chunks.push(chunk));
      targetRes.on('end', () => {
        let body = Buffer.concat(chunks).toString();
        // Inject <base> tag so /src/main.ts resolves to /proxy/{port}/src/main.ts
        if (body.includes('<head>')) {
          body = body.replace('<head>', `<head><base href="/proxy/${port}/">`);
        }
        res.writeHead(targetRes.statusCode || 200, {
          ...targetRes.headers,
          'content-length': Buffer.byteLength(body),
        });
        res.end(body);
      });
    });
    targetReq.on('error', (err) => {
      res.status(502).json({ error: err.message });
    });
    targetReq.end();
  } else {
    proxy.web(req, res, { target: `http://localhost:${port}` });
  }
});

const server = http.createServer(app);

// WebSocket upgrade for HMR
server.on('upgrade', (req, socket, head) => {
  const match = req.url?.match(/^\/proxy\/(\d+)(\/.*)?$/);
  if (match) {
    const port = parseInt(match[1]);
    if (getEntryByPort(port)) {
      // Strip the /proxy/{port} prefix for WS too
      req.url = match[2] || '/';
      proxy.ws(req, socket, head, { target: `http://localhost:${port}` });
      return;
    }
  }
  socket.destroy();
});

server.listen(3000, () => console.log('API server on :3000'));
