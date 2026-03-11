import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the mp3 import before importing the module under test
vi.mock('../assets/sounds/fah.mp3', () => ({ default: 'fah.mp3' }));

// Mock fetch for audio buffer loading
const mockArrayBuffer = new ArrayBuffer(8);
vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
  arrayBuffer: () => Promise.resolve(mockArrayBuffer),
})));

// Mock AudioContext since jsdom doesn't provide Web Audio API
const mockOscillator = {
  type: '' as OscillatorType,
  frequency: { value: 0 },
  detune: { value: 0 },
  connect: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
};

const mockBufferSource = {
  buffer: null as AudioBuffer | null,
  connect: vi.fn(),
  start: vi.fn(),
};

const mockGainNode = {
  gain: {
    value: 0,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  },
  connect: vi.fn(),
};

const mockDecodedBuffer = { duration: 1.3 } as AudioBuffer;

const mockAudioContext = {
  currentTime: 0,
  state: 'running' as AudioContextState,
  destination: {},
  resume: vi.fn().mockResolvedValue(undefined),
  createOscillator: vi.fn(() => ({ ...mockOscillator })),
  createBufferSource: vi.fn(() => ({ ...mockBufferSource })),
  createGain: vi.fn(() => ({
    ...mockGainNode,
    gain: {
      value: 0,
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    },
  })),
  decodeAudioData: vi.fn().mockResolvedValue(mockDecodedBuffer),
};

vi.stubGlobal('AudioContext', vi.fn(() => mockAudioContext));

// Mock matchMedia for prefers-reduced-motion detection
vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
  matches: false,
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  onchange: null,
  dispatchEvent: vi.fn(),
})));

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('createSoundController', () => {
  it('creates a controller with default values', () => {
    const ctrl = createSoundController();
    expect(ctrl.muted).toBe(false);
    expect(ctrl.volume).toBeCloseTo(1);
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

  it('play creates oscillators for oscillator-only sounds when not muted', () => {
    const ctrl = createSoundController();
    ctrl.play('uiHover');
    // uiHover has 1 oscillator tone (kept as oscillator for minimal latency)
    expect(mockAudioContext.createOscillator).toHaveBeenCalledTimes(1);
  });

  it('handles invalid volume in localStorage gracefully', () => {
    localStorage.setItem('bull-em-volume', 'not-a-number');
    const ctrl = createSoundController();
    expect(ctrl.volume).toBeCloseTo(1); // falls back to default
  });

  it('plays audio file for roundLose via AudioContext buffer', () => {
    const ctrl = createSoundController();
    ctrl.play('roundLose');
    // Should NOT create oscillators for audio-file-backed sounds
    expect(mockAudioContext.createOscillator).not.toHaveBeenCalled();
  });

  it('playHandPreview exists and does not throw for all HandType values', () => {
    const ctrl = createSoundController();
    expect(typeof ctrl.playHandPreview).toBe('function');

    const testHands: HandCall[] = [
      { type: HandType.HIGH_CARD, rank: '2' },
      { type: HandType.PAIR, rank: '7' },
      { type: HandType.TWO_PAIR, highRank: 'J', lowRank: '4' },
      { type: HandType.FLUSH, suit: 'hearts' },
      { type: HandType.THREE_OF_A_KIND, rank: '9' },
      { type: HandType.STRAIGHT, highRank: '9' },
      { type: HandType.FULL_HOUSE, threeRank: 'Q', twoRank: '3' },
      { type: HandType.FOUR_OF_A_KIND, rank: 'A' },
      { type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: '9' },
      { type: HandType.ROYAL_FLUSH, suit: 'diamonds' },
    ];
    for (const hand of testHands) {
      expect(() => ctrl.playHandPreview(hand)).not.toThrow();
    }
  });

  it('playHandPreview creates oscillators with pitch scaling', () => {
    const ctrl = createSoundController();
    ctrl.playHandPreview({ type: HandType.HIGH_CARD, rank: '2' }); // 2 tones
    expect(mockAudioContext.createOscillator).toHaveBeenCalledTimes(2);

    vi.clearAllMocks();
    ctrl.playHandPreview({ type: HandType.ROYAL_FLUSH, suit: 'spades' }); // 3 tones (+ shimmer)
    expect(mockAudioContext.createOscillator).toHaveBeenCalledTimes(3);
  });

  it('playHandPreview does nothing when muted', () => {
    const ctrl = createSoundController();
    ctrl.toggleMute();
    ctrl.playHandPreview({ type: HandType.STRAIGHT, highRank: '9' });
    expect(mockAudioContext.createOscillator).not.toHaveBeenCalled();
  });
});

// Import after mocks are set up
import { createSoundController } from './soundEngine.js';
import { HandType } from '@bull-em/shared';
import type { HandCall } from '@bull-em/shared';
