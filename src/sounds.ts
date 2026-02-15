// Tiny Web Audio API sound effects for voice button
let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

function play(fn: (ctx: AudioContext, t: number) => void) {
  try {
    const c = getCtx();
    if (c.state === 'suspended') c.resume();
    fn(c, c.currentTime);
  } catch {}
}

// Rising boop — start recording
export function soundStartRecord() {
  play((c, t) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(440, t);
    o.frequency.exponentialRampToValueAtTime(660, t + 0.12);
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + 0.15);
  });
}

// Double tap — stop recording / transcribing
export function soundStopRecord() {
  play((c, t) => {
    for (let i = 0; i < 2; i++) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(880, t + i * 0.08);
      g.gain.setValueAtTime(0.12, t + i * 0.08);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.08 + 0.06);
      o.connect(g).connect(c.destination);
      o.start(t + i * 0.08);
      o.stop(t + i * 0.08 + 0.06);
    }
  });
}

// Clear chime — transcript received
export function soundTranscribed() {
  play((c, t) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(784, t); // G5
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + 0.25);
  });
}

// Two ascending notes — sent successfully
export function soundSent() {
  play((c, t) => {
    const notes = [523, 659]; // C5, E5
    notes.forEach((freq, i) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq, t + i * 0.12);
      g.gain.setValueAtTime(0.13, t + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.18);
      o.connect(g).connect(c.destination);
      o.start(t + i * 0.12);
      o.stop(t + i * 0.12 + 0.18);
    });
  });
}

// Low bonk — error
export function soundError() {
  play((c, t) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.15);
    g.gain.setValueAtTime(0.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + 0.2);
  });
}
