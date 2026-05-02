import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import './styles.css';

import { CacheEntry } from './types';
import { api } from './api';
import { IframeWithRetry } from './IframeWithRetry';

const DEFAULT_OWNER = 'etdofreshai';
type RunResponse = CacheEntry & { error?: string };

export default function PreviewPage() {
  const { owner, repo, branch, commit } = useParams<{
    owner?: string;
    repo: string;
    branch?: string;
    commit?: string;
  }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [entry, setEntry] = useState<CacheEntry | null>(null);

  useEffect(() => {
    const loadPreview = async () => {
      const resolvedOwner = owner || DEFAULT_OWNER;
      if (!repo) {
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
          const newEntry = await api<RunResponse>('/api/run-latest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              repo,
              owner: resolvedOwner,
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
          const cache = await api<CacheEntry[]>('/api/cache');
          const existing = cache.find((e: CacheEntry) =>
            e.owner === resolvedOwner && e.repo === repo && e.sha === commit
          );

          if (existing) {
            setEntry(existing);
            setLoading(false);
            return;
          }

          const newEntry = await api<RunResponse>('/api/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              repo,
              owner: resolvedOwner,
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
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    };

    loadPreview();
  }, [owner, repo, branch, commit]);

  if (loading) {
    return (
      <div className="preview-page-state" role="status" aria-live="polite">
        <div className="spinner spinner-large" />
        <div>Loading preview…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="preview-page-state preview-page-state--error" role="alert">
        <div className="preview-page-error-icon" aria-hidden="true">⚠</div>
        <div>{error}</div>
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="preview-page-state" role="status">
        No preview available
      </div>
    );
  }

  return (
    <main className="preview-page-shell" aria-label="Preview">
      {entry.type === 'static' ? (
        <div className="preview-page-state preview-page-state--embedded" role="status">
          This is a static repository (no Vite dev server)
        </div>
      ) : (
        <IframeWithRetry port={entry.port} cacheId={entry.id} />
      )}
    </main>
  );
}
