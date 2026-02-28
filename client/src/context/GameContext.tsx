import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { ClientGameState, HandCall, RoomState, RoundResult, PlayerId } from '@bull-em/shared';
import { socket } from '../socket.js';

interface GameContextValue {
  roomState: RoomState | null;
  gameState: ClientGameState | null;
  roundResult: RoundResult | null;
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
}

const GameContext = createContext<GameContextValue | null>(null);

const PLAYER_ID_KEY = 'bull-em-player-id';
const ROOM_CODE_KEY = 'bull-em-room-code';

export function GameProvider({ children }: { children: ReactNode }) {
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [gameState, setGameState] = useState<ClientGameState | null>(null);
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
  const [winnerId, setWinnerId] = useState<PlayerId | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(() =>
    sessionStorage.getItem(PLAYER_ID_KEY),
  );
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Auto-clear errors after 5 seconds
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    socket.connect();

    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));

    socket.on('room:state', setRoomState);
    socket.on('game:state', (state) => {
      setGameState(state);
      setRoundResult(null);
    });
    socket.on('game:roundResult', setRoundResult);
    socket.on('game:over', setWinnerId);
    socket.on('room:error', setError);

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('room:state');
      socket.off('game:state');
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
    setWinnerId(null);
    sessionStorage.removeItem(PLAYER_ID_KEY);
    sessionStorage.removeItem(ROOM_CODE_KEY);
  }, []);

  const value: GameContextValue = {
    roomState,
    gameState,
    roundResult,
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
    clearRoundResult: () => setRoundResult(null),
  };

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGameContext(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGameContext must be used within GameProvider');
  return ctx;
}
