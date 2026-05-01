import { Repo } from '../types';

interface RepoSelectorProps {
  repos: Repo[];
  selectedRepo: string;
  onSelectRepo: (name: string) => void;
}

export function RepoSelector({ repos, selectedRepo, onSelectRepo }: RepoSelectorProps) {
  return (
    <>
      <h3>Repos</h3>
      <div className="list-panel">
        <div className="list-panel-scroll">
          {repos.map((r) => (
            <div key={r.name}
              className={`list-item ${r.name === selectedRepo ? 'active' : ''}`}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              onClick={() => onSelectRepo(r.name)}>
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
    </>
  );
}
