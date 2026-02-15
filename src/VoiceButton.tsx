import React, { useState, useRef } from 'react';

type VoiceState = 'idle' | 'recording' | 'transcribing' | 'sending' | 'done';

interface VoiceContext {
  owner?: string;
  repo?: string;
  branch?: string;
  sha?: string;
}

export function VoiceButton({ context }: { context?: VoiceContext }) {
  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState<string>('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

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
        await processAudio(audioBlob);
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setState('recording');
      setTranscript('');
    } catch (err) {
      console.error('Failed to start recording:', err);
      setTranscript('⚠ Microphone access denied');
      setState('done');
      setTimeout(() => { setState('idle'); setTranscript(''); }, 3000);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
      setState('transcribing');
    }
  };

  const processAudio = async (audioBlob: Blob) => {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');

    try {
      // Step 1: Transcribe
      const transcribeRes = await fetch(`${import.meta.env.BASE_URL}api/voice/transcribe`, {
        method: 'POST',
        body: formData,
      });

      if (!transcribeRes.ok) throw new Error(`Transcription failed: ${transcribeRes.status}`);
      const { transcript: text } = await transcribeRes.json();

      if (!text || !text.trim()) {
        setTranscript('(no speech detected)');
        setState('done');
        setTimeout(() => { setState('idle'); setTranscript(''); }, 3000);
        return;
      }

      // Show transcript immediately, switch to sending
      setTranscript(`"${text}"`);
      setState('sending');

      // Step 2: Send to OpenClaw
      const sendRes = await fetch(`${import.meta.env.BASE_URL}api/voice/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, context }),
      });

      if (!sendRes.ok) {
        setTranscript(`"${text}" — ⚠ send failed`);
        setState('done');
        setTimeout(() => { setState('idle'); setTranscript(''); }, 4000);
        return;
      }

      // Success — show checkmark briefly, then fade everything
      setState('done');
      setTimeout(() => { setState('idle'); setTranscript(''); }, 2000);
    } catch (err) {
      console.error('Voice error:', err);
      setTranscript('⚠ Error processing audio');
      setState('done');
      setTimeout(() => { setState('idle'); setTranscript(''); }, 3000);
    }
  };

  const handleClick = () => {
    if (state === 'idle') startRecording();
    else if (state === 'recording') stopRecording();
  };

  const busy = state === 'transcribing' || state === 'sending';
  const showTranscript = transcript && state !== 'idle' && state !== 'recording';

  // Button icon
  const icon = () => {
    if (state === 'done') {
      // Checkmark
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#a6e3a1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
    }
    if (busy) {
      // Spinner
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" opacity="0.25" />
          <path d="M12 2 A10 10 0 0 1 22 12" className="spinner-path" />
        </svg>
      );
    }
    // Mic
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
    );
  };

  return (
    <>
      <button
        className={`voice-btn ${state === 'recording' ? 'recording' : ''} ${busy ? 'processing' : ''} ${state === 'done' ? 'done' : ''}`}
        onClick={handleClick}
        disabled={busy || state === 'done'}
        title={
          state === 'idle' ? 'Click to record' :
          state === 'recording' ? 'Click to stop' :
          state === 'transcribing' ? 'Transcribing...' :
          state === 'sending' ? 'Sending...' : 'Sent!'
        }
      >
        {icon()}
      </button>

      {showTranscript && (
        <div className={`voice-transcript ${state === 'done' ? 'fading' : ''}`}>
          {transcript}
        </div>
      )}
    </>
  );
}
