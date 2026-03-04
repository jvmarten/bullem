import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Room } from './Room.js';
import { GamePhase } from '@bull-em/shared';

describe('Room: player management edge cases', () => {
  let room: Room;

  beforeEach(() => {
    room = new Room('ABCD');
  });

  it('first player added becomes host', () => {
    room.addPlayer('s1', 'p1', 'Alice');
    expect(room.hostId).toBe('p1');
    const player = room.players.get('p1')!;
    expect(player.isHost).toBe(true);
  });

  it('second player is not host', () => {
    room.addPlayer('s1', 'p1', 'Alice');
    room.addPlayer('s2', 'p2', 'Bob');
    const p2 = room.players.get('p2')!;
    expect(p2.isHost).toBe(false);
  });

  it('host reassigned when host leaves', () => {
    room.addPlayer('s1', 'p1', 'Alice');
    room.addPlayer('s2', 'p2', 'Bob');
    room.addPlayer('s3', 'p3', 'Charlie');

    room.removePlayer('s1');
    expect(room.hostId).not.toBe('p1');
    const newHost = room.players.get(room.hostId)!;
    expect(newHost.isHost).toBe(true);
  });

  it('socket-player mappings are bidirectional and consistent', () => {
    room.addPlayer('s1', 'p1', 'Alice');
    room.addPlayer('s2', 'p2', 'Bob');

    expect(room.getPlayerId('s1')).toBe('p1');
    expect(room.getSocketId('p1')).toBe('s1');
    expect(room.getPlayerId('s2')).toBe('p2');
    expect(room.getSocketId('p2')).toBe('s2');
  });

  it('removePlayer cleans up all mappings', () => {
    room.addPlayer('s1', 'p1', 'Alice');
    room.removePlayer('s1');

    expect(room.getPlayerId('s1')).toBeUndefined();
    expect(room.getSocketId('p1')).toBeUndefined();
    expect(room.players.has('p1')).toBe(false);
  });

  it('removePlayer returns null for unknown socket', () => {
    const result = room.removePlayer('unknown');
    expect(result).toBeNull();
  });

  it('playerCount tracks current player count', () => {
    expect(room.playerCount).toBe(0);
    room.addPlayer('s1', 'p1', 'Alice');
    expect(room.playerCount).toBe(1);
    room.addPlayer('s2', 'p2', 'Bob');
    expect(room.playerCount).toBe(2);
    room.removePlayer('s1');
    expect(room.playerCount).toBe(1);
  });
});

describe('Room: bot management', () => {
  let room: Room;

  beforeEach(() => {
    room = new Room('ABCD');
    room.addPlayer('s1', 'p1', 'Alice');
  });

  it('addBot creates a bot player', () => {
    const bot = room.addBot('bot1', 'Bot Brady');
    expect(bot.isBot).toBe(true);
    expect(bot.name).toBe('Bot Brady');
    expect(bot.isConnected).toBe(true);
    expect(bot.isEliminated).toBe(false);
    expect(room.playerCount).toBe(2);
  });

  it('removeBot removes only bot players', () => {
    room.addBot('bot1', 'Bot Brady');
    room.removeBot('bot1');
    expect(room.players.has('bot1')).toBe(false);
    expect(room.playerCount).toBe(1);
  });

  it('removeBot ignores non-bot players', () => {
    room.removeBot('p1'); // p1 is human
    expect(room.players.has('p1')).toBe(true);
  });

  it('removeBot ignores non-existent ids', () => {
    room.removeBot('ghost');
    expect(room.playerCount).toBe(1);
  });

  it('isEmpty returns true when only bots remain', () => {
    room.addBot('bot1', 'Bot Brady');
    room.removePlayer('s1'); // remove human
    expect(room.isEmpty).toBe(true);
  });

  it('isEmpty returns false when human players present', () => {
    room.addBot('bot1', 'Bot Brady');
    expect(room.isEmpty).toBe(false);
  });
});

describe('Room: settings management', () => {
  let room: Room;

  beforeEach(() => {
    room = new Room('ABCD');
    room.addPlayer('s1', 'p1', 'Alice');
  });

  it('updateSettings works in LOBBY phase', () => {
    room.updateSettings({ maxCards: 3, turnTimer: 15 });
    expect(room.settings.maxCards).toBe(3);
    expect(room.settings.turnTimer).toBe(15);
  });

  it('updateSettings is ignored during PLAYING phase', () => {
    const original = { ...room.settings };
    room.gamePhase = GamePhase.PLAYING;
    room.updateSettings({ maxCards: 1, turnTimer: 60 });
    expect(room.settings.maxCards).toBe(original.maxCards);
  });

  it('updateSettings is ignored during ROUND_RESULT phase', () => {
    const original = { ...room.settings };
    room.gamePhase = GamePhase.ROUND_RESULT;
    room.updateSettings({ maxCards: 2, turnTimer: 30 });
    expect(room.settings.maxCards).toBe(original.maxCards);
  });
});

describe('Room: disconnect/reconnect flow', () => {
  let room: Room;
  let p1Token: string;

  beforeEach(() => {
    room = new Room('ABCD');
    const { reconnectToken } = room.addPlayer('s1', 'p1', 'Alice');
    p1Token = reconnectToken;
    room.addPlayer('s2', 'p2', 'Bob');
    room.addPlayer('s3', 'p3', 'Charlie');
  });

  afterEach(() => {
    room.cleanup();
  });

  it('disconnect in lobby removes the player', () => {
    room.gamePhase = GamePhase.LOBBY;
    const removedId = room.handleDisconnect('s1');
    expect(removedId).toBe('p1');
    expect(room.players.has('p1')).toBe(false);
  });

  it('disconnect during game marks player as disconnected but keeps them', () => {
    room.gamePhase = GamePhase.PLAYING;
    const removedId = room.handleDisconnect('s1');
    expect(removedId).toBe('p1');
    const player = room.players.get('p1')!;
    expect(player.isConnected).toBe(false);
    expect(player.isEliminated).toBe(false);
  });

  it('disconnect clears socket mappings', () => {
    room.gamePhase = GamePhase.PLAYING;
    room.handleDisconnect('s1');
    expect(room.getPlayerId('s1')).toBeUndefined();
    expect(room.getSocketId('p1')).toBeUndefined();
  });

  it('reconnect with correct token restores connection', () => {
    room.gamePhase = GamePhase.PLAYING;
    room.handleDisconnect('s1');

    const newToken = room.handleReconnect('s4', 'p1', p1Token);
    expect(newToken).not.toBeNull();

    const player = room.players.get('p1')!;
    expect(player.isConnected).toBe(true);
    expect(room.getSocketId('p1')).toBe('s4');
    expect(room.getPlayerId('s4')).toBe('p1');
  });

  it('reconnect rotates token (old token invalidated)', () => {
    room.gamePhase = GamePhase.PLAYING;
    room.handleDisconnect('s1');

    const newToken = room.handleReconnect('s4', 'p1', p1Token);
    expect(newToken).not.toBeNull();
    expect(newToken).not.toBe(p1Token);

    // Simulate second disconnect
    room.handleDisconnect('s4');

    // Old token should not work anymore
    const failResult = room.handleReconnect('s5', 'p1', p1Token);
    expect(failResult).toBeNull();

    // New token should work
    const success = room.handleReconnect('s5', 'p1', newToken!);
    expect(success).not.toBeNull();
  });

  it('returns null for disconnect of unknown socket', () => {
    room.gamePhase = GamePhase.PLAYING;
    const result = room.handleDisconnect('unknown');
    expect(result).toBeNull();
  });
});

describe('Room: round continue window', () => {
  let room: Room;

  beforeEach(() => {
    room = new Room('ABCD');
    room.addPlayer('s1', 'p1', 'Alice');
    room.addPlayer('s2', 'p2', 'Bob');
    room.addBot('bot1', 'Bot Brady');
  });

  afterEach(() => {
    room.cleanup();
  });

  it('bots are automatically ready for continue', () => {
    room.beginRoundContinueWindow(5000, () => {});
    // Bot should already be in the ready set
    // Human players are not ready yet
    expect(room.isRoundContinueComplete).toBe(false);
  });

  it('isRoundContinueComplete returns true when all active players ready', () => {
    room.beginRoundContinueWindow(5000, () => {});

    room.markRoundContinueReady('p1');
    expect(room.isRoundContinueComplete).toBe(false);

    room.markRoundContinueReady('p2');
    expect(room.isRoundContinueComplete).toBe(true);
  });

  it('markRoundContinueReady returns false for eliminated players', () => {
    room.beginRoundContinueWindow(5000, () => {});
    const player = room.players.get('p1')!;
    player.isEliminated = true;

    expect(room.markRoundContinueReady('p1')).toBe(false);
  });

  it('markRoundContinueReady returns false on duplicate', () => {
    room.beginRoundContinueWindow(5000, () => {});
    expect(room.markRoundContinueReady('p1')).toBe(true);
    expect(room.markRoundContinueReady('p1')).toBe(false);
  });

  it('markRoundContinueReady returns false for unknown player', () => {
    room.beginRoundContinueWindow(5000, () => {});
    expect(room.markRoundContinueReady('ghost')).toBe(false);
  });

  it('isRoundContinueComplete skips eliminated players', () => {
    room.beginRoundContinueWindow(5000, () => {});
    const p2 = room.players.get('p2')!;
    p2.isEliminated = true;

    // Only p1 (human, non-eliminated) needs to be ready. Bot is auto-ready.
    room.markRoundContinueReady('p1');
    expect(room.isRoundContinueComplete).toBe(true);
  });

  it('cancelRoundContinueWindow clears ready state', () => {
    room.beginRoundContinueWindow(5000, () => {});
    room.markRoundContinueReady('p1');
    room.cancelRoundContinueWindow();
    expect(room.isRoundContinueComplete).toBe(false);
  });
});

describe('Room: startGame', () => {
  let room: Room;

  beforeEach(() => {
    room = new Room('ABCD');
    room.addPlayer('s1', 'p1', 'Alice');
    room.addPlayer('s2', 'p2', 'Bob');
  });

  it('sets gamePhase to PLAYING', () => {
    room.startGame();
    expect(room.gamePhase).toBe(GamePhase.PLAYING);
  });

  it('creates a GameEngine instance', () => {
    room.startGame();
    expect(room.game).not.toBeNull();
  });

  it('game engine has correct player count', () => {
    room.addBot('bot1', 'Bot Brady');
    room.startGame();
    expect(room.game!.getActivePlayers().length).toBe(3);
  });
});

describe('Room: getRoomState and getClientGameState', () => {
  let room: Room;

  beforeEach(() => {
    room = new Room('ABCD');
    room.addPlayer('s1', 'p1', 'Alice');
    room.addPlayer('s2', 'p2', 'Bob');
  });

  it('getRoomState returns correct structure', () => {
    const state = room.getRoomState();
    expect(state.roomCode).toBe('ABCD');
    expect(state.hostId).toBe('p1');
    expect(state.players).toHaveLength(2);
    expect(state.gamePhase).toBe(GamePhase.LOBBY);
  });

  it('getRoomState players do not contain cards', () => {
    const state = room.getRoomState();
    for (const player of state.players) {
      expect((player as Record<string, unknown>).cards).toBeUndefined();
    }
  });

  it('getClientGameState returns null before game starts', () => {
    const state = room.getClientGameState('p1');
    expect(state).toBeNull();
  });

  it('getClientGameState returns personalized state during game', () => {
    room.startGame();
    const stateP1 = room.getClientGameState('p1')!;
    const stateP2 = room.getClientGameState('p2')!;

    expect(stateP1).not.toBeNull();
    expect(stateP2).not.toBeNull();

    // Each player sees only their own cards
    expect(stateP1.myCards).toEqual(room.game!.getActivePlayers().find(p => p.id === 'p1')!.cards);
    expect(stateP2.myCards).toEqual(room.game!.getActivePlayers().find(p => p.id === 'p2')!.cards);
  });
});

describe('Room: spectator game state', () => {
  let room: Room;

  beforeEach(() => {
    room = new Room('ABCD');
    room.addPlayer('s1', 'p1', 'Alice');
    room.addPlayer('s2', 'p2', 'Bob');
  });

  it('getSpectatorGameState returns null before game starts', () => {
    expect(room.getSpectatorGameState()).toBeNull();
  });

  it('getSpectatorGameState without spectatorsCanSeeCards has empty myCards', () => {
    room.settings.spectatorsCanSeeCards = false;
    room.startGame();

    const state = room.getSpectatorGameState()!;
    expect(state.myCards).toEqual([]);
    expect(state.spectatorCards).toBeUndefined();
  });

  it('getSpectatorGameState with spectatorsCanSeeCards includes all cards', () => {
    room.settings.spectatorsCanSeeCards = true;
    room.startGame();

    const state = room.getSpectatorGameState()!;
    expect(state.myCards).toEqual([]);
    expect(state.spectatorCards).toBeDefined();
    expect(state.spectatorCards!.length).toBe(2);

    for (const pc of state.spectatorCards!) {
      expect(pc.cards.length).toBeGreaterThan(0);
    }
  });
});

describe('Room: touch / lastActivity', () => {
  it('addPlayer updates lastActivity', () => {
    const room = new Room('ABCD');
    const before = room.lastActivity;
    // Small delay to ensure time changes
    room.addPlayer('s1', 'p1', 'Alice');
    expect(room.lastActivity).toBeGreaterThanOrEqual(before);
  });

  it('touch() updates lastActivity', () => {
    const room = new Room('ABCD');
    const before = room.lastActivity;
    room.touch();
    expect(room.lastActivity).toBeGreaterThanOrEqual(before);
  });
});
