/**
 * Bot profiles with distinct playstyles for ranked matchmaking.
 *
 * Each profile tunes the existing BotPlayer decision logic via a config object.
 * When no config is provided, BotPlayer falls back to its current hardcoded
 * thresholds — zero regression.
 */

// ── Profile config type ─────────────────────────────────────────────────

/**
 * Tunable parameters that override hardcoded thresholds in BotPlayer's
 * hard-mode decision logic. Every field is optional — omitted fields
 * fall back to the existing default values.
 */
export interface BotProfileConfig {
  /** How often the bot bluffs when it doesn't have a legitimate hand (0.0–1.0).
   *  Scales the GTO bluff frequency multiplier. Default ~1.0 (standard GTO). */
  bluffFrequency: number;

  /** How suspicious the bot is before calling bull (0.0–1.0).
   *  Lower = calls bull more aggressively. Maps to dynamic bull threshold offsets. */
  bullThreshold: number;

  /** Willingness to make big hand-type jumps when raising (0.0–1.0).
   *  Higher = prefers larger jumps over safe incremental raises. */
  riskTolerance: number;

  /** Preference for raising vs calling bull/true in uncertain situations (0.0–1.0).
   *  Higher = more likely to raise instead of calling bull. */
  aggressionBias: number;

  /** How often the bot raises in last-chance phase vs passing (0.0–1.0).
   *  Higher = more willing to raise when everyone called bull. */
  lastChanceBluffRate: number;

  /** Opening bluff frequency (0.0–1.0). Overrides the 8% base in hard mode. */
  openingBluffRate: number;

  /** Bull-phase raise frequency when the bot has a higher hand (0.0–1.0).
   *  Overrides the 15%/25% base raise chances. */
  bullPhaseRaiseRate: number;

  /** Trust factor multiplier for opponent memory (0.0–2.0).
   *  Higher = trusts callers more, lower = more skeptical of all claims. */
  trustMultiplier: number;

  /** Plausibility gate for bluff hands (0.0–1.0).
   *  Only bluffs hands with plausibility above this threshold. */
  bluffPlausibilityGate: number;

  /** Noise band width for bull/true threshold decisions (0.0–0.2).
   *  Wider = more random decisions near the threshold. */
  noiseBand: number;
}

// ── Flavor text ─────────────────────────────────────────────────────────

/** Short quips for different game actions, displayed in the UI. */
export interface BotFlavorText {
  /** Said when calling bull on another player. */
  callBull: string[];
  /** Said when the bot gets caught bluffing. */
  caughtBluffing: string[];
  /** Said when the bot wins a round. */
  winRound: string[];
  /** Said when the bot makes a big raise. */
  bigRaise: string[];
  /** Said when the bot is eliminated. */
  eliminated: string[];
}

// ── Profile definition ──────────────────────────────────────────────────

export interface BotProfileDefinition {
  /** Unique key used in the database `bot_profile` column. */
  key: string;
  /** Display name shown in game (also the bot's username). */
  name: string;
  /** Short personality description for the UI. */
  personality: string;
  /** Decision parameter overrides for BotPlayer. */
  config: BotProfileConfig;
  /** In-character quips for various game events. */
  flavorText: BotFlavorText;
}

// ── Default config (matches current hard-mode behavior exactly) ─────────

export const DEFAULT_BOT_PROFILE_CONFIG: Readonly<BotProfileConfig> = {
  bluffFrequency: 1.0,
  bullThreshold: 0.5,
  riskTolerance: 0.5,
  aggressionBias: 0.5,
  lastChanceBluffRate: 0.4,
  openingBluffRate: 0.08,
  bullPhaseRaiseRate: 0.15,
  trustMultiplier: 1.0,
  bluffPlausibilityGate: 0.3,
  noiseBand: 0.05,
};

// ── Profile definitions ─────────────────────────────────────────────────

export const BOT_PROFILES: readonly BotProfileDefinition[] = [
  {
    key: 'the_rock',
    name: 'The Rock',
    personality: 'Ultra-conservative. Almost never bluffs. Only calls bull when very confident.',
    config: {
      bluffFrequency: 0.15,
      bullThreshold: 0.7,
      riskTolerance: 0.15,
      aggressionBias: 0.2,
      lastChanceBluffRate: 0.1,
      openingBluffRate: 0.02,
      bullPhaseRaiseRate: 0.05,
      trustMultiplier: 1.3,
      bluffPlausibilityGate: 0.5,
      noiseBand: 0.03,
    },
    flavorText: {
      callBull: ['I\'ve done the math.', 'Not buying it.', 'The numbers don\'t lie.'],
      caughtBluffing: ['...that was uncharacteristic.', 'Won\'t happen again.'],
      winRound: ['Patience pays.', 'Steady wins the race.'],
      bigRaise: ['I have what I have.', 'Read it and weep.'],
      eliminated: ['A rare miscalculation.', 'Back to the drawing board.'],
    },
  },
  {
    key: 'maverick',
    name: 'Maverick',
    personality: 'Aggressive bluffer. High bull call rate. Plays fast and loose.',
    config: {
      bluffFrequency: 1.8,
      bullThreshold: 0.3,
      riskTolerance: 0.85,
      aggressionBias: 0.85,
      lastChanceBluffRate: 0.75,
      openingBluffRate: 0.2,
      bullPhaseRaiseRate: 0.35,
      trustMultiplier: 0.6,
      bluffPlausibilityGate: 0.15,
      noiseBand: 0.08,
    },
    flavorText: {
      callBull: ['BULL! No way!', 'You\'re bluffing and we both know it.', 'Nice try, pal.'],
      caughtBluffing: ['Worth the shot!', 'You win some, you lose some.', 'I regret nothing.'],
      winRound: ['Too easy!', 'Who\'s the maverick now?', 'Never in doubt.'],
      bigRaise: ['Go big or go home!', 'Feeling lucky?', 'Top that!'],
      eliminated: ['Flame out in style!', 'At least it was exciting.'],
    },
  },
  {
    key: 'the_grinder',
    name: 'The Grinder',
    personality: 'Minimal risk. Prefers small incremental raises. Wins by patience.',
    config: {
      bluffFrequency: 0.5,
      bullThreshold: 0.55,
      riskTolerance: 0.1,
      aggressionBias: 0.55,
      lastChanceBluffRate: 0.3,
      openingBluffRate: 0.04,
      bullPhaseRaiseRate: 0.1,
      trustMultiplier: 1.1,
      bluffPlausibilityGate: 0.4,
      noiseBand: 0.04,
    },
    flavorText: {
      callBull: ['Doesn\'t add up.', 'I\'ll take that bet.', 'Calling it.'],
      caughtBluffing: ['Rare misstep.', 'Adjusting...'],
      winRound: ['Slow and steady.', 'Another one in the bag.'],
      bigRaise: ['Small steps forward.', 'Just a little bump.'],
      eliminated: ['Variance happens.', 'The grind continues next time.'],
    },
  },
  {
    key: 'wildcard',
    name: 'Wildcard',
    personality: 'Unpredictable. Random-feeling mix of strategies. Keeps opponents guessing.',
    config: {
      bluffFrequency: 1.2,
      bullThreshold: 0.45,
      riskTolerance: 0.7,
      aggressionBias: 0.6,
      lastChanceBluffRate: 0.55,
      openingBluffRate: 0.15,
      bullPhaseRaiseRate: 0.25,
      trustMultiplier: 0.8,
      bluffPlausibilityGate: 0.2,
      noiseBand: 0.15,
    },
    flavorText: {
      callBull: ['BULL!', 'Nah.', 'Hmm... nope!', 'My gut says no.'],
      caughtBluffing: ['Oops!', 'Chaos is a ladder.', 'Part of the plan!'],
      winRound: ['Calculated chaos!', 'Even I didn\'t see that coming.'],
      bigRaise: ['Surprise!', 'Why not?', 'Let\'s spice things up!'],
      eliminated: ['What a ride!', 'Chaos has its costs.'],
    },
  },
  {
    key: 'the_professor',
    name: 'The Professor',
    personality: 'Probability-optimal. Closest to theoretically correct play.',
    config: {
      bluffFrequency: 1.0,
      bullThreshold: 0.5,
      riskTolerance: 0.45,
      aggressionBias: 0.5,
      lastChanceBluffRate: 0.4,
      openingBluffRate: 0.08,
      bullPhaseRaiseRate: 0.15,
      trustMultiplier: 1.0,
      bluffPlausibilityGate: 0.3,
      noiseBand: 0.03,
    },
    flavorText: {
      callBull: ['Statistically improbable.', 'The odds are against you.', 'P < 0.05.'],
      caughtBluffing: ['An acceptable deviation.', 'Even optimal play has variance.'],
      winRound: ['As expected.', 'QED.', 'The math checks out.'],
      bigRaise: ['By the numbers.', 'Bayesian update complete.'],
      eliminated: ['An unlikely sequence of events.', 'Recalibrating...'],
    },
  },
  {
    key: 'shark',
    name: 'Shark',
    personality: 'Reads opponents heavily. Adjusts strategy based on opponent memory.',
    config: {
      bluffFrequency: 0.9,
      bullThreshold: 0.45,
      riskTolerance: 0.55,
      aggressionBias: 0.6,
      lastChanceBluffRate: 0.45,
      openingBluffRate: 0.1,
      bullPhaseRaiseRate: 0.2,
      trustMultiplier: 1.5,
      bluffPlausibilityGate: 0.25,
      noiseBand: 0.04,
    },
    flavorText: {
      callBull: ['I\'ve seen your pattern.', 'You always do this.', 'Predictable.'],
      caughtBluffing: ['Investing in the read.', 'Building my image.'],
      winRound: ['Right on schedule.', 'I had you figured.'],
      bigRaise: ['Your move.', 'Think carefully.'],
      eliminated: ['Even sharks get caught sometimes.', 'I\'ll remember this.'],
    },
  },
  {
    key: 'loose_cannon',
    name: 'Loose Cannon',
    personality: 'Loves big hand-type jumps. Goes for straights and full houses early.',
    config: {
      bluffFrequency: 1.5,
      bullThreshold: 0.4,
      riskTolerance: 0.95,
      aggressionBias: 0.8,
      lastChanceBluffRate: 0.65,
      openingBluffRate: 0.18,
      bullPhaseRaiseRate: 0.3,
      trustMultiplier: 0.7,
      bluffPlausibilityGate: 0.1,
      noiseBand: 0.1,
    },
    flavorText: {
      callBull: ['No chance!', 'BULL! Fight me!', 'Yeah right.'],
      caughtBluffing: ['Go big or go home!', 'No regrets!', 'Had to try.'],
      winRound: ['BOOM!', 'That just happened!', 'Unstoppable!'],
      bigRaise: ['Full house, baby!', 'Straight to the top!', 'All in on this!'],
      eliminated: ['Went out with a bang!', 'At least I made it interesting.'],
    },
  },
  {
    key: 'ice_queen',
    name: 'Ice Queen',
    personality: 'Very tight player. Rarely acts unless the math is strongly in her favor.',
    config: {
      bluffFrequency: 0.25,
      bullThreshold: 0.65,
      riskTolerance: 0.2,
      aggressionBias: 0.25,
      lastChanceBluffRate: 0.15,
      openingBluffRate: 0.03,
      bullPhaseRaiseRate: 0.08,
      trustMultiplier: 1.2,
      bluffPlausibilityGate: 0.45,
      noiseBand: 0.02,
    },
    flavorText: {
      callBull: ['I don\'t think so.', 'Cold read: you\'re lying.', 'Not a chance.'],
      caughtBluffing: ['...', 'Noted.'],
      winRound: ['Obviously.', 'As I calculated.', 'Clean.'],
      bigRaise: ['When I move, I move.', 'Worth the wait.'],
      eliminated: ['Suboptimal.', 'Ice melts eventually.'],
    },
  },
] as const;

/** Map from profile key to profile definition for O(1) lookup. */
export const BOT_PROFILE_MAP: ReadonlyMap<string, BotProfileDefinition> = new Map(
  BOT_PROFILES.map(p => [p.key, p]),
);

/** All valid profile keys. */
export const BOT_PROFILE_KEYS: readonly string[] = BOT_PROFILES.map(p => p.key);
