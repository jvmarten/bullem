export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  rank: Rank;
  suit: Suit;
}

export enum HandType {
  HIGH_CARD = 0,
  PAIR = 1,
  TWO_PAIR = 2,
  THREE_OF_A_KIND = 3,
  FLUSH = 4,
  STRAIGHT = 5,
  FULL_HOUSE = 6,
  FOUR_OF_A_KIND = 7,
  STRAIGHT_FLUSH = 8,
  ROYAL_FLUSH = 9,
}

export type HandCall =
  | { type: HandType.HIGH_CARD; rank: Rank }
  | { type: HandType.PAIR; rank: Rank }
  | { type: HandType.TWO_PAIR; highRank: Rank; lowRank: Rank }
  | { type: HandType.THREE_OF_A_KIND; rank: Rank }
  | { type: HandType.FLUSH; suit: Suit }
  | { type: HandType.STRAIGHT; highRank: Rank }
  | { type: HandType.FULL_HOUSE; threeRank: Rank; twoRank: Rank }
  | { type: HandType.FOUR_OF_A_KIND; rank: Rank }
  | { type: HandType.STRAIGHT_FLUSH; suit: Suit; highRank: Rank }
  | { type: HandType.ROYAL_FLUSH; suit: Suit };

export type PlayerId = string;

export interface Player {
  id: PlayerId;
  name: string;
  cardCount: number;
  isConnected: boolean;
  isEliminated: boolean;
  isHost: boolean;
}

export interface ServerPlayer extends Player {
  cards: Card[];
}

export enum TurnAction {
  CALL = 'call',
  BULL = 'bull',
  TRUE = 'true',
}

export interface TurnEntry {
  playerId: PlayerId;
  playerName: string;
  action: TurnAction;
  hand?: HandCall;
  timestamp: number;
}

export enum RoundPhase {
  CALLING = 'calling',
  BULL_PHASE = 'bull_phase',
  LAST_CHANCE = 'last_chance',
  RESOLVING = 'resolving',
}

export enum GamePhase {
  LOBBY = 'lobby',
  PLAYING = 'playing',
  ROUND_RESULT = 'round_result',
  GAME_OVER = 'game_over',
}

export interface RoundResult {
  calledHand: HandCall;
  callerId: PlayerId;
  handExists: boolean;
  revealedCards: Card[];
  penalties: Record<PlayerId, number>;
  eliminatedPlayerIds: PlayerId[];
}

export interface ClientGameState {
  gamePhase: GamePhase;
  roundPhase: RoundPhase;
  roundNumber: number;
  players: Player[];
  myCards: Card[];
  currentPlayerId: PlayerId;
  currentHand: HandCall | null;
  lastCallerId: PlayerId | null;
  turnHistory: TurnEntry[];
  startingPlayerId: PlayerId;
  roundResult?: RoundResult;
  winnerId?: PlayerId;
}

export interface RoomState {
  roomCode: string;
  players: Player[];
  hostId: PlayerId;
  gamePhase: GamePhase;
}
