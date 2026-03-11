import { useState, useMemo, useCallback, useEffect, memo } from 'react';
import {
  HandType, ALL_RANKS, ALL_SUITS, RANK_VALUES,
  isHigherHand, handToString, getMinimumRaise,
} from '@bull-em/shared';
import type { HandCall, Rank, Suit, Card } from '@bull-em/shared';
import { SUIT_SYMBOLS } from '../utils/cardUtils.js';
import { WheelPicker } from './WheelPicker.js';
import { useSound } from '../hooks/useSound.js';

interface Props {
  currentHand: HandCall | null;
  onSubmit: (hand: HandCall) => void;
  onHandChange?: (hand: HandCall | null, isValid: boolean) => void;
  submitLabel?: string;
  showSubmit?: boolean;
}

const STRAIGHT_RANKS = ALL_RANKS.filter(r => RANK_VALUES[r] >= 5);
const ALL_HAND_TYPES: HandType[] = Object.values(HandType)
  .filter((v): v is HandType => typeof v === 'number' && v !== HandType.ROYAL_FLUSH);

/* ── Mini card illustrations for hand type picker ──────── */

function HandIllustration({ type, isSelected }: { type: HandType; isSelected: boolean }) {
  const borderW = isSelected ? 'border-2' : 'border-[1.5px]';
  const shadowStyle = isSelected
    ? '0 1px 3px rgba(0,0,0,0.15), 0 0 4px rgba(212,168,67,0.15)'
    : '0 1px 2px rgba(0,0,0,0.12)';

  // Card back — red-backed mini card matching the game's deck-card-back style
  const backBorder = isSelected ? 'border-[var(--gold)]' : 'border-[#d44]';
  const back = (key: number, style?: React.CSSProperties) => (
    <div key={key} className={`w-[36px] h-[48px] rounded-[4px] ${borderW} ${backBorder} flex-shrink-0 relative`} style={{ background: 'linear-gradient(135deg, #c0392b 0%, #8b1a1a 100%)', boxShadow: shadowStyle, transition: 'all 0.2s ease', ...style }}>
      <div className="absolute rounded-[2px]" style={{ inset: '3px', border: '0.5px solid rgba(255,255,255,0.15)' }} />
    </div>
  );

  // Card face with suit symbol — used only for Flush and Straight Flush
  const cardColor = isSelected ? 'bg-[var(--card-face)] border-[var(--gold)]' : 'bg-[#ddd5c8] border-[#b8ae9e]';
  const heart = (key: number, style?: React.CSSProperties) => (
    <div key={key} className={`w-[36px] h-[48px] rounded-[4px] ${borderW} ${cardColor} flex-shrink-0 flex items-center justify-center`} style={{ boxShadow: shadowStyle, transition: 'all 0.2s ease', ...style }}>
      <span className={`text-[15px] leading-none ${isSelected ? 'text-red-600' : 'text-red-400'}`}>♥</span>
    </div>
  );

  const overlap = (i: number): React.CSSProperties => (i > 0 ? { marginLeft: '-16px' } : {});
  const stair = (i: number): React.CSSProperties => ({
    marginLeft: i > 0 ? '-12px' : undefined,
    marginBottom: `${i * 6}px`,
  });

  switch (type) {
    case HandType.HIGH_CARD:
      return <div className="flex justify-center">{back(0)}</div>;
    case HandType.PAIR:
      return <div className="flex justify-center">{[0, 1].map(i => back(i, overlap(i)))}</div>;
    case HandType.TWO_PAIR:
      return (
        <div className="flex justify-center gap-0.5">
          <div className="flex">{[0, 1].map(i => back(i, overlap(i)))}</div>
          <div className="flex">{[2, 3].map(i => back(i, overlap(i > 2 ? 1 : 0)))}</div>
        </div>
      );
    case HandType.THREE_OF_A_KIND:
      return <div className="flex justify-center">{[0, 1, 2].map(i => back(i, overlap(i)))}</div>;
    case HandType.FLUSH:
      return <div className="flex justify-center">{[0, 1, 2].map(i => heart(i, overlap(i)))}</div>;
    case HandType.STRAIGHT:
      return <div className="flex justify-center items-end">{[0, 1, 2].map(i => back(i, stair(i)))}</div>;
    case HandType.FULL_HOUSE:
      return (
        <div className="flex justify-center gap-0.5">
          <div className="flex">{[0, 1, 2].map(i => back(i, overlap(i)))}</div>
          <div className="flex">{[3, 4].map(i => back(i, overlap(i > 3 ? 1 : 0)))}</div>
        </div>
      );
    case HandType.FOUR_OF_A_KIND:
      return <div className="flex justify-center">{[0, 1, 2, 3].map(i => back(i, overlap(i)))}</div>;
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
      return { rank: r, suit: suitOverride ?? suits[i % 4]! };
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
  let ht = minRaise.type;
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
    // Royal Flush is not in the hand type wheel — present it as Straight Flush
    // with Ace high, which the hand builder auto-converts to Royal Flush.
    case HandType.ROYAL_FLUSH: ht = HandType.STRAIGHT_FLUSH; suit = minRaise.suit; rank = 'A'; break;
  }
  return { handType: ht, rank, rank2, suit };
}

/* ── Main Component ────────────────────────────────────── */

// Memoized: parent (GamePage/LocalGamePage) re-renders on every state broadcast
// (turn history, player updates, timer ticks), but HandSelector's props only change
// when the current hand changes or the turn changes. This is a heavy component with
// multiple WheelPickers and internal state — skipping needless re-renders avoids
// expensive reconciliation of the picker DOM trees.
export const HandSelector = memo(function HandSelector({ currentHand, onSubmit, onHandChange, submitLabel, showSubmit = true }: Props) {
  const label = submitLabel ?? (currentHand ? 'Raise' : 'Call');
  const initial = getInitialState(currentHand);
  const [handType, setHandType] = useState<HandType>(initial.handType);
  const [rank, setRank] = useState<Rank>(initial.rank);
  const [rank2, setRank2] = useState<Rank>(initial.rank2);
  const [suit, setSuit] = useState<Suit>(initial.suit);

  const { play, playHandPreview } = useSound();
  const handleTickSound = useCallback(() => play('wheelTick'), [play]);
  const handleTickSoundLow = useCallback(() => play('wheelTickLow'), [play]);
  const handleSelectSound = useCallback(() => play('wheelSelect'), [play]);

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

  // Memoize the built hand so the effect below only fires when inputs change,
  // not on every render (a new object reference would cause the effect to loop).
  const hand = useMemo((): HandCall | null => {
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

  const isValid = hand !== null && (!currentHand || isHigherHand(hand, currentHand));

  useEffect(() => {
    onHandChange?.(hand, isValid);
    if (hand) playHandPreview(hand);
  }, [hand, isValid, onHandChange, playHandPreview]);

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
    // "Must be higher" is shown by the parent under the raise button to avoid layout jerk
    return '';
  }, [hand, rank, rank2, needsRank2, needsStraightRank]);

  const previewCards = useMemo(() => getPreviewCards(hand), [hand]);

  const rankList = needsStraightRank ? STRAIGHT_RANKS : ALL_RANKS;
  const rank2List = useMemo(() => ALL_RANKS.filter(r => r !== rank), [rank]);

  // Filter rank options to exclude values that can't beat the current call
  // when the selected hand type matches the current call's type. Higher hand
  // types always show all ranks (e.g., three 2s is valid over pair of 10s).
  const filteredRankList = useMemo(() => {
    if (!currentHand || handType !== currentHand.type) return rankList;

    switch (handType) {
      case HandType.HIGH_CARD:
      case HandType.PAIR:
      case HandType.THREE_OF_A_KIND:
      case HandType.FOUR_OF_A_KIND: {
        const minVal = RANK_VALUES[(currentHand as { rank: Rank }).rank];
        return rankList.filter(r => RANK_VALUES[r] > minVal);
      }
      case HandType.STRAIGHT: {
        const minVal = RANK_VALUES[(currentHand as { highRank: Rank }).highRank];
        return rankList.filter(r => RANK_VALUES[r] > minVal);
      }
      case HandType.STRAIGHT_FLUSH: {
        // Same highRank with a higher suit is valid, so keep the current rank
        const minVal = RANK_VALUES[(currentHand as { highRank: Rank }).highRank];
        return rankList.filter(r => RANK_VALUES[r] >= minVal);
      }
      case HandType.FULL_HOUSE: {
        // threeRank must be >= current threeRank
        const minVal = RANK_VALUES[(currentHand as { threeRank: Rank }).threeRank];
        return rankList.filter(r => RANK_VALUES[r] >= minVal);
      }
      default:
        return rankList;
    }
  }, [currentHand, handType, rankList]);

  // Filter rank2 (twoRank) for Full House when threeRank matches current call
  const filteredRank2List = useMemo(() => {
    if (!currentHand || handType !== currentHand.type || handType !== HandType.FULL_HOUSE) return rank2List;
    const curr = currentHand as { threeRank: Rank; twoRank: Rank };
    if (rank !== curr.threeRank) return rank2List;
    // Same threeRank — twoRank must beat current twoRank
    return rank2List.filter(r => RANK_VALUES[r] > RANK_VALUES[curr.twoRank]);
  }, [currentHand, handType, rank, rank2List]);

  // Auto-adjust rank when it falls outside the filtered list
  useEffect(() => {
    if (filteredRankList.length > 0 && !filteredRankList.includes(rank)) {
      setRank(filteredRankList[0]!);
    }
  }, [filteredRankList, rank]);

  // Auto-adjust rank2 when it falls outside the filtered list
  useEffect(() => {
    if (filteredRank2List.length > 0 && !filteredRank2List.includes(rank2)) {
      setRank2(filteredRank2List[0]!);
    }
  }, [filteredRank2List, rank2]);

  const handTypeIndex = ALL_HAND_TYPES.indexOf(handType);
  // Prevent scrolling/selecting hand types below the current call.
  // Also skip the current hand type entirely when no valid raise exists
  // within it (e.g., pair of Aces → skip PAIR, FLUSH → all flushes equal).
  const minHandTypeIndex = useMemo(() => {
    if (!currentHand) return 0;
    const idx = ALL_HAND_TYPES.indexOf(currentHand.type);
    if (idx < 0) return 0;

    switch (currentHand.type) {
      case HandType.HIGH_CARD:
      case HandType.PAIR:
      case HandType.THREE_OF_A_KIND:
      case HandType.FOUR_OF_A_KIND:
        // Ace is the highest rank — can't beat it within the same type
        if ((currentHand as { rank: Rank }).rank === 'A') return idx + 1;
        return idx;
      case HandType.TWO_PAIR:
        // Highest two pair is Aces and Kings
        if (currentHand.highRank === 'A' && currentHand.lowRank === 'K') return idx + 1;
        return idx;
      case HandType.FLUSH:
        // All flushes are equal — must raise to a higher hand type
        return idx + 1;
      case HandType.STRAIGHT:
        if ((currentHand as { highRank: Rank }).highRank === 'A') return idx + 1;
        return idx;
      case HandType.FULL_HOUSE:
        // Highest full house is Aces over Kings
        if (currentHand.threeRank === 'A' && currentHand.twoRank === 'K') return idx + 1;
        return idx;
      case HandType.STRAIGHT_FLUSH: {
        // King-high in spades is the highest straight flush
        const sf = currentHand as { highRank: Rank; suit: Suit };
        if (sf.highRank === 'K' && sf.suit === 'spades') return idx + 1;
        return idx;
      }
      default:
        return idx;
    }
  }, [currentHand]);
  const handleTypeWheel = useCallback((idx: number) => handleTypeChange(ALL_HAND_TYPES[idx]!), [handleTypeChange]);

  const handlePrimaryWheel = useCallback((idx: number) => {
    if (needsSuit && !needsRank && !needsStraightRank && !needsRank2) {
      setSuit(ALL_SUITS[idx]!);
    } else if (needsRank2) {
      handleRank1Change(filteredRankList[idx]!);
    } else {
      setRank(filteredRankList[idx]!);
    }
  }, [needsSuit, needsRank, needsStraightRank, needsRank2, filteredRankList, handleRank1Change]);

  const rank2Index = filteredRank2List.indexOf(rank2);
  const handleRank2Wheel = useCallback((idx: number) => setRank2(filteredRank2List[idx]!), [filteredRank2List]);

  const suitIndex = ALL_SUITS.indexOf(suit);
  const handleSuitWheel = useCallback((idx: number) => setSuit(ALL_SUITS[idx]!), []);

  const isSuitOnly = needsSuit && !needsRank && !needsStraightRank && !needsRank2;
  const hasSuitBelow = needsStraightRank && needsSuit;
  const hasSecondary = hasSuitBelow;

  /* ── Render callbacks ───────────────────────────────── */

  const renderHandType = useCallback((ht: HandType, isSelected: boolean) => {
    const isDisabled = currentHand !== null && ht < currentHand.type;
    return (
      <div className={`hs-type-wheel-item ${isSelected ? 'hs-type-wheel-item-selected' : ''} ${isDisabled ? 'hs-type-wheel-item-disabled' : ''}`}>
        <HandIllustration type={ht} isSelected={isSelected} />
      </div>
    );
  }, [currentHand]);

  const renderRank = useCallback((r: string, isSelected: boolean) => (
    <div className={`hs-rank-wheel-card ${isSelected ? 'hs-rank-wheel-card-selected' : ''}`}>
      <span className={`hs-rank-wheel-label ${isSelected ? 'hs-rank-wheel-label-selected' : ''}`}>{r}</span>
    </div>
  ), []);

  const renderSuit = useCallback((s: string, isSelected: boolean) => {
    const isRed = s === 'hearts' || s === 'diamonds';
    return (
      <div className={`hs-rank-wheel-card hs-suit-wheel-card ${isSelected ? 'hs-rank-wheel-card-selected' : ''}`} data-suit-card>
        <span className={`hs-suit-wheel-symbol ${isSelected ? 'hs-suit-wheel-symbol-selected' : ''} ${isRed ? 'hs-suit-red' : 'hs-suit-black'}`}>
          {SUIT_SYMBOLS[s as Suit]}
        </span>
      </div>
    );
  }, []);

  // Stable array references for WheelPicker items — avoids re-rendering
  // the picker on every parent render due to new array identity.
  const suitsArray = useMemo(() => [...ALL_SUITS], []);

  const handleSubmit = useCallback(() => {
    if (hand && isValid) {
      play('callMade');
      onSubmit(hand);
    }
  }, [hand, isValid, onSubmit, play]);

  return (
    <div className="animate-slide-up hs-backdrop" data-testid="hand-selector" role="group" aria-label="Hand selector">
      {/* Top: Hand name */}
      <div className="text-center py-0.5">
        {hand ? (
          <span className="font-display text-base font-bold text-[var(--gold)]">
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
      <div className="flex justify-center flex-wrap gap-0.5 py-1 mb-0 min-h-[56px] items-center">
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
            itemHeight={70}
            visibleCount={3}
            minIndex={minHandTypeIndex}
            onTickSound={handleTickSoundLow}
            onSelectSound={handleSelectSound}
          />
        </div>

        {/* Right column — Rank / suit wheel(s) */}
        <div className="flex-1">
          {needsRank2 ? (
            /* Side-by-side rank pickers for Two Pair / Full House */
            <div className="flex gap-1">
              <div className="flex-1">
                <WheelPicker
                  items={filteredRankList}
                  selectedIndex={Math.max(0, filteredRankList.indexOf(rank))}
                  onSelect={handlePrimaryWheel}
                  renderItem={renderRank}
                  itemHeight={42}
                  visibleCount={5}
                  highlightHeight={70}
                  onTickSound={handleTickSound}
                  onSelectSound={handleSelectSound}
                />
              </div>
              <div
                className="flex-1"
                style={{
                  overflow: 'hidden',
                  maxWidth: needsRank2 ? '50%' : '0',
                  opacity: needsRank2 ? 1 : 0,
                  transition: 'max-width 0.6s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.5s ease 0.1s',
                }}
              >
                <WheelPicker
                  items={filteredRank2List}
                  selectedIndex={rank2Index >= 0 ? rank2Index : 0}
                  onSelect={handleRank2Wheel}
                  renderItem={renderRank}
                  itemHeight={42}
                  visibleCount={5}
                  highlightHeight={70}
                  onTickSound={handleTickSound}
                  onSelectSound={handleSelectSound}
                />
              </div>
            </div>
          ) : hasSuitBelow ? (
            /* Side-by-side rank + suit for Straight Flush */
            <div className="flex gap-1">
              <div className="flex-1">
                <WheelPicker
                  items={filteredRankList}
                  selectedIndex={Math.max(0, filteredRankList.indexOf(rank))}
                  onSelect={handlePrimaryWheel}
                  renderItem={renderRank}
                  itemHeight={42}
                  visibleCount={5}
                  highlightHeight={70}
                  onTickSound={handleTickSound}
                  onSelectSound={handleSelectSound}
                />
              </div>
              <div className="flex-1">
                <WheelPicker
                  items={suitsArray}
                  selectedIndex={suitIndex >= 0 ? suitIndex : 0}
                  onSelect={handleSuitWheel}
                  renderItem={renderSuit}
                  itemHeight={42}
                  visibleCount={5}
                  highlightHeight={70}
                  onTickSound={handleTickSound}
                  onSelectSound={handleSelectSound}
                />
              </div>
            </div>
          ) : (
            /* Single wheel — rank or suit only */
            isSuitOnly ? (
              <WheelPicker
                items={suitsArray}
                selectedIndex={suitIndex >= 0 ? suitIndex : 0}
                onSelect={handleSuitWheel}
                renderItem={renderSuit}
                itemHeight={42}
                visibleCount={5}
                highlightHeight={70}
                onTickSound={handleTickSound}
                onSelectSound={handleSelectSound}
              />
            ) : (
              <WheelPicker
                items={filteredRankList}
                selectedIndex={Math.max(0, filteredRankList.indexOf(rank))}
                onSelect={handlePrimaryWheel}
                renderItem={renderRank}
                itemHeight={42}
                visibleCount={5}
                highlightHeight={70}
                onTickSound={handleTickSound}
                onSelectSound={handleSelectSound}
              />
            )
          )}
        </div>
      </div>

      {/* Submit row — hidden when parent handles submit externally */}
      {showSubmit && (
        <div className="flex justify-end items-center mt-2">
          <button
            onClick={handleSubmit}
            disabled={!hand || !isValid}
            className={`btn-gold px-6 py-2 text-base font-bold ${hand && isValid ? 'hs-call-pulse' : ''}`}
            aria-label={hand ? `${label}: ${handToString(hand)}` : label}
          >
            {label}
          </button>
        </div>
      )}
    </div>
  );
});
