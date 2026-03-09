/**
 * Bot profile system: 9 personalities × 9 levels = 81 distinct bots.
 *
 * Each personality has a distinct strategic profile (e.g., bluffs aggressively,
 * plays tight/conservative, is erratic, reads opponents). Level controls the
 * skill/accuracy of the decision-making parameters (lvl9 = current Hard bot,
 * lvl1 = easiest). Personality controls strategic tendencies and style.
 *
 * Naming format: `{Personality} lvl{N}` — e.g., "Professor lvl3", "Bluffer lvl9"
 */

// ── Profile config type ─────────────────────────────────────────────────

/**
 * Tunable parameters that override hardcoded thresholds in BotPlayer's
 * hard-mode decision logic. Every field is optional — omitted fields
 * fall back to the existing default values.
 */
export interface BotProfileConfig {
  /** How often the bot bluffs when it doesn't have a legitimate hand (0.0–2.0).
   *  Scales the GTO bluff frequency multiplier. Default ~1.3 (standard GTO + 30%). */
  bluffFrequency: number;

  /** How suspicious the bot is before calling bull (0.0–1.0).
   *  Lower = calls bull more aggressively. Maps to dynamic bull threshold offsets. */
  bullThreshold: number;

  /** Willingness to take calculated risks across all decision phases (0.0–1.0).
   *  Affects bluff-raise attempts, desperate plays, uncertain-zone decisions,
   *  and bull-phase raise willingness. Higher = bolder play. */
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
   *  Scales the continuous trust score (not just coarse buckets).
   *  Higher = trusts callers more, lower = more skeptical of all claims. */
  trustMultiplier: number;

  // ── Card count awareness ──────────────────────────────────────────
  /** How much card count affects both bluffing and bull-calling (0.0–2.0).
   *  >1.0 = more reactive to card counts (bluff more + bull more at high counts).
   *  <1.0 = less reactive. Default 1.0 (neutral). Replaces separate bluff/bull adjusts. */
  cardCountSensitivity: number;

  // ── Game state awareness ──────────────────────────────────────────
  /** How much more aggressive the bot gets in 1v1 situations (0.0–1.0).
   *  Higher = significantly more aggressive when only 2 players remain. Default 0.5. */
  headsUpAggression: number;
  /** How much the bot tightens up near elimination vs plays loose when safe (0.0–1.0).
   *  Higher = plays tighter near elimination, looser with a lead. Default 0.5. */
  survivalPressure: number;

  // ── Decision refinement ───────────────────────────────────────────
  /** When bluffing a raise, preference for safe vs ambitious bluffs (0.0–1.0).
   *  Low = barely-above-current hand, high = big hand-type jumps. Default 0.5. */
  bluffTargetSelection: number;
  /** How much the bot adjusts based on turn order position (0.0–1.0).
   *  Higher = tighter early, more aggressive late. Default 0.5. */
  positionAwareness: number;
  /** Eagerness to call true when the bot believes the claim (0.0–1.0).
   *  Separate from bullThreshold — governs the "I believe you" decision. Default 0.5. */
  trueCallConfidence: number;

  // ── New high-impact parameters ────────────────────────────────────
  /** Rate of counter-bluffing: raising over a hand the bot thinks is fake (0.0–1.0).
   *  Instead of always calling bull on suspected bluffs, sometimes raise over them.
   *  This exploits opponents who call bull reflexively. Default 0.2. */
  counterBluffRate: number;
  /** Bluff-raise rate in bull phase even without a legitimate hand (0.0–1.0).
   *  Allows bluff-raising in bull phase to signal false confidence. Default 0.0. */
  bullPhaseBluffRate: number;
  /** Opening hand type preference (0.0–1.0).
   *  Low = prefer high card openings, high = prefer pairs+ when available.
   *  Controls the ratio of conservative vs aggressive opening calls. Default 0.5. */
  openingHandTypePreference: number;
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
  /** Emoji avatar for this bot personality. Not available to human users. */
  avatar: string;
  /** Decision parameter overrides for BotPlayer. */
  config: BotProfileConfig;
  /** In-character quips for various game events. */
  flavorText: BotFlavorText;
}

// ── Default config (matches current hard-mode behavior exactly) ─────────

export const DEFAULT_BOT_PROFILE_CONFIG: Readonly<BotProfileConfig> = {
  bluffFrequency: 0.3,           // Evolved: 0.0 — GTO bluff path is suboptimal
  bullThreshold: 0.55,           // Evolved: 0.56 — slightly more trusting
  riskTolerance: 0.65,           // Evolved: 0.99 — bolder play wins
  aggressionBias: 0.35,          // Evolved: 0.30 — prefer bull calls over raises
  lastChanceBluffRate: 0.4,
  openingBluffRate: 0.40,        // Evolved: 0.57 — opening bluffs hide info
  bullPhaseRaiseRate: 0.18,
  trustMultiplier: 1.1,          // Evolved: 1.21 — slightly trusting
  cardCountSensitivity: 0.3,     // Evolved: 0.05 — reactivity is exploitable
  headsUpAggression: 0.6,        // Evolved: 0.68 — more aggressive heads-up
  survivalPressure: 0.45,        // Evolved: 0.40
  bluffTargetSelection: 0.45,    // Evolved: 0.46
  positionAwareness: 0.45,       // Evolved: 0.42
  trueCallConfidence: 0.8,       // Evolved: 1.0 — decisive true calls
  counterBluffRate: 0.4,         // Evolved: 0.62 — counter-bluffing is key
  bullPhaseBluffRate: 0.3,       // Evolved: 0.75 — massively underutilized before
  openingHandTypePreference: 0.35, // Evolved: 0.26 — hide info at opening
};

// ── Personality base definitions (level 9 = full personality expression) ─

/**
 * Base personality definition — describes a personality's strategic profile
 * at maximum skill (level 9). Lower levels degrade toward a noisy default.
 */
interface PersonalityBase {
  /** Unique key prefix, used as `{key}_lvl{N}` in database. */
  key: string;
  /** Personality display name. Bot name = `{name} lvl{N}`. */
  name: string;
  personality: string;
  avatar: string;
  /** Level 9 config — the full expression of this personality at max skill. */
  config: BotProfileConfig;
  flavorText: BotFlavorText;
}

/** The 9 base personalities. Level 9 config = current Hard bot parameterization. */
const PERSONALITY_BASES: readonly PersonalityBase[] = [
  {
    key: 'rock',
    name: 'Rock',
    personality: 'Ultra-conservative. Almost never bluffs. Only calls bull when very confident.',
    avatar: '\u{1FAA8}',
    config: {
      bluffFrequency: 0.15,        // Evolved: ~0 — Rock barely uses GTO bluff path
      bullThreshold: 0.65,         // Slightly more trusting than before (evolved: 0.56)
      riskTolerance: 0.25,         // Still conservative but bolder (evolved: 0.99)
      aggressionBias: 0.2,
      lastChanceBluffRate: 0.2,
      openingBluffRate: 0.15,
      bullPhaseRaiseRate: 0.08,
      trustMultiplier: 1.25,
      cardCountSensitivity: 0.3,   // Evolved: ~0 — reactivity is exploitable in 1v1
      headsUpAggression: 0.4,      // Slightly more aggressive heads-up (evolved: 0.68)
      survivalPressure: 0.7,       // Still tight near elimination but less extreme
      bluffTargetSelection: 0.2,   // Safe, barely-above bluffs when forced to bluff
      positionAwareness: 0.6,      // Moderate position awareness
      trueCallConfidence: 0.85,    // Evolved: 1.0 — decisive true calls are strong
      counterBluffRate: 0.15,      // Rock should counter-bluff occasionally (evolved: 0.62)
      bullPhaseBluffRate: 0.1,     // Evolved: 0.75 — even Rock benefits from some
      openingHandTypePreference: 0.55, // Less info-leaky than pure pair preference
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
    key: 'bluffer',
    name: 'Bluffer',
    personality: 'Aggressive bluffer. High bull call rate. Plays fast and loose.',
    avatar: '\u{1F920}',
    config: {
      bluffFrequency: 0.6,         // Evolved: 0 — drastically reduced GTO bluffing
      bullThreshold: 0.35,         // Still aggressive bull-caller
      riskTolerance: 0.9,          // Very bold (evolved: 0.99)
      aggressionBias: 0.5,         // Reduced — evolved: 0.30, less raise-happy
      lastChanceBluffRate: 0.65,
      openingBluffRate: 0.50,      // Still high opening bluffs (evolved: 0.57)
      bullPhaseRaiseRate: 0.35,
      trustMultiplier: 0.7,
      cardCountSensitivity: 0.3,   // Evolved: ~0 — drop reactivity significantly
      headsUpAggression: 0.8,      // Still very aggressive heads-up
      survivalPressure: 0.25,      // Still loose near elimination
      bluffTargetSelection: 0.6,   // Toned down from 0.8 — safer bluffs win more
      positionAwareness: 0.35,
      trueCallConfidence: 0.7,     // Evolved: 1.0 — must be willing to call true
      counterBluffRate: 0.6,       // Evolved: 0.62 — counter-bluffing is Bluffer's strength
      bullPhaseBluffRate: 0.55,    // Evolved: 0.75 — key heads-up weapon
      openingHandTypePreference: 0.25, // Hides info well (evolved: 0.26)
    },
    flavorText: {
      callBull: ['BULL! No way!', 'You\'re bluffing and we both know it.', 'Nice try, pal.'],
      caughtBluffing: ['Worth the shot!', 'You win some, you lose some.', 'I regret nothing.'],
      winRound: ['Too easy!', 'Who\'s bluffing now?', 'Never in doubt.'],
      bigRaise: ['Go big or go home!', 'Feeling lucky?', 'Top that!'],
      eliminated: ['Flame out in style!', 'At least it was exciting.'],
    },
  },
  {
    key: 'grinder',
    name: 'Grinder',
    personality: 'Minimal risk. Prefers small incremental raises. Wins by patience.',
    avatar: '\u{26CF}\u{FE0F}',
    config: {
      bluffFrequency: 0.3,         // Evolved: 0 — Grinder uses targeted bluffs instead
      bullThreshold: 0.55,
      riskTolerance: 0.3,          // Still cautious but bolder (evolved: 0.99)
      aggressionBias: 0.35,        // Reduced — prefers bull calls like evolved bot
      lastChanceBluffRate: 0.35,
      openingBluffRate: 0.25,
      bullPhaseRaiseRate: 0.12,
      trustMultiplier: 1.15,
      cardCountSensitivity: 0.3,   // Evolved: ~0 — stop reacting to card counts
      headsUpAggression: 0.5,      // More aggressive heads-up (evolved: 0.68)
      survivalPressure: 0.6,       // Still tight near elimination
      bluffTargetSelection: 0.2,   // Safe incremental bluffs — still Grinder style
      positionAwareness: 0.55,
      trueCallConfidence: 0.8,     // Evolved: 1.0 — decisive true calls
      counterBluffRate: 0.25,      // Counter-bluffing is efficient (evolved: 0.62)
      bullPhaseBluffRate: 0.2,     // Evolved: 0.75 — even patient play needs this
      openingHandTypePreference: 0.4, // Hide more info at opening (evolved: 0.26)
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
    avatar: '\u{1F3B2}',
    config: {
      bluffFrequency: 0.4,         // Evolved: 0 — less GTO, more targeted chaos
      bullThreshold: 0.48,
      riskTolerance: 0.8,          // Bolder (evolved: 0.99)
      aggressionBias: 0.4,         // Reduced — evolved: 0.30
      lastChanceBluffRate: 0.5,
      openingBluffRate: 0.40,
      bullPhaseRaiseRate: 0.25,
      trustMultiplier: 0.9,
      cardCountSensitivity: 0.3,   // Evolved: ~0 — erratic play, not reactive play
      headsUpAggression: 0.65,     // Slightly more aggressive heads-up
      survivalPressure: 0.3,       // Still chaotic near elimination
      bluffTargetSelection: 0.6,   // Toned down from 0.7 — less reckless
      positionAwareness: 0.3,      // Still ignores position — that's Wildcard's style
      trueCallConfidence: 0.75,    // Evolved: 1.0 — even chaos should call true decisively
      counterBluffRate: 0.5,       // High counter-bluff — chaotic aggression (evolved: 0.62)
      bullPhaseBluffRate: 0.45,    // Evolved: 0.75 — big upgrade, key weapon
      openingHandTypePreference: 0.3, // Hide info better (evolved: 0.26)
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
    key: 'professor',
    name: 'Professor',
    personality: 'Probability-optimal. Closest to theoretically correct play.',
    avatar: '\u{1F393}',
    config: {
      bluffFrequency: 0.15,        // Evolved: 0 — Professor learns GTO bluff path is suboptimal
      bullThreshold: 0.55,         // Slightly more trusting (evolved: 0.56)
      riskTolerance: 0.7,          // Bolder play is optimal (evolved: 0.99)
      aggressionBias: 0.3,         // Prefers bull calls (evolved: 0.30) — key insight
      lastChanceBluffRate: 0.45,
      openingBluffRate: 0.45,      // Higher opening bluffs (evolved: 0.57) — hides info
      bullPhaseRaiseRate: 0.2,
      trustMultiplier: 1.15,       // Slightly trusting (evolved: 1.21)
      cardCountSensitivity: 0.15,  // Evolved: ~0 — Professor discovers reactivity hurts
      headsUpAggression: 0.65,     // More aggressive heads-up (evolved: 0.68)
      survivalPressure: 0.45,      // Moderate — balanced
      bluffTargetSelection: 0.45,  // Safe bluffs — evolved: 0.46
      positionAwareness: 0.5,      // Reduced — less position-dependent (evolved: 0.42)
      trueCallConfidence: 0.9,     // Evolved: 1.0 — decisive true calls are optimal
      counterBluffRate: 0.5,       // Evolved: 0.62 — key heads-up skill
      bullPhaseBluffRate: 0.4,     // Evolved: 0.75 — Professor adopts evolved wisdom
      openingHandTypePreference: 0.3, // Hide info at opening (evolved: 0.26)
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
    avatar: '\u{1F988}',
    config: {
      bluffFrequency: 0.3,         // Evolved: 0 — Shark reads, doesn't GTO-bluff
      bullThreshold: 0.5,          // Slightly more trusting (evolved: 0.56)
      riskTolerance: 0.7,          // Bolder (evolved: 0.99)
      aggressionBias: 0.35,        // Less raise-happy (evolved: 0.30)
      lastChanceBluffRate: 0.45,
      openingBluffRate: 0.4,       // Higher opening bluffs (evolved: 0.57)
      bullPhaseRaiseRate: 0.22,
      trustMultiplier: 1.35,       // Still reads-heavy but slightly less extreme
      cardCountSensitivity: 0.4,   // Evolved: ~0 — Shark still uses reads, less card-count
      headsUpAggression: 0.7,      // Stays aggressive heads-up (evolved: 0.68)
      survivalPressure: 0.4,       // Slightly looser (evolved: 0.40)
      bluffTargetSelection: 0.45,  // Balanced (evolved: 0.46)
      positionAwareness: 0.6,      // Reduced from 0.85 — less position-dependent
      trueCallConfidence: 0.8,     // Evolved: 1.0 — Shark should commit to reads
      counterBluffRate: 0.55,      // Evolved: 0.62 — Shark's exploitative counter-bluffs
      bullPhaseBluffRate: 0.35,    // Evolved: 0.75 — important for control
      openingHandTypePreference: 0.35, // Hide info better (evolved: 0.26)
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
    key: 'cannon',
    name: 'Cannon',
    personality: 'Loves big hand-type jumps. Goes for straights and full houses early.',
    avatar: '\u{1F4A3}',
    config: {
      bluffFrequency: 0.4,         // Evolved: 0 — Cannon still bluffs but targeted
      bullThreshold: 0.45,         // Slightly more trusting
      riskTolerance: 0.95,         // Already near evolved optimal (0.99)
      aggressionBias: 0.5,         // Reduced from 0.8 — less raise-happy (evolved: 0.30)
      lastChanceBluffRate: 0.6,
      openingBluffRate: 0.45,      // Higher opening bluffs (evolved: 0.57)
      bullPhaseRaiseRate: 0.3,
      trustMultiplier: 0.85,
      cardCountSensitivity: 0.25,  // Evolved: ~0 — stop reacting to card counts
      headsUpAggression: 0.8,      // Already near evolved (0.68) — Cannon stays aggressive
      survivalPressure: 0.2,       // Still "full send"
      bluffTargetSelection: 0.65,  // Reduced from 0.9 — less reckless jumps
      positionAwareness: 0.35,
      trueCallConfidence: 0.7,     // Evolved: 1.0 — must call true when hand is real
      counterBluffRate: 0.55,      // Evolved: 0.62 — Cannon loves counter-bluffing
      bullPhaseBluffRate: 0.5,     // Evolved: 0.75 — major upgrade for Cannon
      openingHandTypePreference: 0.25, // Hides info well (evolved: 0.26)
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
    key: 'frost',
    name: 'Frost',
    personality: 'Very tight player. Rarely acts unless the math is strongly in her favor.',
    avatar: '\u{2744}\u{FE0F}',
    config: {
      bluffFrequency: 0.15,        // Evolved: 0 — Frost barely uses GTO bluff path
      bullThreshold: 0.6,          // Slightly more trusting (evolved: 0.56)
      riskTolerance: 0.35,         // Still tight but bolder (evolved: 0.99)
      aggressionBias: 0.25,        // Stays low-aggression — Frost's style
      lastChanceBluffRate: 0.25,
      openingBluffRate: 0.2,
      bullPhaseRaiseRate: 0.1,
      trustMultiplier: 1.2,
      cardCountSensitivity: 0.2,   // Evolved: ~0 — discipline means ignoring noise
      headsUpAggression: 0.45,     // Slightly more aggressive heads-up (evolved: 0.68)
      survivalPressure: 0.7,       // Still tight near elimination
      bluffTargetSelection: 0.25,  // Minimal escalation — precise
      positionAwareness: 0.6,      // Reduced — less position-dependent
      trueCallConfidence: 0.9,     // Evolved: 1.0 — Frost commits to reads
      counterBluffRate: 0.2,       // Evolved: 0.62 — even Frost needs some
      bullPhaseBluffRate: 0.15,    // Evolved: 0.75 — ice-cold bull-phase bluffs
      openingHandTypePreference: 0.5, // Less info-leaky (was 0.8, evolved: 0.26)
    },
    flavorText: {
      callBull: ['I don\'t think so.', 'Cold read: you\'re lying.', 'Not a chance.'],
      caughtBluffing: ['...', 'Noted.'],
      winRound: ['Obviously.', 'As I calculated.', 'Clean.'],
      bigRaise: ['When I move, I move.', 'Worth the wait.'],
      eliminated: ['Suboptimal.', 'Ice melts eventually.'],
    },
  },
  {
    key: 'hustler',
    name: 'Hustler',
    personality: 'Balanced aggression. Mixes solid play with well-timed bluffs to exploit opponents.',
    avatar: '\u{1F3B1}',
    config: {
      bluffFrequency: 0.3,         // Evolved: 0 — Hustler uses smarter bluff paths
      bullThreshold: 0.5,          // More trusting (evolved: 0.56)
      riskTolerance: 0.8,          // Bolder (evolved: 0.99)
      aggressionBias: 0.4,         // Reduced — prefers bull calls (evolved: 0.30)
      lastChanceBluffRate: 0.5,
      openingBluffRate: 0.5,       // High opening bluffs (evolved: 0.57)
      bullPhaseRaiseRate: 0.25,
      trustMultiplier: 1.05,       // Slightly more trusting (evolved: 1.21)
      cardCountSensitivity: 0.2,   // Evolved: ~0 — stop exploiting card count noise
      headsUpAggression: 0.75,     // Stays aggressive heads-up (evolved: 0.68)
      survivalPressure: 0.35,      // Still loose near elimination
      bluffTargetSelection: 0.5,   // Moderate — well-timed (evolved: 0.46)
      positionAwareness: 0.5,      // Reduced — picks spots but less dependent
      trueCallConfidence: 0.85,    // Evolved: 1.0 — Hustler knows when to lock in
      counterBluffRate: 0.55,      // Evolved: 0.62 — key hustling move
      bullPhaseBluffRate: 0.5,     // Evolved: 0.75 — major upgrade for Hustler
      openingHandTypePreference: 0.3, // Hides info at opening (evolved: 0.26)
    },
    flavorText: {
      callBull: ['I know a hustle when I see one.', 'Not today.', 'That ain\'t it.'],
      caughtBluffing: ['Cost of doing business.', 'You got me... this time.'],
      winRound: ['Easy money.', 'Just like I planned.'],
      bigRaise: ['Let me raise the stakes.', 'Time to turn up the heat.'],
      eliminated: ['I\'ll be back.', 'The hustle never stops.'],
    },
  },
];

// ── Level scaling ───────────────────────────────────────────────────────

/** Number of levels per personality. */
export const BOT_LEVELS = 9;

/** Number of personalities. */
export const BOT_PERSONALITY_COUNT = PERSONALITY_BASES.length; // 9

/** Total number of distinct bots in the matrix. */
export const BOT_MATRIX_SIZE = BOT_PERSONALITY_COUNT * BOT_LEVELS; // 81

/**
 * Noisy default config — what a low-skill bot looks like.
 * Elevated noise and loose thresholds, but not completely random.
 * Tuned so even level-1 bots play passably (they just lack personality
 * refinement and make noisier decisions than higher-level bots).
 */
const UNSKILLED_CONFIG: Readonly<BotProfileConfig> = {
  bluffFrequency: 0.9,           // Lower-skill bots still use some GTO bluffing
  bullThreshold: 0.5,
  riskTolerance: 0.5,
  aggressionBias: 0.5,
  lastChanceBluffRate: 0.45,
  openingBluffRate: 0.30,
  bullPhaseRaiseRate: 0.18,
  trustMultiplier: 0.65,
  cardCountSensitivity: 0.8,     // Less reactive than before (was 1.0)
  headsUpAggression: 0.5,
  survivalPressure: 0.5,
  bluffTargetSelection: 0.5,
  positionAwareness: 0.5,
  trueCallConfidence: 0.55,      // Slightly more decisive (was 0.5)
  counterBluffRate: 0.15,
  bullPhaseBluffRate: 0.1,       // Low-skill bots do some bull-phase bluffing (was 0.05)
  openingHandTypePreference: 0.45, // Slightly more info-hiding (was 0.5)
};

/**
 * Interpolate between unskilled config and the personality's lvl9 config.
 * Level 1 = mostly unskilled with slight personality lean.
 * Level 9 = full personality expression at max skill.
 *
 * The interpolation factor is `(level - 1) / 8`:
 * - Level 1: factor = 0.0 (all unskilled)
 * - Level 5: factor = 0.5 (half unskilled, half personality)
 * - Level 9: factor = 1.0 (full personality)
 *
 * Additionally, noise band scales inversely with level to make lower-level
 * bots more erratic regardless of personality.
 */
function scaleConfigForLevel(personality: BotProfileConfig, level: number): BotProfileConfig {
  const t = (level - 1) / 8; // 0.0 to 1.0
  const lerp = (unskilled: number, skilled: number): number => unskilled + (skilled - unskilled) * t;

  const config: BotProfileConfig = {
    bluffFrequency: lerp(UNSKILLED_CONFIG.bluffFrequency, personality.bluffFrequency),
    bullThreshold: lerp(UNSKILLED_CONFIG.bullThreshold, personality.bullThreshold),
    riskTolerance: lerp(UNSKILLED_CONFIG.riskTolerance, personality.riskTolerance),
    aggressionBias: lerp(UNSKILLED_CONFIG.aggressionBias, personality.aggressionBias),
    lastChanceBluffRate: lerp(UNSKILLED_CONFIG.lastChanceBluffRate, personality.lastChanceBluffRate),
    openingBluffRate: lerp(UNSKILLED_CONFIG.openingBluffRate, personality.openingBluffRate),
    bullPhaseRaiseRate: lerp(UNSKILLED_CONFIG.bullPhaseRaiseRate, personality.bullPhaseRaiseRate),
    trustMultiplier: lerp(UNSKILLED_CONFIG.trustMultiplier, personality.trustMultiplier),
    cardCountSensitivity: lerp(UNSKILLED_CONFIG.cardCountSensitivity, personality.cardCountSensitivity),
    headsUpAggression: lerp(UNSKILLED_CONFIG.headsUpAggression, personality.headsUpAggression),
    survivalPressure: lerp(UNSKILLED_CONFIG.survivalPressure, personality.survivalPressure),
    bluffTargetSelection: lerp(UNSKILLED_CONFIG.bluffTargetSelection, personality.bluffTargetSelection),
    positionAwareness: lerp(UNSKILLED_CONFIG.positionAwareness, personality.positionAwareness),
    trueCallConfidence: lerp(UNSKILLED_CONFIG.trueCallConfidence, personality.trueCallConfidence),
    counterBluffRate: lerp(UNSKILLED_CONFIG.counterBluffRate, personality.counterBluffRate),
    bullPhaseBluffRate: lerp(UNSKILLED_CONFIG.bullPhaseBluffRate, personality.bullPhaseBluffRate),
    openingHandTypePreference: lerp(UNSKILLED_CONFIG.openingHandTypePreference, personality.openingHandTypePreference),
  };

  return config;
}

// ── Generate full 81-bot matrix ─────────────────────────────────────────

function generateBotMatrix(): BotProfileDefinition[] {
  const profiles: BotProfileDefinition[] = [];

  for (const base of PERSONALITY_BASES) {
    for (let level = 1; level <= BOT_LEVELS; level++) {
      profiles.push({
        key: `${base.key}_lvl${level}`,
        name: `${base.name} lvl${level}`,
        personality: base.personality,
        avatar: base.avatar,
        config: scaleConfigForLevel(base.config, level),
        flavorText: base.flavorText,
      });
    }
  }

  return profiles;
}

// ── Impossible bot (level 10) ────────────────────────────────────────────

/** The impossible bot — sees all cards, perfect play. Unlocked via settings toggle. */
export const IMPOSSIBLE_BOT: BotProfileDefinition = {
  key: 'oracle_lvl10',
  name: 'The Oracle',
  personality: 'Sees all cards. Perfect play. Cannot be beaten by strategy alone.',
  avatar: '\u{1F441}\u{FE0F}',
  config: {
    bluffFrequency: 1.0,
    bullThreshold: 0.5,
    riskTolerance: 0.5,
    aggressionBias: 0.5,
    lastChanceBluffRate: 0.4,
    openingBluffRate: 0.08,
    bullPhaseRaiseRate: 0.15,
    trustMultiplier: 1.0,
    cardCountSensitivity: 1.0,
    headsUpAggression: 0.5,
    survivalPressure: 0.5,
    bluffTargetSelection: 0.5,
    positionAwareness: 0.5,
    trueCallConfidence: 0.5,
    counterBluffRate: 0.2,
    bullPhaseBluffRate: 0.0,
    openingHandTypePreference: 0.5,
  },
  flavorText: {
    callBull: ['I see everything.', 'Your cards betray you.', 'I know what you hold.'],
    caughtBluffing: ['Impossible...', 'A calculated sacrifice.'],
    winRound: ['As foreseen.', 'Inevitable.', 'The all-seeing eye never blinks.'],
    bigRaise: ['I see the truth.', 'Destiny unfolds.'],
    eliminated: ['Even oracles fall.', 'The vision... fades.'],
  },
};

// ── Profile definitions ─────────────────────────────────────────────────

/** All 81 bot profiles (9 personalities × 9 levels). */
export const BOT_PROFILES: readonly BotProfileDefinition[] = generateBotMatrix();

/** The 9 base personality definitions (level-independent). */
export const BOT_PERSONALITIES: readonly PersonalityBase[] = PERSONALITY_BASES;

/** Map from profile key to profile definition for O(1) lookup. */
export const BOT_PROFILE_MAP: ReadonlyMap<string, BotProfileDefinition> = new Map(
  [...BOT_PROFILES.map(p => [p.key, p] as const), [IMPOSSIBLE_BOT.key, IMPOSSIBLE_BOT]],
);

/** All valid profile keys. */
export const BOT_PROFILE_KEYS: readonly string[] = [...BOT_PROFILES.map(p => p.key), IMPOSSIBLE_BOT.key];

// ── Legacy compatibility ────────────────────────────────────────────────

/**
 * Map from old profile keys (used in migration 009) to new keys.
 * The old 8 bots at their original parameterization correspond to lvl9.
 */
export const LEGACY_PROFILE_KEY_MAP: ReadonlyMap<string, string> = new Map([
  ['the_rock', 'rock_lvl9'],
  ['maverick', 'bluffer_lvl9'],
  ['the_grinder', 'grinder_lvl9'],
  ['wildcard', 'wildcard_lvl9'],
  ['the_professor', 'professor_lvl9'],
  ['shark', 'shark_lvl9'],
  ['loose_cannon', 'cannon_lvl9'],
  ['ice_queen', 'frost_lvl9'],
]);

/**
 * Map from bot display name → avatar emoji for rendering in the player list.
 * These avatars are NOT available to human users — they don't appear in AVATAR_OPTIONS.
 */
export const BOT_AVATAR_MAP: ReadonlyMap<string, string> = new Map([
  // All 81 personality bots
  ...BOT_PROFILES.map(p => [p.name, p.avatar] as const),
  // Impossible bot
  [IMPOSSIBLE_BOT.name, IMPOSSIBLE_BOT.avatar],
  // Legacy names (old 8 bots)
  ['The Rock', '\u{1FAA8}'],
  ['Maverick', '\u{1F920}'],
  ['The Grinder', '\u{26CF}\u{FE0F}'],
  ['Wildcard', '\u{1F3B2}'],
  ['The Professor', '\u{1F393}'],
  ['Shark', '\u{1F988}'],
  ['Loose Cannon', '\u{1F4A3}'],
  ['Ice Queen', '\u{2744}\u{FE0F}'],
  // Generic bots (legacy, from BOT_NAMES in constants.ts)
  ['Bot Brady', '\u{1F916}'],
  ['RoboBluff', '\u{1F3AD}'],
  ['CPU Carl', '\u{1F4BB}'],
  ['Digital Dave', '\u{1F4DF}'],
  ['Silicon Sam', '\u{1F50C}'],
  ['Byte Betty', '\u{1F9EE}'],
  ['Chip Charlie', '\u{1F3B0}'],
  ['Data Diana', '\u{1F4CA}'],
]);

// ── Level category helpers ──────────────────────────────────────────────

import type { BotLevelCategory } from './types.js';

/** Level ranges for each bot level category. */
const LEVEL_RANGES: Record<BotLevelCategory, { min: number; max: number }> = {
  easy:   { min: 1, max: 3 },
  normal: { min: 4, max: 6 },
  hard:   { min: 7, max: 9 },
  mixed:  { min: 1, max: 9 },
};

/** Get bot profiles filtered by level category. */
export function getBotsForCategory(category: BotLevelCategory): BotProfileDefinition[] {
  const range = LEVEL_RANGES[category];
  return BOT_PROFILES.filter(p => {
    const level = parseInt(p.key.split('_lvl')[1]!, 10);
    return level >= range.min && level <= range.max;
  });
}

/** Pick a random bot from the given category, excluding names already in use. */
export function pickRandomBot(category: BotLevelCategory, usedNames: Set<string>): BotProfileDefinition | null {
  const candidates = getBotsForCategory(category).filter(p => !usedNames.has(p.name));
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)]!;
}
