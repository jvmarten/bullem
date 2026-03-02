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
  | 'uiClick';

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
    { frequency: 200, duration: 0.25, type: 'sine', gain: 0.18, ramp: 0.22 },
    { frequency: 160, duration: 0.3, type: 'triangle', gain: 0.1, delay: 0.08 },
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
    { frequency: 1800, duration: 0.03, type: 'sine', gain: 0.06, ramp: 0.025 },
  ],
  uiClick: [
    { frequency: 900, duration: 0.06, type: 'sine', gain: 0.12, ramp: 0.05 },
    { frequency: 1400, duration: 0.04, type: 'triangle', gain: 0.06, delay: 0.02 },
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

const MUTE_KEY = 'bull-em-muted';
const VOLUME_KEY = 'bull-em-volume';

export interface SoundController {
  play: (name: SoundName) => void;
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
