import React, { useState, useRef } from 'react';

type VoiceButtonState = 'idle' | 'recording' | 'processing';

export function VoiceButton() {
  const [state, setState] = useState<VoiceButtonState>('idle');
  const [transcript, setTranscript] = useState<string>('');
  const [showTranscript, setShowTranscript] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      
      chunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
        await sendAudio(audioBlob);
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setState('recording');
    } catch (err) {
      console.error('Failed to start recording:', err);
      alert('Failed to access microphone. Please grant permission.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setState('processing');
    }
  };

  const sendAudio = async (audioBlob: Blob) => {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');

    try {
      const response = await fetch(`${import.meta.env.BASE_URL}api/voice`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const data = await response.json();
      setTranscript(data.transcript || 'No transcript received');
      setShowTranscript(true);
      setState('idle');

      // Auto-hide transcript after 3 seconds
      setTimeout(() => {
        setShowTranscript(false);
      }, 3000);
    } catch (err) {
      console.error('Failed to send audio:', err);
      alert('Failed to process audio. Check console for details.');
      setState('idle');
    }
  };

  const handleClick = () => {
    if (state === 'idle') {
      startRecording();
    } else if (state === 'recording') {
      stopRecording();
    }
    // If processing, do nothing
  };

  return (
    <>
      <button
        className={`voice-btn ${state === 'recording' ? 'recording' : ''} ${state === 'processing' ? 'processing' : ''}`}
        onClick={handleClick}
        disabled={state === 'processing'}
        title={state === 'idle' ? 'Click to record' : state === 'recording' ? 'Click to stop' : 'Processing...'}
      >
        {state === 'processing' ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" opacity="0.25" />
            <path d="M12 2 A10 10 0 0 1 22 12" className="spinner-path" />
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        )}
      </button>
      
      {showTranscript && transcript && (
        <div className="voice-transcript">
          {transcript}
        </div>
      )}
    </>
  );
}
