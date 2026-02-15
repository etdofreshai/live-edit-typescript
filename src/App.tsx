import React, { useEffect, useState } from 'react';

interface CacheEntry {
  id: string; repo: string; sha: string; port: number; lastAccessed: number;
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
      refreshCache();
    } catch (e: any) { setError(e.message); }
    finally { setLoading(''); }
  };

  const remove = async (id: string) => {
    await api(`/api/cache/${id}`, { method: 'DELETE' });
    refreshCache();
  };

  return (
    <div style={{ fontFamily: 'system-ui', padding: 20, display: 'flex', gap: 20, height: '100vh', boxSizing: 'border-box' }}>
      <div style={{ width: 400, flexShrink: 0, overflow: 'auto' }}>
        <h2>Live Edit TypeScript</h2>
        {error && <div style={{ color: 'red', marginBottom: 10 }}>{error}</div>}

        <h3>Repos</h3>
        <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid #ddd', borderRadius: 4 }}>
          {repos.map((r: any) => (
            <div key={r.name} onClick={() => selectRepo(r.name)}
              style={{ padding: '6px 10px', cursor: 'pointer', background: r.name === selectedRepo ? '#e0e7ff' : '' }}>
              {r.name}
            </div>
          ))}
        </div>

        {branches.length > 0 && <>
          <h3>Branches — {selectedRepo}</h3>
          <div style={{ maxHeight: 150, overflow: 'auto', border: '1px solid #ddd', borderRadius: 4 }}>
            {branches.map((b: any) => (
              <div key={b.name} onClick={() => selectBranch(b.name)}
                style={{ padding: '6px 10px', cursor: 'pointer', background: b.name === selectedBranch ? '#e0e7ff' : '' }}>
                {b.name}
              </div>
            ))}
          </div>
        </>}

        {commits.length > 0 && <>
          <h3>Commits — {selectedBranch}</h3>
          <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid #ddd', borderRadius: 4 }}>
            {commits.map((c: any) => (
              <div key={c.sha} style={{ padding: '6px 10px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: '#666' }}>{c.sha.slice(0, 7)}</div>
                  <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.commit?.message?.split('\n')[0]}</div>
                </div>
                <button onClick={() => run(c.sha)} disabled={!!loading}
                  style={{ marginLeft: 8, padding: '4px 10px', cursor: 'pointer' }}>
                  {loading === c.sha ? '⏳' : '▶ Run'}
                </button>
              </div>
            ))}
          </div>
        </>}

        <h3>Cache ({cache.length}/10)</h3>
        {cache.map(e => (
          <div key={e.id} style={{ padding: '6px 10px', border: '1px solid #ddd', borderRadius: 4, marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>{e.repo}</strong> <code>{e.sha.slice(0, 7)}</code>
              <span style={{ marginLeft: 8, color: '#059669' }}>:{e.port}</span>
            </div>
            <div>
              <button onClick={() => setPreviewPort(e.port)} style={{ marginRight: 4, cursor: 'pointer' }}>👁</button>
              <button onClick={() => remove(e.id)} style={{ cursor: 'pointer' }}>✕</button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ flex: 1, border: '1px solid #ddd', borderRadius: 4, overflow: 'hidden' }}>
        {previewPort ? (
          <iframe src={`http://localhost:${previewPort}`} style={{ width: '100%', height: '100%', border: 'none' }} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#999' }}>
            Select a commit and click Run to preview
          </div>
        )}
      </div>
    </div>
  );
}
