import { useState, useMemo, useCallback } from 'react';
import {
  HandType, ALL_RANKS, ALL_SUITS, RANK_VALUES,
  isHigherHand, getHandTypeName, handToString, getMinimumRaise,
} from '@bull-em/shared';
import type { HandCall, Rank, Suit, Card } from '@bull-em/shared';
import { SUIT_SYMBOLS } from '../utils/cardUtils.js';
import { useSound } from '../hooks/useSound.js';
import { WheelPicker } from './WheelPicker.js';

interface Props {
  currentHand: HandCall | null;
  onSubmit: (hand: HandCall) => void;
  onClose?: () => void;
  submitLabel?: string;
}

const STRAIGHT_RANKS = ALL_RANKS.filter(r => RANK_VALUES[r] >= 5);
const ALL_HAND_TYPES: HandType[] = Object.values(HandType)
  .filter((v): v is HandType => typeof v === 'number' && v !== HandType.ROYAL_FLUSH);

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

export function HandSelector({ currentHand, onSubmit, onClose, submitLabel }: Props) {
  const { play } = useSound();
  const initial = getInitialState(currentHand);
  const [handType, setHandType] = useState<HandType>(initial.handType);
  const [rank, setRank] = useState<Rank>(initial.rank);
  const [rank2, setRank2] = useState<Rank>(initial.rank2);
  const [suit, setSuit] = useState<Suit>(initial.suit);

  const playClick = useCallback(() => play('uiClick'), [play]);

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
        if (rank === 'A') return { type: HandType.ROYAL_FLUSH, suit };
        return { type: HandType.STRAIGHT_FLUSH, suit, highRank: rank };
      }
      default:
        return null;
    }
  };

  const hand = buildHand();
  const isValid = hand !== null && (!currentHand || isHigherHand(hand, currentHand));

  const needsRank = [HandType.HIGH_CARD, HandType.PAIR, HandType.THREE_OF_A_KIND, HandType.FOUR_OF_A_KIND].includes(handType);
  const needsStraightRank = [HandType.STRAIGHT, HandType.STRAIGHT_FLUSH].includes(handType);
  const needsRank2 = [HandType.TWO_PAIR, HandType.FULL_HOUSE].includes(handType);
  const needsSuit = [HandType.FLUSH, HandType.STRAIGHT_FLUSH].includes(handType);

  const handleSubmit = () => {
    if (hand && isValid) {
      playClick();
      onSubmit(hand);
    }
  };

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

  // Rank list depends on hand type
  const rankList = needsStraightRank ? STRAIGHT_RANKS : ALL_RANKS;
  const rank2List = useMemo(() => ALL_RANKS.filter(r => r !== rank), [rank]);

  // Hand type wheel index
  const handTypeIndex = ALL_HAND_TYPES.indexOf(handType);
  const handleTypeWheel = useCallback((idx: number) => {
    handleTypeChange(ALL_HAND_TYPES[idx]);
  }, [handleTypeChange]);

  // Primary value wheel — rank or suit depending on hand type
  const primaryItems = (needsRank || needsStraightRank || needsRank2)
    ? rankList as readonly string[]
    : needsSuit && !needsRank && !needsStraightRank && !needsRank2
      ? ALL_SUITS as readonly string[]
      : rankList as readonly string[];

  const primaryIndex = (() => {
    if (needsSuit && !needsRank && !needsStraightRank && !needsRank2) {
      return ALL_SUITS.indexOf(suit);
    }
    return rankList.indexOf(rank);
  })();

  const handlePrimaryWheel = useCallback((idx: number) => {
    if (needsSuit && !needsRank && !needsStraightRank && !needsRank2) {
      setSuit(ALL_SUITS[idx]);
    } else if (needsRank2) {
      handleRank1Change(rankList[idx]);
    } else {
      setRank(rankList[idx]);
    }
  }, [needsSuit, needsRank, needsStraightRank, needsRank2, rankList, handleRank1Change]);

  // Secondary value wheel (for two-value types)
  const rank2Index = rank2List.indexOf(rank2);
  const handleRank2Wheel = useCallback((idx: number) => {
    setRank2(rank2List[idx]);
  }, [rank2List]);

  // Suit wheel for Straight Flush (needs both rank and suit)
  const suitIndex = ALL_SUITS.indexOf(suit);
  const handleSuitWheel = useCallback((idx: number) => {
    setSuit(ALL_SUITS[idx]);
  }, []);

  const renderHandType = useCallback((ht: HandType, isSelected: boolean) => {
    const isDimmed = currentHand !== null && ht < currentHand.type;
    return (
      <div className={`text-center px-1 ${isDimmed ? 'opacity-30' : ''}`}>
        <span className={`text-xs font-semibold ${isSelected ? 'text-[var(--gold)]' : 'text-[var(--gold-dim)]'}`}>
          {getHandTypeName(ht)}
        </span>
      </div>
    );
  }, [currentHand]);

  const renderRank = useCallback((r: string, isSelected: boolean) => (
    <div className={`w-9 h-10 rounded-md flex items-center justify-center ${
      isSelected
        ? 'bg-[var(--card-face)] border-2 border-[var(--gold)] shadow-md'
        : 'bg-[var(--card-face)] border border-[var(--card-border)] opacity-70'
    }`}>
      <span className="text-base font-bold text-[#1a1a1a]">{r}</span>
    </div>
  ), []);

  const renderSuit = useCallback((s: string, isSelected: boolean) => {
    const suitColor = (s === 'hearts' || s === 'diamonds') ? '#c0392b' : '#1a1a1a';
    return (
      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
        isSelected
          ? 'bg-[var(--surface)] border-2 border-[var(--gold)] shadow-md'
          : 'bg-[var(--surface)] border border-[rgba(26,92,53,0.5)] opacity-70'
      }`}>
        <span className="text-xl" style={{ color: suitColor }}>
          {SUIT_SYMBOLS[s as Suit]}
        </span>
      </div>
    );
  }, []);

  // Only suit in right column (Flush type)
  const isSuitOnly = needsSuit && !needsRank && !needsStraightRank && !needsRank2;

  return (
    <div className="glass-raised p-3 animate-slide-up" data-testid="hand-selector">
      {/* Submit row — gold button + close */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={handleSubmit}
          disabled={!isValid}
          className={`flex-1 btn-gold py-2.5 text-base${isValid ? ' hs-call-pulse' : ''}`}
        >
          {submitLabel ?? (currentHand ? 'Raise' : 'Call')}
          {hand ? ` — ${handToString(hand)}` : ''}
        </button>
        {onClose && (
          <button onClick={onClose} className="btn-ghost px-3 py-2.5 text-sm">
            ✕
          </button>
        )}
      </div>

      {/* Validation */}
      {validationMsg && (
        <p className="text-xs text-[var(--danger)] text-center mb-2">{validationMsg}</p>
      )}

      {/* Two-column wheel layout */}
      <div className="flex gap-2">
        {/* Left column — Hand Type wheel */}
        <div className="flex-1">
          <div className="text-[9px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-1 text-center">
            Hand Type
          </div>
          <WheelPicker
            items={ALL_HAND_TYPES}
            selectedIndex={handTypeIndex >= 0 ? handTypeIndex : 0}
            onSelect={handleTypeWheel}
            renderItem={renderHandType}
          />
        </div>

        {/* Center — Preview */}
        <div className="flex flex-col items-center justify-center" style={{ minWidth: '60px' }}>
          {hand && (
            <div className="flex flex-col items-center gap-0.5">
              {previewCards.slice(0, 3).map((card, i) => {
                const sc = (card.suit === 'hearts' || card.suit === 'diamonds') ? 'suit-red' : 'suit-black';
                return (
                  <div key={i} className="playing-card no-hover inline-flex flex-col items-center justify-center w-8 h-11 select-none">
                    <span className={`text-[10px] font-bold leading-tight ${sc}`}>{card.rank}</span>
                    <span className={`text-xs leading-tight ${sc}`}>{SUIT_SYMBOLS[card.suit]}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right column — Value wheel(s) */}
        <div className="flex-1">
          {isSuitOnly ? (
            <>
              <div className="text-[9px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-1 text-center">
                Suit
              </div>
              <WheelPicker
                items={[...ALL_SUITS]}
                selectedIndex={suitIndex >= 0 ? suitIndex : 0}
                onSelect={handleSuitWheel}
                renderItem={renderSuit}
              />
            </>
          ) : needsRank2 ? (
            <div className="flex flex-col gap-1">
              <div>
                <div className="text-[9px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-1 text-center">
                  {handType === HandType.FULL_HOUSE ? '3 of' : 'Pair 1'}
                </div>
                <WheelPicker
                  items={[...rankList]}
                  selectedIndex={rankList.indexOf(rank)}
                  onSelect={handlePrimaryWheel}
                  renderItem={renderRank}
                  itemHeight={36}
                />
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-1 text-center">
                  {handType === HandType.FULL_HOUSE ? '2 of' : 'Pair 2'}
                </div>
                <WheelPicker
                  items={[...rank2List]}
                  selectedIndex={rank2Index >= 0 ? rank2Index : 0}
                  onSelect={handleRank2Wheel}
                  renderItem={renderRank}
                  itemHeight={36}
                />
              </div>
            </div>
          ) : needsStraightRank && needsSuit ? (
            // Straight Flush: rank wheel + suit wheel stacked
            <div className="flex flex-col gap-1">
              <div>
                <div className="text-[9px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-1 text-center">
                  High Card
                </div>
                <WheelPicker
                  items={[...rankList]}
                  selectedIndex={rankList.indexOf(rank)}
                  onSelect={handlePrimaryWheel}
                  renderItem={renderRank}
                  itemHeight={36}
                />
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-1 text-center">
                  Suit
                </div>
                <WheelPicker
                  items={[...ALL_SUITS]}
                  selectedIndex={suitIndex >= 0 ? suitIndex : 0}
                  onSelect={handleSuitWheel}
                  renderItem={renderSuit}
                  itemHeight={36}
                />
              </div>
            </div>
          ) : (
            <>
              <div className="text-[9px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-1 text-center">
                {needsStraightRank ? 'High Card' : 'Rank'}
              </div>
              <WheelPicker
                items={[...rankList]}
                selectedIndex={rankList.indexOf(rank)}
                onSelect={handlePrimaryWheel}
                renderItem={renderRank}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
