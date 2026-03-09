/**
 * Bot profile system: 81 total bot profiles.
 *
 * - 72 heuristic bots: 9 personalities × 8 levels (1-8)
 * - 9 CFR bots: trained via Counterfactual Regret Minimization, all at level 9
 *
 * Each personality has a distinct strategic profile (e.g., bluffs aggressively,
 * plays tight/conservative, is erratic, reads opponents). Level controls the
 * skill/accuracy of the decision-making parameters (lvl8 = strongest heuristic,
 * lvl9 = CFR game-theory bots, lvl1 = easiest). Personality controls strategic
 * tendencies and style.
 *
 * Naming format: `{Personality} lvl{N}` — e.g., "Professor lvl3", "Rock lvl8"
 * CFR bots use unique names: Viper, Ghost, Reaper, etc.
 */

// ── Profile config type ─────────────────────────────────────────────────

/**
 * Tunable parameters that override hardcoded thresholds in BotPlayer's
 * hard-mode decision logic. Every field is optional — omitted fields
 * fall back to the existing default values.
 */
export interface BotProfileConfig {
  /** How often the bot bluffs when it doesn't have a legitimate hand (0.0–2.0).
   *  Scales the GTO bluff frequency multiplier. */
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

  /** Opening bluff frequency (0.0–1.0). Controls how often the bot bluffs at opening. */
  openingBluffRate: number;

  /** Bull-phase raise frequency when the bot has a higher hand (0.0–1.0).
   *  Overrides the 15%/25% base raise chances. */
  bullPhaseRaiseRate: number;

  /** Trust factor multiplier for opponent memory (0.0–2.0).
   *  Scales the continuous trust score (not just coarse buckets).
   *  Higher = trusts callers more, lower = more skeptical of all claims. */
  trustMultiplier: number;

  /** Minimum plausibility for the bot to attempt a bluff (0.0–1.0).
   *  Higher = only bluffs with very plausible hands. Lower = attempts riskier bluffs.
   *  Acts as a safety gate on all bluff decisions. */
  bluffPlausibilityGate: number;

  /** Noise band width for bull/true threshold decisions (0.0–0.2).
   *  Controls stochasticity in the uncertain zone between bull and true.
   *  Higher = more random in borderline decisions (less exploitable but less precise).
   *  Lower = more deterministic (precise but potentially exploitable). */
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
  /** If true, this bot uses CFR strategy instead of heuristic decision logic. */
  isCFR?: boolean;
}

// ── Default config — evolved-optimized baseline ─────────────────────────
//
// These values come from 80-generation evolution training (gen80 champion,
// 61.3% win rate heads-up vs all strongest heuristic profiles).
//
// The gen80 evolution simplified the parameter space from 17 to 10 params.
// 9 low-differentiation params were hardcoded as constants in BotPlayer
// (they provide contextual adaptation but don't meaningfully differ between
// personalities). 2 previously-hardcoded constants (bluffPlausibilityGate,
// noiseBand) were promoted to tunable params — evolution showed they matter.
//
// All personalities derive from this baseline. After each evolution run,
// update these values to the new champion's parameters so every bot
// in the matrix benefits from the latest training insights.

export const DEFAULT_BOT_PROFILE_CONFIG: Readonly<BotProfileConfig> = {
  bluffFrequency: 0.30,           // GTO bluff path rehabilitated — moderate bluffing wins
  bullThreshold: 0.70,            // Conservative bull-calling — don't over-call
  riskTolerance: 0.15,            // Low risk tolerance — conservative play wins
  aggressionBias: 0.20,           // Prefer bull calls over raises
  lastChanceBluffRate: 0.15,      // Conservative last-chance raises
  openingBluffRate: 0.12,         // Low opening bluffs — play tight
  bullPhaseRaiseRate: 0.05,       // Very selective bull-phase raises
  trustMultiplier: 1.30,          // Trust opponent reads heavily
  bluffPlausibilityGate: 0.40,    // Only bluff with plausible hands (was hardcoded 0.15)
  noiseBand: 0.03,                // Small noise band — precise decisions
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
  /** Level 8 config — the full expression of this personality at max heuristic skill. */
  config: BotProfileConfig;
  flavorText: BotFlavorText;
}

/** The 9 base personalities. Level 8 config = strongest heuristic parameterization. */
const PERSONALITY_BASES: readonly PersonalityBase[] = [
  {
    key: 'rock',
    name: 'Rock',
    personality: 'Ultra-conservative. Almost never bluffs. Only calls bull when very confident.',
    avatar: '\u{1FAA8}',
    config: {
      // Signature: low bluffFrequency, high bullThreshold, high bluffPlausibilityGate, low noiseBand
      bluffFrequency: 0.15,          // Signature: barely bluffs
      bullThreshold: 0.80,           // Signature: very cautious bull-caller
      riskTolerance: 0.08,           // Signature: ultra-conservative
      aggressionBias: 0.20,          // Evolved baseline
      lastChanceBluffRate: 0.10,     // Below evolved — conservative
      openingBluffRate: 0.08,        // Signature: Rock doesn't bluff openings
      bullPhaseRaiseRate: 0.05,      // Evolved baseline
      trustMultiplier: 1.30,         // Evolved baseline
      bluffPlausibilityGate: 0.50,   // Signature: only very plausible bluffs
      noiseBand: 0.02,              // Low noise — precise decisions
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
      // Signature: high bluffFrequency, low bullThreshold, high lastChanceBluffRate, low trustMultiplier
      bluffFrequency: 0.50,          // Signature: bluffs a lot
      bullThreshold: 0.55,           // Signature: aggressive bull-caller
      riskTolerance: 0.30,           // Above evolved — bolder
      aggressionBias: 0.35,          // Signature: more raise-happy
      lastChanceBluffRate: 0.35,     // Signature: high last-chance raises
      openingBluffRate: 0.25,        // Above evolved — aggressive openers
      bullPhaseRaiseRate: 0.10,      // Above evolved — more bull-phase raises
      trustMultiplier: 0.95,         // Signature: skeptical
      bluffPlausibilityGate: 0.25,   // Signature: will bluff with less plausible hands
      noiseBand: 0.04,              // Slightly more noise — unpredictable
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
      // Signature: low riskTolerance, low openingBluffRate, high bluffPlausibilityGate
      bluffFrequency: 0.25,          // Below evolved — cautious
      bullThreshold: 0.70,           // Evolved baseline
      riskTolerance: 0.10,           // Signature: very cautious
      aggressionBias: 0.20,          // Evolved baseline
      lastChanceBluffRate: 0.10,     // Below evolved — patient
      openingBluffRate: 0.08,        // Signature: cautious openers
      bullPhaseRaiseRate: 0.05,      // Evolved baseline
      trustMultiplier: 1.30,         // Evolved baseline
      bluffPlausibilityGate: 0.50,   // Signature: only very plausible bluffs
      noiseBand: 0.02,              // Precise — no wasted moves
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
      // Signature: high noiseBand (unpredictable), variable aggression, low bluffPlausibilityGate
      bluffFrequency: 0.35,          // Above evolved
      bullThreshold: 0.60,           // Signature: slightly more aggressive bull-caller
      riskTolerance: 0.25,           // Above evolved
      aggressionBias: 0.35,          // Signature: more raise-happy (chaotic)
      lastChanceBluffRate: 0.25,     // Above evolved — chaotic last-chance plays
      openingBluffRate: 0.20,        // Above evolved
      bullPhaseRaiseRate: 0.10,      // Above evolved — unpredictable raises
      trustMultiplier: 1.10,         // Below evolved — chaos doesn't commit
      bluffPlausibilityGate: 0.30,   // Signature: willing to try risky bluffs
      noiseBand: 0.08,              // Signature: high noise — very unpredictable
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
      // Signature: exact evolved baseline — the "textbook" bot. Identical to DEFAULT.
      bluffFrequency: 0.30,          // Evolved baseline
      bullThreshold: 0.70,           // Evolved baseline
      riskTolerance: 0.15,           // Evolved baseline
      aggressionBias: 0.20,          // Evolved baseline
      lastChanceBluffRate: 0.15,     // Evolved baseline
      openingBluffRate: 0.12,        // Evolved baseline
      bullPhaseRaiseRate: 0.05,      // Evolved baseline
      trustMultiplier: 1.30,         // Evolved baseline
      bluffPlausibilityGate: 0.40,   // Evolved baseline
      noiseBand: 0.03,              // Evolved baseline
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
      // Signature: high trustMultiplier, low bullThreshold, low bluffPlausibilityGate (exploitative)
      bluffFrequency: 0.30,          // Evolved baseline
      bullThreshold: 0.62,           // Signature: slightly more aggressive bull-caller (reads)
      riskTolerance: 0.20,           // Above evolved — bold when reads are good
      aggressionBias: 0.20,          // Evolved baseline
      lastChanceBluffRate: 0.15,     // Evolved baseline
      openingBluffRate: 0.12,        // Evolved baseline
      bullPhaseRaiseRate: 0.05,      // Evolved baseline
      trustMultiplier: 1.50,         // Signature: trusts reads heavily
      bluffPlausibilityGate: 0.30,   // Signature: wider bluff range based on reads
      noiseBand: 0.03,              // Evolved baseline
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
      // Signature: high aggressionBias, high lastChanceBluffRate, low bullThreshold
      bluffFrequency: 0.40,          // Above evolved
      bullThreshold: 0.60,           // Signature: aggressive bull-caller
      riskTolerance: 0.25,           // Above evolved — bolder
      aggressionBias: 0.40,          // Signature: very raise-happy
      lastChanceBluffRate: 0.30,     // Signature: high last-chance raises
      openingBluffRate: 0.20,        // Above evolved — Cannon opens big
      bullPhaseRaiseRate: 0.10,      // Above evolved — more bull-phase raises
      trustMultiplier: 1.10,         // Below evolved — Cannon is skeptical
      bluffPlausibilityGate: 0.30,   // Lower gate — willing to try bold bluffs
      noiseBand: 0.04,              // Slightly more noise
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
      // Signature: high bullThreshold, low aggressionBias, low riskTolerance, low noiseBand
      bluffFrequency: 0.20,          // Below evolved
      bullThreshold: 0.78,           // Signature: very cautious bull-caller
      riskTolerance: 0.08,           // Signature: ultra-tight
      aggressionBias: 0.12,          // Signature: low aggression — Frost's discipline
      lastChanceBluffRate: 0.08,     // Below evolved — conservative
      openingBluffRate: 0.08,        // Below evolved — cautious openers
      bullPhaseRaiseRate: 0.03,      // Below evolved — very selective
      trustMultiplier: 1.30,         // Evolved baseline
      bluffPlausibilityGate: 0.50,   // Signature: only very plausible bluffs
      noiseBand: 0.01,              // Signature: minimal noise — very precise
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
      // Signature: high openingBluffRate, moderate aggression, low bluffPlausibilityGate
      bluffFrequency: 0.35,          // Above evolved
      bullThreshold: 0.65,           // Slightly below evolved — more aggressive
      riskTolerance: 0.20,           // Above evolved
      aggressionBias: 0.28,          // Near evolved — slightly higher
      lastChanceBluffRate: 0.22,     // Above evolved
      openingBluffRate: 0.22,        // Signature: above evolved — opens strong
      bullPhaseRaiseRate: 0.08,      // Slightly above evolved
      trustMultiplier: 1.15,         // Below evolved — skeptical
      bluffPlausibilityGate: 0.30,   // Signature: well-timed risky bluffs
      noiseBand: 0.03,              // Evolved baseline
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

/** Number of heuristic levels per personality (1-8). CFR bots occupy level 9. */
export const BOT_LEVELS = 8;

/** Number of personalities. */
export const BOT_PERSONALITY_COUNT = PERSONALITY_BASES.length; // 9

/** Number of CFR bots (all at level 9). */
export const CFR_BOT_COUNT = 9;

/** Total number of distinct bots: 72 heuristic (9×8) + 9 CFR = 81. */
export const BOT_MATRIX_SIZE = BOT_PERSONALITY_COUNT * BOT_LEVELS + CFR_BOT_COUNT; // 81

/**
 * Unskilled config — what a level-1 bot looks like.
 * Raised ~40% toward evolved baseline so even easy bots play competently.
 * They still lack personality refinement and make noisier decisions,
 * but they're not pushovers. Level scaling lerps from here to personality lvl8.
 *
 * Gen80 evolved baseline is conservative (low risk, low bluffs, tight play).
 * Unskilled bots deviate by being too aggressive, too noisy, and too loose.
 */
const UNSKILLED_CONFIG: Readonly<BotProfileConfig> = {
  bluffFrequency: 0.55,          // Unskilled bluff too much (evolved: 0.30)
  bullThreshold: 0.50,           // Unskilled less trusting (evolved: 0.70)
  riskTolerance: 0.45,           // Unskilled take random risks (evolved: 0.15)
  aggressionBias: 0.40,          // Unskilled are more aggressive (evolved: 0.20)
  lastChanceBluffRate: 0.40,     // Unskilled raise too much in last chance (evolved: 0.15)
  openingBluffRate: 0.35,        // Unskilled bluff openings too much (evolved: 0.12)
  bullPhaseRaiseRate: 0.15,      // Unskilled raise in bull phase too much (evolved: 0.05)
  trustMultiplier: 0.90,         // Unskilled don't trust reads (evolved: 1.30)
  bluffPlausibilityGate: 0.20,   // Unskilled try implausible bluffs (evolved: 0.40)
  noiseBand: 0.07,               // Unskilled are noisy (evolved: 0.03)
};

/**
 * Interpolate between unskilled config and the personality's lvl8 config.
 * Level 1 = mostly unskilled with slight personality lean.
 * Level 8 = full personality expression at max heuristic skill.
 * (Level 9 = CFR bots, not generated by this function.)
 *
 * The interpolation factor is `(level - 1) / 7`:
 * - Level 1: factor = 0.0 (all unskilled)
 * - Level 4: factor ≈ 0.43 (leaning toward personality)
 * - Level 8: factor = 1.0 (full personality)
 *
 * Additionally, noise band scales inversely with level to make lower-level
 * bots more erratic regardless of personality.
 */
function scaleConfigForLevel(personality: BotProfileConfig, level: number): BotProfileConfig {
  const t = (level - 1) / 7; // 0.0 to 1.0
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

// ── Generate 72-bot heuristic matrix ────────────────────────────────────

function generateHeuristicMatrix(): BotProfileDefinition[] {
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
    bluffPlausibilityGate: 0.10,
    noiseBand: 0.03,
  },
  flavorText: {
    callBull: ['I see everything.', 'Your cards betray you.', 'I know what you hold.'],
    caughtBluffing: ['Impossible...', 'A calculated sacrifice.'],
    winRound: ['As foreseen.', 'Inevitable.', 'The all-seeing eye never blinks.'],
    bigRaise: ['I see the truth.', 'Destiny unfolds.'],
    eliminated: ['Even oracles fall.', 'The vision... fades.'],
  },
};

// ── CFR bot profiles (trained via Counterfactual Regret Minimization) ────

/**
 * 9 CFR bots — all use the same trained strategy (500K iterations of self-play).
 * Different names and avatars for variety, but identical decision logic.
 * CFR bots bypass the heuristic BotProfileConfig system entirely; the config
 * field is set to the evolved baseline as a no-op fallback.
 */
const CFR_BOT_NAMES: readonly { key: string; name: string; avatar: string }[] = [
  { key: 'cfr_viper',    name: 'Viper',    avatar: '\u{1F40D}' },
  { key: 'cfr_ghost',    name: 'Ghost',    avatar: '\u{1F47B}' },
  { key: 'cfr_reaper',   name: 'Reaper',   avatar: '\u{2620}\u{FE0F}' },
  { key: 'cfr_specter',  name: 'Specter',  avatar: '\u{1F300}' },
  { key: 'cfr_raptor',   name: 'Raptor',   avatar: '\u{1F985}' },
  { key: 'cfr_havoc',    name: 'Havoc',    avatar: '\u{1F525}' },
  { key: 'cfr_phantom',  name: 'Phantom',  avatar: '\u{1F3AD}' },
  { key: 'cfr_sentinel', name: 'Sentinel', avatar: '\u{1F6E1}\u{FE0F}' },
  { key: 'cfr_vanguard', name: 'Vanguard', avatar: '\u{2694}\u{FE0F}' },
];

const CFR_FLAVOR_TEXT: BotFlavorText = {
  callBull: ['Statistically unlikely.', 'The numbers don\'t lie.', 'My training says no.'],
  caughtBluffing: ['A calculated risk.', 'Variance happens.', 'Noted for future iterations.'],
  winRound: ['As the model predicted.', 'Optimal play.', 'Converged.'],
  bigRaise: ['The strategy demands it.', 'Trust the process.'],
  eliminated: ['Regret minimized.', 'The strategy will adapt.'],
};

export const CFR_BOTS: readonly BotProfileDefinition[] = CFR_BOT_NAMES.map(({ key, name, avatar }) => ({
  key,
  name,
  personality: 'Trained via 500K iterations of CFR self-play. No heuristics — pure game theory.',
  avatar,
  config: DEFAULT_BOT_PROFILE_CONFIG, // Not used — CFR bypasses heuristic logic
  flavorText: CFR_FLAVOR_TEXT,
  isCFR: true,
}));

/** Map from CFR bot key to profile for O(1) lookup. */
export const CFR_BOT_MAP: ReadonlyMap<string, BotProfileDefinition> = new Map(
  CFR_BOTS.map(p => [p.key, p]),
);

// ── Profile definitions ─────────────────────────────────────────────────

/** All 72 heuristic bot profiles (9 personalities × 8 levels). */
export const HEURISTIC_BOT_PROFILES: readonly BotProfileDefinition[] = generateHeuristicMatrix();

/** All 81 bot profiles: 72 heuristic (lvl1-8) + 9 CFR (lvl9). */
export const BOT_PROFILES: readonly BotProfileDefinition[] = [...HEURISTIC_BOT_PROFILES, ...CFR_BOTS];

/** The 9 base personality definitions (level-independent). */
export const BOT_PERSONALITIES: readonly PersonalityBase[] = PERSONALITY_BASES;

/** Map from profile key to profile definition for O(1) lookup. */
export const BOT_PROFILE_MAP: ReadonlyMap<string, BotProfileDefinition> = new Map(
  [
    ...BOT_PROFILES.map(p => [p.key, p] as const),
    [IMPOSSIBLE_BOT.key, IMPOSSIBLE_BOT],
  ],
);

/** All valid profile keys. */
export const BOT_PROFILE_KEYS: readonly string[] = [
  ...BOT_PROFILES.map(p => p.key),
  IMPOSSIBLE_BOT.key,
];

// ── Legacy compatibility ────────────────────────────────────────────────

/**
 * Map from old profile keys (used in migration 009) to new keys.
 * The old 8 bots at their original parameterization correspond to lvl8
 * (the strongest heuristic level, formerly lvl9 before CFR bots took lvl9).
 */
export const LEGACY_PROFILE_KEY_MAP: ReadonlyMap<string, string> = new Map([
  ['the_rock', 'rock_lvl8'],
  ['maverick', 'bluffer_lvl8'],
  ['the_grinder', 'grinder_lvl8'],
  ['wildcard', 'wildcard_lvl8'],
  ['the_professor', 'professor_lvl8'],
  ['shark', 'shark_lvl8'],
  ['loose_cannon', 'cannon_lvl8'],
  ['ice_queen', 'frost_lvl8'],
]);

/**
 * Map from bot display name → avatar emoji for rendering in the player list.
 * These avatars are NOT available to human users — they don't appear in AVATAR_OPTIONS.
 */
export const BOT_AVATAR_MAP: ReadonlyMap<string, string> = new Map([
  // All 81 bot profiles (72 heuristic + 9 CFR)
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

/**
 * Level ranges for each bot level category.
 * Heuristic bots: lvl 1-8. CFR bots: lvl 9 (included in 'hard' and 'mixed').
 */
const LEVEL_RANGES: Record<BotLevelCategory, { min: number; max: number }> = {
  easy:   { min: 1, max: 3 },
  normal: { min: 4, max: 6 },
  hard:   { min: 7, max: 9 },
  mixed:  { min: 1, max: 9 },
};

/**
 * Parse the effective level from a bot profile key.
 * Heuristic bots: `{personality}_lvl{N}` → N (1-8).
 * CFR bots: `cfr_{name}` → 9 (CFR bots are all level 9).
 */
function getBotLevel(key: string): number {
  if (key.startsWith('cfr_')) return 9;
  return parseInt(key.split('_lvl')[1]!, 10);
}

/** Get bot profiles filtered by level category. */
export function getBotsForCategory(category: BotLevelCategory): BotProfileDefinition[] {
  const range = LEVEL_RANGES[category];
  return BOT_PROFILES.filter(p => {
    const level = getBotLevel(p.key);
    return level >= range.min && level <= range.max;
  });
}

/** Pick a random bot from the given category, excluding names already in use. */
export function pickRandomBot(category: BotLevelCategory, usedNames: Set<string>): BotProfileDefinition | null {
  const candidates = getBotsForCategory(category).filter(p => !usedNames.has(p.name));
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)]!;
}
