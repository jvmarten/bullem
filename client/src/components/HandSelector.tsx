import { useState, useMemo, useCallback, useRef } from 'react';
import {
  HandType, ALL_RANKS, ALL_SUITS, RANK_VALUES,
  isHigherHand, getHandTypeName, handToString,
} from '@bull-em/shared';
import type { HandCall, Rank, Suit, Card } from '@bull-em/shared';
import { SUIT_SYMBOLS } from '../utils/cardUtils.js';

interface Props {
  currentHand: HandCall | null;
  onSubmit: (hand: HandCall) => void;
}

const STRAIGHT_RANKS = ALL_RANKS.filter(r => RANK_VALUES[r] >= 5);
const ALL_HAND_TYPES: HandType[] = Object.values(HandType)
  .filter((v): v is HandType => typeof v === 'number' && v !== HandType.ROYAL_FLUSH);

/* ── Mini card illustrations for hand type picker ──────── */

function HandIllustration({ type }: { type: HandType }) {
  const mini = (key: number, style?: React.CSSProperties, content?: React.ReactNode) => (
    <div key={key} className="hs-illus-card" style={style}>{content}</div>
  );
  const heart = <span className="text-[6px] leading-none suit-red">♥</span>;
  const overlap = (i: number): React.CSSProperties => (i > 0 ? { marginLeft: '-4px' } : {});
  const fan = (i: number, total: number): React.CSSProperties => ({
    ...(i > 0 ? { marginLeft: '-4px' } : {}),
    transform: `rotate(${(i - (total - 1) / 2) * 8}deg)`,
  });

  switch (type) {
    case HandType.HIGH_CARD:
      return <div className="hs-illus">{mini(0)}</div>;
    case HandType.PAIR:
      return <div className="hs-illus">{[0, 1].map(i => mini(i, overlap(i)))}</div>;
    case HandType.TWO_PAIR:
      return (
        <div className="hs-illus gap-1">
          <div className="flex">{[0, 1].map(i => mini(i, overlap(i)))}</div>
          <div className="flex">{[0, 1].map(i => mini(i + 2, overlap(i)))}</div>
        </div>
      );
    case HandType.THREE_OF_A_KIND:
      return <div className="hs-illus">{[0, 1, 2].map(i => mini(i, fan(i, 3)))}</div>;
    case HandType.FLUSH:
      return <div className="hs-illus">{[0, 1, 2].map(i => mini(i, overlap(i), heart))}</div>;
    case HandType.STRAIGHT:
      return (
        <div className="hs-illus items-end">
          {[0, 1, 2].map(i => mini(i, { marginLeft: i > 0 ? '-3px' : undefined, marginBottom: `${i * 3}px` }))}
        </div>
      );
    case HandType.FULL_HOUSE:
      return (
        <div className="hs-illus gap-0.5">
          <div className="flex">{[0, 1, 2].map(i => mini(i, fan(i, 3)))}</div>
          <div className="flex">{[0, 1].map(i => mini(i + 3, overlap(i)))}</div>
        </div>
      );
    case HandType.FOUR_OF_A_KIND:
      return <div className="hs-illus">{[0, 1, 2, 3].map(i => mini(i, fan(i, 4)))}</div>;
    case HandType.STRAIGHT_FLUSH:
      return (
        <div className="hs-illus items-end">
          {[0, 1, 2].map(i => mini(i, { marginLeft: i > 0 ? '-3px' : undefined, marginBottom: `${i * 3}px` }, heart))}
        </div>
      );
    default:
      return null;
  }
}

/* ── Preview card generation ───────────────────────────── */

function getPreviewCards(hand: HandCall | null): Card[] {
  if (!hand) return [];
  const suits: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];

  function straightCards(highRank: Rank, suitOverride?: Suit): Card[] {
    const high = RANK_VALUES[highRank];
    return Array.from({ length: 5 }, (_, i) => {
      const val = high - 4 + i;
      let r: Rank;
      if (val === 1) r = 'A';
      else r = ALL_RANKS.find(x => RANK_VALUES[x] === val) ?? highRank;
      return { rank: r, suit: suitOverride ?? suits[i % 4] };
    });
  }

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
      return (['A', 'K', 'Q', 'J', '10'] as Rank[]).map(r => ({ rank: r, suit: hand.suit }));
    case HandType.STRAIGHT:
      return straightCards(hand.highRank);
    case HandType.FULL_HOUSE:
      return [
        ...suits.slice(0, 3).map(s => ({ rank: hand.threeRank, suit: s })),
        ...suits.slice(0, 2).map(s => ({ rank: hand.twoRank, suit: s })),
      ];
    case HandType.FOUR_OF_A_KIND:
      return suits.map(s => ({ rank: hand.rank, suit: s }));
    case HandType.STRAIGHT_FLUSH:
      return straightCards(hand.highRank, hand.suit);
    case HandType.ROYAL_FLUSH:
      return (['10', 'J', 'Q', 'K', 'A'] as Rank[]).map(r => ({ rank: r, suit: hand.suit }));
  }
}

/* ── Rank Fan Sub-component ────────────────────────────── */

function RankFan({ ranks, selected, onSelect, label, testId }: {
  ranks: readonly Rank[];
  selected: Rank;
  onSelect: (r: Rank) => void;
  label: string;
  testId: string;
}) {
  const selectedIndex = ranks.indexOf(selected);
  const touchActiveRef = useRef(false);

  const handleKeyDown = (e: React.KeyboardEvent, i: number) => {
    let next = i;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      next = (i + 1) % ranks.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      next = (i - 1 + ranks.length) % ranks.length;
    }
    if (next !== i) onSelect(ranks[next]);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchActiveRef.current) return;
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!el) return;
    const btn = el.closest('[role="radio"]') as HTMLElement | null;
    if (!btn) return;
    const rankLabel = btn.getAttribute('aria-label');
    if (!rankLabel) return;
    const r = rankLabel.replace('Rank ', '') as Rank;
    if (ranks.includes(r) && r !== selected) onSelect(r);
  };

  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] mb-1.5 font-semibold">
        {label}
      </div>
      <div
        className="hs-rank-fan"
        role="radiogroup"
        aria-label={label}
        data-testid={testId}
        onTouchStart={() => { touchActiveRef.current = true; }}
        onTouchMove={handleTouchMove}
        onTouchEnd={() => { touchActiveRef.current = false; }}
      >
        {ranks.map((r, i) => (
          <button
            key={r}
            role="radio"
            aria-checked={selected === r}
            aria-label={`Rank ${r}`}
            tabIndex={i === selectedIndex ? 0 : -1}
            onClick={() => onSelect(r)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            className={`hs-rank-card${selected === r ? ' hs-rank-card-selected' : ''}`}
          >
            <span className="text-sm font-bold text-[#1a1a1a]">{r}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Main Component ────────────────────────────────────── */

export function HandSelector({ currentHand, onSubmit }: Props) {
  const [handType, setHandType] = useState<HandType>(currentHand?.type ?? HandType.HIGH_CARD);
  const [rank, setRank] = useState<Rank>('A');
  const [rank2, setRank2] = useState<Rank>('K');
  const [suit, setSuit] = useState<Suit>('spades');

  const handleTypeChange = useCallback((ht: HandType) => {
    setHandType(ht);
    if ((ht === HandType.STRAIGHT || ht === HandType.STRAIGHT_FLUSH) && RANK_VALUES[rank] < 5) {
      setRank('A');
    }
  }, [rank]);

  const handleRank1Change = useCallback((r: Rank) => {
    setRank(r);
    if (r === rank2) {
      const alt = ALL_RANKS.find(x => x !== r);
      if (alt) setRank2(alt);
    }
  }, [rank2]);

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
        // Straight Flush with Ace high = Royal Flush
        if (rank === 'A') return { type: HandType.ROYAL_FLUSH, suit };
        return { type: HandType.STRAIGHT_FLUSH, suit, highRank: rank };
      }
      default:
        return null;
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

  const previewCards = useMemo(() => getPreviewCards(hand), [hand]);

  const handleTypeKeyDown = (e: React.KeyboardEvent, i: number) => {
    let next = i;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      next = (i + 1) % ALL_HAND_TYPES.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      next = (i - 1 + ALL_HAND_TYPES.length) % ALL_HAND_TYPES.length;
    }
    if (next !== i) handleTypeChange(ALL_HAND_TYPES[next]);
  };

  const rankList = needsStraightRank ? STRAIGHT_RANKS : ALL_RANKS;
  const rank2List = ALL_RANKS.filter(r => r !== rank);

  return (
    <div className="glass-raised p-3 space-y-3 animate-slide-up">
      {/* ── Hand Type Picker ──────────────────────────── */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] mb-1.5 font-semibold">
          Hand Type
        </div>
        <div
          className="hs-type-strip"
          role="radiogroup"
          aria-label="Hand type"
          data-testid="hand-type-picker"
        >
          {ALL_HAND_TYPES.map((ht, i) => {
            const isSelected = handType === ht;
            const isDimmed = currentHand !== null && ht < currentHand.type;
            return (
              <button
                key={ht}
                role="radio"
                aria-checked={isSelected}
                aria-label={getHandTypeName(ht)}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => handleTypeChange(ht)}
                onKeyDown={(e) => handleTypeKeyDown(e, i)}
                className={`hs-type-card${isSelected ? ' hs-type-card-selected' : ''}${isDimmed ? ' hs-type-card-dimmed' : ''}`}
              >
                <span className="hs-type-name">{getHandTypeName(ht)}</span>
                <HandIllustration type={ht} />
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Rank Picker (single rank) ─────────────────── */}
      {(needsRank || needsStraightRank) && (
        <RankFan
          ranks={rankList}
          selected={rank}
          onSelect={setRank}
          label={needsStraightRank ? 'High Card' : 'Rank'}
          testId="rank-picker"
        />
      )}

      {/* ── Two-Rank Pickers (Two Pair / Full House) ──── */}
      {needsRank2 && (
        <>
          <RankFan
            ranks={ALL_RANKS}
            selected={rank}
            onSelect={handleRank1Change}
            label={handType === HandType.FULL_HOUSE ? 'Three of' : 'High Pair'}
            testId="rank-picker"
          />
          <RankFan
            ranks={rank2List}
            selected={rank2}
            onSelect={setRank2}
            label={handType === HandType.FULL_HOUSE ? 'Pair of' : 'Low Pair'}
            testId="rank2-picker"
          />
        </>
      )}

      {/* ── Suit Picker ───────────────────────────────── */}
      {needsSuit && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] mb-1.5 font-semibold">
            Suit
          </div>
          <div
            className="flex justify-center gap-3"
            role="radiogroup"
            aria-label="Suit"
            data-testid="suit-picker"
          >
            {ALL_SUITS.map((s, i) => {
              const isSelected = suit === s;
              const suitColor = (s === 'hearts' || s === 'diamonds') ? 'suit-red' : 'text-white';
              return (
                <button
                  key={s}
                  role="radio"
                  aria-checked={isSelected}
                  aria-label={s}
                  tabIndex={isSelected ? 0 : -1}
                  onClick={() => setSuit(s)}
                  onKeyDown={(e) => {
                    let next = i;
                    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); next = (i + 1) % ALL_SUITS.length; }
                    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); next = (i - 1 + ALL_SUITS.length) % ALL_SUITS.length; }
                    if (next !== i) setSuit(ALL_SUITS[next]);
                  }}
                  className={`hs-suit-btn${isSelected ? ' hs-suit-btn-selected' : ''}`}
                >
                  <span className={suitColor}>{SUIT_SYMBOLS[s]}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Live Preview ──────────────────────────────── */}
      {hand && (
        <div className="hs-preview-area">
          <div className="flex justify-center gap-0.5 flex-wrap">
            {previewCards.slice(0, 5).map((card, i) => {
              const sc = (card.suit === 'hearts' || card.suit === 'diamonds') ? 'suit-red' : 'suit-black';
              return (
                <div key={i} className="hs-preview-card playing-card inline-flex flex-col items-center justify-center w-10 h-14 mx-0 select-none">
                  <span className={`text-xs font-bold leading-tight ${sc}`}>{card.rank}</span>
                  <span className={`text-sm leading-tight ${sc}`}>{SUIT_SYMBOLS[card.suit]}</span>
                </div>
              );
            })}
          </div>
          <div className="text-center text-sm text-[var(--gold)] font-semibold mt-1.5">
            {handToString(hand)}
          </div>
        </div>
      )}

      {/* ── Validation ────────────────────────────────── */}
      {validationMsg && (
        <p className="text-xs text-[var(--danger)]">{validationMsg}</p>
      )}

      {/* ── Submit Button ─────────────────────────────── */}
      <button
        onClick={handleSubmit}
        disabled={!isValid}
        className={`w-full btn-gold py-3 text-lg${isValid ? ' hs-call-pulse' : ''}`}
      >
        {currentHand ? 'Raise' : 'Call'}
      </button>
    </div>
  );
}
