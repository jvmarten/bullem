import type { HandCall, ClientGameState, RoomState, RoomListing, RoundResult, PlayerId, GameSettings, GameStats } from './types.js';

export interface ClientToServerEvents {
  'room:create': (data: { playerName: string }, callback: (response: { roomCode: string } | { error: string }) => void) => void;
  'room:join': (data: { roomCode: string; playerName: string; playerId?: string }, callback: (response: { playerId: string } | { error: string }) => void) => void;
  'room:leave': () => void;
  'room:list': (callback: (response: { rooms: RoomListing[] }) => void) => void;
  'room:updateSettings': (data: { settings: GameSettings }) => void;
  'game:start': () => void;
  'game:call': (data: { hand: HandCall }) => void;
  'game:bull': () => void;
  'game:true': () => void;
  'game:lastChanceRaise': (data: { hand: HandCall }) => void;
  'game:lastChancePass': () => void;
  'room:addBot': (data: { botName?: string }, callback: (response: { botId: string } | { error: string }) => void) => void;
  'room:removeBot': (data: { botId: string }) => void;
}

export interface ServerToClientEvents {
  'room:state': (state: RoomState) => void;
  'room:error': (message: string) => void;
  'game:state': (state: ClientGameState) => void;
  'game:roundResult': (result: RoundResult) => void;
  'game:newRound': (state: ClientGameState) => void;
  'game:over': (winnerId: PlayerId, gameStats: GameStats) => void;
  'player:disconnected': (playerId: PlayerId) => void;
  'player:reconnected': (playerId: PlayerId) => void;
  'server:playerCount': (count: number) => void;
}
