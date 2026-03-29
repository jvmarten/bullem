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
// Evolved v3 baseline — trained via genetic algorithm across 80 generations,
// 5M+ games, 12 mixed scenarios (2-6 players, joker variants, classic/strict).
// 100 games per matchup for high statistical confidence.
//
// Key strategic shifts from v2 evolved baseline:
// - Dramatically lower trustMultiplier (1.15 → 0.22): extreme skepticism of all claims
// - Higher bullThreshold (0.00 → 0.16): more selective bull calls instead of challenging everything
// - Lower riskTolerance (1.00 → 0.19): disciplined play, avoid unnecessary risks
// - Lower aggressionBias (0.86 → 0.33): prefer calling bull/true over raising in uncertain spots
// - Max lastChanceBluffRate (0.82 → 1.00): always fight when cornered — never give up
// - Higher bluffPlausibilityGate (0.55 → 0.77): only attempt plausible bluffs
// - Higher bullPhaseRaiseRate (0.80 → 0.86): exploit bull-phase raise opportunities
// - Lower bluffFrequency (0.42 → 0.33): bluff less overall, but more selectively
// - Lower openingBluffRate (0.15 → 0.07): conservative openings, save bluffs for later
//
// This profile beats all 9 lvl8 personalities (53%+ WR) and holds even against
// the Hall of Fame (50%+ WR). The strategy is fundamentally "skeptical disciplinarian":
// trust nobody, bluff rarely but plausibly, always fight when cornered.

export const DEFAULT_BOT_PROFILE_CONFIG: Readonly<BotProfileConfig> = {
  bluffFrequency: 0.33,           // Selective bluffing — quality over quantity
  bullThreshold: 0.16,            // Selective bull calls — don't challenge everything blindly
  riskTolerance: 0.19,            // Disciplined play — avoid unnecessary risks
  aggressionBias: 0.33,           // Measured aggression — prefer reading over raising
  lastChanceBluffRate: 1.00,      // Max last-chance raises — never go down without a fight
  openingBluffRate: 0.07,         // Conservative openings — save bluffs for key moments
  bullPhaseRaiseRate: 0.86,       // Strong bull-phase raises — exploit raise opportunities
  trustMultiplier: 0.22,          // Extreme skepticism — trust no one's claims
  bluffPlausibilityGate: 0.77,    // High plausibility gate — only attempt believable bluffs
  noiseBand: 0.09,                // Slight noise — prevent exploitation without losing precision
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
      // Signature: high bullThreshold, low riskTolerance, low noiseBand, low lastChanceBluffRate, low bullPhaseRaiseRate
      bluffFrequency: 0.33,          // Evolved baseline
      bullThreshold: 0.55,           // Signature: much more cautious bull-caller
      riskTolerance: 0.10,           // Signature: conservative — well below baseline 0.19
      aggressionBias: 0.33,          // Evolved baseline
      lastChanceBluffRate: 0.40,     // Signature: below baseline — conservative
      openingBluffRate: 0.07,        // Evolved baseline
      bullPhaseRaiseRate: 0.30,      // Signature: below baseline — selective raises
      trustMultiplier: 0.22,         // Evolved baseline
      bluffPlausibilityGate: 0.85,   // Signature: only very plausible bluffs (above baseline 0.77)
      noiseBand: 0.06,              // Signature: precise decisions
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
      // Signature: high bluffFrequency, high bullThreshold, high aggressionBias, low bluffPlausibilityGate, low trustMultiplier
      bluffFrequency: 1.20,          // Signature: bluffs a lot (well above baseline 0.33)
      bullThreshold: 0.30,           // Signature: aggressive bull-caller (above baseline 0.16)
      riskTolerance: 0.19,           // Evolved baseline
      aggressionBias: 0.90,          // Signature: more raise-happy (above baseline 0.33)
      lastChanceBluffRate: 1.00,     // Evolved baseline (Bluffer maxes this too)
      openingBluffRate: 0.25,        // Signature: aggressive openers (above baseline 0.07)
      bullPhaseRaiseRate: 0.86,      // Evolved baseline
      trustMultiplier: 0.12,         // Signature: very skeptical (below baseline 0.22)
      bluffPlausibilityGate: 0.18,   // Signature: will bluff with less plausible hands
      noiseBand: 0.12,              // Slightly more noise — unpredictable
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
      // Signature: low riskTolerance, low openingBluffRate, high bluffPlausibilityGate, low lastChanceBluffRate, low bullPhaseRaiseRate
      bluffFrequency: 0.33,          // Evolved baseline
      bullThreshold: 0.16,           // Evolved baseline
      riskTolerance: 0.10,           // Signature: cautious — well below baseline 0.19
      aggressionBias: 0.33,          // Evolved baseline
      lastChanceBluffRate: 0.50,     // Signature: below baseline — patient
      openingBluffRate: 0.02,        // Signature: almost no opening bluffs
      bullPhaseRaiseRate: 0.40,      // Signature: below baseline — selective
      trustMultiplier: 0.22,         // Evolved baseline
      bluffPlausibilityGate: 0.85,   // Signature: only very plausible bluffs (above baseline 0.77)
      noiseBand: 0.06,              // Precise — no wasted moves
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
      // Signature: high noiseBand (unpredictable), high bluffFrequency, high aggressionBias, low bluffPlausibilityGate
      bluffFrequency: 0.90,          // Signature: more bluffing than baseline 0.33
      bullThreshold: 0.16,           // Evolved baseline
      riskTolerance: 0.19,           // Evolved baseline
      aggressionBias: 0.88,          // Signature: raise-happy (chaotic) — above baseline 0.33
      lastChanceBluffRate: 1.00,     // Evolved baseline
      openingBluffRate: 0.18,        // Signature: some opening bluffs (above baseline 0.07)
      bullPhaseRaiseRate: 0.86,      // Evolved baseline
      trustMultiplier: 0.22,         // Evolved baseline
      bluffPlausibilityGate: 0.20,   // Signature: willing to try risky bluffs
      noiseBand: 0.18,              // Signature: very high noise — unpredictable
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
      bluffFrequency: 0.33,          // Evolved baseline
      bullThreshold: 0.16,           // Evolved baseline
      riskTolerance: 0.19,           // Evolved baseline
      aggressionBias: 0.33,          // Evolved baseline
      lastChanceBluffRate: 1.00,     // Evolved baseline
      openingBluffRate: 0.07,        // Evolved baseline
      bullPhaseRaiseRate: 0.86,      // Evolved baseline
      trustMultiplier: 0.22,         // Evolved baseline
      bluffPlausibilityGate: 0.77,   // Evolved baseline
      noiseBand: 0.09,              // Evolved baseline
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
      // Signature: high trustMultiplier, low bluffPlausibilityGate, low noiseBand (exploitative)
      bluffFrequency: 0.33,          // Evolved baseline
      bullThreshold: 0.16,           // Evolved baseline
      riskTolerance: 0.19,           // Evolved baseline
      aggressionBias: 0.33,          // Evolved baseline
      lastChanceBluffRate: 1.00,     // Evolved baseline
      openingBluffRate: 0.07,        // Evolved baseline
      bullPhaseRaiseRate: 0.86,      // Evolved baseline
      trustMultiplier: 0.55,         // Signature: trusts reads more (above baseline 0.22)
      bluffPlausibilityGate: 0.22,   // Signature: wider bluff range based on reads
      noiseBand: 0.06,              // Signature: precise reads
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
      // Signature: high bluffFrequency, high aggressionBias, high openingBluffRate, low bluffPlausibilityGate
      bluffFrequency: 1.00,          // Signature: bluffs aggressively for big raises
      bullThreshold: 0.16,           // Evolved baseline
      riskTolerance: 0.19,           // Evolved baseline
      aggressionBias: 0.92,          // Signature: very raise-happy (above baseline 0.33)
      lastChanceBluffRate: 1.00,     // Evolved baseline (Cannon naturally maxes this)
      openingBluffRate: 0.18,        // Signature: opens big (above baseline 0.07)
      bullPhaseRaiseRate: 0.86,      // Evolved baseline
      trustMultiplier: 0.22,         // Evolved baseline
      bluffPlausibilityGate: 0.22,   // Signature: willing to try bold bluffs
      noiseBand: 0.12,              // Slightly more noise
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
      // Signature: high bullThreshold, low aggressionBias, low riskTolerance, low noiseBand, low lastChanceBluffRate, low bullPhaseRaiseRate
      bluffFrequency: 0.33,          // Evolved baseline
      bullThreshold: 0.55,           // Signature: much more cautious bull-caller
      riskTolerance: 0.10,           // Signature: tight — well below baseline 0.19
      aggressionBias: 0.15,          // Signature: low aggression — Frost's discipline (below baseline 0.33)
      lastChanceBluffRate: 0.40,     // Signature: below baseline — conservative
      openingBluffRate: 0.07,        // Evolved baseline
      bullPhaseRaiseRate: 0.35,      // Signature: below baseline — very selective
      trustMultiplier: 0.22,         // Evolved baseline
      bluffPlausibilityGate: 0.85,   // Signature: only very plausible bluffs (above baseline 0.77)
      noiseBand: 0.05,              // Signature: minimal noise — very precise
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
      // Signature: high bluffFrequency, high openingBluffRate, low bluffPlausibilityGate, moderate aggressionBias
      bluffFrequency: 0.80,          // Signature: bluffs well above baseline 0.33
      bullThreshold: 0.16,           // Evolved baseline
      riskTolerance: 0.19,           // Evolved baseline
      aggressionBias: 0.50,          // Signature: moderate — balanced between passive and aggressive
      lastChanceBluffRate: 1.00,     // Evolved baseline
      openingBluffRate: 0.20,        // Signature: opens strong (above baseline 0.07)
      bullPhaseRaiseRate: 0.68,      // Signature: below baseline — selective raises
      trustMultiplier: 0.15,         // Signature: skeptical — reads-reliant (below baseline 0.22)
      bluffPlausibilityGate: 0.22,   // Signature: well-timed risky bluffs
      noiseBand: 0.09,              // Evolved baseline
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
 * Diverges from evolved baseline in "bad" directions: bluffs too much,
 * too trusting, unfocused aggression, noisy decisions, gives up too easily.
 * Level scaling lerps from here to personality lvl8.
 *
 * V3 evolved baseline is "skeptical disciplinarian" (low trust, selective bluffs,
 * low risk, high plausibility gate, max last-chance raises). Unskilled bots
 * deviate by over-bluffing, trusting too much, being too aggressive, making
 * noisy decisions, and giving up when cornered.
 * Raised ~40% toward evolved baseline from "bad" extremes.
 */
const UNSKILLED_CONFIG: Readonly<BotProfileConfig> = {
  bluffFrequency: 0.55,          // Unskilled over-bluff (evolved: 0.33, bad: ~1.0)
  bullThreshold: 0.40,           // Unskilled too cautious calling bull (evolved: 0.16)
  riskTolerance: 0.50,           // Unskilled takes dumb risks (evolved: 0.19, bad: ~0.80)
  aggressionBias: 0.55,          // Unskilled too aggressive (evolved: 0.33, bad: ~0.80)
  lastChanceBluffRate: 0.65,     // Unskilled gives up easier (evolved: 1.00, bad: ~0.30)
  openingBluffRate: 0.20,        // Unskilled bluffs openings too much (evolved: 0.07)
  bullPhaseRaiseRate: 0.55,      // Unskilled fewer bull-phase raises (evolved: 0.86)
  trustMultiplier: 0.75,         // Unskilled too trusting (evolved: 0.22, bad: ~1.20)
  bluffPlausibilityGate: 0.40,   // Unskilled try implausible bluffs (evolved: 0.77)
  noiseBand: 0.15,               // Unskilled are noisy (evolved: 0.09)
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
  personality: '',
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

// ── Bot name → user ID mapping ──────────────────────────────────────────

/** Personality name → 2-digit code used in deterministic bot UUIDs. */
const PERSONALITY_UUID_CODES: Record<string, string> = {
  rock: '01', bluffer: '02', grinder: '03', wildcard: '04',
  professor: '05', shark: '06', cannon: '07', frost: '08', hustler: '09',
};

/** Deterministic UUIDs for CFR bots (mirrors migration 018 / botPool.ts). */
const CFR_USER_IDS: Record<string, string> = {
  cfr_viper:    '00000000-0000-4000-b101-000000000000',
  cfr_ghost:    '00000000-0000-4000-b102-000000000000',
  cfr_reaper:   '00000000-0000-4000-b103-000000000000',
  cfr_specter:  '00000000-0000-4000-b104-000000000000',
  cfr_raptor:   '00000000-0000-4000-b105-000000000000',
  cfr_havoc:    '00000000-0000-4000-b106-000000000000',
  cfr_phantom:  '00000000-0000-4000-b107-000000000000',
  cfr_sentinel: '00000000-0000-4000-b108-000000000000',
  cfr_vanguard: '00000000-0000-4000-b109-000000000000',
};

/**
 * Compute the deterministic database user ID for a bot profile key.
 * Returns null for keys that don't follow the known UUID scheme (e.g. oracle_lvl10).
 */
export function getBotUserIdByKey(key: string): string | null {
  // CFR bots
  if (key in CFR_USER_IDS) return CFR_USER_IDS[key]!;

  // Heuristic bots: {personality}_lvl{1-8}
  const match = key.match(/^([a-z]+)_lvl([1-8])$/);
  if (!match) return null;
  const code = PERSONALITY_UUID_CODES[match[1]!];
  if (!code) return null;
  return `00000000-0000-4000-b${code}${match[2]}-000000000000`;
}

/**
 * Map from bot display name → database user ID.
 * Covers all 81 standard bots (72 heuristic + 9 CFR).
 * Does not include The Oracle (no database account).
 */
export const BOT_NAME_TO_USER_ID: ReadonlyMap<string, string> = new Map(
  BOT_PROFILES
    .map(p => {
      const userId = getBotUserIdByKey(p.key);
      return userId ? [p.name, userId] as const : null;
    })
    .filter((entry): entry is readonly [string, string] => entry !== null),
);

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
