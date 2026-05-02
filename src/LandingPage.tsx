import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import './styles.css';

interface Repo {
  name: string;
  description: string | null;
  updated_at: string;
  html_url: string;
  owner: {
    avatar_url: string;
  };
}

import { api } from './api';
import { timeAgo } from './utils';

interface GitInfo {
  owner: string;
  repo: string;
  branch: string;
  sha: string;
  date: string;
}

export default function LandingPage() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);

  useEffect(() => {
    api<GitInfo>('/api/info').then(setGitInfo).catch(() => {});
    api<Repo[]>('/api/repos')
      .then(repoList => {
        const sorted = [...repoList].sort((a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        );
        setRepos(sorted);
        setLoading(false);
      })
      .catch(e => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  return (
    <div className="lp-container">
      <div className="lp-inner">
        <h1 className="lp-title">
          Live Edit TypeScript
        </h1>
        <p className="lp-subtitle">
          Browse and edit Vite + TypeScript repos from{' '}
          <a
            href="https://github.com/etdofreshai"
            target="_blank"
            rel="noopener noreferrer"
            className="lp-link"
          >
            etdofreshai
          </a>
        </p>

        {error && (
          <div className="lp-error">
            {error}
          </div>
        )}

        {loading ? (
          <div className="lp-loading">
            <div className="spinner spinner-large" />
            <div className="lp-loading-text">Loading repositories…</div>
          </div>
        ) : (
          <div className="lp-repo-list">
            {repos.map(repo => (
              <Link
                key={repo.name}
                to={`/edit/etdofreshai/${repo.name}`}
                className="lp-repo-card"
              >
                <div className="lp-repo-header">
                  <div className="lp-repo-name-row">
                    <img
                      src={repo.owner.avatar_url}
                      alt={`${repo.name} owner`}
                      className="lp-repo-avatar"
                    />
                    <h3 className="lp-repo-name">
                      {repo.name}
                    </h3>
                  </div>
                  <div className="lp-repo-time">
                    <span>⏱</span>
                    <span title={new Date(repo.updated_at).toLocaleString()}>
                      {timeAgo(repo.updated_at)}
                    </span>
                  </div>
                </div>
                {repo.description && (
                  <p className="lp-repo-desc">
                    {repo.description}
                  </p>
                )}
                <div className="lp-repo-actions">
                  <Link
                    to={`/etdofreshai/${repo.name}/`}
                    onClick={e => e.stopPropagation()}
                    className="lp-btn-action lp-btn-run"
                  >
                    ▶ Run
                  </Link>
                  <Link
                    to={`/edit/etdofreshai/${repo.name}/main/latest`}
                    onClick={e => e.stopPropagation()}
                    className="lp-btn-action lp-btn-edit"
                  >
                    ✏️ Edit
                  </Link>
                  <a
                    href={repo.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="lp-btn-action lp-btn-github"
                    aria-label="View repository on GitHub"
                  >
                    GitHub ↗
                  </a>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {gitInfo && (
        <div className="lp-git-info">
          <a
            href={`https://github.com/${gitInfo.owner}/${gitInfo.repo}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${gitInfo.owner}/${gitInfo.repo} repository`}
          >{gitInfo.owner}/{gitInfo.repo}</a>
          {' · '}
          <a
            href={`https://github.com/${gitInfo.owner}/${gitInfo.repo}/tree/${gitInfo.branch}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${gitInfo.branch} branch`}
          >{gitInfo.branch}</a>
          {' · '}
          <a
            href={`https://github.com/${gitInfo.owner}/${gitInfo.repo}/commit/${gitInfo.sha}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Commit ${gitInfo.sha.slice(0, 7)}`}
          >
            {gitInfo.sha.slice(0, 7)}
          </a>
          {' · '}
          <span>{new Date(gitInfo.date).toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}
