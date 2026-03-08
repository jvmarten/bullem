import { useState, useCallback, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { useSound } from '../hooks/useSound.js';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';
import {
  HandType, handToString,
  executeDraw, isFreeDrawAvailable, timeUntilFreeDraw,
  getPayoutTableEntries, createInitialDeckDrawStats,
  DECK_DRAW_MIN_WAGER, DECK_DRAW_MAX_WAGER, DECK_DRAW_DEFAULT_WAGER,
  DECK_DRAW_PAYOUTS,
  type DeckDrawStats, type DeckDrawResult, type Card, type HandCall,
  type Suit, type Rank,
} from '@bull-em/shared';

const STORAGE_KEY = 'bull-em-deck-draw-stats';
const SYNCED_KEY = 'bull-em-deck-draw-synced';

const SUIT_SYMBOLS: Record<Suit, string> = { spades: '\u2660', hearts: '\u2665', diamonds: '\u2666', clubs: '\u2663' };

function getSuitColor(suit: Suit): string {
  return suit === 'hearts' || suit === 'diamonds' ? '#c0392b' : '#1a1a1a';
}

/** Returns indices of cards that form the identified hand */
function getRelevantIndices(cards: Card[], hand: HandCall): Set<number> {
  const indices = new Set<number>();
  switch (hand.type) {
    case HandType.ROYAL_FLUSH:
    case HandType.STRAIGHT_FLUSH:
    case HandType.STRAIGHT:
    case HandType.FLUSH:
    case HandType.FULL_HOUSE:
      for (let i = 0; i < cards.length; i++) indices.add(i);
      break;
    case HandType.FOUR_OF_A_KIND:
    case HandType.THREE_OF_A_KIND:
      for (let i = 0; i < cards.length; i++) {
        if (cards[i]!.rank === (hand as { rank: Rank }).rank) indices.add(i);
      }
      break;
    case HandType.TWO_PAIR:
      for (let i = 0; i < cards.length; i++) {
        if (cards[i]!.rank === (hand as { highRank: Rank }).highRank ||
            cards[i]!.rank === (hand as { lowRank: Rank }).lowRank) {
          indices.add(i);
        }
      }
      break;
    case HandType.PAIR:
      for (let i = 0; i < cards.length; i++) {
        if (cards[i]!.rank === (hand as { rank: Rank }).rank) indices.add(i);
      }
      break;
    case HandType.HIGH_CARD:
      for (let i = 0; i < cards.length; i++) {
        if (cards[i]!.rank === (hand as { rank: Rank }).rank) { indices.add(i); break; }
      }
      break;
  }
  return indices;
}

function loadGuestStats(): DeckDrawStats {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored) as DeckDrawStats;
  } catch { /* ignore parse errors */ }
  return createInitialDeckDrawStats();
}

function saveGuestStats(stats: DeckDrawStats): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch { /* ignore write errors */ }
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatCountdown(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  const secs = Math.floor((ms % (1000 * 60)) / 1000);
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

const WAGER_PRESETS = [10, 50, 100, 500, 1000];

export function DeckDrawPage() {
  const { play } = useSound();
  const { user } = useAuth();
  const { addToast } = useToast();

  const [stats, setStats] = useState<DeckDrawStats>(() => loadGuestStats());
  const [wager, setWager] = useState(DECK_DRAW_DEFAULT_WAGER);
  const [lastResult, setLastResult] = useState<DeckDrawResult | null>(null);
  const [isDealing, setIsDealing] = useState(false);
  const [showHighlight, setShowHighlight] = useState(false);
  const [showPayouts, setShowPayouts] = useState(false);
  const [freeDrawCountdown, setFreeDrawCountdown] = useState(0);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load server stats if logged in
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    fetch('/api/deck-draw/stats', {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(res => {
        if (res.ok) return res.json();
        return null;
      })
      .then((serverStats: DeckDrawStats | null) => {
        if (serverStats) {
          setStats(serverStats);
          // Check if we have unsycned guest stats to merge
          const guestStats = loadGuestStats();
          const alreadySynced = localStorage.getItem(SYNCED_KEY);
          if (!alreadySynced && guestStats.totalDraws > 0) {
            fetch('/api/deck-draw/sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify(guestStats),
            })
              .then(r => r.ok ? r.json() : null)
              .then((merged: DeckDrawStats | null) => {
                if (merged) {
                  setStats(merged);
                  localStorage.setItem(SYNCED_KEY, 'true');
                  addToast('Guest deck draw stats synced to your account');
                }
              })
              .catch(() => {});
          }
        }
      })
      .catch(() => {});
    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Free draw countdown timer
  useEffect(() => {
    const update = () => setFreeDrawCountdown(timeUntilFreeDraw(stats.lastFreeDrawAt));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [stats.lastFreeDrawAt]);

  const canFreeDraw = isFreeDrawAvailable(stats.lastFreeDrawAt);
  const canWager = stats.balance >= wager && wager >= DECK_DRAW_MIN_WAGER;

  const performDraw = useCallback(async (isFreeDraw: boolean) => {
    if (isDealing) return;

    if (!isFreeDraw && !canWager) {
      addToast('Insufficient balance');
      return;
    }

    setIsDealing(true);
    setShowHighlight(false);
    play('cardReveal');

    const doLocalDraw = () => {
      const { result, updatedStats } = executeDraw(stats, wager, isFreeDraw);
      setLastResult(result);
      setStats(updatedStats);
      saveGuestStats(updatedStats);
      if (result.hand.type === HandType.ROYAL_FLUSH) {
        setTimeout(() => play('fanfare'), 600);
      }
    };

    if (user) {
      // Server-authoritative draw for logged-in users
      try {
        const res = await fetch('/api/deck-draw/draw', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ wager: isFreeDraw ? 0 : wager, isFreeDraw }),
        });
        if (!res.ok) {
          if (res.status === 503) {
            // Database unavailable — fall back to client-side draw
            doLocalDraw();
          } else {
            const err = await res.json().catch(() => ({ error: 'Draw failed' }));
            addToast((err as { error: string }).error || 'Draw failed');
            setIsDealing(false);
            return;
          }
        } else {
          const data = await res.json() as { result: DeckDrawResult; stats: DeckDrawStats };
          setLastResult(data.result);
          setStats(data.stats);

          if (data.result.hand.type === HandType.ROYAL_FLUSH) {
            setTimeout(() => play('fanfare'), 600);
          }
        }
      } catch {
        // Network error — fall back to client-side draw
        doLocalDraw();
      }
    } else {
      doLocalDraw();
    }

    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setShowHighlight(true), 900);

    if (dealTimerRef.current) clearTimeout(dealTimerRef.current);
    dealTimerRef.current = setTimeout(() => setIsDealing(false), 800);
  }, [isDealing, canWager, wager, user, stats, play, addToast]);

  const isDealt = lastResult !== null;
  const isRoyal = lastResult?.hand.type === HandType.ROYAL_FLUSH;
  const relevantIndices = lastResult
    ? getRelevantIndices(lastResult.cards, lastResult.hand)
    : new Set<number>();

  const payoutEntries = getPayoutTableEntries();

  const handRarityLabel = (type: HandType): string => {
    switch (type) {
      case HandType.ROYAL_FLUSH:      return '1 in 649,740';
      case HandType.STRAIGHT_FLUSH:   return '1 in 72,193';
      case HandType.FOUR_OF_A_KIND:   return '1 in 4,165';
      case HandType.FULL_HOUSE:       return '1 in 694';
      case HandType.FLUSH:            return '1 in 509';
      case HandType.STRAIGHT:         return '1 in 255';
      case HandType.THREE_OF_A_KIND:  return '1 in 47';
      case HandType.TWO_PAIR:         return '1 in 21';
      case HandType.PAIR:             return '1 in 2.4';
      case HandType.HIGH_CARD:        return '1 in 2';
    }
  };

  const bestHandLabel = stats.bestHandType !== null
    ? payoutEntries.find(e => e.handType === stats.bestHandType)?.label ?? 'None'
    : 'None';

  return (
    <Layout>
      <div className="flex flex-col items-center gap-6 pt-4 max-w-md mx-auto">
        <h1 className="text-2xl font-bold text-[var(--gold)]">Deck Draw</h1>
        <p className="text-sm text-[var(--gold-dim)] text-center -mt-4">
          Draw 5 cards, get paid by rarity. No house edge.
        </p>

        {/* Balance */}
        <div className="glass rounded-xl px-6 py-3 text-center w-full">
          <p className="text-xs uppercase tracking-widest text-[var(--gold-dim)]">Balance</p>
          <p className="text-3xl font-bold text-[var(--gold)]">{formatNumber(stats.balance)}</p>
          {!user && (
            <p className="text-[10px] text-[var(--gold-dim)] mt-1">
              <Link to="/login" className="underline hover:text-[var(--gold)]">Sign in</Link> to save progress
            </p>
          )}
        </div>

        {/* Card display area */}
        <div className="relative flex flex-col items-center" style={{ minHeight: '140px' }}>
          <div
            className="relative flex justify-center items-center"
            style={{ height: '100px', width: '280px' }}
          >
            {Array.from({ length: 5 }, (_, i) => {
              const card = lastResult?.cards[i];
              const centered = i - 2;
              const dealX = centered * 46;
              const isHighlighted = showHighlight && relevantIndices.has(i);
              const popY = isHighlighted ? -16 : 0;
              const x = isDealt ? dealX : i * 0.5;
              const y = (isDealt ? 0 : -i * 1.2) + popY;
              const angle = isDealt ? 0 : (i - 2) * 1.5;

              return (
                <div
                  key={i}
                  className="absolute"
                  style={{
                    transform: `translate(${x}px, ${y}px) rotate(${angle}deg)`,
                    transition: 'transform 0.45s cubic-bezier(0.34, 1.2, 0.64, 1)',
                    zIndex: isHighlighted ? 10 + i : i,
                    perspective: '600px',
                  }}
                >
                  <div
                    style={{
                      transformStyle: 'preserve-3d',
                      transform: `rotateY(${isDealt ? 180 : 0}deg)`,
                      transition: 'transform 0.55s ease-out',
                      transitionDelay: isDealt ? `${i * 0.1}s` : '0s',
                      width: '42px',
                      height: '58px',
                      position: 'relative',
                    }}
                  >
                    <div
                      className="deck-card-back"
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        backfaceVisibility: 'hidden',
                      }}
                    />
                    <div
                      className={isDealt && isRoyal ? 'deck-royal-glow' : ''}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '42px',
                        height: '58px',
                        backfaceVisibility: 'hidden',
                        transform: 'rotateY(180deg)',
                        background: '#f5f0e8',
                        border: isHighlighted ? '1.5px solid var(--gold)' : '1.5px solid #d9d0c0',
                        borderRadius: '5px',
                        boxShadow: isHighlighted
                          ? '0 4px 12px rgba(212, 168, 67, 0.5), 0 0 8px rgba(212, 168, 67, 0.3)'
                          : '0 2px 6px rgba(0,0,0,0.3)',
                        opacity: showHighlight && !isHighlighted ? 0.45 : 1,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'border 0.3s, box-shadow 0.3s, opacity 0.4s',
                      }}
                    >
                      {card && (
                        <>
                          <span style={{
                            fontSize: '11px', fontWeight: 700,
                            color: getSuitColor(card.suit),
                            position: 'absolute', top: '3px', left: '4px', lineHeight: 1,
                          }}>
                            {card.rank}
                          </span>
                          <span style={{ fontSize: '20px', color: getSuitColor(card.suit), lineHeight: 1 }}>
                            {SUIT_SYMBOLS[card.suit]}
                          </span>
                          <span style={{
                            fontSize: '11px', fontWeight: 700,
                            color: getSuitColor(card.suit),
                            position: 'absolute', bottom: '3px', right: '4px', lineHeight: 1,
                            transform: 'rotate(180deg)',
                          }}>
                            {card.rank}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Hand name + payout */}
          <div style={{ minHeight: '48px' }} className="text-center mt-1">
            {lastResult && (
              <>
                <span
                  className={`text-sm font-semibold animate-fade-in block ${isRoyal ? 'text-[var(--gold)]' : 'text-[var(--gold-dim)]'}`}
                  style={{ animationDelay: '0.5s', animationFillMode: 'both' }}
                >
                  {lastResult.handLabel}
                </span>
                {lastResult.payout > 0 && (
                  <span
                    className="text-lg font-bold text-green-400 animate-fade-in block"
                    style={{ animationDelay: '0.7s', animationFillMode: 'both' }}
                  >
                    +{formatNumber(lastResult.payout)}
                  </span>
                )}
                {lastResult.payout === 0 && !lastResult.isFreeDraw && (
                  <span
                    className="text-sm text-red-400 animate-fade-in block"
                    style={{ animationDelay: '0.7s', animationFillMode: 'both' }}
                  >
                    -{formatNumber(lastResult.wager)}
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        {/* Wager controls */}
        <div className="w-full space-y-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--gold-dim)] whitespace-nowrap">Wager:</label>
            <div className="flex gap-1 flex-wrap flex-1">
              {WAGER_PRESETS.map(preset => (
                <button
                  key={preset}
                  onClick={() => { play('uiSoft'); setWager(preset); }}
                  className={`px-2 py-1 rounded text-xs transition-colors min-h-[32px] ${
                    wager === preset
                      ? 'bg-[var(--gold)] text-[var(--felt-dark)] font-semibold'
                      : 'bg-[var(--felt-light)] text-[var(--gold-dim)] hover:text-[var(--gold)]'
                  }`}
                  disabled={stats.balance < preset}
                >
                  {formatNumber(preset)}
                </button>
              ))}
            </div>
          </div>

          {/* Draw buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => { play('uiSoft'); performDraw(false); }}
              disabled={isDealing || !canWager}
              className="flex-1 btn-gold py-3 text-base disabled:opacity-50"
            >
              Draw ({formatNumber(wager)})
            </button>
            <button
              onClick={() => { play('uiSoft'); performDraw(true); }}
              disabled={isDealing || !canFreeDraw}
              className="btn-ghost py-3 px-4 text-sm whitespace-nowrap"
              title={canFreeDraw ? 'Free daily draw available!' : `Next free draw in ${formatCountdown(freeDrawCountdown)}`}
            >
              {canFreeDraw ? 'Free Draw' : formatCountdown(freeDrawCountdown)}
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="glass rounded-xl px-4 py-3 w-full">
          <h2 className="text-xs uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">Lifetime Stats</h2>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <span className="text-[var(--gold-dim)]">Total Draws</span>
            <span className="text-right text-[var(--gold-light)]">{formatNumber(stats.totalDraws)}</span>
            <span className="text-[var(--gold-dim)]">Total Wagered</span>
            <span className="text-right text-[var(--gold-light)]">{formatNumber(stats.totalWagered)}</span>
            <span className="text-[var(--gold-dim)]">Total Won</span>
            <span className="text-right text-[var(--gold-light)]">{formatNumber(stats.totalWon)}</span>
            <span className="text-[var(--gold-dim)]">Biggest Win</span>
            <span className="text-right text-[var(--gold-light)]">{formatNumber(stats.biggestWin)}</span>
            <span className="text-[var(--gold-dim)]">Best Hand</span>
            <span className="text-right text-[var(--gold-light)]">{bestHandLabel}</span>
          </div>
        </div>

        {/* Payout table toggle */}
        <button
          onClick={() => { play('uiSoft'); setShowPayouts(prev => !prev); }}
          className="text-sm text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors"
        >
          {showPayouts ? 'Hide Payout Table' : 'View Payout Table'}
        </button>

        {showPayouts && (
          <div className="glass rounded-xl px-4 py-3 w-full animate-fade-in">
            <h2 className="text-xs uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">Payout Table</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[var(--gold-dim)]">
                  <th className="text-left font-normal pb-1">Hand</th>
                  <th className="text-right font-normal pb-1">Multiplier</th>
                  <th className="text-right font-normal pb-1">Odds</th>
                </tr>
              </thead>
              <tbody>
                {payoutEntries.map(entry => (
                  <tr
                    key={entry.handType}
                    className={lastResult?.hand.type === entry.handType ? 'text-[var(--gold)]' : 'text-[var(--gold-light)]'}
                  >
                    <td className="py-0.5">{entry.label}</td>
                    <td className="text-right py-0.5">
                      {entry.multiplier > 0 ? `${formatNumber(entry.multiplier)}x` : '-'}
                    </td>
                    <td className="text-right py-0.5 text-[var(--gold-dim)] text-xs">
                      {handRarityLabel(entry.handType)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Hand counts */}
        {stats.totalDraws > 0 && (
          <div className="glass rounded-xl px-4 py-3 w-full">
            <h2 className="text-xs uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">Hands Drawn</h2>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm">
              {payoutEntries.map(entry => {
                const count = stats.handCounts[entry.handType] ?? 0;
                if (count === 0) return null;
                return (
                  <div key={entry.handType} className="contents">
                    <span className="text-[var(--gold-dim)]">{entry.label}</span>
                    <span className="text-right text-[var(--gold-light)]">{formatNumber(count)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Back link */}
        <Link
          to="/"
          className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-sm transition-colors mb-8"
        >
          Back to Home
        </Link>
      </div>
    </Layout>
  );
}

export default DeckDrawPage;
