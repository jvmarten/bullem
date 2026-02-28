import { useState, useMemo } from 'react';
import {
  HandType, ALL_RANKS, ALL_SUITS, RANK_VALUES,
  isHigherHand, getHandTypeName,
} from '@bull-em/shared';
import type { HandCall, Rank, Suit } from '@bull-em/shared';
import { SUIT_SYMBOLS } from '../utils/cardUtils.js';

interface Props {
  currentHand: HandCall | null;
  onSubmit: (hand: HandCall) => void;
}

const STRAIGHT_RANKS = ALL_RANKS.filter(r => RANK_VALUES[r] >= 5);

export function HandSelector({ currentHand, onSubmit }: Props) {
  const [handType, setHandType] = useState<HandType>(currentHand?.type ?? HandType.HIGH_CARD);
  const [rank, setRank] = useState<Rank>('A');
  const [rank2, setRank2] = useState<Rank>('K');
  const [suit, setSuit] = useState<Suit>('spades');

  const buildHand = (): HandCall | null => {
    switch (handType) {
      case HandType.HIGH_CARD: return { type: HandType.HIGH_CARD, rank };
      case HandType.PAIR: return { type: HandType.PAIR, rank };
      case HandType.TWO_PAIR: {
        if (rank === rank2) return null;
        const [high, low] = RANK_VALUES[rank] > RANK_VALUES[rank2]
          ? [rank, rank2] : [rank2, rank];
        return { type: HandType.TWO_PAIR, highRank: high, lowRank: low };
      }
      case HandType.THREE_OF_A_KIND: return { type: HandType.THREE_OF_A_KIND, rank };
      case HandType.FLUSH: return { type: HandType.FLUSH, suit };
      case HandType.STRAIGHT: {
        if (RANK_VALUES[rank] < 5) return null;
        return { type: HandType.STRAIGHT, highRank: rank };
      }
      case HandType.FULL_HOUSE: {
        if (rank === rank2) return null;
        return { type: HandType.FULL_HOUSE, threeRank: rank, twoRank: rank2 };
      }
      case HandType.FOUR_OF_A_KIND: return { type: HandType.FOUR_OF_A_KIND, rank };
      case HandType.STRAIGHT_FLUSH: {
        if (RANK_VALUES[rank] < 5) return null;
        return { type: HandType.STRAIGHT_FLUSH, suit, highRank: rank };
      }
      case HandType.ROYAL_FLUSH: return { type: HandType.ROYAL_FLUSH, suit };
    }
  };

  const hand = buildHand();
  const isValid = hand !== null && (!currentHand || isHigherHand(hand, currentHand));

  const needsRank = [
    HandType.HIGH_CARD, HandType.PAIR, HandType.THREE_OF_A_KIND,
    HandType.FOUR_OF_A_KIND,
  ].includes(handType);

  const needsStraightRank = [HandType.STRAIGHT, HandType.STRAIGHT_FLUSH].includes(handType);
  const needsRank2 = [HandType.TWO_PAIR, HandType.FULL_HOUSE].includes(handType);
  const needsSuit = [HandType.FLUSH, HandType.STRAIGHT_FLUSH].includes(handType);

  const handleSubmit = () => {
    if (hand && isValid) onSubmit(hand);
  };

  const validationMsg = useMemo(() => {
    if (!hand) {
      if (needsRank2 && rank === rank2) return 'Ranks must be different';
      if (needsStraightRank && RANK_VALUES[rank] < 5) return 'Straight needs high card 5 or above';
      return '';
    }
    if (currentHand && !isHigherHand(hand, currentHand)) return 'Must be higher than current call';
    return '';
  }, [hand, currentHand, rank, rank2, handType, needsRank2, needsStraightRank]);

  return (
    <div className="glass-raised p-2.5 space-y-2 animate-slide-up">
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <select
            value={handType}
            onChange={(e) => setHandType(Number(e.target.value) as HandType)}
            className="w-full select-felt text-sm"
          >
            {Object.values(HandType)
              .filter((v): v is HandType => typeof v === 'number' && v !== HandType.ROYAL_FLUSH)
              .map((ht) => (
                <option key={ht} value={ht}>
                  {getHandTypeName(ht)}
                </option>
              ))}
          </select>
        </div>

        {needsRank && (
          <div className="w-16">
            <select
              value={rank}
              onChange={(e) => setRank(e.target.value as Rank)}
              className="w-full select-felt text-sm"
            >
              {ALL_RANKS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        )}

        {needsStraightRank && (
          <div className="w-16">
            <select
              value={RANK_VALUES[rank] >= 5 ? rank : '5'}
              onChange={(e) => setRank(e.target.value as Rank)}
              className="w-full select-felt text-sm"
            >
              {STRAIGHT_RANKS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        )}

        {needsRank2 && (
          <>
            <div className="w-16">
              <select
                value={rank}
                onChange={(e) => setRank(e.target.value as Rank)}
                className="w-full select-felt text-sm"
              >
                {ALL_RANKS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div className="w-16">
              <select
                value={rank2}
                onChange={(e) => setRank2(e.target.value as Rank)}
                className="w-full select-felt text-sm"
              >
                {ALL_RANKS.filter(r => r !== rank).map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          </>
        )}

        {needsSuit && (
          <div className="w-24">
            <select
              value={suit}
              onChange={(e) => setSuit(e.target.value as Suit)}
              className="w-full select-felt text-sm"
            >
              {ALL_SUITS.map((s) => (
                <option key={s} value={s}>{SUIT_SYMBOLS[s]} {s[0].toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {validationMsg && (
        <p className="text-xs text-[var(--danger)]">{validationMsg}</p>
      )}

      <button
        onClick={handleSubmit}
        disabled={!isValid}
        className="w-full btn-gold py-2 text-sm"
      >
        Call Hand
      </button>
    </div>
  );
}
