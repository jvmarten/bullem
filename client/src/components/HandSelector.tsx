import { useState } from 'react';
import {
  HandType, ALL_RANKS, ALL_SUITS,
  isHigherHand, getHandTypeName,
} from '@bull-em/shared';
import type { HandCall, Rank, Suit } from '@bull-em/shared';

interface Props {
  currentHand: HandCall | null;
  onSubmit: (hand: HandCall) => void;
}

export function HandSelector({ currentHand, onSubmit }: Props) {
  const [handType, setHandType] = useState<HandType>(currentHand?.type ?? HandType.HIGH_CARD);
  const [rank, setRank] = useState<Rank>('A');
  const [rank2, setRank2] = useState<Rank>('K');
  const [suit, setSuit] = useState<Suit>('spades');

  const buildHand = (): HandCall | null => {
    switch (handType) {
      case HandType.HIGH_CARD: return { type: HandType.HIGH_CARD, rank };
      case HandType.PAIR: return { type: HandType.PAIR, rank };
      case HandType.TWO_PAIR:
        if (rank === rank2) return null;
        return { type: HandType.TWO_PAIR, highRank: rank, lowRank: rank2 };
      case HandType.THREE_OF_A_KIND: return { type: HandType.THREE_OF_A_KIND, rank };
      case HandType.FLUSH: return { type: HandType.FLUSH, suit };
      case HandType.STRAIGHT: return { type: HandType.STRAIGHT, highRank: rank };
      case HandType.FULL_HOUSE:
        if (rank === rank2) return null;
        return { type: HandType.FULL_HOUSE, threeRank: rank, twoRank: rank2 };
      case HandType.FOUR_OF_A_KIND: return { type: HandType.FOUR_OF_A_KIND, rank };
      case HandType.STRAIGHT_FLUSH: return { type: HandType.STRAIGHT_FLUSH, suit, highRank: rank };
      case HandType.ROYAL_FLUSH: return { type: HandType.ROYAL_FLUSH, suit };
    }
  };

  const hand = buildHand();
  const isValid = hand !== null && (!currentHand || isHigherHand(hand, currentHand));

  const needsRank = [
    HandType.HIGH_CARD, HandType.PAIR, HandType.THREE_OF_A_KIND,
    HandType.STRAIGHT, HandType.FOUR_OF_A_KIND, HandType.STRAIGHT_FLUSH,
  ].includes(handType);

  const needsRank2 = [HandType.TWO_PAIR, HandType.FULL_HOUSE].includes(handType);
  const needsSuit = [HandType.FLUSH, HandType.STRAIGHT_FLUSH, HandType.ROYAL_FLUSH].includes(handType);

  const handleSubmit = () => {
    if (hand && isValid) onSubmit(hand);
  };

  return (
    <div className="bg-green-800/60 rounded-lg p-4 space-y-3">
      <div>
        <label className="block text-xs text-green-300 mb-1">Hand Type</label>
        <select
          value={handType}
          onChange={(e) => setHandType(Number(e.target.value) as HandType)}
          className="w-full bg-green-700 text-white rounded px-3 py-2"
        >
          {Object.values(HandType)
            .filter((v): v is HandType => typeof v === 'number')
            .map((ht) => (
              <option key={ht} value={ht}>
                {getHandTypeName(ht)}
              </option>
            ))}
        </select>
      </div>

      <div className="flex gap-3">
        {needsRank && (
          <div className="flex-1">
            <label className="block text-xs text-green-300 mb-1">
              {handType === HandType.STRAIGHT || handType === HandType.STRAIGHT_FLUSH ? 'High Card' : 'Rank'}
            </label>
            <select
              value={rank}
              onChange={(e) => setRank(e.target.value as Rank)}
              className="w-full bg-green-700 text-white rounded px-3 py-2"
            >
              {ALL_RANKS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        )}

        {needsRank2 && (
          <>
            <div className="flex-1">
              <label className="block text-xs text-green-300 mb-1">
                {handType === HandType.FULL_HOUSE ? 'Three of' : 'High Pair'}
              </label>
              <select
                value={rank}
                onChange={(e) => setRank(e.target.value as Rank)}
                className="w-full bg-green-700 text-white rounded px-3 py-2"
              >
                {ALL_RANKS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-green-300 mb-1">
                {handType === HandType.FULL_HOUSE ? 'Pair of' : 'Low Pair'}
              </label>
              <select
                value={rank2}
                onChange={(e) => setRank2(e.target.value as Rank)}
                className="w-full bg-green-700 text-white rounded px-3 py-2"
              >
                {ALL_RANKS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          </>
        )}

        {needsSuit && (
          <div className="flex-1">
            <label className="block text-xs text-green-300 mb-1">Suit</label>
            <select
              value={suit}
              onChange={(e) => setSuit(e.target.value as Suit)}
              className="w-full bg-green-700 text-white rounded px-3 py-2"
            >
              {ALL_SUITS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <button
        onClick={handleSubmit}
        disabled={!isValid}
        className={`w-full py-3 rounded-lg font-bold text-lg transition-colors ${
          isValid
            ? 'bg-yellow-500 hover:bg-yellow-400 text-gray-900'
            : 'bg-gray-600 text-gray-400 cursor-not-allowed'
        }`}
      >
        Call Hand
      </button>
    </div>
  );
}
