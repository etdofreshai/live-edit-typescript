import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from './api';

export interface TranscriptEntry {
  id: string;
  timestamp: number;
  userText: string;
  screenshot?: boolean;
  consoleLogs?: number;
  response?: string;
  status: 'pending' | 'complete' | 'error';
}

interface TranscriptHistoryModalProps {
  onClose: () => void;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function isSameDay(a: number, b: number): boolean {
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

export function TranscriptHistoryModal({ onClose }: TranscriptHistoryModalProps) {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const firstLoadRef = useRef(true);

  const fetchHistory = async () => {
    try {
      const res = await apiFetch(`${import.meta.env.BASE_URL}api/transcript-history`);
      if (res.ok) {
        const data: TranscriptEntry[] = await res.json();
        setEntries(data);
      }
    } catch {}
  };

  useEffect(() => {
    fetchHistory();
    const iv = setInterval(fetchHistory, 3000);
    return () => clearInterval(iv);
  }, []);

  // Scroll to bottom on first load and when new entries arrive (if already at bottom)
  useEffect(() => {
    if (!bottomRef.current) return;
    if (firstLoadRef.current || isAtBottom) {
      bottomRef.current.scrollIntoView({ behavior: firstLoadRef.current ? 'auto' : 'smooth' });
      firstLoadRef.current = false;
    }
  }, [entries]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setIsAtBottom(atBottom);
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.75)',
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#1e1e2e',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '100vh',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 20px',
          borderBottom: '1px solid #313244',
          background: '#181825',
          flexShrink: 0,
        }}>
          <h2 style={{ margin: 0, color: '#cdd6f4', fontSize: 16, fontWeight: 600 }}>
            📜 Transcript History
            {entries.length > 0 && (
              <span style={{
                marginLeft: 8, fontSize: 11, background: '#313244',
                color: '#a6adc8', borderRadius: 10, padding: '1px 8px', fontWeight: 500,
              }}>
                {entries.length}
              </span>
            )}
          </h2>
          <button
            onClick={onClose}
            title="Close (Esc)"
            style={{
              background: 'none', border: 'none', color: '#6c7086',
              cursor: 'pointer', fontSize: 20, padding: '0 4px',
              lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 4, transition: 'color 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = '#cdd6f4')}
            onMouseLeave={e => (e.currentTarget.style.color = '#6c7086')}
          >✕</button>
        </div>

        {/* Chat area */}
        <div
          ref={scrollRef}
          style={{
            flex: 1, overflowY: 'auto', padding: '16px 20px',
            display: 'flex', flexDirection: 'column', gap: 0,
          }}
          onScroll={handleScroll}
        >
          {entries.length === 0 ? (
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#6c7086', fontSize: 14, textAlign: 'center', marginTop: '20vh',
            }}>
              <div>
                <div style={{ fontSize: 32, marginBottom: 12 }}>🎙️</div>
                <div>No transcripts yet.</div>
                <div style={{ fontSize: 12, marginTop: 4, color: '#45475a' }}>Record something with the voice button!</div>
              </div>
            </div>
          ) : (
            entries.map((entry, i) => {
              const prevEntry = i > 0 ? entries[i - 1] : null;
              const showDateSep = !prevEntry || !isSameDay(prevEntry.timestamp, entry.timestamp);
              return (
                <div key={entry.id}>
                  {/* Date separator */}
                  {showDateSep && (
                    <div style={{
                      textAlign: 'center', margin: '16px 0 12px',
                      fontSize: 11, color: '#45475a',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      <div style={{ flex: 1, height: 1, background: '#2a2a3d' }} />
                      {formatDate(entry.timestamp)}
                      <div style={{ flex: 1, height: 1, background: '#2a2a3d' }} />
                    </div>
                  )}

                  {/* Conversation bubble group */}
                  <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {/* User message — right side */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end', gap: 8 }}>
                      <div style={{ maxWidth: '68%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                        <div style={{ fontSize: 10, color: '#45475a' }}>
                          {formatTime(entry.timestamp)}
                          {entry.consoleLogs ? ` · ${entry.consoleLogs} log${entry.consoleLogs !== 1 ? 's' : ''}` : ''}
                        </div>
                        <div style={{
                          background: '#313244', color: '#cdd6f4',
                          borderRadius: '12px 12px 2px 12px',
                          padding: '8px 12px', fontSize: 13, lineHeight: 1.5,
                          wordBreak: 'break-word',
                        }}>
                          {entry.userText}
                        </div>
                        {entry.screenshot && (
                          <div style={{
                            fontSize: 10, color: '#89b4fa',
                            display: 'flex', alignItems: 'center', gap: 4,
                          }}>
                            📸 Screenshot attached
                          </div>
                        )}
                        {/* Status badge */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          {entry.status === 'pending' && (
                            <span style={{ fontSize: 10, color: '#6c7086', display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span style={{
                                display: 'inline-block', width: 8, height: 8,
                                border: '1.5px solid #45475a', borderTopColor: '#89b4fa',
                                borderRadius: '50%', animation: 'spin 0.6s linear infinite',
                              }} />
                              sending…
                            </span>
                          )}
                          {entry.status === 'complete' && (
                            <span style={{ fontSize: 10, color: '#a6e3a1' }}>✓ sent</span>
                          )}
                          {entry.status === 'error' && (
                            <span style={{ fontSize: 10, color: '#f38ba8' }}>✕ failed</span>
                          )}
                        </div>
                      </div>
                      {/* User avatar */}
                      <div style={{
                        width: 28, height: 28, borderRadius: '50%',
                        background: '#45475a', display: 'flex', alignItems: 'center',
                        justifyContent: 'center', fontSize: 14, flexShrink: 0,
                      }}>🎙️</div>
                    </div>

                    {/* Response — left side */}
                    <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'flex-end', gap: 8 }}>
                      {/* Bot avatar */}
                      <div style={{
                        width: 28, height: 28, borderRadius: '50%',
                        background: '#1e1e2e', border: '1px solid #313244',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 14, flexShrink: 0,
                      }}>🤖</div>
                      <div style={{ maxWidth: '68%' }}>
                        {entry.status === 'pending' ? (
                          <div style={{
                            background: '#232336', color: '#6c7086',
                            borderRadius: '12px 12px 12px 2px',
                            padding: '8px 12px', fontSize: 13,
                            display: 'flex', alignItems: 'center', gap: 8,
                          }}>
                            <span style={{
                              width: 10, height: 10, border: '1.5px solid #45475a',
                              borderTopColor: '#89b4fa', borderRadius: '50%',
                              display: 'inline-block', animation: 'spin 0.6s linear infinite',
                              flexShrink: 0,
                            }} />
                            Processing…
                          </div>
                        ) : entry.status === 'error' ? (
                          <div style={{
                            background: 'rgba(243,139,168,0.08)',
                            border: '1px solid rgba(243,139,168,0.25)',
                            color: '#f38ba8',
                            borderRadius: '12px 12px 12px 2px',
                            padding: '8px 12px', fontSize: 13,
                          }}>
                            ✕ Failed to send
                          </div>
                        ) : entry.response ? (
                          <div style={{
                            background: '#232336', color: '#cdd6f4',
                            borderRadius: '12px 12px 12px 2px',
                            padding: '8px 12px', fontSize: 13, lineHeight: 1.5,
                            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                          }}>
                            {entry.response}
                          </div>
                        ) : (
                          <div style={{
                            background: '#232336', color: '#a6e3a1',
                            borderRadius: '12px 12px 12px 2px',
                            padding: '8px 12px', fontSize: 13,
                            display: 'flex', alignItems: 'center', gap: 6,
                          }}>
                            ✓ Sent to OpenClaw
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} style={{ height: 1 }} />
        </div>

        {/* Scroll to bottom button (shown when not at bottom) */}
        {!isAtBottom && entries.length > 0 && (
          <div style={{
            position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
            zIndex: 1,
          }}>
            <button
              onClick={() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); setIsAtBottom(true); }}
              style={{
                background: '#313244', color: '#cdd6f4', border: '1px solid #45475a',
                borderRadius: 20, padding: '6px 16px', cursor: 'pointer', fontSize: 12,
                boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
              }}
            >
              ↓ Scroll to bottom
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
