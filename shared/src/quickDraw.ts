import { RANK_VALUES, ALL_RANKS, ALL_SUITS } from './constants.js';
import { isHigherHand, handToString } from './hands.js';
import type { Card, HandCall, Rank, Suit } from './types.js';
import { HandType } from './types.js';

export interface QuickDrawSuggestion {
  hand: HandCall;
  label: string;
  /** Relative aggression: 'safe' = truth-based, 'ambitious' = small bluff, 'bold' = bigger bluff */
  tier: 'safe' | 'ambitious' | 'bold';
}

interface CardAnalysis {
  rankCounts: Map<Rank, number>;
  suitCounts: Map<Suit, number>;
  ranks: Rank[];
  suits: Suit[];
  highestRank: Rank;
  /** Pairs found in hand, sorted by rank descending */
  pairs: Rank[];
  /** Trips found in hand */
  trips: Rank[];
  /** Quads found in hand */
  quads: Rank[];
  /** Longest run of consecutive ranks (for straight potential) */
  longestRun: { ranks: Rank[]; highRank: Rank } | null;
  /** Best flush suit (most cards of one suit) */
  bestFlushSuit: Suit | null;
  bestFlushCount: number;
}

function analyzeCards(cards: Card[]): CardAnalysis {
  const rankCounts = new Map<Rank, number>();
  const suitCounts = new Map<Suit, number>();

  for (const card of cards) {
    rankCounts.set(card.rank, (rankCounts.get(card.rank) ?? 0) + 1);
    suitCounts.set(card.suit, (suitCounts.get(card.suit) ?? 0) + 1);
  }

  const ranks = cards.map(c => c.rank);
  const suits = cards.map(c => c.suit);

  let highestRank: Rank = '2';
  for (const r of ranks) {
    if (RANK_VALUES[r] > RANK_VALUES[highestRank]) highestRank = r;
  }

  const pairs: Rank[] = [];
  const trips: Rank[] = [];
  const quads: Rank[] = [];
  for (const [rank, count] of rankCounts) {
    if (count >= 4) quads.push(rank);
    else if (count >= 3) trips.push(rank);
    else if (count >= 2) pairs.push(rank);
  }

  // Sort by rank value descending
  const sortByRankDesc = (a: Rank, b: Rank) => RANK_VALUES[b] - RANK_VALUES[a];
  pairs.sort(sortByRankDesc);
  trips.sort(sortByRankDesc);
  quads.sort(sortByRankDesc);

  // Find longest consecutive run
  const uniqueRankValues = [...new Set(ranks.map(r => RANK_VALUES[r]))].sort((a, b) => a - b);
  let longestRun: { ranks: Rank[]; highRank: Rank } | null = null;
  if (uniqueRankValues.length >= 2) {
    let currentRun: number[] = [uniqueRankValues[0]!];
    let bestRun: number[] = currentRun;
    for (let i = 1; i < uniqueRankValues.length; i++) {
      if (uniqueRankValues[i]! === uniqueRankValues[i - 1]! + 1) {
        currentRun.push(uniqueRankValues[i]!);
      } else {
        if (currentRun.length > bestRun.length) bestRun = currentRun;
        currentRun = [uniqueRankValues[i]!];
      }
    }
    if (currentRun.length > bestRun.length) bestRun = currentRun;

    if (bestRun.length >= 2) {
      const runRanks = bestRun.map(v => ALL_RANKS.find(r => RANK_VALUES[r] === v)!);
      longestRun = { ranks: runRanks, highRank: runRanks[runRanks.length - 1]! };
    }
  }

  // Best flush suit
  let bestFlushSuit: Suit | null = null;
  let bestFlushCount = 0;
  for (const [suit, count] of suitCounts) {
    if (count > bestFlushCount) {
      bestFlushCount = count;
      bestFlushSuit = suit;
    }
  }

  return {
    rankCounts, suitCounts, ranks, suits, highestRank,
    pairs, trips, quads, longestRun,
    bestFlushSuit, bestFlushCount,
  };
}

function nextRank(r: Rank): Rank | null {
  const idx = ALL_RANKS.indexOf(r);
  return idx < ALL_RANKS.length - 1 ? ALL_RANKS[idx + 1]! : null;
}

/** Check if a candidate hand is a valid raise above currentHand. */
function isValidRaise(candidate: HandCall, currentHand: HandCall | null): boolean {
  if (!currentHand) return true;
  return isHigherHand(candidate, currentHand);
}

/** Compare two HandCalls: returns negative if a < b, positive if a > b, 0 if equal. */
function compareHands(a: HandCall, b: HandCall): number {
  if (a.type !== b.type) return a.type - b.type;
  // Within same type, compare by primary rank value
  const aRank = 'rank' in a ? RANK_VALUES[a.rank] : 'highRank' in a ? RANK_VALUES[a.highRank] : 'threeRank' in a ? RANK_VALUES[a.threeRank] : 0;
  const bRank = 'rank' in b ? RANK_VALUES[b.rank] : 'highRank' in b ? RANK_VALUES[b.highRank] : 'threeRank' in b ? RANK_VALUES[b.threeRank] : 0;
  return aRank - bRank;
}

/**
 * Generate Quick Draw suggestions based on the player's actual cards and the current call.
 *
 * Returns exactly 3 suggestions sorted weakest to strongest (left to right), except in
 * rare late-game situations where fewer than 3 valid higher hands exist.
 * Every returned suggestion is guaranteed to pass `isHigherHand()` against `currentHand`.
 */
export function getQuickDrawSuggestions(
  myCards: Card[],
  currentHand: HandCall | null,
): QuickDrawSuggestion[] {
  if (myCards.length === 0) return [];

  const analysis = analyzeCards(myCards);
  const candidates: { hand: HandCall; tier: 'safe' | 'ambitious' | 'bold' }[] = [];

  // Generate candidates across all aggression tiers
  generateSafeCandidates(analysis, candidates);
  generateAmbitiousCandidates(analysis, candidates);
  generateBoldCandidates(analysis, candidates);

  // Filter: all must be valid raises above currentHand
  const valid = candidates.filter(c => isValidRaise(c.hand, currentHand));

  // Deduplicate by hand string and sort weakest to strongest
  const seen = new Set<string>();
  const deduped: typeof valid = [];
  for (const c of valid) {
    const key = handToString(c.hand);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(c);
    }
  }
  deduped.sort((a, b) => compareHands(a.hand, b.hand));

  // If 3 or fewer unique hands, return all (sorted weakest to strongest)
  if (deduped.length <= 3) {
    return deduped.map(c => ({ hand: c.hand, label: handToString(c.hand), tier: c.tier }));
  }

  // Pick 3 well-distributed options: weakest, middle, strongest
  const first = deduped[0]!;
  const last = deduped[deduped.length - 1]!;
  const midIdx = Math.floor(deduped.length / 2);
  const mid = deduped[midIdx]!;

  // Assign tiers based on position: weakest=safe, middle=ambitious, strongest=bold
  return [
    { hand: first.hand, label: handToString(first.hand), tier: 'safe' as const },
    { hand: mid.hand, label: handToString(mid.hand), tier: 'ambitious' as const },
    { hand: last.hand, label: handToString(last.hand), tier: 'bold' as const },
  ];
}

function generateSafeCandidates(
  analysis: CardAnalysis,
  candidates: { hand: HandCall; tier: 'safe' | 'ambitious' | 'bold' }[],
): void {
  // Quads
  for (const rank of analysis.quads) {
    candidates.push({ hand: { type: HandType.FOUR_OF_A_KIND, rank }, tier: 'safe' });
  }

  // Trips
  for (const rank of analysis.trips) {
    candidates.push({ hand: { type: HandType.THREE_OF_A_KIND, rank }, tier: 'safe' });
  }

  // Pairs
  for (const rank of analysis.pairs) {
    candidates.push({ hand: { type: HandType.PAIR, rank }, tier: 'safe' });
  }

  // Two pair (if we have 2+ pairs)
  if (analysis.pairs.length >= 2) {
    candidates.push({
      hand: { type: HandType.TWO_PAIR, highRank: analysis.pairs[0]!, lowRank: analysis.pairs[1]! },
      tier: 'safe',
    });
  }

  // Full house from trips + pairs
  if (analysis.trips.length > 0 && analysis.pairs.length > 0) {
    candidates.push({
      hand: { type: HandType.FULL_HOUSE, threeRank: analysis.trips[0]!, twoRank: analysis.pairs[0]! },
      tier: 'safe',
    });
  }

  // Flush (if all same suit — only truly "safe" if we hold 5 of same suit, but with few cards any suit is a partial truth)
  if (analysis.bestFlushSuit && analysis.bestFlushCount >= 2) {
    candidates.push({ hand: { type: HandType.FLUSH, suit: analysis.bestFlushSuit }, tier: 'safe' });
  }

  // High card — always available as the safest safe
  candidates.push({ hand: { type: HandType.HIGH_CARD, rank: analysis.highestRank }, tier: 'safe' });
}

function generateAmbitiousCandidates(
  analysis: CardAnalysis,
  candidates: { hand: HandCall; tier: 'safe' | 'ambitious' | 'bold' }[],
): void {
  // Pair → Three of a Kind (bluff having one more)
  for (const rank of analysis.pairs) {
    candidates.push({ hand: { type: HandType.THREE_OF_A_KIND, rank }, tier: 'ambitious' });
  }

  // Three of a kind → Four of a kind
  for (const rank of analysis.trips) {
    candidates.push({ hand: { type: HandType.FOUR_OF_A_KIND, rank }, tier: 'ambitious' });
  }

  // High card → Pair of that rank (bluff having a match somewhere)
  candidates.push({ hand: { type: HandType.PAIR, rank: analysis.highestRank }, tier: 'ambitious' });

  // If we have a run of 3+, bluff a straight
  if (analysis.longestRun && analysis.longestRun.ranks.length >= 3) {
    // Find the best straight high rank: need 5 consecutive, so the high card of a straight
    // must be at least 5. Take the run's high rank and project to a full straight.
    const runHigh = RANK_VALUES[analysis.longestRun.highRank];
    const straightHigh = Math.max(runHigh, 5);
    const straightHighRank = ALL_RANKS.find(r => RANK_VALUES[r] === straightHigh);
    if (straightHighRank && RANK_VALUES[straightHighRank] >= 5) {
      candidates.push({
        hand: { type: HandType.STRAIGHT, highRank: straightHighRank },
        tier: 'ambitious',
      });
    }
  }

  // If we have 2+ suited cards, suggest flush
  if (analysis.bestFlushSuit && analysis.bestFlushCount >= 1) {
    candidates.push({ hand: { type: HandType.FLUSH, suit: analysis.bestFlushSuit }, tier: 'ambitious' });
  }
}

function generateBoldCandidates(
  analysis: CardAnalysis,
  candidates: { hand: HandCall; tier: 'safe' | 'ambitious' | 'bold' }[],
): void {
  // Jump to straight (even without a run)
  // Pick a straight that includes our highest card
  const highVal = RANK_VALUES[analysis.highestRank];
  const straightHigh = Math.max(highVal, 5);
  const straightHighRank = ALL_RANKS.find(r => RANK_VALUES[r] === straightHigh);
  if (straightHighRank) {
    candidates.push({
      hand: { type: HandType.STRAIGHT, highRank: straightHighRank },
      tier: 'bold',
    });
  }

  // Full house bluff — use our best rank as the three, pick a reasonable two
  const bestRank = analysis.trips[0] ?? analysis.pairs[0] ?? analysis.highestRank;
  const twoRank = ALL_RANKS.find(r => r !== bestRank) ?? '2';
  if (bestRank !== twoRank) {
    const [threeR, twoR] = RANK_VALUES[bestRank] > RANK_VALUES[twoRank]
      ? [bestRank, twoRank] : [twoRank, bestRank];
    candidates.push({
      hand: { type: HandType.FULL_HOUSE, threeRank: threeR, twoRank: twoR },
      tier: 'bold',
    });
  }

  // Four of a kind of our highest pair/trip rank
  if (analysis.pairs.length > 0) {
    candidates.push({
      hand: { type: HandType.FOUR_OF_A_KIND, rank: analysis.pairs[0]! },
      tier: 'bold',
    });
  }

  // Flush — bold if we only have 1 card of that suit
  if (analysis.bestFlushSuit) {
    candidates.push({
      hand: { type: HandType.FLUSH, suit: analysis.bestFlushSuit },
      tier: 'bold',
    });
  }

  // Bump our highest rank pair up (bluff higher pair)
  const bumpedRank = nextRank(analysis.highestRank);
  if (bumpedRank) {
    candidates.push({
      hand: { type: HandType.PAIR, rank: bumpedRank },
      tier: 'bold',
    });
  }
}
