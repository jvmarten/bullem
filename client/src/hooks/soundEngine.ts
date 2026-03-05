import { RANK_VALUES, HandType } from '@bull-em/shared';
import type { HandCall, Rank } from '@bull-em/shared';
import fahSoundUrl from '../assets/sounds/fah.mp3';

type SoundName =
  | 'cardDeal'
  | 'callMade'
  | 'bullCalled'
  | 'trueCalled'
  | 'roundWin'
  | 'roundLose'
  | 'eliminated'
  | 'gameOver'
  | 'yourTurn'
  | 'timerTick'
  | 'uiHover'
  | 'uiClick'
  | 'uiSoft'
  | 'deckShuffle'
  | 'cardReveal'
  | 'fanfare'
  | 'wheelTick'
  | 'wheelTickLow'
  | 'wheelSelect';

interface ToneConfig {
  frequency: number;
  duration: number;
  type: OscillatorType;
  gain: number;
  ramp?: number;          // fade-out end time (relative)
  detune?: number;
  delay?: number;         // start delay in seconds
}

// Sounds that use an audio file instead of oscillator tones
const AUDIO_FILE_SOUNDS: Partial<Record<SoundName, { url: string; gain: number; fadeOut?: number }>> = {
  roundLose: { url: fahSoundUrl, gain: 0.45, fadeOut: 0.4 },
};

// Each sound is one or more tones layered together
const SOUND_DEFS: Record<SoundName, ToneConfig[]> = {
  cardDeal: [
    { frequency: 800, duration: 0.06, type: 'sine', gain: 0.15, ramp: 0.05 },
    { frequency: 2400, duration: 0.04, type: 'triangle', gain: 0.08 },
  ],
  callMade: [
    { frequency: 520, duration: 0.12, type: 'sine', gain: 0.15, ramp: 0.1 },
    { frequency: 780, duration: 0.08, type: 'sine', gain: 0.08, delay: 0.04 },
  ],
  bullCalled: [
    { frequency: 200, duration: 0.25, type: 'sine', gain: 0.28, ramp: 0.22 },
    { frequency: 160, duration: 0.3, type: 'triangle', gain: 0.16, delay: 0.08 },
  ],
  trueCalled: [
    { frequency: 660, duration: 0.15, type: 'sine', gain: 0.15, ramp: 0.12 },
    { frequency: 880, duration: 0.12, type: 'sine', gain: 0.1, delay: 0.06 },
  ],
  roundWin: [
    { frequency: 523, duration: 0.15, type: 'sine', gain: 0.15 },
    { frequency: 659, duration: 0.15, type: 'sine', gain: 0.15, delay: 0.1 },
    { frequency: 784, duration: 0.25, type: 'sine', gain: 0.18, delay: 0.2 },
  ],
  roundLose: [], // uses audio file (fah.mp3) — see AUDIO_FILE_SOUNDS
  eliminated: [
    { frequency: 350, duration: 0.3, type: 'sawtooth', gain: 0.1, ramp: 0.25 },
    { frequency: 250, duration: 0.4, type: 'sine', gain: 0.08, delay: 0.1 },
  ],
  gameOver: [
    { frequency: 523, duration: 0.18, type: 'sine', gain: 0.15 },
    { frequency: 659, duration: 0.18, type: 'sine', gain: 0.15, delay: 0.12 },
    { frequency: 784, duration: 0.18, type: 'sine', gain: 0.15, delay: 0.24 },
    { frequency: 1047, duration: 0.4, type: 'sine', gain: 0.2, delay: 0.36 },
  ],
  yourTurn: [
    { frequency: 880, duration: 0.08, type: 'sine', gain: 0.12 },
    { frequency: 1100, duration: 0.1, type: 'sine', gain: 0.15, delay: 0.08 },
  ],
  timerTick: [
    { frequency: 1000, duration: 0.08, type: 'sine', gain: 0.2, ramp: 0.07 },
    { frequency: 1500, duration: 0.05, type: 'triangle', gain: 0.1, delay: 0.02 },
  ],
  uiHover: [
    // Barely-there card flick — ultra-soft whisper
    { frequency: 3800, duration: 0.01, type: 'sine', gain: 0.005, ramp: 0.008 },
  ],
  uiClick: [
    { frequency: 850, duration: 0.05, type: 'sine', gain: 0.08, ramp: 0.04 },
    { frequency: 1250, duration: 0.03, type: 'triangle', gain: 0.04, delay: 0.015 },
  ],
  uiSoft: [
    { frequency: 720, duration: 0.045, type: 'sine', gain: 0.05, ramp: 0.035 },
  ],
  deckShuffle: [
    // Gentle riffle shuffle — soft layered clicks
    { frequency: 2000, duration: 0.03, type: 'sine', gain: 0.03, ramp: 0.025 },
    { frequency: 2400, duration: 0.03, type: 'sine', gain: 0.02, delay: 0.04 },
    { frequency: 1800, duration: 0.03, type: 'sine', gain: 0.025, delay: 0.08 },
    { frequency: 2200, duration: 0.03, type: 'sine', gain: 0.02, delay: 0.12 },
    { frequency: 2600, duration: 0.04, type: 'triangle', gain: 0.02, delay: 0.16 },
  ],
  cardReveal: [
    // Satisfying card flip — crisp snap with resonance
    { frequency: 600, duration: 0.1, type: 'sine', gain: 0.14, ramp: 0.08 },
    { frequency: 1200, duration: 0.06, type: 'triangle', gain: 0.08, delay: 0.03 },
  ],
  wheelTick: [
    // Soft roulette-wheel notch tick — very short, high-pitched, barely audible
    { frequency: 1300, duration: 0.035, type: 'sine', gain: 0.035, ramp: 0.03 },
  ],
  wheelTickLow: [
    // Lower-pitched tick for hand type wheel — ~75% frequency of wheelTick
    { frequency: 950, duration: 0.035, type: 'sine', gain: 0.035, ramp: 0.03 },
  ],
  wheelSelect: [
    // Gentle two-tone marimba tap — barely audible confirmation ping
    { frequency: 600, duration: 0.05, type: 'sine', gain: 0.045, ramp: 0.04 },
    { frequency: 900, duration: 0.05, type: 'sine', gain: 0.04, delay: 0.04 },
  ],
  fanfare: [
    // Celebratory trumpet fanfare for royal flush easter egg
    { frequency: 523, duration: 0.2, type: 'sine', gain: 0.16 },
    { frequency: 659, duration: 0.2, type: 'sine', gain: 0.16, delay: 0.15 },
    { frequency: 784, duration: 0.2, type: 'sine', gain: 0.16, delay: 0.3 },
    { frequency: 1047, duration: 0.5, type: 'sine', gain: 0.2, delay: 0.45 },
    { frequency: 1047, duration: 0.3, type: 'triangle', gain: 0.08, delay: 0.45 },
    { frequency: 784, duration: 0.15, type: 'sine', gain: 0.1, delay: 0.8 },
    { frequency: 1047, duration: 0.6, type: 'sine', gain: 0.18, delay: 0.9 },
  ],
};

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (audioCtx) return audioCtx;
  try {
    audioCtx = new AudioContext();
  } catch {
    // Web Audio API not available
  }
  return audioCtx;
}

// Cache decoded audio buffers so we only fetch/decode once per file
const audioBufferCache = new Map<string, AudioBuffer>();
const audioBufferLoading = new Map<string, Promise<AudioBuffer | null>>();

function loadAudioBuffer(url: string): Promise<AudioBuffer | null> {
  const cached = audioBufferCache.get(url);
  if (cached) return Promise.resolve(cached);

  const pending = audioBufferLoading.get(url);
  if (pending) return pending;

  const ctx = getAudioContext();
  if (!ctx) return Promise.resolve(null);

  const promise = fetch(url)
    .then(res => res.arrayBuffer())
    .then(buf => ctx.decodeAudioData(buf))
    .then(decoded => {
      audioBufferCache.set(url, decoded);
      audioBufferLoading.delete(url);
      return decoded;
    })
    .catch(() => {
      audioBufferLoading.delete(url);
      return null;
    });

  audioBufferLoading.set(url, promise);
  return promise;
}

// Pre-load audio files so they're ready when needed
for (const entry of Object.values(AUDIO_FILE_SOUNDS)) {
  if (entry) loadAudioBuffer(entry.url);
}

function playAudioBuffer(url: string, volume: number, fileGain: number, fadeOut?: number): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }

  const playBuffer = (buf: AudioBuffer) => {
    const source = ctx.createBufferSource();
    const gainNode = ctx.createGain();
    source.buffer = buf;
    const effectiveGain = volume * fileGain;
    gainNode.gain.setValueAtTime(effectiveGain, ctx.currentTime);
    // Apply fade-out at the end of playback
    if (fadeOut && fadeOut > 0) {
      const fadeStart = Math.max(0, buf.duration - fadeOut);
      gainNode.gain.setValueAtTime(effectiveGain, ctx.currentTime + fadeStart);
      gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + buf.duration);
    }
    source.connect(gainNode);
    gainNode.connect(ctx.destination);
    source.start();
  };

  const cached = audioBufferCache.get(url);
  if (cached) {
    playBuffer(cached);
    return;
  }

  // Buffer not yet loaded — load and play
  loadAudioBuffer(url).then(buf => {
    if (!buf) return;
    playBuffer(buf);
  });
}

function playTones(tones: ToneConfig[], volume: number): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  // Resume if suspended (autoplay policy)
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }

  const now = ctx.currentTime;

  for (const tone of tones) {
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = tone.type;
    osc.frequency.value = tone.frequency;
    if (tone.detune) osc.detune.value = tone.detune;

    const effectiveGain = tone.gain * volume;
    const startTime = now + (tone.delay ?? 0);

    gainNode.gain.setValueAtTime(effectiveGain, startTime);

    if (tone.ramp !== undefined) {
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + tone.ramp);
    } else {
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + tone.duration);
    }

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.start(startTime);
    osc.stop(startTime + tone.duration + 0.05);
  }
}

/** Normalize a single rank (2–14) to 0–1 */
function normalizeRank(rank: Rank): number {
  return (RANK_VALUES[rank] - 2) / 12;
}

/** Compute a 0–1 sub-rank offset within a HandType band */
function computeSubRank(hand: HandCall): number {
  switch (hand.type) {
    case HandType.HIGH_CARD:
    case HandType.PAIR:
    case HandType.THREE_OF_A_KIND:
    case HandType.FOUR_OF_A_KIND:
      return normalizeRank(hand.rank);
    case HandType.TWO_PAIR:
      return ((RANK_VALUES[hand.highRank] - 2) * 13 + (RANK_VALUES[hand.lowRank] - 2)) / (12 * 13);
    case HandType.FLUSH:
      return 0.5;
    case HandType.STRAIGHT:
    case HandType.STRAIGHT_FLUSH:
      return (RANK_VALUES[hand.highRank] - 5) / 9;
    case HandType.FULL_HOUSE:
      return ((RANK_VALUES[hand.threeRank] - 2) * 13 + (RANK_VALUES[hand.twoRank] - 2)) / (12 * 13);
    case HandType.ROYAL_FLUSH:
      return 1.0;
  }
}

const MUTE_KEY = 'bull-em-muted';
const VOLUME_KEY = 'bull-em-volume';

export interface SoundController {
  play: (name: SoundName) => void;
  playHandPreview: (hand: HandCall) => void;
  muted: boolean;
  toggleMute: () => void;
  volume: number;
  setVolume: (v: number) => void;
}

export function createSoundController(): SoundController {
  let muted = localStorage.getItem(MUTE_KEY) === 'true';
  let volume = parseFloat(localStorage.getItem(VOLUME_KEY) ?? '1');
  if (isNaN(volume) || volume < 0 || volume > 1) volume = 1;

  const controller: SoundController = {
    get muted() { return muted; },
    get volume() { return volume; },

    play(name: SoundName) {
      if (muted) return;

      const audioEntry = AUDIO_FILE_SOUNDS[name];
      if (audioEntry) {
        playAudioBuffer(audioEntry.url, volume, audioEntry.gain, audioEntry.fadeOut);
        return;
      }

      const tones = SOUND_DEFS[name];
      if (tones) playTones(tones, volume);
    },

    playHandPreview(hand: HandCall) {
      if (muted) return;

      const subRank = computeSubRank(hand);
      const freq = 400 + (hand.type * 100) + (subRank * 80);

      const tones: ToneConfig[] = [
        { frequency: freq, duration: 0.07, type: 'sine', gain: 0.1, ramp: 0.06 },
        { frequency: freq * 1.5, duration: 0.05, type: 'triangle', gain: 0.05, ramp: 0.04 },
      ];

      // ROYAL_FLUSH: add a shimmer sparkle tone
      if (hand.type === HandType.ROYAL_FLUSH) {
        tones.push({ frequency: 3000, duration: 0.03, type: 'sine', gain: 0.03, ramp: 0.025 });
      }

      playTones(tones, volume);
    },

    toggleMute() {
      muted = !muted;
      localStorage.setItem(MUTE_KEY, String(muted));
    },

    setVolume(v: number) {
      volume = Math.max(0, Math.min(1, v));
      localStorage.setItem(VOLUME_KEY, String(volume));
    },
  };

  return controller;
}

export type { SoundName };
