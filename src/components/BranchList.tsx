import { useCallback } from 'react';
import { Branch } from '../types';

interface BranchListProps {
  owner: string;
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
  owner,
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
  const handleFork = useCallback((branchName: string) => {
    onSetBranchFrom(branchFrom === branchName ? null : branchName);
    onSetNewBranchName(`${branchName}-dev-${crypto.randomUUID().slice(0, 6)}`);
    onSetBranchError('');
  }, [branchFrom, onSetBranchFrom, onSetNewBranchName, onSetBranchError]);

  const handleCreate = useCallback((fromBranch: string) => {
    const trimmed = newBranchName.trim();
    if (trimmed) onCreateBranch(fromBranch, trimmed);
  }, [newBranchName, onCreateBranch]);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent, branchName: string) => {
    if (e.key === 'Enter') handleCreate(branchName);
    if (e.key === 'Escape') onSetBranchFrom(null);
  }, [handleCreate, onSetBranchFrom]);

  const handleRowKeyDown = useCallback((e: React.KeyboardEvent, branchName: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelectBranch(branchName);
    }
  }, [onSelectBranch]);

  if (branches.length === 0) return null;

  return (
    <>
      <h3>Branches — {selectedRepo}</h3>
      <div className="list-panel">
        <div className="list-panel-scroll">
          {branches.map((b) => (
            <div key={b.name}>
              <div
                className={`list-item branch-row ${b.name === selectedBranch ? 'active' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => onSelectBranch(b.name)}
                onKeyDown={(e) => handleRowKeyDown(e, b.name)}>
                <span className="branch-name">{b.name}</span>
                <div className="branch-actions">
                  <a
                    href={`https://github.com/${owner}/${selectedRepo}/tree/${b.name}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="branch-link"
                    aria-label={`View ${b.name} on GitHub`}
                    title="View on GitHub"
                  >↗</a>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleFork(b.name); }}
                    className="branch-fork-btn"
                    aria-label={`Create branch from ${b.name}`}
                    title="Create branch from here"
                  >⑂</button>
                </div>
              </div>
              {branchFrom === b.name && (
                <div className="branch-form">
                  <input
                    autoFocus
                    value={newBranchName}
                    onChange={(e) => onSetNewBranchName(e.target.value)}
                    onKeyDown={(e) => handleInputKeyDown(e, b.name)}
                    placeholder="new-branch-name"
                    className="branch-form-input"
                    onClick={(e) => e.stopPropagation()}
                    aria-label="New branch name"
                  />
                  <button
                    onClick={(e) => { e.stopPropagation(); handleCreate(b.name); }}
                    className="branch-form-btn"
                  >Create</button>
                </div>
              )}
              {branchFrom === b.name && branchError && (
                <div className="branch-error">{branchError}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
