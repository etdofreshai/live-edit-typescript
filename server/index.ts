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

import { execSync } from 'child_process';

const app = express();
app.use(cors());

// Git info for footer
const gitInfo = (() => {
  try {
    const sha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    const date = execSync('git log -1 --format=%aI', { encoding: 'utf8' }).trim();
    return { owner: OWNER, repo: 'live-edit-typescript', branch, sha, date };
  } catch { return null; }
})();
app.get('/api/info', (_req, res) => res.json(gitInfo));
// Webhook route MUST come before express.json() — it needs raw body
app.use(webhookRouter);
app.use(express.json());

// Multer configuration for voice uploads (audio + optional screenshot)
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

// ─── Voice Jobs (server-side state) ───
interface VoiceJob {
  id: string;
  status: 'transcribing' | 'sending' | 'sent' | 'error';
  text: string;
  startedAt: number;
  error?: string;
}

const voiceJobs: Map<string, VoiceJob> = new Map();

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
app.get('/api/voice/jobs', (_req, res) => {
  res.json(Array.from(voiceJobs.values()));
});

// DELETE /api/voice/jobs/:id — dismiss a job
app.delete('/api/voice/jobs/:id', (req, res) => {
  voiceJobs.delete(req.params.id);
  res.json({ ok: true });
});

// POST /api/voice — upload audio + optional screenshot, creates a job, processes async
app.post('/api/voice', upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'screenshot', maxCount: 1 }]), (req, res) => {
  const files = req.files as { [fieldname: string]: Express.Multer.File[] };
  if (!files?.audio?.[0]) return res.status(400).json({ error: 'No audio file provided' });

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

  const context = req.body.context ? JSON.parse(req.body.context) : undefined;
  const consoleLogs = req.body.consoleLogs ? JSON.parse(req.body.consoleLogs) : undefined;
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

      // Step 2: Send to OpenClaw
      const OPENCLAW_GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL;
      const OPENCLAW_GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
      if (!OPENCLAW_GATEWAY_URL || !OPENCLAW_GATEWAY_TOKEN) {
        job.status = 'error'; job.error = 'Gateway not configured';
        return;
      }

      // Build message content
      let messageContent: any = text;
      
      // If we have a screenshot, use the OpenAI vision message format
      if (screenshotFile) {
        const screenshotBase64 = screenshotFile.buffer.toString('base64');
        const screenshotDataUrl = `data:image/png;base64,${screenshotBase64}`;
        
        let textContent = text;
        
        // Add context prefix
        if (context?.repo) {
          textContent = `[Live Edit: ${context.owner || 'etdofreshai'}/${context.repo}${context.branch ? ` @ ${context.branch}` : ''}${context.sha ? ` (${context.sha.slice(0, 7)})` : ''}]\n[If you make changes, commit and push to the repo.]\n\n${text}`;
        }
        
        // Append console logs if available
        if (consoleLogs && consoleLogs.length > 0) {
          textContent += `\n\n**Console logs (last ${consoleLogs.length} entries):**\n${consoleLogs.join('\n')}`;
        }
        
        messageContent = [
          { type: 'text', text: textContent },
          { type: 'image_url', image_url: { url: screenshotDataUrl } }
        ];
      } else {
        // Text-only message
        if (context?.repo) {
          messageContent = `[Live Edit: ${context.owner || 'etdofreshai'}/${context.repo}${context.branch ? ` @ ${context.branch}` : ''}${context.sha ? ` (${context.sha.slice(0, 7)})` : ''}]\n[If you make changes, commit and push to the repo.]\n\n${text}`;
        }
        
        // Append console logs if available
        if (consoleLogs && consoleLogs.length > 0) {
          messageContent += `\n\n**Console logs (last ${consoleLogs.length} entries):**\n${consoleLogs.join('\n')}`;
        }
      }

      console.log(`[voice] Sending to gateway: content type=${Array.isArray(messageContent) ? 'vision (' + messageContent.length + ' parts)' : 'text'}`);
      const gatewayRes = await fetch(`${OPENCLAW_GATEWAY_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENCLAW_GATEWAY_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'openclaw:main',
          messages: [{ role: 'user', content: messageContent }],
        }),
      });

      if (!gatewayRes.ok) {
        const err = await gatewayRes.text();
        console.error('OpenClaw gateway error:', err);
        job.status = 'error'; job.error = 'Gateway send failed';
        return;
      }

      console.log('[voice] Sent to OpenClaw:', text.slice(0, 50));
      job.status = 'sent';
    } catch (e: any) {
      console.error('[voice] Error:', e);
      job.status = 'error'; job.error = e.message;
    }
  })();
});

// SHA endpoint for live-reload polling
app.get('/api/cache/:id/sha', (req, res) => {
  const entries = listEntries();
  const entry = entries.find((e: any) => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'not found' });
  res.json({ sha: entry.sha });
});

// Inject live-reload script into proxied HTML responses
proxy.on('proxyRes', (proxyRes, req, res) => {
  // For non-selfHandleResponse requests, this is just informational — skip
  if (!(req as any).__selfHandle) return;

  const ct = proxyRes.headers['content-type'] || '';
  const isHtml = ct.includes('text/html');

  // Extract port and find cache entry
  const portMatch = (req as any).originalUrl?.match(/^\/proxy\/(\d+)/);
  const port = portMatch ? parseInt(portMatch[1]) : 0;
  const entry = port ? getEntryByPort(port) : null;

  if (!isHtml || !entry) {
    // Pass through non-HTML responses unchanged
    (res as http.ServerResponse).writeHead(proxyRes.statusCode || 200, proxyRes.headers);
    proxyRes.pipe(res as any);
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
  (req as any).__selfHandle = true;
  proxy.web(req, res, { target: `http://localhost:${port}`, selfHandleResponse: true });
});

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
