import { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo, type ReactNode } from 'react';
import type { ClientGameState, HandCall, RoomState, RoomListing, LiveGameListing, RoundResult, PlayerId, BotDifficulty, GameSettings, GameStats } from '@bull-em/shared';
import { socket } from '../socket.js';

/** Presence state (online player count/names) is split into a separate context
 *  so that server-wide connect/disconnect events don't re-render game components.
 *  Only Layout (which shows the player count) subscribes to this context. */
export interface PresenceContextValue {
  onlinePlayerCount: number;
  onlinePlayerNames: string[];
}

export const PresenceContext = createContext<PresenceContextValue>({ onlinePlayerCount: 0, onlinePlayerNames: [] });

export interface GameContextValue {
  roomState: RoomState | null;
  gameState: ClientGameState | null;
  roundResult: RoundResult | null;
  roundTransition: boolean;
  roundTransitionDeadline: number | null;
  winnerId: PlayerId | null;
  gameStats: GameStats | null;
  playerId: string | null;
  error: string | null;
  isConnected: boolean;
  /** True once the socket has connected at least once this session */
  hasConnected: boolean;
  onlinePlayerCount: number;
  onlinePlayerNames: string[];
  createRoom: (playerName: string) => Promise<string>;
  joinRoom: (roomCode: string, playerName: string) => Promise<void>;
  leaveRoom: () => void;
  deleteRoom: () => void;
  listRooms: () => Promise<RoomListing[]>;
  listLiveGames: () => Promise<LiveGameListing[]>;
  spectateGame: (roomCode: string) => Promise<void>;
  updateSettings: (settings: GameSettings) => void;
  startGame: () => void;
  callHand: (hand: HandCall) => void;
  callBull: () => void;
  callTrue: () => void;
  lastChanceRaise: (hand: HandCall) => void;
  lastChancePass: () => void;
  clearError: () => void;
  clearRoundResult: () => void;
  addBot: (botName?: string) => Promise<string>;
  removeBot: (botId: string) => void;
  requestRematch: () => void;
  botDifficulty?: BotDifficulty;
  setBotDifficulty?: (d: BotDifficulty) => void;
  gameSettings?: GameSettings;
  setGameSettings?: (s: GameSettings) => void;
  isPaused?: boolean;
  togglePause?: () => void;
}

export const GameContext = createContext<GameContextValue | null>(null);

const PLAYER_ID_KEY = 'bull-em-player-id';
const PLAYER_NAME_KEY = 'bull-em-player-name';
const ROOM_CODE_KEY = 'bull-em-room-code';
const RECONNECT_TOKEN_KEY = 'bull-em-reconnect-token';
const SOCKET_CALLBACK_TIMEOUT_MS = 10_000;

/** Wrap a socket.emit callback promise with a timeout so it can't hang forever.
 *  The timeout is cleared once the inner promise settles, preventing leaked timers. */
function withTimeout<T>(promise: Promise<T>, ms = SOCKET_CALLBACK_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Request timed out')), ms);
  });
  const cleanup = () => clearTimeout(timer);
  // Clear the timer whether the inner promise resolves or rejects
  promise.then(cleanup, cleanup);
  return Promise.race([promise, timeoutPromise]);
}

export function GameProvider({ children }: { children: ReactNode }) {
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [gameState, setGameState] = useState<ClientGameState | null>(null);
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
  const [roundTransition, setRoundTransition] = useState(false);
  const [roundTransitionDeadline, setRoundTransitionDeadline] = useState<number | null>(null);
  const [winnerId, setWinnerId] = useState<PlayerId | null>(null);
  const [gameStats, setGameStats] = useState<GameStats | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(() =>
    sessionStorage.getItem(PLAYER_ID_KEY),
  );
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [hasConnected, setHasConnected] = useState(socket.connected);
  const [onlinePlayerCount, setOnlinePlayerCount] = useState(0);
  const [onlinePlayerNames, setOnlinePlayerNames] = useState<string[]>([]);
  const roundResultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roundResultRef = useRef<RoundResult | null>(null);
  const roundResultReceivedAtRef = useRef<number>(0);
  const pendingGameStateRef = useRef<ClientGameState | null>(null);

  // Keep roundResultRef in sync with roundResult state
  useEffect(() => {
    roundResultRef.current = roundResult;
    if (roundResult) roundResultReceivedAtRef.current = Date.now();
  }, [roundResult]);

  // Auto-clear errors after 5 seconds
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(timer);
  }, [error]);

  // Auto-dismiss round result after 30 seconds
  useEffect(() => {
    if (!roundResult) return;
    roundResultTimerRef.current = setTimeout(() => {
      socket.emit('game:continue');
      setRoundResult(null);
      roundResultRef.current = null;
      // If the server already sent the next round state while the overlay was
      // showing, apply it immediately instead of showing the transition overlay.
      const pending = pendingGameStateRef.current;
      pendingGameStateRef.current = null;
      if (pending) {
        setGameState(pending);
        setRoundTransition(false);
        setRoundTransitionDeadline(null);
      } else {
        setRoundTransition(true);
        setRoundTransitionDeadline(roundResultReceivedAtRef.current + 30000);
      }
    }, 30000);
    return () => {
      if (roundResultTimerRef.current) clearTimeout(roundResultTimerRef.current);
    };
  }, [roundResult]);

  useEffect(() => {
    const handleNewGameState = (state: ClientGameState) => {
      if (roundResultRef.current !== null) {
        pendingGameStateRef.current = state;
      } else {
        setGameState(state);
        setRoundTransition(false);
        setRoundTransitionDeadline(null);
      }
    };

    const clearRoomState = () => {
      setRoomState(null);
      setGameState(null);
      setRoundResult(null);
      setRoundTransition(false);
      setWinnerId(null);
      setGameStats(null);
      sessionStorage.removeItem(PLAYER_ID_KEY);
      sessionStorage.removeItem(PLAYER_NAME_KEY);
      sessionStorage.removeItem(ROOM_CODE_KEY);
      sessionStorage.removeItem(RECONNECT_TOKEN_KEY);
    };

    socket.on('connect', () => { setIsConnected(true); setHasConnected(true); });
    socket.on('disconnect', () => setIsConnected(false));

    // Auto-rejoin the room after Socket.io reconnects. A brief disconnect
    // (app switch, network blip, page hidden on mobile) gives the socket a
    // new ID, so the server no longer knows which room it belongs to. Without
    // this, the client keeps stale state and receives no further game events.
    const handleReconnect = () => {
      const storedRoomCode = sessionStorage.getItem(ROOM_CODE_KEY);
      const storedName = sessionStorage.getItem(PLAYER_NAME_KEY);
      const storedId = sessionStorage.getItem(PLAYER_ID_KEY);

      if (storedRoomCode && storedName) {
        // Clear stale overlay state — server will send fresh state on rejoin
        setRoundResult(null);
        roundResultRef.current = null;
        pendingGameStateRef.current = null;
        setRoundTransition(false);
        if (roundResultTimerRef.current) {
          clearTimeout(roundResultTimerRef.current);
          roundResultTimerRef.current = null;
        }

        const storedToken = sessionStorage.getItem(RECONNECT_TOKEN_KEY) ?? undefined;
        socket.emit('room:join', {
          roomCode: storedRoomCode,
          playerName: storedName,
          playerId: storedId ?? undefined,
          reconnectToken: storedToken,
        }, (response) => {
          if ('error' in response) {
            // Room no longer exists — clean up
            sessionStorage.removeItem(PLAYER_ID_KEY);
            sessionStorage.removeItem(PLAYER_NAME_KEY);
            sessionStorage.removeItem(ROOM_CODE_KEY);
            sessionStorage.removeItem(RECONNECT_TOKEN_KEY);
            setRoomState(null);
            setGameState(null);
          }
        });
      }
    };
    socket.io.on('reconnect', handleReconnect);

    socket.on('room:state', (state) => {
      setRoomState(state);
      if (!sessionStorage.getItem(PLAYER_ID_KEY) && state.players.length === 1) {
        const id = state.players[0]!.id;
        setPlayerId(id);
        sessionStorage.setItem(PLAYER_ID_KEY, id);
      }
    });
    socket.on('game:state', handleNewGameState);
    socket.on('game:newRound', handleNewGameState);
    socket.on('game:roundResult', setRoundResult);
    socket.on('game:over', (wId, stats) => { setWinnerId(wId); setGameStats(stats); });
    socket.on('game:rematchStarting', () => {
      setWinnerId(null);
      setGameStats(null);
      setRoundResult(null);
      setRoundTransition(false);
      setRoundTransitionDeadline(null);
      pendingGameStateRef.current = null;
      if (roundResultTimerRef.current) {
        clearTimeout(roundResultTimerRef.current);
        roundResultTimerRef.current = null;
      }
    });
    socket.on('room:error', setError);
    socket.on('room:deleted', clearRoomState);
    socket.on('server:playerCount', setOnlinePlayerCount);
    socket.on('server:playerNames', setOnlinePlayerNames);

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('room:state');
      socket.off('game:state');
      socket.off('game:newRound');
      socket.off('game:roundResult');
      socket.off('game:over');
      socket.off('game:rematchStarting');
      socket.off('room:error');
      socket.off('room:deleted');
      socket.off('server:playerCount');
      socket.off('server:playerNames');
      socket.io.off('reconnect', handleReconnect);
    };
  }, []);

  const createRoom = useCallback((playerName: string): Promise<string> => {
    return withTimeout(new Promise((resolve, reject) => {
      socket.emit('room:create', { playerName }, (response) => {
        if ('error' in response) return reject(new Error(response.error));
        sessionStorage.setItem(ROOM_CODE_KEY, response.roomCode);
        sessionStorage.setItem(PLAYER_NAME_KEY, playerName);
        sessionStorage.setItem(RECONNECT_TOKEN_KEY, response.reconnectToken);
        resolve(response.roomCode);
      });
    }));
  }, []);

  const joinRoom = useCallback((roomCode: string, playerName: string): Promise<void> => {
    return withTimeout(new Promise((resolve, reject) => {
      const storedId = sessionStorage.getItem(PLAYER_ID_KEY) ?? undefined;
      const storedToken = sessionStorage.getItem(RECONNECT_TOKEN_KEY) ?? undefined;
      socket.emit('room:join', { roomCode, playerName, playerId: storedId, reconnectToken: storedToken }, (response) => {
        if ('error' in response) return reject(new Error(response.error));
        setPlayerId(response.playerId);
        sessionStorage.setItem(PLAYER_ID_KEY, response.playerId);
        sessionStorage.setItem(PLAYER_NAME_KEY, playerName);
        sessionStorage.setItem(ROOM_CODE_KEY, roomCode);
        sessionStorage.setItem(RECONNECT_TOKEN_KEY, response.reconnectToken);
        resolve();
      });
    }));
  }, []);

  const leaveRoom = useCallback(() => {
    socket.emit('room:leave');
    setRoomState(null);
    setGameState(null);
    setRoundResult(null);
    setRoundTransition(false);
    setWinnerId(null);
    setGameStats(null);
    sessionStorage.removeItem(PLAYER_ID_KEY);
    sessionStorage.removeItem(PLAYER_NAME_KEY);
    sessionStorage.removeItem(ROOM_CODE_KEY);
    sessionStorage.removeItem(RECONNECT_TOKEN_KEY);
  }, []);

  const deleteRoom = useCallback(() => {
    socket.emit('room:delete');
    setRoomState(null);
    setGameState(null);
    setRoundResult(null);
    setRoundTransition(false);
    setWinnerId(null);
    setGameStats(null);
    sessionStorage.removeItem(PLAYER_ID_KEY);
    sessionStorage.removeItem(PLAYER_NAME_KEY);
    sessionStorage.removeItem(ROOM_CODE_KEY);
    sessionStorage.removeItem(RECONNECT_TOKEN_KEY);
  }, []);

  const listRooms = useCallback((): Promise<RoomListing[]> => {
    return withTimeout(new Promise((resolve) => {
      socket.emit('room:list', (response) => resolve(response.rooms));
    }));
  }, []);

  const listLiveGames = useCallback((): Promise<LiveGameListing[]> => {
    return withTimeout(new Promise((resolve) => {
      socket.emit('room:listLive', (response) => resolve(response.games));
    }));
  }, []);

  const spectateGame = useCallback((roomCode: string): Promise<void> => {
    return withTimeout(new Promise((resolve, reject) => {
      socket.emit('room:spectate', { roomCode }, (response) => {
        if ('error' in response) return reject(new Error(response.error));
        sessionStorage.setItem(ROOM_CODE_KEY, roomCode);
        resolve();
      });
    }));
  }, []);

  const updateSettings = useCallback((settings: GameSettings) => {
    socket.emit('room:updateSettings', { settings });
  }, []);

  const clearRoundResult = useCallback(() => {
    if (!roundResultRef.current) return;
    socket.emit('game:continue');
    setRoundResult(null);
    roundResultRef.current = null;
    if (roundResultTimerRef.current) {
      clearTimeout(roundResultTimerRef.current);
      roundResultTimerRef.current = null;
    }
    // If the server already sent the next round state while the overlay was
    // showing, apply it immediately instead of showing the transition overlay.
    const pending = pendingGameStateRef.current;
    pendingGameStateRef.current = null;
    if (pending) {
      setGameState(pending);
      setRoundTransition(false);
      setRoundTransitionDeadline(null);
    } else {
      setRoundTransition(true);
      setRoundTransitionDeadline(roundResultReceivedAtRef.current + 30000);
    }
  }, []);

  const addBot = useCallback((botName?: string): Promise<string> => {
    return withTimeout(new Promise((resolve, reject) => {
      socket.emit('room:addBot', { botName }, (response) => {
        if ('error' in response) return reject(new Error(response.error));
        resolve(response.botId);
      });
    }));
  }, []);

  const removeBot = useCallback((botId: string) => {
    socket.emit('room:removeBot', { botId });
  }, []);

  const startGame = useCallback(() => socket.emit('game:start'), []);
  const requestRematch = useCallback(() => socket.emit('game:rematch'), []);
  const callHand = useCallback((hand: HandCall) => socket.emit('game:call', { hand }), []);
  const callBull = useCallback(() => socket.emit('game:bull'), []);
  const callTrue = useCallback(() => socket.emit('game:true'), []);
  const lastChanceRaiseAction = useCallback((hand: HandCall) => socket.emit('game:lastChanceRaise', { hand }), []);
  const lastChancePassAction = useCallback(() => socket.emit('game:lastChancePass'), []);
  const clearErrorAction = useCallback(() => setError(null), []);

  // Presence context value is separate so online player count/name changes
  // (server-wide events on every connect/disconnect) don't re-render game
  // components. Only Layout subscribes to PresenceContext.
  const presenceValue: PresenceContextValue = useMemo(() => ({
    onlinePlayerCount,
    onlinePlayerNames,
  }), [onlinePlayerCount, onlinePlayerNames]);

  const value: GameContextValue = useMemo(() => ({
    roomState,
    gameState,
    roundResult,
    roundTransition,
    roundTransitionDeadline,
    winnerId,
    gameStats,
    playerId,
    error,
    isConnected,
    hasConnected,
    onlinePlayerCount,
    onlinePlayerNames,
    createRoom,
    joinRoom,
    leaveRoom,
    deleteRoom,
    listRooms,
    listLiveGames,
    spectateGame,
    updateSettings,
    startGame,
    callHand,
    callBull,
    callTrue,
    lastChanceRaise: lastChanceRaiseAction,
    lastChancePass: lastChancePassAction,
    clearError: clearErrorAction,
    clearRoundResult,
    addBot,
    removeBot,
    requestRematch,
  }), [
    roomState, gameState, roundResult, roundTransition, roundTransitionDeadline,
    winnerId, gameStats, playerId, error, isConnected, hasConnected,
    onlinePlayerCount, onlinePlayerNames,
    createRoom, joinRoom, leaveRoom, deleteRoom, listRooms, listLiveGames,
    spectateGame, updateSettings, startGame, callHand, callBull, callTrue,
    lastChanceRaiseAction, lastChancePassAction, clearErrorAction, clearRoundResult,
    addBot, removeBot, requestRematch,
  ]);

  return (
    <PresenceContext.Provider value={presenceValue}>
      <GameContext.Provider value={value}>{children}</GameContext.Provider>
    </PresenceContext.Provider>
  );
}

export function useGameContext(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGameContext must be used within GameProvider');
  return ctx;
}
