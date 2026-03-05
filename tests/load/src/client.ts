/**
 * Socket.io client wrapper for load testing.
 * Provides timed operations and automated game play for simulating
 * concurrent players.
 */

import { io, Socket } from 'socket.io-client';
import type { MetricsCollector } from './metrics.js';

// Re-declare minimal event interfaces to avoid importing from shared
// (load tests run standalone without workspace resolution)
interface ClientToServerEvents {
  'room:create': (data: { playerName: string }, callback: (response: { roomCode: string; reconnectToken: string } | { error: string }) => void) => void;
  'room:join': (data: { roomCode: string; playerName: string; playerId?: string; reconnectToken?: string }, callback: (response: { playerId: string; reconnectToken: string } | { error: string }) => void) => void;
  'room:leave': () => void;
  'room:addBot': (data: { botName?: string }, callback: (response: { botId: string } | { error: string }) => void) => void;
  'room:removeBot': (data: { botId: string }) => void;
  'room:updateSettings': (data: { settings: Record<string, unknown> }) => void;
  'room:delete': () => void;
  'game:start': () => void;
  'game:call': (data: { hand: HandCall }) => void;
  'game:bull': () => void;
  'game:true': () => void;
  'game:lastChanceRaise': (data: { hand: HandCall }) => void;
  'game:lastChancePass': () => void;
  'game:continue': () => void;
  'game:rematch': () => void;
}

interface ServerToClientEvents {
  'room:state': (state: RoomState) => void;
  'room:error': (message: string) => void;
  'room:deleted': () => void;
  'game:state': (state: GameState) => void;
  'game:newRound': (state: GameState) => void;
  'game:roundResult': (result: RoundResult) => void;
  'game:over': (winnerId: string, gameStats: unknown) => void;
  'game:rematchStarting': () => void;
  'player:disconnected': (playerId: string, deadline: number) => void;
  'player:reconnected': (playerId: string) => void;
  'server:playerCount': (count: number) => void;
  'server:playerNames': (names: string[]) => void;
}

// Minimal type stubs for game data
interface HandCall {
  type: number;
  rank?: string;
  suit?: string;
  highRank?: string;
  lowRank?: string;
  threeRank?: string;
  twoRank?: string;
}

interface RoomState {
  roomCode: string;
  players: Array<{ id: string; name: string; isHost: boolean; isBot?: boolean }>;
  hostId: string;
  gamePhase: string;
  settings: Record<string, unknown>;
  spectatorCount: number;
}

interface GameState {
  gamePhase: string;
  players: Array<{ id: string; name: string; cardCount: number; isEliminated: boolean; isBot?: boolean }>;
  myCards: Array<{ rank: string; suit: string }>;
  currentPlayerId: string;
  currentHand: HandCall | null;
  roundPhase: string;
  turnHistory: Array<{ playerId: string; action: string; hand?: HandCall }>;
  roundNumber: number;
  maxCards: number;
}

interface RoundResult {
  calledHand: HandCall;
  handExists: boolean;
  penalizedPlayerIds: string[];
  eliminatedPlayerIds: string[];
}

const CALLBACK_TIMEOUT_MS = 10_000;

// Hand types matching the enum in shared/types.ts
const HandType = {
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  FLUSH: 3,
  THREE_OF_A_KIND: 4,
  STRAIGHT: 5,
  FULL_HOUSE: 6,
  FOUR_OF_A_KIND: 7,
  STRAIGHT_FLUSH: 8,
  ROYAL_FLUSH: 9,
} as const;

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;
const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;

export interface LoadTestClientOptions {
  serverUrl: string;
  playerName: string;
  metrics: MetricsCollector;
}

export class LoadTestClient {
  readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  readonly playerName: string;
  private readonly metrics: MetricsCollector;

  playerId: string | null = null;
  roomCode: string | null = null;
  private roomState: RoomState | null = null;
  private gameState: GameState | null = null;
  private roundResult: RoundResult | null = null;
  private isHost = false;
  private connected = false;

  // Event resolution callbacks
  private gameStateResolve: ((state: GameState) => void) | null = null;
  private roundResultResolve: ((result: RoundResult) => void) | null = null;
  private gameOverResolve: ((winnerId: string) => void) | null = null;
  private roomStateResolve: ((state: RoomState) => void) | null = null;

  constructor(options: LoadTestClientOptions) {
    this.playerName = options.playerName;
    this.metrics = options.metrics;

    this.socket = io(options.serverUrl, {
      autoConnect: false,
      reconnection: false, // Load tests don't need reconnection
      timeout: CALLBACK_TIMEOUT_MS,
      transports: ['websocket'], // Skip polling for lower overhead
    }) as Socket<ServerToClientEvents, ClientToServerEvents>;

    this.setupListeners();
  }

  private setupListeners(): void {
    this.socket.on('connect', () => {
      this.connected = true;
      this.metrics.recordConnection();
    });

    this.socket.on('disconnect', () => {
      this.connected = false;
      this.metrics.recordDisconnection();
    });

    this.socket.on('room:state', (state: RoomState) => {
      this.roomState = state;
      if (this.roomStateResolve) {
        this.roomStateResolve(state);
        this.roomStateResolve = null;
      }
    });

    this.socket.on('room:error', (message: string) => {
      this.metrics.recordError(`room:error: ${message}`);
    });

    this.socket.on('game:state', (state: GameState) => {
      this.gameState = state;
      if (this.gameStateResolve) {
        this.gameStateResolve(state);
        this.gameStateResolve = null;
      }
    });

    this.socket.on('game:newRound', (state: GameState) => {
      this.gameState = state;
      this.roundResult = null;
      if (this.gameStateResolve) {
        this.gameStateResolve(state);
        this.gameStateResolve = null;
      }
    });

    this.socket.on('game:roundResult', (result: RoundResult) => {
      this.roundResult = result;
      if (this.roundResultResolve) {
        this.roundResultResolve(result);
        this.roundResultResolve = null;
      }
    });

    this.socket.on('game:over', (winnerId: string) => {
      if (this.gameOverResolve) {
        this.gameOverResolve(winnerId);
        this.gameOverResolve = null;
      }
    });

    this.socket.on('connect_error', (err) => {
      this.metrics.recordError(`connect_error: ${err.message}`);
    });
  }

  /** Connect to the server. Returns when the socket is connected. */
  async connect(): Promise<void> {
    if (this.connected) return;
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, CALLBACK_TIMEOUT_MS);

      this.socket.once('connect', () => {
        clearTimeout(timeout);
        resolve();
      });
      this.socket.once('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      this.socket.connect();
    });
  }

  /** Create a new room. Returns the room code. */
  async createRoom(): Promise<string> {
    const start = Date.now();
    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('room:create timeout'));
      }, CALLBACK_TIMEOUT_MS);

      this.socket.emit('room:create', { playerName: this.playerName }, (response) => {
        clearTimeout(timeout);
        const elapsed = Date.now() - start;
        if ('error' in response) {
          this.metrics.recordError(`room:create: ${response.error}`);
          reject(new Error(response.error));
          return;
        }
        this.roomCode = response.roomCode;
        this.isHost = true;
        this.metrics.recordRoomCreation(elapsed);
        resolve(response.roomCode);
      });
    });
  }

  /** Join an existing room. Returns the assigned player ID. */
  async joinRoom(roomCode: string): Promise<string> {
    const start = Date.now();
    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('room:join timeout'));
      }, CALLBACK_TIMEOUT_MS);

      this.socket.emit('room:join', { roomCode, playerName: this.playerName }, (response) => {
        clearTimeout(timeout);
        const elapsed = Date.now() - start;
        if ('error' in response) {
          this.metrics.recordError(`room:join: ${response.error}`);
          reject(new Error(response.error));
          return;
        }
        this.playerId = response.playerId;
        this.roomCode = roomCode;
        this.metrics.recordRoomJoin(elapsed);
        resolve(response.playerId);
      });
    });
  }

  /** Add a bot to the current room (host only). */
  async addBot(botName?: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('room:addBot timeout'));
      }, CALLBACK_TIMEOUT_MS);

      this.socket.emit('room:addBot', { botName }, (response) => {
        clearTimeout(timeout);
        if ('error' in response) {
          reject(new Error(response.error));
          return;
        }
        resolve(response.botId);
      });
    });
  }

  /** Update room settings. */
  updateSettings(settings: Record<string, unknown>): void {
    this.socket.emit('room:updateSettings', { settings });
  }

  /** Start the game (host only). */
  async startGame(): Promise<GameState> {
    const start = Date.now();
    const statePromise = this.waitForGameState();
    this.socket.emit('game:start');
    const state = await statePromise;
    this.metrics.recordGameStart(Date.now() - start);
    return state;
  }

  /** Call a poker hand. */
  callHand(hand: HandCall): void {
    const start = Date.now();
    this.socket.emit('game:call', { hand });
    this.metrics.recordGameAction(Date.now() - start);
  }

  /** Call bull on the current hand. */
  callBull(): void {
    const start = Date.now();
    this.socket.emit('game:bull');
    this.metrics.recordGameAction(Date.now() - start);
  }

  /** Call true (believe the hand exists). */
  callTrue(): void {
    const start = Date.now();
    this.socket.emit('game:true');
    this.metrics.recordGameAction(Date.now() - start);
  }

  /** Pass on the last chance raise. */
  lastChancePass(): void {
    const start = Date.now();
    this.socket.emit('game:lastChancePass');
    this.metrics.recordGameAction(Date.now() - start);
  }

  /** Continue after round result. */
  continue(): void {
    this.socket.emit('game:continue');
  }

  /** Leave the room and disconnect. */
  async cleanup(): Promise<void> {
    if (this.roomCode) {
      this.socket.emit('room:leave');
      this.roomCode = null;
    }
    this.socket.disconnect();
  }

  /** Wait for the next game:state or game:newRound event. */
  waitForGameState(timeoutMs = CALLBACK_TIMEOUT_MS): Promise<GameState> {
    return new Promise<GameState>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.gameStateResolve = null;
        reject(new Error('Timed out waiting for game:state'));
      }, timeoutMs);

      this.gameStateResolve = (state) => {
        clearTimeout(timeout);
        resolve(state);
      };
    });
  }

  /** Wait for a round result. */
  waitForRoundResult(timeoutMs = CALLBACK_TIMEOUT_MS): Promise<RoundResult> {
    return new Promise<RoundResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.roundResultResolve = null;
        reject(new Error('Timed out waiting for game:roundResult'));
      }, timeoutMs);

      this.roundResultResolve = (result) => {
        clearTimeout(timeout);
        resolve(result);
      };
    });
  }

  /** Wait for game over. */
  waitForGameOver(timeoutMs = 120_000): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.gameOverResolve = null;
        reject(new Error('Timed out waiting for game:over'));
      }, timeoutMs);

      this.gameOverResolve = (winnerId) => {
        clearTimeout(timeout);
        resolve(winnerId);
      };
    });
  }

  /** Wait for a room state update. */
  waitForRoomState(timeoutMs = CALLBACK_TIMEOUT_MS): Promise<RoomState> {
    return new Promise<RoomState>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.roomStateResolve = null;
        reject(new Error('Timed out waiting for room:state'));
      }, timeoutMs);

      this.roomStateResolve = (state) => {
        clearTimeout(timeout);
        resolve(state);
      };
    });
  }

  /** Check if it's this client's turn. */
  isMyTurn(): boolean {
    return this.gameState?.currentPlayerId === this.playerId;
  }

  /** Get current game state. */
  getGameState(): GameState | null {
    return this.gameState;
  }

  /** Get current room state. */
  getRoomState(): RoomState | null {
    return this.roomState;
  }

  /**
   * Generate a valid hand call that's higher than the current hand.
   * Uses simple escalation strategy for load testing:
   * - If no current hand, call high card with a random rank
   * - Otherwise call bull (simpler and exercises the resolution path)
   */
  generateNextAction(): { action: 'call'; hand: HandCall } | { action: 'bull' } | { action: 'true' } | { action: 'lastChancePass' } {
    const state = this.gameState;
    if (!state) return { action: 'bull' };

    if (state.roundPhase === 'last_chance') {
      return { action: 'lastChancePass' };
    }

    if (state.roundPhase === 'bull_phase') {
      // Randomly choose bull or true to exercise both paths
      return Math.random() < 0.7 ? { action: 'bull' } : { action: 'true' };
    }

    // Calling phase
    if (!state.currentHand) {
      // First call of the round — pick a random high card
      const rank = RANKS[Math.floor(Math.random() * RANKS.length)]!;
      return { action: 'call', hand: { type: HandType.HIGH_CARD, rank } };
    }

    // Subsequent call — try to raise, or call bull
    const raised = this.generateHigherHand(state.currentHand);
    if (raised) {
      return { action: 'call', hand: raised };
    }
    return { action: 'bull' };
  }

  /** Generate a hand that's strictly higher than the given hand. */
  private generateHigherHand(current: HandCall): HandCall | null {
    const type = current.type;

    // Simple escalation: move to a higher hand type
    if (type < HandType.PAIR) {
      const rank = RANKS[Math.floor(Math.random() * RANKS.length)]!;
      return { type: HandType.PAIR, rank };
    }
    if (type < HandType.FLUSH) {
      const suit = SUITS[Math.floor(Math.random() * SUITS.length)]!;
      return { type: HandType.FLUSH, suit };
    }
    if (type < HandType.THREE_OF_A_KIND) {
      const rank = RANKS[Math.floor(Math.random() * RANKS.length)]!;
      return { type: HandType.THREE_OF_A_KIND, rank };
    }
    if (type < HandType.STRAIGHT) {
      // Straight needs highRank >= 6 (5-card straight: 2,3,4,5,6)
      const highRanks = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
      const rank = highRanks[Math.floor(Math.random() * highRanks.length)]!;
      return { type: HandType.STRAIGHT, highRank: rank };
    }
    if (type < HandType.FULL_HOUSE) {
      const threeRank = RANKS[Math.floor(Math.random() * RANKS.length)]!;
      let twoRank: string;
      do {
        twoRank = RANKS[Math.floor(Math.random() * RANKS.length)]!;
      } while (twoRank === threeRank);
      return { type: HandType.FULL_HOUSE, threeRank, twoRank };
    }
    if (type < HandType.FOUR_OF_A_KIND) {
      const rank = RANKS[Math.floor(Math.random() * RANKS.length)]!;
      return { type: HandType.FOUR_OF_A_KIND, rank };
    }

    // Already at four of a kind or higher — just bull
    return null;
  }
}

/**
 * Create a batch of connected clients.
 * Returns clients sorted by creation order.
 */
export async function createClients(
  count: number,
  serverUrl: string,
  metrics: MetricsCollector,
  namePrefix = 'LoadPlayer',
): Promise<LoadTestClient[]> {
  const clients: LoadTestClient[] = [];
  const connectPromises: Promise<void>[] = [];

  for (let i = 0; i < count; i++) {
    const client = new LoadTestClient({
      serverUrl,
      playerName: `${namePrefix}_${i}`,
      metrics,
    });
    clients.push(client);
    connectPromises.push(client.connect());
  }

  await Promise.all(connectPromises);
  return clients;
}
