import { useState, useCallback, useRef, useEffect, useMemo, type ReactNode } from 'react';
import type { ClientGameState, HandCall, RoomState, RoundResult, PlayerId, ServerPlayer, Player, GameSettings, GameStats, GameEngineSnapshot, GameReplay } from '@bull-em/shared';
import {
  GamePhase, RoundPhase, HandType, STARTING_CARDS, BOT_NAMES, BOT_THINK_DELAY_MIN, BOT_THINK_DELAY_MAX,
  BOT_BULL_DELAY_MIN, BOT_BULL_DELAY_MAX,
  GameEngine, BotPlayer, BotDifficulty, DEFAULT_BOT_DIFFICULTY, DEFAULT_GAME_SETTINGS,
  DECK_SIZE, maxPlayersForMaxCards, BotSpeed, DEFAULT_BOT_SPEED, BOT_SPEED_MULTIPLIERS,
  saveReplay,
} from '@bull-em/shared';
import type { TurnResult } from '@bull-em/shared';
import { GameContext } from './GameContext.js';
import { socket } from '../socket.js';

const HUMAN_ID = 'human-1';
const LOCAL_GAME_STORAGE_KEY = 'bull-em-local-game';
/** Stable empty map — avoids allocating a new Map() inside useMemo on every
 *  render, which would break referential equality and cause downstream
 *  re-renders for all context consumers. */
const EMPTY_DISCONNECT_DEADLINES: ReadonlyMap<string, number> = new Map();
const EMPTY_REACTIONS: import('@bull-em/shared').EmojiReaction[] = [];
const noopSendReaction = () => {};

interface LocalGameSave {
  engineSnapshot: GameEngineSnapshot;
  players: ServerPlayer[];
  botDifficulty: BotDifficulty;
  gameSettings: GameSettings;
  roundResult: RoundResult | null;
  botCounter: number;
}

function saveLocalGame(save: LocalGameSave): void {
  try {
    localStorage.setItem(LOCAL_GAME_STORAGE_KEY, JSON.stringify(save));
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

function loadLocalGame(): LocalGameSave | null {
  try {
    const raw = localStorage.getItem(LOCAL_GAME_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LocalGameSave;
  } catch {
    localStorage.removeItem(LOCAL_GAME_STORAGE_KEY);
    return null;
  }
}

function clearLocalGameSave(): void {
  localStorage.removeItem(LOCAL_GAME_STORAGE_KEY);
}

/**
 * Attempt to restore a saved game synchronously.
 * This runs during the first render (via useState lazy initializer) so that
 * child components see restored state immediately — before any effects fire.
 * Without this, LocalGamePage's redirect effect navigates away before the
 * restore effect in LocalGameProvider has a chance to run (React runs child
 * effects before parent effects).
 */
function tryRestoreGame(): { engine: GameEngine; save: LocalGameSave } | null {
  const save = loadLocalGame();
  if (!save) return null;
  try {
    const engine = GameEngine.restore(save.engineSnapshot);
    return { engine, save };
  } catch {
    clearLocalGameSave();
    return null;
  }
}

function toPublicPlayer(p: ServerPlayer): Player {
  return {
    id: p.id,
    name: p.name,
    cardCount: p.cardCount,
    isConnected: p.isConnected,
    isEliminated: p.isEliminated,
    isHost: p.isHost,
    isBot: p.isBot,
  };
}

export function LocalGameProvider({ children }: { children: ReactNode }) {
  // Synchronously restore saved game on first render so child components
  // see the restored state immediately (before any effects run).
  const [initialRestore] = useState(tryRestoreGame);

  const [roomState, setRoomState] = useState<RoomState | null>(
    initialRestore ? {
      roomCode: 'LOCAL',
      players: initialRestore.save.players.map(toPublicPlayer),
      hostId: HUMAN_ID,
      gamePhase: GamePhase.PLAYING,
      settings: initialRestore.save.gameSettings,
      spectatorCount: 0,
    } : null,
  );
  const [gameState, setGameState] = useState<ClientGameState | null>(
    initialRestore ? initialRestore.engine.getClientState(HUMAN_ID) : null,
  );
  const [roundResult, setRoundResult] = useState<RoundResult | null>(
    initialRestore?.save.roundResult ?? null,
  );
  const [roundTransition, setRoundTransition] = useState(false);
  const [winnerId, setWinnerId] = useState<PlayerId | null>(null);
  const [gameStats, setGameStats] = useState<GameStats | null>(null);
  const [lastReplay, setLastReplay] = useState<GameReplay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>(
    initialRestore?.save.botDifficulty ?? (DEFAULT_BOT_DIFFICULTY as BotDifficulty),
  );
  const [gameSettings, setGameSettings] = useState<GameSettings>(
    initialRestore?.save.gameSettings ?? { ...DEFAULT_GAME_SETTINGS },
  );

  const [isPaused, setIsPaused] = useState(false);
  const [onlinePlayerCount, setOnlinePlayerCount] = useState(0);
  const [onlinePlayerNames, setOnlinePlayerNames] = useState<string[]>([]);

  const engineRef = useRef<GameEngine | null>(initialRestore?.engine ?? null);
  const playersRef = useRef<ServerPlayer[]>(initialRestore?.save.players ?? []);
  const roundResultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const botTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const botDifficultyRef = useRef<BotDifficulty>(
    initialRestore?.save.botDifficulty ?? (DEFAULT_BOT_DIFFICULTY as BotDifficulty),
  );
  const gameSettingsRef = useRef<GameSettings>(
    initialRestore?.save.gameSettings ?? { ...DEFAULT_GAME_SETTINGS },
  );
  const isPausedRef = useRef(false);
  const pendingWinnerRef = useRef<{ winnerId: PlayerId } | null>(null);
  // Schedule bot/human turns after restore if we're mid-round (no round result overlay)
  const restoredRef = useRef(initialRestore !== null && !initialRestore.save.roundResult);

  // Keep refs in sync
  useEffect(() => {
    botDifficultyRef.current = botDifficulty;
  }, [botDifficulty]);

  useEffect(() => {
    gameSettingsRef.current = gameSettings;
  }, [gameSettings]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  // Listen for online player count (socket is connected at module level)
  useEffect(() => {
    const handleCount = (count: number) => setOnlinePlayerCount(count);
    const handleNames = (names: string[]) => setOnlinePlayerNames(names);
    socket.on('server:playerCount', handleCount);
    socket.on('server:playerNames', handleNames);
    return () => {
      socket.off('server:playerCount', handleCount);
      socket.off('server:playerNames', handleNames);
    };
  }, []);

  // Auto-clear errors
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(timer);
  }, [error]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (botTimerRef.current) clearTimeout(botTimerRef.current);
      if (roundResultTimerRef.current) clearTimeout(roundResultTimerRef.current);
      if (turnTimerRef.current) clearTimeout(turnTimerRef.current);
    };
  }, []);

  // Game restoration now happens synchronously in useState initializers above,
  // so child components see restored state on their first render.

  const clearHumanTimer = useCallback(() => {
    if (turnTimerRef.current) {
      clearTimeout(turnTimerRef.current);
      turnTimerRef.current = null;
    }
  }, []);

  const persistGame = useCallback((rr: RoundResult | null = null) => {
    if (!engineRef.current) return;
    saveLocalGame({
      engineSnapshot: engineRef.current.serialize(),
      players: playersRef.current.map(p => ({ ...p, cards: [...p.cards] })),
      botDifficulty: botDifficultyRef.current,
      gameSettings: gameSettingsRef.current,
      roundResult: rr,
      botCounter: botCounter.current,
    });
  }, []);

  const broadcastState = useCallback(() => {
    if (!engineRef.current) return;
    const state = engineRef.current.getClientState(HUMAN_ID);
    setGameState(state);
    setRoundResult(null);
    setRoundTransition(false);
    if (roundResultTimerRef.current) {
      clearTimeout(roundResultTimerRef.current);
      roundResultTimerRef.current = null;
    }
    persistGame(null);
  }, [persistGame]);

  const computeBotDelay = useCallback((): number => {
    const engine = engineRef.current;
    const speedMultiplier = BOT_SPEED_MULTIPLIERS[(gameSettingsRef.current.botSpeed ?? DEFAULT_BOT_SPEED) as BotSpeed];
    if (!engine) return Math.round(BOT_THINK_DELAY_MIN * speedMultiplier);

    // Use lightweight summary instead of building a full ClientGameState
    const { activePlayerCount, totalCards, turnCount } = engine.getRoundSummary();

    // Base: 2-3.5s random
    const base = 2000 + Math.floor(Math.random() * 1500);
    // More total cards = more to think about (+0-2s)
    const cardsFactor = Math.min(totalCards / 20, 1) * 2000;
    // Later in the round = more pressure, think longer (+0-1.5s)
    const roundDepth = Math.min(turnCount / (activePlayerCount * 2), 1) * 1500;
    // Some randomness (±500ms)
    const jitter = (Math.random() - 0.5) * 1000;

    const raw = Math.round(base + cardsFactor + roundDepth + jitter);
    const delay = Math.round(raw * speedMultiplier);
    return Math.max(Math.round(BOT_THINK_DELAY_MIN * speedMultiplier), Math.min(delay, Math.round(7000 * speedMultiplier)));
  }, []);

  const scheduleBotTurn = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || isPausedRef.current) return;

    const currentId = engine.currentPlayerId;
    const player = playersRef.current.find(p => p.id === currentId);
    if (!player?.isBot) return;

    // Use faster delay for bull/last chance phases (matches server BotManager).
    // Use lightweight currentRoundPhase instead of building full client state.
    const phase = engine.currentRoundPhase;
    const inBullPhase = phase === RoundPhase.BULL_PHASE
      || phase === RoundPhase.LAST_CHANCE;
    const speedMultiplier = BOT_SPEED_MULTIPLIERS[(gameSettingsRef.current.botSpeed ?? DEFAULT_BOT_SPEED) as BotSpeed];
    const delay = inBullPhase
      ? Math.round((BOT_BULL_DELAY_MIN + Math.floor(Math.random() * (BOT_BULL_DELAY_MAX - BOT_BULL_DELAY_MIN))) * speedMultiplier)
      : computeBotDelay();

    botTimerRef.current = setTimeout(() => {
      executeBotTurn(currentId);
    }, delay);
  }, [computeBotDelay]);

  const executeAutoAction = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.currentPlayerId !== HUMAN_ID) return;

    const state = engine.getClientState(HUMAN_ID);
    let result: TurnResult;

    if (state.roundPhase === RoundPhase.LAST_CHANCE) {
      result = engine.handleLastChancePass(HUMAN_ID);
    } else if (state.roundPhase === RoundPhase.BULL_PHASE) {
      result = engine.handleBull(HUMAN_ID);
    } else if (state.roundPhase === RoundPhase.CALLING && state.currentHand) {
      result = engine.handleBull(HUMAN_ID);
    } else {
      // CALLING with no current hand — auto-call High Card 2
      result = engine.handleCall(HUMAN_ID, { type: HandType.HIGH_CARD, rank: '2' });
    }

    if (result.type !== 'error') {
      handleTurnResult(result);
    }
  }, []);

  const scheduleHumanTimer = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || isPausedRef.current) return;
    if (engine.currentPlayerId !== HUMAN_ID) return;

    const timerSeconds = gameSettingsRef.current.turnTimer;
    if (!timerSeconds || timerSeconds <= 0) {
      engine.setTurnDeadline(null);
      return;
    }

    const deadline = Date.now() + timerSeconds * 1000;
    engine.setTurnDeadline(deadline);

    turnTimerRef.current = setTimeout(() => {
      turnTimerRef.current = null;
      executeAutoAction();
    }, timerSeconds * 1000);
  }, [executeAutoAction]);

  const buildAndSaveReplay = useCallback((winId: PlayerId) => {
    const engine = engineRef.current;
    if (!engine) return;
    const snapshots = engine.getRoundSnapshots();
    if (snapshots.length === 0) return;
    const replay: GameReplay = {
      id: `LOCAL-${Date.now()}`,
      players: playersRef.current.map(p => ({ id: p.id, name: p.name })),
      settings: { ...gameSettingsRef.current },
      rounds: snapshots,
      winnerId: winId,
      completedAt: new Date().toISOString(),
    };
    setLastReplay(replay);
    saveReplay(replay);
  }, []);

  const handleTurnResult = useCallback((result: TurnResult) => {
    const engine = engineRef.current;
    if (!engine) return;

    clearHumanTimer();

    switch (result.type) {
      case 'error':
        setError(result.message);
        break;

      case 'continue':
      case 'last_chance':
        scheduleBotTurn();
        scheduleHumanTimer();
        broadcastState();
        break;

      case 'resolve':
        engine.setTurnDeadline(null);
        // Update game state so UI sees null deadline (without clearing roundResult)
        setGameState(engine.getClientState(HUMAN_ID));
        setRoundResult(result.result);
        persistGame(result.result);
        break;

      case 'game_over':
        engine.setTurnDeadline(null);
        clearLocalGameSave();
        buildAndSaveReplay(result.winnerId);
        if (result.finalRoundResult) {
          // Show the final round result overlay before navigating to results
          setGameState(engine.getClientState(HUMAN_ID));
          setRoundResult(result.finalRoundResult);
          pendingWinnerRef.current = { winnerId: result.winnerId };
        } else {
          setWinnerId(result.winnerId);
          if (engineRef.current) setGameStats(engineRef.current.getGameStats());
        }
        break;
    }
  }, [broadcastState, scheduleBotTurn, clearHumanTimer, persistGame, buildAndSaveReplay]);

  const executeBotTurn = useCallback((botId: PlayerId) => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.currentPlayerId !== botId) return;

    const botPlayer = playersRef.current.find(p => p.id === botId);
    if (!botPlayer?.isBot) return;

    const state = engine.getClientState(botId);
    // For IMPOSSIBLE difficulty, bots see their own cards + human players' cards (not other bots')
    const visibleCards = botDifficultyRef.current === BotDifficulty.IMPOSSIBLE
      ? playersRef.current
          .filter(p => !p.isEliminated && (!p.isBot || p.id === botId))
          .flatMap(p => p.cards)
      : undefined;
    const decision = BotPlayer.decideAction(state, botId, botPlayer.cards, botDifficultyRef.current, visibleCards, 'local');

    let result: TurnResult;
    switch (decision.action) {
      case 'call':
        result = engine.handleCall(botId, decision.hand);
        break;
      case 'bull':
        result = engine.handleBull(botId);
        break;
      case 'true':
        result = engine.handleTrue(botId);
        break;
      case 'lastChanceRaise':
        result = engine.handleLastChanceRaise(botId, decision.hand);
        break;
      case 'lastChancePass':
        result = engine.handleLastChancePass(botId);
        break;
    }

    // Fallback if bot made invalid move
    if (result.type === 'error') {
      result = engine.handleBull(botId);
      if (result.type === 'error') {
        result = engine.handleLastChancePass(botId);
      }
    }

    if (result.type !== 'error') {
      handleTurnResult(result);
    }
  }, [handleTurnResult]);

  const togglePause = useCallback(() => {
    setIsPaused(prev => {
      const next = !prev;
      isPausedRef.current = next;
      if (next) {
        // Pausing: clear all pending timers
        if (botTimerRef.current) { clearTimeout(botTimerRef.current); botTimerRef.current = null; }
        if (turnTimerRef.current) { clearTimeout(turnTimerRef.current); turnTimerRef.current = null; }
        // Clear turn deadline so timer UI stops
        if (engineRef.current) {
          engineRef.current.setTurnDeadline(null);
          setGameState(engineRef.current.getClientState(HUMAN_ID));
        }
      } else {
        // Resuming: re-schedule bot/human timers
        scheduleBotTurn();
        scheduleHumanTimer();
      }
      return next;
    });
  }, [scheduleBotTurn, scheduleHumanTimer]);

  // After restoring a saved game, schedule bot/human turns once callbacks are ready
  useEffect(() => {
    if (!restoredRef.current) return;
    restoredRef.current = false;
    scheduleBotTurn();
    scheduleHumanTimer();
  }, [scheduleBotTurn, scheduleHumanTimer]);

  // --- Context API methods ---

  const createRoom = useCallback(async (playerName: string): Promise<string> => {
    const humanPlayer: ServerPlayer = {
      id: HUMAN_ID,
      name: playerName,
      cardCount: STARTING_CARDS,
      isConnected: true,
      isEliminated: false,
      isHost: true,
      isBot: false,
      cards: [],
    };
    playersRef.current = [humanPlayer];

    setRoomState({
      roomCode: 'LOCAL',
      players: [toPublicPlayer(humanPlayer)],
      hostId: HUMAN_ID,
      gamePhase: GamePhase.LOBBY,
      settings: { ...DEFAULT_GAME_SETTINGS },
      spectatorCount: 0,
    });

    return 'LOCAL';
  }, []);

  const joinRoom = useCallback(async (): Promise<void> => {
    // No-op for local mode
  }, []);

  const leaveRoom = useCallback(() => {
    if (botTimerRef.current) clearTimeout(botTimerRef.current);
    if (roundResultTimerRef.current) clearTimeout(roundResultTimerRef.current);
    clearHumanTimer();
    clearLocalGameSave();
    engineRef.current = null;
    playersRef.current = [];
    setRoomState(null);
    setGameState(null);
    setRoundResult(null);
    setRoundTransition(false);
    setWinnerId(null);
    setGameStats(null);
    setLastReplay(null);
    setIsPaused(false);
    isPausedRef.current = false;
  }, []);

  const startGame = useCallback(() => {
    if (playersRef.current.length < 2) {
      setError('Need at least 2 players');
      return;
    }
    const settings = gameSettingsRef.current;
    const totalNeeded = playersRef.current.length * settings.maxCards;
    if (totalNeeded > DECK_SIZE) {
      setError(`Too many players for ${settings.maxCards}-card game (${playersRef.current.length} x ${settings.maxCards} = ${totalNeeded} > ${DECK_SIZE})`);
      return;
    }
    const shuffled = [...playersRef.current];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = shuffled[i]!;
      shuffled[i] = shuffled[j]!;
      shuffled[j] = temp;
    }
    const engine = new GameEngine(shuffled, settings);
    engineRef.current = engine;
    engine.startRound();
    // Clear cross-round bot memory for the local game scope
    BotPlayer.resetMemory('local');

    setRoomState(prev => prev ? { ...prev, gamePhase: GamePhase.PLAYING } : null);
    scheduleBotTurn();
    scheduleHumanTimer();
    broadcastState();
  }, [broadcastState, scheduleBotTurn, scheduleHumanTimer]);

  const callHand = useCallback((hand: HandCall) => {
    if (!engineRef.current) return;
    const result = engineRef.current.handleCall(HUMAN_ID, hand);
    handleTurnResult(result);
  }, [handleTurnResult]);

  const callBull = useCallback(() => {
    if (!engineRef.current) return;
    const result = engineRef.current.handleBull(HUMAN_ID);
    handleTurnResult(result);
  }, [handleTurnResult]);

  const callTrue = useCallback(() => {
    if (!engineRef.current) return;
    const result = engineRef.current.handleTrue(HUMAN_ID);
    handleTurnResult(result);
  }, [handleTurnResult]);

  const lastChanceRaise = useCallback((hand: HandCall) => {
    if (!engineRef.current) return;
    const result = engineRef.current.handleLastChanceRaise(HUMAN_ID, hand);
    handleTurnResult(result);
  }, [handleTurnResult]);

  const lastChancePass = useCallback(() => {
    if (!engineRef.current) return;
    const result = engineRef.current.handleLastChancePass(HUMAN_ID);
    handleTurnResult(result);
  }, [handleTurnResult]);

  const clearRoundResult = useCallback(() => {
    setRoundResult(null);
    if (roundResultTimerRef.current) {
      clearTimeout(roundResultTimerRef.current);
      roundResultTimerRef.current = null;
    }

    // If a game_over was deferred until the round result was dismissed, apply it now
    const pending = pendingWinnerRef.current;
    if (pending) {
      pendingWinnerRef.current = null;
      setWinnerId(pending.winnerId);
      if (engineRef.current) setGameStats(engineRef.current.getGameStats());
      return;
    }

    // Start next round immediately after dismissing
    const engine = engineRef.current;
    if (!engine) return;
    const nextResult = engine.startNextRound();
    if (nextResult.type === 'game_over') {
      setWinnerId(nextResult.winnerId);
      setGameStats(engine.getGameStats());
    } else {
      clearHumanTimer();
      scheduleBotTurn();
      scheduleHumanTimer();
      broadcastState();
    }
  }, [broadcastState, scheduleBotTurn, scheduleHumanTimer, clearHumanTimer]);

  // Auto-dismiss round result after 30 seconds
  useEffect(() => {
    if (!roundResult) return;
    roundResultTimerRef.current = setTimeout(() => {
      clearRoundResult();
    }, 30000);
    return () => {
      if (roundResultTimerRef.current) clearTimeout(roundResultTimerRef.current);
    };
  }, [roundResult, clearRoundResult]);

  const botCounter = useRef(initialRestore?.save.botCounter ?? 0);

  const addBot = useCallback(async (botName?: string): Promise<string> => {
    const settings = gameSettingsRef.current;
    const newCount = playersRef.current.length + 1;
    if (newCount * settings.maxCards > DECK_SIZE) {
      throw new Error(`Too many players for ${settings.maxCards}-card game. Reduce max cards or remove a player.`);
    }
    const usedNames = new Set(playersRef.current.map(p => p.name));
    const name = botName || BOT_NAMES.find(n => !usedNames.has(n)) || `Bot ${botCounter.current + 1}`;
    const botId = `bot-${++botCounter.current}`;

    const botPlayer: ServerPlayer = {
      id: botId,
      name,
      cardCount: STARTING_CARDS,
      isConnected: true,
      isEliminated: false,
      isHost: false,
      isBot: true,
      cards: [],
    };

    playersRef.current = [...playersRef.current, botPlayer];

    setRoomState(prev => {
      if (!prev) return null;
      return {
        ...prev,
        players: playersRef.current.map(toPublicPlayer),
      };
    });

    return botId;
  }, []);

  const removeBot = useCallback((botId: string) => {
    playersRef.current = playersRef.current.filter(p => p.id !== botId);

    setRoomState(prev => {
      if (!prev) return null;
      return {
        ...prev,
        players: playersRef.current.map(toPublicPlayer),
      };
    });
  }, []);

  const requestRematch = useCallback(() => {
    if (botTimerRef.current) clearTimeout(botTimerRef.current);
    if (roundResultTimerRef.current) clearTimeout(roundResultTimerRef.current);
    clearHumanTimer();
    clearLocalGameSave();

    // Reset all players to starting state
    for (const p of playersRef.current) {
      p.cardCount = STARTING_CARDS;
      p.isEliminated = false;
      p.cards = [];
    }

    // Shuffle seating order
    const shuffled = [...playersRef.current];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = shuffled[i]!;
      shuffled[i] = shuffled[j]!;
      shuffled[j] = temp;
    }

    const settings = gameSettingsRef.current;
    const engine = new GameEngine(shuffled, settings);
    engineRef.current = engine;
    engine.startRound();
    BotPlayer.resetMemory('local');

    setWinnerId(null);
    setGameStats(null);
    setLastReplay(null);
    setRoundResult(null);
    setRoundTransition(false);
    setIsPaused(false);
    isPausedRef.current = false;

    setRoomState(prev => prev ? { ...prev, gamePhase: GamePhase.PLAYING, players: playersRef.current.map(toPublicPlayer) } : null);
    scheduleBotTurn();
    scheduleHumanTimer();
    broadcastState();
  }, [broadcastState, scheduleBotTurn, scheduleHumanTimer, clearHumanTimer]);

  const clearErrorAction = useCallback(() => setError(null), []);
  const noopListRooms = useCallback(async () => [] as never[], []);
  const noopListLiveGames = useCallback(async () => [] as never[], []);
  const noopSpectate = useCallback(async () => {}, []);
  const noopWatchRandom = useCallback(async (): Promise<string> => { throw new Error('Not available offline'); }, []);
  const noopUpdateSettings = useCallback(() => {}, []);
  const noopDeleteRoom = useCallback(() => {}, []);
  const noopKickPlayer = useCallback((): Promise<void> => Promise.resolve(), []);

  const value = useMemo(() => ({
    roomState,
    gameState,
    roundResult,
    roundTransition,
    roundTransitionDeadline: null as null,
    winnerId,
    gameStats,
    playerId: HUMAN_ID,
    error,
    isConnected: true as const,
    hasConnected: true as const,
    disconnectDeadlines: EMPTY_DISCONNECT_DEADLINES,
    createRoom,
    joinRoom,
    leaveRoom,
    startGame,
    callHand,
    callBull,
    callTrue,
    lastChanceRaise,
    lastChancePass,
    clearError: clearErrorAction,
    clearRoundResult,
    addBot,
    removeBot,
    requestRematch,
    botDifficulty,
    setBotDifficulty,
    gameSettings,
    setGameSettings,
    isPaused,
    togglePause,
    lastReplay,
    onlinePlayerCount,
    onlinePlayerNames,
    listRooms: noopListRooms,
    listLiveGames: noopListLiveGames,
    spectateGame: noopSpectate,
    watchRandomGame: noopWatchRandom,
    updateSettings: noopUpdateSettings,
    deleteRoom: noopDeleteRoom,
    kickPlayer: noopKickPlayer,
    reactions: EMPTY_REACTIONS,
    sendReaction: noopSendReaction,
  }), [
    roomState, gameState, roundResult, roundTransition, winnerId, gameStats,
    error, createRoom, joinRoom, leaveRoom, startGame, callHand, callBull,
    callTrue, lastChanceRaise, lastChancePass, clearErrorAction, clearRoundResult,
    addBot, removeBot, requestRematch, botDifficulty, setBotDifficulty, gameSettings,
    setGameSettings, isPaused, togglePause, lastReplay, onlinePlayerCount, onlinePlayerNames,
    noopListRooms, noopListLiveGames, noopSpectate, noopWatchRandom, noopUpdateSettings, noopDeleteRoom, noopKickPlayer,
  ]);

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}
