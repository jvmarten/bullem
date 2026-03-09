import { HandType, RoundPhase, BotDifficulty, TurnAction } from '../types.js';
import { RANK_VALUES, ALL_RANKS, ALL_SUITS, SUIT_ORDER } from '../constants.js';
import { isHigherHand } from '../hands.js';
import { HandChecker } from './HandChecker.js';
import type { Card, HandCall, Rank, Suit, ClientGameState, RoundResult, TurnEntry, PlayerId } from '../types.js';
import type { BotProfileConfig } from '../botProfiles.js';
import { DEFAULT_BOT_PROFILE_CONFIG } from '../botProfiles.js';

/** The action a bot decides to take on its turn. */
export type BotAction =
  | { action: 'call'; hand: HandCall }
  | { action: 'bull' }
  | { action: 'true' }
  | { action: 'lastChanceRaise'; hand: HandCall }
  | { action: 'lastChancePass' };

/** Cross-round memory of an opponent's behavior, used by hard/impossible bots. */
export interface OpponentProfile {
  totalCalls: number;
  bluffsCaught: number;
  truthsCaught: number;
  bullCallsMade: number;
  correctBulls: number;
  /** Recent hand types called — used to detect patterns (max 5 entries). */
  lastHandTypes: HandType[];
  /** Raises that jump to a different hand type (e.g., pair → straight). */
  escalationsByType: number;
  /** Raises within same hand type (e.g., pair of 5s → pair of 9s). */
  escalationsByRank: number;
  /** Bluffs caught when the player was at high card count (4+). */
  desperationBluffs: number;
  /** Total calls made when the player was at high card count (4+). */
  desperationCalls: number;
  /** Bull calls made as first reactor (no prior bull/true in round). */
  earlyBulls: number;
  /** Bull calls made after other players already reacted. */
  lateBulls: number;
}

/** Maximum number of opponent profiles stored per scope (room/game).
 *  With max 12 players per game, 50 is generous even accounting for
 *  reconnects generating new player IDs. */
const MAX_PROFILES_PER_SCOPE = 50;

/**
 * AI player for bot opponents. All methods are static — no instance state.
 *
 * Two decision paths:
 * - **Standard** (levels 1–9) — hypergeometric math, opponent memory, and
 *   profile-config-driven decisions. Difficulty is controlled entirely by
 *   {@link BotProfileConfig} parameters interpolated across bot levels.
 *   The {@link BotDifficulty} enum (NORMAL/HARD) still exists for UI
 *   categorization but both route through the same decision logic.
 * - **IMPOSSIBLE** — sees ALL players' cards (including other bots').
 */
/** Bot's own action history — used to vary play and avoid predictability. */
interface BotSelfImage {
  /** Last 8 decisions: true = bluffed, false = truthful/legitimate. */
  recentBluffs: boolean[];
  /** Rounds since this bot was caught bluffing (high = safe to bluff again). */
  roundsSinceCaught: number;
}

/**
 * Situational context for context-aware bot decisions.
 *
 * Captures round-specific factors that should change the bot's base
 * calculations before personality parameters are applied.
 */
interface SituationalContext {
  // ── Position & escalation ──────────────────────────────────────
  /** Number of CALL actions before the bot's turn (0 = bot is opener). */
  callsBefore: number;
  /** Total number of raises (CALL actions) in the round so far. */
  totalRaises: number;

  // ── Ceiling proximity ──────────────────────────────────────────
  /** The current hand type (null if opening). */
  currentHandType: HandType | null;
  /** True when the hand is STRAIGHT_FLUSH or ROYAL_FLUSH — almost no room to raise. */
  atCeiling: boolean;
  /** True when the hand is FOUR_OF_A_KIND or higher — very limited raise room. */
  nearCeiling: boolean;

  // ── Elimination pressure (self) ────────────────────────────────
  /** Bot's own card count. */
  botCardCount: number;
  /** Max cards before elimination. */
  maxCards: number;
  /** Cards until elimination (maxCards - botCardCount). 0 = next loss eliminates. */
  cardsUntilElimination: number;
  /** True when 1 card from elimination (next loss = out). */
  botOneBehind: boolean;
  /** True when 2 cards from elimination (losing twice = out). */
  botTwoBehind: boolean;

  // ── Elimination pressure (opponents) ───────────────────────────
  /** The last caller's card count (null if unknown). */
  callerCardCount: number | null;
  /** True when the last caller is 1 card from elimination. */
  callerOneBehind: boolean;
  /** True when any active opponent is 1 card from elimination. */
  anyOpponentOneBehind: boolean;

  // ── Player count ─────────────────────────────────────────────────
  /** Number of non-eliminated players (including the bot). */
  activePlayers: number;
  /** True when only 2 players remain (heads-up). */
  isHeadsUp: boolean;

  // ── Bull phase signals ─────────────────────────────────────────
  /** Number of BULL calls before the bot in bull phase. */
  bullCallsBefore: number;
  /** Number of TRUE calls before the bot in bull phase. */
  trueCallsBefore: number;
  /** True when at least one player called TRUE before the bot in bull phase. */
  someoneCalledTrue: boolean;
  /** True when the bot is the first responder in bull phase (no prior signals). */
  firstResponder: boolean;
}

export class BotPlayer {
  // Cross-round opponent memory — scoped per room/game to prevent leaking
  // between concurrent games. Outer key is the scope (room code or game ID).
  private static scopedMemory = new Map<string, Map<string, OpponentProfile>>();

  // Per-bot self-image for table image / meta-strategy. Key = `${scope}:${botId}`.
  private static selfImageMap = new Map<string, BotSelfImage>();

  /** Clear opponent memory for a specific scope (room/game). If no scope is
   *  provided, clears ALL scopes (useful for tests). */
  static resetMemory(scope?: string): void {
    if (!scope) {
      this.scopedMemory.clear();
      this.selfImageMap.clear();
      return;
    }
    this.scopedMemory.delete(scope);
    // Clear self-image entries for this scope
    for (const key of this.selfImageMap.keys()) {
      if (key.startsWith(`${scope}:`)) this.selfImageMap.delete(key);
    }
  }

  /** Get the memory map for a given scope, creating it if needed. */
  private static getScopedMemory(scope?: string): Map<string, OpponentProfile> {
    if (!scope) return new Map();
    let mem = this.scopedMemory.get(scope);
    if (!mem) {
      mem = new Map();
      this.scopedMemory.set(scope, mem);
    }
    return mem;
  }

  /** Update opponent profiles from a round result. Call after each round resolves.
   *  @param scope — room code or game ID to scope this memory to.
   *  @param callerCardCount — the caller's card count at time of the call (for desperation tracking). */
  static updateMemory(roundResult: RoundResult, scope?: string, callerCardCount?: number): void {
    const { callerId, handExists, turnHistory } = roundResult;
    if (!turnHistory) return;

    const mem = this.getScopedMemory(scope);

    // Track the caller (the player whose hand was being evaluated)
    const callerProfile = this.getOrCreateProfileFrom(mem, callerId);
    callerProfile.totalCalls++;
    if (handExists) {
      callerProfile.truthsCaught++;
    } else {
      callerProfile.bluffsCaught++;
    }
    // Track what hand type the caller used
    if (roundResult.calledHand) {
      callerProfile.lastHandTypes.push(roundResult.calledHand.type);
      if (callerProfile.lastHandTypes.length > 5) {
        callerProfile.lastHandTypes.shift();
      }
    }

    // Track desperation behavior: bluffs when at high card count
    if (callerCardCount !== undefined && callerCardCount >= 4) {
      callerProfile.desperationCalls = (callerProfile.desperationCalls ?? 0) + 1;
      if (!handExists) {
        callerProfile.desperationBluffs = (callerProfile.desperationBluffs ?? 0) + 1;
      }
    }

    // Track escalation patterns from turn history
    let previousCallType: HandType | null = null;
    for (const entry of turnHistory) {
      if (entry.action === TurnAction.CALL && entry.hand) {
        const profile = this.getOrCreateProfileFrom(mem, entry.playerId);
        if (previousCallType !== null) {
          if (entry.hand.type !== previousCallType) {
            profile.escalationsByType = (profile.escalationsByType ?? 0) + 1;
          } else {
            profile.escalationsByRank = (profile.escalationsByRank ?? 0) + 1;
          }
        }
        previousCallType = entry.hand.type;
      }
    }

    // Track bull callers: timing (early vs late) and accuracy
    let bullOrTrueSeenBefore = false;
    for (const entry of turnHistory) {
      if (entry.action === TurnAction.BULL) {
        const bullProfile = this.getOrCreateProfileFrom(mem, entry.playerId);
        bullProfile.bullCallsMade++;
        if (!handExists) {
          bullProfile.correctBulls++;
        }
        if (bullOrTrueSeenBefore) {
          bullProfile.lateBulls = (bullProfile.lateBulls ?? 0) + 1;
        } else {
          bullProfile.earlyBulls = (bullProfile.earlyBulls ?? 0) + 1;
        }
      }
      if (entry.action === TurnAction.BULL || entry.action === TurnAction.TRUE) {
        bullOrTrueSeenBefore = true;
      }
    }

    // Update self-image for any bots that were the caller
    if (scope) {
      for (const key of this.selfImageMap.keys()) {
        if (!key.startsWith(`${scope}:`)) continue;
        const botId = key.slice(scope.length + 1);
        const img = this.selfImageMap.get(key)!;
        if (callerId === botId && !handExists) {
          img.roundsSinceCaught = 0;
        } else {
          img.roundsSinceCaught++;
        }
      }
    }
  }

  /** Get or create an opponent profile within a given memory map.
   *  Caps the number of profiles per scope to prevent unbounded growth. */
  private static getOrCreateProfileFrom(mem: Map<string, OpponentProfile>, playerId: string): OpponentProfile {
    let profile = mem.get(playerId);
    if (!profile) {
      // Cap profile count — evict the oldest entry (first key) if at limit
      if (mem.size >= MAX_PROFILES_PER_SCOPE) {
        const oldest = mem.keys().next().value;
        if (oldest !== undefined) mem.delete(oldest);
      }
      profile = {
        totalCalls: 0,
        bluffsCaught: 0,
        truthsCaught: 0,
        bullCallsMade: 0,
        correctBulls: 0,
        lastHandTypes: [],
        escalationsByType: 0,
        escalationsByRank: 0,
        desperationBluffs: 0,
        desperationCalls: 0,
        earlyBulls: 0,
        lateBulls: 0,
      };
      mem.set(playerId, profile);
    }
    return profile;
  }

  /** Get the opponent memory map for a given scope (for testing). */
  static getMemory(scope?: string): Map<string, OpponentProfile> {
    if (!scope) {
      // Return first scope's memory for backwards compatibility in tests
      const first = this.scopedMemory.values().next().value;
      return first ?? new Map();
    }
    return this.getScopedMemory(scope);
  }

  // ── Hardcoded constants for removed params ──────────────────────────
  // Gen80 evolution simplified from 17 to 10 tunable params. These 9 params
  // provide contextual adaptation but don't meaningfully differentiate between
  // personalities — hardcoded at their gen50 evolved-optimal values.
  private static readonly CARD_COUNT_SENSITIVITY = 0.05;
  private static readonly HEADS_UP_AGGRESSION = 0.68;
  private static readonly SURVIVAL_PRESSURE = 0.40;
  private static readonly BLUFF_TARGET_SELECTION = 0.46;
  private static readonly POSITION_AWARENESS = 0.42;
  private static readonly TRUE_CALL_CONFIDENCE = 1.0;
  private static readonly COUNTER_BLUFF_RATE = 0.62;
  private static readonly BULL_PHASE_BLUFF_RATE = 0.75;
  private static readonly OPENING_HAND_TYPE_PREFERENCE = 0.26;

  /**
   * Get truthfulness adjustment for a specific player based on memory.
   * Returns a continuous multiplier (0..1) for the truthfulness boost.
   *
   * Uses fine-grained trust calculation instead of coarse 0/0.5/1.0 buckets,
   * making the trustMultiplier personality parameter more impactful.
   */
  private static getPlayerTrustFactor(
    playerId: string | null,
    mem: Map<string, OpponentProfile>,
    callerDesperate?: boolean,
  ): number {
    if (!playerId) return 1.0;
    const profile = mem.get(playerId);
    if (!profile || profile.totalCalls < 2) return 1.0;

    const bluffRate = profile.bluffsCaught / profile.totalCalls;

    // Continuous trust from bluff rate: linear interpolation from 1.0 (0% bluffs) to 0.0 (60%+ bluffs).
    // This gives trustMultiplier more granular material to work with than coarse buckets.
    let trust = Math.max(0, 1.0 - bluffRate * 1.67);

    // Factor in bull-call accuracy: opponents who correctly call bull often
    // are more trustworthy (they understand the game well, less likely to bluff)
    if (profile.bullCallsMade >= 3) {
      const bullAccuracy = profile.correctBulls / profile.bullCallsMade;
      // Good bull accuracy = skilled player = slightly more trustworthy when calling
      trust += (bullAccuracy - 0.5) * 0.15;
    }

    // Adjust trust based on desperation behavior patterns:
    // If this player bluffs more when desperate and they ARE currently desperate, reduce trust further.
    // If they're honest even when desperate, slightly increase trust.
    if (callerDesperate && (profile.desperationCalls ?? 0) >= 2) {
      const despBluffRate = (profile.desperationBluffs ?? 0) / (profile.desperationCalls ?? 1);
      if (despBluffRate > 0.5) {
        trust *= 0.6; // They bluff a lot when desperate — reduce trust significantly
      } else if (despBluffRate < 0.2) {
        trust = Math.min(1.0, trust * 1.2); // Honest under pressure — slightly more trustworthy
      }
    }

    // Adjust based on escalation patterns: frequent type-jumpers are more likely bluffing
    const totalEscalations = (profile.escalationsByType ?? 0) + (profile.escalationsByRank ?? 0);
    if (totalEscalations >= 3) {
      const typeJumpRate = (profile.escalationsByType ?? 0) / totalEscalations;
      if (typeJumpRate > 0.6) {
        trust *= 0.85; // Frequently jumps hand types — slightly suspicious
      }
    }

    return Math.max(0, Math.min(1, trust));
  }

  /**
   * Decide what action a bot should take given the current game state, its cards, and difficulty.
   * For IMPOSSIBLE difficulty, allCards should contain the bot's own cards + human players' cards.
   * @param scope — room code or game ID for scoped opponent memory (used in HARD mode).
   */
  static decideAction(
    state: ClientGameState,
    botId: string,
    botCards: Card[],
    difficulty: BotDifficulty = BotDifficulty.NORMAL,
    allCards?: Card[],
    scope?: string,
    profileConfig?: BotProfileConfig,
  ): BotAction {
    if (difficulty === BotDifficulty.IMPOSSIBLE && allCards) {
      return this.decideImpossible(state, botId, botCards, allCards);
    }
    // All non-impossible bots (NORMAL and HARD) use the same decision logic,
    // differentiated only by their BotProfileConfig parameters.
    const cfg: BotProfileConfig = profileConfig
      ? { ...DEFAULT_BOT_PROFILE_CONFIG, ...profileConfig }
      : DEFAULT_BOT_PROFILE_CONFIG;
    return this.decideHard(state, botId, botCards, scope, cfg);
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
          const [hi, lo] = RANK_VALUES[pairRanks[j]!] > RANK_VALUES[pairRanks[i]!]
            ? [pairRanks[j]!, pairRanks[i]!]
            : [pairRanks[i]!, pairRanks[j]!];
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
    return { action: 'call', hand: existingHands[idx]! };
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

    // No higher hand exists — the bot knows the hand is real, so call true.
    // Calling bull here would be a guaranteed loss.
    return { action: 'true' };
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
    return valid[pick]!;
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

    return valid[0]!;
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
        const [hi, lo] = RANK_VALUES[ALL_RANKS[j]!] > RANK_VALUES[ALL_RANKS[i]!]
          ? [ALL_RANKS[j]!, ALL_RANKS[i]!]
          : [ALL_RANKS[i]!, ALL_RANKS[j]!];
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

  // ─── STANDARD MODE (Probability-Driven + GTO Bluffing) ─────────────

  private static decideHard(state: ClientGameState, botId: string, botCards: Card[], scope?: string, cfg: BotProfileConfig = DEFAULT_BOT_PROFILE_CONFIG): BotAction {
    const { roundPhase, currentHand, lastCallerId } = state;
    const totalCards = this.getTotalCards(state);
    const numOpponents = state.players.filter(p => !p.isEliminated && p.id !== botId).length;
    const mem = this.getScopedMemory(scope);
    const botDesperate = this.isBotDesperate(botId, state);

    // LAST_CHANCE phase — everyone called bull on our hand.
    if (roundPhase === RoundPhase.LAST_CHANCE && lastCallerId === botId) {
      if (currentHand) {
        // Use Bayesian beliefs for better plausibility estimation
        const beliefs = this.buildCardBeliefs(state.turnHistory, botId, state, mem);
        const plausibility = this.estimatePlausibilityHard(currentHand, botCards, totalCards, beliefs.rankBeliefs);
        const truthBoost = this.getTruthfulnessBoost(currentHand);
        // Chain consistency boosts confidence the hand is real
        const chainBonus = (beliefs.chainConsistency - 0.5) * 0.1;
        const adjustedP = Math.min(1, plausibility + truthBoost + chainBonus);

        // If the hand very likely exists, pass — the bullers will be penalized
        if (adjustedP > 0.55) {
          this.recordSelfAction(scope, botId, false);
          return { action: 'lastChancePass' };
        }

        // Moderate plausibility — still favor passing but occasionally raise.
        const passChance = 1.0 - cfg.lastChanceBluffRate;
        if (adjustedP > 0.35 && Math.random() < passChance) {
          this.recordSelfAction(scope, botId, false);
          return { action: 'lastChancePass' };
        }

        // Hand probably doesn't exist — try to raise to escape the penalty
        const higher = this.findHandHigherThanFull(botCards, currentHand, totalCards);
        if (higher) {
          this.recordSelfAction(scope, botId, false);
          return { action: 'lastChanceRaise', hand: higher };
        }
        const bluff = this.findBestPlausibleRaise(currentHand, botCards, totalCards);
        if (bluff) {
          this.recordSelfAction(scope, botId, true);
          return { action: 'lastChanceRaise', hand: bluff };
        }
        // Last resort bluff — only if plausibility is very low (passing almost guarantees loss)
        if (adjustedP < 0.2) {
          const desperateBluff = this.makeBluffHandHard(currentHand, totalCards);
          if (isHigherHand(desperateBluff, currentHand)) {
            this.recordSelfAction(scope, botId, true);
            return { action: 'lastChanceRaise', hand: desperateBluff };
          }
        }
      }
      this.recordSelfAction(scope, botId, false);
      return { action: 'lastChancePass' };
    }

    // Opening call — card-pool-aware strategy with desperation and table image
    if (roundPhase === RoundPhase.CALLING && !currentHand) {
      const action = this.handleHardOpening(botCards, totalCards, cfg, botDesperate, scope, botId);
      return action;
    }

    // Calling phase — EV-driven raise vs bull with GTO bluff frequency
    if (roundPhase === RoundPhase.CALLING && currentHand) {
      return this.handleHardCallingPhase(currentHand, botCards, totalCards, botCards.length, numOpponents, state.turnHistory, botId, lastCallerId, mem, cfg, state, scope);
    }

    // Bull phase — probability threshold with position-aware adjustment
    if (roundPhase === RoundPhase.BULL_PHASE && currentHand) {
      return this.handleHardBullPhase(currentHand, botCards, totalCards, botCards.length, state.turnHistory, botId, lastCallerId, mem, cfg, state, scope);
    }

    // Fallback
    if (currentHand) return { action: 'bull' };
    return { action: 'call', hand: { type: HandType.HIGH_CARD, rank: '2' } };
  }

  /**
   * Opening: card-pool-aware strategy with desperation awareness and table image.
   *
   * - Many cards in play (>=10): Open with a mid-range truthful hand (upper half).
   *   Preserves room to raise later.
   * - Few cards in play (<6): Open conservatively with the lowest truthful hand.
   * - Desperation: when near elimination, open more aggressively with harder-to-challenge hands.
   * - Table image: adjust bluff frequency based on bot's own recent history.
   */
  private static handleHardOpening(botCards: Card[], totalCards: number, cfg: BotProfileConfig = DEFAULT_BOT_PROFILE_CONFIG, botDesperate: boolean = false, scope?: string, botId?: string): BotAction {
    const rankCounts = this.getRankCounts(botCards);
    const heldRanks = new Set(botCards.map(c => c.rank));

    // Build truthful candidates (hands we literally hold) — used for pairs+
    // where revealing the rank is unavoidable and the hand type itself is strong.
    const truthfulCandidates: HandCall[] = [];

    // Pairs we have
    for (const [rank, count] of rankCounts) {
      if (count >= 2) truthfulCandidates.push({ type: HandType.PAIR, rank });
    }
    // Two pairs we have
    const pairRanks: Rank[] = [];
    for (const [rank, count] of rankCounts) {
      if (count >= 2) pairRanks.push(rank);
    }
    if (pairRanks.length >= 2) {
      pairRanks.sort((a, b) => RANK_VALUES[b] - RANK_VALUES[a]);
      for (let i = 0; i < pairRanks.length; i++) {
        for (let j = i + 1; j < pairRanks.length; j++) {
          truthfulCandidates.push({ type: HandType.TWO_PAIR, highRank: pairRanks[i]!, lowRank: pairRanks[j]! });
        }
      }
    }
    // Three of a kind
    for (const [rank, count] of rankCounts) {
      if (count >= 3) truthfulCandidates.push({ type: HandType.THREE_OF_A_KIND, rank });
    }

    // For high card openings, human players almost never call the rank they
    // actually hold — doing so gives away free information. Instead, they call
    // a rank they don't have (typically a high one). Bots should do the same:
    // pick from ranks we DON'T hold, biased toward higher values.
    const highCardPool = this.buildHighCardOpeningPool(botCards);

    // Sort truthful candidates by hand strength (lowest first)
    truthfulCandidates.sort((a, b) => {
      if (a.type !== b.type) return a.type - b.type;
      return this.getHandPrimaryRank(a) - this.getHandPrimaryRank(b);
    });

    // If we have actual pairs+, decide whether to open with them based on openingHandTypePreference.
    // High preference = open with pairs+ more often. Low = prefer hiding info with high card bluffs.
    if (truthfulCandidates.length > 0) {
      // With strong hands (pair+) and many cards, open truthfully most of the time
      if (totalCards >= 10) {
        const upperStart = Math.floor(truthfulCandidates.length / 2);
        const idx = upperStart + Math.floor(Math.random() * (truthfulCandidates.length - upperStart));
        return { action: 'call', hand: truthfulCandidates[Math.min(idx, truthfulCandidates.length - 1)]! };
      }
      // openingHandTypePreference controls pair vs high card split:
      // Low (0.0) = 60% high card bluff, high (1.0) = always pair+
      const highCardBluffChance = Math.max(0, 0.6 - this.OPENING_HAND_TYPE_PREFERENCE * 0.6);
      if (Math.random() < highCardBluffChance && highCardPool.length > 0) {
        const pick = highCardPool[Math.floor(Math.random() * highCardPool.length)]!;
        if (botId) this.recordSelfAction(scope, botId, true);
        return { action: 'call', hand: { type: HandType.HIGH_CARD, rank: pick } };
      }
      const idx = Math.floor(Math.random() * truthfulCandidates.length);
      return { action: 'call', hand: truthfulCandidates[idx]! };
    }

    // No pairs+ in hand — we're opening with a high card call.
    // Strategic bluff opening — table image adjusts bluff frequency.
    const tableImageAdj = botId ? this.getTableImageBluffAdjustment(scope, botId) : 0;
    const earlyRoundBluffBonus = Math.max(0, (8 - totalCards) * 0.06);
    const effectiveBluffRate = Math.max(0, Math.min(0.75, cfg.openingBluffRate + tableImageAdj + earlyRoundBluffBonus));

    if (Math.random() < effectiveBluffRate) {
      // Bluff a pair or higher hand type we don't fully hold
      const bluff = this.makeBluffHandHard(null, totalCards);
      const bluffP = this.estimatePlausibilityHard(bluff, botCards, totalCards);
      if (bluffP > cfg.bluffPlausibilityGate) {
        if (botId) this.recordSelfAction(scope, botId, true);
        return { action: 'call', hand: bluff };
      }
    }

    // Default: open with a high card we DON'T hold (like humans do).
    // This hides what card we actually have while still making a reasonable call.
    if (highCardPool.length > 0) {
      const pick = highCardPool[Math.floor(Math.random() * highCardPool.length)]!;
      if (botId) this.recordSelfAction(scope, botId, false);
      return { action: 'call', hand: { type: HandType.HIGH_CARD, rank: pick } };
    }

    // Fallback: we hold all high ranks somehow — call one we have (rare edge case)
    const bestRank = botCards.reduce((best, c) =>
      RANK_VALUES[c.rank] > RANK_VALUES[best] ? c.rank : best, botCards[0]!.rank);
    return { action: 'call', hand: { type: HandType.HIGH_CARD, rank: bestRank } };
  }

  /**
   * Build a pool of high card ranks the bot does NOT hold, suitable for opening.
   * Humans rarely call the rank they actually have — it gives away information.
   * Returns ranks sorted by value (highest first), biased toward 8+ values.
   */
  private static buildHighCardOpeningPool(botCards: Card[]): Rank[] {
    const heldRanks = new Set(botCards.map(c => c.rank));
    // Prefer ranks 8+ that we don't hold — these are believable openers
    const pool = ALL_RANKS.filter(r => !heldRanks.has(r) && RANK_VALUES[r] >= 8);
    if (pool.length > 0) return pool;
    // Fallback: any rank we don't hold
    return ALL_RANKS.filter(r => !heldRanks.has(r));
  }

  /**
   * Find a bluff high card rank above the given rank that the bot does NOT hold.
   * Human players raise high cards by calling ranks they don't have (e.g., if
   * someone calls "10 high" and you have a 4, you'd bluff "J high" not "pair of 4s").
   * Returns null if no suitable bluff rank exists.
   */
  private static findBluffHighCardAbove(botCards: Card[], currentRank: Rank): HandCall | null {
    const heldRanks = new Set(botCards.map(c => c.rank));
    const currentValue = RANK_VALUES[currentRank];
    // Find ranks above current that we don't hold
    const bluffRanks = ALL_RANKS.filter(r => !heldRanks.has(r) && RANK_VALUES[r] > currentValue);
    if (bluffRanks.length === 0) return null;
    // Pick randomly, biased toward lower valid ranks (more believable, leaves room)
    const pick = bluffRanks[Math.floor(Math.random() * Math.random() * bluffRanks.length)]!;
    return { type: HandType.HIGH_CARD, rank: pick };
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
    cardCount: number,
    numOpponents: number,
    turnHistory: { playerId: string; action: TurnAction; hand?: HandCall }[],
    botId: string,
    lastCallerId: string | null,
    mem: Map<string, OpponentProfile>,
    cfg: BotProfileConfig = DEFAULT_BOT_PROFILE_CONFIG,
    state?: ClientGameState,
    scope?: string,
  ): BotAction {
    const desperate = cardCount >= 4;

    // Build situational context for branching decisions
    const ctx = state
      ? this.buildSituationalContext(state, botId, turnHistory)
      : null;

    // Bayesian card beliefs — richer inference from full turn history
    const beliefs = state
      ? this.buildCardBeliefs(turnHistory, botId, state, mem)
      : { rankBeliefs: this.inferCardsFromHistory(turnHistory, botId), chainConsistency: 0.5 };
    const pRaw = this.estimatePlausibilityHard(currentHand, botCards, totalCards, beliefs.rankBeliefs);
    const higher = this.findHandHigherThanFull(botCards, currentHand, totalCards);

    // Truthfulness prior adjusted by caller trust, desperation, and profile trust multiplier.
    // Scale down in early rounds: with few total cards, complex hands are harder to back
    // with real evidence, so the prior that "callers are honest" is weaker.
    const callerDesperate = state ? this.getDesperationTrustFactor(lastCallerId, state) : 1.0;
    const callerDesperateFlag = state !== undefined && callerDesperate < 1.0;
    const trustFactor = this.getPlayerTrustFactor(lastCallerId, mem, callerDesperateFlag) * cfg.trustMultiplier;
    const cardPoolScale = Math.min(1.0, totalCards / 12); // Ramp from ~0.17 at 2 cards to 1.0 at 12+
    const truthBoost = this.getTruthfulnessBoost(currentHand) * trustFactor * callerDesperate * cardPoolScale;

    // Factor in position: more raises → more likely someone is bluffing.
    // Late position amplifies this — with 4+ raises, the bot has rich info
    // and should weight escalation patterns more heavily.
    // positionAwareness scales this: high = tighter early, more aggressive late
    const basePositionAdj = this.getPositionBluffAdjustment(turnHistory, botId);
    const positionInfoBonus = ctx ? Math.min(1.0, ctx.callsBefore / 4) : 0;
    const positionAdj = basePositionAdj * (1 + positionInfoBonus * 0.5) * (0.5 + this.POSITION_AWARENESS);

    // Escalation pattern: many raises means someone along the chain probably
    // has something real — but the LAST raiser is increasingly suspect.
    // With few raises, the caller is more likely truthful. With many, the
    // latest caller may be riding momentum without real cards.
    const escalationAdj = ctx && ctx.totalRaises >= 3
      ? (ctx.totalRaises - 2) * 0.05 * (1.0 - cfg.bullThreshold) // Suspicious profiles weigh this more
      : 0;

    // Call chain consistency: consistent chains are more believable
    const chainBonus = (beliefs.chainConsistency - 0.5) * 0.12;

    // Ceiling proximity: when the hand is in STRAIGHT_FLUSH/ROYAL_FLUSH
    // territory, there's almost no room to raise — lean heavily toward bull.
    const ceilingBullBias = ctx?.atCeiling ? 0.15 : (ctx?.nearCeiling ? 0.08 : 0);

    // Opponent desperation read: a desperate caller (1 card from elimination)
    // is more likely telling the truth — they can't afford to get caught.
    // But aggressive raises from a desperate opponent might be a hail mary bluff.
    const opponentDesperationAdj = this.getOpponentDesperationAdjustment(ctx, turnHistory);

    const adjustedP = Math.max(0, Math.min(1,
      pRaw + truthBoost - positionAdj - escalationAdj + chainBonus - ceilingBullBias + opponentDesperationAdj,
    ));

    // Impossibility override: if raw probability is near zero, the hand is mathematically
    // impossible or near-impossible given what we can see. Always call bull regardless of
    // desperation state — no truthfulness boost can override card-count impossibility
    // (e.g., flush needing 5 suited cards when opponent only has 4 cards total).
    if (pRaw < 0.005) {
      this.recordSelfAction(scope, botId, false);
      return { action: 'bull' };
    }

    // ── Ceiling branch: when near the top of the hand hierarchy ──────
    // With almost no room to raise, the EV of raising drops dramatically.
    // Lean toward bull unless the hand is clearly plausible.
    if (ctx?.atCeiling) {
      if (adjustedP < 0.6) {
        this.recordSelfAction(scope, botId, false);
        return { action: 'bull' };
      }
    }

    // ── Self-desperation branch: fundamentally different EV when close to elimination ──
    if (ctx && (ctx.botOneBehind || ctx.botTwoBehind)) {
      return this.callingPhaseDesperationBranch(
        currentHand, botCards, totalCards, numOpponents, botId, higher,
        adjustedP, cfg, scope, ctx,
      );
    }

    // Heads-up aggression: blend aggressionBias toward maximum when 1v1
    const effectiveAggression = ctx?.isHeadsUp
      ? cfg.aggressionBias + (1.0 - cfg.aggressionBias) * this.HEADS_UP_AGGRESSION
      : cfg.aggressionBias;

    // Card count sensitivity: unified scaling for both bluff and bull adjustments.
    // Higher sensitivity = more reactive to card counts in both directions.
    const cardCountScale = Math.min(1.0, (cardCount - 1) / 3);
    const cardCountBluffMult = 1.0 + (this.CARD_COUNT_SENSITIVITY - 1.0) * cardCountScale;
    const cardCountBullOffset = (this.CARD_COUNT_SENSITIVITY - 1.0) * 0.08 * cardCountScale;

    // Bull threshold: profiles with lower bullThreshold call bull at higher adjustedP values
    const confidentBullThreshold = 0.20 + (cfg.bullThreshold - 0.5) * 0.2 - cardCountBullOffset;

    // ── Late position branch: 4+ calls before us = rich information ──
    // Late position bots have seen many raises and can make more informed
    // decisions. They should weight the escalation pattern more heavily.
    if (ctx && ctx.callsBefore >= 3) {
      // With lots of history, the chain consistency and escalation pattern
      // become primary signals. Lower the confidentBullThreshold slightly
      // because we have better info to act on.
      const latePositionThreshold = confidentBullThreshold * 0.85;
      if (adjustedP < latePositionThreshold) {
        this.recordSelfAction(scope, botId, false);
        return { action: 'bull' };
      }
    } else {
      // Confident bull: hand is very unlikely to exist
      if (adjustedP < confidentBullThreshold && !desperate) {
        this.recordSelfAction(scope, botId, false);
        return { action: 'bull' };
      }
    }

    // ── Counter-bluff: raise over a suspected bluff instead of calling bull ──
    // This exploits opponents who reflexively call bull. If we think the hand is
    // fake (adjustedP < threshold) but have counterBluffRate will, raise over it.
    // riskTolerance scales the willingness to take this calculated risk.
    if (adjustedP < confidentBullThreshold + 0.1 && !higher) {
      const counterBluffChance = this.COUNTER_BLUFF_RATE * cfg.riskTolerance * effectiveAggression;
      if (Math.random() < counterBluffChance) {
        const counterRaise = this.findBestPlausibleRaise(currentHand, botCards, totalCards, this.BLUFF_TARGET_SELECTION);
        if (counterRaise) {
          this.recordSelfAction(scope, botId, true);
          return { action: 'call', hand: counterRaise };
        }
      }
    }

    // If current call is a high card, prefer bluffing a higher rank we don't hold
    // rather than jumping to pair (which reveals our cards). This is what humans do —
    // e.g., if someone calls "10 high" and you have a 4, you'd call "J high" not "pair of 4s".
    if (currentHand.type === HandType.HIGH_CARD && currentHand.rank) {
      const bluffHighCard = this.findBluffHighCardAbove(botCards, currentHand.rank);
      if (bluffHighCard) {
        this.recordSelfAction(scope, botId, true);
        return { action: 'call', hand: bluffHighCard };
      }
    }

    // We have a legitimate higher hand — value raise
    if (higher) {
      // Even with a legitimate hand, sometimes call bull on very implausible hands
      const bullOnImplausibleChance = 0.4 * (1.0 - effectiveAggression);
      if (adjustedP < 0.12 && Math.random() < bullOnImplausibleChance) {
        this.recordSelfAction(scope, botId, false);
        return { action: 'bull' };
      }
      this.recordSelfAction(scope, botId, false);
      return { action: 'call', hand: higher };
    }

    // No legitimate hand — decide whether to bluff raise or call bull.
    // Table image and early-round bonus adjust bluff frequency.
    // riskTolerance now scales the overall bluff willingness (was underused before).
    const tableImageAdj = scope ? this.getTableImageBluffAdjustment(scope, botId) : 0;
    const earlyBluffBonus = Math.max(0, (8 - totalCards) * 0.05); // Bluff more with fewer total cards
    const riskScale = 0.5 + cfg.riskTolerance * 0.5; // 0.5 at riskTolerance=0, 1.0 at riskTolerance=1
    const bluffFreq = Math.max(0, this.getOptimalBluffFrequency(numOpponents, desperate) * cfg.bluffFrequency * cardCountBluffMult * riskScale + tableImageAdj + earlyBluffBonus);

    if (adjustedP > 0.45) {
      // Hand is probably real — bluff raise to avoid a bull penalty
      if (Math.random() < bluffFreq * 1.3) {
        const bluff = this.findBestPlausibleRaise(currentHand, botCards, totalCards, this.BLUFF_TARGET_SELECTION);
        if (bluff) {
          this.recordSelfAction(scope, botId, true);
          return { action: 'call', hand: bluff };
        }
      }
      // Very likely real — try harder to find any viable raise
      if (adjustedP > 0.55) {
        const bluff = this.findBestPlausibleRaise(currentHand, botCards, totalCards, this.BLUFF_TARGET_SELECTION);
        if (bluff) {
          this.recordSelfAction(scope, botId, true);
          return { action: 'call', hand: bluff };
        }
      }
      this.recordSelfAction(scope, botId, false);
      return { action: 'bull' };
    }

    // adjustedP in uncertain zone
    if (desperate) {
      // When desperate, bluff more aggressively to avoid elimination — best survival strategy
      if (Math.random() < bluffFreq * 2.0) {
        const bluff = this.findBestPlausibleRaise(currentHand, botCards, totalCards, this.BLUFF_TARGET_SELECTION);
        if (bluff) {
          this.recordSelfAction(scope, botId, true);
          return { action: 'call', hand: bluff };
        }
      }
    } else if (Math.random() < bluffFreq * 1.0) {
      const bluff = this.findBestPlausibleRaise(currentHand, botCards, totalCards, this.BLUFF_TARGET_SELECTION);
      if (bluff) {
        this.recordSelfAction(scope, botId, true);
        return { action: 'call', hand: bluff };
      }
    }

    // Default: call bull
    this.recordSelfAction(scope, botId, false);
    return { action: 'bull' };
  }

  /**
   * Calling phase when the bot is 1-2 cards from elimination.
   *
   * Fundamentally different EV calculations: losing a card when you have 1 left
   * means elimination. The cost/benefit of every action shifts dramatically.
   *
   * Key insight: playing safe just delays losing. The bot should be more willing
   * to take calculated risks since the downside (getting 1 card) is catastrophic
   * either way.
   */
  private static callingPhaseDesperationBranch(
    currentHand: HandCall,
    botCards: Card[],
    totalCards: number,
    numOpponents: number,
    botId: string,
    higher: HandCall | null,
    adjustedP: number,
    cfg: BotProfileConfig,
    scope: string | undefined,
    ctx: SituationalContext,
  ): BotAction {
    // 1 card from elimination: every wrong call = death. But playing passively
    // means someone else controls our fate.
    // survivalPressure: high = tighter (less bluffing), low = loose (more bluffing)
    // Invert for bias: high survivalPressure → low survivalBias (tighter play)
    const survivalScale = 1.0 - this.SURVIVAL_PRESSURE; // 0=tight, 1=loose
    const survivalBias = ctx.botOneBehind ? 0.15 + survivalScale * 0.3 : 0.08 + survivalScale * 0.15;

    // If we're sure the hand is fake, bull is high EV even when desperate
    if (adjustedP < 0.10) {
      this.recordSelfAction(scope, botId, false);
      return { action: 'bull' };
    }

    // If we have a legitimate higher hand, raise — safer than calling bull
    // on something uncertain and getting penalized
    if (higher) {
      this.recordSelfAction(scope, botId, false);
      return { action: 'call', hand: higher };
    }

    // The hand is uncertain — desperate bots should bluff-raise more aggressively.
    // With a probable hand (adjustedP > 0.35), bluffing over it avoids the risk
    // of calling bull on a real hand (which = elimination).
    const desperateBluffRate = (0.3 + survivalBias) * cfg.bluffFrequency * cfg.aggressionBias;
    if (adjustedP > 0.35 && Math.random() < desperateBluffRate) {
      const bluff = this.findBestPlausibleRaise(currentHand, botCards, totalCards, this.BLUFF_TARGET_SELECTION);
      if (bluff) {
        this.recordSelfAction(scope, botId, true);
        return { action: 'call', hand: bluff };
      }
    }

    // Low-probability hand + desperate = risky bull call, but still better than
    // bluffing with nothing. Scale willingness by how bad the hand looks.
    if (adjustedP < 0.25) {
      this.recordSelfAction(scope, botId, false);
      return { action: 'bull' };
    }

    // In the uncertain zone when desperate: hail mary bluff if personality supports it
    if (Math.random() < survivalBias * cfg.riskTolerance) {
      const bluff = this.findBestPlausibleRaise(currentHand, botCards, totalCards, this.BLUFF_TARGET_SELECTION);
      if (bluff) {
        this.recordSelfAction(scope, botId, true);
        return { action: 'call', hand: bluff };
      }
    }

    // Default: call bull (uncertain hand, no raise available)
    this.recordSelfAction(scope, botId, false);
    return { action: 'bull' };
  }

  /**
   * Calculate opponent desperation adjustment for plausibility.
   *
   * Reads the last caller's desperation state to adjust hand plausibility:
   * - Desperate caller making a normal/conservative call → more likely truthful
   *   (they can't afford to get caught, so they're playing real hands)
   * - Desperate caller making an aggressive raise (big type jump) → possible hail
   *   mary bluff (they know they're losing anyway, might as well gamble)
   */
  private static getOpponentDesperationAdjustment(
    ctx: SituationalContext | null,
    turnHistory: { playerId: string; action: TurnAction; hand?: HandCall }[],
  ): number {
    if (!ctx || !ctx.callerOneBehind) return 0;

    // Check if the last raise was a big jump (3+ hand type levels)
    const calls = turnHistory.filter(e => e.action === TurnAction.CALL && e.hand);
    if (calls.length < 2) {
      // Single call from a desperate player — they're likely truthful
      return 0.08;
    }

    const lastCall = calls[calls.length - 1]!.hand!;
    const prevCall = calls[calls.length - 2]!.hand!;
    const typeJump = lastCall.type - prevCall.type;

    if (typeJump >= 3) {
      // Big jump from a desperate player — possible hail mary bluff
      return -0.06;
    }
    // Conservative raise from desperate player — likely truthful
    return 0.08;
  }

  /**
   * Bull phase: EV decision with position-aware bluff detection.
   *
   * Branches on:
   * - **Response order**: first responder (no signal) vs after seeing bulls
   *   (more confident it's fake) vs after someone called true (strong signal it's real)
   * - **Post-true context**: if someone called true, heavily weight toward true
   *   unless strong evidence otherwise
   * - **Self-desperation**: 1-2 cards from elimination = fundamentally different EV
   * - **Opponent desperation**: desperate callers' claims read differently
   */
  private static handleHardBullPhase(
    currentHand: HandCall,
    botCards: Card[],
    totalCards: number,
    cardCount: number,
    turnHistory: { playerId: string; action: TurnAction; hand?: HandCall }[],
    botId: string,
    lastCallerId: string | null,
    mem: Map<string, OpponentProfile>,
    cfg: BotProfileConfig = DEFAULT_BOT_PROFILE_CONFIG,
    state?: ClientGameState,
    scope?: string,
  ): BotAction {
    // Build situational context
    const ctx = state
      ? this.buildSituationalContext(state, botId, turnHistory)
      : null;

    // Bayesian card beliefs — richer inference from full turn history
    const beliefs = state
      ? this.buildCardBeliefs(turnHistory, botId, state, mem)
      : { rankBeliefs: this.inferCardsFromHistory(turnHistory, botId), chainConsistency: 0.5 };
    const pRaw = this.estimatePlausibilityHard(currentHand, botCards, totalCards, beliefs.rankBeliefs);

    // Impossibility override: if raw probability is near zero, always call bull.
    // No amount of truthfulness boosting can overcome mathematical impossibility.
    if (pRaw < 0.005) {
      return { action: 'bull' };
    }

    // Truthfulness prior with desperation-aware trust and profile multiplier.
    // Scale down in early rounds — fewer cards means less evidence backing claims.
    const callerDespTrust = state ? this.getDesperationTrustFactor(lastCallerId, state) : 1.0;
    const callerDesperateFlag = state !== undefined && callerDespTrust < 1.0;
    const trustFactor = this.getPlayerTrustFactor(lastCallerId, mem, callerDesperateFlag) * cfg.trustMultiplier;
    const cardPoolScale = Math.min(1.0, totalCards / 12);
    const truthBoost = this.getTruthfulnessBoost(currentHand) * trustFactor * callerDespTrust * cardPoolScale;

    // Factor in position and escalation patterns
    // positionAwareness scales position adjustment in bull phase too
    const positionAdj = this.getPositionBluffAdjustment(turnHistory, botId) * (0.5 + this.POSITION_AWARENESS);

    // Position-aware reaction signal: what did other players think?
    const reactionSignal = this.getReactionPositionSignal(turnHistory, botId);

    // Call chain consistency: consistent chains are more believable
    const chainBonus = (beliefs.chainConsistency - 0.5) * 0.12;

    // Counter-bluff detection: was the current hand raised during bull phase?
    const bullPhaseRaisePenalty = this.detectBullPhaseRaise(turnHistory) ? 0.15 : 0;

    // ── Response order signal ────────────────────────────────────────
    // Being the first responder means no social signal — rely on math alone.
    // After seeing others call bull, the bot has confirmation bias toward bull.
    // After seeing someone call true, that's a strong positive signal.
    let responseOrderAdj = 0;
    if (ctx) {
      if (ctx.firstResponder) {
        // No signal from others — slight conservative bias (less certain either way)
        responseOrderAdj = 0;
      } else if (ctx.someoneCalledTrue) {
        // Someone called true — strong signal the hand is real.
        // Weight scales with how many true calls vs bull calls we've seen.
        const trueWeight = ctx.trueCallsBefore / (ctx.trueCallsBefore + ctx.bullCallsBefore);
        responseOrderAdj = trueWeight * 0.15;
      } else if (ctx.bullCallsBefore >= 2) {
        // Multiple people called bull before us — growing confidence it's fake
        responseOrderAdj = -0.05 * Math.min(ctx.bullCallsBefore, 3);
      } else if (ctx.bullCallsBefore === 1) {
        // One person called bull — mild negative signal
        responseOrderAdj = -0.03;
      }
    }

    // Opponent desperation read in bull phase
    const opponentDespAdj = this.getOpponentDesperationAdjustment(ctx, turnHistory);

    let adjustedP = Math.max(0, Math.min(1,
      pRaw + truthBoost - positionAdj + chainBonus + reactionSignal * 0.1
      + responseOrderAdj + opponentDespAdj,
    ));
    adjustedP *= (1 - bullPhaseRaisePenalty);

    // ── Post-true branch ─────────────────────────────────────────────
    // If someone already called true, heavily weight toward calling true as well
    // unless the bot has strong evidence otherwise (very low plausibility).
    if (ctx?.someoneCalledTrue) {
      const postTrueHigher = this.findHandHigherThanFull(botCards, currentHand, totalCards);
      return this.bullPhasePostTrueBranch(adjustedP, pRaw, currentHand, botCards, totalCards, cardCount, botId, postTrueHigher, cfg, scope, ctx);
    }

    // ── Self-desperation branch ──────────────────────────────────────
    // 1-2 cards from elimination: the cost of a wrong bull call is catastrophic.
    if (ctx && (ctx.botOneBehind || ctx.botTwoBehind)) {
      return this.bullPhaseDesperationBranch(adjustedP, currentHand, botCards, totalCards, cardCount, botId, cfg, scope, ctx);
    }

    // Consider raising in bull phase — with a legitimate higher hand
    // headsUpAggression boosts raise rate in 1v1 situations
    const higherHand = this.findHandHigherThanFull(botCards, currentHand, totalCards);
    if (higherHand) {
      if (adjustedP < 0.5) {
        const headsUpBoost = ctx?.isHeadsUp ? 1.0 + this.HEADS_UP_AGGRESSION : 1.0;
        const raiseChance = (cardCount >= 4
          ? cfg.bullPhaseRaiseRate * 1.67
          : cfg.bullPhaseRaiseRate) * headsUpBoost;
        if (Math.random() < raiseChance) {
          this.recordSelfAction(scope, botId, false);
          return { action: 'call', hand: higherHand };
        }
      }
    }

    // ── Bull phase bluff-raise: raise without a legit hand to signal confidence ──
    // This is a new strategic dimension — humans do this to disrupt bull phase dynamics.
    // riskTolerance gates the willingness to attempt this risky play.
    if (!higherHand && this.BULL_PHASE_BLUFF_RATE > 0 && adjustedP > 0.2) {
      const bluffRaiseChance = this.BULL_PHASE_BLUFF_RATE * cfg.riskTolerance;
      if (Math.random() < bluffRaiseChance) {
        const bluffRaise = this.findBestPlausibleRaise(currentHand, botCards, totalCards, this.BLUFF_TARGET_SELECTION);
        if (bluffRaise) {
          this.recordSelfAction(scope, botId, true);
          return { action: 'call', hand: bluffRaise };
        }
      }
    }

    // Asymmetric cost-aware threshold based on card count, shifted by profile bullThreshold
    // cardCountSensitivity: >1.0 = more suspicious (lower threshold) at high card counts
    const bullCardCountOffset = (this.CARD_COUNT_SENSITIVITY - 1.0) * 0.08 * Math.min(1.0, (cardCount - 1) / 3);
    const baseThreshold = this.getDynamicBullThreshold(cardCount);
    const threshold = baseThreshold + (cfg.bullThreshold - 0.5) * 0.15 - bullCardCountOffset;
    const noise = cfg.noiseBand;

    if (adjustedP > threshold + noise) {
      // trueCallConfidence: higher = more eager to lock in true calls
      // At high confidence, the bot commits more readily to true
      const trueBoost = (this.TRUE_CALL_CONFIDENCE - 0.5) * 0.1;
      if (adjustedP > threshold + noise + trueBoost || Math.random() < 0.5 + this.TRUE_CALL_CONFIDENCE * 0.5) {
        return { action: 'true' };
      }
      // Slightly hesitant — fall through to noise band behavior
    }
    if (adjustedP < threshold - noise) {
      return { action: 'bull' };
    }
    // Within noise band — trueCallConfidence biases toward true
    const trueBias = (this.TRUE_CALL_CONFIDENCE - 0.5) * 0.15;
    return Math.random() < (adjustedP + trueBias) ? { action: 'true' } : { action: 'bull' };
  }

  /**
   * Bull phase after someone already called true.
   *
   * A true call is a strong social signal — the caller believes the hand is real
   * and is staking their own cards on it. Unless we have strong mathematical
   * evidence the hand is fake, we should follow suit.
   */
  private static bullPhasePostTrueBranch(
    adjustedP: number,
    pRaw: number,
    currentHand: HandCall,
    botCards: Card[],
    totalCards: number,
    cardCount: number,
    botId: string,
    higher: HandCall | null,
    cfg: BotProfileConfig,
    scope: string | undefined,
    ctx: SituationalContext,
  ): BotAction {
    // Strong mathematical evidence it's fake overrides social signal
    if (pRaw < 0.05) {
      return { action: 'bull' };
    }

    // If we have a legitimate raise, consider it — disrupts the round
    if (higher && adjustedP < 0.5 && Math.random() < cfg.bullPhaseRaiseRate) {
      this.recordSelfAction(scope, botId, false);
      return { action: 'call', hand: higher };
    }

    // Post-true: the bar for calling bull is much higher.
    // Only call bull if plausibility is quite low AND our profile is skeptical.
    const postTrueBullThreshold = 0.25 - (cfg.bullThreshold - 0.5) * 0.15;
    if (adjustedP < postTrueBullThreshold) {
      return { action: 'bull' };
    }

    // Default: follow the true call
    return { action: 'true' };
  }

  /**
   * Bull phase when the bot is 1-2 cards from elimination.
   *
   * Wrong bull call = gaining a card = possibly eliminated. The cost is extreme.
   * But wrong true call on a bluff also costs a card. The key insight: when
   * desperate, the bot should be more decisive (less noise) and lean toward
   * whichever option the math supports more strongly.
   */
  private static bullPhaseDesperationBranch(
    adjustedP: number,
    currentHand: HandCall,
    botCards: Card[],
    totalCards: number,
    cardCount: number,
    botId: string,
    cfg: BotProfileConfig,
    scope: string | undefined,
    ctx: SituationalContext,
  ): BotAction {
    // When 1 card from elimination, reduce noise band — be more decisive
    const desperateNoise = ctx.botOneBehind ? cfg.noiseBand * 0.3 : cfg.noiseBand * 0.6;

    // Consider raising to redirect pressure — desperate bots should raise
    // more often to avoid being the one who gets penalized for bull/true.
    // survivalPressure: high = tighter (less raising), low = loose (more raising)
    const survivalRaiseScale = 1.0 - this.SURVIVAL_PRESSURE * 0.5; // 0.5..1.0
    const higherHand = this.findHandHigherThanFull(botCards, currentHand, totalCards);
    if (higherHand && adjustedP < 0.5) {
      const desperateRaiseChance = (ctx.botOneBehind
        ? cfg.bullPhaseRaiseRate * 2.5 * cfg.aggressionBias
        : cfg.bullPhaseRaiseRate * 1.8 * cfg.aggressionBias) * survivalRaiseScale;
      if (Math.random() < desperateRaiseChance) {
        this.recordSelfAction(scope, botId, false);
        return { action: 'call', hand: higherHand };
      }
    }

    // Use a tighter threshold — desperate bots need clearer signals
    const baseThreshold = this.getDynamicBullThreshold(cardCount);
    const threshold = baseThreshold + (cfg.bullThreshold - 0.5) * 0.15;

    if (adjustedP > threshold + desperateNoise) {
      return { action: 'true' };
    }
    if (adjustedP < threshold - desperateNoise) {
      return { action: 'bull' };
    }
    // Desperate + noise band: bias slightly toward true (wrong bull = elimination)
    // survivalPressure: high = more conservative = stronger true bias when desperate
    // trueCallConfidence also contributes to true bias
    const baseTrueBias = ctx.botOneBehind ? 0.15 : 0.08;
    const survivalTrueBias = baseTrueBias * (0.5 + this.SURVIVAL_PRESSURE * 0.5)
      + (this.TRUE_CALL_CONFIDENCE - 0.5) * 0.1;
    return Math.random() < (adjustedP + survivalTrueBias) ? { action: 'true' } : { action: 'bull' };
  }

  /**
   * Dynamic bull threshold based on bot's card count.
   * More cards = more desperate = higher threshold (more aggressive bull calls).
   * The threshold is compared to adjustedP: if P > threshold → call true.
   * Higher threshold means the bot needs stronger evidence to call true,
   * i.e., it leans toward calling bull.
   */
  private static getDynamicBullThreshold(cardCount: number): number {
    switch (cardCount) {
      case 1: return 0.35;  // Safe position, lean toward "true" (low bar)
      case 2: return 0.42;  // Balanced-safe
      case 3: return 0.48;  // Balanced
      case 4: return 0.55;  // Desperate — aggressively call bull (high bar)
      default: return 0.60; // Max desperation (5+ cards)
    }
  }

  /**
   * Detect if the current hand was raised during bull phase.
   * A CALL action during BULL_PHASE in turnHistory means someone raised in bull phase.
   */
  private static detectBullPhaseRaise(
    turnHistory: { playerId: string; action: TurnAction }[],
  ): boolean {
    // Check if the most recent CALL action came after a BULL or TRUE action
    // This means someone raised during bull phase
    let inBullPhase = false;
    for (const entry of turnHistory) {
      if (entry.action === TurnAction.BULL || entry.action === TurnAction.TRUE) {
        inBullPhase = true;
      }
      if (entry.action === TurnAction.CALL && inBullPhase) {
        return true;
      }
    }
    return false;
  }

  /**
   * Infer cards likely held by other players based on their call history.
   * Returns estimated { rank, count } pairs for ranks likely held by opponents.
   * @deprecated Use buildCardBeliefs for hard mode — this exists for backward compatibility.
   */
  private static inferCardsFromHistory(
    turnHistory: { playerId: string; action: TurnAction; hand?: HandCall }[],
    botId: string,
  ): { rank: Rank; count: number }[] {
    const inferred: Map<Rank, number> = new Map();

    for (const entry of turnHistory) {
      if (entry.playerId === botId) continue;
      if (entry.action !== TurnAction.CALL || !entry.hand) continue;

      const hand = entry.hand;
      switch (hand.type) {
        case HandType.HIGH_CARD:
          inferred.set(hand.rank, (inferred.get(hand.rank) ?? 0) + 1);
          break;
        case HandType.PAIR:
          inferred.set(hand.rank, (inferred.get(hand.rank) ?? 0) + 1);
          break;
        case HandType.THREE_OF_A_KIND:
          inferred.set(hand.rank, (inferred.get(hand.rank) ?? 0) + 1);
          break;
        case HandType.FOUR_OF_A_KIND:
          inferred.set(hand.rank, (inferred.get(hand.rank) ?? 0) + 1);
          break;
        default:
          break;
      }
    }

    const result: { rank: Rank; count: number }[] = [];
    for (const [rank, count] of inferred) {
      result.push({ rank, count: Math.min(count, 2) });
    }
    return result;
  }

  // ─── BAYESIAN CARD BELIEF SYSTEM ──────────────────────────────────────
  // Builds a rich belief state from the full turn history, replacing the
  // simple inferCardsFromHistory with weighted inference that accounts for:
  // - Who called what (with per-player trust weighting)
  // - "True" calls as supporting evidence
  // - Call chain consistency (same rank across raises)
  // - Desperation-based bluff likelihood
  // - Revealed cards from previous round results

  /** Result of Bayesian card belief analysis. */
  private static buildCardBeliefs(
    turnHistory: { playerId: string; action: TurnAction; hand?: HandCall }[],
    botId: string,
    state: ClientGameState,
    mem: Map<string, OpponentProfile>,
  ): { rankBeliefs: { rank: Rank; count: number }[]; chainConsistency: number } {
    const rankWeights = new Map<Rank, number>();

    // 1. Analyze all actions — each provides a signal about card holdings
    for (const entry of turnHistory) {
      if (entry.playerId === botId) continue;

      // Per-player trust weight based on their bluff history
      const callerPlayer = state.players.find(p => p.id === entry.playerId);
      const callerDesperate = callerPlayer !== undefined && callerPlayer.cardCount >= 4;

      // Desperate players are less trustworthy (more likely bluffing)
      const desperationDiscount = callerDesperate ? 0.5 : 1.0;

      // Memory-based trust
      const profile = mem.get(entry.playerId);
      let baseTrust = 0.8; // Default moderate trust for unknown players
      if (profile && profile.totalCalls >= 3) {
        baseTrust = 1.0 - (profile.bluffsCaught / profile.totalCalls);
        // Factor in desperation-specific bluff rate
        if (callerDesperate && (profile.desperationCalls ?? 0) >= 2) {
          const despRate = (profile.desperationBluffs ?? 0) / (profile.desperationCalls ?? 1);
          baseTrust *= (1.0 - despRate * 0.5);
        }
      }

      const weight = desperationDiscount * Math.max(0.1, baseTrust);

      // CALL actions: caller likely holds cards supporting their claim
      if (entry.action === TurnAction.CALL && entry.hand) {
        this.addHandBeliefWeights(entry.hand, rankWeights, weight);
      }

      // TRUE calls: the player believes the hand exists, so they likely hold
      // cards that support it. Weaker signal than a CALL but still informative.
      if (entry.action === TurnAction.TRUE) {
        const lastHand = this.findLastCalledHand(turnHistory, entry);
        if (lastHand) {
          this.addHandBeliefWeights(lastHand, rankWeights, weight * 0.5);
        }
      }
    }

    // 2. Analyze call chain consistency
    const chainConsistency = this.analyzeCallChainConsistency(turnHistory, botId);

    // 3. Convert to output format, capping per rank at 3
    const result: { rank: Rank; count: number }[] = [];
    for (const [rank, w] of rankWeights) {
      result.push({ rank, count: Math.min(w, 3) });
    }

    return { rankBeliefs: result, chainConsistency };
  }

  /**
   * Add belief weight for a hand call's implied card holdings.
   * Different hand types imply different levels of confidence about specific ranks.
   */
  private static addHandBeliefWeights(
    hand: HandCall,
    rankWeights: Map<Rank, number>,
    weight: number,
  ): void {
    switch (hand.type) {
      case HandType.HIGH_CARD:
        rankWeights.set(hand.rank, (rankWeights.get(hand.rank) ?? 0) + weight);
        break;
      case HandType.PAIR:
        // Caller probably holds 1+ of this rank — stronger signal
        rankWeights.set(hand.rank, (rankWeights.get(hand.rank) ?? 0) + weight * 1.2);
        break;
      case HandType.TWO_PAIR:
        rankWeights.set(hand.highRank, (rankWeights.get(hand.highRank) ?? 0) + weight);
        rankWeights.set(hand.lowRank, (rankWeights.get(hand.lowRank) ?? 0) + weight);
        break;
      case HandType.THREE_OF_A_KIND:
        // Strong signal — caller probably holds 1-2 of this rank
        rankWeights.set(hand.rank, (rankWeights.get(hand.rank) ?? 0) + weight * 1.5);
        break;
      case HandType.FOUR_OF_A_KIND:
        rankWeights.set(hand.rank, (rankWeights.get(hand.rank) ?? 0) + weight * 1.5);
        break;
      case HandType.STRAIGHT: {
        // Caller likely holds some of the required ranks
        const highVal = RANK_VALUES[hand.highRank];
        for (let v = highVal - 4; v <= highVal; v++) {
          const actualV = v < 2 ? 14 : v;
          const rank = ALL_RANKS.find(r => RANK_VALUES[r] === actualV);
          if (rank) rankWeights.set(rank, (rankWeights.get(rank) ?? 0) + weight * 0.4);
        }
        break;
      }
      case HandType.FULL_HOUSE:
        rankWeights.set(hand.threeRank, (rankWeights.get(hand.threeRank) ?? 0) + weight * 1.3);
        rankWeights.set(hand.twoRank, (rankWeights.get(hand.twoRank) ?? 0) + weight);
        break;
      default:
        // Flush, straight flush, royal flush — primarily suit-based, rank inference is weak
        break;
    }
  }

  /**
   * Find the last called hand before a given entry in the turn history.
   * Used to determine what hand a TRUE call is supporting.
   */
  private static findLastCalledHand(
    turnHistory: { playerId: string; action: TurnAction; hand?: HandCall }[],
    beforeEntry: { playerId: string; action: TurnAction },
  ): HandCall | null {
    let lastHand: HandCall | null = null;
    for (const entry of turnHistory) {
      if (entry === beforeEntry) break;
      if (entry.action === TurnAction.CALL && entry.hand) {
        lastHand = entry.hand;
      }
    }
    return lastHand;
  }

  /**
   * Analyze the consistency of the call chain (sequence of raises).
   *
   * When multiple players raise on the same rank (pair of 7s → three 7s),
   * the rank is very likely real. When a chain jumps to a completely different
   * rank/type, the latest caller is more suspicious.
   *
   * Returns 0..1 where higher = more consistent (more believable).
   */
  private static analyzeCallChainConsistency(
    turnHistory: { playerId: string; action: TurnAction; hand?: HandCall }[],
    botId: string,
  ): number {
    const calls = turnHistory.filter(
      e => e.action === TurnAction.CALL && e.hand && e.playerId !== botId,
    );
    if (calls.length < 2) return 0.5; // Neutral with insufficient data

    let consistencyScore = 0.5;

    for (let i = 1; i < calls.length; i++) {
      const prev = calls[i - 1]!.hand!;
      const curr = calls[i]!.hand!;

      const prevRank = this.getHandRank(prev);
      const currRank = this.getHandRank(curr);

      if (prevRank && currRank && prevRank === currRank) {
        // Same rank maintained across raises — very consistent, probably real
        consistencyScore += 0.15;
      } else if (curr.type === prev.type && prevRank && currRank) {
        // Same type, different rank — moderate consistency
        consistencyScore += 0.05;
      } else if (curr.type - prev.type >= 3) {
        // Big jump in hand type — suspicious
        consistencyScore -= 0.1;
      } else if (curr.type !== prev.type) {
        // Small type jump — mildly suspicious
        consistencyScore -= 0.03;
      }
    }

    return Math.max(0, Math.min(1, consistencyScore));
  }

  /**
   * Extract the primary rank from a hand call.
   */
  private static getHandRank(hand: HandCall): Rank | null {
    switch (hand.type) {
      case HandType.HIGH_CARD:
      case HandType.PAIR:
      case HandType.THREE_OF_A_KIND:
      case HandType.FOUR_OF_A_KIND:
        return hand.rank;
      case HandType.TWO_PAIR:
        return hand.highRank;
      case HandType.FULL_HOUSE:
        return hand.threeRank;
      default:
        return null;
    }
  }

  // ─── POSITION-AWARE REACTION SIGNAL ───────────────────────────────────

  /**
   * In bull phase, count bull vs true calls from other players before the bot's turn.
   * Returns -1..1: negative = others think the hand is fake, positive = others think it's real.
   * This is a powerful signal: if two players already called "true," the hand is likely real.
   */
  private static getReactionPositionSignal(
    turnHistory: { playerId: string; action: TurnAction }[],
    botId: string,
  ): number {
    let bullCount = 0;
    let trueCount = 0;
    let inBullPhase = false;

    for (const entry of turnHistory) {
      if (entry.action === TurnAction.BULL || entry.action === TurnAction.TRUE) {
        inBullPhase = true;
      }
      if (!inBullPhase) continue;
      if (entry.playerId === botId) continue;

      if (entry.action === TurnAction.BULL) bullCount++;
      if (entry.action === TurnAction.TRUE) trueCount++;
    }

    const total = bullCount + trueCount;
    if (total === 0) return 0;

    // Range -1..1: more true calls = positive, more bull calls = negative
    return (trueCount - bullCount) / total;
  }

  // ─── DESPERATION TRUST FACTOR ──────────────────────────────────────────

  /**
   * Assess how much to trust the caller based on their card count.
   * Desperate players (near elimination) bluff more aggressively.
   *
   * Returns a trust multiplier: 1.0 = normal trust, < 1.0 = reduced trust.
   */
  private static getDesperationTrustFactor(
    callerId: string | null,
    state: ClientGameState,
  ): number {
    if (!callerId) return 1.0;
    const player = state.players.find(p => p.id === callerId);
    if (!player) return 1.0;

    if (player.cardCount >= 4) return 0.6;  // Near elimination — high bluff likelihood
    if (player.cardCount >= 3) return 0.8;  // Getting risky
    return 1.0;
  }

  /**
   * Check if the bot itself is desperate (near elimination).
   */
  private static isBotDesperate(botId: string, state: ClientGameState): boolean {
    const bot = state.players.find(p => p.id === botId);
    return bot !== undefined && bot.cardCount >= state.maxCards - 1;
  }

  // ─── SITUATIONAL CONTEXT BUILDER ──────────────────────────────────────

  /**
   * Build a snapshot of the current situational context for decision branching.
   *
   * This captures all the "what kind of situation am I in?" signals that should
   * shift the bot's base calculations before personality parameters are applied.
   */
  private static buildSituationalContext(
    state: ClientGameState,
    botId: string,
    turnHistory: { playerId: string; action: TurnAction; hand?: HandCall }[],
  ): SituationalContext {
    const currentHandType = state.currentHand?.type ?? null;
    const maxCards = state.maxCards;
    const botPlayer = state.players.find(p => p.id === botId);
    const botCardCount = botPlayer?.cardCount ?? 1;

    // Count calls and position before bot
    let callsBefore = 0;
    let totalRaises = 0;
    for (const entry of turnHistory) {
      if (entry.action === TurnAction.CALL) {
        totalRaises++;
        if (entry.playerId !== botId) callsBefore++;
      }
    }

    // Ceiling proximity
    const atCeiling = currentHandType === HandType.STRAIGHT_FLUSH || currentHandType === HandType.ROYAL_FLUSH;
    const nearCeiling = atCeiling || currentHandType === HandType.FOUR_OF_A_KIND;

    // Self elimination pressure
    const cardsUntilElimination = maxCards - botCardCount;
    const botOneBehind = cardsUntilElimination === 0;
    const botTwoBehind = cardsUntilElimination === 1;

    // Opponent elimination pressure
    const lastCaller = state.lastCallerId
      ? state.players.find(p => p.id === state.lastCallerId)
      : null;
    const callerCardCount = lastCaller?.cardCount ?? null;
    const callerOneBehind = callerCardCount !== null && (maxCards - callerCardCount) === 0;
    const anyOpponentOneBehind = state.players.some(
      p => !p.isEliminated && p.id !== botId && (maxCards - p.cardCount) === 0,
    );

    // Bull phase signals
    let bullCallsBefore = 0;
    let trueCallsBefore = 0;
    let inBullPhase = false;
    for (const entry of turnHistory) {
      if (entry.action === TurnAction.BULL || entry.action === TurnAction.TRUE) {
        inBullPhase = true;
      }
      if (!inBullPhase || entry.playerId === botId) continue;
      if (entry.action === TurnAction.BULL) bullCallsBefore++;
      if (entry.action === TurnAction.TRUE) trueCallsBefore++;
    }

    // Player count
    const activePlayers = state.players.filter(p => !p.isEliminated).length;
    const isHeadsUp = activePlayers === 2;

    return {
      callsBefore,
      totalRaises,
      currentHandType,
      atCeiling,
      nearCeiling,
      botCardCount,
      maxCards,
      cardsUntilElimination,
      botOneBehind,
      botTwoBehind,
      callerCardCount,
      callerOneBehind,
      anyOpponentOneBehind,
      activePlayers,
      isHeadsUp,
      bullCallsBefore,
      trueCallsBefore,
      someoneCalledTrue: trueCallsBefore > 0,
      firstResponder: bullCallsBefore === 0 && trueCallsBefore === 0,
    };
  }

  // ─── TABLE IMAGE / META-STRATEGY ──────────────────────────────────────

  /** Get self-image for a bot, creating if needed. */
  private static getSelfImage(key: string): BotSelfImage {
    let img = this.selfImageMap.get(key);
    if (!img) {
      img = { recentBluffs: [], roundsSinceCaught: 99 };
      this.selfImageMap.set(key, img);
    }
    return img;
  }

  /**
   * Get a bluff frequency adjustment based on the bot's own recent play history.
   *
   * After a streak of honest calls → increase bluff frequency (opponents trust us now).
   * After getting caught bluffing → tighten up for a few rounds.
   * Random variation prevents predictability.
   *
   * Returns a multiplier adjustment: positive = bluff more, negative = bluff less.
   */
  private static getTableImageBluffAdjustment(scope: string | undefined, botId: string): number {
    if (!scope) return 0;
    const key = `${scope}:${botId}`;
    const img = this.getSelfImage(key);

    if (img.recentBluffs.length < 2) return 0; // Not enough history

    const recentHonest = img.recentBluffs.filter(b => !b).length;
    const recentBluffs = img.recentBluffs.filter(b => b).length;

    let adjustment = 0;

    // After a streak of honest calls, increase bluff frequency
    if (recentHonest >= 3 && recentBluffs <= 1) {
      adjustment += 0.15;
    }

    // After getting caught recently, tighten up
    if (img.roundsSinceCaught <= 1) {
      adjustment -= 0.20;
    } else if (img.roundsSinceCaught <= 2) {
      adjustment -= 0.10;
    }

    return adjustment;
  }

  /**
   * Record the bot's own action for table image tracking.
   */
  private static recordSelfAction(scope: string | undefined, botId: string, wasBluff: boolean): void {
    if (!scope) return;
    const key = `${scope}:${botId}`;
    const img = this.getSelfImage(key);
    img.recentBluffs.push(wasBluff);
    if (img.recentBluffs.length > 8) img.recentBluffs.shift();
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
    bluffTargetSelection: number = BotPlayer.BLUFF_TARGET_SELECTION,
  ): HandCall | null {
    const candidates: { hand: HandCall; semiBluff: boolean }[] = [];
    const rankCounts = this.getRankCounts(ownCards);

    // Generate candidates across hand types that are higher than current

    // High card bluffs — call a rank we don't hold (semi-bluff if we hold an adjacent rank)
    if (currentHand.type <= HandType.HIGH_CARD) {
      for (const rank of ALL_RANKS) {
        const hand: HandCall = { type: HandType.HIGH_CARD, rank };
        if (isHigherHand(hand, currentHand)) {
          const hasRank = rankCounts.has(rank);
          if (!hasRank) {
            // True bluff — we don't hold this rank. Semi-bluff if we hold an adjacent rank.
            const rankVal = RANK_VALUES[rank];
            const hasAdjacent = ALL_RANKS.some(r => rankCounts.has(r) && Math.abs(RANK_VALUES[r] - rankVal) === 1);
            candidates.push({ hand, semiBluff: hasAdjacent });
          }
        }
      }
    }

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
          const [a, b] = RANK_VALUES[heldRanks[i]!] > RANK_VALUES[heldRanks[j]!]
            ? [heldRanks[i]!, heldRanks[j]!]
            : [heldRanks[j]!, heldRanks[i]!];
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
    // bluffTargetSelection controls the escalation penalty:
    //   low (0.0) = strong penalty for big jumps (safe, incremental bluffs)
    //   high (1.0) = weak penalty (ambitious, big hand-type jumps)
    const escalationBase = 0.98 - (1.0 - bluffTargetSelection) * 0.16; // 0.82 at 0.0, 0.98 at 1.0
    let best: HandCall | null = null;
    let bestScore = -1;
    for (const { hand, semiBluff } of candidates) {
      const plausibility = this.estimatePlausibilityHard(hand, ownCards, totalCards);
      const semiBluffBonus = semiBluff ? 1.3 : 1.0;
      // Penalize big jumps: each hand type above current costs (2-18)% based on bluffTargetSelection
      const typeGap = hand.type - currentHand.type;
      const escalationFactor = Math.pow(escalationBase, Math.max(0, typeGap - 1));
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
      let bestRank: Rank = cards[0]!.rank;
      for (const c of cards) {
        if (RANK_VALUES[c.rank] > RANK_VALUES[bestRank]) {
          bestRank = c.rank;
        }
      }
      return { type: HandType.HIGH_CARD, rank: bestRank };
    }

    return null;
  }

  // ─── HAND FINDING (FULL) ─────────────────────────────────────────────

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
      const threeRank = triples.sort((a, b) => RANK_VALUES[b] - RANK_VALUES[a])[0]!;
      const twoRank = pairs.length > 0
        ? pairs.sort((a, b) => RANK_VALUES[b] - RANK_VALUES[a])[0]!
        : triples.filter(r => r !== threeRank)[0];
      if (twoRank) return { type: HandType.FULL_HOUSE, threeRank, twoRank };
    }

    // Three of a kind
    if (triples.length > 0) {
      const rank = triples.sort((a, b) => RANK_VALUES[b] - RANK_VALUES[a])[0]!;
      return { type: HandType.THREE_OF_A_KIND, rank };
    }

    // Flush — check if we have 5 of a suit (unlikely with few cards, but check)
    for (const [suit, count] of suitCounts) {
      if (count >= 5) return { type: HandType.FLUSH, suit };
    }

    // Two pair
    if (pairs.length >= 2 || (pairs.length >= 1 && triples.length >= 1)) {
      const allPairs = [...pairs, ...triples].sort((a, b) => RANK_VALUES[b] - RANK_VALUES[a]);
      return { type: HandType.TWO_PAIR, highRank: allPairs[0]!, lowRank: allPairs[1]! };
    }

    // Pair
    if (pairs.length > 0) {
      const rank = pairs.sort((a, b) => RANK_VALUES[b] - RANK_VALUES[a])[0]!;
      return { type: HandType.PAIR, rank };
    }

    // High card
    if (cards.length > 0) {
      let bestRank: Rank = cards[0]!.rank;
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
            highRank: pairRanks[i]!,
            lowRank: pairRanks[j]!,
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

  /**
   * Public estimatePlausibility using hypergeometric-approximation math.
   * Delegates to the full plausibility estimator without inferred cards.
   */
  static estimatePlausibility(hand: HandCall, ownCards: Card[], totalCards: number): number {
    return this.estimatePlausibilityHard(hand, ownCards, totalCards);
  }

  // ─── PLAUSIBILITY ──────────────────────────────────────────────────

  /**
   * Hypergeometric-approximation plausibility estimation.
   * Probability estimates using number of cards seen vs remaining.
   * Optional inferredCards adjusts the unseen pool based on call history analysis.
   */
  private static estimatePlausibilityHard(
    hand: HandCall,
    ownCards: Card[],
    totalCards: number,
    inferredCards?: { rank: Rank; count: number }[],
  ): number {
    const otherCards = totalCards - ownCards.length;
    const deckSize = 52;
    const unseenCards = deckSize - ownCards.length;

    // Helper: get inferred count for a specific rank (cards likely held by opponents)
    const getInferred = (rank: Rank): number => {
      if (!inferredCards) return 0;
      const entry = inferredCards.find(e => e.rank === rank);
      return entry ? entry.count : 0;
    };

    switch (hand.type) {
      case HandType.HIGH_CARD: {
        // 4 copies of the rank in the deck; how many do we have?
        const ownCount = ownCards.filter(c => c.rank === hand.rank).length;
        if (ownCount >= 1) return 0.98;
        const inferCount = getInferred(hand.rank);
        // If other players called this rank, it's more likely to exist
        if (inferCount > 0) return 0.98;
        const remaining = 4 - ownCount;
        const pNone = this.hypergeomNone(unseenCards, remaining, otherCards);
        return 1 - pNone;
      }

      case HandType.PAIR: {
        const ownCount = ownCards.filter(c => c.rank === hand.rank).length;
        if (ownCount >= 2) return 0.98;
        const inferCount = getInferred(hand.rank);
        // Adjust remaining copies down by inferred (they're accounted for)
        const effectiveOwn = Math.min(ownCount + inferCount, 4);
        if (effectiveOwn >= 2) return 0.95;
        const remaining = 4 - effectiveOwn;
        const needed = 2 - effectiveOwn;
        if (needed <= 0) return 0.95;
        return this.hypergeomAtLeast(unseenCards - inferCount, remaining, otherCards - inferCount, needed);
      }

      case HandType.TWO_PAIR: {
        if (totalCards < 4) return 0.01;
        const highRank = (hand as { highRank: Rank }).highRank;
        const lowRank = (hand as { lowRank: Rank }).lowRank;
        const highOwn = ownCards.filter(c => c.rank === highRank).length;
        const lowOwn = ownCards.filter(c => c.rank === lowRank).length;
        const highInfer = getInferred(highRank);
        const lowInfer = getInferred(lowRank);
        const highEff = Math.min(highOwn + highInfer, 4);
        const lowEff = Math.min(lowOwn + lowInfer, 4);
        const pHigh = highEff >= 2 ? 0.98 : this.hypergeomAtLeast(unseenCards, 4 - highEff, otherCards, Math.max(0, 2 - highEff));
        const pLow = lowEff >= 2 ? 0.98 : this.hypergeomAtLeast(unseenCards, 4 - lowEff, otherCards, Math.max(0, 2 - lowEff));
        return pHigh * pLow;
      }

      case HandType.THREE_OF_A_KIND: {
        const ownCount = ownCards.filter(c => c.rank === hand.rank).length;
        if (ownCount >= 3) return 0.98;
        const inferCount = getInferred(hand.rank);
        const effectiveOwn = Math.min(ownCount + inferCount, 4);
        if (effectiveOwn >= 3) return 0.90;
        const remaining = 4 - effectiveOwn;
        const needed = 3 - effectiveOwn;
        if (needed <= 0) return 0.90;
        return this.hypergeomAtLeast(unseenCards, remaining, otherCards, needed);
      }

      case HandType.FLUSH: {
        const suit = (hand as { type: HandType.FLUSH; suit: Suit }).suit;
        const ownSuitCount = ownCards.filter(c => c.suit === suit).length;
        if (ownSuitCount >= 5) return 0.95;
        const remaining = 13 - ownSuitCount;
        const needed = 5 - ownSuitCount;
        if (needed <= 0) return 0.95;
        // If opponents can't possibly hold enough suited cards, impossible
        if (needed > otherCards) return 0.0;
        const baseP = this.hypergeomAtLeast(unseenCards, remaining, otherCards, needed);
        // Pigeonhole clamps: with enough total cards, *some* flush almost certainly
        // exists — but scale clamp by bot's own suit contribution. When we hold 0
        // of the called suit, the clamp should be much weaker since the pigeonhole
        // reasoning applies to "any suit" not this specific one.
        const suitContribution = Math.min(1.0, ownSuitCount / 2); // 0..1 based on own suit cards
        const clampScale = 0.3 + 0.7 * suitContribution; // 0.3 at 0 own cards, 1.0 at 2+
        if (totalCards >= 20) return Math.max(baseP, 0.85 * clampScale);
        if (totalCards >= 15) return Math.max(baseP, 0.70 * clampScale);
        if (totalCards >= 10) return Math.max(baseP, 0.45 * clampScale);
        return baseP;
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
      const rank = ALL_RANKS[Math.floor(Math.random() * 8) + 5]!; // 7 through A
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
      return { type: HandType.FLUSH, suit: ALL_SUITS[Math.floor(Math.random() * 4)]! };
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
      // Strategic opening: mix of high card bluffs and pair bluffs.
      // In early rounds with few cards, pairs are the strongest bluff because
      // opponents can't disprove them easily — always prefer pairs over high cards.
      if (totalCards >= 8) {
        // With many total cards, 30% high card bluff, 70% pair bluff
        if (Math.random() < 0.3) {
          const highRanks: Rank[] = ['10', 'J', 'Q', 'K', 'A'];
          const rank = highRanks[Math.floor(Math.random() * highRanks.length)]!;
          return { type: HandType.HIGH_CARD, rank };
        }
        const midRanks: Rank[] = ['7', '8', '9', '10', 'J'];
        const rank = midRanks[Math.floor(Math.random() * midRanks.length)]!;
        return { type: HandType.PAIR, rank };
      }
      // Few total cards: bluff pairs 65% of the time, high cards 35%
      if (Math.random() < 0.65) {
        const pairRanks: Rank[] = ['7', '8', '9', '10', 'J', 'Q', 'K'];
        const rank = pairRanks[Math.floor(Math.random() * pairRanks.length)]!;
        return { type: HandType.PAIR, rank };
      }
      const rank = ALL_RANKS[Math.floor(Math.random() * 6) + 7]!; // 9 through A
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
      return { type: HandType.FLUSH, suit: ALL_SUITS[Math.floor(Math.random() * 4)]! };
    }

    if (currentHand.type === HandType.TWO_PAIR) {
      return { type: HandType.FLUSH, suit: ALL_SUITS[Math.floor(Math.random() * 4)]! };
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
    return valid[0] ?? null;
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
        // Rank is primary, suit is tiebreaker (matching isHigherHand comparison order)
        return RANK_VALUES[hand.highRank] * 100 + SUIT_ORDER[hand.suit];
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
