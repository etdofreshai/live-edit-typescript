import { useState } from 'react';
import { clearAdminToken, getAdminToken, setAdminToken } from '../api';
import { CacheEntry } from '../types';
import { timeAgo } from '../utils';

interface TopBarProps {
  activeEntry: CacheEntry | null | undefined;
  previewPort: number | null;
  sidebarOpen: boolean;
  onShowEnvModal: () => void;
  onShowLogModal: () => void;
  onToggleSidebar: () => void;
  onHideHeader: () => void;
}

export function TopBar({
  activeEntry,
  previewPort,
  sidebarOpen,
  onShowEnvModal,
  onShowLogModal,
  onToggleSidebar,
  onHideHeader,
}: TopBarProps) {
  const [adminToken, setAdminTokenValue] = useState(getAdminToken);

  const saveToken = () => {
    const next = window.prompt('Admin token', adminToken);
    if (next === null) return;
    setAdminToken(next);
    setAdminTokenValue(getAdminToken());
  };

  const removeToken = () => {
    clearAdminToken();
    setAdminTokenValue('');
  };

  return (
    <div className="top-bar">
      <span className={`dot ${previewPort || activeEntry?.type === 'static' ? 'green' : 'gray'}`} />
      {activeEntry ? (
        <div className="top-bar-info">
          <span className="tb-owner">
            <a className="tb-owner-link" href={`https://github.com/${activeEntry.owner}`} target="_blank" rel="noopener noreferrer">{activeEntry.owner}</a>
            <span className="tb-path-separator">/</span>
          </span>
          <span className="tb-repo">
            <a className="tb-repo-link" href={`https://github.com/${activeEntry.owner}/${activeEntry.repo}`} target="_blank" rel="noopener noreferrer">{activeEntry.repo}</a>
          </span>
          {activeEntry.branch && (
            <span className="tb-branch">
              <span className="tb-separator">@</span>
              <a className="tb-branch-link" href={`https://github.com/${activeEntry.owner}/${activeEntry.repo}/tree/${activeEntry.branch}`} target="_blank" rel="noopener noreferrer">{activeEntry.branch}</a>
            </span>
          )}
          <span className="tb-sha">
            <span className="tb-separator">·</span>
            <a className="tb-sha-link" href={`https://github.com/${activeEntry.owner}/${activeEntry.repo}/commit/${activeEntry.sha}`} target="_blank" rel="noopener noreferrer">{activeEntry.sha.slice(0, 7)}</a>
          </span>
          {activeEntry.commitDate && (
            <span className="tb-time" title={new Date(activeEntry.commitDate).toLocaleString()}>{timeAgo(activeEntry.commitDate)}</span>
          )}
          {activeEntry.commitMessage && (
            <span className="tb-msg">{activeEntry.commitMessage.slice(0, 50)}{activeEntry.commitMessage.length > 50 ? '…' : ''}</span>
          )}
          <span className="tb-port">
            {previewPort ? `:${previewPort}` : activeEntry.type === 'static' ? 'static' : ''}
          </span>
        </div>
      ) : <a className="top-bar-home-link" href="/">Live Edit TypeScript</a>}
      <div className="top-bar-controls">
        <button className={`top-bar-btn admin-token-btn ${adminToken ? 'active' : ''}`} onClick={saveToken} title={adminToken ? 'Admin token set for this tab' : 'Set admin token'} aria-label={adminToken ? 'Admin token set for this tab' : 'Set admin token'}>🔑</button>
        {adminToken && <button className="top-bar-btn admin-token-clear" onClick={removeToken} title="Clear admin token">Clear</button>}
        <button className="top-bar-btn" onClick={onShowEnvModal} title="Environment variables">⚙️ Env</button>
        <button className="top-bar-btn" onClick={onShowLogModal} title="Server log">📋 Log</button>
        <button className="top-bar-btn" onClick={onToggleSidebar} title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'} aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}>{sidebarOpen ? '✕' : '☰'}</button>
        <button className="top-bar-btn" onClick={onHideHeader} title="Hide top bar" aria-label="Hide top bar">▲</button>
      </div>
    </div>
  );
}
