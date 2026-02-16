import React, { useState, useRef, useEffect } from 'react';
import { soundStartRecord, soundStopRecord, soundTranscribed, soundSent, soundError } from './sounds';

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
    console.warn('Failed to capture screenshot:', err);
    return null;
  }
}

interface VoiceJob {
  id: string;
  status: 'transcribing' | 'sending' | 'sent' | 'error';
  text: string;
  startedAt: number;
  error?: string;
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

interface VoiceButtonProps {
  context?: VoiceContext;
  iframeRef?: React.RefObject<HTMLIFrameElement>;
  consoleLogs?: string[];
}

export function VoiceButton({ context, iframeRef, consoleLogs }: VoiceButtonProps) {
  const [recording, setRecording] = useState(false);
  const [jobs, setJobs] = useState<VoiceJob[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const prevStatusRef = useRef<Map<string, string>>(new Map());

  // Poll server for job status
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}api/voice/jobs`);
        if (res.ok) {
          const serverJobs: VoiceJob[] = await res.json();
          
          // Play sounds on status transitions
          for (const job of serverJobs) {
            const prev = prevStatusRef.current.get(job.id);
            if (prev !== job.status) {
              if (job.status === 'sending' && prev === 'transcribing') soundTranscribed();
              if (job.status === 'sent') soundSent();
              if (job.status === 'error') soundError();
            }
            prevStatusRef.current.set(job.id, job.status);
          }
          
          // Clean up tracking for removed jobs
          const jobIds = new Set(serverJobs.map(j => j.id));
          for (const id of prevStatusRef.current.keys()) {
            if (!jobIds.has(id)) prevStatusRef.current.delete(id);
          }

          setJobs(serverJobs);
        }
      } catch {}
    };

    poll(); // initial
    const iv = setInterval(poll, 1000);
    return () => clearInterval(iv);
  }, []);

  const dismissJob = async (id: string) => {
    try {
      await fetch(`${import.meta.env.BASE_URL}api/voice/jobs/${id}`, { method: 'DELETE' });
      setJobs(prev => prev.filter(j => j.id !== id));
    } catch {}
  };

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
        
        // Capture screenshot if iframe is available
        let screenshotBlob: Blob | null = null;
        if (iframeRef?.current) {
          screenshotBlob = await captureIframeScreenshot(iframeRef.current);
        }
        
        // Send to server — job is created server-side
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm');
        if (context) formData.append('context', JSON.stringify(context));
        if (screenshotBlob) formData.append('screenshot', screenshotBlob, 'screenshot.png');
        if (consoleLogs && consoleLogs.length > 0) {
          formData.append('consoleLogs', JSON.stringify(consoleLogs));
        }
        
        try {
          await fetch(`${import.meta.env.BASE_URL}api/voice`, {
            method: 'POST', body: formData,
          });
        } catch (err) {
          console.error('Failed to submit voice:', err);
        }
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setRecording(true);
      soundStartRecord();
    } catch (err) {
      console.error('Failed to start recording:', err);
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

  return (
    <>
      <button
        className={`voice-btn ${recording ? 'recording' : ''}`}
        onClick={handleClick}
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
        <div className="voice-queue">
          {jobs.map(j => (
            <div key={j.id} className={`voice-msg ${j.status}`}>
              <span className="voice-msg-icon">
                {(j.status === 'transcribing' || j.status === 'sending') && <span className="voice-spinner" />}
                {j.status === 'sent' && <span className="voice-check">✓</span>}
                {j.status === 'error' && <span className="voice-error-icon">✕</span>}
              </span>
              <span className="voice-msg-text">
                {j.status === 'transcribing' ? 'Transcribing...' : j.text || j.error || ''}
              </span>
              {(j.status === 'transcribing' || j.status === 'sending') && (
                <ElapsedTimer startedAt={j.startedAt} />
              )}
              {(j.status === 'sent' || j.status === 'error') && (
                <button className="voice-msg-dismiss" onClick={() => dismissJob(j.id)} title="Dismiss">✕</button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
