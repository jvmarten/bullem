import { RANK_VALUES, HandType } from '@bull-em/shared';
import type { HandCall, Rank } from '@bull-em/shared';
import fahSoundUrl from '../assets/sounds/fah.mp3';
import cardDealUrl from '../assets/sounds/card-deal.mp3';
import cardRevealUrl from '../assets/sounds/card-reveal.mp3';
import deckShuffleUrl from '../assets/sounds/deck-shuffle.mp3';
import bullCalledUrl from '../assets/sounds/bull-called.mp3';
import trueCalledUrl from '../assets/sounds/true-called.mp3';
import callMadeUrl from '../assets/sounds/call-made.mp3';
import roundWinUrl from '../assets/sounds/round-win.mp3';
import eliminatedUrl from '../assets/sounds/eliminated.mp3';
import gameOverUrl from '../assets/sounds/game-over.mp3';
import yourTurnUrl from '../assets/sounds/your-turn.mp3';
import timerTickUrl from '../assets/sounds/timer-tick.mp3';
import heartbeatUrl from '../assets/sounds/heartbeat.mp3';
import uiClickUrl from '../assets/sounds/ui-click.mp3';
import uiSoftUrl from '../assets/sounds/ui-soft.mp3';
import fanfareUrl from '../assets/sounds/fanfare.mp3';
import wheelTickUrl from '../assets/sounds/wheel-tick.mp3';
import wheelTickLowUrl from '../assets/sounds/wheel-tick-low.mp3';
import wheelSelectUrl from '../assets/sounds/wheel-select.mp3';
import tuplausUrl from '../assets/sounds/tuplaus.mp3';

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
  | 'heartbeat'
  | 'uiHover'
  | 'uiClick'
  | 'uiSoft'
  | 'deckShuffle'
  | 'cardReveal'
  | 'fanfare'
  | 'wheelTick'
  | 'wheelTickLow'
  | 'wheelSelect'
  | 'deckShuffleLoop';

interface ToneConfig {
  frequency: number;
  duration: number;
  type: OscillatorType;
  gain: number;
  ramp?: number;          // fade-out end time (relative)
  detune?: number;
  delay?: number;         // start delay in seconds
}

// Sounds that use an audio file instead of oscillator tones.
// Most sounds now use pre-rendered MP3 files for richer quality.
const AUDIO_FILE_SOUNDS: Partial<Record<SoundName, { url: string; gain: number; fadeOut?: number }>> = {
  cardDeal:    { url: cardDealUrl, gain: 0.18 },
  cardReveal:  { url: cardRevealUrl, gain: 0.3 },
  deckShuffle: { url: deckShuffleUrl, gain: 0.4 },
  bullCalled:  { url: bullCalledUrl, gain: 0.5 },
  trueCalled:  { url: trueCalledUrl, gain: 0.45 },
  callMade:    { url: callMadeUrl, gain: 0.45 },
  roundWin:    { url: roundWinUrl, gain: 0.5 },
  roundLose:   { url: fahSoundUrl, gain: 0.45, fadeOut: 0.4 },
  eliminated:  { url: eliminatedUrl, gain: 0.5 },
  gameOver:    { url: gameOverUrl, gain: 0.45 },
  yourTurn:    { url: yourTurnUrl, gain: 0.14 },
  timerTick:   { url: timerTickUrl, gain: 0.5 },
  heartbeat:   { url: heartbeatUrl, gain: 0.55 },
  uiClick:     { url: uiClickUrl, gain: 0.4 },
  uiSoft:      { url: uiSoftUrl, gain: 0.35 },
  fanfare:     { url: fanfareUrl, gain: 0.45 },
  wheelTick:   { url: wheelTickUrl, gain: 0.35 },
  wheelTickLow: { url: wheelTickLowUrl, gain: 0.35 },
  wheelSelect: { url: wheelSelectUrl, gain: 0.35 },
  deckShuffleLoop: { url: tuplausUrl, gain: 0.1 },
};

// Oscillator fallbacks — used only for sounds without an audio file (uiHover)
// and for the dynamic playHandPreview which generates tones based on hand rank.
const SOUND_DEFS: Record<SoundName, ToneConfig[]> = {
  cardDeal: [],
  callMade: [],
  bullCalled: [],
  trueCalled: [],
  roundWin: [],
  roundLose: [],
  eliminated: [],
  gameOver: [],
  yourTurn: [],
  timerTick: [],
  heartbeat: [],
  uiHover: [
    // Barely-there card flick — ultra-soft whisper (kept as oscillator for minimal latency)
    { frequency: 3800, duration: 0.01, type: 'sine', gain: 0.005, ramp: 0.008 },
  ],
  uiClick: [],
  uiSoft: [],
  deckShuffle: [],
  cardReveal: [],
  wheelTick: [],
  wheelTickLow: [],
  wheelSelect: [],
  fanfare: [],
  deckShuffleLoop: [],
};

// Haptic vibration patterns (in ms) for key game events.
// navigator.vibrate() is a no-op on unsupported devices (desktop browsers),
// so this gracefully degrades without any feature detection.
const HAPTIC_PATTERNS: Partial<Record<SoundName, number | number[]>> = {
  yourTurn:    [40, 30, 40],      // double tap — "hey, it's you"
  bullCalled:  [100],             // firm single pulse
  trueCalled:  [50],              // gentle pulse
  callMade:    [20],              // subtle tick
  roundWin:    [30, 40, 30, 40, 60], // celebratory triple pulse
  roundLose:   [80, 30, 120],     // descending buzz
  eliminated:  [200],             // long buzz — you're out
  gameOver:    [40, 30, 40, 30, 40, 60, 100], // big fanfare pattern
  cardDeal:    [15],              // tiny tap
  heartbeat:   [60, 80, 40],     // lub-dub pulse
};

function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate(pattern);
  } catch {
    // Vibration API not available — graceful no-op
  }
}

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
      return ((RANK_VALUES[hand.highRank] - 2) * 3 + (RANK_VALUES[hand.lowRank] - 2)) / (12 * 3 + 12);
    case HandType.FLUSH:
      return 0.5;
    case HandType.STRAIGHT:
    case HandType.STRAIGHT_FLUSH:
      return (RANK_VALUES[hand.highRank] - 5) / 9;
    case HandType.FULL_HOUSE:
      return ((RANK_VALUES[hand.threeRank] - 2) * 3 + (RANK_VALUES[hand.twoRank] - 2)) / (12 * 3 + 12);
    case HandType.ROYAL_FLUSH:
      return 1.0;
  }
}

const MUTE_KEY = 'bull-em-muted';
const VOLUME_KEY = 'bull-em-volume';

export interface SoundController {
  play: (name: SoundName) => void;
  playHandPreview: (hand: HandCall) => void;
  /** Start a looping sound. Restarts from the beginning each time. */
  startLoop: (name: SoundName) => void;
  /** Stop a currently looping sound with a short fade-out. */
  stopLoop: (name: SoundName) => void;
  /** Stop all active loops — useful for cleanup on navigation. */
  stopAllLoops: () => void;
  muted: boolean;
  toggleMute: () => void;
  volume: number;
  setVolume: (v: number) => void;
}

// Tracks active looping audio sources so they can be stopped
interface ActiveLoop {
  source: AudioBufferSourceNode;
  gainNode: GainNode;
}

export function createSoundController(): SoundController {
  let muted = localStorage.getItem(MUTE_KEY) === 'true';
  let volume = parseFloat(localStorage.getItem(VOLUME_KEY) ?? '1');
  if (isNaN(volume) || volume < 0 || volume > 1) volume = 1;

  const activeLoops = new Map<SoundName, ActiveLoop>();

  const controller: SoundController = {
    get muted() { return muted; },
    get volume() { return volume; },

    play(name: SoundName) {
      if (muted) return;

      const haptic = HAPTIC_PATTERNS[name];
      if (haptic) vibrate(haptic);

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
        { frequency: freq, duration: 0.07, type: 'sine', gain: 0.04, ramp: 0.06 },
        { frequency: freq * 1.5, duration: 0.05, type: 'triangle', gain: 0.02, ramp: 0.04 },
      ];

      // ROYAL_FLUSH: add a shimmer sparkle tone
      if (hand.type === HandType.ROYAL_FLUSH) {
        tones.push({ frequency: 3000, duration: 0.03, type: 'sine', gain: 0.015, ramp: 0.025 });
      }

      playTones(tones, volume);
    },

    startLoop(name: SoundName) {
      // Stop any existing loop for this sound first
      controller.stopLoop(name);

      if (muted) return;

      const audioEntry = AUDIO_FILE_SOUNDS[name];
      if (!audioEntry) return;

      const ctx = getAudioContext();
      if (!ctx) return;

      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const startPlayback = (buf: AudioBuffer) => {
        const source = ctx.createBufferSource();
        const gainNode = ctx.createGain();
        source.buffer = buf;
        source.loop = true;
        const effectiveGain = volume * audioEntry.gain;
        gainNode.gain.setValueAtTime(effectiveGain, ctx.currentTime);
        source.connect(gainNode);
        gainNode.connect(ctx.destination);
        source.start(0);
        activeLoops.set(name, { source, gainNode });
      };

      const cached = audioBufferCache.get(audioEntry.url);
      if (cached) {
        startPlayback(cached);
        return;
      }

      loadAudioBuffer(audioEntry.url).then(buf => {
        if (!buf) return;
        // Check we haven't been stopped while loading
        if (!activeLoops.has(name)) return;
        startPlayback(buf);
      });
      // Set a placeholder so stopLoop knows a load is pending
      // (will be overwritten by startPlayback or cleaned up by stopLoop)
    },

    stopLoop(name: SoundName) {
      const loop = activeLoops.get(name);
      if (!loop) {
        activeLoops.delete(name);
        return;
      }

      const ctx = getAudioContext();
      if (ctx) {
        // Short fade-out to avoid click
        const now = ctx.currentTime;
        loop.gainNode.gain.setValueAtTime(loop.gainNode.gain.value, now);
        loop.gainNode.gain.linearRampToValueAtTime(0, now + 0.05);
        try { loop.source.stop(now + 0.06); } catch { /* already stopped */ }
      } else {
        try { loop.source.stop(); } catch { /* already stopped */ }
      }

      activeLoops.delete(name);
    },

    stopAllLoops() {
      for (const name of [...activeLoops.keys()]) {
        controller.stopLoop(name);
      }
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
