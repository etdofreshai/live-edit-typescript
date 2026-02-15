import React, { useState, useRef, useCallback } from 'react';

type MessageStatus = 'transcribing' | 'sending' | 'sent' | 'error';

interface QueuedMessage {
  id: number;
  text: string;
  status: MessageStatus;
}

interface VoiceContext {
  owner?: string;
  repo?: string;
  branch?: string;
  sha?: string;
}

let nextId = 0;

export function VoiceButton({ context }: { context?: VoiceContext }) {
  const [recording, setRecording] = useState(false);
  const [messages, setMessages] = useState<QueuedMessage[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const contextRef = useRef(context);
  contextRef.current = context;

  const updateMsg = useCallback((id: number, update: Partial<QueuedMessage>) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, ...update } : m));
  }, []);

  const removeMsg = useCallback((id: number) => {
    setMessages(prev => prev.filter(m => m.id !== id));
  }, []);

  const processAudio = useCallback(async (audioBlob: Blob) => {
    const id = nextId++;
    const msg: QueuedMessage = { id, text: '', status: 'transcribing' };
    setMessages(prev => [...prev, msg]);

    try {
      // Transcribe
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');
      const transcribeRes = await fetch(`${import.meta.env.BASE_URL}api/voice/transcribe`, {
        method: 'POST', body: formData,
      });
      if (!transcribeRes.ok) throw new Error(`Transcription failed: ${transcribeRes.status}`);
      const { transcript: text } = await transcribeRes.json();

      if (!text?.trim()) {
        updateMsg(id, { text: '(no speech detected)', status: 'error' });
        setTimeout(() => removeMsg(id), 3000);
        return;
      }

      updateMsg(id, { text: `"${text}"`, status: 'sending' });

      // Send to OpenClaw
      const sendRes = await fetch(`${import.meta.env.BASE_URL}api/voice/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, context: contextRef.current }),
      });

      if (!sendRes.ok) {
        updateMsg(id, { status: 'error' });
        setTimeout(() => removeMsg(id), 4000);
      } else {
        updateMsg(id, { status: 'sent' });
        setTimeout(() => removeMsg(id), 2500);
      }
    } catch (err) {
      console.error('Voice error:', err);
      updateMsg(id, { text: '⚠ Error', status: 'error' });
      setTimeout(() => removeMsg(id), 3000);
    }
  }, [updateMsg, removeMsg]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

      chunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
        processAudio(audioBlob);
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setRecording(true);
    } catch (err) {
      console.error('Failed to start recording:', err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
      setRecording(false);
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

      {messages.length > 0 && (
        <div className="voice-queue">
          {messages.map(m => (
            <div key={m.id} className={`voice-msg ${m.status}`}>
              <span className="voice-msg-icon">
                {m.status === 'transcribing' && <span className="voice-spinner" />}
                {m.status === 'sending' && <span className="voice-spinner" />}
                {m.status === 'sent' && <span className="voice-check">✓</span>}
                {m.status === 'error' && <span className="voice-error-icon">✕</span>}
              </span>
              <span className="voice-msg-text">
                {m.status === 'transcribing' ? 'Transcribing...' : m.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
