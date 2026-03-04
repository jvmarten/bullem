import { HandType, RoundPhase, BotDifficulty, TurnAction } from '../types.js';
import { RANK_VALUES, ALL_RANKS, ALL_SUITS, SUIT_ORDER } from '../constants.js';
import { isHigherHand } from '../hands.js';
import { HandChecker } from './HandChecker.js';
import type { Card, HandCall, Rank, Suit, ClientGameState } from '../types.js';

export type BotAction =
  | { action: 'call'; hand: HandCall }
  | { action: 'bull' }
  | { action: 'true' }
  | { action: 'lastChanceRaise'; hand: HandCall }
  | { action: 'lastChancePass' };

export class BotPlayer {
  /**
   * Decide what action a bot should take given the current game state, its cards, and difficulty.
   * For IMPOSSIBLE difficulty, allCards should contain the bot's own cards + human players' cards.
   */
  static decideAction(
    state: ClientGameState,
    botId: string,
    botCards: Card[],
    difficulty: BotDifficulty = BotDifficulty.EASY,
    allCards?: Card[],
  ): BotAction {
    if (difficulty === BotDifficulty.IMPOSSIBLE && allCards) {
      return this.decideImpossible(state, botId, botCards, allCards);
    }
    if (difficulty === BotDifficulty.HARD) {
      return this.decideHard(state, botId, botCards);
    }
    return this.decideEasy(state, botId, botCards);
  }

  // ─── EASY MODE ───────────────────────────────────────────────────────

  private static decideEasy(state: ClientGameState, botId: string, botCards: Card[]): BotAction {
    const { roundPhase, currentHand, lastCallerId } = state;

    // LAST_CHANCE phase — everyone called bull on our hand.
    // If we pass, the hand is checked: if it exists, the bullers lose.
    // If we raise, the cycle restarts with the new (higher) hand.
    if (roundPhase === RoundPhase.LAST_CHANCE && lastCallerId === botId) {
      if (currentHand) {
        const totalCards = this.getTotalCards(state);
        const plausibility = this.estimatePlausibilitySimple(currentHand, botCards, totalCards);
        // If the hand likely exists, pass — the bullers will be penalized
        if (plausibility > 0.45) {
          return { action: 'lastChancePass' };
        }
        // Hand probably doesn't exist — try to raise to escape
        const higher = this.findHandHigherThanSimple(botCards, currentHand);
        if (higher) {
          return { action: 'lastChanceRaise', hand: higher };
        }
      }
      return { action: 'lastChancePass' };
    }

    // Opening call — no current hand
    if (roundPhase === RoundPhase.CALLING && !currentHand) {
      const hand = this.findBestHandInCards(botCards);
      if (hand && Math.random() < 0.9) {
        return { action: 'call', hand };
      }
      // 10% bluff
      return { action: 'call', hand: this.makeBluffHandEasy(null) };
    }

    // Raise or bull in calling phase
    if (roundPhase === RoundPhase.CALLING && currentHand) {
      const higher = this.findHandHigherThanSimple(botCards, currentHand);
      if (higher && Math.random() < 0.6) {
        return { action: 'call', hand: higher };
      }
      // 10% bluff chance
      if (Math.random() < 0.1) {
        const bluff = this.makeBluffHandEasy(currentHand);
        if (bluff && isHigherHand(bluff, currentHand)) {
          return { action: 'call', hand: bluff };
        }
      }
      return { action: 'bull' };
    }

    // Bull phase — simple coin flip weighted by rough heuristic
    if (roundPhase === RoundPhase.BULL_PHASE && currentHand) {
      const totalCards = this.getTotalCards(state);
      const plausibility = this.estimatePlausibilitySimple(currentHand, botCards, totalCards);

      if (plausibility > 0.5) {
        return Math.random() < 0.55 ? { action: 'true' } : { action: 'bull' };
      }
      return Math.random() < 0.65 ? { action: 'bull' } : { action: 'true' };
    }

    // Fallback
    if (currentHand) return { action: 'bull' };
    return { action: 'call', hand: { type: HandType.HIGH_CARD, rank: 'A' } };
  }

  // ─── IMPOSSIBLE MODE (Perfect Information) ─────────────────────────

  /**
   * Impossible: bot sees ALL cards and makes optimal decisions.
   * Knows with certainty whether any hand exists across all players' cards.
   */
  private static decideImpossible(
    state: ClientGameState,
    botId: string,
    botCards: Card[],
    allCards: Card[],
  ): BotAction {
    const { roundPhase, currentHand, lastCallerId } = state;

    // LAST_CHANCE phase — perfect knowledge: pass if hand exists (bullers lose), raise otherwise
    if (roundPhase === RoundPhase.LAST_CHANCE && lastCallerId === botId) {
      if (currentHand) {
        const handExists = HandChecker.exists(allCards, currentHand);
        if (handExists) {
          // Hand exists — pass and let the bullers be penalized
          return { action: 'lastChancePass' };
        }
        // Hand doesn't exist — must raise to avoid penalty
        const raise = this.findHighestExistingHand(allCards, currentHand);
        if (raise) return { action: 'lastChanceRaise', hand: raise };
      }
      return { action: 'lastChancePass' };
    }

    // Opening call — call a hand that exists but don't reveal everything
    if (roundPhase === RoundPhase.CALLING && !currentHand) {
      return this.impossibleOpening(botCards, allCards);
    }

    // Calling phase — we know if the hand exists
    if (roundPhase === RoundPhase.CALLING && currentHand) {
      return this.impossibleCallingPhase(state, botId, botCards, allCards, currentHand);
    }

    // Bull phase — perfect knowledge
    if (roundPhase === RoundPhase.BULL_PHASE && currentHand) {
      return this.impossibleBullPhase(botCards, allCards, currentHand);
    }

    // Fallback
    if (currentHand) return { action: 'bull' };
    return { action: 'call', hand: { type: HandType.HIGH_CARD, rank: '2' } };
  }

  /**
   * Impossible opening: call a real hand — pick strategically.
   * Start with a low-to-mid truthful hand to leave room for raises.
   */
  private static impossibleOpening(botCards: Card[], allCards: Card[]): BotAction {
    // Find all hands that actually exist, sorted by strength
    const existingHands: HandCall[] = [];

    // Check high cards (all exist by definition if any card has that rank)
    for (const c of botCards) {
      existingHands.push({ type: HandType.HIGH_CARD, rank: c.rank });
    }

    // Check pairs
    const rankCounts = this.getRankCounts(allCards);
    for (const [rank, count] of rankCounts) {
      if (count >= 2) existingHands.push({ type: HandType.PAIR, rank });
    }

    // Check two pairs
    const pairRanks = [...rankCounts.entries()].filter(([, c]) => c >= 2).map(([r]) => r);
    if (pairRanks.length >= 2) {
      pairRanks.sort((a, b) => RANK_VALUES[a] - RANK_VALUES[b]);
      // Just add a few two-pair combos (low ones for opening)
      for (let i = 0; i < Math.min(pairRanks.length, 3); i++) {
        for (let j = i + 1; j < Math.min(pairRanks.length, 4); j++) {
          const [hi, lo] = RANK_VALUES[pairRanks[j]] > RANK_VALUES[pairRanks[i]]
            ? [pairRanks[j], pairRanks[i]]
            : [pairRanks[i], pairRanks[j]];
          existingHands.push({ type: HandType.TWO_PAIR, highRank: hi, lowRank: lo });
        }
      }
    }

    existingHands.sort((a, b) => {
      if (a.type !== b.type) return a.type - b.type;
      return this.getHandPrimaryRank(a) - this.getHandPrimaryRank(b);
    });

    if (existingHands.length === 0) {
      return { action: 'call', hand: { type: HandType.HIGH_CARD, rank: botCards[0]?.rank ?? '2' } };
    }

    // Pick from the lower third of existing hands — strategic, leaves room to raise
    const maxIdx = Math.max(1, Math.floor(existingHands.length * 0.4));
    const idx = Math.floor(Math.random() * maxIdx);
    return { action: 'call', hand: existingHands[idx] };
  }

  /**
   * Impossible calling phase: knows whether the current hand exists.
   * If it exists and we can raise with a real hand, do so.
   * If it doesn't exist, call bull (guaranteed correct).
   * Sometimes bluff-raises with a real hand to be deceptive.
   */
  private static impossibleCallingPhase(
    state: ClientGameState,
    botId: string,
    botCards: Card[],
    allCards: Card[],
    currentHand: HandCall,
  ): BotAction {
    const handExists = HandChecker.exists(allCards, currentHand);

    if (!handExists) {
      // Hand doesn't exist — bull is guaranteed correct
      // But occasionally raise with a real hand to be unpredictable (10%)
      if (Math.random() < 0.10) {
        const raise = this.findLowestExistingHand(allCards, currentHand);
        if (raise) return { action: 'call', hand: raise };
      }
      return { action: 'bull' };
    }

    // Hand exists — raising is safer than bull
    const raise = this.findLowestExistingHand(allCards, currentHand);
    if (raise) {
      return { action: 'call', hand: raise };
    }

    // No higher hand exists — call bull anyway (risky but only option)
    // This happens when the current hand is near the top of what's possible
    return { action: 'bull' };
  }

  /**
   * Impossible bull phase: perfect knowledge of whether the hand exists.
   * Sometimes raises with a known-real hand to disrupt opponents.
   */
  private static impossibleBullPhase(
    botCards: Card[],
    allCards: Card[],
    currentHand: HandCall,
  ): BotAction {
    const handExists = HandChecker.exists(allCards, currentHand);

    // Consider raising even in bull phase
    if (Math.random() < 0.25) {
      const raise = this.findLowestExistingHand(allCards, currentHand);
      if (raise) return { action: 'call', hand: raise };
    }

    return handExists ? { action: 'true' } : { action: 'bull' };
  }

  /**
   * Find the lowest hand higher than currentHand that actually exists in allCards.
   */
  private static findLowestExistingHand(allCards: Card[], currentHand: HandCall): HandCall | null {
    const candidates = this.generateAllCandidateHands(allCards);
    const valid = candidates.filter(h => isHigherHand(h, currentHand) && HandChecker.exists(allCards, h));
    if (valid.length === 0) return null;

    valid.sort((a, b) => {
      if (a.type !== b.type) return a.type - b.type;
      return this.getHandPrimaryRank(a) - this.getHandPrimaryRank(b);
    });

    // Pick from the lower few options to be strategic (not always the absolute minimum)
    const pick = Math.min(Math.floor(Math.random() * 3), valid.length - 1);
    return valid[pick];
  }

  /**
   * Find the highest hand higher than currentHand that actually exists.
   */
  private static findHighestExistingHand(allCards: Card[], currentHand: HandCall): HandCall | null {
    const candidates = this.generateAllCandidateHands(allCards);
    const valid = candidates.filter(h => isHigherHand(h, currentHand) && HandChecker.exists(allCards, h));
    if (valid.length === 0) return null;

    valid.sort((a, b) => {
      if (a.type !== b.type) return b.type - a.type;
      return this.getHandPrimaryRank(b) - this.getHandPrimaryRank(a);
    });

    return valid[0];
  }

  /**
   * Generate candidate hands across all types for perfect-information search.
   */
  private static generateAllCandidateHands(allCards: Card[]): HandCall[] {
    const candidates: HandCall[] = [];
    const rankCounts = this.getRankCounts(allCards);
    const suitCounts = this.getSuitCounts(allCards);

    // High cards
    for (const rank of ALL_RANKS) {
      candidates.push({ type: HandType.HIGH_CARD, rank });
    }

    // Pairs
    for (const rank of ALL_RANKS) {
      candidates.push({ type: HandType.PAIR, rank });
    }

    // Two pairs
    for (let i = 0; i < ALL_RANKS.length; i++) {
      for (let j = i + 1; j < ALL_RANKS.length; j++) {
        const [hi, lo] = RANK_VALUES[ALL_RANKS[j]] > RANK_VALUES[ALL_RANKS[i]]
          ? [ALL_RANKS[j], ALL_RANKS[i]]
          : [ALL_RANKS[i], ALL_RANKS[j]];
        candidates.push({ type: HandType.TWO_PAIR, highRank: hi, lowRank: lo });
      }
    }

    // Flushes
    for (const suit of ALL_SUITS) {
      candidates.push({ type: HandType.FLUSH, suit });
    }

    // Three of a kind
    for (const rank of ALL_RANKS) {
      candidates.push({ type: HandType.THREE_OF_A_KIND, rank });
    }

    // Straights
    const straightHighs: Rank[] = ['5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    for (const highRank of straightHighs) {
      candidates.push({ type: HandType.STRAIGHT, highRank });
    }

    // Full houses
    for (const threeRank of ALL_RANKS) {
      for (const twoRank of ALL_RANKS) {
        if (threeRank !== twoRank) {
          candidates.push({ type: HandType.FULL_HOUSE, threeRank, twoRank });
        }
      }
    }

    // Four of a kind
    for (const rank of ALL_RANKS) {
      candidates.push({ type: HandType.FOUR_OF_A_KIND, rank });
    }

    // Straight flushes
    for (const suit of ALL_SUITS) {
      for (const highRank of straightHighs) {
        candidates.push({ type: HandType.STRAIGHT_FLUSH, suit, highRank });
      }
    }

    // Royal flushes
    for (const suit of ALL_SUITS) {
      candidates.push({ type: HandType.ROYAL_FLUSH, suit });
    }

    return candidates;
  }

  // ─── HARD MODE (Probability-Driven + GTO Bluffing) ──────────────────

  private static decideHard(state: ClientGameState, botId: string, botCards: Card[]): BotAction {
    const { roundPhase, currentHand, lastCallerId } = state;
    const totalCards = this.getTotalCards(state);
    const desperate = botCards.length >= 4;
    const numOpponents = state.players.filter(p => !p.isEliminated && p.id !== botId).length;

    // LAST_CHANCE phase — everyone called bull on our hand.
    // If we pass, the hand is checked: if it exists, the bullers are penalized (we win).
    // If we raise, the cycle restarts with the new (higher) hand.
    if (roundPhase === RoundPhase.LAST_CHANCE && lastCallerId === botId) {
      if (currentHand) {
        const plausibility = this.estimatePlausibilityHard(currentHand, botCards, totalCards);
        const truthBoost = this.getTruthfulnessBoost(currentHand);
        const adjustedP = Math.min(1, plausibility + truthBoost);

        // If the hand very likely exists, pass — the bullers will be penalized
        if (adjustedP > 0.55) {
          return { action: 'lastChancePass' };
        }

        // Moderate plausibility — still favor passing but occasionally raise
        if (adjustedP > 0.35 && Math.random() < 0.6) {
          return { action: 'lastChancePass' };
        }

        // Hand probably doesn't exist — try to raise to escape the penalty
        const higher = this.findHandHigherThanFull(botCards, currentHand, totalCards);
        if (higher) return { action: 'lastChanceRaise', hand: higher };
        const bluff = this.findBestPlausibleRaise(currentHand, botCards, totalCards);
        if (bluff) return { action: 'lastChanceRaise', hand: bluff };
        // Last resort bluff — only if plausibility is very low (passing almost guarantees loss)
        if (adjustedP < 0.2) {
          const desperateBluff = this.makeBluffHandHard(currentHand, totalCards);
          if (isHigherHand(desperateBluff, currentHand)) {
            return { action: 'lastChanceRaise', hand: desperateBluff };
          }
        }
      }
      return { action: 'lastChancePass' };
    }

    // Opening call — start low and truthful
    if (roundPhase === RoundPhase.CALLING && !currentHand) {
      return this.handleHardOpening(botCards, totalCards);
    }

    // Calling phase — EV-driven raise vs bull with GTO bluff frequency
    if (roundPhase === RoundPhase.CALLING && currentHand) {
      return this.handleHardCallingPhase(currentHand, botCards, totalCards, desperate, numOpponents, state.turnHistory, botId);
    }

    // Bull phase — probability threshold with position-aware adjustment
    if (roundPhase === RoundPhase.BULL_PHASE && currentHand) {
      return this.handleHardBullPhase(currentHand, botCards, totalCards, desperate, state.turnHistory, botId);
    }

    // Fallback
    if (currentHand) return { action: 'bull' };
    return { action: 'call', hand: { type: HandType.HIGH_CARD, rank: '2' } };
  }

  /**
   * Opening: pick from truthful hands with controlled randomization.
   *
   * Instead of always picking the lowest truthful hand (deterministic and exploitable),
   * we vary our opening to be unpredictable:
   * - 70% pick a random truthful hand (weighted toward lower ones)
   * - 15% pick a mid-range bluff (harder to challenge, keeps opponents guessing)
   * - 15% pick the lowest truthful hand (classic conservative play)
   */
  private static handleHardOpening(botCards: Card[], totalCards: number): BotAction {
    const candidates: HandCall[] = [];
    const rankCounts = this.getRankCounts(botCards);

    // All high cards we have
    for (const c of botCards) {
      candidates.push({ type: HandType.HIGH_CARD, rank: c.rank });
    }

    // Pairs we have
    for (const [rank, count] of rankCounts) {
      if (count >= 2) candidates.push({ type: HandType.PAIR, rank });
    }

    // Sort by hand strength (lowest first)
    candidates.sort((a, b) => {
      if (a.type !== b.type) return a.type - b.type;
      return this.getHandPrimaryRank(a) - this.getHandPrimaryRank(b);
    });

    if (candidates.length === 0) {
      return { action: 'call', hand: this.makeBluffHandHard(null, totalCards) };
    }

    const roll = Math.random();

    // 15% strategic bluff opening — pick a plausible hand we don't hold
    if (roll < 0.15) {
      const bluff = this.makeBluffHandHard(null, totalCards);
      return { action: 'call', hand: bluff };
    }

    // 15% conservative — lowest truthful hand
    if (roll < 0.30) {
      return { action: 'call', hand: candidates[0] };
    }

    // 70% weighted random from truthful hands — bias toward lower half
    // Use triangular distribution favoring lower index
    const idx = Math.min(
      Math.floor(Math.random() * Math.random() * candidates.length),
      candidates.length - 1,
    );
    return { action: 'call', hand: candidates[idx] };
  }

  /**
   * Calling phase: GTO-inspired decision framework.
   *
   * Uses Nash equilibrium bluff frequency: bluff at rate 1/(N+1) where N = opponents.
   * This makes opponents indifferent between calling bull and true on our raises.
   *
   * Decision tree:
   * 1. If P(hand exists) is very low → bull (profitable call)
   * 2. If we have a legitimate raise → value raise
   * 3. If P is high + GTO says bluff → bluff raise (semi-bluff preferred)
   * 4. Otherwise → bull
   */
  private static handleHardCallingPhase(
    currentHand: HandCall,
    botCards: Card[],
    totalCards: number,
    desperate: boolean,
    numOpponents: number,
    turnHistory: { playerId: string; action: TurnAction }[],
    botId: string,
  ): BotAction {
    const pRaw = this.estimatePlausibilityHard(currentHand, botCards, totalCards);
    const higher = this.findHandHigherThanFull(botCards, currentHand, totalCards);

    // Truthfulness prior: callers usually hold cards related to their call.
    // Boost plausibility to account for this information asymmetry.
    const truthBoost = this.getTruthfulnessBoost(currentHand);

    // Factor in position: more raises → more likely someone is bluffing
    const positionAdj = this.getPositionBluffAdjustment(turnHistory, botId);
    const adjustedP = Math.max(0, Math.min(1, pRaw + truthBoost - positionAdj));

    // Confident bull: hand is very unlikely to exist
    if (adjustedP < 0.20 && !desperate) {
      return { action: 'bull' };
    }

    // We have a legitimate higher hand — value raise
    if (higher) {
      // Even with a legitimate hand, sometimes call bull on very implausible hands
      if (adjustedP < 0.12 && Math.random() < 0.4) {
        return { action: 'bull' };
      }
      return { action: 'call', hand: higher };
    }

    // No legitimate hand — decide whether to bluff raise or call bull.
    const bluffFreq = this.getOptimalBluffFrequency(numOpponents, desperate);

    if (adjustedP > 0.45) {
      // Hand is probably real — bluff raise to avoid a bull penalty
      if (Math.random() < bluffFreq * 1.3) {
        const bluff = this.findBestPlausibleRaise(currentHand, botCards, totalCards);
        if (bluff) return { action: 'call', hand: bluff };
      }
      // Very likely real — try harder to find any viable raise
      if (adjustedP > 0.55) {
        const bluff = this.findBestPlausibleRaise(currentHand, botCards, totalCards);
        if (bluff) return { action: 'call', hand: bluff };
      }
      return { action: 'bull' };
    }

    // adjustedP 0.20-0.45 — uncertain zone
    if (desperate) {
      // When desperate, bluff more aggressively to avoid elimination
      if (Math.random() < bluffFreq * 2.0) {
        const bluff = this.findBestPlausibleRaise(currentHand, botCards, totalCards);
        if (bluff) return { action: 'call', hand: bluff };
      }
    } else if (Math.random() < bluffFreq * 0.7) {
      // Even when not desperate, occasionally bluff in uncertain zone
      const bluff = this.findBestPlausibleRaise(currentHand, botCards, totalCards);
      if (bluff) return { action: 'call', hand: bluff };
    }

    // Default: call bull
    return { action: 'bull' };
  }

  /**
   * Bull phase: EV decision with position-aware bluff detection.
   *
   * Base model: call true when P(exists) > 0.5, bull when < 0.5.
   * Position adjustment: more raises in the round → caller more likely bluffing → lower effective P.
   * Escalation adjustment: big jumps in hand type → more suspicious.
   */
  private static handleHardBullPhase(
    currentHand: HandCall,
    botCards: Card[],
    totalCards: number,
    desperate: boolean,
    turnHistory: { playerId: string; action: TurnAction }[],
    botId: string,
  ): BotAction {
    const pRaw = this.estimatePlausibilityHard(currentHand, botCards, totalCards);

    // Truthfulness prior: callers usually hold cards related to their call
    const truthBoost = this.getTruthfulnessBoost(currentHand);

    // Factor in position and escalation patterns
    const positionAdj = this.getPositionBluffAdjustment(turnHistory, botId);
    const adjustedP = Math.max(0, Math.min(1, pRaw + truthBoost - positionAdj));

    // Consider raising in bull phase — strong strategic move that disrupts opponents
    const higher = this.findHandHigherThanFull(botCards, currentHand, totalCards);
    if (higher) {
      // Raise more when desperate (need to avoid a bull penalty) or when hand is suspicious
      const raiseChance = desperate ? 0.45 : 0.30;
      if (Math.random() < raiseChance) {
        return { action: 'call', hand: higher };
      }
    }

    // When desperate (4+ cards), shift threshold slightly toward true
    // to avoid the penalty that would eliminate us
    const threshold = desperate ? 0.35 : 0.48;
    const noise = 0.05;

    if (adjustedP > threshold + noise) {
      return { action: 'true' };
    }
    if (adjustedP < threshold - noise) {
      return { action: 'bull' };
    }
    // Within noise band — randomize
    return Math.random() < adjustedP ? { action: 'true' } : { action: 'bull' };
  }

  /**
   * Find the best plausible raise hand — GTO-inspired bluff selection.
   *
   * Principles:
   * 1. Semi-bluffs preferred: use ranks we partially hold (1 of needed 2, etc.)
   *    These have backup equity — might actually exist across all cards.
   * 2. Minimal escalation: raise as little as possible above current hand.
   *    Small raises are harder to distinguish from value raises.
   * 3. Plausibility gating: only bluff hands with P >= threshold.
   *
   * Returns the best bluff hand (balancing plausibility + minimal escalation).
   */
  private static findBestPlausibleRaise(
    currentHand: HandCall,
    ownCards: Card[],
    totalCards: number,
  ): HandCall | null {
    const candidates: { hand: HandCall; semiBluff: boolean }[] = [];
    const rankCounts = this.getRankCounts(ownCards);

    // Generate candidates across hand types that are higher than current

    // Pair bluffs — prefer semi-bluffs (ranks we have exactly 1 of)
    if (currentHand.type <= HandType.PAIR) {
      for (const [rank, count] of rankCounts) {
        const hand: HandCall = { type: HandType.PAIR, rank };
        if (isHigherHand(hand, currentHand)) {
          candidates.push({ hand, semiBluff: count === 1 }); // count=1 is a semi-bluff
        }
      }
    }

    // Two pair bluffs — semi-bluff if we hold at least one of each rank
    if (currentHand.type <= HandType.TWO_PAIR && totalCards >= 6) {
      const heldRanks = [...rankCounts.keys()];
      for (let i = 0; i < heldRanks.length; i++) {
        for (let j = i + 1; j < heldRanks.length; j++) {
          const [a, b] = RANK_VALUES[heldRanks[i]] > RANK_VALUES[heldRanks[j]]
            ? [heldRanks[i], heldRanks[j]]
            : [heldRanks[j], heldRanks[i]];
          const hand: HandCall = { type: HandType.TWO_PAIR, highRank: a, lowRank: b };
          if (isHigherHand(hand, currentHand)) {
            candidates.push({ hand, semiBluff: true }); // Always semi since we hold 1+ of each
          }
        }
      }
    }

    // Flush bluffs — semi-bluff if we hold 2+ of the suit
    if (totalCards >= 8 && currentHand.type <= HandType.FLUSH) {
      const suitCounts = this.getSuitCounts(ownCards);
      for (const [suit, count] of suitCounts) {
        const hand: HandCall = { type: HandType.FLUSH, suit };
        if (isHigherHand(hand, currentHand)) {
          candidates.push({ hand, semiBluff: count >= 2 });
        }
      }
    }

    // Three of a kind bluffs — semi-bluff if we hold 1-2 of the rank
    if (currentHand.type <= HandType.THREE_OF_A_KIND && totalCards >= 6) {
      for (const [rank, count] of rankCounts) {
        const hand: HandCall = { type: HandType.THREE_OF_A_KIND, rank };
        if (isHigherHand(hand, currentHand)) {
          candidates.push({ hand, semiBluff: count >= 1 && count < 3 });
        }
      }
    }

    // Straight bluffs — semi-bluff if we hold 2+ of the required ranks
    if (totalCards >= 7 && currentHand.type <= HandType.STRAIGHT) {
      const straightHighs: Rank[] = ['5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
      let straightCount = 0;
      for (const highRank of straightHighs) {
        const hand: HandCall = { type: HandType.STRAIGHT, highRank };
        if (isHigherHand(hand, currentHand)) {
          const highVal = RANK_VALUES[highRank];
          let heldCount = 0;
          for (let v = highVal - 4; v <= highVal; v++) {
            const actualV = v < 2 ? 14 : v;
            const rank = ALL_RANKS.find(r => RANK_VALUES[r] === actualV);
            if (rank && rankCounts.has(rank)) heldCount++;
          }
          candidates.push({ hand, semiBluff: heldCount >= 2 });
          straightCount++;
          if (straightCount >= 2) break; // Consider up to 2 straight options
        }
      }
    }

    // Full house bluffs — semi-bluff if we hold 2+ of the triple rank
    if (totalCards >= 8 && currentHand.type <= HandType.FULL_HOUSE) {
      const heldRanks = [...rankCounts.entries()].sort((a, b) => b[1] - a[1]);
      for (const [threeRank, count] of heldRanks) {
        for (const twoRank of ALL_RANKS) {
          if (twoRank === threeRank) continue;
          const hand: HandCall = { type: HandType.FULL_HOUSE, threeRank, twoRank };
          if (isHigherHand(hand, currentHand)) {
            candidates.push({ hand, semiBluff: count >= 2 });
            break; // One full house per threeRank
          }
        }
        if (candidates.length > 8) break; // Limit candidate explosion
      }
    }

    if (candidates.length === 0) return null;

    // Score each candidate by combined metric:
    // score = plausibility × (1 + semiBluffBonus) × escalationPenalty
    // Semi-bluffs get 30% bonus (they have backup equity)
    // Higher hand types get penalized (minimal escalation preferred)
    let best: HandCall | null = null;
    let bestScore = -1;
    for (const { hand, semiBluff } of candidates) {
      const plausibility = this.estimatePlausibilityHard(hand, ownCards, totalCards);
      const semiBluffBonus = semiBluff ? 1.3 : 1.0;
      // Penalize big jumps: each hand type above current costs 10%
      const typeGap = hand.type - currentHand.type;
      const escalationFactor = Math.pow(0.9, Math.max(0, typeGap - 1));
      const score = plausibility * semiBluffBonus * escalationFactor;
      if (score > bestScore) {
        bestScore = score;
        best = hand;
      }
    }

    // Only bluff if the hand is at least somewhat plausible
    return bestScore >= 0.05 ? best : null;
  }

  // ─── HAND FINDING (SIMPLE — Easy mode) ──────────────────────────────

  /**
   * Find the best hand from bot's own cards (HIGH_CARD, PAIR, THREE_OF_A_KIND, FOUR_OF_A_KIND only).
   */
  static findBestHandInCards(cards: Card[]): HandCall | null {
    const rankCounts = this.getRankCounts(cards);

    for (const [rank, count] of rankCounts) {
      if (count >= 4) return { type: HandType.FOUR_OF_A_KIND, rank };
    }
    for (const [rank, count] of rankCounts) {
      if (count >= 3) return { type: HandType.THREE_OF_A_KIND, rank };
    }

    let bestPairRank: Rank | null = null;
    for (const [rank, count] of rankCounts) {
      if (count >= 2) {
        if (!bestPairRank || RANK_VALUES[rank] > RANK_VALUES[bestPairRank]) {
          bestPairRank = rank;
        }
      }
    }
    if (bestPairRank) return { type: HandType.PAIR, rank: bestPairRank };

    if (cards.length > 0) {
      let bestRank: Rank = cards[0].rank;
      for (const c of cards) {
        if (RANK_VALUES[c.rank] > RANK_VALUES[bestRank]) {
          bestRank = c.rank;
        }
      }
      return { type: HandType.HIGH_CARD, rank: bestRank };
    }

    return null;
  }

  /**
   * Simple hand search — only checks HIGH_CARD, PAIR, THREE_OF_A_KIND candidates.
   */
  private static findHandHigherThanSimple(cards: Card[], currentHand: HandCall): HandCall | null {
    const candidates: HandCall[] = [];
    const rankCounts = this.getRankCounts(cards);

    for (const c of cards) {
      candidates.push({ type: HandType.HIGH_CARD, rank: c.rank });
    }
    for (const [rank, count] of rankCounts) {
      if (count >= 2) candidates.push({ type: HandType.PAIR, rank });
    }
    for (const [rank, count] of rankCounts) {
      if (count >= 3) candidates.push({ type: HandType.THREE_OF_A_KIND, rank });
    }

    return this.pickLowestValid(candidates, currentHand);
  }

  // ─── HAND FINDING (FULL — Hard mode) ────────────────────────────────

  /**
   * Find the best hand considering all hand types and what might exist in the full card pool.
   */
  private static findBestHandInCardsFull(cards: Card[], totalCards: number): HandCall | null {
    const rankCounts = this.getRankCounts(cards);
    const suitCounts = this.getSuitCounts(cards);

    // Four of a kind
    for (const [rank, count] of rankCounts) {
      if (count >= 4) return { type: HandType.FOUR_OF_A_KIND, rank };
    }

    // Full house — need 3+2 of different ranks
    const triples: Rank[] = [];
    const pairs: Rank[] = [];
    for (const [rank, count] of rankCounts) {
      if (count >= 3) triples.push(rank);
      else if (count >= 2) pairs.push(rank);
    }
    if (triples.length > 0 && (pairs.length > 0 || triples.length > 1)) {
      const threeRank = triples.sort((a, b) => RANK_VALUES[b] - RANK_VALUES[a])[0];
      const twoRank = pairs.length > 0
        ? pairs.sort((a, b) => RANK_VALUES[b] - RANK_VALUES[a])[0]
        : triples.filter(r => r !== threeRank)[0];
      if (twoRank) return { type: HandType.FULL_HOUSE, threeRank, twoRank };
    }

    // Three of a kind
    if (triples.length > 0) {
      const rank = triples.sort((a, b) => RANK_VALUES[b] - RANK_VALUES[a])[0];
      return { type: HandType.THREE_OF_A_KIND, rank };
    }

    // Flush — check if we have 5 of a suit (unlikely with few cards, but check)
    for (const [suit, count] of suitCounts) {
      if (count >= 5) return { type: HandType.FLUSH, suit };
    }

    // Two pair
    if (pairs.length >= 2 || (pairs.length >= 1 && triples.length >= 1)) {
      const allPairs = [...pairs, ...triples].sort((a, b) => RANK_VALUES[b] - RANK_VALUES[a]);
      return { type: HandType.TWO_PAIR, highRank: allPairs[0], lowRank: allPairs[1] };
    }

    // Pair
    if (pairs.length > 0) {
      const rank = pairs.sort((a, b) => RANK_VALUES[b] - RANK_VALUES[a])[0];
      return { type: HandType.PAIR, rank };
    }

    // High card
    if (cards.length > 0) {
      let bestRank: Rank = cards[0].rank;
      for (const c of cards) {
        if (RANK_VALUES[c.rank] > RANK_VALUES[bestRank]) {
          bestRank = c.rank;
        }
      }
      return { type: HandType.HIGH_CARD, rank: bestRank };
    }

    return null;
  }

  /**
   * Full hand search — generates candidates across ALL hand types.
   */
  static findHandHigherThan(cards: Card[], currentHand: HandCall): HandCall | null {
    return this.findHandHigherThanFull(cards, currentHand, 10);
  }

  private static findHandHigherThanFull(
    cards: Card[],
    currentHand: HandCall,
    totalCards: number,
  ): HandCall | null {
    const candidates: HandCall[] = [];
    const rankCounts = this.getRankCounts(cards);
    const suitCounts = this.getSuitCounts(cards);

    // High cards
    for (const c of cards) {
      candidates.push({ type: HandType.HIGH_CARD, rank: c.rank });
    }

    // Pairs
    for (const [rank, count] of rankCounts) {
      if (count >= 2) candidates.push({ type: HandType.PAIR, rank });
    }

    // Two pair
    const pairRanks: Rank[] = [];
    for (const [rank, count] of rankCounts) {
      if (count >= 2) pairRanks.push(rank);
    }
    if (pairRanks.length >= 2) {
      pairRanks.sort((a, b) => RANK_VALUES[b] - RANK_VALUES[a]);
      for (let i = 0; i < pairRanks.length; i++) {
        for (let j = i + 1; j < pairRanks.length; j++) {
          candidates.push({
            type: HandType.TWO_PAIR,
            highRank: pairRanks[i],
            lowRank: pairRanks[j],
          });
        }
      }
    }

    // Three of a kind
    for (const [rank, count] of rankCounts) {
      if (count >= 3) candidates.push({ type: HandType.THREE_OF_A_KIND, rank });
    }

    // Flush (if 5+ of same suit)
    for (const [suit, count] of suitCounts) {
      if (count >= 5) candidates.push({ type: HandType.FLUSH, suit });
    }

    // Full house
    const tripleRanks: Rank[] = [];
    const pairableRanks: Rank[] = [];
    for (const [rank, count] of rankCounts) {
      if (count >= 3) tripleRanks.push(rank);
      if (count >= 2) pairableRanks.push(rank);
    }
    for (const tr of tripleRanks) {
      for (const pr of pairableRanks) {
        if (pr !== tr) {
          candidates.push({ type: HandType.FULL_HOUSE, threeRank: tr, twoRank: pr });
        }
      }
    }

    // Four of a kind
    for (const [rank, count] of rankCounts) {
      if (count >= 4) candidates.push({ type: HandType.FOUR_OF_A_KIND, rank });
    }

    return this.pickLowestValid(candidates, currentHand);
  }

  // ─── PLAUSIBILITY (SIMPLE — Easy mode) ──────────────────────────────

  private static estimatePlausibilitySimple(
    hand: HandCall,
    ownCards: Card[],
    totalCards: number,
  ): number {
    switch (hand.type) {
      case HandType.HIGH_CARD: {
        const hasIt = ownCards.some(c => c.rank === hand.rank);
        if (hasIt) return 0.95;
        return Math.min(0.9, totalCards * 0.07);
      }
      case HandType.PAIR: {
        const count = ownCards.filter(c => c.rank === hand.rank).length;
        if (count >= 2) return 0.95;
        if (count === 1) return Math.min(0.7, totalCards * 0.05);
        return Math.min(0.4, totalCards * 0.02);
      }
      case HandType.TWO_PAIR:
        return totalCards >= 6 ? 0.35 : 0.15;
      case HandType.THREE_OF_A_KIND: {
        const count = ownCards.filter(c => c.rank === hand.rank).length;
        if (count >= 3) return 0.95;
        if (count >= 2) return 0.4;
        return totalCards >= 8 ? 0.2 : 0.1;
      }
      case HandType.FLUSH:
        return totalCards >= 10 ? 0.3 : 0.1;
      case HandType.STRAIGHT:
        return totalCards >= 8 ? 0.25 : 0.08;
      case HandType.FULL_HOUSE:
        return totalCards >= 10 ? 0.15 : 0.05;
      case HandType.FOUR_OF_A_KIND:
        return totalCards >= 12 ? 0.1 : 0.03;
      case HandType.STRAIGHT_FLUSH:
        return 0.02;
      case HandType.ROYAL_FLUSH:
        return 0.01;
      default:
        return 0.3;
    }
  }

  /**
   * Public estimatePlausibility for backward compatibility (used by tests).
   */
  static estimatePlausibility(hand: HandCall, ownCards: Card[], totalCards: number): number {
    return this.estimatePlausibilitySimple(hand, ownCards, totalCards);
  }

  // ─── PLAUSIBILITY (HARD MODE) ───────────────────────────────────────

  /**
   * Hypergeometric-approximation plausibility estimation.
   * More accurate probability estimates using number of cards seen vs remaining.
   */
  private static estimatePlausibilityHard(
    hand: HandCall,
    ownCards: Card[],
    totalCards: number,
  ): number {
    const otherCards = totalCards - ownCards.length;
    const deckSize = 52;
    const unseenCards = deckSize - ownCards.length;

    switch (hand.type) {
      case HandType.HIGH_CARD: {
        // 4 copies of the rank in the deck; how many do we have?
        const ownCount = ownCards.filter(c => c.rank === hand.rank).length;
        if (ownCount >= 1) return 0.98;
        const remaining = 4 - ownCount;
        // P(at least 1 among otherCards drawn from unseenCards with `remaining` copies)
        // ≈ 1 - C(unseenCards-remaining, otherCards) / C(unseenCards, otherCards)
        const pNone = this.hypergeomNone(unseenCards, remaining, otherCards);
        return 1 - pNone;
      }

      case HandType.PAIR: {
        const ownCount = ownCards.filter(c => c.rank === hand.rank).length;
        if (ownCount >= 2) return 0.98;
        const remaining = 4 - ownCount;
        const needed = 2 - ownCount;
        return this.hypergeomAtLeast(unseenCards, remaining, otherCards, needed);
      }

      case HandType.TWO_PAIR: {
        if (totalCards < 4) return 0.01;
        const rankCounts = this.getRankCounts(ownCards);
        // Check if we already have the specific two pair called
        const highRank = (hand as { highRank: Rank }).highRank;
        const lowRank = (hand as { lowRank: Rank }).lowRank;
        const highOwn = ownCards.filter(c => c.rank === highRank).length;
        const lowOwn = ownCards.filter(c => c.rank === lowRank).length;
        // P(both pairs exist) = P(>=2 of highRank) × P(>=2 of lowRank)
        const pHigh = highOwn >= 2 ? 0.98 : this.hypergeomAtLeast(unseenCards, 4 - highOwn, otherCards, 2 - highOwn);
        const pLow = lowOwn >= 2 ? 0.98 : this.hypergeomAtLeast(unseenCards, 4 - lowOwn, otherCards, 2 - lowOwn);
        // Not perfectly independent, but a good approximation
        return pHigh * pLow;
      }

      case HandType.THREE_OF_A_KIND: {
        const ownCount = ownCards.filter(c => c.rank === hand.rank).length;
        if (ownCount >= 3) return 0.98;
        const remaining = 4 - ownCount;
        const needed = 3 - ownCount;
        return this.hypergeomAtLeast(unseenCards, remaining, otherCards, needed);
      }

      case HandType.FLUSH: {
        const suit = (hand as { type: HandType.FLUSH; suit: Suit }).suit;
        const ownSuitCount = ownCards.filter(c => c.suit === suit).length;
        if (ownSuitCount >= 5) return 0.95;
        const remaining = 13 - ownSuitCount;
        const needed = 5 - ownSuitCount;
        if (needed <= 0) return 0.95;
        return this.hypergeomAtLeast(unseenCards, remaining, otherCards, needed) * 0.8;
      }

      case HandType.STRAIGHT: {
        // P(straight) ≈ product of P(at least 1 of each required rank)
        // A straight with highRank H needs ranks H, H-1, H-2, H-3, H-4
        if (totalCards < 5) return 0.005;
        const highRank = (hand as { highRank: Rank }).highRank;
        const highVal = RANK_VALUES[highRank];
        // Get the 5 required ranks
        const requiredRanks: Rank[] = [];
        for (let v = highVal - 4; v <= highVal; v++) {
          // Ace-low straight: A-2-3-4-5 (highVal=5, so v starts at 1)
          const actualV = v < 2 ? 14 : v; // Map value 1 to Ace (14)
          const rank = ALL_RANKS.find(r => RANK_VALUES[r] === actualV);
          if (rank) requiredRanks.push(rank);
        }
        if (requiredRanks.length < 5) return 0.005;

        let pStraight = 1;
        for (const rank of requiredRanks) {
          const ownCount = ownCards.filter(c => c.rank === rank).length;
          if (ownCount >= 1) continue; // Already have it, P=1
          const remaining = 4 - ownCount;
          const pNone = this.hypergeomNone(unseenCards, remaining, otherCards);
          pStraight *= (1 - pNone);
        }
        return pStraight;
      }

      case HandType.FULL_HOUSE: {
        if (totalCards < 5) return 0.005;
        // P(full house with threeRank and twoRank) = P(>=3 of threeRank) × P(>=2 of twoRank)
        const threeRank = (hand as { threeRank: Rank }).threeRank;
        const twoRank = (hand as { twoRank: Rank }).twoRank;
        const threeOwn = ownCards.filter(c => c.rank === threeRank).length;
        const twoOwn = ownCards.filter(c => c.rank === twoRank).length;
        const pThree = threeOwn >= 3 ? 0.98 : this.hypergeomAtLeast(unseenCards, 4 - threeOwn, otherCards, 3 - threeOwn);
        const pTwo = twoOwn >= 2 ? 0.98 : this.hypergeomAtLeast(unseenCards, 4 - twoOwn, otherCards, 2 - twoOwn);
        return pThree * pTwo;
      }

      case HandType.FOUR_OF_A_KIND: {
        const ownCount = ownCards.filter(c => c.rank === hand.rank).length;
        if (ownCount >= 4) return 0.98;
        const remaining = 4 - ownCount;
        const needed = 4 - ownCount;
        return this.hypergeomAtLeast(unseenCards, remaining, otherCards, needed);
      }

      case HandType.STRAIGHT_FLUSH: {
        if (totalCards < 5) return 0.001;
        // Need 5 specific cards (rank+suit combos) — each has exactly 1 copy
        const sfSuit = (hand as { suit: Suit }).suit;
        const sfHighRank = (hand as { highRank: Rank }).highRank;
        const sfHighVal = RANK_VALUES[sfHighRank];
        let pSF = 1;
        for (let v = sfHighVal - 4; v <= sfHighVal; v++) {
          const actualV = v < 2 ? 14 : v;
          const rank = ALL_RANKS.find(r => RANK_VALUES[r] === actualV);
          if (!rank) return 0.001;
          const hasIt = ownCards.some(c => c.rank === rank && c.suit === sfSuit);
          if (hasIt) continue;
          // 1 specific card among unseenCards, otherCards drawn
          const pNone = this.hypergeomNone(unseenCards, 1, otherCards);
          pSF *= (1 - pNone);
        }
        return pSF;
      }

      case HandType.ROYAL_FLUSH: {
        if (totalCards < 5) return 0.0005;
        const rfSuit = (hand as { suit: Suit }).suit;
        const royalRanks: Rank[] = ['10', 'J', 'Q', 'K', 'A'];
        let pRF = 1;
        for (const rank of royalRanks) {
          const hasIt = ownCards.some(c => c.rank === rank && c.suit === rfSuit);
          if (hasIt) continue;
          const pNone = this.hypergeomNone(unseenCards, 1, otherCards);
          pRF *= (1 - pNone);
        }
        return pRF;
      }

      default:
        return 0.3;
    }
  }

  // ─── BLUFF GENERATION (EASY) ────────────────────────────────────────

  private static makeBluffHandEasy(currentHand: HandCall | null): HandCall {
    if (!currentHand) {
      const rank = ALL_RANKS[Math.floor(Math.random() * 8) + 5]; // 7 through A
      return { type: HandType.HIGH_CARD, rank };
    }

    if (currentHand.type === HandType.HIGH_CARD) {
      const cr = currentHand as { type: HandType.HIGH_CARD; rank: Rank };
      const nextRankVal = RANK_VALUES[cr.rank] + 1;
      const nextRank = ALL_RANKS.find(r => RANK_VALUES[r] === nextRankVal);
      if (nextRank) return { type: HandType.HIGH_CARD, rank: nextRank };
      return { type: HandType.PAIR, rank: '2' };
    }

    if (currentHand.type === HandType.PAIR) {
      const cr = currentHand as { type: HandType.PAIR; rank: Rank };
      const nextRankVal = RANK_VALUES[cr.rank] + 1;
      const nextRank = ALL_RANKS.find(r => RANK_VALUES[r] === nextRankVal);
      if (nextRank) return { type: HandType.PAIR, rank: nextRank };
      return { type: HandType.FLUSH, suit: ALL_SUITS[Math.floor(Math.random() * 4)] };
    }

    if (currentHand.type < HandType.THREE_OF_A_KIND) {
      return { type: HandType.THREE_OF_A_KIND, rank: '2' };
    }
    if (currentHand.type < HandType.STRAIGHT) {
      return { type: HandType.STRAIGHT, highRank: '6' };
    }

    return { type: HandType.HIGH_CARD, rank: 'A' };
  }

  /**
   * Public makeBluffHand for backward compatibility.
   */
  static makeBluffHand(currentHand: HandCall | null): HandCall {
    return this.makeBluffHandEasy(currentHand);
  }

  // ─── BLUFF GENERATION (HARD) ───────────────────────────────────────

  private static makeBluffHandHard(currentHand: HandCall | null, totalCards: number): HandCall {
    if (!currentHand) {
      // Strategic opening: medium-value call that's harder to challenge
      if (totalCards >= 8) {
        // With many total cards, open with a pair (likely to exist)
        const midRanks: Rank[] = ['7', '8', '9', '10', 'J'];
        const rank = midRanks[Math.floor(Math.random() * midRanks.length)];
        return { type: HandType.PAIR, rank };
      }
      const rank = ALL_RANKS[Math.floor(Math.random() * 6) + 7]; // 9 through A
      return { type: HandType.HIGH_CARD, rank };
    }

    // One step above current, varying by hand type
    if (currentHand.type === HandType.HIGH_CARD) {
      const cr = currentHand as { type: HandType.HIGH_CARD; rank: Rank };
      const nextRankVal = RANK_VALUES[cr.rank] + 1;
      const nextRank = ALL_RANKS.find(r => RANK_VALUES[r] === nextRankVal);
      if (nextRank) return { type: HandType.HIGH_CARD, rank: nextRank };
      return { type: HandType.PAIR, rank: '2' };
    }

    if (currentHand.type === HandType.PAIR) {
      const cr = currentHand as { type: HandType.PAIR; rank: Rank };
      const nextRankVal = RANK_VALUES[cr.rank] + 1;
      const nextRank = ALL_RANKS.find(r => RANK_VALUES[r] === nextRankVal);
      if (nextRank) return { type: HandType.PAIR, rank: nextRank };
      // Escalate to two pair if plausible
      if (totalCards >= 6) {
        return { type: HandType.TWO_PAIR, highRank: 'A', lowRank: '2' };
      }
      return { type: HandType.FLUSH, suit: ALL_SUITS[Math.floor(Math.random() * 4)] };
    }

    if (currentHand.type === HandType.TWO_PAIR) {
      return { type: HandType.FLUSH, suit: ALL_SUITS[Math.floor(Math.random() * 4)] };
    }

    if (currentHand.type === HandType.FLUSH) {
      // Flushes can't be raised with another flush — escalate to three of a kind
      return { type: HandType.THREE_OF_A_KIND, rank: '2' };
    }

    if (currentHand.type === HandType.THREE_OF_A_KIND) {
      const cr = currentHand as { type: HandType.THREE_OF_A_KIND; rank: Rank };
      const nextRankVal = RANK_VALUES[cr.rank] + 1;
      const nextRank = ALL_RANKS.find(r => RANK_VALUES[r] === nextRankVal);
      if (nextRank) return { type: HandType.THREE_OF_A_KIND, rank: nextRank };
      return { type: HandType.STRAIGHT, highRank: '6' };
    }

    if (currentHand.type === HandType.STRAIGHT) {
      const cr = currentHand as { type: HandType.STRAIGHT; highRank: Rank };
      const nextRankVal = RANK_VALUES[cr.highRank] + 1;
      const nextRank = ALL_RANKS.find(r => RANK_VALUES[r] === nextRankVal);
      if (nextRank) return { type: HandType.STRAIGHT, highRank: nextRank };
      return { type: HandType.FULL_HOUSE, threeRank: '2', twoRank: '3' };
    }

    if (currentHand.type === HandType.FULL_HOUSE) {
      return { type: HandType.FOUR_OF_A_KIND, rank: '2' };
    }

    if (currentHand.type === HandType.FOUR_OF_A_KIND) {
      const cr = currentHand as { type: HandType.FOUR_OF_A_KIND; rank: Rank };
      const nextRankVal = RANK_VALUES[cr.rank] + 1;
      const nextRank = ALL_RANKS.find(r => RANK_VALUES[r] === nextRankVal);
      if (nextRank) return { type: HandType.FOUR_OF_A_KIND, rank: nextRank };
      return { type: HandType.STRAIGHT_FLUSH, suit: 'clubs', highRank: '6' };
    }

    // Fallback
    return { type: HandType.HIGH_CARD, rank: 'A' };
  }

  // ─── GTO BLUFFING UTILITIES ────────────────────────────────────────

  /**
   * Truthfulness prior: players tend to call hands related to cards they hold.
   *
   * In practice, most players (especially non-bluffers) call hands they have
   * at least partial evidence for. E.g., someone calling "pair of 7s" likely
   * holds at least one 7. This makes the called hand more likely to exist
   * than pure card-probability would suggest.
   *
   * The boost is higher for lower hands (HIGH_CARD, PAIR — almost always truthful)
   * and lower for higher hands (STRAIGHT_FLUSH — more likely a bluff).
   */
  private static getTruthfulnessBoost(hand: HandCall): number {
    switch (hand.type) {
      case HandType.HIGH_CARD:
        return 0.12; // Likely truthful but not certain
      case HandType.PAIR:
        return 0.10; // Likely they hold at least 1 of the pair
      case HandType.TWO_PAIR:
        return 0.07; // Moderate evidence — might hold 1 of each
      case HandType.FLUSH:
        return 0.06; // Might hold a couple suited cards
      case HandType.THREE_OF_A_KIND:
        return 0.05; // Might hold 1-2 of the rank
      case HandType.STRAIGHT:
        return 0.04; // Might hold some of the ranks
      case HandType.FULL_HOUSE:
        return 0.03; // High hand — weak signal
      case HandType.FOUR_OF_A_KIND:
        return 0.02; // Big claim — often a bluff
      case HandType.STRAIGHT_FLUSH:
      case HandType.ROYAL_FLUSH:
        return 0.01; // Very likely a bluff at this level
      default:
        return 0.05;
    }
  }

  /**
   * Nash equilibrium optimal bluff frequency.
   *
   * In a simplified model where calling bull costs +1 card if wrong:
   * - With 1 opponent: bluff 50% of raises → opponent is indifferent
   * - With N opponents: bluff 1/(N+1) of raises → each opponent is indifferent
   *
   * The intuition: more opponents means more chances someone calls bull correctly,
   * so we should bluff less frequently.
   *
   * Desperation bonus: when close to elimination, increase bluff frequency
   * (risking +1 card from a failed bluff is better than the certainty of getting
   * caught for bull on a hand that probably exists).
   */
  private static getOptimalBluffFrequency(numOpponents: number, desperate: boolean): number {
    // Base GTO frequency: 1/(N+1)
    const base = 1 / (Math.max(1, numOpponents) + 1);

    // Desperation multiplier: when at 4+ cards, bluff more aggressively
    // (the cost of not bluffing — being stuck calling bull on real hands — is higher)
    const desperationMult = desperate ? 1.5 : 1.0;

    return Math.min(0.6, base * desperationMult);
  }

  /**
   * Position-aware bluff detection adjustment.
   *
   * More raises in a round means higher chance someone is bluffing.
   * The first caller is more likely honest (they chose their hand freely).
   * Each subsequent raise is increasingly suspect.
   *
   * Returns a positive adjustment (subtract from plausibility) when
   * many raises have occurred (making us more likely to call bull).
   */
  private static getPositionBluffAdjustment(
    turnHistory: { playerId: string; action: TurnAction }[],
    botId: string,
  ): number {
    // Count raises (CALL actions) in the turn history
    let raiseCount = 0;
    for (const entry of turnHistory) {
      if (entry.action === TurnAction.CALL) raiseCount++;
    }

    // First call is normal; after that, each additional raise adds suspicion
    // Each extra raise beyond 1 adds ~8% bluff suspicion
    const extraRaises = Math.max(0, raiseCount - 1);
    return extraRaises * 0.08;
  }

  // ─── TURN HISTORY ANALYSIS ──────────────────────────────────────────

  /**
   * Analyze turn history to derive a bias modifier.
   * Returns -1..1 where negative = opponents seem to be bluffing more,
   * positive = opponents seem honest.
   */
  static analyzeTurnHistory(
    turnHistory: { playerId: string; action: TurnAction }[],
    botId: string,
  ): number {
    let bullCount = 0;
    let trueCount = 0;
    let callCount = 0;

    for (const entry of turnHistory) {
      if (entry.playerId === botId) continue;
      if (entry.action === TurnAction.BULL) bullCount++;
      else if (entry.action === TurnAction.TRUE) trueCount++;
      else if (entry.action === TurnAction.CALL) callCount++;
    }

    const totalReactions = bullCount + trueCount;
    if (totalReactions < 2) return 0;

    // If opponents call bull a lot, hands are probably fake → negative bias
    // If opponents call true a lot, hands are probably real → positive bias
    const ratio = trueCount / totalReactions;
    return (ratio - 0.5) * 2; // Maps 0..1 to -1..1
  }

  // ─── UTILITY METHODS ────────────────────────────────────────────────

  private static getTotalCards(state: ClientGameState): number {
    return state.players
      .filter(p => !p.isEliminated)
      .reduce((sum, p) => sum + p.cardCount, 0);
  }

  private static getRankCounts(cards: Card[]): Map<Rank, number> {
    const counts = new Map<Rank, number>();
    for (const c of cards) {
      counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
    }
    return counts;
  }

  private static getSuitCounts(cards: Card[]): Map<Suit, number> {
    const counts = new Map<Suit, number>();
    for (const c of cards) {
      counts.set(c.suit, (counts.get(c.suit) ?? 0) + 1);
    }
    return counts;
  }

  private static pickLowestValid(candidates: HandCall[], currentHand: HandCall): HandCall | null {
    const valid = candidates.filter(h => isHigherHand(h, currentHand));
    if (valid.length === 0) return null;

    valid.sort((a, b) => {
      if (a.type !== b.type) return a.type - b.type;
      // Within same type, sort by rank value
      const aRank = this.getHandPrimaryRank(a);
      const bRank = this.getHandPrimaryRank(b);
      return aRank - bRank;
    });
    return valid[0];
  }

  private static getHandPrimaryRank(hand: HandCall): number {
    switch (hand.type) {
      case HandType.HIGH_CARD:
      case HandType.PAIR:
      case HandType.THREE_OF_A_KIND:
      case HandType.FOUR_OF_A_KIND:
        return RANK_VALUES[hand.rank];
      case HandType.TWO_PAIR:
        return RANK_VALUES[hand.highRank] * 100 + RANK_VALUES[hand.lowRank];
      case HandType.FLUSH:
        return SUIT_ORDER[hand.suit];
      case HandType.STRAIGHT:
        return RANK_VALUES[hand.highRank];
      case HandType.FULL_HOUSE:
        return RANK_VALUES[hand.threeRank] * 100 + RANK_VALUES[hand.twoRank];
      case HandType.STRAIGHT_FLUSH:
        return SUIT_ORDER[hand.suit] * 100 + RANK_VALUES[hand.highRank];
      case HandType.ROYAL_FLUSH:
        return SUIT_ORDER[hand.suit];
      default:
        return 0;
    }
  }

  /**
   * Hypergeometric: P(0 successes) when drawing `draw` items from population of
   * `N` items containing `K` successes.
   * Uses logarithmic approximation for numerical stability.
   */
  private static hypergeomNone(N: number, K: number, draw: number): number {
    if (draw <= 0 || K <= 0) return 1;
    if (draw >= N) return K > 0 ? 0 : 1;
    if (K >= N) return 0;

    // P(X=0) = C(N-K, draw) / C(N, draw) = product((N-K-i)/(N-i)) for i=0..draw-1
    let logP = 0;
    const safeN = Math.max(N, 1);
    const safeK = Math.min(K, N);
    const safeDraw = Math.min(draw, N);

    for (let i = 0; i < safeDraw; i++) {
      const num = safeN - safeK - i;
      const den = safeN - i;
      if (den <= 0) return 0;
      if (num <= 0) return 0;
      logP += Math.log(num / den);
    }
    return Math.exp(logP);
  }

  /**
   * P(at least `needed` successes) using complement of cumulative hypergeometric.
   */
  private static hypergeomAtLeast(
    N: number,
    K: number,
    draw: number,
    needed: number,
  ): number {
    if (needed <= 0) return 1;
    if (K < needed) return 0;
    if (draw < needed) return 0;

    // For needed=1, use complement of P(0)
    if (needed === 1) {
      return 1 - this.hypergeomNone(N, K, draw);
    }

    // For needed=2+, approximate using product of conditional probabilities
    let p = 1;
    for (let i = 0; i < needed; i++) {
      const remainingSuccesses = K - i;
      const remainingPool = N - i;
      const remainingDraw = draw - i;
      if (remainingPool <= 0 || remainingDraw <= 0) return 0;
      // P(at least 1 more success in remaining draws from remaining pool)
      const pNone = this.hypergeomNone(remainingPool, remainingSuccesses, remainingDraw);
      p *= (1 - pNone);
    }
    return Math.max(0, Math.min(1, p));
  }
}
