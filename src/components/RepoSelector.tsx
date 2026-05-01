import { Repo } from '../types';

interface RepoSelectorProps {
  owner: string;
  repos: Repo[];
  selectedRepo: string;
  onOwnerChange: (owner: string) => void;
  onSelectRepo: (name: string) => void;
}

export function RepoSelector({ owner, repos, selectedRepo, onOwnerChange, onSelectRepo }: RepoSelectorProps) {
  return (
    <>
      <h3>Repos</h3>
      <input
        value={owner}
        onChange={e => onOwnerChange(e.target.value)}
        placeholder="GitHub owner"
        style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8, background: '#1a1a2e', border: '1px solid #3a3a5e', borderRadius: 6, color: '#cdd6f4', padding: '6px 8px', fontSize: 13, outline: 'none' }}
      />
      <div className="list-panel">
        <div className="list-panel-scroll">
          {repos.map((r) => (
            <div key={r.name}
              className={`list-item ${r.name === selectedRepo ? 'active' : ''}`}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              onClick={() => onSelectRepo(r.name)}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
              <a
                href={`https://github.com/${owner}/${r.name}`}
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
    </>
  );
}
