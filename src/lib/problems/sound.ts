/**
 * Small synthesized sounds for problem solving (no audio files): a stone click, a bright
 * two-note chime for a right answer, a low tone for a wrong one, and a short fanfare at the
 * end of a perfect set.
 */

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, dur: number, gain = 0.12, type: OscillatorType = 'sine') {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + start;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function stoneSound() {
  const a = audio();
  if (!a) return;
  // A short band of noise: the click of slate on wood.
  const len = Math.floor(a.sampleRate * 0.05);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 4;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 2400;
  f.Q.value = 1.2;
  const g = a.createGain();
  g.gain.value = 0.5;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

export const rightSound = () => {
  tone(784, 0, 0.18);
  tone(1175, 0.09, 0.3);
};

export const wrongSound = () => {
  tone(220, 0, 0.28, 0.1, 'triangle');
  tone(196, 0.1, 0.3, 0.08, 'triangle');
};

export const fanfare = () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.35, 0.1));
