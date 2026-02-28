import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import type { ClientGameState, HandCall, RoomState, RoundResult, PlayerId } from '@bull-em/shared';
import { socket } from '../socket.js';

export interface GameContextValue {
  roomState: RoomState | null;
  gameState: ClientGameState | null;
  roundResult: RoundResult | null;
  roundTransition: boolean;
  winnerId: PlayerId | null;
  playerId: string | null;
  error: string | null;
  isConnected: boolean;
  createRoom: (playerName: string) => Promise<string>;
  joinRoom: (roomCode: string, playerName: string) => Promise<void>;
  leaveRoom: () => void;
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
}

export const GameContext = createContext<GameContextValue | null>(null);

const PLAYER_ID_KEY = 'bull-em-player-id';
const PLAYER_NAME_KEY = 'bull-em-player-name';
const ROOM_CODE_KEY = 'bull-em-room-code';

export function GameProvider({ children }: { children: ReactNode }) {
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [gameState, setGameState] = useState<ClientGameState | null>(null);
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
  const [roundTransition, setRoundTransition] = useState(false);
  const [winnerId, setWinnerId] = useState<PlayerId | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(() =>
    sessionStorage.getItem(PLAYER_ID_KEY),
  );
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const roundResultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-clear errors after 5 seconds
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(timer);
  }, [error]);

  // Auto-dismiss round result after 4 seconds
  useEffect(() => {
    if (!roundResult) return;
    roundResultTimerRef.current = setTimeout(() => {
      setRoundResult(null);
      setRoundTransition(true);
    }, 4000);
    return () => {
      if (roundResultTimerRef.current) clearTimeout(roundResultTimerRef.current);
    };
  }, [roundResult]);

  useEffect(() => {
    socket.connect();

    const handleNewGameState = (state: ClientGameState) => {
      setGameState(state);
      setRoundResult(null);
      setRoundTransition(false);
      if (roundResultTimerRef.current) {
        clearTimeout(roundResultTimerRef.current);
        roundResultTimerRef.current = null;
      }
    };

    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));

    socket.on('room:state', (state) => {
      setRoomState(state);
      // Auto-detect playerId for room creators: room:create doesn't return
      // the playerId, but when we're the only player we must be the host
      if (!sessionStorage.getItem(PLAYER_ID_KEY) && state.players.length === 1) {
        const id = state.players[0].id;
        setPlayerId(id);
        sessionStorage.setItem(PLAYER_ID_KEY, id);
      }
    });
    socket.on('game:state', handleNewGameState);
    socket.on('game:newRound', handleNewGameState);
    socket.on('game:roundResult', setRoundResult);
    socket.on('game:over', setWinnerId);
    socket.on('room:error', setError);

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('room:state');
      socket.off('game:state');
      socket.off('game:newRound');
      socket.off('game:roundResult');
      socket.off('game:over');
      socket.off('room:error');
      socket.disconnect();
    };
  }, []);

  const createRoom = useCallback((playerName: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      socket.emit('room:create', { playerName }, (response) => {
        if ('error' in response) return reject(new Error(response.error));
        sessionStorage.setItem(ROOM_CODE_KEY, response.roomCode);
        sessionStorage.setItem(PLAYER_NAME_KEY, playerName);
        resolve(response.roomCode);
      });
    });
  }, []);

  const joinRoom = useCallback((roomCode: string, playerName: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const storedId = sessionStorage.getItem(PLAYER_ID_KEY) ?? undefined;
      socket.emit('room:join', { roomCode, playerName, playerId: storedId }, (response) => {
        if ('error' in response) return reject(new Error(response.error));
        setPlayerId(response.playerId);
        sessionStorage.setItem(PLAYER_ID_KEY, response.playerId);
        sessionStorage.setItem(PLAYER_NAME_KEY, playerName);
        sessionStorage.setItem(ROOM_CODE_KEY, roomCode);
        resolve();
      });
    });
  }, []);

  const leaveRoom = useCallback(() => {
    socket.emit('room:leave');
    setRoomState(null);
    setGameState(null);
    setRoundResult(null);
    setRoundTransition(false);
    setWinnerId(null);
    sessionStorage.removeItem(PLAYER_ID_KEY);
    sessionStorage.removeItem(PLAYER_NAME_KEY);
    sessionStorage.removeItem(ROOM_CODE_KEY);
  }, []);

  const clearRoundResult = useCallback(() => {
    setRoundResult(null);
    setRoundTransition(true);
    if (roundResultTimerRef.current) {
      clearTimeout(roundResultTimerRef.current);
      roundResultTimerRef.current = null;
    }
  }, []);

  const addBot = useCallback((botName?: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      socket.emit('room:addBot', { botName }, (response) => {
        if ('error' in response) return reject(new Error(response.error));
        resolve(response.botId);
      });
    });
  }, []);

  const removeBot = useCallback((botId: string) => {
    socket.emit('room:removeBot', { botId });
  }, []);

  const value: GameContextValue = {
    roomState,
    gameState,
    roundResult,
    roundTransition,
    winnerId,
    playerId,
    error,
    isConnected,
    createRoom,
    joinRoom,
    leaveRoom,
    startGame: () => socket.emit('game:start'),
    callHand: (hand) => socket.emit('game:call', { hand }),
    callBull: () => socket.emit('game:bull'),
    callTrue: () => socket.emit('game:true'),
    lastChanceRaise: (hand) => socket.emit('game:lastChanceRaise', { hand }),
    lastChancePass: () => socket.emit('game:lastChancePass'),
    clearError: () => setError(null),
    clearRoundResult,
    addBot,
    removeBot,
  };

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGameContext(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGameContext must be used within GameProvider');
  return ctx;
}
