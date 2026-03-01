import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import type { ClientGameState, HandCall, RoomState, RoundResult, PlayerId, ServerPlayer, Player, GameSettings, GameStats } from '@bull-em/shared';
import {
  GamePhase, STARTING_CARDS, BOT_NAMES, BOT_THINK_DELAY_MIN, BOT_THINK_DELAY_MAX,
  GameEngine, BotPlayer, BotDifficulty, DEFAULT_BOT_DIFFICULTY, DEFAULT_GAME_SETTINGS,
  DECK_SIZE, maxPlayersForMaxCards,
} from '@bull-em/shared';
import type { TurnResult } from '@bull-em/shared';
import { GameContext } from './GameContext.js';

const HUMAN_ID = 'human-1';

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
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [gameState, setGameState] = useState<ClientGameState | null>(null);
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
  const [roundTransition, setRoundTransition] = useState(false);
  const [winnerId, setWinnerId] = useState<PlayerId | null>(null);
  const [gameStats, setGameStats] = useState<GameStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>(DEFAULT_BOT_DIFFICULTY as BotDifficulty);
  const [gameSettings, setGameSettings] = useState<GameSettings>({ ...DEFAULT_GAME_SETTINGS });

  const engineRef = useRef<GameEngine | null>(null);
  const playersRef = useRef<ServerPlayer[]>([]);
  const roundResultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const botTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const botDifficultyRef = useRef<BotDifficulty>(botDifficulty);
  const gameSettingsRef = useRef<GameSettings>(gameSettings);

  // Keep refs in sync
  useEffect(() => {
    botDifficultyRef.current = botDifficulty;
  }, [botDifficulty]);

  useEffect(() => {
    gameSettingsRef.current = gameSettings;
  }, [gameSettings]);

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
    };
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
  }, []);

  const scheduleBotTurn = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;

    const currentId = engine.currentPlayerId;
    const player = playersRef.current.find(p => p.id === currentId);
    if (!player?.isBot) return;

    const delay = BOT_THINK_DELAY_MIN +
      Math.floor(Math.random() * (BOT_THINK_DELAY_MAX - BOT_THINK_DELAY_MIN));

    botTimerRef.current = setTimeout(() => {
      executeBotTurn(currentId);
    }, delay);
  }, []);

  const handleTurnResult = useCallback((result: TurnResult) => {
    const engine = engineRef.current;
    if (!engine) return;

    switch (result.type) {
      case 'error':
        setError(result.message);
        break;

      case 'continue':
      case 'last_chance':
        broadcastState();
        scheduleBotTurn();
        break;

      case 'resolve':
        setRoundResult(result.result);
        break;

      case 'game_over':
        setWinnerId(result.winnerId);
        if (engineRef.current) setGameStats(engineRef.current.getGameStats());
        break;
    }
  }, [broadcastState, scheduleBotTurn]);

  const executeBotTurn = useCallback((botId: PlayerId) => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.currentPlayerId !== botId) return;

    const botPlayer = playersRef.current.find(p => p.id === botId);
    if (!botPlayer?.isBot) return;

    const state = engine.getClientState(botId);
    const decision = BotPlayer.decideAction(state, botId, botPlayer.cards, botDifficultyRef.current);

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
    });

    return 'LOCAL';
  }, []);

  const joinRoom = useCallback(async (): Promise<void> => {
    // No-op for local mode
  }, []);

  const leaveRoom = useCallback(() => {
    if (botTimerRef.current) clearTimeout(botTimerRef.current);
    if (roundResultTimerRef.current) clearTimeout(roundResultTimerRef.current);
    engineRef.current = null;
    playersRef.current = [];
    setRoomState(null);
    setGameState(null);
    setRoundResult(null);
    setRoundTransition(false);
    setWinnerId(null);
    setGameStats(null);
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
    const engine = new GameEngine([...playersRef.current], settings);
    engineRef.current = engine;
    engine.startRound();

    setRoomState(prev => prev ? { ...prev, gamePhase: GamePhase.PLAYING } : null);
    broadcastState();
    scheduleBotTurn();
  }, [broadcastState, scheduleBotTurn]);

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

    // Start next round immediately after dismissing
    const engine = engineRef.current;
    if (!engine) return;
    const nextResult = engine.startNextRound();
    if (nextResult.type === 'game_over') {
      setWinnerId(nextResult.winnerId);
      setGameStats(engine.getGameStats());
    } else {
      broadcastState();
      scheduleBotTurn();
    }
  }, [broadcastState, scheduleBotTurn]);

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

  let botCounter = useRef(0);

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

  const value = {
    roomState,
    gameState,
    roundResult,
    roundTransition,
    winnerId,
    gameStats,
    playerId: HUMAN_ID,
    error,
    isConnected: true,
    createRoom,
    joinRoom,
    leaveRoom,
    startGame,
    callHand,
    callBull,
    callTrue,
    lastChanceRaise,
    lastChancePass,
    clearError: () => setError(null),
    clearRoundResult,
    addBot,
    removeBot,
    botDifficulty,
    setBotDifficulty,
    gameSettings,
    setGameSettings,
  };

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}
