/**
 * Integration tests for Room lifecycle: game start, round continue,
 * rematch flow, serialization round-trip, and state integrity
 * during complex multi-player scenarios.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Room } from './Room.js';
import { GamePhase } from '@bull-em/shared';

afterEach(() => {
  vi.restoreAllMocks();
});

function addPlayers(room: Room, count: number): string[] {
  const tokens: string[] = [];
  for (let i = 0; i < count; i++) {
    const { reconnectToken } = room.addPlayer(`socket-${i}`, `p${i}`, `Player${i}`);
    tokens.push(reconnectToken);
  }
  return tokens;
}

describe('Room.startGame', () => {
  it('transitions from LOBBY to PLAYING', () => {
    const room = new Room('TEST');
    addPlayers(room, 3);

    expect(room.gamePhase).toBe(GamePhase.LOBBY);
    room.startGame();
    expect(room.gamePhase).toBe(GamePhase.PLAYING);
    expect(room.game).not.toBeNull();
  });

  it('creates a new game engine with all players', () => {
    const room = new Room('TEST');
    addPlayers(room, 4);
    room.startGame();

    const activePlayers = room.game!.getActivePlayers();
    expect(activePlayers.length).toBe(4);
  });

  it('sets gameStartedAt timestamp', () => {
    const room = new Room('TEST');
    addPlayers(room, 2);

    expect(room.gameStartedAt).toBeNull();
    room.startGame();
    expect(room.gameStartedAt).toBeInstanceOf(Date);
  });

  it('clears previous elimination order', () => {
    const room = new Room('TEST');
    addPlayers(room, 2);
    room.eliminationOrder = ['old-player'];
    room.startGame();
    expect(room.eliminationOrder).toEqual([]);
  });

  it('assigns a unique currentGameId', () => {
    const room = new Room('TEST');
    addPlayers(room, 2);
    room.startGame();
    expect(room.currentGameId).toBeTruthy();
    expect(typeof room.currentGameId).toBe('string');
  });
});

describe('Room.resetForRematch', () => {
  it('resets all players to starting state', () => {
    const room = new Room('RMTCH');
    addPlayers(room, 3);
    room.startGame();

    // Simulate some game progress
    const players = [...room.players.values()];
    players[0]!.cardCount = 4;
    players[1]!.isEliminated = true;

    room.resetForRematch();

    for (const p of room.players.values()) {
      expect(p.cardCount).toBe(1); // STARTING_CARDS
      expect(p.isEliminated).toBe(false);
    }
  });

  it('removes disconnected players during rematch', () => {
    const room = new Room('RMTCH');
    addPlayers(room, 3);
    room.startGame();

    // Disconnect player 2
    const p2 = [...room.players.values()][2]!;
    p2.isConnected = false;

    room.resetForRematch();

    // Player 2 should be removed
    expect(room.players.has(p2.id)).toBe(false);
    expect(room.players.size).toBe(2);
  });

  it('keeps bots even if "disconnected"', () => {
    const room = new Room('RMTCH');
    addPlayers(room, 2);
    room.addBot('bot-1', 'TestBot');
    room.startGame();

    room.resetForRematch();
    expect(room.players.has('bot-1')).toBe(true);
  });
});

describe('Room round continue window', () => {
  it('marks bots as ready immediately', () => {
    const room = new Room('CONT');
    addPlayers(room, 2);
    room.addBot('bot-1', 'Bot');
    room.startGame();

    room.beginRoundContinueWindow(5000, () => {});

    // Bot should already be marked ready
    expect(room.markRoundContinueReady('bot-1')).toBe(false); // already marked
  });

  it('completes when all connected humans are ready', () => {
    const room = new Room('CONT');
    addPlayers(room, 2);
    room.startGame();

    room.beginRoundContinueWindow(5000, () => {});

    expect(room.isRoundContinueComplete).toBe(false);
    room.markRoundContinueReady('p0');
    expect(room.isRoundContinueComplete).toBe(false);
    room.markRoundContinueReady('p1');
    expect(room.isRoundContinueComplete).toBe(true);
  });

  it('does not wait for disconnected players', () => {
    const room = new Room('CONT');
    addPlayers(room, 2);
    room.startGame();

    // Disconnect p1
    const p1 = room.players.get('p1')!;
    p1.isConnected = false;

    room.beginRoundContinueWindow(5000, () => {});

    // Only p0 needs to be ready
    room.markRoundContinueReady('p0');
    expect(room.isRoundContinueComplete).toBe(true);
  });

  it('rejects eliminated players', () => {
    const room = new Room('CONT');
    addPlayers(room, 2);
    room.startGame();

    const p1 = room.players.get('p1')!;
    p1.isEliminated = true;

    room.beginRoundContinueWindow(5000, () => {});

    expect(room.markRoundContinueReady('p1')).toBe(false);
  });

  it('cancelRoundContinueWindow clears timer', () => {
    const room = new Room('CONT');
    addPlayers(room, 2);
    room.startGame();

    const fn = vi.fn();
    room.beginRoundContinueWindow(100, fn);
    room.cancelRoundContinueWindow();

    // Wait longer than timeout — callback should NOT fire
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(fn).not.toHaveBeenCalled();
        resolve();
      }, 200);
    });
  });
});

describe('Room.handleDisconnect', () => {
  it('removes player during LOBBY phase', () => {
    const room = new Room('DC');
    addPlayers(room, 2);

    const removed = room.handleDisconnect('socket-1');
    expect(removed).toBe('p1');
    expect(room.players.has('p1')).toBe(false);
  });

  it('marks player as disconnected during PLAYING phase', () => {
    const room = new Room('DC');
    addPlayers(room, 2);
    room.startGame();

    const disconnected = room.handleDisconnect('socket-1');
    expect(disconnected).toBe('p1');

    const player = room.players.get('p1');
    expect(player).toBeDefined();
    expect(player!.isConnected).toBe(false);
  });

  it('fires timeout callback after DISCONNECT_TIMEOUT_MS', () => {
    vi.useFakeTimers();
    const room = new Room('DC');
    addPlayers(room, 2);
    room.startGame();

    const fn = vi.fn();
    room.handleDisconnect('socket-1', fn);

    // Should not fire immediately
    expect(fn).not.toHaveBeenCalled();

    // Fast-forward past disconnect timeout (180s)
    vi.advanceTimersByTime(180_001);
    expect(fn).toHaveBeenCalledWith('p1');

    vi.useRealTimers();
  });

  it('returns null for unknown socket', () => {
    const room = new Room('DC');
    addPlayers(room, 1);
    expect(room.handleDisconnect('unknown-socket')).toBeNull();
  });
});

describe('Room.handleReconnect', () => {
  it('reconnects with valid token', () => {
    const room = new Room('RC');
    const tokens = addPlayers(room, 2);
    room.startGame();

    // Disconnect p1
    room.handleDisconnect('socket-1');
    expect(room.players.get('p1')!.isConnected).toBe(false);

    // Reconnect with valid token
    const newToken = room.handleReconnect('new-socket', 'p1', tokens[1]);
    expect(newToken).toBeTruthy();
    expect(room.players.get('p1')!.isConnected).toBe(true);
    expect(room.getPlayerId('new-socket')).toBe('p1');
  });

  it('rejects reconnect with wrong token', () => {
    const room = new Room('RC');
    addPlayers(room, 2);
    room.startGame();
    room.handleDisconnect('socket-1');

    const result = room.handleReconnect('new-socket', 'p1', 'wrong-token');
    expect(result).toBeNull();
    expect(room.players.get('p1')!.isConnected).toBe(false);
  });

  it('rejects reconnect for already-connected player (hijack prevention)', () => {
    const room = new Room('RC');
    const tokens = addPlayers(room, 2);
    room.startGame();

    // Try to "reconnect" a player who is already connected
    const result = room.handleReconnect('attacker-socket', 'p1', tokens[1]);
    expect(result).toBeNull();
  });

  it('rotates token on successful reconnect', () => {
    const room = new Room('RC');
    const tokens = addPlayers(room, 2);
    room.startGame();
    room.handleDisconnect('socket-1');

    const newToken = room.handleReconnect('new-socket', 'p1', tokens[1])!;
    expect(newToken).not.toBe(tokens[1]);

    // Old token should no longer work
    room.handleDisconnect('new-socket');
    const result = room.handleReconnect('another-socket', 'p1', tokens[1]);
    expect(result).toBeNull();

    // New token should work
    const finalToken = room.handleReconnect('another-socket', 'p1', newToken);
    expect(finalToken).toBeTruthy();
  });
});

describe('Room.serialize/restore', () => {
  it('round-trips room state correctly', () => {
    const room = new Room('SNAP');
    addPlayers(room, 3);
    room.settings = { maxCards: 3, turnTimer: 30, botLevelCategory: 'mixed' };
    room.startGame();

    const snapshot = room.serialize();
    const restored = Room.restore(snapshot);

    expect(restored.roomCode).toBe('SNAP');
    expect(restored.players.size).toBe(3);
    expect(restored.gamePhase).toBe(GamePhase.PLAYING);
    expect(restored.settings.maxCards).toBe(3);
    expect(restored.game).not.toBeNull();
  });

  it('marks all humans as disconnected after restore', () => {
    const room = new Room('SNAP');
    addPlayers(room, 2);
    room.addBot('bot-1', 'Bot');
    room.startGame();

    const restored = Room.restore(room.serialize());

    for (const p of restored.players.values()) {
      if (p.isBot) {
        expect(p.isConnected).toBe(true);
      } else {
        expect(p.isConnected).toBe(false);
      }
    }
  });

  it('preserves reconnect tokens for rejoin', () => {
    const room = new Room('SNAP');
    const tokens = addPlayers(room, 2);
    room.startGame();

    const restored = Room.restore(room.serialize());

    // Should be able to reconnect with original token
    const result = restored.handleReconnect('new-socket', 'p0', tokens[0]);
    expect(result).toBeTruthy();
  });

  it('handles corrupted game snapshot gracefully', () => {
    const room = new Room('SNAP');
    addPlayers(room, 2);
    room.startGame();

    const snapshot = room.serialize();
    // Corrupt the game snapshot
    snapshot.gameSnapshot!.players = [];

    const restored = Room.restore(snapshot);

    // Should fall back to LOBBY instead of crashing
    expect(restored.game).toBeNull();
    expect(restored.gamePhase).toBe(GamePhase.LOBBY);
  });
});

describe('Room.isEmpty', () => {
  it('empty when no players', () => {
    const room = new Room('EMPT');
    expect(room.isEmpty).toBe(true);
  });

  it('not empty with connected human', () => {
    const room = new Room('EMPT');
    addPlayers(room, 1);
    expect(room.isEmpty).toBe(false);
  });

  it('empty with only bots', () => {
    const room = new Room('EMPT');
    room.addBot('bot-1', 'Bot');
    expect(room.isEmpty).toBe(true);
  });

  it('not empty with disconnected human who has reconnect timer', () => {
    const room = new Room('EMPT');
    addPlayers(room, 1);
    room.startGame();
    room.handleDisconnect('socket-0', () => {});

    // Player is disconnected but has a timer — room should NOT be empty
    expect(room.isEmpty).toBe(false);

    room.cleanup();
  });
});

describe('Room.recordEliminations', () => {
  it('tracks elimination order', () => {
    const room = new Room('ELIM');
    room.recordEliminations(['p1', 'p2']);
    expect(room.eliminationOrder).toEqual(['p1', 'p2']);
  });

  it('does not duplicate players', () => {
    const room = new Room('ELIM');
    room.recordEliminations(['p1']);
    room.recordEliminations(['p1', 'p2']);
    expect(room.eliminationOrder).toEqual(['p1', 'p2']);
  });
});

describe('Room.updateSettings', () => {
  it('applies settings in LOBBY phase', () => {
    const room = new Room('SET');
    addPlayers(room, 2);

    room.updateSettings({ maxCards: 3, turnTimer: 60, botLevelCategory: 'hard' });
    expect(room.settings.maxCards).toBe(3);
    expect(room.settings.turnTimer).toBe(60);
  });

  it('ignores settings changes during PLAYING phase', () => {
    const room = new Room('SET');
    addPlayers(room, 2);
    room.startGame();

    const originalMaxCards = room.settings.maxCards;
    room.updateSettings({ maxCards: 1, turnTimer: 15, botLevelCategory: 'easy' });
    expect(room.settings.maxCards).toBe(originalMaxCards);
  });
});

describe('Room host reassignment', () => {
  it('reassigns host when host leaves in lobby', () => {
    const room = new Room('HOST');
    addPlayers(room, 3);
    expect(room.hostId).toBe('p0');

    room.removePlayer('socket-0');
    expect(room.hostId).not.toBe('p0');
    const newHost = room.players.get(room.hostId);
    expect(newHost!.isHost).toBe(true);
  });

  it('reassigns host to non-bot player when host detaches', () => {
    const room = new Room('HOST');
    addPlayers(room, 2);
    room.addBot('bot-1', 'Bot');
    room.startGame();

    // Detach p0 (host)
    room.detachPlayer('socket-0');

    // Host should be reassigned to p1 (human), not bot
    expect(room.hostId).toBe('p1');
  });
});

describe('Room spectator state', () => {
  it('returns null spectator state when no game', () => {
    const room = new Room('SPEC');
    addPlayers(room, 2);
    expect(room.getSpectatorGameState()).toBeNull();
  });

  it('returns state with empty myCards for spectators', () => {
    const room = new Room('SPEC');
    addPlayers(room, 2);
    room.startGame();

    const state = room.getSpectatorGameState();
    expect(state).not.toBeNull();
    expect(state!.myCards).toEqual([]);
  });

  it('includes spectatorCards when setting is enabled', () => {
    const room = new Room('SPEC');
    addPlayers(room, 2);
    room.settings.spectatorsCanSeeCards = true;
    room.startGame();

    const state = room.getSpectatorGameState();
    expect(state!.spectatorCards).toBeDefined();
    expect(state!.spectatorCards!.length).toBeGreaterThan(0);
  });

  it('excludes spectatorCards when setting is disabled', () => {
    const room = new Room('SPEC');
    addPlayers(room, 2);
    room.settings.spectatorsCanSeeCards = false;
    room.startGame();

    const state = room.getSpectatorGameState();
    expect(state!.spectatorCards).toBeUndefined();
  });
});
