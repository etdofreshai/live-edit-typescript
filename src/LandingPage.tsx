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
        // Sort by updated_at descending
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
    <div style={{
      minHeight: '100vh',
      background: '#1e1e2e',
      color: '#cdd6f4',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '40px 20px',
    }}>
      <div style={{ maxWidth: 800, width: '100%' }}>
        <h1 style={{
          fontSize: 42,
          fontWeight: 700,
          marginBottom: 12,
          color: '#89b4fa',
          textAlign: 'center',
        }}>
          Live Edit TypeScript
        </h1>
        <p style={{
          fontSize: 16,
          color: '#6b7280',
          textAlign: 'center',
          marginBottom: 40,
        }}>
          Browse and edit Vite + TypeScript repos from{' '}
          <a
            href="https://github.com/etdofreshai"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#89b4fa', textDecoration: 'none' }}
          >
            etdofreshai
          </a>
        </p>

        {error && (
          <div style={{
            background: '#f38ba844',
            color: '#f38ba8',
            padding: '12px 16px',
            borderRadius: 8,
            marginBottom: 20,
          }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <div className="spinner spinner-large" />
            <div style={{ color: '#6b7280', marginTop: 12 }}>Loading repositories…</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {repos.map(repo => (
              <Link
                key={repo.name}
                to={`/edit/etdofreshai/${repo.name}`}
                style={{
                  display: 'block',
                  background: '#1a1a2e',
                  border: '1px solid #3a3a5e',
                  borderRadius: 12,
                  padding: '20px 24px',
                  textDecoration: 'none',
                  color: 'inherit',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = '#89b4fa';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = '#3a3a5e';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <img
                      src={repo.owner.avatar_url}
                      alt={`${repo.name} owner`}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        border: '1px solid #3a3a5e',
                      }}
                    />
                    <h3 style={{
                      fontSize: 20,
                      fontWeight: 600,
                      margin: 0,
                      color: '#cdd6f4',
                    }}>
                      {repo.name}
                    </h3>
                  </div>
                  <div style={{
                    fontSize: 13,
                    color: '#6b7280',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}>
                    <span>⏱</span>
                    <span title={new Date(repo.updated_at).toLocaleString()}>
                      {timeAgo(repo.updated_at)}
                    </span>
                  </div>
                </div>
                {repo.description && (
                  <p style={{
                    margin: 0,
                    fontSize: 14,
                    color: '#9399b2',
                    lineHeight: 1.5,
                  }}>
                    {repo.description}
                  </p>
                )}
                <div style={{
                  marginTop: 12,
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                }}>
                  <Link
                    to={`/etdofreshai/${repo.name}/`}
                    onClick={e => e.stopPropagation()}
                    style={{
                      fontSize: 13,
                      color: '#a6e3a1',
                      fontWeight: 500,
                      textDecoration: 'none',
                      padding: '4px 12px',
                      border: '1px solid #a6e3a144',
                      borderRadius: 6,
                      transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#a6e3a122'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    ▶ Run
                  </Link>
                  <Link
                    to={`/edit/etdofreshai/${repo.name}/main/latest`}
                    onClick={e => e.stopPropagation()}
                    style={{
                      fontSize: 13,
                      color: '#89b4fa',
                      fontWeight: 500,
                      textDecoration: 'none',
                      padding: '4px 12px',
                      border: '1px solid #89b4fa44',
                      borderRadius: 6,
                      transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#89b4fa22'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    ✏️ Edit
                  </Link>
                  <a
                    href={repo.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{
                      fontSize: 13,
                      color: '#6b7280',
                      textDecoration: 'none',
                      padding: '4px 12px',
                      border: '1px solid #3a3a5e',
                      borderRadius: 6,
                      transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#3a3a5e44'; e.currentTarget.style.color = '#cdd6f4'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#6b7280'; }}
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
        <div style={{
          marginTop: 60,
          padding: '16px 20px',
          fontSize: 12,
          color: '#4a4a6a',
          textAlign: 'center',
          fontFamily: 'monospace',
          lineHeight: 1.8,
        }}>
          <a
            href={`https://github.com/${gitInfo.owner}/${gitInfo.repo}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#4a4a6a', textDecoration: 'none' }}
            onMouseEnter={e => e.currentTarget.style.color = '#89b4fa'}
            onMouseLeave={e => e.currentTarget.style.color = '#4a4a6a'}
          >{gitInfo.owner}/{gitInfo.repo}</a>
          {' · '}
          <a
            href={`https://github.com/${gitInfo.owner}/${gitInfo.repo}/tree/${gitInfo.branch}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#4a4a6a', textDecoration: 'none' }}
            onMouseEnter={e => e.currentTarget.style.color = '#89b4fa'}
            onMouseLeave={e => e.currentTarget.style.color = '#4a4a6a'}
          >{gitInfo.branch}</a>
          {' · '}
          <a
            href={`https://github.com/${gitInfo.owner}/${gitInfo.repo}/commit/${gitInfo.sha}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#4a4a6a', textDecoration: 'none' }}
            onMouseEnter={e => e.currentTarget.style.color = '#89b4fa'}
            onMouseLeave={e => e.currentTarget.style.color = '#4a4a6a'}
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
