import { Branch } from '../types';

interface BranchListProps {
  branches: Branch[];
  selectedRepo: string;
  selectedBranch: string;
  branchFrom: string | null;
  newBranchName: string;
  branchError: string;
  onSelectBranch: (name: string) => void;
  onSetBranchFrom: (name: string | null) => void;
  onSetNewBranchName: (name: string) => void;
  onSetBranchError: (error: string) => void;
  onCreateBranch: (fromBranch: string, name: string) => void;
}

export function BranchList({
  branches,
  selectedRepo,
  selectedBranch,
  branchFrom,
  newBranchName,
  branchError,
  onSelectBranch,
  onSetBranchFrom,
  onSetNewBranchName,
  onSetBranchError,
  onCreateBranch,
}: BranchListProps) {
  if (branches.length === 0) return null;

  return (
    <>
      <h3>Branches — {selectedRepo}</h3>
      <div className="list-panel">
        <div className="list-panel-scroll">
          {branches.map((b) => (
            <div key={b.name}>
              <div
                className={`list-item ${b.name === selectedBranch ? 'active' : ''}`}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                onClick={() => onSelectBranch(b.name)}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                  <a
                    href={`https://github.com/etdofreshai/${selectedRepo}/tree/${b.name}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{ color: '#6b7280', fontSize: 11, textDecoration: 'none', padding: '0 4px' }}
                    title="View on GitHub"
                  >↗</a>
                  <button
                    onClick={(e) => { e.stopPropagation(); onSetBranchFrom(branchFrom === b.name ? null : b.name); onSetNewBranchName(`${b.name}-dev-${crypto.randomUUID().slice(0, 6)}`); onSetBranchError(''); }}
                    style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 14, padding: '0 4px', flexShrink: 0, lineHeight: 1 }}
                    title="Create branch from here"
                  >⑂</button>
                </div>
              </div>
              {branchFrom === b.name && (
                <div style={{ padding: '4px 8px 8px', display: 'flex', gap: 4, alignItems: 'center' }}>
                  <input
                    autoFocus
                    value={newBranchName}
                    onChange={e => onSetNewBranchName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && newBranchName.trim()) onCreateBranch(b.name, newBranchName.trim()); if (e.key === 'Escape') onSetBranchFrom(null); }}
                    placeholder="new-branch-name"
                    style={{ flex: 1, background: '#1a1a2e', border: '1px solid #3a3a5e', borderRadius: 4, color: '#cdd6f4', padding: '3px 6px', fontSize: 12, outline: 'none', minWidth: 0 }}
                    onClick={e => e.stopPropagation()}
                  />
                  <button
                    onClick={(e) => { e.stopPropagation(); if (newBranchName.trim()) onCreateBranch(b.name, newBranchName.trim()); }}
                    style={{ background: '#a6e3a1', color: '#1a1a2e', border: 'none', borderRadius: 4, padding: '3px 8px', fontSize: 12, cursor: 'pointer', fontWeight: 600, flexShrink: 0 }}
                  >Create</button>
                </div>
              )}
              {branchFrom === b.name && branchError && (
                <div style={{ padding: '0 8px 6px', color: '#f38ba8', fontSize: 11 }}>{branchError}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
