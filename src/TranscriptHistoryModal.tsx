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
      className="transcript-history-modal-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="transcript-history-modal"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="transcript-history-title"
      >
        {/* Header */}
        <div className="transcript-history-modal-header">
          <h2 id="transcript-history-title" className="transcript-history-modal-title">
            📜 Transcript History
            {entries.length > 0 && (
              <span className="transcript-history-count">
                {entries.length}
              </span>
            )}
          </h2>
          <button
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close transcript history"
            className="transcript-history-close-btn"
          >✕</button>
        </div>

        {/* Chat area */}
        <div
          ref={scrollRef}
          className="transcript-history-chat"
          onScroll={handleScroll}
        >
          {entries.length === 0 ? (
            <div className="transcript-history-empty">
              <div>
                <div className="transcript-history-empty-icon" aria-hidden="true">🎙️</div>
                <div>No transcripts yet.</div>
                <div className="transcript-history-empty-hint">Record something with the voice button!</div>
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
                    <div className="transcript-history-date-separator">
                      <div className="transcript-history-date-line" />
                      {formatDate(entry.timestamp)}
                      <div className="transcript-history-date-line" />
                    </div>
                  )}

                  {/* Conversation bubble group */}
                  <div className="transcript-history-entry">
                    {/* User message — right side */}
                    <div className="transcript-history-row transcript-history-row-user">
                      <div className="transcript-history-user-content">
                        <div className="transcript-history-meta">
                          {formatTime(entry.timestamp)}
                          {entry.consoleLogs ? ` · ${entry.consoleLogs} log${entry.consoleLogs !== 1 ? 's' : ''}` : ''}
                        </div>
                        <div className="transcript-history-bubble transcript-history-bubble-user">
                          {entry.userText}
                        </div>
                        {entry.screenshot && (
                          <div className="transcript-history-attachment">
                            📸 Screenshot attached
                          </div>
                        )}
                        {/* Status badge */}
                        <div className="transcript-history-status-row">
                          {entry.status === 'pending' && (
                            <span className="transcript-history-status transcript-history-status-pending">
                              <span className="transcript-history-spinner transcript-history-spinner-small" />
                              sending…
                            </span>
                          )}
                          {entry.status === 'complete' && (
                            <span className="transcript-history-status transcript-history-status-complete">✓ sent</span>
                          )}
                          {entry.status === 'error' && (
                            <span className="transcript-history-status transcript-history-status-error">✕ failed</span>
                          )}
                        </div>
                      </div>
                      {/* User avatar */}
                      <div className="transcript-history-avatar transcript-history-avatar-user" aria-hidden="true">🎙️</div>
                    </div>

                    {/* Response — left side */}
                    <div className="transcript-history-row transcript-history-row-response">
                      {/* Bot avatar */}
                      <div className="transcript-history-avatar transcript-history-avatar-bot" aria-hidden="true">🤖</div>
                      <div className="transcript-history-response-content">
                        {entry.status === 'pending' ? (
                          <div className="transcript-history-bubble transcript-history-bubble-response transcript-history-bubble-pending">
                            <span className="transcript-history-spinner transcript-history-spinner-medium" />
                            Processing…
                          </div>
                        ) : entry.status === 'error' ? (
                          <div className="transcript-history-bubble transcript-history-bubble-error">
                            ✕ Failed to send
                          </div>
                        ) : entry.response ? (
                          <div className="transcript-history-bubble transcript-history-bubble-response transcript-history-bubble-text">
                            {entry.response}
                          </div>
                        ) : (
                          <div className="transcript-history-bubble transcript-history-bubble-response transcript-history-bubble-sent">
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
          <div ref={bottomRef} className="transcript-history-bottom-anchor" />
        </div>

        {/* Scroll to bottom button (shown when not at bottom) */}
        {!isAtBottom && entries.length > 0 && (
          <div className="transcript-history-scroll-bottom">
            <button
              onClick={() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); setIsAtBottom(true); }}
              className="transcript-history-scroll-bottom-btn"
            >
              ↓ Scroll to bottom
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
