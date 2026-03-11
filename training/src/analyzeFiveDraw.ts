#!/usr/bin/env node

/**
 * Analyze the 5 Draw minigame — position advantage, hand distribution,
 * and strategy patterns using the trained CFR strategy.
 *
 * Usage:
 *   npx tsx training/src/analyzeFiveDraw.ts [--games 100000]
 */

import type { Card, HandCall } from '@bull-em/shared';
import { HandChecker, HandType, isHigherHand, getMinimumRaise } from '@bull-em/shared';
import { buildDeck, shuffleDeck } from '@bull-em/shared';
import { handToString } from '@bull-em/shared';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  FiveDrawAction,
  getFiveDrawLegalActions,
  getFiveDrawInfoSetKey,
} from './cfr/fiveDrawInfoSet.js';
import { mapFiveDrawAction } from './cfr/fiveDrawActionMapper.js';

// Load strategy from latest file
const STRATEGIES_DIR = path.resolve(import.meta.dirname, '../strategies');
const strategyFiles = fs.readdirSync(STRATEGIES_DIR)
  .filter(f => f.startsWith('five-draw-strategy-') && f.endsWith('.json'))
  .sort((a, b) => {
    const numA = parseInt(a.match(/five-draw-strategy-(\d+)/)?.[1] ?? '0', 10);
    const numB = parseInt(b.match(/five-draw-strategy-(\d+)/)?.[1] ?? '0', 10);
    return numA - numB;
  });

const latestFile = strategyFiles[strategyFiles.length - 1];
if (!latestFile) {
  console.error('No strategy file found. Run training first.');
  process.exit(1);
}

const strategyData = JSON.parse(
  fs.readFileSync(path.join(STRATEGIES_DIR, latestFile), 'utf-8')
);
const STRATEGY: Record<string, Record<string, number>> = strategyData.strategy;

console.log(`Loaded strategy: ${latestFile} (${Object.keys(STRATEGY).length} info sets)`);

// Parse args
const gameCount = parseInt(process.argv.find((_, i) => process.argv[i - 1] === '--games') ?? '100000', 10);

// Stats tracking
let p1Wins = 0;
let p2Wins = 0;
let p1WinsAsLastCaller = 0;
let p2WinsAsLastCaller = 0;
let p1WinsAsPasser = 0;
let p2WinsAsPasser = 0;
let totalTurns = 0;
const turnCounts = new Map<number, number>();
const winByHandType = new Map<string, { p1: number; p2: number }>();
const handExistsCount = { yes: 0, no: 0 };

function sampleFromStrategy(
  infoSetKey: string,
  legalActions: FiveDrawAction[],
): FiveDrawAction {
  const entry = STRATEGY[infoSetKey];
  if (entry) {
    let totalProb = 0;
    for (const a of legalActions) totalProb += entry[a] ?? 0;
    if (totalProb > 0) {
      const r = Math.random() * totalProb;
      let cum = 0;
      for (const a of legalActions) {
        cum += entry[a] ?? 0;
        if (r <= cum) return a;
      }
    }
  }
  // Fallback: uniform
  return legalActions[Math.floor(Math.random() * legalActions.length)]!;
}

for (let game = 0; game < gameCount; game++) {
  const deck = shuffleDeck(buildDeck());
  const p1Cards = deck.slice(0, 5);
  const p2Cards = deck.slice(5, 10);
  const allCards = [...p1Cards, ...p2Cards];
  const cards: [Card[], Card[]] = [p1Cards, p2Cards];

  let currentHand: HandCall | null = null;
  let lastCaller: 0 | 1 = 0;
  let currentPlayer: 0 | 1 = 0;
  let turnCount = 0;

  for (let turn = 0; turn < 100; turn++) {
    const myCards = cards[currentPlayer]!;
    const isOpener = currentPlayer === 0;
    const legalActions = getFiveDrawLegalActions(currentHand);
    const infoSetKey = getFiveDrawInfoSetKey(myCards, currentHand, turnCount, isOpener);

    const chosenAction = sampleFromStrategy(infoSetKey, legalActions);
    const concrete = mapFiveDrawAction(chosenAction, currentHand, myCards);

    if (concrete.action === 'pass') break;

    if (concrete.hand && (!currentHand || isHigherHand(concrete.hand, currentHand))) {
      currentHand = concrete.hand;
      lastCaller = currentPlayer;
    } else {
      break;
    }

    turnCount++;
    currentPlayer = currentPlayer === 0 ? 1 : 0;
  }

  if (!currentHand) {
    p2Wins++;
    continue;
  }

  const handExists = HandChecker.exists(allCards, currentHand);
  const winner: 0 | 1 = handExists ? lastCaller : (lastCaller === 0 ? 1 : 0);
  const passer: 0 | 1 = lastCaller === 0 ? 1 : 0;

  if (handExists) {
    handExistsCount.yes++;
  } else {
    handExistsCount.no++;
  }

  if (winner === 0) {
    p1Wins++;
    if (lastCaller === 0) p1WinsAsLastCaller++;
    else p1WinsAsPasser++;
  } else {
    p2Wins++;
    if (lastCaller === 1) p2WinsAsLastCaller++;
    else p2WinsAsPasser++;
  }

  totalTurns += turnCount + 1; // +1 for the pass
  turnCounts.set(turnCount + 1, (turnCounts.get(turnCount + 1) ?? 0) + 1);

  const handTypeName = HandType[currentHand.type] ?? 'UNKNOWN';
  if (!winByHandType.has(handTypeName)) {
    winByHandType.set(handTypeName, { p1: 0, p2: 0 });
  }
  const ht = winByHandType.get(handTypeName)!;
  if (winner === 0) ht.p1++;
  else ht.p2++;
}

// ── Print results ───────────────────────────────────────────────────

console.log(`\n═══════════════════════════════════════════════════════════`);
console.log(`  5 Draw Position Advantage Analysis (${gameCount.toLocaleString()} games)`);
console.log(`═══════════════════════════════════════════════════════════\n`);

const total = p1Wins + p2Wins;
console.log(`  P1 (opener/first caller) wins:    ${p1Wins.toLocaleString()} (${(p1Wins / total * 100).toFixed(2)}%)`);
console.log(`  P2 (responder/second caller) wins: ${p2Wins.toLocaleString()} (${(p2Wins / total * 100).toFixed(2)}%)`);
console.log(`  Edge: P1 has +${((p1Wins / total - 0.5) * 100).toFixed(2)}% advantage`);

console.log(`\n  Win breakdown:`);
console.log(`    P1 wins as last caller: ${p1WinsAsLastCaller.toLocaleString()} (${(p1WinsAsLastCaller / total * 100).toFixed(1)}%)`);
console.log(`    P1 wins as passer:      ${p1WinsAsPasser.toLocaleString()} (${(p1WinsAsPasser / total * 100).toFixed(1)}%)`);
console.log(`    P2 wins as last caller: ${p2WinsAsLastCaller.toLocaleString()} (${(p2WinsAsLastCaller / total * 100).toFixed(1)}%)`);
console.log(`    P2 wins as passer:      ${p2WinsAsPasser.toLocaleString()} (${(p2WinsAsPasser / total * 100).toFixed(1)}%)`);

console.log(`\n  Hand existence at resolution:`);
console.log(`    Hand exists:   ${handExistsCount.yes.toLocaleString()} (${(handExistsCount.yes / total * 100).toFixed(1)}%)`);
console.log(`    Hand is fake:  ${handExistsCount.no.toLocaleString()} (${(handExistsCount.no / total * 100).toFixed(1)}%)`);

console.log(`\n  Turn distribution:`);
const avgTurns = totalTurns / total;
console.log(`    Average turns per game: ${avgTurns.toFixed(2)}`);
const sortedTurns = [...turnCounts.entries()].sort(([a], [b]) => a - b);
for (const [turns, count] of sortedTurns) {
  const bar = '#'.repeat(Math.round(count / total * 50));
  console.log(`    ${turns} turns: ${count.toLocaleString()} (${(count / total * 100).toFixed(1)}%) ${bar}`);
}

console.log(`\n  Win rate by last-called hand type:`);
const sortedHands = [...winByHandType.entries()].sort(([a], [b]) => {
  const order = ['HIGH_CARD', 'PAIR', 'TWO_PAIR', 'FLUSH', 'THREE_OF_A_KIND', 'STRAIGHT', 'FULL_HOUSE', 'FOUR_OF_A_KIND', 'STRAIGHT_FLUSH', 'ROYAL_FLUSH'];
  return order.indexOf(a) - order.indexOf(b);
});
for (const [handType, wins] of sortedHands) {
  const handTotal = wins.p1 + wins.p2;
  console.log(`    ${handType.padEnd(20)} — P1: ${(wins.p1 / handTotal * 100).toFixed(1)}% P2: ${(wins.p2 / handTotal * 100).toFixed(1)}% (${handTotal.toLocaleString()} games)`);
}

console.log(`\n═══════════════════════════════════════════════════════════\n`);
