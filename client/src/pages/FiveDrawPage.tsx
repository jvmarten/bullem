/**
 * 5 Draw Minigame — 1v1 Bull 'Em against the Dealer.
 *
 * Both players get dealt 5 cards. One round of standard Bull 'Em is played
 * with the full action set (Call/Raise, Bull/True, Last Chance Raise/Pass).
 * Uses GameEngine directly — same mechanics as local/online games.
 *
 * Card dealing uses the Deck Draw visual style (shuffle → deal → reveal).
 */
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { HandSelector } from '../components/HandSelector.js';
import { ActionButtons } from '../components/ActionButtons.js';
import { CallHistory } from '../components/CallHistory.js';
import { RevealOverlay } from '../components/RevealOverlay.js';
import { useSound } from '../hooks/useSound.js';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';
import {
  RoundPhase, BotDifficulty, GameEngine, BotPlayer, getMinimumRaise, handToString,
  FIVE_DRAW_MIN_WAGER, FIVE_DRAW_MAX_WAGER, FIVE_DRAW_DEFAULT_WAGER, FIVE_DRAW_WIN_MULTIPLIER,
  DECK_DRAW_STARTING_BALANCE,
  type HandCall, type Card, type Suit, type ServerPlayer, type ClientGameState, type RoundResult, type PlayerId,
} from '@bull-em/shared';
import type { TurnResult } from '@bull-em/shared';

const STORAGE_KEY = 'bull-em-five-draw-balance';
const PLAYER_ID = 'player';
const DEALER_ID = 'dealer';

const DEALER_DELAY_MIN = 1200;
const DEALER_DELAY_MAX = 2500;
const DEALER_BULL_DELAY_MIN = 800;
const DEALER_BULL_DELAY_MAX = 1600;

const WAGER_PRESETS = [1, 5, 10, 50, 100];

const SUIT_SYMBOLS: Record<Suit, string> = { spades: '\u2660', hearts: '\u2665', diamonds: '\u2666', clubs: '\u2663' };

function getSuitColor(suit: Suit): string {
  return suit === 'hearts' || suit === 'diamonds' ? '#c0392b' : '#1a1a1a';
}

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

function formatNumber(n: number): string {
  return n.toLocaleString();
}

/** Dealing animation sub-phase. */
type DealAnimPhase = 'idle' | 'shuffling' | 'dealing' | 'revealing';

type GamePhaseLocal = 'wager' | 'dealing' | 'playing' | 'result';

// ── Card Components ─────────────────────────────────────────────────────

/** A single face-up card using the Deck Draw visual style. */
function FaceUpCard({ card, size = 42 }: { card: Card; size?: number }) {
  const h = Math.round(size * 58 / 42);
  const fontSize = size <= 36 ? '9px' : '11px';
  const suitSize = size <= 36 ? '16px' : '20px';
  return (
    <div
      style={{
        width: `${size}px`, height: `${h}px`,
        background: '#f5f0e8',
        border: '1.5px solid #d9d0c0',
        borderRadius: '5px',
        boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
      }}
    >
      <span style={{ fontSize, fontWeight: 700, color: getSuitColor(card.suit), position: 'absolute', top: '3px', left: '4px', lineHeight: 1 }}>
        {card.rank}
      </span>
      <span style={{ fontSize: suitSize, color: getSuitColor(card.suit), lineHeight: 1 }}>
        {SUIT_SYMBOLS[card.suit]}
      </span>
      <span style={{ fontSize, fontWeight: 700, color: getSuitColor(card.suit), position: 'absolute', bottom: '3px', right: '4px', lineHeight: 1, transform: 'rotate(180deg)' }}>
        {card.rank}
      </span>
    </div>
  );
}

/** A row of 5 cards with dealing and flip animations. */
function AnimatedCardRow({
  cards,
  dealtCount,
  revealedCount,
  label,
}: {
  cards: Card[];
  dealtCount: number;
  revealedCount: number;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[10px] text-[var(--gold-dim)] uppercase tracking-wider font-semibold">{label}</span>
      <div className="relative flex justify-center items-center" style={{ height: '62px', width: '240px' }}>
        {Array.from({ length: 5 }, (_, i) => {
          const card = cards[i];
          const centered = i - 2;
          const dealX = centered * 46;
          const cardDealt = i < dealtCount;
          const cardRevealed = i < revealedCount;

          const x = cardDealt ? dealX : i * 0.5;
          const y = cardDealt ? 0 : -i * 1.2;
          const angle = cardDealt ? 0 : (i - 2) * 1.5;

          return (
            <div
              key={i}
              className="absolute"
              style={{
                transform: `translate(${x}px, ${y}px) rotate(${angle}deg)`,
                transition: 'transform 0.45s cubic-bezier(0.34, 1.2, 0.64, 1)',
                zIndex: i,
                perspective: '600px',
                opacity: cardDealt ? 1 : 0,
              }}
            >
              <div
                style={{
                  transformStyle: 'preserve-3d',
                  transform: `rotateY(${cardRevealed ? 180 : 0}deg)`,
                  transition: i === 4 ? 'transform 1.1s ease-out' : i === 3 ? 'transform 0.8s ease-out' : 'transform 0.6s ease-out',
                  width: '42px', height: '58px', position: 'relative',
                }}
              >
                <div className="deck-card-back" style={{ position: 'absolute', top: 0, left: 0, backfaceVisibility: 'hidden' }} />
                <div style={{ position: 'absolute', top: 0, left: 0, backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
                  {card && <FaceUpCard card={card} />}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A static row of 5 face-up cards (used during gameplay after animation completes). */
function StaticCardRow({ cards, label }: { cards: Card[]; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[10px] text-[var(--gold-dim)] uppercase tracking-wider font-semibold">{label}</span>
      <div className="flex gap-1 justify-center">
        {cards.map((card, i) => (
          <FaceUpCard key={i} card={card} />
        ))}
      </div>
    </div>
  );
}

/** A row of 5 face-down cards. */
function FaceDownRow({ label, count = 5 }: { label: string; count?: number }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[10px] text-[var(--gold-dim)] uppercase tracking-wider font-semibold">{label}</span>
      <div className="flex gap-1 justify-center">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="deck-card-back" style={{ width: '42px', height: '58px' }} />
        ))}
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────

export function FiveDrawPage() {
  const { play } = useSound();
  const { user } = useAuth();
  const { addToast } = useToast();

  // === Balance ===
  const [balance, setBalance] = useState(() => loadGuestBalance());
  const [wager, setWager] = useState(FIVE_DRAW_DEFAULT_WAGER);
  const [showCustomWager, setShowCustomWager] = useState(false);
  const [customWagerInput, setCustomWagerInput] = useState('');

  // === Game state ===
  const [phase, setPhase] = useState<GamePhaseLocal>('wager');
  const [gameState, setGameState] = useState<ClientGameState | null>(null);
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
  const [gameWinner, setGameWinner] = useState<'player' | 'dealer' | null>(null);

  // === Deal animation ===
  const [dealAnimPhase, setDealAnimPhase] = useState<DealAnimPhase>('idle');
  const [playerDealtCount, setPlayerDealtCount] = useState(0);
  const [playerRevealCount, setPlayerRevealCount] = useState(0);
  const [dealerDealtCount, setDealerDealtCount] = useState(0);
  const [shuffleOrder, setShuffleOrder] = useState([0, 1, 2, 3, 4]);

  // === Hand selector ===
  const [handSelectorOpen, setHandSelectorOpen] = useState(false);
  const [pendingHand, setPendingHand] = useState<HandCall | null>(null);
  const [pendingValid, setPendingValid] = useState(false);

  // === Refs ===
  const engineRef = useRef<GameEngine | null>(null);
  const playersRef = useRef<ServerPlayer[]>([]);
  const botTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const shuffleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const handleTurnResultRef = useRef<(result: TurnResult) => void>(() => {});
  const wagerRef = useRef(wager);

  useEffect(() => { wagerRef.current = wager; }, [wager]);

  const clearAnimTimers = useCallback(() => {
    for (const t of animTimersRef.current) clearTimeout(t);
    animTimersRef.current = [];
  }, []);

  const scheduleAnim = useCallback((fn: () => void, delay: number) => {
    const t = setTimeout(fn, delay);
    animTimersRef.current.push(t);
    return t;
  }, []);

  // Load balance from server if logged in
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    fetch('/api/deck-draw/stats', { credentials: 'include', signal: controller.signal })
      .then(res => res.ok ? res.json() : null)
      .then((stats: { balance: number } | null) => { if (stats) setBalance(stats.balance); })
      .catch(() => {});
    return () => controller.abort();
  }, [user]);

  // Cleanup on unmount
  useEffect(() => () => {
    if (botTimerRef.current) clearTimeout(botTimerRef.current);
    clearAnimTimers();
    if (shuffleIntervalRef.current) clearInterval(shuffleIntervalRef.current);
  }, [clearAnimTimers]);

  // Shuffle riffle animation
  useEffect(() => {
    if (dealAnimPhase !== 'shuffling') {
      setShuffleOrder([0, 1, 2, 3, 4]);
      if (shuffleIntervalRef.current) { clearInterval(shuffleIntervalRef.current); shuffleIntervalRef.current = null; }
      return;
    }
    const shuffle = (arr: number[]): number[] => {
      const result = [...arr];
      for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = result[i]!; result[i] = result[j]!; result[j] = temp;
      }
      return result;
    };
    setShuffleOrder(prev => shuffle(prev));
    shuffleIntervalRef.current = setInterval(() => setShuffleOrder(prev => shuffle(prev)), 700);
    return () => { if (shuffleIntervalRef.current) clearInterval(shuffleIntervalRef.current); };
  }, [dealAnimPhase]);

  // === Derived state ===
  const isMyTurn = gameState ? gameState.currentPlayerId === PLAYER_ID : false;
  const isDealerTurn = gameState ? gameState.currentPlayerId === DEALER_ID : false;
  const isLastChanceCaller = gameState
    ? gameState.roundPhase === RoundPhase.LAST_CHANCE && gameState.lastCallerId === PLAYER_ID
    : false;
  const canCallHand = isMyTurn && gameState !== null && (
    gameState.roundPhase === RoundPhase.CALLING
    || gameState.roundPhase === RoundPhase.BULL_PHASE
  );
  const canRaise = canCallHand || isLastChanceCaller;
  const canWager = balance >= wager && wager >= FIVE_DRAW_MIN_WAGER;

  const cardCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!gameState) return counts;
    for (const p of gameState.players) counts[p.id] = p.cardCount;
    return counts;
  }, [gameState]);

  // === Broadcast engine state ===
  const broadcastState = useCallback(() => {
    if (!engineRef.current) return;
    setGameState(engineRef.current.getClientState(PLAYER_ID));
  }, []);

  // === Bot turn scheduling ===
  const scheduleBotTurn = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || engine.currentPlayerId !== DEALER_ID) return;

    const rp = engine.currentRoundPhase;
    const inBullPhase = rp === RoundPhase.BULL_PHASE || rp === RoundPhase.LAST_CHANCE;
    const min = inBullPhase ? DEALER_BULL_DELAY_MIN : DEALER_DELAY_MIN;
    const max = inBullPhase ? DEALER_BULL_DELAY_MAX : DEALER_DELAY_MAX;
    const delay = min + Math.floor(Math.random() * (max - min));

    botTimerRef.current = setTimeout(() => executeBotTurn(), delay);
  }, []);

  const executeBotTurn = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || engine.currentPlayerId !== DEALER_ID) return;

    const dealer = playersRef.current.find(p => p.id === DEALER_ID);
    if (!dealer) return;

    const state = engine.getClientState(DEALER_ID);
    const decision = BotPlayer.decideAction(state, DEALER_ID, dealer.cards, BotDifficulty.NORMAL);

    let result: TurnResult;
    switch (decision.action) {
      case 'call': result = engine.handleCall(DEALER_ID, decision.hand); break;
      case 'bull': result = engine.handleBull(DEALER_ID); break;
      case 'true': result = engine.handleTrue(DEALER_ID); break;
      case 'lastChanceRaise': result = engine.handleLastChanceRaise(DEALER_ID, decision.hand); break;
      case 'lastChancePass': result = engine.handleLastChancePass(DEALER_ID); break;
    }

    if (result.type === 'error') {
      result = engine.handleBull(DEALER_ID);
      if (result.type === 'error') result = engine.handleLastChancePass(DEALER_ID);
    }
    if (result.type !== 'error') handleTurnResultRef.current(result);
  }, []);

  // === Finalize game ===
  const finalizeGame = useCallback((winner: 'player' | 'dealer') => {
    const w = wagerRef.current;
    const playerWon = winner === 'player';
    const payout = playerWon ? w * FIVE_DRAW_WIN_MULTIPLIER : 0;
    const netGain = payout - w;

    setBalance(prev => {
      const newBal = prev + netGain;
      if (!user) saveGuestBalance(newBal);
      return newBal;
    });
    setPhase('result');
  }, [user]);

  // === Handle turn results ===
  const handleTurnResult = useCallback((result: TurnResult) => {
    const engine = engineRef.current;
    if (!engine) return;

    switch (result.type) {
      case 'error':
        addToast(result.message);
        break;
      case 'continue':
      case 'last_chance':
        engine.setTurnDeadline(null);
        broadcastState();
        scheduleBotTurn();
        break;
      case 'resolve':
        engine.setTurnDeadline(null);
        setGameState(engine.getClientState(PLAYER_ID));
        setRoundResult(result.result);
        break;
      case 'game_over': {
        engine.setTurnDeadline(null);
        const winner = result.winnerId === PLAYER_ID ? 'player' as const : 'dealer' as const;
        setGameWinner(winner);
        if (result.finalRoundResult) {
          setGameState(engine.getClientState(PLAYER_ID));
          setRoundResult(result.finalRoundResult);
        } else {
          finalizeGame(winner);
        }
        break;
      }
    }
  }, [broadcastState, scheduleBotTurn, addToast, finalizeGame]);

  handleTurnResultRef.current = handleTurnResult;

  // === Start a new game ===
  const startGame = useCallback(() => {
    if (!canWager) { addToast('Insufficient balance'); return; }

    // Deduct wager
    setBalance(prev => { const n = prev - wager; if (!user) saveGuestBalance(n); return n; });

    // Create players
    const humanPlayer: ServerPlayer = {
      id: PLAYER_ID, name: 'You', cardCount: 5,
      isConnected: true, isEliminated: false, isHost: true, isBot: false, cards: [],
    };
    const dealerPlayer: ServerPlayer = {
      id: DEALER_ID, name: 'Dealer', cardCount: 5,
      isConnected: true, isEliminated: false, isHost: false, isBot: true, cards: [],
    };
    const players = Math.random() < 0.5 ? [humanPlayer, dealerPlayer] : [dealerPlayer, humanPlayer];
    playersRef.current = players;

    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0 });
    engineRef.current = engine;
    engine.startRound();

    // Reset state
    setRoundResult(null);
    setGameWinner(null);
    setHandSelectorOpen(false);
    setPendingHand(null);
    setPendingValid(false);
    setPlayerDealtCount(0);
    setPlayerRevealCount(0);
    setDealerDealtCount(0);

    // Start dealing animation
    setPhase('dealing');
    setDealAnimPhase('shuffling');
    play('deckShuffle');

    clearAnimTimers();

    // Phase 1: Shuffle (800ms)
    // Phase 2: Deal dealer cards face-down
    const dealStart = 800;
    for (let i = 0; i < 5; i++) {
      scheduleAnim(() => setDealerDealtCount(i + 1), dealStart + i * 120);
    }

    // Phase 3: Deal player cards face-down
    const playerDealStart = dealStart + 5 * 120 + 200;
    scheduleAnim(() => setDealAnimPhase('dealing'), playerDealStart);
    for (let i = 0; i < 5; i++) {
      scheduleAnim(() => setPlayerDealtCount(i + 1), playerDealStart + i * 120);
    }

    // Phase 4: Reveal player cards
    const revealStart = playerDealStart + 5 * 120 + 300;
    scheduleAnim(() => setDealAnimPhase('revealing'), revealStart);
    const revealDelays = [0, 400, 800, 1400, 2400];
    for (let i = 0; i < 5; i++) {
      scheduleAnim(() => {
        play('cardReveal');
        setPlayerRevealCount(i + 1);
      }, revealStart + revealDelays[i]!);
    }

    // Phase 5: Transition to playing
    const playStart = revealStart + revealDelays[4]! + 1200;
    scheduleAnim(() => {
      setDealAnimPhase('idle');
      setPhase('playing');
      broadcastState();
      scheduleBotTurn();
    }, playStart);
  }, [canWager, wager, user, addToast, broadcastState, scheduleBotTurn, play, clearAnimTimers, scheduleAnim]);

  // === Player actions ===
  const callHand = useCallback((hand: HandCall) => {
    if (!engineRef.current) return;
    handleTurnResult(engineRef.current.handleCall(PLAYER_ID, hand));
  }, [handleTurnResult]);

  const callBull = useCallback(() => {
    if (!engineRef.current) return;
    handleTurnResult(engineRef.current.handleBull(PLAYER_ID));
  }, [handleTurnResult]);

  const callTrue = useCallback(() => {
    if (!engineRef.current) return;
    play('uiClick');
    handleTurnResult(engineRef.current.handleTrue(PLAYER_ID));
  }, [handleTurnResult, play]);

  const lastChanceRaise = useCallback((hand: HandCall) => {
    if (!engineRef.current) return;
    handleTurnResult(engineRef.current.handleLastChanceRaise(PLAYER_ID, hand));
  }, [handleTurnResult]);

  const lastChancePass = useCallback(() => {
    if (!engineRef.current) return;
    play('uiClick');
    handleTurnResult(engineRef.current.handleLastChancePass(PLAYER_ID));
  }, [handleTurnResult, play]);

  // === Hand selector callbacks ===
  const handleHandChange = useCallback((hand: HandCall | null, valid: boolean) => {
    setPendingHand(hand);
    setPendingValid(valid);
  }, []);

  const handleHandSubmit = useCallback(() => {
    if (!pendingHand || !pendingValid) return;
    if (isLastChanceCaller) lastChanceRaise(pendingHand);
    else callHand(pendingHand);
    setHandSelectorOpen(false);
  }, [pendingHand, pendingValid, isLastChanceCaller, lastChanceRaise, callHand]);

  const handleQuickRaise = useCallback(() => {
    const current = gameState?.currentHand;
    if (!current) return;
    const minRaise = getMinimumRaise(current);
    if (!minRaise) return;
    if (isLastChanceCaller) lastChanceRaise(minRaise);
    else callHand(minRaise);
    setHandSelectorOpen(false);
  }, [gameState?.currentHand, isLastChanceCaller, lastChanceRaise, callHand]);

  const handleActionExpand = useCallback(() => setHandSelectorOpen(false), []);

  // Close hand selector on tap outside
  useEffect(() => {
    if (!handSelectorOpen) return;
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-tooltip="hand-selector"]') || target.closest('[data-tooltip="action-area"]') || target.closest('[data-tooltip="my-cards"]') || target.closest('[data-tooltip="call-history"]')) return;
      setHandSelectorOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => { document.removeEventListener('mousedown', handleOutside); document.removeEventListener('touchstart', handleOutside); };
  }, [handSelectorOpen]);

  // Close hand selector when turn changes
  useEffect(() => { setHandSelectorOpen(false); }, [isMyTurn, gameState?.roundPhase]);

  // Dismiss round result
  const handleDismissResult = useCallback(() => {
    setRoundResult(null);
    if (gameWinner) finalizeGame(gameWinner);
  }, [gameWinner, finalizeGame]);

  // Play again
  const playAgain = useCallback(() => {
    setPhase('wager');
    setGameState(null);
    setRoundResult(null);
    setGameWinner(null);
    setDealAnimPhase('idle');
    engineRef.current = null;
    if (botTimerRef.current) clearTimeout(botTimerRef.current);
    clearAnimTimers();
  }, [clearAnimTimers]);

  // === RENDER ===

  // --- Wager Phase ---
  if (phase === 'wager') {
    return (
      <Layout>
        <div className="flex flex-col items-center gap-6 pt-4 max-w-md mx-auto">
          <h1 className="text-2xl font-bold text-[var(--gold)]">5 Draw</h1>
          <p className="text-sm text-[var(--gold-dim)] text-center -mt-4">
            1v1 Bull &rsquo;Em against the Dealer. 5 cards each, winner takes all.
          </p>

          {/* Balance */}
          <div className="glass rounded-xl px-6 py-3 text-center w-full">
            <p className="text-xs uppercase tracking-widest text-[var(--gold-dim)]">Balance</p>
            <p className="text-3xl font-bold text-[var(--gold)]">{formatNumber(balance)}</p>
            {!user && (
              <p className="text-[10px] text-[var(--gold-dim)] mt-1">
                <Link to="/login" className="underline hover:text-[var(--gold)]">Sign in</Link> to save progress
              </p>
            )}
          </div>

          {/* Wager controls */}
          <div className="w-full space-y-3">
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
                      if (!isNaN(val) && val >= FIVE_DRAW_MIN_WAGER && val <= FIVE_DRAW_MAX_WAGER) { setWager(val); play('uiSoft'); }
                    }
                  }}
                  placeholder={`${FIVE_DRAW_MIN_WAGER}–${formatNumber(FIVE_DRAW_MAX_WAGER)}`}
                  className="flex-1 bg-[var(--surface)] text-[var(--gold)] text-xs rounded px-3 py-2 border border-[var(--gold-dim)]/30 focus:border-[var(--gold)] focus:outline-none min-h-[36px]"
                  autoComplete="off"
                />
                <button
                  onClick={() => { const val = parseInt(customWagerInput, 10); if (!isNaN(val) && val >= FIVE_DRAW_MIN_WAGER && val <= FIVE_DRAW_MAX_WAGER) { setWager(val); play('uiSoft'); } }}
                  className="btn-ghost text-xs px-3 py-2 min-h-[36px]"
                >Set</button>
              </div>
            )}
            <button
              onClick={() => { play('uiClick'); startGame(); }}
              disabled={!canWager}
              className="btn-gold w-full py-3 text-base font-bold disabled:opacity-50"
            >Deal ({formatNumber(wager)})</button>
            <p className="text-xs text-center text-[var(--gold-dim)]">Win: {FIVE_DRAW_WIN_MULTIPLIER}x wager</p>
          </div>

          {/* Rules */}
          <div className="glass rounded-xl px-4 py-3 w-full">
            <h2 className="text-xs uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">How It Works</h2>
            <ul className="text-xs text-[var(--gold-light)] space-y-1 list-disc list-inside">
              <li>You and the Dealer each get 5 cards</li>
              <li>Take turns calling poker hands — same rules as Bull &rsquo;Em</li>
              <li>Call Bull if you think the hand doesn&rsquo;t exist in the combined 10 cards</li>
              <li>Loser gets eliminated, winner takes {FIVE_DRAW_WIN_MULTIPLIER}x the wager</li>
            </ul>
          </div>

          <Link to="/" className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-sm transition-colors mb-8">
            Back to Home
          </Link>
        </div>
      </Layout>
    );
  }

  // --- Dealing Phase (card animations) ---
  if (phase === 'dealing') {
    const playerCards = engineRef.current?.getClientState(PLAYER_ID).myCards ?? [];

    return (
      <Layout>
        <div className="flex flex-col items-center gap-4 pt-4 max-w-md mx-auto">
          {/* Balance bar */}
          <div className="glass rounded-xl px-6 py-2 text-center w-full">
            <div className="flex justify-between items-center">
              <span className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)]">5 Draw</span>
              <span className="text-sm font-bold text-[var(--gold)]">Wager: {formatNumber(wager)}</span>
              <span className="text-xs text-[var(--gold-dim)]">Bal: {formatNumber(balance)}</span>
            </div>
          </div>

          {/* Shuffle animation */}
          {dealAnimPhase === 'shuffling' && (
            <div className="relative flex justify-center items-center" style={{ height: '80px', width: '240px' }}>
              {Array.from({ length: 5 }, (_, i) => {
                const pos = shuffleOrder[i]!;
                const riffleDir = i % 2 === 0 ? -1 : 1;
                return (
                  <div
                    key={`shuffle-${i}`}
                    className="absolute"
                    style={{
                      transform: `translate(${pos * 0.5}px, ${-pos * 1.2}px) rotate(${(pos - 2) * 1.5}deg)`,
                      transition: 'transform 0.45s cubic-bezier(0.34, 1.2, 0.64, 1)',
                      zIndex: pos,
                    }}
                  >
                    <div className="deck-shuffle-anim" style={{ '--shuffle-dir': riffleDir, animationDelay: `${i * 0.08}s` } as React.CSSProperties}>
                      <div className="deck-card-back" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Dealing cards */}
          {dealAnimPhase !== 'shuffling' && (
            <>
              {/* Dealer's cards - dealt face down */}
              <AnimatedCardRow cards={[]} dealtCount={dealerDealtCount} revealedCount={0} label="Dealer" />

              <div className="text-center" style={{ minHeight: '24px' }}>
                {dealAnimPhase === 'dealing' && (
                  <span className="text-xs text-[var(--gold-dim)] animate-pulse">Dealing...</span>
                )}
                {dealAnimPhase === 'revealing' && (
                  <span className="text-xs text-[var(--gold-dim)]">Your cards</span>
                )}
              </div>

              {/* Player's cards - dealt then revealed */}
              <AnimatedCardRow cards={playerCards} dealtCount={playerDealtCount} revealedCount={playerRevealCount} label="You" />
            </>
          )}

          {dealAnimPhase === 'shuffling' && (
            <span className="text-xs text-[var(--gold-dim)] animate-pulse">Shuffling...</span>
          )}
        </div>
      </Layout>
    );
  }

  // --- Playing Phase ---
  if (phase === 'playing' && gameState) {
    return (
      <Layout>
        <div className="flex flex-col items-center gap-3 pt-2 max-w-md mx-auto pb-4">
          {/* Balance bar */}
          <div className="glass rounded-xl px-4 py-1.5 w-full">
            <div className="flex justify-between items-center">
              <span className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)]">5 Draw</span>
              <span className="text-xs font-bold text-[var(--gold)]">Wager: {formatNumber(wager)}</span>
              <span className="text-xs text-[var(--gold-dim)]">Bal: {formatNumber(balance)}</span>
            </div>
          </div>

          {/* Dealer's cards (face down) */}
          <FaceDownRow label="Dealer" />

          {/* Current call display */}
          {gameState.currentHand && (
            <div className="glass-raised py-1.5 animate-slide-up flex items-baseline w-full" style={{ padding: '0.375rem clamp(0.5rem, 2.9vw, 0.75rem)' }}>
              <div className="w-1/4 min-w-0 shrink-0">
                <span className="text-[9px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold">Current Call</span>
              </div>
              <div className="flex-1 min-w-0 text-center">
                <span className="font-display font-bold text-[var(--gold)] current-call-hand">
                  {handToString(gameState.currentHand)}
                </span>
              </div>
              <div className="w-1/4 min-w-0 shrink-0 text-right">
                {gameState.lastCallerId && (
                  <span className="text-[9px] text-[var(--gold-dim)] opacity-70 truncate block">
                    {gameState.players.find(p => p.id === gameState.lastCallerId)?.name ?? '?'}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Dealer thinking indicator (no tile, just text) */}
          {isDealerTurn && (
            <div className="text-center py-1">
              <span className="text-xs text-[var(--gold-dim)] animate-pulse">Dealer is thinking...</span>
            </div>
          )}

          {/* Player's cards */}
          <div data-tooltip="my-cards">
            <StaticCardRow cards={gameState.myCards} label="You" />
          </div>

          {/* Call history */}
          <div data-tooltip="call-history" className="w-full">
            <CallHistory history={gameState.turnHistory} cardCounts={cardCounts} />
          </div>

          {/* Action buttons — below cards */}
          <div className="flex justify-between items-start relative w-full" data-tooltip="action-area">
            <ActionButtons
              roundPhase={gameState.roundPhase}
              isMyTurn={isMyTurn}
              hasCurrentHand={gameState.currentHand !== null}
              isLastChanceCaller={isLastChanceCaller}
              onBull={callBull}
              onTrue={callTrue}
              onLastChancePass={lastChancePass}
              onExpand={handleActionExpand}
            />
            {canRaise && !handSelectorOpen && (
              <div className="flex justify-end animate-slide-up ml-auto action-btn-gap">
                <button
                  onClick={() => { play('uiClick'); setHandSelectorOpen(true); }}
                  className="btn-ghost border-[var(--gold-dim)] action-btn-base font-bold animate-pulse-glow action-btn-primary"
                >
                  {gameState.currentHand ? 'Raise' : 'Call'}
                </button>
              </div>
            )}
            {canRaise && handSelectorOpen && gameState.currentHand && getMinimumRaise(gameState.currentHand) && (
              <button
                onClick={handleQuickRaise}
                className="btn-amber action-btn-base font-bold action-btn-minraise absolute left-1/2 -translate-x-1/2 top-0 z-10"
                title="Auto-raise to the minimum valid hand"
              >min<br />raise</button>
            )}
            {canRaise && handSelectorOpen && (
              <div className="flex flex-col items-center ml-auto">
                <button
                  onClick={handleHandSubmit}
                  disabled={!pendingValid}
                  className={`btn-gold action-btn-base font-bold action-btn-primary ${pendingValid ? 'hs-call-pulse' : ''}`}
                >{gameState.currentHand ? 'Raise' : 'Call'}</button>
                <p className={`text-[var(--danger)] mt-1 h-4 transition-opacity action-btn-hint ${pendingHand && !pendingValid ? 'opacity-100' : 'opacity-0'}`}>Must be higher</p>
              </div>
            )}
          </div>

          {/* Hand selector — below action buttons */}
          {canRaise && handSelectorOpen && (
            <div className="-mt-2 w-full" data-tooltip="hand-selector">
              <HandSelector
                currentHand={gameState.currentHand}
                onSubmit={handleHandSubmit}
                onHandChange={handleHandChange}
                showSubmit={false}
              />
            </div>
          )}
        </div>

        {/* Round result overlay */}
        {roundResult && (
          <RevealOverlay
            result={roundResult}
            players={gameState.players}
            myPlayerId={PLAYER_ID}
            onDismiss={handleDismissResult}
            autoCountdown={false}
          />
        )}
      </Layout>
    );
  }

  // --- Result Phase ---
  if (phase === 'result') {
    const playerWon = gameWinner === 'player';
    return (
      <Layout>
        <div className="flex flex-col items-center gap-6 pt-8 max-w-md mx-auto">
          <h1 className={`text-3xl font-bold ${playerWon ? 'text-green-400' : 'text-red-400'}`}>
            {playerWon ? 'You Win!' : 'Dealer Wins'}
          </h1>
          <div className="glass rounded-xl px-6 py-4 text-center w-full">
            {playerWon ? (
              <p className="text-2xl font-bold text-green-400">+{formatNumber(wager)}</p>
            ) : (
              <p className="text-2xl font-bold text-red-400">-{formatNumber(wager)}</p>
            )}
            <p className="text-xs text-[var(--gold-dim)] mt-1">Balance: {formatNumber(balance)}</p>
          </div>
          <div className="flex gap-3 w-full">
            <button onClick={() => { play('uiClick'); playAgain(); }} className="btn-gold flex-1 py-3 text-base font-bold">
              Play Again
            </button>
            <Link to="/" className="btn-ghost flex-1 py-3 text-base font-bold text-center">Home</Link>
          </div>
        </div>
      </Layout>
    );
  }

  return null;
}

export default FiveDrawPage;
