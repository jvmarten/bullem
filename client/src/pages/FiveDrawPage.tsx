import { useState, useCallback, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { HandSelector } from '../components/HandSelector.js';
import { useSound } from '../hooks/useSound.js';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';
import {
  HandType, handToString, isHigherHand, getMinimumRaise,
  dealFiveDrawCards, getDealerAction, resolveFiveDraw,
  FIVE_DRAW_MIN_WAGER, FIVE_DRAW_MAX_WAGER, FIVE_DRAW_DEFAULT_WAGER,
  FIVE_DRAW_WIN_MULTIPLIER,
  DECK_DRAW_STARTING_BALANCE,
  type Card, type HandCall, type Suit, type Rank,
  type FiveDrawTurnEntry, type FiveDrawResult, type FiveDrawParticipant,
} from '@bull-em/shared';

const STORAGE_KEY = 'bull-em-five-draw-balance';

const SUIT_SYMBOLS: Record<Suit, string> = { spades: '\u2660', hearts: '\u2665', diamonds: '\u2666', clubs: '\u2663' };

function getSuitColor(suit: Suit): string {
  return suit === 'hearts' || suit === 'diamonds' ? '#c0392b' : '#1a1a1a';
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

const WAGER_PRESETS = [1, 5, 10, 50, 100];

type GamePhase = 'wager' | 'dealing' | 'playing' | 'dealer_thinking' | 'resolving' | 'result';

function loadGuestBalance(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const val = parseInt(stored, 10);
      if (!isNaN(val) && val >= 0) return val;
    }
  } catch { /* ignore */ }
  return DECK_DRAW_STARTING_BALANCE;
}

function saveGuestBalance(balance: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(balance));
  } catch { /* ignore */ }
}

/** Render a single playing card (face up or face down). */
function CardView({
  card,
  faceUp,
  highlighted,
  dimmed,
  size = 'normal',
}: {
  card?: Card;
  faceUp: boolean;
  highlighted?: boolean;
  dimmed?: boolean;
  size?: 'normal' | 'small';
}) {
  const w = size === 'small' ? 36 : 42;
  const h = size === 'small' ? 50 : 58;
  const fontSize = size === 'small' ? '9px' : '11px';
  const suitSize = size === 'small' ? '16px' : '20px';

  if (!faceUp || !card) {
    return <div className="deck-card-back" style={{ width: `${w}px`, height: `${h}px` }} />;
  }

  return (
    <div
      style={{
        width: `${w}px`,
        height: `${h}px`,
        background: '#f5f0e8',
        border: highlighted ? '1.5px solid var(--gold)' : '1.5px solid #d9d0c0',
        borderRadius: '5px',
        boxShadow: highlighted
          ? '0 4px 12px rgba(212, 168, 67, 0.5), 0 0 8px rgba(212, 168, 67, 0.3)'
          : '0 2px 6px rgba(0,0,0,0.3)',
        opacity: dimmed ? 0.45 : 1,
        display: 'flex',
        flexDirection: 'column' as const,
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative' as const,
        transition: 'border 0.3s, box-shadow 0.3s, opacity 0.4s',
      }}
    >
      <span style={{
        fontSize, fontWeight: 700,
        color: getSuitColor(card.suit),
        position: 'absolute', top: '3px', left: '4px', lineHeight: 1,
      }}>
        {card.rank}
      </span>
      <span style={{ fontSize: suitSize, color: getSuitColor(card.suit), lineHeight: 1 }}>
        {SUIT_SYMBOLS[card.suit]}
      </span>
      <span style={{
        fontSize, fontWeight: 700,
        color: getSuitColor(card.suit),
        position: 'absolute', bottom: '3px', right: '4px', lineHeight: 1,
        transform: 'rotate(180deg)',
      }}>
        {card.rank}
      </span>
    </div>
  );
}

/** Render a row of 5 cards. */
function CardRow({
  cards,
  faceUp,
  label,
  revealedCount,
}: {
  cards: Card[];
  faceUp: boolean;
  label: string;
  revealedCount?: number;
}) {
  const count = revealedCount ?? (faceUp ? 5 : 0);
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-xs text-[var(--gold-dim)] uppercase tracking-wider">{label}</span>
      <div className="flex gap-1">
        {cards.map((card, i) => (
          <div
            key={i}
            style={{
              perspective: '600px',
            }}
          >
            <div
              style={{
                transformStyle: 'preserve-3d',
                transform: `rotateY(${i < count ? 180 : 0}deg)`,
                transition: 'transform 0.6s ease-out',
                width: '42px',
                height: '58px',
                position: 'relative',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  backfaceVisibility: 'hidden',
                }}
              >
                <CardView card={card} faceUp={false} />
              </div>
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  backfaceVisibility: 'hidden',
                  transform: 'rotateY(180deg)',
                }}
              >
                <CardView card={card} faceUp={true} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FiveDrawPage() {
  const { play } = useSound();
  const { user } = useAuth();
  const { addToast } = useToast();

  const [balance, setBalance] = useState(() => loadGuestBalance());
  const [wager, setWager] = useState(FIVE_DRAW_DEFAULT_WAGER);
  const [showCustomWager, setShowCustomWager] = useState(false);
  const [customWagerInput, setCustomWagerInput] = useState('');
  const [phase, setPhase] = useState<GamePhase>('wager');

  // Game state
  const [playerCards, setPlayerCards] = useState<Card[]>([]);
  const [dealerCards, setDealerCards] = useState<Card[]>([]);
  const [turnHistory, setTurnHistory] = useState<FiveDrawTurnEntry[]>([]);
  const [currentHand, setCurrentHand] = useState<HandCall | null>(null);
  const [whoseTurn, setWhoseTurn] = useState<FiveDrawParticipant>('player');
  const [result, setResult] = useState<FiveDrawResult | null>(null);

  // Animation state
  const [playerDealtCount, setPlayerDealtCount] = useState(0);
  const [dealerDealtCount, setDealerDealtCount] = useState(0);
  const [playerRevealCount, setPlayerRevealCount] = useState(0);
  const [dealerRevealCount, setDealerRevealCount] = useState(0);

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    for (const t of timersRef.current) clearTimeout(t);
    timersRef.current = [];
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const schedule = useCallback((fn: () => void, delay: number) => {
    const t = setTimeout(fn, delay);
    timersRef.current.push(t);
    return t;
  }, []);

  // Load balance from server if logged in
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    fetch('/api/deck-draw/stats', {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(res => res.ok ? res.json() : null)
      .then((stats: { balance: number } | null) => {
        if (stats) setBalance(stats.balance);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [user]);

  const canWager = balance >= wager && wager >= FIVE_DRAW_MIN_WAGER;

  /** Start a new game: deal cards and begin playing. */
  const startGame = useCallback(() => {
    if (!canWager) {
      addToast('Insufficient balance');
      return;
    }

    clearTimers();

    // Deduct wager
    const newBalance = balance - wager;
    setBalance(newBalance);
    if (!user) saveGuestBalance(newBalance);

    // Deal cards
    const { playerCards: pc, dealerCards: dc } = dealFiveDrawCards();
    setPlayerCards(pc);
    setDealerCards(dc);
    setTurnHistory([]);
    setCurrentHand(null);
    setWhoseTurn('player');
    setResult(null);
    setPlayerDealtCount(0);
    setDealerDealtCount(0);
    setPlayerRevealCount(0);
    setDealerRevealCount(0);

    // Dealing animation
    setPhase('dealing');
    play('deckShuffle');

    // Deal player cards face down, then reveal
    for (let i = 0; i < 5; i++) {
      schedule(() => setPlayerDealtCount(i + 1), 600 + i * 120);
    }
    // Deal dealer cards face down
    for (let i = 0; i < 5; i++) {
      schedule(() => setDealerDealtCount(i + 1), 600 + 5 * 120 + i * 120);
    }

    // Reveal player cards
    const revealStart = 600 + 10 * 120 + 300;
    for (let i = 0; i < 5; i++) {
      schedule(() => {
        play('cardReveal');
        setPlayerRevealCount(i + 1);
      }, revealStart + i * 200);
    }

    // Transition to playing phase
    schedule(() => {
      setPhase('playing');
    }, revealStart + 5 * 200 + 300);
  }, [canWager, balance, wager, user, clearTimers, play, schedule, addToast]);

  /** Player makes a call. */
  const handlePlayerCall = useCallback((hand: HandCall) => {
    if (phase !== 'playing' || whoseTurn !== 'player') return;

    // Validate the call is higher than current
    if (currentHand && !isHigherHand(hand, currentHand)) {
      addToast('Must call a higher hand');
      return;
    }

    play('callMade');

    const entry: FiveDrawTurnEntry = { participant: 'player', action: 'call', hand };
    const newHistory = [...turnHistory, entry];
    setTurnHistory(newHistory);
    setCurrentHand(hand);
    setWhoseTurn('dealer');
    setPhase('dealer_thinking');

    // Dealer responds after a short delay
    schedule(() => {
      const dealerResponse = getDealerAction(dealerCards, hand, newHistory);
      const finalHistory = [...newHistory, dealerResponse];
      setTurnHistory(finalHistory);

      if (dealerResponse.action === 'pass') {
        // Dealer passes — resolve
        play('bullCalled');
        resolveGame(playerCards, dealerCards, finalHistory);
      } else {
        // Dealer raises
        play('callMade');
        setCurrentHand(dealerResponse.hand!);
        setWhoseTurn('player');
        setPhase('playing');
      }
    }, 1500 + Math.random() * 1000); // 1.5-2.5s thinking time
  }, [phase, whoseTurn, currentHand, turnHistory, dealerCards, playerCards, play, schedule, addToast]);

  /** Player passes (doesn't raise). */
  const handlePlayerPass = useCallback(() => {
    if (phase !== 'playing' || whoseTurn !== 'player') return;
    if (!currentHand) {
      addToast('You must make the opening call');
      return;
    }

    play('bullCalled');

    const entry: FiveDrawTurnEntry = { participant: 'player', action: 'pass' };
    const newHistory = [...turnHistory, entry];
    setTurnHistory(newHistory);
    resolveGame(playerCards, dealerCards, newHistory);
  }, [phase, whoseTurn, currentHand, turnHistory, playerCards, dealerCards, play, addToast]);

  /** Resolve the game and show results. */
  const resolveGame = useCallback((pc: Card[], dc: Card[], history: FiveDrawTurnEntry[]) => {
    setPhase('resolving');

    const gameResult = resolveFiveDraw(pc, dc, history, wager);
    setResult(gameResult);

    // Reveal dealer cards
    for (let i = 0; i < 5; i++) {
      schedule(() => {
        play('cardReveal');
        setDealerRevealCount(i + 1);
      }, 500 + i * 400);
    }

    // Show result
    schedule(() => {
      // Update balance
      const winnings = gameResult.payout;
      setBalance(prev => {
        const newBal = prev + winnings;
        if (!user) saveGuestBalance(newBal);

        // Persist to server if logged in
        if (user) {
          const netChange = winnings - wager;
          fetch('/api/five-draw/result', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ wager, won: gameResult.winner === 'player', payout: winnings }),
          }).catch(() => {});
        }

        return newBal;
      });

      setPhase('result');

      if (gameResult.winner === 'player') {
        play('roundWin');
      } else {
        play('bullCalled');
      }
    }, 500 + 5 * 400 + 800);
  }, [wager, user, play, schedule]);

  /** Reset to wager screen for a new game. */
  const playAgain = useCallback(() => {
    clearTimers();
    setPhase('wager');
    setPlayerCards([]);
    setDealerCards([]);
    setTurnHistory([]);
    setCurrentHand(null);
    setResult(null);
    setPlayerDealtCount(0);
    setDealerDealtCount(0);
    setPlayerRevealCount(0);
    setDealerRevealCount(0);
  }, [clearTimers]);

  // Check if player can raise
  const canPlayerRaise = currentHand ? !!getMinimumRaise(currentHand) : true;

  return (
    <Layout>
      <div className="flex flex-col items-center gap-4 pt-4 max-w-md mx-auto pb-8">
        <h1 className="text-2xl font-bold text-[var(--gold)]">5 Draw</h1>
        <p className="text-sm text-[var(--gold-dim)] text-center -mt-3">
          Call hands against the Dealer. Highest call gets checked.
        </p>

        {/* Balance */}
        <div className="glass rounded-xl px-6 py-2 text-center w-full">
          <p className="text-xs uppercase tracking-widest text-[var(--gold-dim)]">Balance</p>
          <p className="text-3xl font-bold text-[var(--gold)]">{formatNumber(balance)}</p>
          {!user && (
            <p className="text-[10px] text-[var(--gold-dim)] mt-1">
              <Link to="/login" className="underline hover:text-[var(--gold)]">Sign in</Link> to save progress
            </p>
          )}
        </div>

        {/* Wager Selection */}
        {phase === 'wager' && (
          <div className="w-full space-y-3 animate-fade-in">
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--gold-dim)] whitespace-nowrap">Wager:</label>
              <div className="flex gap-1 flex-wrap flex-1">
                {WAGER_PRESETS.map(preset => (
                  <button
                    key={preset}
                    onClick={() => { play('uiSoft'); setWager(preset); setShowCustomWager(false); }}
                    className={`px-2 py-1 rounded text-xs transition-colors min-h-[32px] ${
                      wager === preset && !showCustomWager
                        ? 'bg-[var(--gold)] text-[var(--felt-dark)] font-semibold'
                        : 'bg-[var(--felt-light)] text-[var(--gold-dim)] hover:text-[var(--gold)]'
                    }`}
                    disabled={balance < preset}
                  >
                    {formatNumber(preset)}
                  </button>
                ))}
                <button
                  onClick={() => { play('uiSoft'); setShowCustomWager(prev => !prev); }}
                  className={`px-2 py-1 rounded text-xs transition-colors min-h-[32px] ${
                    showCustomWager
                      ? 'bg-[var(--gold)] text-[var(--felt-dark)] font-semibold'
                      : 'bg-[var(--felt-light)] text-[var(--gold-dim)] hover:text-[var(--gold)]'
                  }`}
                >
                  Custom
                </button>
              </div>
            </div>
            {showCustomWager && (
              <div className="flex items-center gap-2 animate-fade-in">
                <input
                  type="number"
                  min={FIVE_DRAW_MIN_WAGER}
                  max={Math.min(FIVE_DRAW_MAX_WAGER, balance)}
                  value={customWagerInput}
                  onChange={(e) => setCustomWagerInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const val = parseInt(customWagerInput, 10);
                      if (!isNaN(val) && val >= FIVE_DRAW_MIN_WAGER && val <= FIVE_DRAW_MAX_WAGER) {
                        setWager(val);
                        play('uiSoft');
                      }
                    }
                  }}
                  placeholder={`${FIVE_DRAW_MIN_WAGER}–${formatNumber(FIVE_DRAW_MAX_WAGER)}`}
                  className="flex-1 bg-[var(--surface)] text-[var(--gold)] text-xs rounded px-3 py-2 border border-[var(--gold-dim)]/30 focus:border-[var(--gold)] focus:outline-none min-h-[36px]"
                  autoComplete="off"
                />
                <button
                  onClick={() => {
                    const val = parseInt(customWagerInput, 10);
                    if (!isNaN(val) && val >= FIVE_DRAW_MIN_WAGER && val <= FIVE_DRAW_MAX_WAGER) {
                      setWager(val);
                      play('uiSoft');
                    }
                  }}
                  className="btn-ghost text-xs px-3 py-2 min-h-[36px]"
                >
                  Set
                </button>
              </div>
            )}

            {/* Rules summary */}
            <div className="glass rounded-xl px-4 py-3 w-full">
              <h2 className="text-xs uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">How It Works</h2>
              <ul className="text-xs text-[var(--gold-light)] space-y-1 list-disc list-inside">
                <li>You and the Dealer each get 5 cards</li>
                <li>Take turns calling poker hands (raise or pass)</li>
                <li>When someone passes, the last call is checked against all 10 cards</li>
                <li>If the hand exists, the caller wins. If not, the passer wins</li>
                <li>Winner gets {FIVE_DRAW_WIN_MULTIPLIER}x the wager</li>
              </ul>
            </div>

            <button
              onClick={() => { play('uiSoft'); startGame(); }}
              disabled={!canWager}
              className="w-full btn-gold py-3 text-base disabled:opacity-50"
            >
              Deal ({formatNumber(wager)})
            </button>
          </div>
        )}

        {/* Dealing animation */}
        {phase === 'dealing' && (
          <div className="w-full space-y-4 animate-fade-in">
            <CardRow cards={dealerCards} faceUp={false} label="Dealer" revealedCount={0} />
            <div className="text-center">
              <span className="text-xs text-[var(--gold-dim)] animate-pulse">Dealing...</span>
            </div>
            <CardRow cards={playerCards} faceUp={true} label="You" revealedCount={playerRevealCount} />
          </div>
        )}

        {/* Active gameplay */}
        {(phase === 'playing' || phase === 'dealer_thinking') && (
          <div className="w-full space-y-4 animate-fade-in">
            {/* Dealer's cards (face down) */}
            <CardRow cards={dealerCards} faceUp={false} label="Dealer" revealedCount={0} />

            {/* Current call display */}
            <div className="glass rounded-xl px-4 py-3 text-center">
              {currentHand ? (
                <>
                  <p className="text-xs text-[var(--gold-dim)]">Current Call</p>
                  <p className="text-lg font-semibold text-[var(--gold)]">
                    {handToString(currentHand)}
                  </p>
                  <p className="text-xs text-[var(--gold-dim)] mt-1">
                    Called by {turnHistory[turnHistory.length - 1]?.participant === 'dealer' ? 'Dealer' :
                      [...turnHistory].reverse().find(e => e.action === 'call')?.participant === 'player' ? 'You' : 'Dealer'}
                  </p>
                </>
              ) : (
                <p className="text-sm text-[var(--gold-dim)]">Make the opening call</p>
              )}
            </div>

            {/* Turn history */}
            {turnHistory.length > 0 && (
              <div className="glass rounded-xl px-4 py-2">
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {turnHistory.map((entry, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className={entry.participant === 'player' ? 'text-[var(--gold)]' : 'text-[var(--gold-dim)]'}>
                        {entry.participant === 'player' ? 'You' : 'Dealer'}
                      </span>
                      <span className="text-[var(--gold-dim)]">
                        {entry.action === 'call' ? `called ${handToString(entry.hand!)}` : 'passed'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Player action area */}
            {phase === 'playing' && whoseTurn === 'player' && (
              <div className="space-y-3">
                <p className="text-sm text-center text-[var(--gold)]">Your turn</p>
                <HandSelector
                  currentHand={currentHand}
                  onSubmit={handlePlayerCall}
                  submitLabel={currentHand ? 'Raise' : 'Call'}
                  showSubmit={true}
                />
                {currentHand && (
                  <button
                    onClick={handlePlayerPass}
                    className="w-full btn-ghost py-2 text-sm"
                  >
                    Pass
                  </button>
                )}
              </div>
            )}

            {/* Dealer thinking indicator */}
            {phase === 'dealer_thinking' && (
              <div className="text-center py-4">
                <span className="text-sm text-[var(--gold-dim)] animate-pulse">Dealer is thinking...</span>
              </div>
            )}

            {/* Player's cards */}
            <CardRow cards={playerCards} faceUp={true} label="You" revealedCount={5} />
          </div>
        )}

        {/* Resolving phase - revealing dealer cards */}
        {phase === 'resolving' && (
          <div className="w-full space-y-4 animate-fade-in">
            <CardRow cards={dealerCards} faceUp={true} label="Dealer" revealedCount={dealerRevealCount} />
            <div className="text-center">
              <span className="text-sm text-[var(--gold-dim)] animate-pulse">Revealing cards...</span>
            </div>
            <CardRow cards={playerCards} faceUp={true} label="You" revealedCount={5} />
          </div>
        )}

        {/* Result screen */}
        {phase === 'result' && result && (
          <div className="w-full space-y-4 animate-fade-in">
            {/* Both hands revealed */}
            <CardRow cards={dealerCards} faceUp={true} label="Dealer" revealedCount={5} />

            {/* Result announcement */}
            <div className="glass rounded-xl px-4 py-4 text-center">
              <p className="text-xs text-[var(--gold-dim)] mb-1">Last Call</p>
              <p className="text-lg font-semibold text-[var(--gold)]">
                {handToString(result.lastCall)}
              </p>
              <p className="text-xs text-[var(--gold-dim)] mt-1">
                by {result.lastCaller === 'player' ? 'You' : 'Dealer'}
              </p>
              <div className="mt-3">
                <p className={`text-sm font-semibold ${result.handExists ? 'text-green-400' : 'text-red-400'}`}>
                  {result.handExists ? 'Hand exists!' : 'Hand does not exist!'}
                </p>
                <p className={`text-2xl font-bold mt-1 ${result.winner === 'player' ? 'text-green-400' : 'text-red-400'}`}>
                  {result.winner === 'player' ? 'You Win!' : 'Dealer Wins'}
                </p>
                {result.winner === 'player' ? (
                  <p className="text-lg font-bold text-green-400 mt-1">
                    +{formatNumber(result.payout)}
                  </p>
                ) : (
                  <p className="text-sm text-red-400 mt-1">
                    -{formatNumber(result.wager)}
                  </p>
                )}
              </div>
            </div>

            {/* Turn history */}
            <div className="glass rounded-xl px-4 py-2">
              <h3 className="text-xs uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-1">Round History</h3>
              <div className="space-y-1">
                {result.turnHistory.map((entry, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className={entry.participant === 'player' ? 'text-[var(--gold)]' : 'text-[var(--gold-dim)]'}>
                      {entry.participant === 'player' ? 'You' : 'Dealer'}
                    </span>
                    <span className="text-[var(--gold-dim)]">
                      {entry.action === 'call' ? `called ${handToString(entry.hand!)}` : 'passed'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <CardRow cards={playerCards} faceUp={true} label="You" revealedCount={5} />

            <button
              onClick={() => { play('uiSoft'); playAgain(); }}
              className="w-full btn-gold py-3 text-base"
            >
              Play Again
            </button>
          </div>
        )}

        {/* Back link */}
        <Link
          to="/"
          className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-sm transition-colors"
        >
          Back to Home
        </Link>
      </div>
    </Layout>
  );
}

export default FiveDrawPage;
