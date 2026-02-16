import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import './styles.css';

interface Repo {
  name: string;
  description: string | null;
  updated_at: string;
  html_url: string;
}

const api = (path: string) => fetch(path).then(r => r.json());

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const sec = Math.floor((now - then) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export default function LandingPage() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/api/repos')
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
                  <h3 style={{
                    fontSize: 20,
                    fontWeight: 600,
                    margin: 0,
                    color: '#cdd6f4',
                  }}>
                    {repo.name}
                  </h3>
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
                  gap: 12,
                  alignItems: 'center',
                }}>
                  <span style={{
                    fontSize: 13,
                    color: '#89b4fa',
                    fontWeight: 500,
                  }}>
                    Open in Editor →
                  </span>
                  <a
                    href={repo.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{
                      fontSize: 12,
                      color: '#6b7280',
                      textDecoration: 'none',
                      padding: '2px 8px',
                      border: '1px solid #3a3a5e',
                      borderRadius: 4,
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = '#cdd6f4'}
                    onMouseLeave={e => e.currentTarget.style.color = '#6b7280'}
                  >
                    View on GitHub ↗
                  </a>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
