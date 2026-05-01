import React, { useEffect, useState, useRef } from 'react';
import './styles.css';
import { VoiceButton } from './VoiceButton';
import { IframeWithRetry } from './IframeWithRetry';
import { TranscriptHistoryModal } from './TranscriptHistoryModal';
import { BranchList } from './components/BranchList';
import { CachePanel } from './components/CachePanel';
import { CommitList } from './components/CommitList';
import { EnvModal } from './components/EnvModal';
import { LogModal } from './components/LogModal';
import { RepoSelector } from './components/RepoSelector';
import { Branch, CacheEntry, Commit, Repo } from './types';

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

import { api } from './api';
import { timeAgo } from './utils';

interface EditorProps {
  initialOwner?: string;
  initialRepo?: string;
  initialBranch?: string;
  initialCommit?: string;
  onNavigate?: (path: string) => void;
}

export default function Editor({ initialOwner, initialRepo, initialBranch, initialCommit, onNavigate }: EditorProps = {}) {
  const saved = useRef(loadPersistedState());
  // If URL params are provided, don't restore preview state from localStorage
  const hasUrlParams = !!(initialRepo);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState(initialRepo || saved.current.selectedRepo || '');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState(initialBranch || saved.current.selectedBranch || '');
  const [commits, setCommits] = useState<Commit[]>([]);
  const [cache, setCache] = useState<CacheEntry[]>([]);
  const [previewPort, setPreviewPort] = useState<number | null>(hasUrlParams ? null : (saved.current.previewPort ?? null));
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(saved.current.sidebarOpen ?? true);
  const [activeEntryId, setActiveEntryId] = useState<string | null>(hasUrlParams ? null : (saved.current.activeEntryId ?? null));
  const [files, setFiles] = useState<string[]>([]);
  const [filesTruncated, setFilesTruncated] = useState(false);
  const [currentFile, setCurrentFile] = useState<{ path: string; content?: string; binary?: boolean } | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [restoringState, setRestoringState] = useState(true);
  const [urlUsedLatest, setUrlUsedLatest] = useState(initialCommit === 'latest');
  const [branchFrom, setBranchFrom] = useState<string | null>(null);
  const [newBranchName, setNewBranchName] = useState('');
  const [branchError, setBranchError] = useState('');
  const [compareInfo, setCompareInfo] = useState<{ ahead: number; behind: number; defaultBranch: string } | null>(null);
  const [prLoading, setPrLoading] = useState(false);
  const [prResult, setPrResult] = useState<{ url: string; number: number } | null>(null);
  const [prError, setPrError] = useState('');
  const [showEnvModal, setShowEnvModal] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [logContent, setLogContent] = useState('');
  const [showHeader, setShowHeader] = useState(true);
  const [envText, setEnvText] = useState('');
  const [startMode, setStartMode] = useState<StartMode>('vite');
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  const [showTranscriptModal, setShowTranscriptModal] = useState(false);
  const [transcriptCount, setTranscriptCount] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const activeEntry = cache.find(e => e.id === activeEntryId) || (previewPort ? cache.find(e => e.port === previewPort) : null);

  // Sync URL when selection changes
  const onNavigateRef = React.useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  
  useEffect(() => {
    if (!onNavigateRef.current || restoringState) return;
    
    let path = '/edit';
    if (selectedRepo) {
      path += `/etdofreshai/${selectedRepo}`;
      if (selectedBranch) {
        path += `/${selectedBranch}`;
        if (activeEntry?.sha && activeEntry.repo === selectedRepo) {
          path += `/${urlUsedLatest ? 'latest' : activeEntry.sha}`;
        }
      }
    }
    
    // Only navigate if the path actually changed
    const currentPath = window.location.pathname;
    if (!currentPath.startsWith('/edit')) return;
    
    if (currentPath !== path) {
      onNavigateRef.current(path);
    }
  }, [selectedRepo, selectedBranch, activeEntry?.sha, restoringState, urlUsedLatest]);

  // Handle initial commit from URL
  useEffect(() => {
    if (!initialCommit || !initialRepo || !initialBranch || restoringState) return;
    
    const runInitialCommit = async () => {
      // Wait for initial load to complete
      if (repos.length === 0) return;
      
      try {
        setSidebarOpen(false);
        
        let entry;
        if (initialCommit === 'latest') {
          // Run latest commit on this branch (same as clicking "▶ Latest")
          if (activeEntry?.isLatest && activeEntry.repo === initialRepo && activeEntry.branch === initialBranch) return;
          setLoading('latest');
          entry = await api('/api/run-latest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              repo: initialRepo,
              branch: initialBranch,
              envVars: parseEnvText(envText),
              startMode,
            }),
          });
        } else {
          // Run specific commit
          if (activeEntry?.sha === initialCommit) return;
          setLoading(initialCommit);
          entry = await api('/api/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              repo: initialRepo, 
              sha: initialCommit,
              envVars: parseEnvText(envText),
              startMode,
            }),
          });
        }
        
        if (entry.error) {
          setError(entry.error);
          return;
        }
        
        await refreshCache();
        await showEntry(entry);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading('');
      }
    };
    
    runInitialCommit();
  }, [initialCommit, initialRepo, initialBranch, restoringState, repos.length]);

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
      try {
        const result = await api(`/api/cache/${entry.id}/files`);
        setFiles(result.files ?? result);
        setFilesTruncated(!!result.truncated);
      } catch {}
      setCurrentFile(null);
      setExpandedDirs(new Set());
    } else {
      setPreviewPort(entry.port);
    }
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
          const repoExists = repoList.some((r: Repo) => r.name === s.selectedRepo);
          if (repoExists) {
            const branchList = await api(`/api/repos/${s.selectedRepo}/branches`);
            setBranches(branchList);

            if (s.selectedBranch) {
              const branchExists = branchList.some((b: Branch) => b.name === s.selectedBranch);
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
        // Skip restore when URL params are provided (URL is source of truth)
        if (s.activeEntryId && !hasUrlParams) {
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

  const refreshCache = () => api('/api/cache').then((newCache: CacheEntry[]) => {
    setCache(prev => {
      // Compare ignoring volatile fields (lastAccessed changes on every request)
      const strip = (entries: CacheEntry[]) => entries.map(({ lastAccessed, ...rest }) => rest);
      const prevJson = JSON.stringify(strip(prev));
      const newJson = JSON.stringify(strip(newCache));
      return prevJson === newJson ? prev : newCache;
    });
  });

  const selectRepo = async (name: string) => {
    setSelectedRepo(name); setSelectedBranch(''); setCommits([]);

    // Update URL immediately when repo is selected
    if (onNavigate) {
      onNavigate(`/edit/etdofreshai/${name}`);
    }

    try {
      const branchList = await api(`/api/repos/${name}/branches`);
      setBranches(branchList);

      // Auto-select branch: prefer one that's already running in cache, else default branch
      const cachedEntry = cache.find(e => e.repo === name);
      const cachedBranch = cachedEntry?.branch;
      const defaultBranch = branchList.find((b: Branch) => b.name === 'main')?.name
        || branchList.find((b: Branch) => b.name === 'master')?.name
        || branchList[0]?.name;
      const autoSelect = (cachedBranch && branchList.some((b: Branch) => b.name === cachedBranch))
        ? cachedBranch : defaultBranch;
      if (autoSelect) selectBranch(autoSelect);
    } catch {}
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

    // Update URL when branch is selected
    if (onNavigate && selectedRepo) {
      onNavigate(`/edit/etdofreshai/${selectedRepo}/${branch}`);
    }

    try {
      const [commitList, cmp] = await Promise.all([
        api(`/api/repos/${selectedRepo}/branches/${encodeURIComponent(branch)}/commits`),
        api(`/api/repos/${selectedRepo}/branches/${encodeURIComponent(branch)}/compare`).catch(() => null),
      ]);
      setCommits(commitList);
      if (cmp && !cmp.error) setCompareInfo(cmp);
    } catch {}
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
    setLoading(sha); setError(''); setSidebarOpen(false); setUrlUsedLatest(false);
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
    setLoading('latest'); setError(''); setSidebarOpen(false); setUrlUsedLatest(true);
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
    const interval = setInterval(() => { refreshCache().catch(() => {}); }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Poll transcript count for sidebar badge
  useEffect(() => {
    const fetchCount = async () => {
      try {
        const res = await fetch('/api/transcript-history');
        if (res.ok) {
          const data = await res.json();
          setTranscriptCount(Array.isArray(data) ? data.length : 0);
        }
      } catch {}
    };
    fetchCount();
    const interval = setInterval(fetchCount, 10000);
    return () => clearInterval(interval);
  }, []);

  // Console log interception for preview iframe
  useEffect(() => {
    if (!iframeRef.current || !previewPort) return;

    const iframe = iframeRef.current;
    const buffer: string[] = [];
    
    const setupConsoleInterception = () => {
      try {
        const iframeWindow = iframe.contentWindow as (Window & typeof globalThis) | null;
        if (!iframeWindow) return;
        const iframeConsole = (iframeWindow as Window & typeof globalThis).console;

        const originalConsole = {
          log: iframeConsole.log,
          warn: iframeConsole.warn,
          error: iframeConsole.error,
        };

        const addToBuffer = (level: string, args: any[]) => {
          const timestamp = new Date().toLocaleTimeString();
          const message = `[${timestamp}] [${level}] ${args.map(arg => 
            typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
          ).join(' ')}`;
          buffer.push(message);
          if (buffer.length > 30) buffer.shift();
          setConsoleLogs([...buffer]);
        };

        iframeConsole.log = function(...args: any[]) {
          addToBuffer('log', args);
          originalConsole.log.apply(this, args);
        };

        iframeConsole.warn = function(...args: any[]) {
          addToBuffer('warn', args);
          originalConsole.warn.apply(this, args);
        };

        iframeConsole.error = function(...args: any[]) {
          addToBuffer('error', args);
          originalConsole.error.apply(this, args);
        };
      } catch (e) {
        // Cross-origin iframe - can't access contentWindow
        console.warn('Cannot intercept console logs: cross-origin iframe');
      }
    };

    // Wait for iframe to load before setting up interception
    const onLoad = () => setupConsoleInterception();
    iframe.addEventListener('load', onLoad);
    
    // Also try immediately in case it's already loaded
    setupConsoleInterception();

    return () => {
      iframe.removeEventListener('load', onLoad);
    };
  }, [previewPort]); // eslint-disable-line -- iframeRef is stable

  const remove = async (id: string) => {
    try { await api(`/api/cache/${id}`, { method: 'DELETE' }); } catch {}
    refreshCache().catch(() => {});
  };

  const refreshLog = async () => {
    if (!activeEntry) return;
    try {
      const res = await api(`/api/cache/${activeEntry.id}/log`);
      setLogContent(res.log || '(no log output)');
    } catch {
      setLogContent('(failed to fetch log)');
    }
  };

  return (
    <div className="app-container">
      {showHeader && (
        <div className="top-bar">
          <span className={`dot ${previewPort || activeEntry?.type === 'static' ? 'green' : 'gray'}`} />
          {activeEntry ? (
            <div className="top-bar-info">
              <span className="tb-owner">
                <a href="https://github.com/etdofreshai" target="_blank" rel="noopener noreferrer" style={{ color: '#6b7280', textDecoration: 'none' }}>etdofreshai</a>
                <span style={{ color: '#555', margin: '0 2px' }}>/</span>
              </span>
              <span className="tb-repo">
                <a href={`https://github.com/etdofreshai/${activeEntry.repo}`} target="_blank" rel="noopener noreferrer" style={{ color: '#cdd6f4', textDecoration: 'none' }}>etdofreshai/{activeEntry.repo}</a>
              </span>
              {activeEntry.branch && (
                <span className="tb-branch">
                  <span style={{ color: '#555', margin: '0 4px' }}>@</span>
                  <a href={`https://github.com/etdofreshai/${activeEntry.repo}/tree/${activeEntry.branch}`} target="_blank" rel="noopener noreferrer" style={{ color: '#a6e3a1', textDecoration: 'none' }}>{activeEntry.branch}</a>
                </span>
              )}
              <span className="tb-sha">
                <span style={{ color: '#555', margin: '0 4px' }}>·</span>
                <a href={`https://github.com/etdofreshai/${activeEntry.repo}/commit/${activeEntry.sha}`} target="_blank" rel="noopener noreferrer" style={{ color: '#89b4fa', fontFamily: 'monospace', textDecoration: 'none' }}>{activeEntry.sha.slice(0, 7)}</a>
              </span>
              {activeEntry.commitDate && (
                <span className="tb-time" title={new Date(activeEntry.commitDate).toLocaleString()}>{timeAgo(activeEntry.commitDate)}</span>
              )}
              {activeEntry.commitMessage && (
                <span className="tb-msg" style={{ color: '#cdd6f4' }}>{activeEntry.commitMessage.slice(0, 50)}{activeEntry.commitMessage.length > 50 ? '…' : ''}</span>
              )}
              <span className="tb-port" style={{ color: '#6b7280', marginLeft: 4 }}>
                {previewPort ? `:${previewPort}` : activeEntry.type === 'static' ? 'static' : ''}
              </span>
            </div>
          ) : <a href="/" style={{ color: 'inherit', textDecoration: 'none' }}>Live Edit TypeScript</a>}
          <div className="top-bar-controls">
            <button className="top-bar-btn" onClick={() => { if (activeEntry) { setSelectedRepo(activeEntry.repo); setShowEnvModal(true); } }} title="Environment variables">⚙️ Env</button>
            <button className="top-bar-btn" onClick={async () => {
              await refreshLog();
              setShowLogModal(true);
            }} title="Server log">📋 Log</button>
            <button className="top-bar-btn" onClick={() => setSidebarOpen(o => !o)} title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}>{sidebarOpen ? '✕' : '☰'}</button>
            <button className="top-bar-btn" onClick={() => setShowHeader(false)} title="Hide top bar">▲</button>
          </div>
        </div>
      )}
      {!showHeader && (
        <button
          onClick={() => setShowHeader(true)}
          style={{ position: 'fixed', top: 6, right: 6, zIndex: 200, background: 'rgba(26,26,46,0.85)', color: '#6b7280', border: '1px solid #3a3a5e', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 12 }}
          title="Show top bar"
        >▼</button>
      )}

      <div className="main-content">
      <div className={`sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
        <h2><a href="/" style={{ color: 'inherit', textDecoration: 'none' }}>Live Edit TypeScript</a></h2>
        {error && <div className="error-banner">{error}</div>}

        <RepoSelector repos={repos} selectedRepo={selectedRepo} onSelectRepo={selectRepo} />

        <BranchList
          branches={branches}
          selectedRepo={selectedRepo}
          selectedBranch={selectedBranch}
          branchFrom={branchFrom}
          newBranchName={newBranchName}
          branchError={branchError}
          onSelectBranch={selectBranch}
          onSetBranchFrom={setBranchFrom}
          onSetNewBranchName={setNewBranchName}
          onSetBranchError={setBranchError}
          onCreateBranch={handleCreateBranch}
        />

        <CommitList
          commits={commits}
          selectedRepo={selectedRepo}
          selectedBranch={selectedBranch}
          compareInfo={compareInfo}
          prLoading={prLoading}
          prResult={prResult}
          prError={prError}
          startMode={startMode}
          loading={loading}
          onCreatePR={handleCreatePR}
          onSaveStartMode={saveStartMode}
          onShowEnvModal={() => setShowEnvModal(true)}
          onRunLatest={runLatest}
          onRunCommit={run}
        />

        <h3>Transcript History</h3>
        <button
          className="transcript-history-btn"
          onClick={() => setShowTranscriptModal(true)}
        >
          📜 Voice conversations
          {transcriptCount > 0 && (
            <span className="th-badge">{transcriptCount}</span>
          )}
        </button>

        <CachePanel cache={cache} onShowEntry={showEntry} onRemoveEntry={remove} />
      </div>

      <div className="preview-area">
        <div className="preview-body" style={{ position: 'relative' }}>
          {loading && (
            <div className="loading-overlay">
              <span className="spinner spinner-large" />
              <div className="loading-text loading-pulse">
                {activeEntry?.type === 'static' ? 'Cloning repository…' : 'Starting server… this may take a minute'}
              </div>
            </div>
          )}
          {previewPort ? (
            <IframeWithRetry ref={iframeRef} key={`${activeEntryId}-${previewPort}`} port={previewPort} cacheId={activeEntryId || undefined} />
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
                {filesTruncated && (
                  <div style={{ padding: '4px 8px', fontSize: 11, color: '#f9e2af', borderTop: '1px solid #2a2a3e' }}>
                    Results truncated — too many files
                  </div>
                )}
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
      </div>{/* close main-content */}

      {showEnvModal && (
        <EnvModal
          selectedRepo={selectedRepo}
          envText={envText}
          onChangeEnvText={setEnvText}
          onSave={() => { saveEnvText(envText); setShowEnvModal(false); }}
          onClose={() => setShowEnvModal(false)}
        />
      )}

      {showLogModal && (
        <LogModal
          logContent={logContent}
          onRefresh={refreshLog}
          onClose={() => setShowLogModal(false)}
        />
      )}

      {showHeader && <VoiceButton context={activeEntry ? { owner: 'etdofreshai', repo: activeEntry.repo, branch: activeEntry.branch, sha: activeEntry.sha } : undefined} iframeRef={iframeRef} consoleLogs={consoleLogs} />}

      {showTranscriptModal && (
        <TranscriptHistoryModal onClose={() => setShowTranscriptModal(false)} />
      )}
    </div>
  );
}
