/**
 * System sounds, synthesized with Web Audio (no files, no deps).
 * Browsers block audio until a user gesture — call `unlockAudio()` from one.
 */
export type Cue = 'chime' | 'tick' | 'alarm' | 'reject' | 'levelup';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

export function unlockAudio(): void {
  const a = audio();
  if (a && a.state === 'suspended') void a.resume();
}

function tone(a: AudioContext, freq: number, start: number, dur: number, type: OscillatorType, gain: number): void {
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, a.currentTime + start);
  g.gain.setValueAtTime(0, a.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, a.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + dur);
  osc.connect(g).connect(a.destination);
  osc.start(a.currentTime + start);
  osc.stop(a.currentTime + start + dur + 0.02);
}

export function play(cue: Cue): void {
  const a = audio();
  if (!a || a.state !== 'running') return;
  switch (cue) {
    case 'tick':
      tone(a, 1320, 0, 0.08, 'square', 0.05);
      break;
    case 'reject':
      tone(a, 180, 0, 0.25, 'sawtooth', 0.08);
      break;
    case 'chime':
      [880, 1175, 1568].forEach((f, i) => tone(a, f, i * 0.09, 0.5, 'sine', 0.12));
      break;
    case 'levelup':
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone(a, f, i * 0.1, 0.8, 'triangle', 0.12));
      break;
    case 'alarm':
      for (let i = 0; i < 4; i++) {
        tone(a, 220, i * 0.4, 0.3, 'sawtooth', 0.1);
        tone(a, 165, i * 0.4 + 0.2, 0.2, 'sawtooth', 0.1);
      }
      break;
  }
}

/** Speaks a System voice line with the browser's TTS (low, slow, cold). */
export function speak(text: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.9;
  u.pitch = 0.6;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}
