import type { HandCall, ClientGameState, RoomState, RoomListing, LiveGameListing, RoundResult, PlayerId, GameSettings, GameStats } from './types.js';

/**
 * Socket.io events emitted by the client.
 * Used as the type parameter for Socket.io Server/Socket generics to get
 * compile-time type safety on both sides.
 */
export interface ClientToServerEvents {
  'room:create': (data: { playerName: string }, callback: (response: { roomCode: string; reconnectToken: string } | { error: string }) => void) => void;
  'room:join': (data: { roomCode: string; playerName: string; playerId?: string; reconnectToken?: string }, callback: (response: { playerId: string; reconnectToken: string } | { error: string }) => void) => void;
  'room:leave': () => void;
  'room:list': (callback: (response: { rooms: RoomListing[] }) => void) => void;
  'room:listLive': (callback: (response: { games: LiveGameListing[] }) => void) => void;
  'room:spectate': (data: { roomCode: string }, callback: (response: { ok: true } | { error: string }) => void) => void;
  'room:updateSettings': (data: { settings: GameSettings }) => void;
  'game:start': () => void;
  'game:call': (data: { hand: HandCall }) => void;
  'game:bull': () => void;
  'game:true': () => void;
  'game:lastChanceRaise': (data: { hand: HandCall }) => void;
  'game:lastChancePass': () => void;
  'game:continue': () => void;
  'game:rematch': () => void;
  'room:addBot': (data: { botName?: string }, callback: (response: { botId: string } | { error: string }) => void) => void;
  'room:removeBot': (data: { botId: string }) => void;
  'room:kickPlayer': (data: { playerId: string }, callback: (response: { ok: true } | { error: string }) => void) => void;
  'room:delete': () => void;
  'room:watchRandom': (callback: (response: { roomCode: string } | { error: string }) => void) => void;
}

/** Socket.io events emitted by the server. Each player receives personalized game:state. */
export interface ServerToClientEvents {
  'room:state': (state: RoomState) => void;
  'room:error': (message: string) => void;
  'game:state': (state: ClientGameState) => void;
  'game:roundResult': (result: RoundResult) => void;
  'game:newRound': (state: ClientGameState) => void;
  'game:over': (winnerId: PlayerId, gameStats: GameStats) => void;
  'game:rematchStarting': () => void;
  'player:disconnected': (playerId: PlayerId, disconnectDeadline: number) => void;
  'player:reconnected': (playerId: PlayerId) => void;
  'server:playerCount': (count: number) => void;
  'server:playerNames': (names: string[]) => void;
  'room:deleted': () => void;
  'room:kicked': () => void;
}
