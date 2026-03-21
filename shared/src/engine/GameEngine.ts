import { STARTING_CARDS, MAX_CARDS, DEFAULT_GAME_SETTINGS, DECK_SIZE } from '../constants.js';
import { isHigherHand, getMinimumRaise } from '../hands.js';
import {
  GamePhase, RoundPhase, TurnAction,
} from '../types.js';
import type {
  Card, HandCall, OwnedCard, PlayerId, ServerPlayer, ClientGameState, Player, TurnEntry, RoundResult,
  GameSettings, GameStats, PlayerGameStats, HandTypeBreakdownEntry, SpectatorPlayerCards, GameEngineSnapshot,
} from '../types.js';
import type { RoundSnapshot } from '../replay.js';
import { Deck } from './Deck.js';
import { HandChecker } from './HandChecker.js';

/** Result of processing a player action. Tells the caller what to do next. */
export type TurnResult =
  | { type: 'continue' }
  | { type: 'last_chance'; playerId: PlayerId }
  | { type: 'resolve'; result: RoundResult }
  | { type: 'game_over'; winnerId: PlayerId; finalRoundResult?: RoundResult }
  | { type: 'error'; message: string };

/**
 * Core game state machine. Manages rounds, turns, and scoring.
 * Pure logic — no I/O, no timers, no network. The server wraps this
 * in socket handlers; the client wraps it in LocalGameContext for offline play.
 */
export class GameEngine {
  private deck: Deck;
  private players: ServerPlayer[];
  private settings: GameSettings;
  private roundNumber = 0;
  private roundPhase = RoundPhase.CALLING;
  private currentPlayerIndex = 0;
  private currentHand: HandCall | null = null;
  private lastCallerId: PlayerId | null = null;
  private turnHistory: TurnEntry[] = [];
  private startingPlayerIndex = 0;
  /** ID of the player who started the current round. Used to correctly advance
   *  the starting player in startNextRound even when the starter is eliminated
   *  mid-round (which shifts active player indices). */
  private _startingPlayerId: PlayerId = '';
  private respondedPlayers = new Set<PlayerId>();
  private lastRoundResult: RoundResult | null = null;
  private lastChanceUsed = false;
  private gameStats: GameStats;
  private _turnDeadline: number | null = null;
  private _turnDurationMs: number | null = null;
  /** Round snapshots collected for game replay. Populated at each round resolution. */
  private _roundSnapshots: RoundSnapshot[] = [];
  /** Cards dealt at the start of the current round — captured before any actions. */
  private _roundStartCards: SpectatorPlayerCards[] = [];
  /** Cached active players list — invalidated when the eliminated count changes.
   *  Avoids creating a new filtered array on every call to getActivePlayers(),
   *  which is invoked 5-10 times per turn action across validateTurn, advanceTurn,
   *  allNonCallersResponded, currentPlayerId, resolveRound, etc. */
  private _activePlayers: ServerPlayer[] | null = null;
  private _activePlayersEliminatedCount = -1;

  constructor(players: ServerPlayer[], settings: GameSettings = DEFAULT_GAME_SETTINGS) {
    this.players = players;
    this.settings = { ...settings };
    this.deck = new Deck(settings.jokerCount ?? 0);
    const playerStats: Record<PlayerId, PlayerGameStats> = {};
    for (const p of players) {
      playerStats[p.id] = {
        bullsCalled: 0,
        truesCalled: 0,
        callsMade: 0,
        correctBulls: 0,
        correctTrues: 0,
        bluffsSuccessful: 0,
        roundsSurvived: 0,
        handBreakdown: [],
      };
    }
    this.gameStats = { totalRounds: 0, playerStats };
  }

  /** Turn timer in seconds (0 = disabled). */
  get turnTimer(): number {
    return this.settings.turnTimer ?? 0;
  }

  /** Current round phase — lightweight accessor to avoid building full client state
   *  when callers only need to check the phase (e.g. for bot delay selection). */
  get currentRoundPhase(): RoundPhase {
    return this.roundPhase;
  }

  /** Current round number — lightweight accessor to avoid building full client
   *  state when callers only need the round number (e.g. live game listings). */
  get currentRoundNumber(): number {
    return this.roundNumber;
  }

  setTurnDeadline(deadline: number | null, durationMs?: number | null): void {
    this._turnDeadline = deadline;
    this._turnDurationMs = durationMs ?? null;
  }

  /** Deal cards and begin a new round. Call once at game start. Use startNextRound() for subsequent rounds. */
  startRound(): void {
    this.roundNumber++;
    this.deck.reset();
    this.roundPhase = RoundPhase.CALLING;
    this.currentHand = null;
    this.lastCallerId = null;
    this.turnHistory = [];
    this.respondedPlayers.clear();
    this.lastRoundResult = null;
    this.lastChanceUsed = false;

    // Deal cards (with deck exhaustion safety)
    for (const p of this.getActivePlayers()) {
      const needed = p.cardCount ?? STARTING_CARDS;
      const available = Math.min(needed, this.deck.remaining);
      p.cards = this.deck.deal(available);
    }

    // Capture dealt cards for replay before any actions modify state
    this._roundStartCards = this.getActivePlayers().map(p => ({
      playerId: p.id,
      playerName: p.name,
      cards: [...p.cards],
    }));

    // Starting player rotates each round
    const active = this.getActivePlayers();
    this.startingPlayerIndex = (this.roundNumber - 1) % active.length;
    this._startingPlayerId = active[this.startingPlayerIndex]?.id ?? '';
    this.currentPlayerIndex = this.startingPlayerIndex;
  }

  /** True if one or fewer players remain (game is over). */
  get gameOver(): boolean {
    return this.getActivePlayers().length <= 1;
  }

  /** ID of the last remaining player, or null if the game is still in progress. */
  get winnerId(): PlayerId | null {
    const active = this.getActivePlayers();
    return active.length === 1 ? active[0]!.id : null;
  }

  /** Advance to the next round: rotate starting player, re-deal cards, reset turn state. */
  startNextRound(): { type: 'new_round' } | { type: 'game_over'; winnerId: PlayerId } {
    const active = this.getActivePlayers();
    if (active.length <= 1) {
      return { type: 'game_over', winnerId: active[0]?.id ?? '' };
    }

    // Rotate starting player clockwise, skipping eliminated players.
    // Use the stored ID (not the index) because eliminations during the
    // previous round shift active-array indices, causing the old index to
    // map to the wrong player.
    const prevStarterGlobalIndex = this.players.findIndex(p => p.id === this._startingPlayerId);
    let nextGlobalIndex = (prevStarterGlobalIndex + 1) % this.players.length;
    // Safety bound: iterate at most players.length times to prevent infinite loop
    // if game state is somehow inconsistent (e.g. all players eliminated).
    let guard = this.players.length;
    while (this.players[nextGlobalIndex]!.isEliminated && guard-- > 0) {
      nextGlobalIndex = (nextGlobalIndex + 1) % this.players.length;
    }
    const nextStarterId = this.players[nextGlobalIndex]!.id;
    const nextStarterActiveIndex = active.findIndex(p => p.id === nextStarterId);

    // Reset round state
    this.roundNumber++;
    this.deck.reset();
    this.roundPhase = RoundPhase.CALLING;
    this.currentHand = null;
    this.lastCallerId = null;
    this.turnHistory = [];
    this.respondedPlayers.clear();
    this.lastRoundResult = null;
    this.lastChanceUsed = false;

    // Re-deal cards based on each player's current card count (with deck exhaustion safety)
    for (const p of this.getActivePlayers()) {
      const needed = p.cardCount ?? STARTING_CARDS;
      const available = Math.min(needed, this.deck.remaining);
      p.cards = this.deck.deal(available);
    }

    // Capture dealt cards for replay before any actions modify state
    this._roundStartCards = this.getActivePlayers().map(p => ({
      playerId: p.id,
      playerName: p.name,
      cards: [...p.cards],
    }));

    this.startingPlayerIndex = nextStarterActiveIndex;
    this._startingPlayerId = this.getActivePlayers()[nextStarterActiveIndex]?.id ?? '';
    this.currentPlayerIndex = this.startingPlayerIndex;

    return { type: 'new_round' };
  }

  /** ID of the player whose turn it currently is. */
  get currentPlayerId(): PlayerId {
    return this.getActivePlayers()[this.currentPlayerIndex]?.id ?? '';
  }

  /** Process a player calling (or raising to) a hand. Resets the bull phase. */
  handleCall(playerId: PlayerId, hand: HandCall): TurnResult {
    const error = this.validateTurn(playerId);
    if (error) return { type: 'error', message: error };

    if (this.currentHand && !isHigherHand(hand, this.currentHand)) {
      return { type: 'error', message: 'Hand must be higher than current call' };
    }

    this.currentHand = hand;
    this.lastCallerId = playerId;
    this.lastChanceUsed = false;
    this.addTurnEntry(playerId, TurnAction.CALL, hand);
    const callerStats = this.gameStats.playerStats[playerId];
    if (callerStats) callerStats.callsMade++;
    this.trackHandCall(playerId, hand.type);
    // Track whether the called hand actually exists in the combined cards at call
    // time, regardless of whether this hand survives to the reveal. This gives
    // players accurate "existed %" stats in their profile breakdown.
    if (HandChecker.exists(this.getAllCards(), hand)) {
      this.trackHandExisted(playerId, hand.type);
    }

    // A raise resets the bull phase — unless the hand is unraiseable (e.g. royal flush),
    // in which case go straight to BULL_PHASE so the next player can also call true.
    this.roundPhase = getMinimumRaise(hand) === null ? RoundPhase.BULL_PHASE : RoundPhase.CALLING;
    this.respondedPlayers.clear();
    this.respondedPlayers.add(playerId);
    this.advanceTurn();
    return { type: 'continue' };
  }

  /** Process a player calling bull. May trigger last-chance or resolution if all non-callers responded. */
  handleBull(playerId: PlayerId): TurnResult {
    const error = this.validateTurn(playerId);
    if (error) return { type: 'error', message: error };
    if (!this.currentHand) return { type: 'error', message: 'No hand to call bull on' };

    this.addTurnEntry(playerId, TurnAction.BULL);
    this.respondedPlayers.add(playerId);
    const bullStats = this.gameStats.playerStats[playerId];
    if (bullStats) bullStats.bullsCalled++;

    if (this.roundPhase === RoundPhase.CALLING) {
      this.roundPhase = RoundPhase.BULL_PHASE;
    }

    // Check if all non-callers have responded
    if (this.allNonCallersResponded()) {
      // Check if everyone called bull (no one called true)
      if (!this.hasTrueAfterLastCall()) {
        if (!this.lastChanceUsed) {
          // Last chance for original caller (first time only)
          this.roundPhase = RoundPhase.LAST_CHANCE;
          this.currentPlayerIndex = this.getActivePlayerIndex(this.lastCallerId!);
          return { type: 'last_chance', playerId: this.lastCallerId! };
        } else {
          // Last chance already used — resolve immediately
          return this.resolveRound();
        }
      }
      return this.resolveRound();
    }

    this.advanceTurn();
    return { type: 'continue' };
  }

  /** Process a player calling true (affirming the hand exists). Only valid during BULL_PHASE. */
  handleTrue(playerId: PlayerId): TurnResult {
    const error = this.validateTurn(playerId);
    if (error) return { type: 'error', message: error };
    if (this.roundPhase !== RoundPhase.BULL_PHASE) {
      return { type: 'error', message: 'Can only call true during bull phase' };
    }

    this.addTurnEntry(playerId, TurnAction.TRUE);
    this.respondedPlayers.add(playerId);
    const trueStats = this.gameStats.playerStats[playerId];
    if (trueStats) trueStats.truesCalled++;

    if (this.allNonCallersResponded()) {
      return this.resolveRound();
    }

    this.advanceTurn();
    return { type: 'continue' };
  }

  /** Process a last-chance raise — the original caller raises after everyone called bull.
   *  Only the last caller can raise, and the hand must be higher than the current call. */
  handleLastChanceRaise(playerId: PlayerId, hand: HandCall): TurnResult {
    if (this.roundPhase !== RoundPhase.LAST_CHANCE) {
      return { type: 'error', message: 'Not in last chance phase' };
    }
    if (playerId !== this.lastCallerId) {
      return { type: 'error', message: 'Only the last caller can raise' };
    }
    if (!this.currentHand || !isHigherHand(hand, this.currentHand)) {
      return { type: 'error', message: 'Must raise higher' };
    }

    this.currentHand = hand;
    this.lastChanceUsed = true;
    this.addTurnEntry(playerId, TurnAction.LAST_CHANCE_RAISE, hand);
    const lcStats = this.gameStats.playerStats[playerId];
    if (lcStats) lcStats.callsMade++;
    this.trackHandCall(playerId, hand.type);
    if (HandChecker.exists(this.getAllCards(), hand)) {
      this.trackHandExisted(playerId, hand.type);
    }

    // In strict mode, re-enter CALLING so the first responder can only bull/raise
    // (true is unavailable until someone calls bull, which transitions to BULL_PHASE).
    // In classic mode (default), go straight to BULL_PHASE where true is always available.
    // Exception: if the raised hand is unraiseable (e.g. royal flush), go straight to
    // BULL_PHASE even in strict mode — otherwise players can only call bull with no
    // option to call true, which is functionally broken.
    this.roundPhase = this.settings.lastChanceMode === 'strict' && getMinimumRaise(hand) !== null
      ? RoundPhase.CALLING
      : RoundPhase.BULL_PHASE;

    this.respondedPlayers.clear();
    this.respondedPlayers.add(playerId);
    this.advanceTurn();
    return { type: 'continue' };
  }

  /** Process a last-chance pass — the original caller declines to raise, triggering resolution. */
  handleLastChancePass(playerId: PlayerId): TurnResult {
    if (this.roundPhase !== RoundPhase.LAST_CHANCE) {
      return { type: 'error', message: 'Not in last chance phase' };
    }
    if (playerId !== this.lastCallerId) {
      return { type: 'error', message: 'Only the last caller can pass' };
    }
    this.addTurnEntry(playerId, TurnAction.LAST_CHANCE_PASS);
    return this.resolveRound();
  }

  /** Build a client-safe game state for a specific player (only their cards included). */
  getClientState(playerId: PlayerId): ClientGameState {
    const player = this.players.find(p => p.id === playerId);
    const isEliminated = player?.isEliminated ?? false;

    // Compute shared state once per broadcast cycle (cached until turn history
    // or players change). The server calls getClientState once per player per
    // broadcast — sharing the public-players array and turn-history snapshot
    // avoids O(players^2) allocations (e.g. 12 players = 12 map() + 12 spread).
    const shared = this.getSharedClientState();

    const state: ClientGameState = {
      gamePhase: GamePhase.PLAYING,
      roundPhase: this.roundPhase,
      roundNumber: this.roundNumber,
      maxCards: this.settings.maxCards,
      players: shared.publicPlayers,
      myCards: player?.cards ?? [],
      currentPlayerId: this.currentPlayerId,
      currentHand: this.currentHand,
      lastCallerId: this.lastCallerId,
      turnHistory: shared.turnHistorySnapshot,
      startingPlayerId: this._startingPlayerId,
      roundResult: this.lastRoundResult,
      turnDeadline: this._turnDeadline,
      turnDurationMs: this._turnDurationMs,
    };

    // Spectators (eliminated players) can see all active players' cards
    if (isEliminated) {
      state.spectatorCards = this.getSpectatorCards();
    }

    return state;
  }

  /** Cached spectator cards — avoids rebuilding the array (with spread copies)
   *  for every eliminated player per broadcast cycle. Invalidated when the round
   *  number or eliminated count changes (i.e., when cards are re-dealt or a
   *  player is eliminated). */
  private _spectatorCardsCache: SpectatorPlayerCards[] | null = null;
  private _spectatorCardsCacheKey = '';

  private getSpectatorCards(): SpectatorPlayerCards[] {
    const active = this.getActivePlayers();
    // Cache key: round number + eliminated count + total card count.
    // Cards only change at deal time (new round) or elimination.
    let totalCards = 0;
    for (const p of active) totalCards += p.cards.length;
    const key = `${this.roundNumber}:${this._activePlayersEliminatedCount}:${totalCards}`;
    if (this._spectatorCardsCache && this._spectatorCardsCacheKey === key) {
      return this._spectatorCardsCache;
    }
    this._spectatorCardsCache = active.map(p => ({
      playerId: p.id,
      playerName: p.name,
      cards: [...p.cards],
    }));
    this._spectatorCardsCacheKey = key;
    return this._spectatorCardsCache;
  }

  /** Force the shared client state cache to be rebuilt on the next broadcast.
   *  Call this after mutating player metadata (e.g. photoUrl, avatar) that
   *  isn't tracked by the normal cache invalidation keys. */
  invalidateSharedCache(): void {
    this._sharedClientState = null;
  }

  /** Cached shared state for getClientState — avoids re-computing public
   *  players and turn history snapshots once per player per broadcast. */
  private _sharedClientState: {
    publicPlayers: Player[];
    turnHistorySnapshot: TurnEntry[];
    turnHistoryLength: number;
    playerCount: number;
    connectedCount: number;
    eliminatedCount: number;
  } | null = null;

  private getSharedClientState(): { publicPlayers: Player[]; turnHistorySnapshot: TurnEntry[] } {
    const cached = this._sharedClientState;
    // Count connected and eliminated players so the cache invalidates when
    // player state is mutated externally (e.g. Room sets isConnected = false
    // on a disconnect — the engine's player objects are shared references).
    let connectedCount = 0;
    let eliminatedCount = 0;
    for (const p of this.players) {
      if (p.isConnected) connectedCount++;
      if (p.isEliminated) eliminatedCount++;
    }
    if (
      cached
      && cached.turnHistoryLength === this.turnHistory.length
      && cached.playerCount === this.players.length
      && cached.connectedCount === connectedCount
      && cached.eliminatedCount === eliminatedCount
    ) {
      return cached;
    }
    const shared = {
      publicPlayers: this.players.map(toPublicPlayer),
      turnHistorySnapshot: [...this.turnHistory],
      turnHistoryLength: this.turnHistory.length,
      playerCount: this.players.length,
      connectedCount,
      eliminatedCount,
    };
    this._sharedClientState = shared;
    return shared;
  }

  /** Get accumulated game statistics (per-player bulls, trues, bluffs, hand breakdown). */
  getGameStats(): GameStats {
    return this.gameStats;
  }

  /** Get all round snapshots recorded during this game (for building a replay).
   *  Returns a copy sorted by roundNumber to guarantee correct ordering,
   *  even after engine restore (which may lose earlier snapshots). */
  getRoundSnapshots(): RoundSnapshot[] {
    return [...this._roundSnapshots].sort((a, b) => a.roundNumber - b.roundNumber);
  }

  /** Get all non-eliminated players. Uses a cache that invalidates when the eliminated count changes. */
  getActivePlayers(): ServerPlayer[] {
    // Count eliminated players to detect changes (including external mutations
    // in tests). Only rebuilds the filtered array when the count changes.
    let eliminated = 0;
    for (const p of this.players) {
      if (p.isEliminated) eliminated++;
    }
    if (this._activePlayers === null || eliminated !== this._activePlayersEliminatedCount) {
      this._activePlayersEliminatedCount = eliminated;
      this._activePlayers = this.players.filter(p => !p.isEliminated);
    }
    return this._activePlayers;
  }

  /** Lightweight summary for bot delay calculations — avoids building a full ClientGameState. */
  getRoundSummary(): { activePlayerCount: number; totalCards: number; turnCount: number } {
    let activePlayerCount = 0;
    let totalCards = 0;
    for (const p of this.players) {
      if (!p.isEliminated) {
        activePlayerCount++;
        totalCards += p.cardCount;
      }
    }
    return { activePlayerCount, totalCards, turnCount: this.turnHistory.length };
  }

  /** Eliminate a player mid-game (intentional leave). Returns the resulting game action. */
  eliminatePlayer(playerId: PlayerId): TurnResult {
    const player = this.players.find(p => p.id === playerId);
    if (!player || player.isEliminated) return { type: 'continue' };

    const wasCurrentPlayer = this.currentPlayerId === playerId;
    const wasLastCaller = this.lastCallerId === playerId;

    // Save the current player's ID for re-indexing (null if they're the one leaving)
    const currentActiveId = wasCurrentPlayer ? null : this.currentPlayerId;

    player.isEliminated = true;
    player.cards = [];
    this._activePlayers = null;

    const active = this.getActivePlayers();
    if (active.length <= 1) {
      return { type: 'game_over', winnerId: active[0]?.id ?? '' };
    }

    // During RESOLVING (round result phase), just fix the index — round is already done
    if (this.roundPhase === RoundPhase.RESOLVING) {
      this.reindexCurrentPlayer(currentActiveId, wasCurrentPlayer);
      return { type: 'continue' };
    }

    // LAST_CHANCE: if the caller (who has last chance) left, auto-pass → resolve
    if (this.roundPhase === RoundPhase.LAST_CHANCE && wasLastCaller) {
      return this.resolveRound();
    }

    // Re-index the current player after the active array shrank
    this.reindexCurrentPlayer(currentActiveId, wasCurrentPlayer);

    // No hand called yet — just continue with the next player
    if (!this.currentHand) {
      return { type: 'continue' };
    }

    // Check if all remaining non-callers have now responded
    if (this.allNonCallersResponded()) {
      if (!this.hasTrueAfterLastCall()) {
        const callerStillActive = active.some(p => p.id === this.lastCallerId);
        if (!this.lastChanceUsed && callerStillActive) {
          this.roundPhase = RoundPhase.LAST_CHANCE;
          this.currentPlayerIndex = this.getActivePlayerIndex(this.lastCallerId!);
          return { type: 'last_chance', playerId: this.lastCallerId! };
        }
        // Caller left or already used last chance — resolve immediately
        return this.resolveRound();
      }
      return this.resolveRound();
    }

    return { type: 'continue' };
  }

  /** Re-index currentPlayerIndex after the active-player array shrank by one. */
  private reindexCurrentPlayer(prevActiveId: PlayerId | null, wasCurrentPlayer: boolean): void {
    const active = this.getActivePlayers();
    if (active.length === 0) return;

    if (wasCurrentPlayer) {
      // Same index now points to the next player (or wraps)
      this.currentPlayerIndex = this.currentPlayerIndex % active.length;
      // Skip the last caller (they don't respond to their own call)
      if (active[this.currentPlayerIndex]?.id === this.lastCallerId) {
        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % active.length;
      }
    } else if (prevActiveId) {
      // Another player was eliminated — find where the current player moved to
      const newIdx = active.findIndex(p => p.id === prevActiveId);
      if (newIdx >= 0) {
        this.currentPlayerIndex = newIdx;
      } else {
        this.currentPlayerIndex = this.currentPlayerIndex % active.length;
      }
    }
  }

  private resolveRound(): TurnResult {
    if (!this.currentHand || !this.lastCallerId) {
      return { type: 'error', message: 'Cannot resolve round: no hand was called' };
    }
    this.roundPhase = RoundPhase.RESOLVING;
    this.gameStats.totalRounds++;
    const allCards = this.getAllCards();
    const allCardsOwned = this.getAllCardsWithOwnership();
    const handExists = HandChecker.exists(allCards, this.currentHand);
    const revealedCards = HandChecker.findAllRelevantCards(allCardsOwned, this.currentHand);

    // Note: hand existence is now tracked at call time (in handleCall / handleLastChanceRaise)
    // so it reflects whether the hand existed when called, not just at resolution.

    // Determine who was right and wrong
    const penalties: Record<PlayerId, number> = {};
    const penalizedPlayerIds: PlayerId[] = [];
    const eliminatedPlayerIds: PlayerId[] = [];

    const activePlayers = this.getActivePlayers();

    // Build a lookup of each player's last action once, rather than doing an
    // O(turnHistory) reverse scan per player per loop (previously 2× scans per
    // player across the pre-check and scoring loops below).
    const lastActionByPlayer = new Map<PlayerId, TurnAction>();
    for (let i = this.turnHistory.length - 1; i >= 0; i--) {
      const entry = this.turnHistory[i]!;
      if (!lastActionByPlayer.has(entry.playerId)) {
        lastActionByPlayer.set(entry.playerId, entry.action);
      }
    }

    // Pre-check: if every active player would be penalized AND all would exceed
    // maxCards, skip penalties entirely so the game continues instead of ending
    // in a mass elimination (draw). This can happen when the last-chance raise
    // results in everyone being wrong simultaneously.
    const wouldBePenalized: PlayerId[] = [];
    for (const p of activePlayers) {
      const lastAction = lastActionByPlayer.get(p.id) ?? null;
      let incorrect = false;
      if (p.id === this.lastCallerId) {
        incorrect = !handExists;
      } else if (lastAction === TurnAction.BULL) {
        incorrect = handExists;
      } else if (lastAction === TurnAction.TRUE) {
        incorrect = !handExists;
      } else {
        incorrect = true;
      }
      if (incorrect) wouldBePenalized.push(p.id);
    }
    const allWouldEliminate =
      wouldBePenalized.length === activePlayers.length &&
      activePlayers.every(p => (p.cardCount ?? STARTING_CARDS) + 1 > this.settings.maxCards);

    for (const p of activePlayers) {
      const lastAction = lastActionByPlayer.get(p.id) ?? null;
      let incorrect = false;
      let stats = this.gameStats.playerStats[p.id];
      if (!stats) {
        // Safety: initialize stats for players missing from the stats map
        // (e.g. corrupted snapshot restore). Prevents a crash mid-round.
        stats = {
          bullsCalled: 0, truesCalled: 0, callsMade: 0,
          correctBulls: 0, correctTrues: 0, bluffsSuccessful: 0, roundsSurvived: 0,
          handBreakdown: [],
        };
        this.gameStats.playerStats[p.id] = stats;
      }

      if (p.id === this.lastCallerId) {
        // The caller is wrong if the hand doesn't exist
        incorrect = !handExists;
        if (handExists) {
          // Caller's hand actually existed — bluff was successful (or honest call)
          stats.bluffsSuccessful++;
        }
      } else if (lastAction === TurnAction.BULL) {
        // Bull callers are wrong if the hand exists
        incorrect = handExists;
        if (!handExists) stats.correctBulls++;
      } else if (lastAction === TurnAction.TRUE) {
        // True callers are wrong if the hand doesn't exist
        incorrect = !handExists;
        if (handExists) stats.correctTrues++;
      } else {
        // Player never responded (no bull/true action) — treat as wrong
        incorrect = true;
      }

      if (incorrect && !allWouldEliminate) {
        penalizedPlayerIds.push(p.id);
        p.cardCount = (p.cardCount ?? STARTING_CARDS) + 1;
        if (p.cardCount > this.settings.maxCards) {
          p.isEliminated = true;
          this._activePlayers = null;
          eliminatedPlayerIds.push(p.id);
        }
      }

      // Track rounds survived (everyone still active survived this round)
      if (!p.isEliminated) {
        stats.roundsSurvived++;
      }

      penalties[p.id] = p.cardCount ?? STARTING_CARDS;
    }

    const result: RoundResult = {
      calledHand: this.currentHand,
      callerId: this.lastCallerId,
      handExists,
      revealedCards,
      penalties,
      penalizedPlayerIds,
      eliminatedPlayerIds,
      turnHistory: [...this.turnHistory],
    };
    this.lastRoundResult = result;

    // Record round snapshot for replay
    this._roundSnapshots.push({
      roundNumber: this.roundNumber,
      playerCards: this._roundStartCards,
      turnHistory: [...this.turnHistory],
      result,
    });

    // Check for game over
    const remaining = this.getActivePlayers();
    if (remaining.length <= 1) {
      return { type: 'game_over', winnerId: remaining[0]?.id ?? '', finalRoundResult: result };
    }

    return { type: 'resolve', result };
  }

  private validateTurn(playerId: PlayerId): string | null {
    if (this.roundPhase === RoundPhase.RESOLVING) return 'Round is resolving';
    if (this.roundPhase === RoundPhase.LAST_CHANCE) return 'Waiting for last chance response';
    const active = this.getActivePlayers();
    if (!active.find(p => p.id === playerId)) return 'Player not active';
    if (active[this.currentPlayerIndex]?.id !== playerId) return 'Not your turn';
    return null;
  }

  private advanceTurn(): void {
    const active = this.getActivePlayers();
    if (active.length === 0) return;
    let next = (this.currentPlayerIndex + 1) % active.length;
    // Skip the last caller (they don't respond to their own call).
    // Safety bound: iterate at most active.length times to prevent infinite loop
    // if game state is somehow inconsistent.
    let guard = active.length;
    while (active[next]?.id === this.lastCallerId && guard-- > 0) {
      next = (next + 1) % active.length;
    }
    this.currentPlayerIndex = next;
  }

  private allNonCallersResponded(): boolean {
    const active = this.getActivePlayers();
    return active.every(p => p.id === this.lastCallerId || this.respondedPlayers.has(p.id));
  }

  /** Check if any TRUE action exists after the last CALL/LAST_CHANCE_RAISE.
   *  Replaces the old isAfterLastCall(entry) + .some() pattern which was O(n²)
   *  due to indexOf inside the loop. This does a single O(n) scan. */
  private hasTrueAfterLastCall(): boolean {
    const lastCallIdx = this.getLastCallIndex();
    if (lastCallIdx === -1) return false;
    for (let i = lastCallIdx + 1; i < this.turnHistory.length; i++) {
      if (this.turnHistory[i]!.action === TurnAction.TRUE) return true;
    }
    return false;
  }

  /** Cached index of the last CALL/LAST_CHANCE_RAISE in turnHistory.
   *  Avoids the O(history) reverse search on every isAfterLastCall() call,
   *  which was previously O(history²) when called inside .some() loops. */
  private _lastCallIndex = -1;
  private _lastCallIndexLength = -1;

  private getLastCallIndex(): number {
    if (this._lastCallIndexLength === this.turnHistory.length) {
      return this._lastCallIndex;
    }
    // Scan backwards once to find the last call/raise
    let idx = -1;
    for (let i = this.turnHistory.length - 1; i >= 0; i--) {
      const action = this.turnHistory[i]!.action;
      if (action === TurnAction.CALL || action === TurnAction.LAST_CHANCE_RAISE) {
        idx = i;
        break;
      }
    }
    this._lastCallIndex = idx;
    this._lastCallIndexLength = this.turnHistory.length;
    return idx;
  }

  private getPlayerLastAction(playerId: PlayerId): TurnAction | null {
    for (let i = this.turnHistory.length - 1; i >= 0; i--) {
      if (this.turnHistory[i]!.playerId === playerId) {
        return this.turnHistory[i]!.action;
      }
    }
    return null;
  }

  private getActivePlayerIndex(playerId: PlayerId): number {
    return this.getActivePlayers().findIndex(p => p.id === playerId);
  }

  private getAllCards(): Card[] {
    return this.getActivePlayers().flatMap(p => p.cards);
  }

  private getAllCardsWithOwnership(): OwnedCard[] {
    return this.getActivePlayers().flatMap(p =>
      p.cards.map(card => ({
        ...card,
        playerId: p.id,
        playerName: p.name,
      }))
    );
  }

  private addTurnEntry(playerId: PlayerId, action: TurnAction, hand?: HandCall): void {
    const player = this.players.find(p => p.id === playerId);
    this.turnHistory.push({
      playerId,
      playerName: player?.name ?? 'Unknown',
      action,
      hand,
      timestamp: Date.now(),
    });
  }

  /** Record that a player called a specific hand type. */
  private trackHandCall(playerId: PlayerId, handType: number): void {
    const stats = this.gameStats.playerStats[playerId];
    if (!stats) return;
    if (!stats.handBreakdown) stats.handBreakdown = [];
    const entry = stats.handBreakdown.find(e => e.handType === handType);
    if (entry) {
      entry.called++;
    } else {
      stats.handBreakdown.push({ handType, called: 1, existed: 0 });
    }
  }

  /** Record that the called hand actually existed for a player's hand type breakdown. */
  private trackHandExisted(playerId: PlayerId, handType: number): void {
    const stats = this.gameStats.playerStats[playerId];
    if (!stats) return;
    if (!stats.handBreakdown) stats.handBreakdown = [];
    const entry = stats.handBreakdown.find(e => e.handType === handType);
    if (entry) {
      entry.existed++;
    } else {
      // Edge case: hand existed but wasn't tracked as called (shouldn't happen normally)
      stats.handBreakdown.push({ handType, called: 0, existed: 1 });
    }
  }

  /** Serialize the engine to a JSON-safe snapshot for persistence. */
  serialize(): GameEngineSnapshot {
    return {
      players: this.players.map(p => ({ ...p, cards: [...p.cards] })),
      settings: { ...this.settings },
      roundNumber: this.roundNumber,
      roundPhase: this.roundPhase,
      currentPlayerIndex: this.currentPlayerIndex,
      currentHand: this.currentHand ? { ...this.currentHand } : null,
      lastCallerId: this.lastCallerId,
      turnHistory: this.turnHistory.map(t => ({ ...t })),
      startingPlayerIndex: this.startingPlayerIndex,
      startingPlayerId: this._startingPlayerId,
      respondedPlayers: [...this.respondedPlayers],
      lastChanceUsed: this.lastChanceUsed,
      gameStats: JSON.parse(JSON.stringify(this.gameStats)),
      roundSnapshots: JSON.parse(JSON.stringify(this._roundSnapshots)),
      roundStartCards: this._roundStartCards.map(pc => ({ ...pc, cards: [...pc.cards] })),
    };
  }

  /** Restore a GameEngine from a serialized snapshot.
   *  Validates state integrity to prevent corrupted game state from crashing
   *  the server (e.g. out-of-bounds indices, missing players). */
  static restore(snapshot: GameEngineSnapshot): GameEngine {
    // Validate players array
    if (!Array.isArray(snapshot.players) || snapshot.players.length === 0) {
      throw new Error('Invalid snapshot: players array is empty or missing');
    }

    const activePlayers = snapshot.players.filter(p => !p.isEliminated);

    // Validate indices are in bounds
    if (activePlayers.length > 0) {
      if (snapshot.currentPlayerIndex < 0 || snapshot.currentPlayerIndex >= activePlayers.length) {
        throw new Error(
          `Invalid snapshot: currentPlayerIndex ${snapshot.currentPlayerIndex} out of bounds (${activePlayers.length} active players)`
        );
      }
      if (snapshot.startingPlayerIndex < 0 || snapshot.startingPlayerIndex >= activePlayers.length) {
        throw new Error(
          `Invalid snapshot: startingPlayerIndex ${snapshot.startingPlayerIndex} out of bounds (${activePlayers.length} active players)`
        );
      }
    }

    // Validate lastCallerId refers to a real player (if set)
    if (snapshot.lastCallerId !== null) {
      const callerExists = snapshot.players.some(p => p.id === snapshot.lastCallerId);
      if (!callerExists) {
        throw new Error(`Invalid snapshot: lastCallerId "${snapshot.lastCallerId}" not found in players`);
      }
    }

    // Validate respondedPlayers are all real player IDs
    const playerIds = new Set(snapshot.players.map(p => p.id));
    for (const id of snapshot.respondedPlayers) {
      if (!playerIds.has(id)) {
        throw new Error(`Invalid snapshot: respondedPlayer "${id}" not found in players`);
      }
    }

    // Validate roundPhase is a known value
    const validPhases = Object.values(RoundPhase);
    if (!validPhases.includes(snapshot.roundPhase)) {
      throw new Error(`Invalid snapshot: unknown roundPhase "${snapshot.roundPhase}"`);
    }

    const engine = new GameEngine(
      snapshot.players.map(p => ({ ...p, cards: [...p.cards] })),
      snapshot.settings,
    );
    engine.roundNumber = snapshot.roundNumber;
    engine.roundPhase = snapshot.roundPhase;
    engine.currentPlayerIndex = snapshot.currentPlayerIndex;
    engine.currentHand = snapshot.currentHand;
    engine.lastCallerId = snapshot.lastCallerId;
    engine.turnHistory = snapshot.turnHistory.map(t => ({ ...t }));
    engine.startingPlayerIndex = snapshot.startingPlayerIndex;
    engine._startingPlayerId = snapshot.startingPlayerId
      ?? engine.getActivePlayers()[snapshot.startingPlayerIndex]?.id
      ?? '';
    engine.respondedPlayers = new Set(snapshot.respondedPlayers);
    engine.lastChanceUsed = snapshot.lastChanceUsed;
    engine.gameStats = JSON.parse(JSON.stringify(snapshot.gameStats));
    if (snapshot.roundSnapshots) {
      engine._roundSnapshots = JSON.parse(JSON.stringify(snapshot.roundSnapshots));
    }
    if (snapshot.roundStartCards) {
      engine._roundStartCards = snapshot.roundStartCards.map(pc => ({ ...pc, cards: [...pc.cards] }));
    }
    return engine;
  }
}

function toPublicPlayer(p: ServerPlayer): Player {
  return {
    id: p.id,
    name: p.name,
    cardCount: p.cardCount,
    isConnected: p.isConnected,
    isEliminated: p.isEliminated,
    isHost: p.isHost,
    isBot: p.isBot,
    userId: p.userId,
    username: p.username,
    avatar: p.avatar,
    photoUrl: p.photoUrl,
    avatarBgColor: p.avatarBgColor,
  };
}
