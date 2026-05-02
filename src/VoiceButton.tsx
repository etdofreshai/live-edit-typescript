import React, { useState, useRef, useEffect, useCallback } from 'react';
import { apiFetch } from './api';
import { soundStartRecord, soundStopRecord, soundTranscribed, soundSent, soundError } from './sounds';
import { VoiceJob } from './types';

const log = {
  warn: (...args: Parameters<typeof console.warn>) => console.warn(...args),
  error: (...args: Parameters<typeof console.error>) => console.error(...args),
};

async function captureIframeScreenshot(iframe: HTMLIFrameElement): Promise<Blob | null> {
  try {
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return null;

    // Try to find a <canvas> element first (games, WebGL apps)
    const canvas = doc.querySelector('canvas');
    if (canvas) {
      const blob = await new Promise<Blob | null>((resolve) => {
        (canvas as HTMLCanvasElement).toBlob((b) => resolve(b), 'image/png');
      });
      if (blob && blob.size > 0) return blob;
    }

    // Fallback: use html2canvas on the iframe's body
    const { default: html2canvas } = await import('html2canvas');
    const rendered = await html2canvas(doc.body, {
      allowTaint: true,
      useCORS: true,
      backgroundColor: '#1a1a2e',
      width: iframe.clientWidth,
      height: iframe.clientHeight,
    });
    return await new Promise<Blob | null>((resolve) => {
      rendered.toBlob((b) => resolve(b), 'image/png');
    });
  } catch (err) {
    log.warn('Failed to capture screenshot:', err);
    return null;
  }
}

interface VoiceContext {
  owner?: string;
  repo?: string;
  branch?: string;
  sha?: string;
}

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h`;
}

function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);
  return <span className="voice-msg-timer">{formatElapsed(now - startedAt)}</span>;
}

function isInProgress(status: VoiceJob['status']): boolean {
  return status === 'transcribing' || status === 'sending';
}

function isTerminal(status: VoiceJob['status']): boolean {
  return status === 'sent' || status === 'error';
}

function JobStatusIcon({ status }: { status: VoiceJob['status'] }) {
  return (
    <span className="voice-msg-icon">
      {isInProgress(status) && <span className="voice-spinner" />}
      {status === 'sent' && <span className="voice-check">✓</span>}
      {status === 'error' && <span className="voice-error-icon">✕</span>}
    </span>
  );
}

async function submitRecording(
  audioBlob: Blob,
  screenshotBlob: Blob | null,
  context: VoiceContext | undefined,
  consoleLogs: string[] | undefined,
  screenshotUrls: React.MutableRefObject<Map<string, string>>,
): Promise<void> {
  const formData = new FormData();
  formData.append('audio', audioBlob, 'recording.webm');
  if (context) formData.append('context', JSON.stringify(context));
  if (screenshotBlob) formData.append('screenshot', screenshotBlob, 'screenshot.png');
  if (consoleLogs && consoleLogs.length > 0) {
    formData.append('consoleLogs', JSON.stringify(consoleLogs));
  }

  try {
    const res = await apiFetch(`${import.meta.env.BASE_URL}api/voice`, {
      method: 'POST', body: formData,
    });
    if (res.ok && screenshotBlob) {
      const { jobId } = await res.json();
      if (jobId) {
        screenshotUrls.current.set(jobId, URL.createObjectURL(screenshotBlob));
      }
    }
  } catch (err) {
    log.error('Failed to submit voice:', err);
  }
}

function useVoiceJobs() {
  const [jobs, setJobs] = useState<VoiceJob[]>([]);
  const prevStatusRef = useRef<Map<string, string>>(new Map());
  const screenshotUrls = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await apiFetch(`${import.meta.env.BASE_URL}api/voice/jobs`);
        if (!res.ok) return;
        const serverJobs: VoiceJob[] = await res.json();

        for (const job of serverJobs) {
          const prev = prevStatusRef.current.get(job.id);
          if (prev !== job.status) {
            if (job.status === 'sending' && prev === 'transcribing') soundTranscribed();
            if (job.status === 'sent') soundSent();
            if (job.status === 'error') soundError();
          }
          prevStatusRef.current.set(job.id, job.status);
        }

        const jobIds = new Set(serverJobs.map(j => j.id));
        for (const id of prevStatusRef.current.keys()) {
          if (!jobIds.has(id)) prevStatusRef.current.delete(id);
        }

        setJobs(serverJobs);
      } catch {}
    };

    poll();
    const iv = setInterval(poll, 1000);
    return () => clearInterval(iv);
  }, []);

  const dismissJob = useCallback(async (id: string) => {
    try {
      await apiFetch(`${import.meta.env.BASE_URL}api/voice/jobs/${id}`, { method: 'DELETE' });
      const url = screenshotUrls.current.get(id);
      if (url) { URL.revokeObjectURL(url); screenshotUrls.current.delete(id); }
      setJobs(prev => prev.filter(j => j.id !== id));
    } catch {}
  }, []);

  return { jobs, dismissJob, screenshotUrls };
}

interface VoiceButtonProps {
  context?: VoiceContext;
  iframeRef?: React.RefObject<HTMLIFrameElement>;
  consoleLogs?: string[];
}

export function VoiceButton({ context, iframeRef, consoleLogs }: VoiceButtonProps) {
  const [recording, setRecording] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [faded, setFaded] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartXRef = useRef<number>(0);

  const { jobs, dismissJob, screenshotUrls } = useVoiceJobs();

  const scheduleFade = useCallback(() => {
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    fadeTimerRef.current = setTimeout(() => {
      setFaded(true);
    }, 5000);
  }, []);

  const resetFade = useCallback(() => {
    setFaded(false);
    scheduleFade();
  }, [scheduleFade]);

  // Detect job state changes (new jobs, status transitions)
  const jobStateStr = jobs.map(j => `${j.id}:${j.status}`).join(',');
  const prevJobStateRef = useRef('');

  useEffect(() => {
    if (jobStateStr === prevJobStateRef.current) return;
    prevJobStateRef.current = jobStateStr;
    if (jobs.length > 0) {
      resetFade();
    } else {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      setFaded(false);
    }
  });

  useEffect(() => {
    return () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

      chunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });

        const screenshotBlob = iframeRef?.current
          ? await captureIframeScreenshot(iframeRef.current)
          : null;

        await submitRecording(audioBlob, screenshotBlob, context, consoleLogs, screenshotUrls);
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setRecording(true);
      soundStartRecord();
    } catch (err) {
      log.error('Failed to start recording:', err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
      setRecording(false);
      soundStopRecord();
    }
  };

  const handleClick = () => {
    if (recording) stopRecording();
    else startRecording();
  };

  // Swipe to minimize/expand
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartXRef.current;
    if (dx > 50) setMinimized(true);   // swipe right → minimize
    else if (dx < -50) setMinimized(false); // swipe left → expand
  };

  return (
    <>
      <button
        className={`voice-btn ${recording ? 'recording' : ''}`}
        onClick={handleClick}
        aria-label={recording ? 'Stop voice recording' : 'Start voice recording'}
        title={recording ? 'Click to stop' : 'Click to record'}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      </button>

      {jobs.length > 0 && (
        <div
          className={`voice-queue${minimized ? ' minimized' : ''}${faded ? ' faded' : ''}`}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Queue header with minimize button */}
          <div className="voice-queue-header">
            <span className="voice-queue-title">
              {minimized ? `${jobs.length} job${jobs.length !== 1 ? 's' : ''}` : 'Voice Queue'}
            </span>
            <button
              className="voice-minimize-btn"
              onClick={() => setMinimized(m => !m)}
              aria-label={minimized ? 'Expand voice queue' : 'Minimize voice queue'}
              title={minimized ? 'Expand (swipe left)' : 'Minimize (swipe right)'}
            >
              {minimized ? '▸' : '▾'}
            </button>
          </div>

          {minimized ? (
            /* Minimized: compact pill row with screenshot + icon per job */
            <div className="voice-queue-pills">
              {jobs.map(j => (
                <div key={j.id} className="voice-pill">
                  {screenshotUrls.current.has(j.id) && (
                    <img
                      src={screenshotUrls.current.get(j.id)}
                      alt="screenshot"
                      className="voice-pill-screenshot"
                    />
                  )}
                  <JobStatusIcon status={j.status} />
                </div>
              ))}
            </div>
          ) : (
            /* Expanded: full job rows */
            jobs.map(j => (
              <div key={j.id} className={`voice-msg ${j.status}`}>
                {screenshotUrls.current.has(j.id) && (
                  <img
                    src={screenshotUrls.current.get(j.id)}
                    alt="Voice job screenshot"
                    className="voice-msg-screenshot"
                  />
                )}
                <JobStatusIcon status={j.status} />
                <span className="voice-msg-text">
                  {j.status === 'transcribing' ? 'Transcribing...' : j.text || j.error || ''}
                </span>
                {isInProgress(j.status) && <ElapsedTimer startedAt={j.startedAt} />}
                {isTerminal(j.status) && (
                  <button
                    className="voice-msg-dismiss"
                    onClick={() => dismissJob(j.id)}
                    aria-label="Dismiss voice job"
                    title="Dismiss"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </>
  );
}
