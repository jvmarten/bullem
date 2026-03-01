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
  | 'timerTick';

interface ToneConfig {
  frequency: number;
  duration: number;
  type: OscillatorType;
  gain: number;
  ramp?: number;          // fade-out end time (relative)
  detune?: number;
  delay?: number;         // start delay in seconds
}

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
  roundLose: [
    // "FAH" — punchy descending burst, buzzy attack with fast drop-off
    { frequency: 300, duration: 0.35, type: 'sawtooth', gain: 0.18, ramp: 0.3 },
    { frequency: 250, duration: 0.3, type: 'square', gain: 0.06, ramp: 0.25 },
    { frequency: 180, duration: 0.25, type: 'sawtooth', gain: 0.1, ramp: 0.2, delay: 0.03 },
    { frequency: 120, duration: 0.4, type: 'triangle', gain: 0.08, ramp: 0.35, delay: 0.05 },
  ],
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
  let volume = parseFloat(localStorage.getItem(VOLUME_KEY) ?? '0.7');
  if (isNaN(volume) || volume < 0 || volume > 1) volume = 0.7;

  const controller: SoundController = {
    get muted() { return muted; },
    get volume() { return volume; },

    play(name: SoundName) {
      if (muted) return;
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
