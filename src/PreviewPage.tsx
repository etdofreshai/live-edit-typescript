import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import './styles.css';

interface CacheEntry {
  id: string;
  owner: string;
  repo: string;
  sha: string;
  port: number;
  lastAccessed: number;
  branch?: string;
  isLatest?: boolean;
  commitMessage?: string;
  commitDate?: string;
  type?: 'vite' | 'static';
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
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: '#6b7280',
        gap: 12,
        padding: 20,
        background: '#1e1e2e',
      }}>
        {cancelled ? (
          <div>Cancelled</div>
        ) : timedOut ? (
          <>
            <div style={{ color: '#f38ba8', fontSize: 16 }}>⚠ Server failed to start</div>
            {serverLog && (
              <pre style={{
                maxWidth: '90%',
                maxHeight: 300,
                overflow: 'auto',
                background: '#16161e',
                color: '#cdd6f4',
                padding: 12,
                borderRadius: 6,
                fontSize: 12,
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                textAlign: 'left',
                width: '100%',
              }}>
                {serverLog}
              </pre>
            )}
          </>
        ) : (
          <>
            <div className="spinner" />
            <div>Starting server… {retryCount > 0 ? `(attempt ${retryCount}/${maxRetries})` : ''}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => { setCancelled(true); cancelledRef.current = true; }}
                style={{
                  padding: '4px 16px',
                  background: 'transparent',
                  border: '1px solid #555',
                  borderRadius: 6,
                  color: '#999',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                Cancel
              </button>
              {cacheId && (
                <button
                  onClick={async () => {
                    setShowLog(!showLog);
                    if (!showLog && cacheId) {
                      try {
                        const d = await fetch(`/api/cache/${cacheId}/log`).then(r => r.json());
                        if (d.log) setServerLog(d.log);
                      } catch {}
                    }
                  }}
                  style={{
                    padding: '4px 16px',
                    background: 'transparent',
                    border: '1px solid #555',
                    borderRadius: 6,
                    color: '#999',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  {showLog ? 'Hide Log' : 'Show Log'}
                </button>
              )}
            </div>
            {showLog && serverLog && (
              <pre style={{
                maxWidth: '90%',
                maxHeight: 200,
                overflow: 'auto',
                background: '#16161e',
                color: '#cdd6f4',
                padding: 12,
                borderRadius: 6,
                fontSize: 12,
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                textAlign: 'left',
                width: '100%',
              }}>
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
      style={{
        width: '100%',
        height: '100%',
        border: 'none',
        background: '#1a1a2e',
      }}
    />
  );
}

export default function PreviewPage() {
  const { owner, repo, branch, commit } = useParams<{
    owner: string;
    repo: string;
    branch?: string;
    commit?: string;
  }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [entry, setEntry] = useState<CacheEntry | null>(null);

  useEffect(() => {
    const loadPreview = async () => {
      if (!owner || !repo) {
        setError('Missing repository information');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError('');

        let targetBranch = branch || 'main';
        const isLatest = !commit || commit === 'latest';

        if (isLatest) {
          // Use run-latest for auto-refreshing tracking
          const newEntry = await api('/api/run-latest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              owner,
              repo,
              branch: targetBranch,
              envVars: {},
              startMode: 'vite',
            }),
          });

          if (newEntry.error) {
            setError(newEntry.error);
            setLoading(false);
            return;
          }

          setEntry(newEntry);
          setLoading(false);
        } else {
          // Specific commit
          const cache = await api('/api/cache');
          const existing = cache.find((e: CacheEntry) =>
            e.owner === owner && e.repo === repo && e.sha === commit
          );

          if (existing) {
            setEntry(existing);
            setLoading(false);
            return;
          }

          const newEntry = await api('/api/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              owner,
              repo,
              sha: commit,
              envVars: {},
              startMode: 'vite',
            }),
          });

          if (newEntry.error) {
            setError(newEntry.error);
            setLoading(false);
            return;
          }

          setEntry(newEntry);
          setLoading(false);
        }
      } catch (e: any) {
        setError(e.message);
        setLoading(false);
      }
    };

    loadPreview();
  }, [owner, repo, branch, commit]);

  if (loading) {
    return (
      <div style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#1e1e2e',
        color: '#6b7280',
        flexDirection: 'column',
        gap: 12,
      }}>
        <div className="spinner spinner-large" />
        <div>Loading preview…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#1e1e2e',
        color: '#f38ba8',
        flexDirection: 'column',
        gap: 12,
      }}>
        <div style={{ fontSize: 24 }}>⚠</div>
        <div>{error}</div>
      </div>
    );
  }

  if (!entry) {
    return (
      <div style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#1e1e2e',
        color: '#6b7280',
      }}>
        No preview available
      </div>
    );
  }

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      {entry.type === 'static' ? (
        <div style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#1e1e2e',
          color: '#6b7280',
        }}>
          This is a static repository (no Vite dev server)
        </div>
      ) : (
        <IframeWithRetry port={entry.port} cacheId={entry.id} />
      )}
    </div>
  );
}
