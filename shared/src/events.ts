import type { HandCall, ClientGameState, RoomState, RoomListing, LiveGameListing, RoundResult, PlayerId, GameSettings, GameStats, PushSubscriptionJSON, RankedMode, MatchmakingStatus, MatchmakingFound, RatingChange, SeriesInfo, AvatarId, FriendEntry } from './types.js';
import type { GameReplay } from './replay.js';

/** Curated set of emoji reactions available during gameplay. */
export const ALLOWED_EMOJIS = ['\u{1F602}', '\u{1F624}', '\u{1F525}', '\u{1F5FF}', '\u{1F44F}', '\u{1F60E}'] as const;
export type GameEmoji = typeof ALLOWED_EMOJIS[number];

/** Data broadcast when a player sends an emoji reaction. */
export interface EmojiReaction {
  playerId: PlayerId;
  emoji: GameEmoji;
  timestamp: number;
}

/** Chat channel — players and spectators have separate chats to prevent cheating. */
export type ChatChannel = 'player' | 'spectator';

/** A chat message sent by a player or spectator. */
export interface ChatMessage {
  id: string;
  senderName: string;
  message: string;
  timestamp: number;
  /** True when the message was sent by a spectator (not an active player). */
  isSpectator: boolean;
  /** Which chat channel this message belongs to. */
  channel: ChatChannel;
}

/**
 * Socket.io events emitted by the client.
 * Used as the type parameter for Socket.io Server/Socket generics to get
 * compile-time type safety on both sides.
 */
export interface ClientToServerEvents {
  'room:create': (data: { playerName: string; avatar?: AvatarId | null }, callback: (response: { roomCode: string; reconnectToken: string } | { error: string }) => void) => void;
  'room:join': (data: { roomCode: string; playerName: string; playerId?: string; reconnectToken?: string; avatar?: AvatarId | null }, callback: (response: { playerId: string; reconnectToken: string } | { error: string }) => void) => void;
  'room:leave': () => void;
  'room:list': (callback: (response: { rooms: RoomListing[] }) => void) => void;
  'room:listLive': (callback: (response: { games: LiveGameListing[] }) => void) => void;
  'room:spectate': (data: { roomCode: string }, callback: (response: { ok: true } | { error: string }) => void) => void;
  'room:updateSettings': (data: { settings: GameSettings }) => void;
  'room:setVisibility': (data: { isPublic: boolean }) => void;
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
  'game:reaction': (data: { emoji: GameEmoji }) => void;
  'chat:send': (data: { message: string }) => void;
  'push:subscribe': (subscription: PushSubscriptionJSON, callback: (response: { ok: true } | { error: string }) => void) => void;
  'push:unsubscribe': (callback: (response: { ok: true } | { error: string }) => void) => void;
  'matchmaking:join': (data: { mode: RankedMode }, callback: (response: { ok: true } | { error: string }) => void) => void;
  'matchmaking:leave': (callback: (response: { ok: true } | { error: string }) => void) => void;
  /** Send a friend request by username. */
  'friends:request': (data: { username: string }, callback: (response: { ok: true } | { error: string }) => void) => void;
  /** Accept or reject a pending friend request. */
  'friends:respond': (data: { friendUserId: string; accept: boolean }, callback: (response: { ok: true } | { error: string }) => void) => void;
  /** Remove an existing friend. */
  'friends:remove': (data: { friendUserId: string }, callback: (response: { ok: true } | { error: string }) => void) => void;
  /** Invite a friend to the current room. */
  'friends:invite': (data: { friendUserId: string; roomCode: string }, callback: (response: { ok: true } | { error: string }) => void) => void;
  /** Request the current friends list (with online status). */
  'friends:list': (callback: (response: { friends: FriendEntry[]; incomingCount: number } | { error: string }) => void) => void;
}

/** Socket.io events emitted by the server. Each player receives personalized game:state. */
export interface ServerToClientEvents {
  'room:state': (state: RoomState) => void;
  'room:error': (message: string) => void;
  'game:state': (state: ClientGameState) => void;
  'game:roundResult': (result: RoundResult) => void;
  'game:newRound': (state: ClientGameState) => void;
  'game:over': (winnerId: PlayerId, gameStats: GameStats, ratingChanges?: Record<PlayerId, RatingChange>) => void;
  'game:replay': (replay: GameReplay) => void;
  'game:rematchStarting': () => void;
  'game:seriesSetResult': (data: { setWinnerId: PlayerId; seriesInfo: SeriesInfo }) => void;
  'player:disconnected': (playerId: PlayerId, disconnectDeadline: number) => void;
  'player:reconnected': (playerId: PlayerId) => void;
  'server:playerCount': (count: number) => void;
  'server:playerNames': (names: string[]) => void;
  'room:deleted': () => void;
  'room:kicked': () => void;
  'game:reaction': (reaction: EmojiReaction) => void;
  'chat:message': (message: ChatMessage) => void;
  'matchmaking:queued': (status: MatchmakingStatus) => void;
  'matchmaking:found': (match: MatchmakingFound) => void;
  'matchmaking:cancelled': () => void;
  'game:spectatorStats': (stats: GameStats) => void;
  /** Emitted to the OLD socket when an authenticated user's session is
   *  transferred to a new connection (same userId, different socket).
   *  The old client should show a message and stop reconnecting. */
  'session:transferred': () => void;
  /** Countdown before game starts or before a new set in Bo3/Bo5. */
  'game:countdown': (data: { seconds: number; label?: string }) => void;
  /** A friend request was received. */
  'friends:requestReceived': (from: FriendEntry) => void;
  /** A friend request was accepted (by the other party). */
  'friends:requestAccepted': (friend: FriendEntry) => void;
  /** A friend's online status changed. */
  'friends:statusChanged': (data: { userId: string; isOnline: boolean; currentRoomCode?: string | null }) => void;
  /** You were invited to join a friend's room. */
  'friends:invited': (data: { fromUserId: string; fromUsername: string; roomCode: string }) => void;
  /** A friend created or joined a room (for notifications). */
  'friends:roomCreated': (data: { userId: string; username: string; roomCode: string }) => void;
}
