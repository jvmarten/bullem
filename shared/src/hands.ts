import { RANK_VALUES, SUIT_ORDER, ALL_RANKS, ALL_SUITS } from './constants.js';
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
      // All flushes are equal — must raise to a higher hand type
      return false;

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
      // Royal Flush is the absolute highest hand — nothing can beat it
      return false;

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
  // Ace-low straight (A-2-3-4-5): lowVal is 1, but Ace has value 14
  const lowRank = lowVal < RANK_VALUES['2']
    ? 'Ace'
    : Object.entries(RANK_VALUES).find(([, v]) => v === lowVal)?.[0] ?? '?';
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

/** Returns the minimum valid hand that beats `currentHand`, or null if nothing can. */
export function getMinimumRaise(currentHand: HandCall): HandCall | null {
  function nextRank(r: Rank): Rank | null {
    const idx = ALL_RANKS.indexOf(r);
    return idx < ALL_RANKS.length - 1 ? ALL_RANKS[idx + 1] : null;
  }

  switch (currentHand.type) {
    case HandType.HIGH_CARD: {
      const nr = nextRank(currentHand.rank);
      if (nr) return { type: HandType.HIGH_CARD, rank: nr };
      return { type: HandType.PAIR, rank: '2' };
    }
    case HandType.PAIR: {
      const nr = nextRank(currentHand.rank);
      if (nr) return { type: HandType.PAIR, rank: nr };
      return { type: HandType.TWO_PAIR, highRank: '3', lowRank: '2' };
    }
    case HandType.TWO_PAIR: {
      const { highRank, lowRank } = currentHand;
      // Try next lowRank that's still below highRank
      for (let i = ALL_RANKS.indexOf(lowRank) + 1; i < ALL_RANKS.length; i++) {
        if (RANK_VALUES[ALL_RANKS[i]] < RANK_VALUES[highRank]) {
          return { type: HandType.TWO_PAIR, highRank, lowRank: ALL_RANKS[i] };
        }
      }
      const nh = nextRank(highRank);
      if (nh) return { type: HandType.TWO_PAIR, highRank: nh, lowRank: '2' };
      return { type: HandType.FLUSH, suit: 'clubs' };
    }
    case HandType.FLUSH:
      // All flushes are equal — must jump to next type
      return { type: HandType.THREE_OF_A_KIND, rank: '2' };
    case HandType.THREE_OF_A_KIND: {
      const nr = nextRank(currentHand.rank);
      if (nr) return { type: HandType.THREE_OF_A_KIND, rank: nr };
      return { type: HandType.STRAIGHT, highRank: '5' };
    }
    case HandType.STRAIGHT: {
      const nr = nextRank(currentHand.highRank);
      if (nr) return { type: HandType.STRAIGHT, highRank: nr };
      return { type: HandType.FULL_HOUSE, threeRank: '2', twoRank: '3' };
    }
    case HandType.FULL_HOUSE: {
      const { threeRank, twoRank } = currentHand;
      for (let i = ALL_RANKS.indexOf(twoRank) + 1; i < ALL_RANKS.length; i++) {
        if (ALL_RANKS[i] !== threeRank) {
          return { type: HandType.FULL_HOUSE, threeRank, twoRank: ALL_RANKS[i] };
        }
      }
      const nt = nextRank(threeRank);
      if (nt) {
        const lowestTwo: Rank = nt === '2' ? '3' : '2';
        return { type: HandType.FULL_HOUSE, threeRank: nt, twoRank: lowestTwo };
      }
      return { type: HandType.FOUR_OF_A_KIND, rank: '2' };
    }
    case HandType.FOUR_OF_A_KIND: {
      const nr = nextRank(currentHand.rank);
      if (nr) return { type: HandType.FOUR_OF_A_KIND, rank: nr };
      return { type: HandType.STRAIGHT_FLUSH, suit: 'clubs', highRank: '5' };
    }
    case HandType.STRAIGHT_FLUSH: {
      const { suit: sfSuit, highRank: sfHigh } = currentHand;
      const nr = nextRank(sfHigh);
      // Next rank in same suit (K+1 would be Ace = Royal Flush, different type)
      if (nr && nr !== 'A') {
        return { type: HandType.STRAIGHT_FLUSH, suit: sfSuit, highRank: nr };
      }
      // Try next suit with lowest straight flush
      const suitIdx = ALL_SUITS.indexOf(sfSuit);
      if (suitIdx < ALL_SUITS.length - 1) {
        return { type: HandType.STRAIGHT_FLUSH, suit: ALL_SUITS[suitIdx + 1], highRank: '5' };
      }
      return { type: HandType.ROYAL_FLUSH, suit: 'clubs' };
    }
    case HandType.ROYAL_FLUSH:
      return null;
  }
}
