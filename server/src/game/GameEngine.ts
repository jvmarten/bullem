import {
  GamePhase, RoundPhase, TurnAction, HandType,
  STARTING_CARDS, MAX_CARDS, isHigherHand,
} from '@bull-em/shared';
import type {
  Card, HandCall, PlayerId, ServerPlayer, ClientGameState, Player, TurnEntry, RoundResult,
} from '@bull-em/shared';
import { Deck } from './Deck.js';
import { HandChecker } from './HandChecker.js';

export type TurnResult =
  | { type: 'continue' }
  | { type: 'last_chance'; playerId: PlayerId }
  | { type: 'resolve'; result: RoundResult }
  | { type: 'game_over'; winnerId: PlayerId }
  | { type: 'error'; message: string };

export class GameEngine {
  private deck = new Deck();
  private players: ServerPlayer[];
  private roundNumber = 0;
  private roundPhase = RoundPhase.CALLING;
  private currentPlayerIndex = 0;
  private currentHand: HandCall | null = null;
  private lastCallerId: PlayerId | null = null;
  private turnHistory: TurnEntry[] = [];
  private startingPlayerIndex = 0;
  private respondedPlayers = new Set<PlayerId>();

  constructor(players: ServerPlayer[]) {
    this.players = players;
  }

  startRound(): void {
    this.roundNumber++;
    this.deck.reset();
    this.roundPhase = RoundPhase.CALLING;
    this.currentHand = null;
    this.lastCallerId = null;
    this.turnHistory = [];
    this.respondedPlayers.clear();

    // Deal cards
    for (const p of this.getActivePlayers()) {
      p.cards = this.deck.deal(p.cardCount || STARTING_CARDS);
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

    // Re-deal cards based on each player's current card count
    for (const p of this.getActivePlayers()) {
      p.cards = this.deck.deal(p.cardCount);
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
        // Last chance for original caller
        this.roundPhase = RoundPhase.LAST_CHANCE;
        this.currentPlayerIndex = this.getActivePlayerIndex(this.lastCallerId!);
        return { type: 'last_chance', playerId: this.lastCallerId! };
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
    return {
      gamePhase: GamePhase.PLAYING,
      roundPhase: this.roundPhase,
      roundNumber: this.roundNumber,
      players: this.players.map(toPublicPlayer),
      myCards: player?.cards ?? [],
      currentPlayerId: this.currentPlayerId,
      currentHand: this.currentHand,
      lastCallerId: this.lastCallerId,
      turnHistory: [...this.turnHistory],
      startingPlayerId: this.getActivePlayers()[this.startingPlayerIndex]?.id ?? '',
    };
  }

  getActivePlayers(): ServerPlayer[] {
    return this.players.filter(p => !p.isEliminated);
  }

  private resolveRound(): TurnResult {
    this.roundPhase = RoundPhase.RESOLVING;
    const allCards = this.getAllCards();
    const handExists = HandChecker.exists(allCards, this.currentHand!);
    const revealedCards = HandChecker.findMatchingCards(allCards, this.currentHand!) ?? [];

    // Determine who was right and wrong
    const penalties: Record<PlayerId, number> = {};
    const eliminatedPlayerIds: PlayerId[] = [];

    for (const p of this.getActivePlayers()) {
      const lastAction = this.getPlayerLastAction(p.id);
      let incorrect = false;

      if (p.id === this.lastCallerId) {
        // The caller is wrong if the hand doesn't exist
        incorrect = !handExists;
      } else if (lastAction === TurnAction.BULL) {
        // Bull callers are wrong if the hand exists
        incorrect = handExists;
      } else if (lastAction === TurnAction.TRUE) {
        // True callers are wrong if the hand doesn't exist
        incorrect = !handExists;
      }

      if (incorrect) {
        p.cardCount = (p.cardCount || STARTING_CARDS) + 1;
        if (p.cardCount > MAX_CARDS) {
          p.isEliminated = true;
          eliminatedPlayerIds.push(p.id);
        }
      }

      penalties[p.id] = p.cardCount || STARTING_CARDS;
    }

    const result: RoundResult = {
      calledHand: this.currentHand!,
      callerId: this.lastCallerId!,
      handExists,
      revealedCards,
      penalties,
      eliminatedPlayerIds,
    };

    // Check for game over
    const remaining = this.getActivePlayers();
    if (remaining.length <= 1) {
      return { type: 'game_over', winnerId: remaining[0]?.id ?? '' };
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
  };
}
