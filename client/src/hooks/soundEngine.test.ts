import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the mp3 import before importing the module under test
vi.mock('../assets/sounds/fah.mp3', () => ({ default: 'fah.mp3' }));

const mockAudioPlay = vi.fn().mockResolvedValue(undefined);
vi.stubGlobal('Audio', vi.fn(() => ({
  play: mockAudioPlay,
  volume: 1,
})));

import { createSoundController } from './soundEngine.js';

// Mock AudioContext since jsdom doesn't provide Web Audio API
const mockOscillator = {
  type: '' as OscillatorType,
  frequency: { value: 0 },
  detune: { value: 0 },
  connect: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
};

const mockGainNode = {
  gain: {
    value: 0,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  },
  connect: vi.fn(),
};

const mockAudioContext = {
  currentTime: 0,
  state: 'running' as AudioContextState,
  destination: {},
  resume: vi.fn().mockResolvedValue(undefined),
  createOscillator: vi.fn(() => ({ ...mockOscillator })),
  createGain: vi.fn(() => ({
    ...mockGainNode,
    gain: {
      value: 0,
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
  })),
};

vi.stubGlobal('AudioContext', vi.fn(() => mockAudioContext));

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('createSoundController', () => {
  it('creates a controller with default values', () => {
    const ctrl = createSoundController();
    expect(ctrl.muted).toBe(false);
    expect(ctrl.volume).toBeCloseTo(0.7);
  });

  it('respects muted state from localStorage', () => {
    localStorage.setItem('bull-em-muted', 'true');
    const ctrl = createSoundController();
    expect(ctrl.muted).toBe(true);
  });

  it('respects volume from localStorage', () => {
    localStorage.setItem('bull-em-volume', '0.3');
    const ctrl = createSoundController();
    expect(ctrl.volume).toBeCloseTo(0.3);
  });

  it('toggleMute toggles muted state and persists', () => {
    const ctrl = createSoundController();
    expect(ctrl.muted).toBe(false);

    ctrl.toggleMute();
    expect(ctrl.muted).toBe(true);
    expect(localStorage.getItem('bull-em-muted')).toBe('true');

    ctrl.toggleMute();
    expect(ctrl.muted).toBe(false);
    expect(localStorage.getItem('bull-em-muted')).toBe('false');
  });

  it('setVolume clamps and persists', () => {
    const ctrl = createSoundController();
    ctrl.setVolume(0.5);
    expect(ctrl.volume).toBeCloseTo(0.5);
    expect(localStorage.getItem('bull-em-volume')).toBe('0.5');

    ctrl.setVolume(2);
    expect(ctrl.volume).toBeCloseTo(1);

    ctrl.setVolume(-1);
    expect(ctrl.volume).toBeCloseTo(0);
  });

  it('play does not throw for valid sound names', () => {
    const ctrl = createSoundController();
    expect(() => ctrl.play('cardDeal')).not.toThrow();
    expect(() => ctrl.play('bullCalled')).not.toThrow();
    expect(() => ctrl.play('yourTurn')).not.toThrow();
  });

  it('play does nothing when muted', () => {
    const ctrl = createSoundController();
    ctrl.toggleMute();
    ctrl.play('cardDeal');
    // AudioContext createOscillator should not be called when muted
    expect(mockAudioContext.createOscillator).not.toHaveBeenCalled();
  });

  it('play creates oscillators when not muted', () => {
    const ctrl = createSoundController();
    ctrl.play('yourTurn');
    // yourTurn has 2 tones
    expect(mockAudioContext.createOscillator).toHaveBeenCalledTimes(2);
  });

  it('handles invalid volume in localStorage gracefully', () => {
    localStorage.setItem('bull-em-volume', 'not-a-number');
    const ctrl = createSoundController();
    expect(ctrl.volume).toBeCloseTo(0.7); // falls back to default
  });

  it('plays audio file for roundLose instead of oscillators', () => {
    const ctrl = createSoundController();
    ctrl.play('roundLose');
    expect(mockAudioPlay).toHaveBeenCalled();
    // Should NOT create oscillators for audio-file-backed sounds
    expect(mockAudioContext.createOscillator).not.toHaveBeenCalled();
  });
});
