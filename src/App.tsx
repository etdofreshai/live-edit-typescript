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
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [currentFile, setCurrentFile] = useState<{ path: string; content?: string; binary?: boolean } | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  const activeEntry = cache.find(e => e.id === activeEntryId) || (previewPort ? cache.find(e => e.port === previewPort) : null);

  const showEntry = async (entry: CacheEntry) => {
    setActiveEntryId(entry.id);
    if (entry.type === 'static') {
      setPreviewPort(null);
      const fileList = await api(`/api/cache/${entry.id}/files`);
      setFiles(fileList);
      setCurrentFile(null);
      setExpandedDirs(new Set());
    } else {
      setPreviewPort(entry.port);
    }
    setSidebarOpen(false);
  };

  const viewFile = async (cacheId: string, filePath: string) => {
    try {
      const data = await api(`/api/cache/${cacheId}/files/${encodeURIComponent(filePath)}`);
      setCurrentFile(data);
    } catch {
      setCurrentFile({ path: filePath, binary: true });
    }
  };

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
      setPreviewPort(entry.port || null);
      setActiveEntryId(entry.id);
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
      setPreviewPort(entry.port || null); setActiveEntryId(entry.id);
      setActiveEntryId(entry.id);
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
              {e.type !== 'static' && <span className="cache-port">:{e.port}</span>}
              {e.type === 'static' && <span style={{ marginLeft: 8, color: '#6b7280', fontSize: 11 }}>static</span>}
              {e.isLatest && <span className="cache-badge">latest · {e.branch}</span>}
            </div>
            <div>
              <button className="btn-icon" onClick={() => showEntry(e)}>👁</button>
              <button className="btn-icon danger" onClick={() => remove(e.id)}>✕</button>
            </div>
          </div>
        ))}
      </div>

      <div className="preview-area">
        <div className="preview-header">
          <span className={`dot ${previewPort || activeEntry?.type === 'static' ? 'green' : 'gray'}`} />
          {previewPort ? `Preview — port ${previewPort}` : activeEntry?.type === 'static' ? `Files — ${activeEntry.repo}` : 'No preview'}
        </div>
        <div className="preview-body">
          {loading && (
            <div className="loading-overlay">
              <span className="spinner spinner-large" />
              <div className="loading-text loading-pulse">
                {activeEntry?.type === 'static' ? 'Cloning repository…' : 'Starting server… this may take a minute'}
              </div>
            </div>
          )}
          {previewPort ? (
            <iframe src={`/proxy/${previewPort}/`} />
          ) : activeEntry?.type === 'static' ? (
            <div style={{ display: 'flex', height: '100%' }}>
              <div style={{ width: 260, borderRight: '1px solid #ddd', overflow: 'auto', fontSize: 13, flexShrink: 0 }}>
                {(() => {
                  const renderItems = (parentPath: string, depth: number): React.ReactNode[] => {
                    const items = files
                      .filter(p => {
                        if (!parentPath) return !p.replace(/\/$/, '').includes('/');
                        return p.startsWith(parentPath) && p !== parentPath &&
                          !p.slice(parentPath.length).replace(/\/$/, '').includes('/');
                      })
                      .sort((a, b) => {
                        const aD = a.endsWith('/'), bD = b.endsWith('/');
                        if (aD !== bD) return aD ? -1 : 1;
                        return a.localeCompare(b);
                      });
                    return items.map(item => {
                      const isDir = item.endsWith('/');
                      const expanded = expandedDirs.has(item);
                      const name = item.replace(/\/$/, '').split('/').pop()!;
                      const isSelected = currentFile?.path === item;
                      return (
                        <div key={item}>
                          <div
                            onClick={() => isDir
                              ? setExpandedDirs(prev => { const n = new Set(prev); n.has(item) ? n.delete(item) : n.add(item); return n; })
                              : viewFile(activeEntry!.id, item)
                            }
                            style={{
                              padding: '3px 8px', paddingLeft: 8 + depth * 16, cursor: 'pointer',
                              background: isSelected ? '#e0e7ff' : 'transparent',
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}
                            onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#f3f4f6'; }}
                            onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                          >
                            <span style={{ marginRight: 4 }}>{isDir ? (expanded ? '📂' : '📁') : '📄'}</span>
                            {name}
                          </div>
                          {isDir && expanded && renderItems(item, depth + 1)}
                        </div>
                      );
                    });
                  };
                  return renderItems('', 0);
                })()}
              </div>
              <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
                {currentFile ? (
                  <>
                    <div style={{ padding: '6px 12px', borderBottom: '1px solid #eee', fontSize: 12, color: '#666', background: '#fafafa' }}>
                      {currentFile.path.split('/').map((part, i, arr) => (
                        <span key={i}>
                          {i > 0 && <span style={{ margin: '0 2px', color: '#ccc' }}>/</span>}
                          <span style={{ color: i === arr.length - 1 ? '#111' : '#666' }}>{part}</span>
                        </span>
                      ))}
                    </div>
                    {currentFile.binary ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#999' }}>
                        Binary file — cannot preview
                      </div>
                    ) : (
                      <pre style={{ margin: 0, padding: 12, fontSize: 13, fontFamily: 'ui-monospace, monospace', overflow: 'auto', flex: 1, background: '#fafafa', lineHeight: 1.5 }}>
                        {currentFile.content}
                      </pre>
                    )}
                  </>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#999' }}>
                    Select a file to view
                  </div>
                )}
              </div>
            </div>
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
