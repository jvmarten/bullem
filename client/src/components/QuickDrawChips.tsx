import { memo } from 'react';
import { HandType, ALL_RANKS, RANK_VALUES } from '@bull-em/shared';
import type { QuickDrawSuggestion, Card, Rank, Suit } from '@bull-em/shared';
import { CardDisplay } from './CardDisplay.js';

interface QuickDrawChipsProps {
  suggestions: QuickDrawSuggestion[];
  onSelect: (suggestion: QuickDrawSuggestion) => void;
  onDismiss: () => void;
}

/** Generate small preview cards that visually represent a hand call. */
function getChipCards(hand: QuickDrawSuggestion['hand']): Card[] {
  const suits: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];

  switch (hand.type) {
    case HandType.HIGH_CARD:
      return [{ rank: hand.rank, suit: 'spades' }];
    case HandType.PAIR:
      return [{ rank: hand.rank, suit: 'spades' }, { rank: hand.rank, suit: 'hearts' }];
    case HandType.TWO_PAIR:
      return [
        { rank: hand.highRank, suit: 'spades' }, { rank: hand.highRank, suit: 'hearts' },
        { rank: hand.lowRank, suit: 'diamonds' }, { rank: hand.lowRank, suit: 'clubs' },
      ];
    case HandType.THREE_OF_A_KIND:
      return suits.slice(0, 3).map(s => ({ rank: hand.rank, suit: s }));
    case HandType.FLUSH:
      return [{ rank: 'A', suit: hand.suit }] as Card[];
    case HandType.STRAIGHT: {
      const high = RANK_VALUES[hand.highRank];
      return Array.from({ length: 5 }, (_, i) => {
        const val = high - 4 + i;
        let r: Rank;
        if (val === 1) r = 'A';
        else r = ALL_RANKS.find(x => RANK_VALUES[x] === val) ?? hand.highRank;
        return { rank: r, suit: suits[i % 4]! };
      });
    }
    case HandType.FULL_HOUSE:
      return [
        ...suits.slice(0, 3).map(s => ({ rank: hand.threeRank, suit: s })),
        ...suits.slice(0, 2).map(s => ({ rank: hand.twoRank, suit: s })),
      ];
    case HandType.FOUR_OF_A_KIND:
      return suits.map(s => ({ rank: hand.rank, suit: s }));
    case HandType.STRAIGHT_FLUSH: {
      const high = RANK_VALUES[hand.highRank];
      return Array.from({ length: 5 }, (_, i) => {
        const val = high - 4 + i;
        let r: Rank;
        if (val === 1) r = 'A';
        else r = ALL_RANKS.find(x => RANK_VALUES[x] === val) ?? hand.highRank;
        return { rank: r, suit: hand.suit };
      });
    }
    case HandType.ROYAL_FLUSH:
      return (['10', 'J', 'Q', 'K', 'A'] as Rank[]).map(r => ({ rank: r, suit: hand.suit }));
  }
}

export const QuickDrawChips = memo(function QuickDrawChips({
  suggestions,
  onSelect,
  onDismiss,
}: QuickDrawChipsProps) {
  if (suggestions.length === 0) return null;

  return (
    <div
      className="quick-draw-row"
      data-tooltip="quick-draw"
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      {suggestions.map((s, i) => {
        const cards = getChipCards(s.hand);
        const isSuitOnly = s.hand.type === HandType.FLUSH;
        return (
          <button
            key={`${s.tier}-${i}`}
            className={`quick-draw-chip quick-draw-chip-${s.tier} animate-quick-draw-in`}
            style={{ animationDelay: `${i * 60}ms` }}
            onClick={() => onSelect(s)}
            title={s.label}
          >
            <span className="quick-draw-chip-cards">
              {cards.map((card, ci) => (
                <CardDisplay key={ci} card={card} small suitOnly={isSuitOnly} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
});
