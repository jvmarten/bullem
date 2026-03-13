#!/usr/bin/env node

/**
 * Evaluate 5 Draw CFR dealer vs heuristic player strategies.
 *
 * Tests the dealer's win rate when the "player" side uses heuristic
 * decision-making of varying quality levels.
 *
 * Usage:
 *   npx tsx training/src/evaluateFiveDraw.ts [--games 50000]
 */

import type { Card, HandCall, Rank, Suit } from '@bull-em/shared';
import { HandType, HandChecker, isHigherHand, getMinimumRaise, RANK_VALUES, ALL_RANKS, ALL_SUITS } from '@bull-em/shared';
import { buildDeck, shuffleDeck } from '@bull-em/shared';
import { getDealerAction } from '@bull-em/shared';
import type { FiveDrawTurnEntry, FiveDrawParticipant } from '@bull-em/shared';

const gameCount = parseInt(
  process.argv.find((_, i) => process.argv[i - 1] === '--games') ?? '50000',
  10,
);

// ── Heuristic player strategies ──────────────────────────────────────

type PlayerStrategy = (
  myCards: Card[],
  currentHand: HandCall | null,
  turnCount: number,
) => { action: 'call' | 'pass'; hand?: HandCall };

/**
 * Aggressive heuristic: always raises with best truthful hand or small bluffs.
 * Passes only when claim is very high and no support.
 */
function aggressivePlayer(myCards: Card[], currentHand: HandCall | null): { action: 'call' | 'pass'; hand?: HandCall } {
  const hand = pickBestTruthfulHand(myCards, currentHand);
  if (hand) return { action: 'call', hand };

  // Bluff 40% of the time
  if (Math.random() < 0.4) {
    const bluff = pickBluff(currentHand, myCards);
    if (bluff) return { action: 'call', hand: bluff };
  }

  return { action: 'pass' };
}

/**
 * Balanced heuristic: raises truthfully when possible, bluffs occasionally.
 * More selective than aggressive.
 */
function balancedPlayer(myCards: Card[], currentHand: HandCall | null): { action: 'call' | 'pass'; hand?: HandCall } {
  const hand = pickBestTruthfulHand(myCards, currentHand);
  if (hand) return { action: 'call', hand };

  // Bluff 20% of the time
  if (Math.random() < 0.2) {
    const bluff = pickBluff(currentHand, myCards);
    if (bluff) return { action: 'call', hand: bluff };
  }

  return { action: 'pass' };
}

/**
 * Passive heuristic: only raises with strong truthful hands, rarely bluffs.
 */
function passivePlayer(myCards: Card[], currentHand: HandCall | null): { action: 'call' | 'pass'; hand?: HandCall } {
  const hand = pickBestTruthfulHand(myCards, currentHand);
  if (hand && hand.type >= HandType.PAIR) return { action: 'call', hand };

  // Bluff 5% of the time
  if (Math.random() < 0.05) {
    const bluff = pickBluff(currentHand, myCards);
    if (bluff) return { action: 'call', hand: bluff };
  }

  return { action: 'pass' };
}

/**
 * Random heuristic: makes random legal moves.
 */
function randomPlayer(myCards: Card[], currentHand: HandCall | null): { action: 'call' | 'pass'; hand?: HandCall } {
  if (currentHand && Math.random() < 0.5) {
    return { action: 'pass' };
  }
  const hand = pickRandomValidHand(myCards, currentHand);
  if (hand) return { action: 'call', hand };
  return { action: 'pass' };
}

/**
 * Smart heuristic: uses card counting and hand probability estimation.
 * Closer to what a good human player would do.
 */
function smartPlayer(myCards: Card[], currentHand: HandCall | null): { action: 'call' | 'pass'; hand?: HandCall } {
  // If we can raise truthfully, do it
  const truthful = pickBestTruthfulHand(myCards, currentHand);
  if (truthful) return { action: 'call', hand: truthful };

  // Estimate if current hand could exist across 10 cards
  // With 5 unknown opponent cards, many low hands are likely
  if (currentHand) {
    const claimHeight = currentHand.type;

    // Against high claims, pass (they likely exist with 10 cards or are risky bluffs)
    if (claimHeight >= HandType.STRAIGHT) {
      return { action: 'pass' };
    }

    // Against mid claims, bluff 25%
    if (claimHeight >= HandType.TWO_PAIR) {
      if (Math.random() < 0.25) {
        const bluff = pickBluff(currentHand, myCards);
        if (bluff) return { action: 'call', hand: bluff };
      }
      return { action: 'pass' };
    }

    // Against low claims, bluff 35%
    if (Math.random() < 0.35) {
      const bluff = pickBluff(currentHand, myCards);
      if (bluff) return { action: 'call', hand: bluff };
    }
  }

  return { action: 'pass' };
}

// ── Hand generation helpers ──────────────────────────────────────────

function pickBestTruthfulHand(myCards: Card[], currentHand: HandCall | null): HandCall | null {
  const candidates: HandCall[] = [];
  if (myCards.length === 0) return null;

  const rankCounts = new Map<Rank, number>();
  const suitCounts = new Map<Suit, number>();
  for (const c of myCards) {
    rankCounts.set(c.rank, (rankCounts.get(c.rank) ?? 0) + 1);
    suitCounts.set(c.suit, (suitCounts.get(c.suit) ?? 0) + 1);
  }

  const bestRank = myCards.reduce(
    (best, c) => RANK_VALUES[c.rank] > RANK_VALUES[best] ? c.rank : best,
    myCards[0]!.rank,
  );

  // High card
  candidates.push({ type: HandType.HIGH_CARD, rank: bestRank });

  // Pairs and better from groups
  for (const [rank, count] of rankCounts) {
    candidates.push({ type: HandType.PAIR, rank });
    if (count >= 2) {
      candidates.push({ type: HandType.PAIR, rank });
      candidates.push({ type: HandType.THREE_OF_A_KIND, rank });
    }
    if (count >= 3) {
      candidates.push({ type: HandType.THREE_OF_A_KIND, rank });
    }
  }

  // Two pair
  const pairRanks = [...rankCounts.entries()].filter(([, c]) => c >= 2).map(([r]) => r);
  if (pairRanks.length >= 2) {
    const sorted = pairRanks.sort((a, b) => RANK_VALUES[b] - RANK_VALUES[a]);
    candidates.push({ type: HandType.TWO_PAIR, highRank: sorted[0]!, lowRank: sorted[1]! });
  }

  // Flush
  for (const [suit, count] of suitCounts) {
    if (count >= 2) {
      candidates.push({ type: HandType.FLUSH, suit });
    }
  }

  // Filter valid raises
  const valid = currentHand
    ? candidates.filter(h => isHigherHand(h, currentHand))
    : candidates;

  if (valid.length === 0) return null;

  // Sort and pick lowest valid (conservative truthful)
  valid.sort((a, b) => {
    if (a.type !== b.type) return a.type - b.type;
    const aRank = 'rank' in a ? RANK_VALUES[a.rank as Rank] : ('highRank' in a ? RANK_VALUES[a.highRank as Rank] : 0);
    const bRank = 'rank' in b ? RANK_VALUES[b.rank as Rank] : ('highRank' in b ? RANK_VALUES[b.highRank as Rank] : 0);
    return aRank - bRank;
  });

  return valid[0]!;
}

function pickBluff(currentHand: HandCall | null, myCards: Card[]): HandCall | null {
  if (!currentHand) {
    // Opening: just pick a pair
    const rank = myCards[Math.floor(Math.random() * myCards.length)]!.rank;
    return { type: HandType.PAIR, rank };
  }

  const minRaise = getMinimumRaise(currentHand);
  if (!minRaise) return null;

  // Small bluff: just the minimum raise
  return minRaise;
}

function pickRandomValidHand(myCards: Card[], currentHand: HandCall | null): HandCall | null {
  const options: HandCall[] = [];

  for (const card of myCards) {
    options.push({ type: HandType.HIGH_CARD, rank: card.rank });
    options.push({ type: HandType.PAIR, rank: card.rank });
  }

  const valid = currentHand ? options.filter(h => isHigherHand(h, currentHand)) : options;
  if (valid.length === 0) {
    if (currentHand) {
      const min = getMinimumRaise(currentHand);
      return min ?? null;
    }
    return null;
  }
  return valid[Math.floor(Math.random() * valid.length)]!;
}

// ── Simulation ───────────────────────────────────────────────────────

interface EvalResult {
  dealerWins: number;
  playerWins: number;
  games: number;
  dealerWinsAsLastCaller: number;
  dealerWinsAsPasser: number;
  handExistsRate: number;
  avgTurns: number;
}

function evaluate(playerFn: PlayerStrategy, games: number): EvalResult {
  let dealerWins = 0;
  let playerWins = 0;
  let dealerWinsAsLastCaller = 0;
  let dealerWinsAsPasser = 0;
  let handExistsTotal = 0;
  let totalTurns = 0;

  for (let i = 0; i < games; i++) {
    const deck = shuffleDeck(buildDeck());
    const playerCards = deck.slice(0, 5);
    const dealerCards = deck.slice(5, 10);
    const allCards = [...playerCards, ...dealerCards];

    let currentHand: HandCall | null = null;
    let lastCaller: FiveDrawParticipant = 'player';
    let currentParticipant: FiveDrawParticipant = 'player'; // player always opens
    let turnCount = 0;
    const turnHistory: FiveDrawTurnEntry[] = [];

    for (let turn = 0; turn < 100; turn++) {
      let decision: { action: 'call' | 'pass'; hand?: HandCall };

      if (currentParticipant === 'dealer') {
        // CFR dealer (via getDealerAction which uses decideFiveDrawCFR internally)
        const dealerEntry = getDealerAction(dealerCards, currentHand, turnHistory);
        decision = { action: dealerEntry.action, hand: dealerEntry.hand };
      } else {
        // Heuristic player
        decision = playerFn(playerCards, currentHand, turnCount);
      }

      if (decision.action === 'pass') {
        turnHistory.push({ participant: currentParticipant, action: 'pass' });
        break;
      }

      if (decision.hand && (!currentHand || isHigherHand(decision.hand, currentHand))) {
        currentHand = decision.hand;
        lastCaller = currentParticipant;
        turnHistory.push({ participant: currentParticipant, action: 'call', hand: decision.hand });
      } else {
        // Invalid raise = pass
        turnHistory.push({ participant: currentParticipant, action: 'pass' });
        break;
      }

      turnCount++;
      currentParticipant = currentParticipant === 'player' ? 'dealer' : 'player';
    }

    if (!currentHand) {
      // No valid call made — player failed to open (shouldn't happen)
      playerWins++;
      continue;
    }

    const handExists = HandChecker.exists(allCards, currentHand);
    if (handExists) handExistsTotal++;

    const winner: FiveDrawParticipant = handExists ? lastCaller : (lastCaller === 'player' ? 'dealer' : 'player');

    if (winner === 'dealer') {
      dealerWins++;
      if (lastCaller === 'dealer') dealerWinsAsLastCaller++;
      else dealerWinsAsPasser++;
    } else {
      playerWins++;
    }
    totalTurns += turnCount + 1;
  }

  return {
    dealerWins,
    playerWins,
    games,
    dealerWinsAsLastCaller,
    dealerWinsAsPasser,
    handExistsRate: handExistsTotal / games,
    avgTurns: totalTurns / games,
  };
}

// ── Run evaluations ──────────────────────────────────────────────────

const strategies: Array<{ name: string; fn: PlayerStrategy; desc: string }> = [
  { name: 'Random',     fn: randomPlayer,     desc: 'Random legal moves' },
  { name: 'Passive',    fn: passivePlayer,     desc: 'Only strong truthful hands, 5% bluff' },
  { name: 'Balanced',   fn: balancedPlayer,    desc: 'Truthful + 20% bluff' },
  { name: 'Aggressive', fn: aggressivePlayer,  desc: 'Truthful + 40% bluff' },
  { name: 'Smart',      fn: smartPlayer,       desc: 'Card-counting, adaptive bluffing' },
];

console.log(`\n═══════════════════════════════════════════════════════════════`);
console.log(`  5 Draw CFR Dealer vs Heuristic Players (${gameCount.toLocaleString()} games each)`);
console.log(`═══════════════════════════════════════════════════════════════\n`);

const results: Array<{ name: string; result: EvalResult }> = [];

for (const { name, fn, desc } of strategies) {
  const result = evaluate(fn, gameCount);
  results.push({ name, result });

  const winPct = (result.dealerWins / result.games * 100).toFixed(2);
  const asCallerPct = (result.dealerWinsAsLastCaller / result.games * 100).toFixed(1);
  const asPasserPct = (result.dealerWinsAsPasser / result.games * 100).toFixed(1);

  console.log(`  vs ${name.padEnd(12)} — Dealer wins: ${winPct}%  (as caller: ${asCallerPct}%, as passer: ${asPasserPct}%)  avg turns: ${result.avgTurns.toFixed(1)}  hand exists: ${(result.handExistsRate * 100).toFixed(1)}%`);
  console.log(`    ${' '.repeat(14)}  (${desc})`);
}

console.log(`\n  ─────────────────────────────────────────────────────────`);
console.log(`  Summary:`);
const avgDealerWinRate = results.reduce((s, r) => s + r.result.dealerWins / r.result.games, 0) / results.length * 100;
console.log(`    Average dealer win rate across all opponents: ${avgDealerWinRate.toFixed(2)}%`);

// Highlight best/worst matchup
const best = results.reduce((a, b) => a.result.dealerWins > b.result.dealerWins ? a : b);
const worst = results.reduce((a, b) => a.result.dealerWins < b.result.dealerWins ? a : b);
console.log(`    Best matchup:  vs ${best.name} — ${(best.result.dealerWins / best.result.games * 100).toFixed(2)}%`);
console.log(`    Worst matchup: vs ${worst.name} — ${(worst.result.dealerWins / worst.result.games * 100).toFixed(2)}%`);

console.log(`\n═══════════════════════════════════════════════════════════════\n`);
