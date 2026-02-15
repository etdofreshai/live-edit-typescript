import React, { useEffect, useState } from 'react';
import './styles.css';

interface CacheEntry {
  id: string; repo: string; sha: string; port: number; lastAccessed: number;
  branch?: string; isLatest?: boolean;
}

const api = (path: string, opts?: RequestInit) => fetch(path, opts).then(r => r.json());

export default function App() {
  const [repos, setRepos] = useState<any[]>([]);
  const [selectedRepo, setSelectedRepo] = useState('');
  const [branches, setBranches] = useState<any[]>([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [commits, setCommits] = useState<any[]>([]);
  const [cache, setCache] = useState<CacheEntry[]>([]);
  const [previewPort, setPreviewPort] = useState<number | null>(null);
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => { api('/api/repos').then(setRepos).catch(e => setError(e.message)); refreshCache(); }, []);

  const refreshCache = () => api('/api/cache').then(setCache);

  const selectRepo = async (name: string) => {
    setSelectedRepo(name); setSelectedBranch(''); setCommits([]);
    setBranches(await api(`/api/repos/${name}/branches`));
  };

  const selectBranch = async (branch: string) => {
    setSelectedBranch(branch);
    setCommits(await api(`/api/repos/${selectedRepo}/branches/${encodeURIComponent(branch)}/commits`));
  };

  const run = async (sha: string) => {
    setLoading(sha); setError('');
    try {
      const entry = await api('/api/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: selectedRepo, sha }),
      });
      if (entry.error) { setError(entry.error); return; }
      setPreviewPort(entry.port);
      setSidebarOpen(false);
      refreshCache();
    } catch (e: any) { setError(e.message); }
    finally { setLoading(''); }
  };

  const runLatest = async () => {
    setLoading('latest'); setError('');
    try {
      const entry = await api('/api/run-latest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: selectedRepo, branch: selectedBranch }),
      });
      if (entry.error) { setError(entry.error); return; }
      setPreviewPort(entry.port);
      setSidebarOpen(false);
      refreshCache();
    } catch (e: any) { setError(e.message); }
    finally { setLoading(''); }
  };

  useEffect(() => {
    const interval = setInterval(refreshCache, 5000);
    return () => clearInterval(interval);
  }, []);

  const remove = async (id: string) => {
    await api(`/api/cache/${id}`, { method: 'DELETE' });
    refreshCache();
  };

  return (
    <div className="app-container">
      <button className="sidebar-toggle" onClick={() => setSidebarOpen(o => !o)}>
        {sidebarOpen ? '✕' : '☰'}
      </button>

      <div className={`sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
        <h2>Live Edit TypeScript</h2>
        {error && <div className="error-banner">{error}</div>}

        <h3>Repos</h3>
        <div className="list-panel">
          <div className="list-panel-scroll">
            {repos.map((r: any) => (
              <div key={r.name}
                className={`list-item ${r.name === selectedRepo ? 'active' : ''}`}
                onClick={() => selectRepo(r.name)}>
                {r.name}
              </div>
            ))}
          </div>
        </div>

        {branches.length > 0 && <>
          <h3>Branches — {selectedRepo}</h3>
          <div className="list-panel">
            <div className="list-panel-scroll">
              {branches.map((b: any) => (
                <div key={b.name}
                  className={`list-item ${b.name === selectedBranch ? 'active' : ''}`}
                  onClick={() => selectBranch(b.name)}>
                  {b.name}
                </div>
              ))}
            </div>
          </div>
        </>}

        {commits.length > 0 && <>
          <h3>Commits — {selectedBranch}</h3>
          <div className="list-panel">
            <div className="list-panel-scroll tall">
              <div className="latest-entry">
                <div className="commit-info">
                  <div className="latest-label">▶ Latest</div>
                  <div className="latest-desc">Track {selectedBranch} — auto-updates on new commits</div>
                </div>
                <button className="btn-run green" onClick={runLatest} disabled={!!loading}>
                  {loading === 'latest' ? <span className="spinner" /> : '▶ Run'}
                </button>
              </div>
              {commits.map((c: any) => (
                <div key={c.sha} className="commit-item">
                  <div className="commit-info">
                    <div className="commit-sha">{c.sha.slice(0, 7)}</div>
                    <div className="commit-msg">{c.commit?.message?.split('\n')[0]}</div>
                  </div>
                  <button className="btn-run" onClick={() => run(c.sha)} disabled={!!loading}>
                    {loading === c.sha ? <span className="spinner" /> : '▶ Run'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>}

        <h3>Cache ({cache.length}/10)</h3>
        {cache.map(e => (
          <div key={e.id} className="cache-card">
            <div>
              <span className="cache-repo">{e.repo}</span>
              <code className="cache-sha">{e.sha.slice(0, 7)}</code>
              <span className="cache-port">:{e.port}</span>
              {e.isLatest && <span className="cache-badge">latest · {e.branch}</span>}
            </div>
            <div>
              <button className="btn-icon" onClick={() => { setPreviewPort(e.port); setSidebarOpen(false); }}>👁</button>
              <button className="btn-icon danger" onClick={() => remove(e.id)}>✕</button>
            </div>
          </div>
        ))}
      </div>

      <div className="preview-area">
        <div className="preview-header">
          <span className={`dot ${previewPort ? 'green' : 'gray'}`} />
          {previewPort ? `Preview — port ${previewPort}` : 'No preview'}
        </div>
        <div className="preview-body">
          {loading && (
            <div className="loading-overlay">
              <span className="spinner spinner-large" />
              <div className="loading-text loading-pulse">Starting server… this may take a minute</div>
            </div>
          )}
          {previewPort ? (
            <iframe src={`/proxy/${previewPort}/`} />
          ) : (
            <div className="preview-placeholder">
              Select a commit and click Run to preview
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
