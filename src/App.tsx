import React, { useEffect, useState, useRef } from 'react';
import './styles.css';

interface CacheEntry {
  id: string; repo: string; sha: string; port: number; lastAccessed: number;
  branch?: string; isLatest?: boolean;
  commitMessage?: string; commitDate?: string;
  type?: 'vite' | 'static';
}

type StartMode = 'vite' | 'npm-dev';

const STORAGE_KEY = 'live-edit-state';

interface PersistedState {
  selectedRepo: string;
  selectedBranch: string;
  activeEntryId: string | null;
  previewPort: number | null;
  sidebarOpen: boolean;
  // Info needed to auto-re-run after server restart
  lastRun?: { repo: string; sha: string; branch?: string; isLatest?: boolean } | null;
}

function loadPersistedState(): Partial<PersistedState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch { return {}; }
}

function savePersistedState(state: PersistedState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

const api = (path: string, opts?: RequestInit) => fetch(path, opts).then(r => r.json());

function IframeWithRetry({ port, cacheId }: { port: number; cacheId?: string }) {
  const [ready, setReady] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [serverLog, setServerLog] = useState('');
  const [showLog, setShowLog] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const maxRetries = 30;
  const cancelledRef = useRef(false);

  useEffect(() => {
    setReady(false);
    setRetryCount(0);
    setCancelled(false);
    setTimedOut(false);
    setServerLog('');
    cancelledRef.current = false;

    const poll = async () => {
      for (let i = 0; i < maxRetries; i++) {
        if (cancelledRef.current) return;
        try {
          const res = await fetch(`/proxy/${port}/`, { method: 'HEAD' });
          if (res.ok) {
            if (!cancelledRef.current) setReady(true);
            return;
          }
        } catch {}
        if (!cancelledRef.current) {
          setRetryCount(i + 1);
          // Fetch server log every 5 attempts
          if (cacheId && (i + 1) % 3 === 0) {
            try {
              const data = await fetch(`/api/cache/${cacheId}/log`).then(r => r.json());
              if (data.log) setServerLog(data.log);
            } catch {}
          }
        }
        await new Promise(r => setTimeout(r, 2000));
      }
      if (!cancelledRef.current) {
        setTimedOut(true);
        // Fetch final log
        if (cacheId) {
          try {
            const data = await fetch(`/api/cache/${cacheId}/log`).then(r => r.json());
            if (data.log) setServerLog(data.log);
          } catch {}
        }
      }
    };
    poll();
    return () => { cancelledRef.current = true; };
  }, [port, cacheId]);

  if (!ready) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6b7280', gap: 12, padding: 20 }}>
        {cancelled ? (
          <div>Cancelled</div>
        ) : timedOut ? (
          <>
            <div style={{ color: '#f38ba8', fontSize: 16 }}>⚠ Server failed to start</div>
            {serverLog && (
              <pre style={{ maxWidth: '90%', maxHeight: 300, overflow: 'auto', background: '#16161e', color: '#cdd6f4', padding: 12, borderRadius: 6, fontSize: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap', textAlign: 'left', width: '100%' }}>
                {serverLog}
              </pre>
            )}
          </>
        ) : (
          <>
            <div className="spinner" />
            <div>Waiting for server on port {port}… {retryCount > 0 ? `(attempt ${retryCount}/${maxRetries})` : ''}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setCancelled(true); cancelledRef.current = true; }} style={{ padding: '4px 16px', background: 'transparent', border: '1px solid #555', borderRadius: 6, color: '#999', cursor: 'pointer', fontSize: 13 }}>Cancel</button>
              {cacheId && (
                <button onClick={async () => { setShowLog(!showLog); if (!showLog && cacheId) { try { const d = await fetch(`/api/cache/${cacheId}/log`).then(r => r.json()); if (d.log) setServerLog(d.log); } catch {} } }} style={{ padding: '4px 16px', background: 'transparent', border: '1px solid #555', borderRadius: 6, color: '#999', cursor: 'pointer', fontSize: 13 }}>
                  {showLog ? 'Hide Log' : 'Show Log'}
                </button>
              )}
            </div>
            {showLog && serverLog && (
              <pre style={{ maxWidth: '90%', maxHeight: 200, overflow: 'auto', background: '#16161e', color: '#cdd6f4', padding: 12, borderRadius: 6, fontSize: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap', textAlign: 'left', width: '100%' }}>
                {serverLog}
              </pre>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <iframe
      src={`/proxy/${port}/`}
      style={{ background: '#1a1a2e' }}
    />
  );
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const sec = Math.floor((now - then) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export default function App() {
  const saved = useRef(loadPersistedState());
  const [repos, setRepos] = useState<any[]>([]);
  const [selectedRepo, setSelectedRepo] = useState(saved.current.selectedRepo || '');
  const [branches, setBranches] = useState<any[]>([]);
  const [selectedBranch, setSelectedBranch] = useState(saved.current.selectedBranch || '');
  const [commits, setCommits] = useState<any[]>([]);
  const [cache, setCache] = useState<CacheEntry[]>([]);
  const [previewPort, setPreviewPort] = useState<number | null>(saved.current.previewPort ?? null);
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(saved.current.sidebarOpen ?? true);
  const [activeEntryId, setActiveEntryId] = useState<string | null>(saved.current.activeEntryId ?? null);
  const [files, setFiles] = useState<string[]>([]);
  const [currentFile, setCurrentFile] = useState<{ path: string; content?: string; binary?: boolean } | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [restoringState, setRestoringState] = useState(true);
  const [branchFrom, setBranchFrom] = useState<string | null>(null);
  const [newBranchName, setNewBranchName] = useState('');
  const [branchError, setBranchError] = useState('');
  const [compareInfo, setCompareInfo] = useState<{ ahead: number; behind: number; defaultBranch: string } | null>(null);
  const [prLoading, setPrLoading] = useState(false);
  const [prResult, setPrResult] = useState<{ url: string; number: number } | null>(null);
  const [prError, setPrError] = useState('');
  const [showEnvModal, setShowEnvModal] = useState(false);
  const [envText, setEnvText] = useState('');
  const [startMode, setStartMode] = useState<StartMode>('vite');

  const activeEntry = cache.find(e => e.id === activeEntryId) || (previewPort ? cache.find(e => e.port === previewPort) : null);

  // Load env vars for selected repo
  useEffect(() => {
    if (selectedRepo) {
      try {
        const stored = localStorage.getItem(`env:${selectedRepo}`);
        if (stored) {
          // Migrate old JSON format to text
          try { const obj = JSON.parse(stored); if (typeof obj === 'object' && !Array.isArray(obj)) { setEnvText(Object.entries(obj).map(([k,v]) => `${k}=${v}`).join('\n')); return; } } catch {}
          setEnvText(stored);
        } else {
          setEnvText('');
        }
      } catch {
        setEnvText('');
      }
      try {
        const mode = localStorage.getItem(`startMode:${selectedRepo}`) as StartMode;
        setStartMode(mode || 'vite');
      } catch {
        setStartMode('vite');
      }
    }
  }, [selectedRepo]);

  const parseEnvText = (text: string): Record<string, string> => {
    const vars: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq > 0) vars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return vars;
  };

  const saveEnvText = (text: string) => {
    if (!selectedRepo) return;
    setEnvText(text);
    try {
      localStorage.setItem(`env:${selectedRepo}`, text);
    } catch {}
  };

  const saveStartMode = (mode: StartMode) => {
    if (!selectedRepo) return;
    setStartMode(mode);
    try {
      localStorage.setItem(`startMode:${selectedRepo}`, mode);
    } catch {}
  };

  // Persist state on changes
  useEffect(() => {
    if (restoringState) return;
    const lastRun = activeEntry ? { repo: activeEntry.repo, sha: activeEntry.sha, branch: activeEntry.branch, isLatest: activeEntry.isLatest } : null;
    savePersistedState({ selectedRepo, selectedBranch, activeEntryId, previewPort, sidebarOpen, lastRun });
  }, [selectedRepo, selectedBranch, activeEntryId, previewPort, sidebarOpen, restoringState, activeEntry]);

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

  // Initial load + restore persisted state
  useEffect(() => {
    const init = async () => {
      try {
        const [repoList, cacheList] = await Promise.all([api('/api/repos'), api('/api/cache')]);
        setRepos(repoList);
        setCache(cacheList);

        const s = saved.current;
        if (s.selectedRepo) {
          const repoExists = repoList.some((r: any) => r.name === s.selectedRepo);
          if (repoExists) {
            const branchList = await api(`/api/repos/${s.selectedRepo}/branches`);
            setBranches(branchList);

            if (s.selectedBranch) {
              const branchExists = branchList.some((b: any) => b.name === s.selectedBranch);
              if (branchExists) {
                const commitList = await api(`/api/repos/${s.selectedRepo}/branches/${encodeURIComponent(s.selectedBranch)}/commits`);
                setCommits(commitList);
              } else {
                setSelectedBranch('');
              }
            }
          } else {
            setSelectedRepo('');
            setSelectedBranch('');
          }
        }

        // Validate active entry still exists in cache — if not, auto-re-run
        if (s.activeEntryId) {
          const entryExists = cacheList.some((e: CacheEntry) => e.id === s.activeEntryId);
          if (!entryExists && s.lastRun) {
            // Server restarted — re-run the last entry
            setLoading('restoring');
            try {
              let entry;
              if (s.lastRun.isLatest && s.lastRun.branch) {
                entry = await api('/api/run-latest', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ repo: s.lastRun.repo, branch: s.lastRun.branch }),
                });
              } else {
                entry = await api('/api/run', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ repo: s.lastRun.repo, sha: s.lastRun.sha }),
                });
              }
              if (entry && !entry.error) {
                setCache(await api('/api/cache'));
                await showEntry(entry);
              } else {
                setActiveEntryId(null);
                setPreviewPort(null);
              }
            } catch {
              setActiveEntryId(null);
              setPreviewPort(null);
            }
            setLoading('');
          } else if (!entryExists) {
            setActiveEntryId(null);
            setPreviewPort(null);
          }
        }
      } catch (e: any) {
        setError(e.message);
      } finally {
        setRestoringState(false);
      }
    };
    init();
  }, []);

  const refreshCache = () => api('/api/cache').then(setCache);

  const selectRepo = async (name: string) => {
    setSelectedRepo(name); setSelectedBranch(''); setCommits([]);
    setBranches(await api(`/api/repos/${name}/branches`));
  };

  const handleCreateBranch = async (fromBranch: string, name: string) => {
    setBranchError('');
    try {
      const res = await fetch(`/api/repos/${selectedRepo}/branches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, from: fromBranch }),
      });
      const data = await res.json();
      if (!res.ok) { setBranchError(data.error || 'Failed to create branch'); return; }
      setBranchFrom(null);
      setNewBranchName('');
      setBranches(await api(`/api/repos/${selectedRepo}/branches`));
      selectBranch(name);
    } catch (e: any) { setBranchError(e.message); }
  };

  const selectBranch = async (branch: string) => {
    setSelectedBranch(branch);
    setPrResult(null);
    setPrError('');
    setCompareInfo(null);
    const [commitList, cmp] = await Promise.all([
      api(`/api/repos/${selectedRepo}/branches/${encodeURIComponent(branch)}/commits`),
      api(`/api/repos/${selectedRepo}/branches/${encodeURIComponent(branch)}/compare`).catch(() => null),
    ]);
    setCommits(commitList);
    if (cmp && !cmp.error) setCompareInfo(cmp);
  };

  const handleCreatePR = async () => {
    if (!compareInfo || !selectedBranch || !selectedRepo) return;
    setPrLoading(true);
    setPrError('');
    setPrResult(null);
    try {
      const res = await api(`/api/repos/${selectedRepo}/pulls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          head: selectedBranch,
          base: compareInfo.defaultBranch,
          title: `Merge ${selectedBranch} into ${compareInfo.defaultBranch}`,
        }),
      });
      if (res.error) { setPrError(res.error); return; }
      setPrResult(res);
    } catch (e: any) { setPrError(e.message); }
    finally { setPrLoading(false); }
  };

  const run = async (sha: string) => {
    setLoading(sha); setError('');
    try {
      const entry = await api('/api/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: selectedRepo, sha, envVars: parseEnvText(envText), startMode }),
      });
      if (entry.error) { setError(entry.error); return; }
      await refreshCache();
      await showEntry(entry);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(''); }
  };

  const runLatest = async () => {
    setLoading('latest'); setError('');
    try {
      const entry = await api('/api/run-latest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: selectedRepo, branch: selectedBranch, envVars: parseEnvText(envText), startMode }),
      });
      if (entry.error) { setError(entry.error); return; }
      await refreshCache();
      await showEntry(entry);
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
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                onClick={() => selectRepo(r.name)}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                <a
                  href={`https://github.com/etdofreshai/${r.name}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  style={{ color: '#6b7280', fontSize: 11, textDecoration: 'none', flexShrink: 0, padding: '0 4px' }}
                  title="View on GitHub"
                >↗</a>
              </div>
            ))}
          </div>
        </div>

        {branches.length > 0 && <>
          <h3>Branches — {selectedRepo}</h3>
          <div className="list-panel">
            <div className="list-panel-scroll">
              {branches.map((b: any) => (
                <div key={b.name}>
                  <div
                    className={`list-item ${b.name === selectedBranch ? 'active' : ''}`}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                    onClick={() => selectBranch(b.name)}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                    <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                      <a
                        href={`https://github.com/etdofreshai/${selectedRepo}/tree/${b.name}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        style={{ color: '#6b7280', fontSize: 11, textDecoration: 'none', padding: '0 4px' }}
                        title="View on GitHub"
                      >↗</a>
                      <button
                        onClick={(e) => { e.stopPropagation(); setBranchFrom(branchFrom === b.name ? null : b.name); setNewBranchName(`${b.name}-dev-${crypto.randomUUID().slice(0, 6)}`); setBranchError(''); }}
                        style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 14, padding: '0 4px', flexShrink: 0, lineHeight: 1 }}
                        title="Create branch from here"
                      >⑂</button>
                    </div>
                  </div>
                  {branchFrom === b.name && (
                    <div style={{ padding: '4px 8px 8px', display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input
                        autoFocus
                        value={newBranchName}
                        onChange={e => setNewBranchName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && newBranchName.trim()) handleCreateBranch(b.name, newBranchName.trim()); if (e.key === 'Escape') setBranchFrom(null); }}
                        placeholder="new-branch-name"
                        style={{ flex: 1, background: '#1a1a2e', border: '1px solid #3a3a5e', borderRadius: 4, color: '#cdd6f4', padding: '3px 6px', fontSize: 12, outline: 'none', minWidth: 0 }}
                        onClick={e => e.stopPropagation()}
                      />
                      <button
                        onClick={(e) => { e.stopPropagation(); if (newBranchName.trim()) handleCreateBranch(b.name, newBranchName.trim()); }}
                        style={{ background: '#a6e3a1', color: '#1a1a2e', border: 'none', borderRadius: 4, padding: '3px 8px', fontSize: 12, cursor: 'pointer', fontWeight: 600, flexShrink: 0 }}
                      >Create</button>
                    </div>
                  )}
                  {branchFrom === b.name && branchError && (
                    <div style={{ padding: '0 8px 6px', color: '#f38ba8', fontSize: 11 }}>{branchError}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>}

        {commits.length > 0 && <>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>Commits — {selectedBranch}</span>
            {compareInfo && compareInfo.ahead > 0 && (
              <span style={{ fontSize: 11, background: '#89b4fa22', color: '#89b4fa', padding: '2px 8px', borderRadius: 10, fontWeight: 500 }}>
                {compareInfo.ahead} ahead
              </span>
            )}
            {compareInfo && compareInfo.ahead > 0 && !prResult && (
              <button
                onClick={handleCreatePR}
                disabled={prLoading}
                style={{ fontSize: 11, background: '#a6e3a122', color: '#a6e3a1', border: '1px solid #a6e3a144', borderRadius: 6, padding: '2px 10px', cursor: 'pointer', fontWeight: 600 }}
              >
                {prLoading ? '…' : `🔀 PR → ${compareInfo.defaultBranch}`}
              </button>
            )}
            {prResult && (
              <a href={prResult.url} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 11, color: '#a6e3a1', textDecoration: 'none' }}>
                ✓ PR #{prResult.number}
              </a>
            )}
            {prError && (
              <span style={{ fontSize: 11, color: '#f38ba8' }}>{prError.slice(0, 80)}</span>
            )}
            <select
              value={startMode}
              onChange={e => saveStartMode(e.target.value as StartMode)}
              style={{ fontSize: 11, background: '#1a1a2e', color: '#cdd6f4', border: '1px solid #3a3a5e', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', marginLeft: 'auto' }}
            >
              <option value="vite">Vite</option>
              <option value="npm-dev">npm run dev</option>
            </select>
            <button
              onClick={() => setShowEnvModal(true)}
              style={{ fontSize: 11, background: 'transparent', color: '#cdd6f4', border: '1px solid #3a3a5e', borderRadius: 6, padding: '2px 10px', cursor: 'pointer', fontWeight: 600 }}
            >
              ⚙️ Env
            </button>
          </h3>
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <div className="commit-sha">{c.sha.slice(0, 7)}</div>
                      <a
                        href={`https://github.com/etdofreshai/${selectedRepo}/commit/${c.sha}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#6b7280', fontSize: 10, textDecoration: 'none' }}
                        title="View on GitHub"
                      >↗</a>
                    </div>
                    <div className="commit-msg">{c.commit?.message?.split('\n')[0]}</div>
                    {c.commit?.author?.date && (
                      <div style={{ color: '#6b7280', fontSize: 11 }} title={new Date(c.commit.author.date).toLocaleString()}>{timeAgo(c.commit.author.date)}</div>
                    )}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span className="cache-repo">{e.repo}</span>
              <code className="cache-sha">{e.sha.slice(0, 7)}</code>
              <a
                href={`https://github.com/etdofreshai/${e.repo}/commit/${e.sha}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#6b7280', fontSize: 10, textDecoration: 'none' }}
                title="View on GitHub"
              >↗</a>
              {e.type !== 'static' && <span className="cache-port">:{e.port}</span>}
              {e.type === 'static' && <span style={{ color: '#6b7280', fontSize: 11 }}>static</span>}
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
          {activeEntry ? (
            <>
              <a href="https://github.com/etdofreshai" target="_blank" rel="noopener noreferrer" style={{ color: '#6b7280', textDecoration: 'none' }}>etdofreshai</a>
              <span style={{ color: '#555', margin: '0 2px' }}>/</span>
              <a href={`https://github.com/etdofreshai/${activeEntry.repo}`} target="_blank" rel="noopener noreferrer" style={{ color: '#cdd6f4', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                {activeEntry.repo}
                <span style={{ fontSize: 10, color: '#6b7280' }}>↗</span>
              </a>
              {activeEntry.branch && (
                <>
                  <span style={{ color: '#555', margin: '0 4px' }}>@</span>
                  <a href={`https://github.com/etdofreshai/${activeEntry.repo}/tree/${activeEntry.branch}`} target="_blank" rel="noopener noreferrer" style={{ color: '#a6e3a1', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    {activeEntry.branch}
                    <span style={{ fontSize: 10, color: '#6b7280' }}>↗</span>
                  </a>
                </>
              )}
              <span style={{ color: '#555', margin: '0 4px' }}>·</span>
              <a href={`https://github.com/etdofreshai/${activeEntry.repo}/commit/${activeEntry.sha}`} target="_blank" rel="noopener noreferrer" style={{ color: '#89b4fa', fontFamily: 'monospace', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                {activeEntry.sha.slice(0, 7)}
                <span style={{ fontSize: 10, color: '#6b7280' }}>↗</span>
              </a>
              {activeEntry.commitDate && (
                <span style={{ marginRight: 6 }} title={new Date(activeEntry.commitDate).toLocaleString()}>{timeAgo(activeEntry.commitDate)}</span>
              )}
              {activeEntry.commitMessage && (
                <span style={{ color: '#cdd6f4' }}>{activeEntry.commitMessage.slice(0, 50)}{activeEntry.commitMessage.length > 50 ? '…' : ''}</span>
              )}
              <button
                onClick={() => { setSelectedRepo(activeEntry.repo); setShowEnvModal(true); }}
                style={{ marginLeft: 'auto', background: 'transparent', color: '#cdd6f4', border: '1px solid #3a3a5e', borderRadius: 6, padding: '2px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
              >
                ⚙️ Env
              </button>
              <span style={{ marginLeft: 8, color: '#6b7280' }}>
                {previewPort ? `:${previewPort}` : activeEntry.type === 'static' ? 'static' : ''}
              </span>
            </>
          ) : 'No preview'}
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
            <IframeWithRetry key={`${activeEntryId}-${previewPort}`} port={previewPort} cacheId={activeEntryId || undefined} />
          ) : null}
          {previewPort && (
            <div className="preview-fallback" style={{ display: 'none', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6c7086', fontSize: 14, flexDirection: 'column', gap: 8, position: 'absolute', inset: 0 }}>
              <span style={{ fontSize: 28 }}>⚠️</span>
              <span>Server not available — try running the entry again</span>
            </div>
          )}
          {!previewPort && activeEntry?.type === 'static' ? (
            <div style={{ display: 'flex', height: '100%' }}>
              <div style={{ width: 260, borderRight: '1px solid #2a2a3e', overflow: 'auto', fontSize: 13, flexShrink: 0, background: '#1a1a2e' }}>
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
                              background: isSelected ? 'rgba(137, 180, 250, 0.15)' : 'transparent',
                              color: isSelected ? '#89b4fa' : '#cdd6f4',
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}
                            onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
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
              <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', background: '#16161e' }}>
                {currentFile ? (
                  <>
                    <div style={{ padding: '6px 12px', borderBottom: '1px solid #2a2a3e', fontSize: 12, color: '#8888aa', background: '#1a1a2e' }}>
                      {currentFile.path.split('/').map((part, i, arr) => (
                        <span key={i}>
                          {i > 0 && <span style={{ margin: '0 2px', color: '#555' }}>/</span>}
                          <span style={{ color: i === arr.length - 1 ? '#e0e0e0' : '#8888aa' }}>{part}</span>
                        </span>
                      ))}
                    </div>
                    {currentFile.binary ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#6b7280' }}>
                        Binary file — cannot preview
                      </div>
                    ) : (
                      <pre style={{ margin: 0, padding: 12, fontSize: 13, fontFamily: 'ui-monospace, monospace', overflow: 'auto', flex: 1, background: '#16161e', color: '#cdd6f4', lineHeight: 1.5 }}>
                        {currentFile.content}
                      </pre>
                    )}
                  </>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#6b7280' }}>
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

      {showEnvModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setShowEnvModal(false)}>
          <div style={{ background: '#1a1a2e', border: '1px solid #3a3a5e', borderRadius: 12, padding: 24, width: 600, maxWidth: '90vw', maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginTop: 0, color: '#cdd6f4' }}>.env — {selectedRepo}</h3>
            <p style={{ color: '#6b7280', fontSize: 12, margin: '0 0 12px' }}>One variable per line: <code style={{ color: '#89b4fa' }}>KEY=value</code>. Lines starting with <code style={{ color: '#6b7280' }}>#</code> are comments.</p>
            <textarea
              value={envText}
              onChange={e => setEnvText(e.target.value)}
              placeholder={"# Database\nDATABASE_URL=postgresql://...\n\n# Ports\nBACKEND_PORT=3001"}
              spellCheck={false}
              style={{
                width: '100%', minHeight: 250, background: '#16161e', border: '1px solid #3a3a5e',
                borderRadius: 8, color: '#cdd6f4', padding: '12px 14px', fontSize: 13,
                fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
                lineHeight: 1.6, resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                tabSize: 2,
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button
                onClick={() => setShowEnvModal(false)}
                style={{ background: 'transparent', color: '#6b7280', border: '1px solid #3a3a5e', borderRadius: 6, padding: '6px 16px', cursor: 'pointer', fontSize: 13 }}
              >
                Cancel
              </button>
              <button
                onClick={() => { saveEnvText(envText); setShowEnvModal(false); }}
                style={{ background: '#a6e3a1', color: '#1a1a2e', border: 'none', borderRadius: 6, padding: '6px 20px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
