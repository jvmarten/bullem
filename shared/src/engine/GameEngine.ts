import { STARTING_CARDS, MAX_CARDS, DEFAULT_GAME_SETTINGS, DECK_SIZE } from '../constants.js';
import { isHigherHand } from '../hands.js';
import {
  GamePhase, RoundPhase, TurnAction,
} from '../types.js';
import type {
  Card, HandCall, OwnedCard, PlayerId, ServerPlayer, ClientGameState, Player, TurnEntry, RoundResult,
  GameSettings, GameStats, PlayerGameStats, SpectatorPlayerCards,
} from '../types.js';
import { Deck } from './Deck.js';
import { HandChecker } from './HandChecker.js';

export type TurnResult =
  | { type: 'continue' }
  | { type: 'last_chance'; playerId: PlayerId }
  | { type: 'resolve'; result: RoundResult }
  | { type: 'game_over'; winnerId: PlayerId; finalRoundResult?: RoundResult }
  | { type: 'error'; message: string };

export class GameEngine {
  private deck = new Deck();
  private players: ServerPlayer[];
  private settings: GameSettings;
  private roundNumber = 0;
  private roundPhase = RoundPhase.CALLING;
  private currentPlayerIndex = 0;
  private currentHand: HandCall | null = null;
  private lastCallerId: PlayerId | null = null;
  private turnHistory: TurnEntry[] = [];
  private startingPlayerIndex = 0;
  private respondedPlayers = new Set<PlayerId>();
  private lastRoundResult: RoundResult | null = null;
  private lastChanceUsed = false;
  private gameStats: GameStats;
  private _turnDeadline: number | null = null;

  constructor(players: ServerPlayer[], settings: GameSettings = DEFAULT_GAME_SETTINGS) {
    this.players = players;
    this.settings = { ...settings };
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
      };
    }
    this.gameStats = { totalRounds: 0, playerStats };
  }

  get turnTimer(): number {
    return this.settings.turnTimer ?? 0;
  }

  setTurnDeadline(deadline: number | null): void {
    this._turnDeadline = deadline;
  }

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
      const needed = p.cardCount || STARTING_CARDS;
      const available = Math.min(needed, this.deck.remaining);
      p.cards = this.deck.deal(available);
    }

    // Starting player rotates each round
    const active = this.getActivePlayers();
    this.startingPlayerIndex = (this.roundNumber - 1) % active.length;
    this.currentPlayerIndex = this.startingPlayerIndex;
  }

  get gameOver(): boolean {
    return this.getActivePlayers().length <= 1;
  }

  get winnerId(): PlayerId | null {
    const active = this.getActivePlayers();
    return active.length === 1 ? active[0].id : null;
  }

  startNextRound(): { type: 'new_round' } | { type: 'game_over'; winnerId: PlayerId } {
    const active = this.getActivePlayers();
    if (active.length <= 1) {
      return { type: 'game_over', winnerId: active[0]?.id ?? '' };
    }

    // Rotate starting player clockwise, skipping eliminated players
    const prevStarterId = active[this.startingPlayerIndex % active.length]?.id;
    const prevStarterGlobalIndex = this.players.findIndex(p => p.id === prevStarterId);
    let nextGlobalIndex = (prevStarterGlobalIndex + 1) % this.players.length;
    while (this.players[nextGlobalIndex].isEliminated) {
      nextGlobalIndex = (nextGlobalIndex + 1) % this.players.length;
    }
    const nextStarterId = this.players[nextGlobalIndex].id;
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
      const available = Math.min(p.cardCount, this.deck.remaining);
      p.cards = this.deck.deal(available);
    }

    this.startingPlayerIndex = nextStarterActiveIndex;
    this.currentPlayerIndex = this.startingPlayerIndex;

    return { type: 'new_round' };
  }

  get currentPlayerId(): PlayerId {
    return this.getActivePlayers()[this.currentPlayerIndex]?.id ?? '';
  }

  handleCall(playerId: PlayerId, hand: HandCall): TurnResult {
    const error = this.validateTurn(playerId);
    if (error) return { type: 'error', message: error };

    if (this.currentHand && !isHigherHand(hand, this.currentHand)) {
      return { type: 'error', message: 'Hand must be higher than current call' };
    }

    this.currentHand = hand;
    this.lastCallerId = playerId;
    this.addTurnEntry(playerId, TurnAction.CALL, hand);
    this.gameStats.playerStats[playerId].callsMade++;

    // A raise resets the bull phase
    this.roundPhase = RoundPhase.CALLING;
    this.respondedPlayers.clear();
    this.respondedPlayers.add(playerId);
    this.advanceTurn();
    return { type: 'continue' };
  }

  handleBull(playerId: PlayerId): TurnResult {
    const error = this.validateTurn(playerId);
    if (error) return { type: 'error', message: error };
    if (!this.currentHand) return { type: 'error', message: 'No hand to call bull on' };

    this.addTurnEntry(playerId, TurnAction.BULL);
    this.respondedPlayers.add(playerId);
    this.gameStats.playerStats[playerId].bullsCalled++;

    if (this.roundPhase === RoundPhase.CALLING) {
      this.roundPhase = RoundPhase.BULL_PHASE;
    }

    // Check if all non-callers have responded
    if (this.allNonCallersResponded()) {
      // Check if everyone called bull (no one called true)
      const hasTrue = this.turnHistory.some(
        t => t.action === TurnAction.TRUE && this.isAfterLastCall(t)
      );
      if (!hasTrue) {
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

  handleTrue(playerId: PlayerId): TurnResult {
    const error = this.validateTurn(playerId);
    if (error) return { type: 'error', message: error };
    if (this.roundPhase !== RoundPhase.BULL_PHASE) {
      return { type: 'error', message: 'Can only call true during bull phase' };
    }

    this.addTurnEntry(playerId, TurnAction.TRUE);
    this.respondedPlayers.add(playerId);
    this.gameStats.playerStats[playerId].truesCalled++;

    if (this.allNonCallersResponded()) {
      return this.resolveRound();
    }

    this.advanceTurn();
    return { type: 'continue' };
  }

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
    this.addTurnEntry(playerId, TurnAction.CALL, hand);
    this.roundPhase = RoundPhase.BULL_PHASE;
    this.respondedPlayers.clear();
    this.respondedPlayers.add(playerId);
    this.advanceTurn();
    return { type: 'continue' };
  }

  handleLastChancePass(playerId: PlayerId): TurnResult {
    if (this.roundPhase !== RoundPhase.LAST_CHANCE) {
      return { type: 'error', message: 'Not in last chance phase' };
    }
    if (playerId !== this.lastCallerId) {
      return { type: 'error', message: 'Only the last caller can pass' };
    }
    return this.resolveRound();
  }

  getClientState(playerId: PlayerId): ClientGameState {
    const player = this.players.find(p => p.id === playerId);
    const isEliminated = player?.isEliminated ?? false;

    const state: ClientGameState = {
      gamePhase: GamePhase.PLAYING,
      roundPhase: this.roundPhase,
      roundNumber: this.roundNumber,
      maxCards: this.settings.maxCards,
      players: this.players.map(toPublicPlayer),
      myCards: player?.cards ?? [],
      currentPlayerId: this.currentPlayerId,
      currentHand: this.currentHand,
      lastCallerId: this.lastCallerId,
      turnHistory: [...this.turnHistory],
      startingPlayerId: this.getActivePlayers()[this.startingPlayerIndex]?.id ?? '',
      roundResult: this.lastRoundResult,
      turnDeadline: this._turnDeadline,
    };

    // Spectators (eliminated players) can see all active players' cards
    if (isEliminated) {
      state.spectatorCards = this.getActivePlayers().map(p => ({
        playerId: p.id,
        playerName: p.name,
        cards: [...p.cards],
      }));
    }

    return state;
  }

  getGameStats(): GameStats {
    return this.gameStats;
  }

  getActivePlayers(): ServerPlayer[] {
    return this.players.filter(p => !p.isEliminated);
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
      const hasTrue = this.turnHistory.some(
        t => t.action === TurnAction.TRUE && this.isAfterLastCall(t),
      );
      if (!hasTrue) {
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
    this.roundPhase = RoundPhase.RESOLVING;
    this.gameStats.totalRounds++;
    const allCards = this.getAllCards();
    const allCardsOwned = this.getAllCardsWithOwnership();
    const handExists = HandChecker.exists(allCards, this.currentHand!);
    const revealedCards = HandChecker.findAllRelevantCards(allCardsOwned, this.currentHand!);

    // Determine who was right and wrong
    const penalties: Record<PlayerId, number> = {};
    const penalizedPlayerIds: PlayerId[] = [];
    const eliminatedPlayerIds: PlayerId[] = [];

    const activePlayers = this.getActivePlayers();

    // Pre-check: if every active player would be penalized AND all would exceed
    // maxCards, skip penalties entirely so the game continues instead of ending
    // in a mass elimination (draw). This can happen when the last-chance raise
    // results in everyone being wrong simultaneously.
    const wouldBePenalized: PlayerId[] = [];
    for (const p of activePlayers) {
      const lastAction = this.getPlayerLastAction(p.id);
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
      activePlayers.every(p => (p.cardCount || STARTING_CARDS) + 1 > this.settings.maxCards);

    for (const p of activePlayers) {
      const lastAction = this.getPlayerLastAction(p.id);
      let incorrect = false;
      const stats = this.gameStats.playerStats[p.id];

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
        p.cardCount = (p.cardCount || STARTING_CARDS) + 1;
        if (p.cardCount > this.settings.maxCards) {
          p.isEliminated = true;
          eliminatedPlayerIds.push(p.id);
        }
      }

      // Track rounds survived (everyone still active survived this round)
      if (!p.isEliminated) {
        stats.roundsSurvived++;
      }

      penalties[p.id] = p.cardCount || STARTING_CARDS;
    }

    const result: RoundResult = {
      calledHand: this.currentHand!,
      callerId: this.lastCallerId!,
      handExists,
      revealedCards,
      penalties,
      penalizedPlayerIds,
      eliminatedPlayerIds,
      turnHistory: [...this.turnHistory],
    };
    this.lastRoundResult = result;

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
    let next = (this.currentPlayerIndex + 1) % active.length;
    // Skip the last caller (they don't respond to their own call)
    while (active[next]?.id === this.lastCallerId) {
      next = (next + 1) % active.length;
    }
    this.currentPlayerIndex = next;
  }

  private allNonCallersResponded(): boolean {
    const active = this.getActivePlayers();
    return active.every(p => p.id === this.lastCallerId || this.respondedPlayers.has(p.id));
  }

  private isAfterLastCall(entry: TurnEntry): boolean {
    const lastCallIndex = [...this.turnHistory].reverse().findIndex(t => t.action === TurnAction.CALL);
    if (lastCallIndex === -1) return false;
    const actualIndex = this.turnHistory.length - 1 - lastCallIndex;
    return this.turnHistory.indexOf(entry) > actualIndex;
  }

  private getPlayerLastAction(playerId: PlayerId): TurnAction | null {
    for (let i = this.turnHistory.length - 1; i >= 0; i--) {
      if (this.turnHistory[i].playerId === playerId) {
        return this.turnHistory[i].action;
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
  };
}
