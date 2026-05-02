import React, { useEffect, useState, useRef, forwardRef, useCallback } from 'react';
import { api } from './api';

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
            if (cacheId && (i + 1) % 3 === 0) {
              try {
                const data = await api<{ log?: string }>(`/api/cache/${cacheId}/log`);
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
              const data = await api<{ log?: string }>(`/api/cache/${cacheId}/log`);
              if (data.log) setServerLog(data.log);
            } catch {}
          }
        }
      };
      poll();
      return () => { cancelledRef.current = true; };
    }, [port, cacheId]);

    const handleCancel = useCallback(() => {
      setCancelled(true);
      cancelledRef.current = true;
    }, []);

    const handleToggleLog = useCallback(async () => {
      setShowLog(prev => {
        if (!prev && cacheId) {
          api<{ log?: string }>(`/api/cache/${cacheId}/log`)
            .then(data => { if (data.log) setServerLog(data.log); })
            .catch(() => {});
        }
        return !prev;
      });
    }, [cacheId]);

    if (!ready) {
      return (
        <div className="iframe-retry-state" role="status" aria-live="polite">
          {cancelled ? (
            <div>Cancelled</div>
          ) : timedOut ? (
            <>
              <div className="iframe-retry-error-text" role="alert">Server failed to start</div>
              {serverLog && (
                <pre className="iframe-retry-log">{serverLog}</pre>
              )}
            </>
          ) : (
            <>
              <div className="spinner spinner-large" aria-hidden="true" />
              <div>Waiting for server on port {port}… {retryCount > 0 ? `(attempt ${retryCount}/${maxRetries})` : ''}</div>
              <div className="iframe-retry-actions">
                <button onClick={handleCancel} className="iframe-retry-btn" aria-label="Cancel waiting for server">Cancel</button>
                {cacheId && (
                  <button onClick={handleToggleLog} className="iframe-retry-btn" aria-label={showLog ? 'Hide server log' : 'Show server log'}>
                    {showLog ? 'Hide Log' : 'Show Log'}
                  </button>
                )}
              </div>
              {showLog && serverLog && (
                <pre className="iframe-retry-log iframe-retry-log--compact">{serverLog}</pre>
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
        className="iframe-retry-frame"
        title={`Preview on port ${port}`}
      />
    );
  }
);

IframeWithRetry.displayName = 'IframeWithRetry';
