import React, { useEffect, useState, useRef, forwardRef } from 'react';

interface IframeWithRetryProps {
  port: number;
  cacheId?: string;
}

export const IframeWithRetry = forwardRef<HTMLIFrameElement, IframeWithRetryProps>(
  ({ port, cacheId }, ref) => {
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
            // Fetch server log every 3 attempts
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
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6b7280', gap: 12, padding: 20, background: '#1e1e2e' }}>
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
        ref={ref}
        src={`/proxy/${port}/`}
        style={{ width: '100%', height: '100%', border: 'none', background: '#1a1a2e' }}
      />
    );
  }
);

IframeWithRetry.displayName = 'IframeWithRetry';
