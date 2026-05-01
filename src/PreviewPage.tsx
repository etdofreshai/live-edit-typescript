import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import './styles.css';

import { CacheEntry } from './types';
import { api } from './api';
import { IframeWithRetry } from './IframeWithRetry';

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
            e.repo === repo && e.sha === commit
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
