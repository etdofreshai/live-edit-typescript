import { Commit, CompareInfo, PullRequestResult } from '../types';
import { timeAgo } from '../utils';

type StartMode = 'vite' | 'npm-dev';

interface CommitListProps {
  owner: string;
  commits: Commit[];
  selectedRepo: string;
  selectedBranch: string;
  compareInfo: CompareInfo | null;
  prLoading: boolean;
  prResult: PullRequestResult | null;
  prError: string;
  startMode: StartMode;
  loading: string;
  onCreatePR: () => void;
  onSaveStartMode: (mode: StartMode) => void;
  onShowEnvModal: () => void;
  onRunLatest: () => void;
  onRunCommit: (sha: string) => void;
}

export function CommitList({
  owner,
  commits,
  selectedRepo,
  selectedBranch,
  compareInfo,
  prLoading,
  prResult,
  prError,
  startMode,
  loading,
  onCreatePR,
  onSaveStartMode,
  onShowEnvModal,
  onRunLatest,
  onRunCommit,
}: CommitListProps) {
  if (commits.length === 0) return null;

  return (
    <>
      <h3 className="commit-list-header">
        <span>Commits — {selectedRepo} / {selectedBranch}</span>
        {compareInfo && compareInfo.ahead > 0 && (
          <span className="commit-ahead-badge">
            {compareInfo.ahead} ahead
          </span>
        )}
        {compareInfo && compareInfo.ahead > 0 && !prResult && (
          <button
            onClick={onCreatePR}
            disabled={prLoading}
            className="commit-pr-btn"
            aria-label={`Create pull request into ${compareInfo.defaultBranch}`}
          >
            {prLoading ? '…' : `🔀 PR → ${compareInfo.defaultBranch}`}
          </button>
        )}
        {prResult && (
          <a href={prResult.url} target="_blank" rel="noopener noreferrer" className="commit-pr-link">
            ✓ PR #{prResult.number}
          </a>
        )}
        {prError && (
          <span className="commit-pr-error">{prError.slice(0, 80)}</span>
        )}
        <select
          value={startMode}
          onChange={e => onSaveStartMode(e.target.value as StartMode)}
          className="commit-start-mode-select"
          aria-label="Start mode"
        >
          <option value="vite">Vite</option>
          <option value="npm-dev">npm run dev</option>
        </select>
        <button
          onClick={onShowEnvModal}
          className="commit-env-btn"
        >
          ⚙️ Env
        </button>
      </h3>
      <div className="list-panel">
        <div className="list-panel-scroll tall">
          <div className="latest-entry">
            <div className="commit-info">
              <div className="latest-label">▶ Latest</div>
              <div className="latest-desc">Track {selectedBranch} — auto-updates on new commits</div>
            </div>
            <button className="btn-run green" onClick={onRunLatest} disabled={!!loading} aria-label="Run latest commit">
              {loading === 'latest' ? <span className="spinner" /> : '▶ Run'}
            </button>
          </div>
          {commits.map((c) => (
            <div key={c.sha} className="commit-item">
              <div className="commit-info">
                <div className="commit-meta-row">
                  <div className="commit-sha">{c.sha.slice(0, 7)}</div>
                  <a
                    href={`https://github.com/${owner}/${selectedRepo}/commit/${c.sha}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="commit-link"
                    aria-label={`View commit ${c.sha.slice(0, 7)} on GitHub`}
                    title="View on GitHub"
                  >↗</a>
                </div>
                <div className="commit-msg">{c.commit?.message?.split('\n')[0]}</div>
                {c.commit?.author?.date && (
                  <div className="commit-date" title={new Date(c.commit.author.date).toLocaleString()}>{timeAgo(c.commit.author.date)}</div>
                )}
              </div>
              <button className="btn-run" onClick={() => onRunCommit(c.sha)} disabled={!!loading} aria-label={`Run commit ${c.sha.slice(0, 7)}`}>
                {loading === c.sha ? <span className="spinner" /> : '▶ Run'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
