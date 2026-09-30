/**
 * 2026-09-30, the user ("dźwięki tak"): Draw Five's table sounds — the shuffle, each card dealt and
 * turned over, a pick, and the two Joker reveals. Synthesized with Web Audio like the lottery drum's
 * (lotteryDrum.ts), no files. The audio context starts on the first sound, which always follows a
 * click, so browsers let it play. Muted state is remembered in this browser.
 */

const MUTE_KEY = 'draftverse.drawMuted';

interface Audio {
  ac: AudioContext;
  master: GainNode;
  noise: AudioBuffer;
}

let audio: Audio | null = null;
let muted = readMuted();

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function deckSoundsMuted(): boolean {
  return muted;
}

export function setDeckSoundsMuted(value: boolean): void {
  muted = value;
  try {
    window.localStorage.setItem(MUTE_KEY, value ? '1' : '0');
  } catch {
    // storage blocked: the choice lasts for this visit
  }
}

function ctx(): Audio | null {
  if (muted) return null;
  if (audio) return audio;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const ac = new Ctor();
    const master = ac.createGain();
    master.gain.value = 0.7;
    master.connect(ac.destination);
    const len = ac.sampleRate;
    const noise = ac.createBuffer(1, len, ac.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    audio = { ac, master, noise };
    return audio;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, slideTo?: number): void {
  const a = ctx();
  if (!a) return;
  const t = a.ac.currentTime + delay;
  const o = a.ac.createOscillator();
  const g = a.ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, vol: number, freq: number, delay = 0, type: BiquadFilterType = 'bandpass'): void {
  const a = ctx();
  if (!a) return;
  const t = a.ac.currentTime + delay;
  const s = a.ac.createBufferSource();
  s.buffer = a.noise;
  const f = a.ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = a.ac.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(a.master);
  s.start(t);
  s.stop(t + dur + 0.02);
}

export const deckSfx = {
  /** A riffle: a quick run of soft card slaps. */
  shuffle(): void {
    for (let i = 0; i < 9; i++) noise(0.05, 0.16, 2600 + i * 120, i * 0.035);
  },
  /** One card sliding off the deck. */
  deal(): void {
    noise(0.16, 0.2, 1800, 0, 'bandpass');
  },
  /** A card turning over as it lands. */
  flip(): void {
    noise(0.04, 0.22, 4200, 0, 'highpass');
    tone(520, 0.05, 'triangle', 0.06);
  },
  /** A card picked. */
  pick(): void {
    tone(660, 0.08, 'triangle', 0.12);
    tone(990, 0.1, 'triangle', 0.08, 0.06);
  },
  /** The Joker was a legend. */
  jackpot(): void {
    [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.5, 'triangle', 0.1, i * 0.07));
    noise(0.5, 0.12, 6000, 0.1, 'highpass');
  },
  /** The Joker was a scrub. */
  scrub(): void {
    tone(180, 0.35, 'sawtooth', 0.12, 0, 90);
    tone(120, 0.45, 'sine', 0.2, 0.12, 70);
  },
};
