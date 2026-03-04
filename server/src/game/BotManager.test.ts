import { describe, it, expect, beforeEach } from 'vitest';
import { BotManager } from './BotManager.js';
import { Room } from '../rooms/Room.js';
import { GamePhase, MAX_PLAYERS, BOT_NAMES, STARTING_CARDS, DEFAULT_BOT_DIFFICULTY, maxPlayersForMaxCards } from '@bull-em/shared';

describe('BotManager', () => {
  let botManager: BotManager;
  let room: Room;

  beforeEach(() => {
    botManager = new BotManager();
    room = new Room('TEST');
    room.addPlayer('socket1', 'host', 'Alice');
  });

  describe('addBot', () => {
    it('adds a bot to the room', () => {
      const botId = botManager.addBot(room);
      expect(room.players.has(botId)).toBe(true);
      const bot = room.players.get(botId)!;
      expect(bot.isBot).toBe(true);
      expect(bot.isHost).toBe(false);
      expect(bot.isConnected).toBe(true);
      expect(bot.cardCount).toBe(STARTING_CARDS);
    });

    it('uses a name from BOT_NAMES', () => {
      const botId = botManager.addBot(room);
      const bot = room.players.get(botId)!;
      expect(BOT_NAMES).toContain(bot.name);
    });

    it('uses custom name if provided', () => {
      const botId = botManager.addBot(room, 'Custom Bot');
      const bot = room.players.get(botId)!;
      expect(bot.name).toBe('Custom Bot');
    });

    it('picks unique names for each bot', () => {
      const id1 = botManager.addBot(room);
      const id2 = botManager.addBot(room);
      const name1 = room.players.get(id1)!.name;
      const name2 = room.players.get(id2)!.name;
      expect(name1).not.toBe(name2);
    });

    it('throws when room is full', () => {
      // Default maxCards=5 → effective max = floor(52/5) = 10
      const effectiveMax = Math.min(MAX_PLAYERS, maxPlayersForMaxCards(room.settings.maxCards));
      for (let i = 1; i < effectiveMax; i++) {
        botManager.addBot(room);
      }
      expect(room.playerCount).toBe(effectiveMax);
      expect(() => botManager.addBot(room)).toThrow('Room is full');
    });

    it('throws when game is in progress', () => {
      room.addPlayer('socket2', 'p2', 'Bob');
      room.startGame();
      expect(() => botManager.addBot(room)).toThrow('Cannot add bots during a game');
    });
  });

  describe('removeBot', () => {
    it('removes a bot from the room', () => {
      const botId = botManager.addBot(room);
      expect(room.players.has(botId)).toBe(true);
      botManager.removeBot(room, botId);
      expect(room.players.has(botId)).toBe(false);
    });

    it('does not remove human players', () => {
      botManager.removeBot(room, 'host');
      expect(room.players.has('host')).toBe(true);
    });
  });

  describe('room isEmpty with bots', () => {
    it('considers room empty when only bots remain', () => {
      botManager.addBot(room);
      // Remove the human player
      room.removePlayer('socket1');
      expect(room.isEmpty).toBe(true);
    });

    it('considers room not empty when human player present', () => {
      botManager.addBot(room);
      expect(room.isEmpty).toBe(false);
    });
  });



  describe('difficulty defaults', () => {
    it('uses shared default difficulty', () => {
      expect((botManager as unknown as { difficulty: string }).difficulty).toBe(DEFAULT_BOT_DIFFICULTY);
    });
  });

  describe('clearTimers', () => {
    it('does not throw when called with no pending timers', () => {
      expect(() => botManager.clearTimers()).not.toThrow();
    });
  });
});
