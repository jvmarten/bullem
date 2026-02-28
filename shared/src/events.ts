import type { HandCall, ClientGameState, RoomState, RoundResult, PlayerId } from './types.js';

export interface ClientToServerEvents {
  'room:create': (data: { playerName: string }, callback: (response: { roomCode: string } | { error: string }) => void) => void;
  'room:join': (data: { roomCode: string; playerName: string; playerId?: string }, callback: (response: { playerId: string } | { error: string }) => void) => void;
  'room:leave': () => void;
  'game:start': () => void;
  'game:call': (data: { hand: HandCall }) => void;
  'game:bull': () => void;
  'game:true': () => void;
  'game:lastChanceRaise': (data: { hand: HandCall }) => void;
  'game:lastChancePass': () => void;
}

export interface ServerToClientEvents {
  'room:state': (state: RoomState) => void;
  'room:error': (message: string) => void;
  'game:state': (state: ClientGameState) => void;
  'game:roundResult': (result: RoundResult) => void;
  'game:newRound': (state: ClientGameState) => void;
  'game:over': (winnerId: PlayerId) => void;
  'player:disconnected': (playerId: PlayerId) => void;
  'player:reconnected': (playerId: PlayerId) => void;
}
