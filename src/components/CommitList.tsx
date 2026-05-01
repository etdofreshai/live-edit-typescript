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
      <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span>Commits — {selectedRepo} / {selectedBranch}</span>
        {compareInfo && compareInfo.ahead > 0 && (
          <span style={{ fontSize: 11, background: '#89b4fa22', color: '#89b4fa', padding: '2px 8px', borderRadius: 10, fontWeight: 500 }}>
            {compareInfo.ahead} ahead
          </span>
        )}
        {compareInfo && compareInfo.ahead > 0 && !prResult && (
          <button
            onClick={onCreatePR}
            disabled={prLoading}
            style={{ fontSize: 11, background: '#a6e3a122', color: '#a6e3a1', border: '1px solid #a6e3a144', borderRadius: 6, padding: '2px 10px', cursor: 'pointer', fontWeight: 600 }}
          >
            {prLoading ? '…' : `🔀 PR → ${compareInfo.defaultBranch}`}
          </button>
        )}
        {prResult && (
          <a href={prResult.url} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 11, color: '#a6e3a1', textDecoration: 'none' }}>
            ✓ PR #{prResult.number}
          </a>
        )}
        {prError && (
          <span style={{ fontSize: 11, color: '#f38ba8' }}>{prError.slice(0, 80)}</span>
        )}
        <select
          value={startMode}
          onChange={e => onSaveStartMode(e.target.value as StartMode)}
          style={{ fontSize: 11, background: '#1a1a2e', color: '#cdd6f4', border: '1px solid #3a3a5e', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', marginLeft: 'auto' }}
        >
          <option value="vite">Vite</option>
          <option value="npm-dev">npm run dev</option>
        </select>
        <button
          onClick={onShowEnvModal}
          style={{ fontSize: 11, background: 'transparent', color: '#cdd6f4', border: '1px solid #3a3a5e', borderRadius: 6, padding: '2px 10px', cursor: 'pointer', fontWeight: 600 }}
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
            <button className="btn-run green" onClick={onRunLatest} disabled={!!loading}>
              {loading === 'latest' ? <span className="spinner" /> : '▶ Run'}
            </button>
          </div>
          {commits.map((c) => (
            <div key={c.sha} className="commit-item">
              <div className="commit-info">
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div className="commit-sha">{c.sha.slice(0, 7)}</div>
                  <a
                    href={`https://github.com/${owner}/${selectedRepo}/commit/${c.sha}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#6b7280', fontSize: 10, textDecoration: 'none' }}
                    title="View on GitHub"
                  >↗</a>
                </div>
                <div className="commit-msg">{c.commit?.message?.split('\n')[0]}</div>
                {c.commit?.author?.date && (
                  <div style={{ color: '#6b7280', fontSize: 11 }} title={new Date(c.commit.author.date).toLocaleString()}>{timeAgo(c.commit.author.date)}</div>
                )}
              </div>
              <button className="btn-run" onClick={() => onRunCommit(c.sha)} disabled={!!loading}>
                {loading === c.sha ? <span className="spinner" /> : '▶ Run'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
