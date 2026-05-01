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
import { StaticFileBrowser } from './components/StaticFileBrowser';
import { TopBar } from './components/TopBar';
import { Branch, CacheEntry, Commit, CompareInfo, PullRequestResult, Repo } from './types';

type StartMode = 'vite' | 'npm-dev';

const STORAGE_KEY = 'live-edit-state';
const DEFAULT_OWNER = 'etdofreshai';

interface PersistedState {
  selectedOwner?: string;
  selectedRepo: string;
  selectedBranch: string;
  activeEntryId: string | null;
  previewPort: number | null;
  sidebarOpen: boolean;
  // Info needed to auto-re-run after server restart
  lastRun?: { owner?: string; repo: string; sha: string; branch?: string; isLatest?: boolean } | null;
}

interface CurrentFile {
  path: string;
  content?: string;
  binary?: boolean;
}

type RunResponse = CacheEntry & { error?: string };

interface CacheFilesResponse {
  files?: string[];
  truncated?: boolean;
}

interface LogResponse {
  log?: string;
}

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

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
  const [selectedOwner, setSelectedOwner] = useState(initialOwner || saved.current.selectedOwner || DEFAULT_OWNER);
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
  const [currentFile, setCurrentFile] = useState<CurrentFile | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [restoringState, setRestoringState] = useState(true);
  const [urlUsedLatest, setUrlUsedLatest] = useState(initialCommit === 'latest');
  const [branchFrom, setBranchFrom] = useState<string | null>(null);
  const [newBranchName, setNewBranchName] = useState('');
  const [branchError, setBranchError] = useState('');
  const [compareInfo, setCompareInfo] = useState<CompareInfo | null>(null);
  const [prLoading, setPrLoading] = useState(false);
  const [prResult, setPrResult] = useState<PullRequestResult | null>(null);
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
      path += `/${selectedOwner}/${selectedRepo}`;
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
  }, [selectedOwner, selectedRepo, selectedBranch, activeEntry?.sha, restoringState, urlUsedLatest]);

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
          entry = await api<RunResponse>('/api/run-latest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              owner: initialOwner || DEFAULT_OWNER,
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
          entry = await api<RunResponse>('/api/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              owner: initialOwner || DEFAULT_OWNER,
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
      } catch (e: unknown) {
        setError(errorMessage(e));
      } finally {
        setLoading('');
      }
    };
    
    runInitialCommit();
  }, [initialOwner, initialCommit, initialRepo, initialBranch, restoringState, repos.length]);

  // Load env vars for selected repo
  useEffect(() => {
    if (selectedRepo) {
      const key = `${selectedOwner}/${selectedRepo}`;
      try {
        const stored = localStorage.getItem(`env:${key}`);
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
        const mode = localStorage.getItem(`startMode:${key}`) as StartMode;
        setStartMode(mode || 'vite');
      } catch {
        setStartMode('vite');
      }
    }
  }, [selectedOwner, selectedRepo]);

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
      localStorage.setItem(`env:${selectedOwner}/${selectedRepo}`, text);
    } catch {}
  };

  const saveStartMode = (mode: StartMode) => {
    if (!selectedRepo) return;
    setStartMode(mode);
    try {
      localStorage.setItem(`startMode:${selectedOwner}/${selectedRepo}`, mode);
    } catch {}
  };

  // Persist state on changes
  useEffect(() => {
    if (restoringState) return;
    const lastRun = activeEntry ? { owner: activeEntry.owner, repo: activeEntry.repo, sha: activeEntry.sha, branch: activeEntry.branch, isLatest: activeEntry.isLatest } : null;
    savePersistedState({ selectedOwner, selectedRepo, selectedBranch, activeEntryId, previewPort, sidebarOpen, lastRun });
  }, [selectedOwner, selectedRepo, selectedBranch, activeEntryId, previewPort, sidebarOpen, restoringState, activeEntry]);

  const showEntry = async (entry: CacheEntry) => {
    setActiveEntryId(entry.id);
    if (entry.type === 'static') {
      setPreviewPort(null);
      try {
        const result = await api<CacheFilesResponse | string[]>(`/api/cache/${entry.id}/files`);
        setFiles(Array.isArray(result) ? result : result.files ?? []);
        setFilesTruncated(!Array.isArray(result) && !!result.truncated);
      } catch {}
      setCurrentFile(null);
      setExpandedDirs(new Set());
    } else {
      setPreviewPort(entry.port);
    }
  };

  const viewFile = async (cacheId: string, filePath: string) => {
    try {
      const data = await api<CurrentFile>(`/api/cache/${cacheId}/files/${encodeURIComponent(filePath)}`);
      setCurrentFile(data);
    } catch {
      setCurrentFile({ path: filePath, binary: true });
    }
  };

  // Initial load + restore persisted state
  useEffect(() => {
    const init = async () => {
      try {
        const ownerForLoad = initialOwner || saved.current.selectedOwner || DEFAULT_OWNER;
        setSelectedOwner(ownerForLoad);
        const [repoList, cacheList] = await Promise.all([api<Repo[]>(`/api/repos/${ownerForLoad}`), api<CacheEntry[]>('/api/cache')]);
        setRepos(repoList);
        setCache(cacheList);

        const s = saved.current;
        if (s.selectedRepo) {
          const repoExists = repoList.some((r: Repo) => r.name === s.selectedRepo);
          if (repoExists) {
            const branchList = await api<Branch[]>(`/api/repos/${ownerForLoad}/${s.selectedRepo}/branches`);
            setBranches(branchList);

            if (s.selectedBranch) {
              const branchExists = branchList.some((b: Branch) => b.name === s.selectedBranch);
              if (branchExists) {
                const commitList = await api<Commit[]>(`/api/repos/${ownerForLoad}/${s.selectedRepo}/branches/${encodeURIComponent(s.selectedBranch)}/commits`);
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
                entry = await api<RunResponse>('/api/run-latest', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ owner: s.lastRun.owner || DEFAULT_OWNER, repo: s.lastRun.repo, branch: s.lastRun.branch }),
                });
              } else {
                entry = await api<RunResponse>('/api/run', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ owner: s.lastRun.owner || DEFAULT_OWNER, repo: s.lastRun.repo, sha: s.lastRun.sha }),
                });
              }
              if (entry && !entry.error) {
                setCache(await api<CacheEntry[]>('/api/cache'));
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
      } catch (e: unknown) {
        setError(errorMessage(e));
      } finally {
        setRestoringState(false);
      }
    };
    init();
  }, []);

  const loadReposForOwner = async (owner: string) => {
    const repoList = await api<Repo[]>(`/api/repos/${owner}`);
    setRepos(repoList);
    return repoList;
  };

  const refreshCache = () => api<CacheEntry[]>('/api/cache').then((newCache) => {
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
      onNavigate(`/edit/${selectedOwner}/${name}`);
    }

    try {
      const branchList = await api<Branch[]>(`/api/repos/${selectedOwner}/${name}/branches`);
      setBranches(branchList);

      // Auto-select branch: prefer one that's already running in cache, else default branch
      const cachedEntry = cache.find(e => e.owner === selectedOwner && e.repo === name);
      const cachedBranch = cachedEntry?.branch;
      const defaultBranch = branchList.find((b: Branch) => b.name === 'main')?.name
        || branchList.find((b: Branch) => b.name === 'master')?.name
        || branchList[0]?.name;
      const autoSelect = (cachedBranch && branchList.some((b: Branch) => b.name === cachedBranch))
        ? cachedBranch : defaultBranch;
      if (autoSelect) selectBranch(autoSelect);
    } catch {}
  };

  const changeOwner = async (owner: string) => {
    setSelectedOwner(owner);
    setSelectedRepo('');
    setSelectedBranch('');
    setBranches([]);
    setCommits([]);
    setCompareInfo(null);
    setPrResult(null);
    setPrError('');
    if (onNavigate) onNavigate('/edit');
    if (!owner) {
      setRepos([]);
      return;
    }
    try {
      await loadReposForOwner(owner);
    } catch (e: unknown) {
      setError(errorMessage(e));
    }
  };

  const handleCreateBranch = async (fromBranch: string, name: string) => {
    setBranchError('');
    try {
      const res = await fetch(`/api/repos/${selectedOwner}/${selectedRepo}/branches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, from: fromBranch }),
      });
      const data = await res.json();
      if (!res.ok) { setBranchError(data.error || 'Failed to create branch'); return; }
      setBranchFrom(null);
      setNewBranchName('');
      setBranches(await api<Branch[]>(`/api/repos/${selectedOwner}/${selectedRepo}/branches`));
      selectBranch(name);
    } catch (e: unknown) { setBranchError(errorMessage(e)); }
  };

  const selectBranch = async (branch: string) => {
    setSelectedBranch(branch);
    setPrResult(null);
    setPrError('');
    setCompareInfo(null);

    // Update URL when branch is selected
    if (onNavigate && selectedRepo) {
      onNavigate(`/edit/${selectedOwner}/${selectedRepo}/${branch}`);
    }

    try {
      const [commitList, cmp] = await Promise.all([
        api<Commit[]>(`/api/repos/${selectedOwner}/${selectedRepo}/branches/${encodeURIComponent(branch)}/commits`),
        api<CompareInfo & { error?: string }>(`/api/repos/${selectedOwner}/${selectedRepo}/branches/${encodeURIComponent(branch)}/compare`).catch(() => null),
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
      const res = await api<PullRequestResult>(`/api/repos/${selectedOwner}/${selectedRepo}/pulls`, {
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
    } catch (e: unknown) { setPrError(errorMessage(e)); }
    finally { setPrLoading(false); }
  };

  const run = async (sha: string) => {
    setLoading(sha); setError(''); setSidebarOpen(false); setUrlUsedLatest(false);
    try {
      const entry = await api<RunResponse>('/api/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: selectedOwner, repo: selectedRepo, sha, envVars: parseEnvText(envText), startMode }),
      });
      if (entry.error) { setError(entry.error); return; }
      await refreshCache();
      await showEntry(entry);
    } catch (e: unknown) { setError(errorMessage(e)); }
    finally { setLoading(''); }
  };

  const runLatest = async () => {
    setLoading('latest'); setError(''); setSidebarOpen(false); setUrlUsedLatest(true);
    try {
      const entry = await api<RunResponse>('/api/run-latest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: selectedOwner, repo: selectedRepo, branch: selectedBranch, envVars: parseEnvText(envText), startMode }),
      });
      if (entry.error) { setError(entry.error); return; }
      await refreshCache();
      await showEntry(entry);
    } catch (e: unknown) { setError(errorMessage(e)); }
    finally { setLoading(''); }
  };

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      es = new EventSource('/api/cache/stream');
      es.onmessage = (ev) => {
        try {
          const newCache: CacheEntry[] = JSON.parse(ev.data);
          setCache(prev => {
            const strip = (entries: CacheEntry[]) => entries.map(({ lastAccessed, ...rest }) => rest);
            const prevJson = JSON.stringify(strip(prev));
            const newJson = JSON.stringify(strip(newCache));
            return prevJson === newJson ? prev : newCache;
          });
        } catch {}
      };
      es.onerror = () => {
        es?.close();
        es = null;
        refreshCache().catch(() => {});
        reconnectTimer = setTimeout(connect, 5000);
      };
    };
    connect();

    return () => {
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
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
      const res = await api<LogResponse>(`/api/cache/${activeEntry.id}/log`);
      setLogContent(res.log || '(no log output)');
    } catch {
      setLogContent('(failed to fetch log)');
    }
  };

  return (
    <div className="app-container">
      {showHeader && (
        <TopBar
          activeEntry={activeEntry}
          previewPort={previewPort}
          sidebarOpen={sidebarOpen}
          onShowEnvModal={() => { if (activeEntry) { setSelectedOwner(activeEntry.owner); setSelectedRepo(activeEntry.repo); setShowEnvModal(true); } }}
          onShowLogModal={async () => { await refreshLog(); setShowLogModal(true); }}
          onToggleSidebar={() => setSidebarOpen(o => !o)}
          onHideHeader={() => setShowHeader(false)}
        />
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

        <RepoSelector owner={selectedOwner} repos={repos} selectedRepo={selectedRepo} onOwnerChange={changeOwner} onSelectRepo={selectRepo} />

        <BranchList
          owner={selectedOwner}
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
          owner={selectedOwner}
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
            <StaticFileBrowser
              cacheId={activeEntry.id}
              files={files}
              filesTruncated={filesTruncated}
              currentFile={currentFile}
              expandedDirs={expandedDirs}
              onSetExpandedDirs={setExpandedDirs}
              onViewFile={viewFile}
            />
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

      {showHeader && <VoiceButton context={activeEntry ? { owner: activeEntry.owner, repo: activeEntry.repo, branch: activeEntry.branch, sha: activeEntry.sha } : undefined} iframeRef={iframeRef} consoleLogs={consoleLogs} />}

      {showTranscriptModal && (
        <TranscriptHistoryModal onClose={() => setShowTranscriptModal(false)} />
      )}
    </div>
  );
}
