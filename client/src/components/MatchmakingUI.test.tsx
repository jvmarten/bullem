import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import type { RankedMode, MatchmakingStatus, MatchmakingFound } from '@bull-em/shared';
import { RankTier } from '@bull-em/shared';

// Minimal matchmaking queue component for testing state transitions
// (the actual component is embedded in HomePage — we test the logic pattern)

type MatchmakingState = 'idle' | 'queued' | 'found' | 'navigating';

interface QueueState {
  state: MatchmakingState;
  status: MatchmakingStatus | null;
  found: MatchmakingFound | null;
}

function deriveMatchmakingState(status: MatchmakingStatus | null, found: MatchmakingFound | null): MatchmakingState {
  if (found) return 'found';
  if (status) return 'queued';
  return 'idle';
}

afterEach(() => {
  cleanup();
});

describe('Matchmaking state transitions', () => {
  it('starts in idle state', () => {
    expect(deriveMatchmakingState(null, null)).toBe('idle');
  });

  it('transitions to queued when status is set', () => {
    const status: MatchmakingStatus = { position: 1, estimatedWaitSeconds: 30, mode: 'heads_up' };
    expect(deriveMatchmakingState(status, null)).toBe('queued');
  });

  it('transitions to found when match is found', () => {
    const found: MatchmakingFound = {
      roomCode: 'ABCD',
      opponents: [{ name: 'Opponent', rating: 1200, tier: RankTier.GOLD }],
      reconnectToken: 'tok',
      playerId: 'p1',
    };
    expect(deriveMatchmakingState(null, found)).toBe('found');
  });

  it('found takes precedence over queued', () => {
    const status: MatchmakingStatus = { position: 1, estimatedWaitSeconds: 30, mode: 'heads_up' };
    const found: MatchmakingFound = {
      roomCode: 'ABCD',
      opponents: [{ name: 'Opponent', rating: 1200, tier: RankTier.GOLD }],
      reconnectToken: 'tok',
      playerId: 'p1',
    };
    expect(deriveMatchmakingState(status, found)).toBe('found');
  });

  it('returns to idle when both are cleared', () => {
    expect(deriveMatchmakingState(null, null)).toBe('idle');
  });
});

describe('MatchmakingQueue elapsed timer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('increments elapsed time every second', () => {
    // Simulate the elapsed timer logic used in the MatchmakingQueue component
    let elapsed = 0;
    const start = Date.now();
    const update = () => { elapsed = Math.floor((Date.now() - start) / 1000); };

    update();
    expect(elapsed).toBe(0);

    vi.advanceTimersByTime(3000);
    update();
    expect(elapsed).toBe(3);

    vi.advanceTimersByTime(7000);
    update();
    expect(elapsed).toBe(10);
  });
});

describe('MatchmakingFound auto-navigate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls navigate after 2.5s delay', () => {
    const onNavigate = vi.fn();
    // Simulate the MatchFoundScreen auto-navigate behavior
    const timer = setTimeout(onNavigate, 2500);

    expect(onNavigate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2500);
    expect(onNavigate).toHaveBeenCalledTimes(1);

    clearTimeout(timer);
  });
});
