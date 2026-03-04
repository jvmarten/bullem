import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Room } from './Room.js';
import { GamePhase } from '@bull-em/shared';

describe('Room reconnection security', () => {
  let room: Room;
  let reconnectToken: string;

  beforeEach(() => {
    room = new Room('TEST');
    const { reconnectToken: token } = room.addPlayer('socket1', 'p1', 'Alice');
    reconnectToken = token;
    room.addPlayer('socket2', 'p2', 'Bob');
  });

  it('rejects reconnect without a token', () => {
    room.gamePhase = GamePhase.PLAYING;
    // Simulate disconnect
    room.handleDisconnect('socket1');

    const result = room.handleReconnect('socket3', 'p1', undefined);
    expect(result).toBeNull();
  });

  it('rejects reconnect with wrong token', () => {
    room.gamePhase = GamePhase.PLAYING;
    room.handleDisconnect('socket1');

    const result = room.handleReconnect('socket3', 'p1', 'wrong-token');
    expect(result).toBeNull();
  });

  it('rejects reconnect for non-existent player', () => {
    room.gamePhase = GamePhase.PLAYING;
    const result = room.handleReconnect('socket3', 'ghost', 'any-token');
    expect(result).toBeNull();
  });

  it('rejects reconnect for already-connected player (session hijack attempt)', () => {
    // p1 is still connected — someone else tries to reconnect as p1
    const result = room.handleReconnect('socket3', 'p1', reconnectToken);
    expect(result).toBeNull();
  });

  it('accepts reconnect with correct token and returns new token', () => {
    room.gamePhase = GamePhase.PLAYING;
    room.handleDisconnect('socket1');

    const newToken = room.handleReconnect('socket3', 'p1', reconnectToken);
    expect(newToken).not.toBeNull();
    expect(newToken).not.toBe(reconnectToken); // token rotated
  });

  it('rotated token invalidates old token (token rotation)', () => {
    room.gamePhase = GamePhase.PLAYING;
    room.handleDisconnect('socket1');

    const newToken = room.handleReconnect('socket3', 'p1', reconnectToken);
    expect(newToken).not.toBeNull();

    // Simulate another disconnect
    room.handleDisconnect('socket3');

    // Old token should no longer work
    const result1 = room.handleReconnect('socket4', 'p1', reconnectToken);
    expect(result1).toBeNull();

    // New token should work
    const result2 = room.handleReconnect('socket4', 'p1', newToken!);
    expect(result2).not.toBeNull();
  });

  it('clears disconnect timer on successful reconnect', () => {
    vi.useFakeTimers();
    room.gamePhase = GamePhase.PLAYING;

    let timedOut = false;
    room.handleDisconnect('socket1', () => { timedOut = true; });

    // Reconnect before timeout
    const result = room.handleReconnect('socket3', 'p1', reconnectToken);
    expect(result).not.toBeNull();

    // Advance past timeout — should NOT fire
    vi.advanceTimersByTime(60_000);
    expect(timedOut).toBe(false);

    vi.useRealTimers();
  });

  it('marks player as connected after reconnect', () => {
    room.gamePhase = GamePhase.PLAYING;
    room.handleDisconnect('socket1');

    const player = room.players.get('p1');
    expect(player?.isConnected).toBe(false);

    room.handleReconnect('socket3', 'p1', reconnectToken);
    expect(player?.isConnected).toBe(true);
  });

  it('updates socket mapping after reconnect', () => {
    room.gamePhase = GamePhase.PLAYING;
    room.handleDisconnect('socket1');

    room.handleReconnect('socket3', 'p1', reconnectToken);

    expect(room.getSocketId('p1')).toBe('socket3');
    expect(room.getPlayerId('socket3')).toBe('p1');
    // Old socket mapping should be gone
    expect(room.getPlayerId('socket1')).toBeUndefined();
  });
});

describe('Room host reassignment', () => {
  it('reassigns host when host leaves in lobby', () => {
    const room = new Room('TEST');
    room.addPlayer('s1', 'p1', 'Alice');
    room.addPlayer('s2', 'p2', 'Bob');
    room.addPlayer('s3', 'p3', 'Charlie');

    expect(room.hostId).toBe('p1');

    room.removePlayer('s1');

    expect(room.hostId).not.toBe('p1');
    const newHost = room.players.get(room.hostId);
    expect(newHost?.isHost).toBe(true);
  });

  it('first player becomes host', () => {
    const room = new Room('TEST');
    room.addPlayer('s1', 'p1', 'Alice');

    expect(room.hostId).toBe('p1');
    expect(room.players.get('p1')?.isHost).toBe(true);
  });

  it('second player is not host', () => {
    const room = new Room('TEST');
    room.addPlayer('s1', 'p1', 'Alice');
    room.addPlayer('s2', 'p2', 'Bob');

    expect(room.players.get('p2')?.isHost).toBe(false);
  });
});

describe('Room disconnect handling', () => {
  it('removes player immediately in LOBBY phase', () => {
    const room = new Room('TEST');
    room.addPlayer('s1', 'p1', 'Alice');
    room.addPlayer('s2', 'p2', 'Bob');

    room.handleDisconnect('s1');

    expect(room.players.has('p1')).toBe(false);
    expect(room.playerCount).toBe(1);
  });

  it('marks player disconnected during game but does not remove', () => {
    const room = new Room('TEST');
    room.addPlayer('s1', 'p1', 'Alice');
    room.addPlayer('s2', 'p2', 'Bob');
    room.gamePhase = GamePhase.PLAYING;

    room.handleDisconnect('s1');

    expect(room.players.has('p1')).toBe(true);
    expect(room.players.get('p1')?.isConnected).toBe(false);
    expect(room.playerCount).toBe(2);
  });

  it('fires timeout callback after DISCONNECT_TIMEOUT_MS', () => {
    vi.useFakeTimers();
    const room = new Room('TEST');
    room.addPlayer('s1', 'p1', 'Alice');
    room.addPlayer('s2', 'p2', 'Bob');
    room.gamePhase = GamePhase.PLAYING;

    let timedOutId: string | null = null;
    room.handleDisconnect('s1', (id) => { timedOutId = id; });

    expect(timedOutId).toBeNull();

    vi.advanceTimersByTime(30_000);
    expect(timedOutId).toBe('p1');

    vi.useRealTimers();
  });

  it('returns null for unknown socket', () => {
    const room = new Room('TEST');
    room.addPlayer('s1', 'p1', 'Alice');

    const result = room.handleDisconnect('unknown');
    expect(result).toBeNull();
  });
});

describe('Room bot management', () => {
  it('adds bot player with isBot flag', () => {
    const room = new Room('TEST');
    const bot = room.addBot('bot1', 'Bot Brady');

    expect(bot.isBot).toBe(true);
    expect(bot.name).toBe('Bot Brady');
    expect(room.playerCount).toBe(1);
  });

  it('removeBot only removes bots, not humans', () => {
    const room = new Room('TEST');
    room.addPlayer('s1', 'p1', 'Alice');
    room.addBot('bot1', 'Bot Brady');

    room.removeBot('p1'); // try to remove human
    expect(room.players.has('p1')).toBe(true);

    room.removeBot('bot1'); // remove bot
    expect(room.players.has('bot1')).toBe(false);
  });

  it('isEmpty returns true when only bots remain', () => {
    const room = new Room('TEST');
    room.addBot('bot1', 'Bot Brady');

    expect(room.isEmpty).toBe(true);
  });

  it('isEmpty returns false when human players exist', () => {
    const room = new Room('TEST');
    room.addPlayer('s1', 'p1', 'Alice');
    room.addBot('bot1', 'Bot Brady');

    expect(room.isEmpty).toBe(false);
  });
});

describe('Room round continue window', () => {
  it('marks bots as ready immediately', () => {
    const room = new Room('TEST');
    room.addPlayer('s1', 'p1', 'Alice');
    room.addBot('bot1', 'Bot Brady');

    room.beginRoundContinueWindow(5000, () => {});

    // Bot is ready, human is not → not complete
    expect(room.isRoundContinueComplete).toBe(false);

    // Mark human ready
    room.markRoundContinueReady('p1');
    expect(room.isRoundContinueComplete).toBe(true);
  });

  it('markRoundContinueReady is idempotent', () => {
    const room = new Room('TEST');
    room.addPlayer('s1', 'p1', 'Alice');
    room.beginRoundContinueWindow(5000, () => {});

    const first = room.markRoundContinueReady('p1');
    const second = room.markRoundContinueReady('p1');

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('rejects eliminated player from marking ready', () => {
    const room = new Room('TEST');
    room.addPlayer('s1', 'p1', 'Alice');
    room.addPlayer('s2', 'p2', 'Bob');
    const p1 = room.players.get('p1')!;
    p1.isEliminated = true;

    room.beginRoundContinueWindow(5000, () => {});

    const result = room.markRoundContinueReady('p1');
    expect(result).toBe(false);
  });

  it('fires timeout callback', () => {
    vi.useFakeTimers();
    const room = new Room('TEST');
    room.addPlayer('s1', 'p1', 'Alice');

    let timedOut = false;
    room.beginRoundContinueWindow(5000, () => { timedOut = true; });

    vi.advanceTimersByTime(5000);
    expect(timedOut).toBe(true);

    vi.useRealTimers();
  });

  it('cancelRoundContinueWindow clears timer', () => {
    vi.useFakeTimers();
    const room = new Room('TEST');
    room.addPlayer('s1', 'p1', 'Alice');

    let timedOut = false;
    room.beginRoundContinueWindow(5000, () => { timedOut = true; });
    room.cancelRoundContinueWindow();

    vi.advanceTimersByTime(5000);
    expect(timedOut).toBe(false);

    vi.useRealTimers();
  });
});

describe('Room settings management', () => {
  it('updateSettings changes settings in LOBBY phase', () => {
    const room = new Room('TEST');
    room.updateSettings({ maxCards: 3, turnTimer: 15 });

    expect(room.settings.maxCards).toBe(3);
    expect(room.settings.turnTimer).toBe(15);
  });

  it('updateSettings is ignored during PLAYING phase', () => {
    const room = new Room('TEST');
    room.gamePhase = GamePhase.PLAYING;
    room.updateSettings({ maxCards: 1, turnTimer: 60 });

    // Should still have default settings
    expect(room.settings.maxCards).not.toBe(1);
  });
});

describe('Room spectator state', () => {
  it('getSpectatorGameState returns null when no game', () => {
    const room = new Room('TEST');
    expect(room.getSpectatorGameState()).toBeNull();
  });

  it('getSpectatorGameState returns empty myCards', () => {
    const room = new Room('TEST');
    room.addPlayer('s1', 'p1', 'Alice');
    room.addPlayer('s2', 'p2', 'Bob');
    room.startGame();

    const state = room.getSpectatorGameState();
    expect(state).not.toBeNull();
    expect(state!.myCards).toEqual([]);
  });

  it('getSpectatorGameState includes spectatorCards when spectatorsCanSeeCards is true', () => {
    const room = new Room('TEST');
    room.addPlayer('s1', 'p1', 'Alice');
    room.addPlayer('s2', 'p2', 'Bob');
    room.settings.spectatorsCanSeeCards = true;
    room.startGame();

    const state = room.getSpectatorGameState();
    expect(state!.spectatorCards).toBeDefined();
    expect(state!.spectatorCards!.length).toBe(2);
  });

  it('getSpectatorGameState excludes spectatorCards when spectatorsCanSeeCards is false', () => {
    const room = new Room('TEST');
    room.addPlayer('s1', 'p1', 'Alice');
    room.addPlayer('s2', 'p2', 'Bob');
    room.settings.spectatorsCanSeeCards = false;
    room.startGame();

    const state = room.getSpectatorGameState();
    expect(state!.spectatorCards).toBeUndefined();
  });
});
