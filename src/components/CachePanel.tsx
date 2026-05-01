import { CacheEntry } from '../types';

interface CachePanelProps {
  cache: CacheEntry[];
  onShowEntry: (entry: CacheEntry) => void;
  onRemoveEntry: (id: string) => void;
}

export function CachePanel({ cache, onShowEntry, onRemoveEntry }: CachePanelProps) {
  return (
    <>
      <h3>Cache ({cache.length}/10)</h3>
      {cache.map(e => (
        <div key={e.id} className="cache-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span className="cache-repo">{e.owner}/{e.repo}</span>
            <code className="cache-sha">{e.sha.slice(0, 7)}</code>
            <a
              href={`https://github.com/${e.owner}/${e.repo}/commit/${e.sha}`}
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
            <button className="btn-icon" onClick={() => onShowEntry(e)}>👁</button>
            <button className="btn-icon danger" onClick={() => onRemoveEntry(e.id)}>✕</button>
          </div>
        </div>
      ))}
    </>
  );
}
