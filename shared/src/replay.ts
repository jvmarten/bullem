import type {
  PlayerId, Card, HandCall, TurnEntry, RoundResult, GameSettings, SpectatorPlayerCards,
} from './types.js';

/**
 * Snapshot of a single round for replay purposes.
 * Captured at round resolution — contains all players' cards (visible in replay)
 * plus the full turn history and resolution outcome.
 */
export interface RoundSnapshot {
  roundNumber: number;
  /** All players' cards at the start of the round (full visibility for replay). */
  playerCards: SpectatorPlayerCards[];
  /** Complete turn-by-turn history for the round. */
  turnHistory: TurnEntry[];
  /** Round resolution result (called hand, penalties, eliminations, revealed cards). */
  result: RoundResult;
}

/** Full game replay — everything needed to step through a completed game. */
export interface GameReplay {
  /** Unique identifier for this replay (room code + timestamp). */
  id: string;
  /** Player names and IDs at game start. */
  players: { id: PlayerId; name: string }[];
  /** Game settings used. */
  settings: GameSettings;
  /** Ordered list of round snapshots. */
  rounds: RoundSnapshot[];
  /** The winner's player ID. */
  winnerId: PlayerId;
  /** ISO timestamp when the game was completed. */
  completedAt: string;
}

/** State of the replay viewer at a given point in time. */
export interface ReplayViewState {
  /** Which round we're viewing (0-indexed into GameReplay.rounds). */
  roundIndex: number;
  /** Which turn entry within the round we've stepped to (0 = before first action, N = after Nth action). */
  turnIndex: number;
  /** Current hand call visible at this point (null before first call). */
  currentHand: HandCall | null;
  /** Player ID of the last caller at this point. */
  lastCallerId: PlayerId | null;
  /** Turn entries visible up to this point. */
  visibleHistory: TurnEntry[];
  /** All players' cards for this round. */
  playerCards: SpectatorPlayerCards[];
  /** True if we've stepped past all turns and are showing the resolution. */
  showingResolution: boolean;
}

/**
 * Pure replay engine — steps through a recorded game snapshot by snapshot.
 * No I/O, no timers, no side effects. The UI drives navigation via step/seek methods.
 */
export class ReplayEngine {
  private readonly replay: GameReplay;
  private _roundIndex = 0;
  private _turnIndex = 0;

  constructor(replay: GameReplay) {
    if (replay.rounds.length === 0) {
      throw new Error('Cannot replay a game with no rounds');
    }
    this.replay = replay;
  }

  get roundCount(): number {
    return this.replay.rounds.length;
  }

  get currentRoundIndex(): number {
    return this._roundIndex;
  }

  get currentTurnIndex(): number {
    return this._turnIndex;
  }

  /** Total number of steps in the current round (turns + 1 for resolution). */
  get currentRoundStepCount(): number {
    return this.replay.rounds[this._roundIndex]!.turnHistory.length + 1;
  }

  /** Whether we're on the very first step of the very first round. */
  get isAtStart(): boolean {
    return this._roundIndex === 0 && this._turnIndex === 0;
  }

  /** Whether we're showing the resolution of the very last round. */
  get isAtEnd(): boolean {
    const lastRound = this.replay.rounds.length - 1;
    const lastStep = this.replay.rounds[lastRound]!.turnHistory.length + 1;
    return this._roundIndex === lastRound && this._turnIndex >= lastStep;
  }

  /** Get the current view state for rendering. */
  getViewState(): ReplayViewState {
    const round = this.replay.rounds[this._roundIndex]!;
    const turnCount = round.turnHistory.length;
    const showingResolution = this._turnIndex > turnCount;
    const visibleCount = Math.min(this._turnIndex, turnCount);
    const visibleHistory = round.turnHistory.slice(0, visibleCount);

    // Compute currentHand and lastCallerId from visible history
    let currentHand: HandCall | null = null;
    let lastCallerId: PlayerId | null = null;
    for (const entry of visibleHistory) {
      if (entry.hand) {
        currentHand = entry.hand;
        lastCallerId = entry.playerId;
      }
    }

    return {
      roundIndex: this._roundIndex,
      turnIndex: this._turnIndex,
      currentHand,
      lastCallerId,
      visibleHistory,
      playerCards: round.playerCards,
      showingResolution,
    };
  }

  /** Get the round result for the current round. */
  getCurrentRoundResult(): RoundResult {
    return this.replay.rounds[this._roundIndex]!.result;
  }

  /** Get the full replay data. */
  getReplay(): GameReplay {
    return this.replay;
  }

  /** Advance one step (one turn action, or to resolution). Returns false if already at end. */
  stepForward(): boolean {
    if (this.isAtEnd) return false;

    const round = this.replay.rounds[this._roundIndex]!;
    const maxStep = round.turnHistory.length + 1;

    if (this._turnIndex < maxStep) {
      this._turnIndex++;
    } else {
      // Move to next round
      this._roundIndex++;
      this._turnIndex = 0;
    }
    return true;
  }

  /** Go back one step. Returns false if already at start. */
  stepBackward(): boolean {
    if (this.isAtStart) return false;

    if (this._turnIndex > 0) {
      this._turnIndex--;
    } else {
      // Move to previous round's last step (resolution)
      this._roundIndex--;
      const prevRound = this.replay.rounds[this._roundIndex]!;
      this._turnIndex = prevRound.turnHistory.length + 1;
    }
    return true;
  }

  /** Jump to a specific round (starts at turn 0). */
  seekToRound(roundIndex: number): void {
    if (roundIndex < 0 || roundIndex >= this.replay.rounds.length) return;
    this._roundIndex = roundIndex;
    this._turnIndex = 0;
  }

  /** Jump to start. */
  seekToStart(): void {
    this._roundIndex = 0;
    this._turnIndex = 0;
  }

  /** Jump to end (resolution of last round). */
  seekToEnd(): void {
    this._roundIndex = this.replay.rounds.length - 1;
    const lastRound = this.replay.rounds[this._roundIndex]!;
    this._turnIndex = lastRound.turnHistory.length + 1;
  }

  /** Jump to the resolution of the current round. */
  seekToRoundEnd(): void {
    const round = this.replay.rounds[this._roundIndex]!;
    this._turnIndex = round.turnHistory.length + 1;
  }
}

/** Summary info for replay list items returned by the API. */
export interface ReplayListEntry {
  id: string;
  roomCode: string;
  winnerName: string;
  playerCount: number;
  roundCount: number;
  completedAt: string;
}

// ── localStorage persistence for replays ──────────────────────────────

const REPLAY_STORAGE_KEY = 'bull-em-replays';
const MAX_STORED_REPLAYS = 10;

// Server-side replay persistence is implemented via the rounds table in PostgreSQL.
// Replays are saved on game_over and served via GET /api/replays/:gameId.
// localStorage below is kept as an offline fallback for guests without accounts.

/** Save a replay to localStorage, evicting the oldest if at capacity. */
export function saveReplay(replay: GameReplay): void {
  try {
    const replays = loadAllReplays();
    replays.unshift(replay);
    if (replays.length > MAX_STORED_REPLAYS) {
      replays.length = MAX_STORED_REPLAYS;
    }
    localStorage.setItem(REPLAY_STORAGE_KEY, JSON.stringify(replays));
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

/** Load all stored replays, newest first. */
export function loadAllReplays(): GameReplay[] {
  try {
    const raw = localStorage.getItem(REPLAY_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as GameReplay[];
  } catch {
    return [];
  }
}

/** Load a single replay by ID. */
export function loadReplay(id: string): GameReplay | null {
  return loadAllReplays().find(r => r.id === id) ?? null;
}

/** Delete a replay by ID. */
export function deleteReplay(id: string): void {
  try {
    const replays = loadAllReplays().filter(r => r.id !== id);
    localStorage.setItem(REPLAY_STORAGE_KEY, JSON.stringify(replays));
  } catch {
    // Silently ignore
  }
}
