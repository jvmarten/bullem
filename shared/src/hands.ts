import { RANK_VALUES, SUIT_ORDER } from './constants.js';
import { HandCall, HandType, type Rank, type Suit } from './types.js';

export function isHigherHand(newHand: HandCall, currentHand: HandCall): boolean {
  if (newHand.type !== currentHand.type) {
    return newHand.type > currentHand.type;
  }

  switch (newHand.type) {
    case HandType.HIGH_CARD:
      return rankHigher(newHand.rank, (currentHand as typeof newHand).rank);

    case HandType.PAIR:
      return rankHigher(newHand.rank, (currentHand as typeof newHand).rank);

    case HandType.TWO_PAIR: {
      const curr = currentHand as typeof newHand;
      if (newHand.highRank !== curr.highRank) return rankHigher(newHand.highRank, curr.highRank);
      return rankHigher(newHand.lowRank, curr.lowRank);
    }

    case HandType.THREE_OF_A_KIND:
      return rankHigher(newHand.rank, (currentHand as typeof newHand).rank);

    case HandType.FLUSH:
      return suitHigher(newHand.suit, (currentHand as typeof newHand).suit);

    case HandType.STRAIGHT:
      return rankHigher(newHand.highRank, (currentHand as typeof newHand).highRank);

    case HandType.FULL_HOUSE: {
      const curr = currentHand as typeof newHand;
      if (newHand.threeRank !== curr.threeRank) return rankHigher(newHand.threeRank, curr.threeRank);
      return rankHigher(newHand.twoRank, curr.twoRank);
    }

    case HandType.FOUR_OF_A_KIND:
      return rankHigher(newHand.rank, (currentHand as typeof newHand).rank);

    case HandType.STRAIGHT_FLUSH: {
      const curr = currentHand as typeof newHand;
      if (newHand.suit !== curr.suit) return suitHigher(newHand.suit, curr.suit);
      return rankHigher(newHand.highRank, curr.highRank);
    }

    case HandType.ROYAL_FLUSH:
      return suitHigher(newHand.suit, (currentHand as typeof newHand).suit);

    default:
      return false;
  }
}

function rankHigher(a: Rank, b: Rank): boolean {
  return RANK_VALUES[a] > RANK_VALUES[b];
}

function suitHigher(a: Suit, b: Suit): boolean {
  return SUIT_ORDER[a] > SUIT_ORDER[b];
}

const HAND_TYPE_NAMES: Record<HandType, string> = {
  [HandType.HIGH_CARD]: 'High Card',
  [HandType.PAIR]: 'Pair',
  [HandType.TWO_PAIR]: 'Two Pair',
  [HandType.THREE_OF_A_KIND]: 'Three of a Kind',
  [HandType.FLUSH]: 'Flush',
  [HandType.STRAIGHT]: 'Straight',
  [HandType.FULL_HOUSE]: 'Full House',
  [HandType.FOUR_OF_A_KIND]: 'Four of a Kind',
  [HandType.STRAIGHT_FLUSH]: 'Straight Flush',
  [HandType.ROYAL_FLUSH]: 'Royal Flush',
};

const RANK_NAMES: Record<Rank, string> = {
  '2': '2s', '3': '3s', '4': '4s', '5': '5s', '6': '6s',
  '7': '7s', '8': '8s', '9': '9s', '10': '10s',
  'J': 'Jacks', 'Q': 'Queens', 'K': 'Kings', 'A': 'Aces',
};

const RANK_SINGULAR: Record<Rank, string> = {
  '2': '2', '3': '3', '4': '4', '5': '5', '6': '6',
  '7': '7', '8': '8', '9': '9', '10': '10',
  'J': 'Jack', 'Q': 'Queen', 'K': 'King', 'A': 'Ace',
};

function straightRange(highRank: Rank): string {
  const val = RANK_VALUES[highRank];
  const lowVal = val - 4;
  const lowRank = Object.entries(RANK_VALUES).find(([, v]) => v === lowVal)?.[0] ?? '?';
  return `${lowRank} to ${RANK_SINGULAR[highRank]}`;
}

export function handToString(hand: HandCall): string {
  switch (hand.type) {
    case HandType.HIGH_CARD:
      return `${RANK_SINGULAR[hand.rank]} High`;
    case HandType.PAIR:
      return `Pair of ${RANK_NAMES[hand.rank]}`;
    case HandType.TWO_PAIR:
      return `Two Pair, ${RANK_NAMES[hand.highRank]} and ${RANK_NAMES[hand.lowRank]}`;
    case HandType.THREE_OF_A_KIND:
      return `Three ${RANK_NAMES[hand.rank]}`;
    case HandType.FLUSH:
      return `Flush in ${hand.suit}`;
    case HandType.STRAIGHT:
      return `Straight, ${straightRange(hand.highRank)}`;
    case HandType.FULL_HOUSE:
      return `Full House, ${RANK_NAMES[hand.threeRank]} over ${RANK_NAMES[hand.twoRank]}`;
    case HandType.FOUR_OF_A_KIND:
      return `Four ${RANK_NAMES[hand.rank]}`;
    case HandType.STRAIGHT_FLUSH:
      return `Straight Flush in ${hand.suit}, ${straightRange(hand.highRank)}`;
    case HandType.ROYAL_FLUSH:
      return `Royal Flush in ${hand.suit}`;
  }
}

export function getHandTypeName(type: HandType): string {
  return HAND_TYPE_NAMES[type];
}
