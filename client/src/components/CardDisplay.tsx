import { memo } from 'react';
import type { Card } from '@bull-em/shared';
import { SUIT_SYMBOLS, SUIT_CSS, SUIT_CSS_FOUR_COLOR, rankDisplay } from '../utils/cardUtils.js';
import { useUISettings } from './VolumeControl.js';

/** Joker star symbol — distinct from standard suits. */
const JOKER_SYMBOL = '\u2605'; // ★

// Memoized: cards are immutable once dealt. Without memo, every parent
// re-render (turn changes, timer ticks) re-renders all card DOM elements.
export const CardDisplay = memo(function CardDisplay({ card, small, suitOnly, className = '', style, onPointerEnter, onClick }: {
  card: Card;
  small?: boolean;
  suitOnly?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onPointerEnter?: () => void;
  onClick?: () => void;
}) {
  const { fourColorDeckEnabled } = useUISettings();
  const suitCssMap = fourColorDeckEnabled ? SUIT_CSS_FOUR_COLOR : SUIT_CSS;
  // Joker cards get a distinct purple/gold visual treatment
  if (card.isJoker) {
    if (small) {
      return (
        <span className={`playing-card-small inline-flex items-center gap-0.5 px-1.5 py-0.5 ${className}`} style={style}>
          <span className="text-sm font-bold" style={{ color: 'var(--gold)' }}>{JOKER_SYMBOL}</span>
        </span>
      );
    }
    return (
      <div className={`playing-card inline-flex flex-col items-center justify-center w-10 h-14 mx-0.5 select-none ${className}`} style={{ ...style, borderColor: 'var(--gold)' }} onPointerEnter={onPointerEnter} onClick={onClick}>
        <span className="text-[10px] font-bold leading-tight" style={{ color: 'var(--gold)' }}>
          WILD
        </span>
        <span className="text-base leading-tight" style={{ color: 'var(--gold)' }}>
          {JOKER_SYMBOL}
        </span>
      </div>
    );
  }

  const suitColor = suitCssMap[card.suit];

  if (small) {
    if (suitOnly) {
      return (
        <span className={`playing-card-small inline-flex items-center justify-center px-1.5 py-0.5 ${className}`} style={style}>
          <span className={`text-base ${suitColor}`}>{SUIT_SYMBOLS[card.suit]}</span>
        </span>
      );
    }
    return (
      <span className={`playing-card-small inline-flex items-center gap-0.5 px-1.5 py-0.5 ${className}`} style={style}>
        <span className={`text-sm font-bold ${suitColor}`}>{rankDisplay(card.rank)}</span>
        <span className={`text-sm ${suitColor}`}>{SUIT_SYMBOLS[card.suit]}</span>
      </span>
    );
  }

  return (
    <div className={`playing-card inline-flex flex-col items-center justify-center w-10 h-14 mx-0.5 select-none ${className}`} style={style} onPointerEnter={onPointerEnter} onClick={onClick}>
      <span className={`text-sm font-bold leading-tight ${suitColor}`}>
        {rankDisplay(card.rank)}
      </span>
      <span className={`text-base leading-tight ${suitColor}`}>
        {SUIT_SYMBOLS[card.suit]}
      </span>
    </div>
  );
});
