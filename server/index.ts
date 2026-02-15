import express from 'express';
import cors from 'cors';
import { listRepos, listBranches, listCommits } from './github.js';
import { getEntry, addEntry, evictIfNeeded, allocatePort, removeEntry, listEntries, makeId } from './cache-manager.js';
import { cloneAndStart, getTargetDir } from './runner.js';

const app = express();
app.use(cors());
app.use(express.json());

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

  // Check if already cached
  const existing = getEntry(repo, sha);
  if (existing) return res.json(existing);

  // Evict if needed
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

app.listen(3000, () => console.log('API server on :3000'));
