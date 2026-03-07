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
  /** Emoji avatar for this bot personality. Not available to human users. */
  avatar: string;
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
    key: 'bluffer',
    name: 'Bluffer',
    personality: 'Aggressive bluffer. High bull call rate. Plays fast and loose.',
    avatar: '\u{1F920}',
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
    avatar: '\u{1F3B2}',
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
    key: 'professor',
    name: 'Professor',
    personality: 'Probability-optimal. Closest to theoretically correct play.',
    avatar: '\u{1F393}',
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
    avatar: '\u{1F988}',
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
    key: 'cannon',
    name: 'Cannon',
    personality: 'Loves big hand-type jumps. Goes for straights and full houses early.',
    avatar: '\u{1F4A3}',
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
    key: 'frost',
    name: 'Frost',
    personality: 'Very tight player. Rarely acts unless the math is strongly in her favor.',
    avatar: '\u{2744}\u{FE0F}',
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
  {
    key: 'hustler',
    name: 'Hustler',
    personality: 'Balanced aggression. Mixes solid play with well-timed bluffs to exploit opponents.',
    avatar: '\u{1F3B1}',
    config: {
      bluffFrequency: 1.3,
      bullThreshold: 0.42,
      riskTolerance: 0.65,
      aggressionBias: 0.7,
      lastChanceBluffRate: 0.55,
      openingBluffRate: 0.12,
      bullPhaseRaiseRate: 0.22,
      trustMultiplier: 0.9,
      bluffPlausibilityGate: 0.2,
      noiseBand: 0.06,
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
 * Noisy default config — what a completely unskilled bot looks like.
 * High noise, poor thresholds, random-feeling decisions.
 */
const UNSKILLED_CONFIG: Readonly<BotProfileConfig> = {
  bluffFrequency: 0.8,
  bullThreshold: 0.5,
  riskTolerance: 0.5,
  aggressionBias: 0.5,
  lastChanceBluffRate: 0.5,
  openingBluffRate: 0.15,
  bullPhaseRaiseRate: 0.2,
  trustMultiplier: 0.5,
  bluffPlausibilityGate: 0.1,
  noiseBand: 0.18,
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
    bluffPlausibilityGate: lerp(UNSKILLED_CONFIG.bluffPlausibilityGate, personality.bluffPlausibilityGate),
    noiseBand: lerp(UNSKILLED_CONFIG.noiseBand, personality.noiseBand),
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

// ── Profile definitions ─────────────────────────────────────────────────

/** All 81 bot profiles (9 personalities × 9 levels). */
export const BOT_PROFILES: readonly BotProfileDefinition[] = generateBotMatrix();

/** The 9 base personality definitions (level-independent). */
export const BOT_PERSONALITIES: readonly PersonalityBase[] = PERSONALITY_BASES;

/** Map from profile key to profile definition for O(1) lookup. */
export const BOT_PROFILE_MAP: ReadonlyMap<string, BotProfileDefinition> = new Map(
  BOT_PROFILES.map(p => [p.key, p]),
);

/** All valid profile keys. */
export const BOT_PROFILE_KEYS: readonly string[] = BOT_PROFILES.map(p => p.key);

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
 * Includes both personality-based bots (from BOT_PROFILES) and generic bots (from BOT_NAMES).
 * These avatars are NOT available to human users — they don't appear in AVATAR_OPTIONS.
 */
export const BOT_AVATAR_MAP: ReadonlyMap<string, string> = new Map([
  // All 81 personality bots
  ...BOT_PROFILES.map(p => [p.name, p.avatar] as const),
  // Legacy names (old 8 bots)
  ['The Rock', '\u{1FAA8}'],
  ['Maverick', '\u{1F920}'],
  ['The Grinder', '\u{26CF}\u{FE0F}'],
  ['Wildcard', '\u{1F3B2}'],
  ['The Professor', '\u{1F393}'],
  ['Shark', '\u{1F988}'],
  ['Loose Cannon', '\u{1F4A3}'],
  ['Ice Queen', '\u{2744}\u{FE0F}'],
  // Generic bots (from BOT_NAMES in constants.ts)
  ['Bot Brady', '\u{1F916}'],      // 🤖
  ['RoboBluff', '\u{1F3AD}'],      // 🎭
  ['CPU Carl', '\u{1F4BB}'],       // 💻
  ['Digital Dave', '\u{1F4DF}'],    // 📟
  ['Silicon Sam', '\u{1F50C}'],     // 🔌
  ['Byte Betty', '\u{1F9EE}'],     // 🧮
  ['Chip Charlie', '\u{1F3B0}'],   // 🎰
  ['Data Diana', '\u{1F4CA}'],     // 📊
]);
