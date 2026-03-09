import {
  GameEngine, BotPlayer,
  BotDifficulty, RoundPhase,
} from '@bull-em/shared';
import type {
  ServerPlayer, GameSettings, TurnResult, Card,
  ClientGameState,
} from '@bull-em/shared';
import type { BotAction } from '@bull-em/shared';
import type { BotConfig, BotStrategy, GameResult } from './types.js';

const MAX_TURNS_PER_ROUND = 500;
const MAX_ROUNDS = 200;

/** Create ServerPlayer objects for a set of bot configurations. */
export function createBotPlayers(configs: BotConfig[]): ServerPlayer[] {
  return configs.map((cfg, i) => ({
    id: cfg.id ?? `bot-${i}`,
    name: cfg.name ?? `Bot ${i + 1}`,
    cardCount: 1,
    isConnected: true,
    isEliminated: false,
    isHost: i === 0,
    isBot: true,
    cards: [] as Card[],
  }));
}

/** Dispatch a BotAction to the appropriate GameEngine handler. */
function dispatchAction(engine: GameEngine, playerId: string, action: BotAction): TurnResult {
  switch (action.action) {
    case 'call':
      return engine.handleCall(playerId, action.hand);
    case 'bull':
      return engine.handleBull(playerId);
    case 'true':
      return engine.handleTrue(playerId);
    case 'lastChanceRaise':
      return engine.handleLastChanceRaise(playerId, action.hand);
    case 'lastChancePass':
      return engine.handleLastChancePass(playerId);
  }
}

/** Get the bot's decision using the pluggable strategy (with heuristic fallback). */
function getBotAction(
  state: ClientGameState,
  player: ServerPlayer,
  difficulty: BotDifficulty,
  scope: string,
  strategy: BotStrategy | undefined,
  allPlayers: ServerPlayer[],
): BotAction {
  if (strategy) {
    const totalCards = allPlayers
      .filter(p => !p.isEliminated)
      .reduce((sum, p) => sum + p.cardCount, 0);
    const result = strategy({
      state,
      botId: player.id,
      botCards: player.cards,
      totalCards,
    });
    if (result) return result;
  }

  // Fall back to built-in heuristic bot
  const allCards = difficulty === BotDifficulty.IMPOSSIBLE
    ? allPlayers.filter(p => !p.isEliminated).flatMap(p => p.cards)
    : undefined;

  return BotPlayer.decideAction(state, player.id, player.cards, difficulty, allCards, scope);
}

/** Run a single complete game and return the result. */
export function runGame(
  players: ServerPlayer[],
  settings: GameSettings,
  botConfigs: BotConfig[],
  strategy: BotStrategy | undefined,
  defaultDifficulty: BotDifficulty,
): GameResult {
  // Reset player state for a fresh game
  for (const p of players) {
    p.cardCount = 1;
    p.isEliminated = false;
    p.cards = [];
  }

  const scope = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const engine = new GameEngine(players, settings);
  engine.startRound();

  const eliminationOrder: string[] = [];
  let totalTurns = 0;
  let roundCount = 0;

  while (!engine.gameOver && roundCount < MAX_ROUNDS) {
    roundCount++;
    let roundTurns = 0;

    while (roundTurns < MAX_TURNS_PER_ROUND) {
      const currentId = engine.currentPlayerId;
      const player = players.find(p => p.id === currentId);
      if (!player) break;

      const configIdx = players.indexOf(player);
      const botCfg = botConfigs[configIdx];
      const difficulty = botCfg?.difficulty ?? defaultDifficulty;

      const state = engine.getClientState(currentId);
      const action = getBotAction(state, player, difficulty, scope, strategy, players);
      const result = dispatchAction(engine, currentId, action);

      roundTurns++;
      totalTurns++;

      if (result.type === 'error') {
        // Bot produced an invalid action — skip to avoid infinite loops.
        // This shouldn't happen with well-behaved bots but is a safety valve.
        break;
      }

      if (result.type === 'resolve') {
        // Track eliminations in order
        for (const elimId of result.result.eliminatedPlayerIds) {
          if (!eliminationOrder.includes(elimId)) {
            eliminationOrder.push(elimId);
          }
        }
        BotPlayer.updateMemory(result.result, scope);

        if (!engine.gameOver) {
          const next = engine.startNextRound();
          if (next.type === 'game_over') break;
        }
        break; // Exit inner loop — new round started
      }

      if (result.type === 'game_over') {
        if (result.finalRoundResult) {
          for (const elimId of result.finalRoundResult.eliminatedPlayerIds) {
            if (!eliminationOrder.includes(elimId)) {
              eliminationOrder.push(elimId);
            }
          }
        }
        break;
      }

      // 'continue' and 'last_chance' — keep going
    }
  }

  BotPlayer.resetMemory(scope);

  return {
    winnerId: engine.winnerId ?? players.find(p => !p.isEliminated)?.id ?? '',
    rounds: roundCount,
    turns: totalTurns,
    eliminationOrder,
  };
}
