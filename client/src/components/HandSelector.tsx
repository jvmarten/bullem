import { useState, useMemo, useCallback } from 'react';
import {
  HandType, ALL_RANKS, ALL_SUITS, RANK_VALUES,
  isHigherHand, handToString, getMinimumRaise,
} from '@bull-em/shared';
import type { HandCall, Rank, Suit, Card } from '@bull-em/shared';
import { SUIT_SYMBOLS } from '../utils/cardUtils.js';
import { WheelPicker } from './WheelPicker.js';

interface Props {
  currentHand: HandCall | null;
  onSubmit: (hand: HandCall) => void;
  submitLabel?: string;
}

const STRAIGHT_RANKS = ALL_RANKS.filter(r => RANK_VALUES[r] >= 5);
const ALL_HAND_TYPES: HandType[] = Object.values(HandType)
  .filter((v): v is HandType => typeof v === 'number' && v !== HandType.ROYAL_FLUSH);

/* ── Mini card illustrations for hand type picker ──────── */

function HandIllustration({ type, isSelected }: { type: HandType; isSelected: boolean }) {
  const cardColor = isSelected ? 'bg-[var(--card-face)] border-[var(--gold)]' : 'bg-[var(--card-face)] border-[var(--card-border)]';
  const mini = (key: number, style?: React.CSSProperties) => (
    <div key={key} className={`w-[14px] h-[20px] rounded-[2px] border ${cardColor} flex-shrink-0`} style={style} />
  );
  const heart = (key: number, style?: React.CSSProperties) => (
    <div key={key} className={`w-[14px] h-[20px] rounded-[2px] border ${cardColor} flex-shrink-0 flex items-center justify-center`} style={style}>
      <span className="text-[7px] leading-none text-red-600">♥</span>
    </div>
  );
  const overlap = (i: number): React.CSSProperties => (i > 0 ? { marginLeft: '-5px' } : {});
  const stair = (i: number): React.CSSProperties => ({
    marginLeft: i > 0 ? '-3px' : undefined,
    marginBottom: `${i * 3}px`,
  });

  switch (type) {
    case HandType.HIGH_CARD:
      return <div className="flex justify-center">{mini(0)}</div>;
    case HandType.PAIR:
      return <div className="flex justify-center">{[0, 1].map(i => mini(i, overlap(i)))}</div>;
    case HandType.TWO_PAIR:
      return (
        <div className="flex justify-center gap-0.5">
          <div className="flex">{[0, 1].map(i => mini(i, overlap(i)))}</div>
          <div className="flex">{[2, 3].map(i => mini(i, overlap(i > 2 ? 1 : 0)))}</div>
        </div>
      );
    case HandType.THREE_OF_A_KIND:
      return <div className="flex justify-center">{[0, 1, 2].map(i => mini(i, overlap(i)))}</div>;
    case HandType.FLUSH:
      return <div className="flex justify-center">{[0, 1, 2].map(i => heart(i, overlap(i)))}</div>;
    case HandType.STRAIGHT:
      return <div className="flex justify-center items-end">{[0, 1, 2].map(i => mini(i, stair(i)))}</div>;
    case HandType.FULL_HOUSE:
      return (
        <div className="flex justify-center gap-0.5">
          <div className="flex">{[0, 1, 2].map(i => mini(i, overlap(i)))}</div>
          <div className="flex">{[3, 4].map(i => mini(i, overlap(i > 3 ? 1 : 0)))}</div>
        </div>
      );
    case HandType.FOUR_OF_A_KIND:
      return <div className="flex justify-center">{[0, 1, 2, 3].map(i => mini(i, overlap(i)))}</div>;
    case HandType.STRAIGHT_FLUSH:
      return <div className="flex justify-center items-end">{[0, 1, 2].map(i => heart(i, stair(i)))}</div>;
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
      return (['2', '5', '8', 'J', 'A'] as Rank[]).map(r => ({ rank: r, suit: hand.suit }));
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

/* ── Initial state from current hand ───────────────────── */

function getInitialState(currentHand: HandCall | null): { handType: HandType; rank: Rank; rank2: Rank; suit: Suit } {
  if (!currentHand) return { handType: HandType.HIGH_CARD, rank: '2', rank2: '3', suit: 'spades' };
  const minRaise = getMinimumRaise(currentHand);
  if (!minRaise) return { handType: currentHand.type, rank: 'A', rank2: 'K', suit: 'spades' };
  const ht = minRaise.type;
  let rank: Rank = '2';
  let rank2: Rank = '3';
  let suit: Suit = 'spades';
  switch (minRaise.type) {
    case HandType.HIGH_CARD: rank = minRaise.rank; break;
    case HandType.PAIR: rank = minRaise.rank; break;
    case HandType.TWO_PAIR: rank = minRaise.highRank; rank2 = minRaise.lowRank; break;
    case HandType.THREE_OF_A_KIND: rank = minRaise.rank; break;
    case HandType.FLUSH: suit = minRaise.suit; break;
    case HandType.STRAIGHT: rank = minRaise.highRank; break;
    case HandType.FULL_HOUSE: rank = minRaise.threeRank; rank2 = minRaise.twoRank; break;
    case HandType.FOUR_OF_A_KIND: rank = minRaise.rank; break;
    case HandType.STRAIGHT_FLUSH: suit = minRaise.suit; rank = minRaise.highRank; break;
    case HandType.ROYAL_FLUSH: suit = minRaise.suit; break;
  }
  return { handType: ht, rank, rank2, suit };
}

/* ── Main Component ────────────────────────────────────── */

export function HandSelector({ currentHand, onSubmit, submitLabel }: Props) {
  const label = submitLabel ?? (currentHand ? 'Raise' : 'Call');
  const initial = getInitialState(currentHand);
  const [handType, setHandType] = useState<HandType>(initial.handType);
  const [rank, setRank] = useState<Rank>(initial.rank);
  const [rank2, setRank2] = useState<Rank>(initial.rank2);
  const [suit, setSuit] = useState<Suit>(initial.suit);

  const handleTypeChange = useCallback((ht: HandType) => {
    setHandType(ht);
    if ((ht === HandType.STRAIGHT || ht === HandType.STRAIGHT_FLUSH) && RANK_VALUES[rank] < 5) {
      setRank('5');
    }
  }, [rank]);

  const handleRank1Change = useCallback((r: Rank) => {
    setRank(r);
    if (r === rank2) {
      const alt = ALL_RANKS.find(x => x !== r);
      if (alt) setRank2(alt);
    }
  }, [rank2]);

  const buildHand = useCallback((): HandCall | null => {
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
        if (rank === 'A') return { type: HandType.ROYAL_FLUSH, suit };
        return { type: HandType.STRAIGHT_FLUSH, suit, highRank: rank };
      }
      default: return null;
    }
  }, [handType, rank, rank2, suit]);

  const hand = buildHand();
  const isValid = hand !== null && (!currentHand || isHigherHand(hand, currentHand));

  const needsRank = [HandType.HIGH_CARD, HandType.PAIR, HandType.THREE_OF_A_KIND, HandType.FOUR_OF_A_KIND].includes(handType);
  const needsStraightRank = [HandType.STRAIGHT, HandType.STRAIGHT_FLUSH].includes(handType);
  const needsRank2 = [HandType.TWO_PAIR, HandType.FULL_HOUSE].includes(handType);
  const needsSuit = [HandType.FLUSH, HandType.STRAIGHT_FLUSH].includes(handType);

  const validationMsg = useMemo(() => {
    if (!hand) {
      if (needsRank2 && rank === rank2) return 'Ranks must differ';
      if (needsStraightRank && RANK_VALUES[rank] < 5) return 'High card 5+';
      return '';
    }
    if (currentHand && !isHigherHand(hand, currentHand)) return 'Must be higher';
    return '';
  }, [hand, currentHand, rank, rank2, handType, needsRank2, needsStraightRank]);

  const previewCards = useMemo(() => getPreviewCards(hand), [hand]);

  const rankList = needsStraightRank ? STRAIGHT_RANKS : ALL_RANKS;
  const rank2List = useMemo(() => ALL_RANKS.filter(r => r !== rank), [rank]);

  const handTypeIndex = ALL_HAND_TYPES.indexOf(handType);
  const handleTypeWheel = useCallback((idx: number) => handleTypeChange(ALL_HAND_TYPES[idx]), [handleTypeChange]);

  const handlePrimaryWheel = useCallback((idx: number) => {
    if (needsSuit && !needsRank && !needsStraightRank && !needsRank2) {
      setSuit(ALL_SUITS[idx]);
    } else if (needsRank2) {
      handleRank1Change(rankList[idx]);
    } else {
      setRank(rankList[idx]);
    }
  }, [needsSuit, needsRank, needsStraightRank, needsRank2, rankList, handleRank1Change]);

  const rank2Index = rank2List.indexOf(rank2);
  const handleRank2Wheel = useCallback((idx: number) => setRank2(rank2List[idx]), [rank2List]);

  const suitIndex = ALL_SUITS.indexOf(suit);
  const handleSuitWheel = useCallback((idx: number) => setSuit(ALL_SUITS[idx]), []);

  const isSuitOnly = needsSuit && !needsRank && !needsStraightRank && !needsRank2;

  /* ── Render callbacks ───────────────────────────────── */

  const renderHandType = useCallback((ht: HandType, isSelected: boolean) => {
    const isDimmed = currentHand !== null && ht < currentHand.type;
    return (
      <div className={`flex items-center justify-center transition-all duration-200 ${
        isDimmed ? 'opacity-20' : ''
      } ${isSelected ? 'scale-110' : 'opacity-40'}`}>
        <HandIllustration type={ht} isSelected={isSelected} />
      </div>
    );
  }, [currentHand]);

  const renderRank = useCallback((r: string, isSelected: boolean) => (
    <div className={`hs-rank-card ${isSelected ? 'hs-rank-card-selected' : ''}`}
      style={{ margin: 0, width: 36, height: 48 }}
    >
      <span className={`text-sm font-bold ${isSelected ? 'text-[#1a1a1a]' : 'text-[#555]'}`}>{r}</span>
    </div>
  ), []);

  const renderSuit = useCallback((s: string, isSelected: boolean) => (
    <div className={`hs-rank-card ${isSelected ? 'hs-rank-card-selected' : ''}`}
      style={{ margin: 0, width: 36, height: 48 }}
    >
      <span className={`text-lg ${(s === 'hearts' || s === 'diamonds') ? 'suit-red' : ''} ${isSelected ? '' : 'opacity-50'}`}>
        {SUIT_SYMBOLS[s as Suit]}
      </span>
    </div>
  ), []);

  const handleSubmit = useCallback(() => {
    if (hand && isValid) onSubmit(hand);
  }, [hand, isValid, onSubmit]);

  return (
    <div className="animate-slide-up" data-testid="hand-selector">
      {/* Top: Hand name */}
      <div className="text-center py-1">
        {hand ? (
          <span className="font-display text-sm font-bold text-[var(--gold)]">
            {handToString(hand)}
          </span>
        ) : (
          <span className="text-sm text-[var(--gold-dim)]">Select a hand</span>
        )}
        {validationMsg && (
          <p className="text-[10px] text-[var(--danger)] mt-0.5">{validationMsg}</p>
        )}
      </div>

      {/* Middle: Card preview */}
      <div className="flex justify-center flex-wrap gap-0.5 py-1 min-h-[56px] items-center">
        {hand && previewCards.map((card, i) => {
          const sc = (card.suit === 'hearts' || card.suit === 'diamonds') ? 'suit-red' : 'suit-black';
          return (
            <div key={i} className="playing-card no-hover inline-flex flex-col items-center justify-center w-9 h-[52px] select-none">
              <span className={`text-xs font-bold leading-tight ${sc}`}>{card.rank}</span>
              <span className={`text-sm leading-tight ${sc}`}>{SUIT_SYMBOLS[card.suit]}</span>
            </div>
          );
        })}
      </div>

      {/* Bottom: Two wheel columns side by side */}
      <div className="flex gap-1">
        {/* Left column — Hand type wheel (card images only) */}
        <div className="flex-1">
          <WheelPicker
            items={ALL_HAND_TYPES}
            selectedIndex={handTypeIndex >= 0 ? handTypeIndex : 0}
            onSelect={handleTypeWheel}
            renderItem={renderHandType}
            itemHeight={40}
            visibleCount={5}
          />
        </div>

        {/* Right column — Rank / suit wheel(s) */}
        <div className="flex-1">
          {isSuitOnly ? (
            <WheelPicker
              items={[...ALL_SUITS]}
              selectedIndex={suitIndex >= 0 ? suitIndex : 0}
              onSelect={handleSuitWheel}
              renderItem={renderSuit}
              itemHeight={50}
              visibleCount={5}
            />
          ) : needsRank2 ? (
            <div className="flex gap-1">
              <WheelPicker
                items={[...rankList]}
                selectedIndex={rankList.indexOf(rank)}
                onSelect={handlePrimaryWheel}
                renderItem={renderRank}
                itemHeight={50}
                visibleCount={3}
              />
              <WheelPicker
                items={[...rank2List]}
                selectedIndex={rank2Index >= 0 ? rank2Index : 0}
                onSelect={handleRank2Wheel}
                renderItem={renderRank}
                itemHeight={50}
                visibleCount={3}
              />
            </div>
          ) : needsStraightRank && needsSuit ? (
            <div className="flex gap-1">
              <WheelPicker
                items={[...rankList]}
                selectedIndex={rankList.indexOf(rank)}
                onSelect={handlePrimaryWheel}
                renderItem={renderRank}
                itemHeight={50}
                visibleCount={3}
              />
              <WheelPicker
                items={[...ALL_SUITS]}
                selectedIndex={suitIndex >= 0 ? suitIndex : 0}
                onSelect={handleSuitWheel}
                renderItem={renderSuit}
                itemHeight={50}
                visibleCount={3}
              />
            </div>
          ) : (
            <WheelPicker
              items={[...rankList]}
              selectedIndex={rankList.indexOf(rank)}
              onSelect={handlePrimaryWheel}
              renderItem={renderRank}
              itemHeight={50}
              visibleCount={5}
            />
          )}
        </div>
      </div>

      {/* Submit button — right-aligned */}
      <div className="flex justify-end mt-2">
        <button
          onClick={handleSubmit}
          disabled={!hand || !isValid}
          className={`btn-gold px-6 py-2 text-base font-bold ${hand && isValid ? 'hs-call-pulse' : ''}`}
        >
          {label}
        </button>
      </div>
    </div>
  );
}
