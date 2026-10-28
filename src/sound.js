// Tiny WebAudio synth for move/capture/check/low-time/end cues. No audio files, nothing downloaded.
// Off by default; the toggle lives next to "coords" on the Play screen. Every call is a no-op if
// AudioContext is unavailable or blocked.
let ctx = null;
function ac() {
  if (ctx) return ctx;
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; }
  return ctx;
}
function tone(t0, freq, dur, { type = 'sine', gain = 0.12, to = null } = {}) {
  const c = ac(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0); o.stop(t0 + dur + 0.03);
}
function thud(t0, dur, gain) {
  const c = ac(); if (!c) return;
  const n = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) * (1 - i / n);
  const s = c.createBufferSource(); s.buffer = buf;
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
  const g = c.createGain(); g.gain.value = gain;
  s.connect(f).connect(g).connect(c.destination);
  s.start(t0);
}
export function play(kind) {
  const c = ac(); if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => { });
  const t = c.currentTime + 0.01;
  switch (kind) {
    case 'move': tone(t, 520, 0.05, { type: 'triangle', to: 260, gain: 0.10 }); break;
    case 'capture': thud(t, 0.08, 0.14); tone(t, 220, 0.09, { type: 'square', to: 110, gain: 0.05 }); break;
    case 'check': tone(t, 660, 0.09, { gain: 0.10 }); tone(t + 0.11, 880, 0.13, { gain: 0.10 }); break;
    case 'tick': tone(t, 1000, 0.02, { gain: 0.05 }); break;
    case 'end': tone(t, 660, 0.14, { gain: 0.09 }); tone(t + 0.16, 523, 0.14, { gain: 0.09 }); tone(t + 0.32, 392, 0.24, { gain: 0.09 }); break;
    default: break;
  }
}
