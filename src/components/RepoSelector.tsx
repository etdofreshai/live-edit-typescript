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
        className="repo-owner-input"
        value={owner}
        onChange={e => onOwnerChange(e.target.value)}
        placeholder="GitHub owner"
        aria-label="GitHub owner"
      />
      <div className="list-panel">
        <div className="list-panel-scroll">
          {repos.map((r) => (
            <div key={r.name}
              className={`list-item repo-row ${r.name === selectedRepo ? 'active' : ''}`}
              onClick={() => onSelectRepo(r.name)}>
              <span className="repo-name">{r.name}</span>
              <a
                href={`https://github.com/${owner}/${r.name}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="repo-link"
                aria-label={`View ${r.name} on GitHub`}
                title="View on GitHub"
              >↗</a>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
