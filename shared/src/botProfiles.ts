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
  /** If true, this bot uses CFR strategy instead of heuristic decision logic. */
  isCFR?: boolean;
}

// ── Default config — evolved-optimized baseline ─────────────────────────
//
// These values come directly from 50-generation evolution training.
// All personalities derive from this baseline. After each evolution run,
// update these values to the new champion's parameters so every bot
// in the matrix benefits from the latest training insights.

export const DEFAULT_BOT_PROFILE_CONFIG: Readonly<BotProfileConfig> = {
  bluffFrequency: 0.0,            // GTO bluff path is suboptimal — evolved to zero
  bullThreshold: 0.56,            // Slightly trusting — don't over-call bull
  riskTolerance: 0.99,            // Near-maximum boldness wins
  aggressionBias: 0.30,           // Prefer bull calls over raises
  lastChanceBluffRate: 0.49,      // Moderate last-chance raises
  openingBluffRate: 0.57,         // High opening bluffs hide info
  bullPhaseRaiseRate: 0.21,       // Selective bull-phase raises
  trustMultiplier: 1.21,          // Trust opponent reads
  cardCountSensitivity: 0.05,     // Near-zero — reactivity is exploitable
  headsUpAggression: 0.68,        // Aggressive in 1v1
  survivalPressure: 0.40,         // Moderate survival tightening
  bluffTargetSelection: 0.46,     // Balanced bluff targeting
  positionAwareness: 0.42,        // Low position dependency
  trueCallConfidence: 1.0,        // Maximum true-call decisiveness
  counterBluffRate: 0.62,         // Counter-bluffing is a key weapon
  bullPhaseBluffRate: 0.75,       // Bull-phase bluffs massively underutilized before
  openingHandTypePreference: 0.26, // Hides info at opening
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
      // Signature: low bluffFrequency, low riskTolerance, high survivalPressure, high bullThreshold
      bluffFrequency: 0.0,           // Evolved baseline — Rock never GTO-bluffs
      bullThreshold: 0.62,           // Signature: more cautious than evolved (0.56)
      riskTolerance: 0.47,           // Signature: conservative but 30% toward evolved (0.99)
      aggressionBias: 0.30,          // Evolved baseline
      lastChanceBluffRate: 0.30,     // Slightly below evolved — conservative
      openingBluffRate: 0.35,        // Below evolved — Rock doesn't bluff openings much
      bullPhaseRaiseRate: 0.21,      // Evolved baseline
      trustMultiplier: 1.21,         // Evolved baseline
      cardCountSensitivity: 0.05,    // Evolved baseline — reactivity hurts
      headsUpAggression: 0.55,       // Below evolved — still reserved 1v1
      survivalPressure: 0.60,        // Signature: tight near elimination
      bluffTargetSelection: 0.30,    // Safe bluffs — Rock doesn't jump big
      positionAwareness: 0.50,       // Near evolved baseline
      trueCallConfidence: 1.0,       // Evolved baseline — decisive true calls
      counterBluffRate: 0.35,        // Below evolved but real counter-bluffs now
      bullPhaseBluffRate: 0.40,      // Evolved insight: even Rock needs bull-phase bluffs
      openingHandTypePreference: 0.26, // Evolved baseline
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
      // Signature: low bullThreshold, high riskTolerance, high lastChanceBluffRate, low survivalPressure
      bluffFrequency: 0.0,           // Evolved baseline — targeted bluffs only
      bullThreshold: 0.40,           // Signature: aggressive bull-caller
      riskTolerance: 0.99,           // Evolved baseline — Bluffer was already bold
      aggressionBias: 0.40,          // Signature: more raise-happy than evolved (0.30)
      lastChanceBluffRate: 0.65,     // Signature: high last-chance raises
      openingBluffRate: 0.65,        // Above evolved — Bluffer opens aggressively
      bullPhaseRaiseRate: 0.30,      // Above evolved — more bull-phase raises
      trustMultiplier: 0.90,         // Signature: skeptical, less trusting than evolved
      cardCountSensitivity: 0.05,    // Evolved baseline
      headsUpAggression: 0.85,       // Signature: very aggressive heads-up
      survivalPressure: 0.25,        // Signature: loose near elimination
      bluffTargetSelection: 0.55,    // Slightly above evolved — ambitious bluffs
      positionAwareness: 0.42,       // Evolved baseline
      trueCallConfidence: 1.0,       // Evolved baseline — decisive true calls
      counterBluffRate: 0.70,        // Above evolved — counter-bluffing is Bluffer's strength
      bullPhaseBluffRate: 0.80,      // Above evolved — key weapon
      openingHandTypePreference: 0.26, // Evolved baseline
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
      // Signature: low riskTolerance, low bluffTargetSelection, moderate survivalPressure
      bluffFrequency: 0.0,           // Evolved baseline
      bullThreshold: 0.56,           // Evolved baseline
      riskTolerance: 0.50,           // Signature: cautious but bolder (30% toward 0.99)
      aggressionBias: 0.30,          // Evolved baseline
      lastChanceBluffRate: 0.40,     // Slightly below evolved — patient
      openingBluffRate: 0.45,        // Below evolved — cautious openers
      bullPhaseRaiseRate: 0.21,      // Evolved baseline
      trustMultiplier: 1.21,         // Evolved baseline
      cardCountSensitivity: 0.05,    // Evolved baseline
      headsUpAggression: 0.60,       // Below evolved — still patient 1v1
      survivalPressure: 0.50,        // Signature: tighter than evolved near elimination
      bluffTargetSelection: 0.25,    // Signature: safe incremental bluffs
      positionAwareness: 0.42,       // Evolved baseline
      trueCallConfidence: 1.0,       // Evolved baseline — decisive true calls
      counterBluffRate: 0.50,        // Below evolved but real counter-bluffs now
      bullPhaseBluffRate: 0.55,      // Below evolved but big upgrade from 0.2
      openingHandTypePreference: 0.26, // Evolved baseline
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
      // Signature: low positionAwareness, low survivalPressure, high bluffTargetSelection
      bluffFrequency: 0.0,           // Evolved baseline
      bullThreshold: 0.48,           // Signature: slightly less trusting — unpredictable
      riskTolerance: 0.95,           // Near evolved — Wildcard was already bold
      aggressionBias: 0.38,          // Signature: more raise-happy than evolved (chaotic)
      lastChanceBluffRate: 0.55,     // Above evolved — chaotic last-chance plays
      openingBluffRate: 0.57,        // Evolved baseline
      bullPhaseRaiseRate: 0.28,      // Above evolved — more unpredictable raises
      trustMultiplier: 1.00,         // Signature: neutral trust — chaos doesn't commit
      cardCountSensitivity: 0.05,    // Evolved baseline
      headsUpAggression: 0.75,       // Above evolved — very aggressive heads-up
      survivalPressure: 0.28,        // Signature: chaotic near elimination
      bluffTargetSelection: 0.60,    // Signature: ambitious bluff jumps
      positionAwareness: 0.25,       // Signature: ignores position — that's Wildcard
      trueCallConfidence: 0.90,      // Below evolved but much improved from 0.75
      counterBluffRate: 0.62,        // Evolved baseline
      bullPhaseBluffRate: 0.75,      // Evolved baseline — key weapon
      openingHandTypePreference: 0.26, // Evolved baseline
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
      // Signature: closest to evolved — the "textbook" bot. Near-identical to baseline.
      bluffFrequency: 0.0,           // Evolved baseline
      bullThreshold: 0.56,           // Evolved baseline
      riskTolerance: 0.95,           // Near evolved — Professor plays optimal
      aggressionBias: 0.30,          // Evolved baseline
      lastChanceBluffRate: 0.49,     // Evolved baseline
      openingBluffRate: 0.57,        // Evolved baseline
      bullPhaseRaiseRate: 0.21,      // Evolved baseline
      trustMultiplier: 1.21,         // Evolved baseline
      cardCountSensitivity: 0.05,    // Evolved baseline
      headsUpAggression: 0.68,       // Evolved baseline
      survivalPressure: 0.40,        // Evolved baseline
      bluffTargetSelection: 0.46,    // Evolved baseline
      positionAwareness: 0.42,       // Evolved baseline
      trueCallConfidence: 1.0,       // Evolved baseline
      counterBluffRate: 0.62,        // Evolved baseline
      bullPhaseBluffRate: 0.75,      // Evolved baseline
      openingHandTypePreference: 0.26, // Evolved baseline
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
      // Signature: high trustMultiplier, high positionAwareness, exploitative counter-bluffs
      bluffFrequency: 0.0,           // Evolved baseline
      bullThreshold: 0.52,           // Signature: slightly more aggressive bull-caller (reads)
      riskTolerance: 0.90,           // Near evolved — Shark plays bold when reads are good
      aggressionBias: 0.30,          // Evolved baseline
      lastChanceBluffRate: 0.49,     // Evolved baseline
      openingBluffRate: 0.57,        // Evolved baseline
      bullPhaseRaiseRate: 0.21,      // Evolved baseline
      trustMultiplier: 1.40,         // Signature: trusts reads heavily
      cardCountSensitivity: 0.10,    // Signature: slight card-count awareness for reads
      headsUpAggression: 0.72,       // Slightly above evolved — aggressive with reads
      survivalPressure: 0.40,        // Evolved baseline
      bluffTargetSelection: 0.46,    // Evolved baseline
      positionAwareness: 0.55,       // Signature: above evolved — position matters for reads
      trueCallConfidence: 1.0,       // Evolved baseline — commit to reads
      counterBluffRate: 0.70,        // Signature: above evolved — exploitative counter-bluffs
      bullPhaseBluffRate: 0.75,      // Evolved baseline
      openingHandTypePreference: 0.26, // Evolved baseline
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
      // Signature: high riskTolerance, high bluffTargetSelection, high aggressionBias, low survivalPressure
      bluffFrequency: 0.0,           // Evolved baseline
      bullThreshold: 0.50,           // Signature: slightly aggressive bull-caller
      riskTolerance: 0.99,           // Evolved baseline — Cannon was already here
      aggressionBias: 0.45,          // Signature: more raise-happy than evolved
      lastChanceBluffRate: 0.60,     // Signature: high last-chance raises
      openingBluffRate: 0.65,        // Above evolved — Cannon opens big
      bullPhaseRaiseRate: 0.30,      // Above evolved — more bull-phase raises
      trustMultiplier: 1.05,         // Below evolved — Cannon is skeptical
      cardCountSensitivity: 0.05,    // Evolved baseline
      headsUpAggression: 0.85,       // Signature: very aggressive heads-up
      survivalPressure: 0.20,        // Signature: full send, no fear
      bluffTargetSelection: 0.65,    // Signature: big hand-type jumps
      positionAwareness: 0.42,       // Evolved baseline
      trueCallConfidence: 1.0,       // Evolved baseline — decisive true calls
      counterBluffRate: 0.65,        // Above evolved — Cannon loves counter-bluffing
      bullPhaseBluffRate: 0.80,      // Above evolved — major weapon for Cannon
      openingHandTypePreference: 0.26, // Evolved baseline
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
      // Signature: low riskTolerance, low aggressionBias, high survivalPressure, high bullThreshold
      bluffFrequency: 0.0,           // Evolved baseline
      bullThreshold: 0.62,           // Signature: cautious bull-caller
      riskTolerance: 0.50,           // Signature: tight but 30% toward evolved (0.99)
      aggressionBias: 0.22,          // Signature: low aggression — Frost's discipline
      lastChanceBluffRate: 0.35,     // Below evolved — conservative
      openingBluffRate: 0.40,        // Below evolved — cautious openers
      bullPhaseRaiseRate: 0.15,      // Below evolved — selective
      trustMultiplier: 1.21,         // Evolved baseline
      cardCountSensitivity: 0.05,    // Evolved baseline
      headsUpAggression: 0.55,       // Below evolved — still reserved 1v1
      survivalPressure: 0.60,        // Signature: tight near elimination
      bluffTargetSelection: 0.30,    // Signature: precise, minimal escalation
      positionAwareness: 0.50,       // Near evolved baseline
      trueCallConfidence: 1.0,       // Evolved baseline — Frost commits when sure
      counterBluffRate: 0.40,        // Below evolved but real counter-bluffs now
      bullPhaseBluffRate: 0.45,      // Below evolved but huge upgrade from 0.15
      openingHandTypePreference: 0.30, // Near evolved baseline
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
      // Signature: balanced but exploitative — high openingBluffRate, moderate aggression
      bluffFrequency: 0.0,           // Evolved baseline
      bullThreshold: 0.52,           // Signature: slightly more aggressive bull-caller
      riskTolerance: 0.90,           // Near evolved — Hustler plays bold
      aggressionBias: 0.35,          // Signature: slightly more raise-happy than evolved
      lastChanceBluffRate: 0.55,     // Above evolved — well-timed last-chance plays
      openingBluffRate: 0.65,        // Signature: above evolved — Hustler opens strong
      bullPhaseRaiseRate: 0.25,      // Slightly above evolved
      trustMultiplier: 1.10,         // Below evolved — Hustler is skeptical
      cardCountSensitivity: 0.05,    // Evolved baseline
      headsUpAggression: 0.78,       // Signature: aggressive heads-up — above evolved
      survivalPressure: 0.35,        // Signature: plays loose near elimination
      bluffTargetSelection: 0.50,    // Slightly above evolved — well-timed jumps
      positionAwareness: 0.42,       // Evolved baseline
      trueCallConfidence: 1.0,       // Evolved baseline
      counterBluffRate: 0.65,        // Above evolved — key hustling move
      bullPhaseBluffRate: 0.75,      // Evolved baseline
      openingHandTypePreference: 0.26, // Evolved baseline
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
 * Unskilled config — what a level-1 bot looks like.
 * Raised ~40% toward evolved baseline so even easy bots play competently.
 * They still lack personality refinement and make noisier decisions,
 * but they're not pushovers. Level scaling lerps from here to personality lvl9.
 */
const UNSKILLED_CONFIG: Readonly<BotProfileConfig> = {
  bluffFrequency: 0.55,          // 40% toward evolved (0.0) from old 0.9
  bullThreshold: 0.52,           // Slightly trusting direction
  riskTolerance: 0.70,           // Noticeably bolder than before (was 0.5)
  aggressionBias: 0.42,          // Slightly less raise-happy
  lastChanceBluffRate: 0.47,     // Moderate
  openingBluffRate: 0.41,        // Better info-hiding (was 0.30)
  bullPhaseRaiseRate: 0.19,      // Slightly more selective
  trustMultiplier: 0.87,         // More trusting (was 0.65)
  cardCountSensitivity: 0.50,    // Less reactive (was 0.8)
  headsUpAggression: 0.57,       // More aggressive 1v1 (was 0.5)
  survivalPressure: 0.46,        // Slightly tighter
  bluffTargetSelection: 0.48,    // Slightly safer targets
  positionAwareness: 0.47,       // Slightly less position-dependent
  trueCallConfidence: 0.73,      // Much more decisive (was 0.55)
  counterBluffRate: 0.34,        // Real counter-bluffs now (was 0.15)
  bullPhaseBluffRate: 0.36,      // Significant upgrade (was 0.1)
  openingHandTypePreference: 0.37, // Better info-hiding (was 0.45)
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

/** All 81 heuristic bot profiles (9 personalities × 9 levels). */
export const BOT_PROFILES: readonly BotProfileDefinition[] = generateBotMatrix();

/** The 9 base personality definitions (level-independent). */
export const BOT_PERSONALITIES: readonly PersonalityBase[] = PERSONALITY_BASES;

/** Map from profile key to profile definition for O(1) lookup. */
export const BOT_PROFILE_MAP: ReadonlyMap<string, BotProfileDefinition> = new Map(
  [
    ...BOT_PROFILES.map(p => [p.key, p] as const),
    [IMPOSSIBLE_BOT.key, IMPOSSIBLE_BOT],
    ...CFR_BOTS.map(p => [p.key, p] as const),
  ],
);

/** All valid profile keys. */
export const BOT_PROFILE_KEYS: readonly string[] = [
  ...BOT_PROFILES.map(p => p.key),
  IMPOSSIBLE_BOT.key,
  ...CFR_BOTS.map(p => p.key),
];

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
  // CFR bots
  ...CFR_BOTS.map(p => [p.name, p.avatar] as const),
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
