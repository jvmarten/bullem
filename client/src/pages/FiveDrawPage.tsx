/**
 * 5 Draw Minigame — 1v1 Bull 'Em against the Dealer.
 *
 * Both players get dealt 5 cards. One round of standard Bull 'Em is played
 * with the full action set (Call/Raise, Bull/True, Last Chance Raise/Pass).
 * Uses GameEngine directly — same mechanics as local/online games.
 *
 * Single-page layout: wager controls, deck, dealing animation, and gameplay
 * all happen on one screen. Cards deal from a center deck, alternating
 * one for player, one for dealer.
 */
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { HandSelector } from '../components/HandSelector.js';
import { ActionButtons } from '../components/ActionButtons.js';
import { CallHistory } from '../components/CallHistory.js';
import { useSound } from '../hooks/useSound.js';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';
import {
  RoundPhase, BotDifficulty, GameEngine, BotPlayer, handToString,
  FIVE_DRAW_MIN_WAGER, FIVE_DRAW_MAX_WAGER, FIVE_DRAW_DEFAULT_WAGER, FIVE_DRAW_WIN_MULTIPLIER,
  DECK_DRAW_STARTING_BALANCE,
  type HandCall, type Card, type Suit, type ServerPlayer, type ClientGameState, type RoundResult,
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

/** Delay between each card dealt from the deck (ms). */
const DEAL_CARD_INTERVAL = 200;
/** Pause after all cards dealt before revealing player cards (ms). */
const DEAL_REVEAL_PAUSE = 400;
/** Delay between each player card flip (ms). */
const REVEAL_CARD_INTERVAL = 400;
/** Pause after all cards revealed before gameplay starts (ms). */
const POST_REVEAL_PAUSE = 600;

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

type GamePhaseLocal = 'idle' | 'dealing' | 'playing' | 'resolving' | 'result';

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

/** A stacked deck of face-down cards. Count determines visual thickness. */
function DeckStack({ count }: { count: number }) {
  if (count <= 0) return null;
  // Show up to 6 stacked cards for visual depth
  const visible = Math.min(count, 6);
  return (
    <div style={{ position: 'relative', width: '42px', height: '58px' }}>
      {Array.from({ length: visible }, (_, i) => (
        <div
          key={i}
          className="deck-card-back"
          style={{
            position: 'absolute',
            width: '42px',
            height: '58px',
            top: `${-i * 2}px`,
            left: `${i * 1}px`,
            zIndex: visible - i,
          }}
        />
      ))}
    </div>
  );
}

/** A static row of 5 face-up cards. */
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

/** A row of 5 face-down card slots, with cards appearing as dealtCount increases. */
function FaceDownRow({ label, count = 5, dealtCount }: { label: string; count?: number; dealtCount?: number }) {
  const showAll = dealtCount === undefined;
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[10px] text-[var(--gold-dim)] uppercase tracking-wider font-semibold">{label}</span>
      <div className="flex gap-1 justify-center">
        {Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            className="deck-card-back"
            style={{
              width: '42px', height: '58px',
              opacity: showAll || i < (dealtCount ?? 0) ? 1 : 0,
              transform: showAll || i < (dealtCount ?? 0) ? 'scale(1)' : 'scale(0.8) translateY(-10px)',
              transition: 'opacity 0.25s ease-out, transform 0.25s ease-out',
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** Player cards that deal face-down then flip face-up with uniform timing. */
function PlayerDealRevealRow({ cards, dealtCount, revealedCount, label }: { cards: Card[]; dealtCount: number; revealedCount: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[10px] text-[var(--gold-dim)] uppercase tracking-wider font-semibold">{label}</span>
      <div className="flex gap-1 justify-center">
        {cards.map((card, i) => {
          const isDealt = i < dealtCount;
          const isRevealed = i < revealedCount;
          return (
            <div
              key={i}
              style={{
                perspective: '600px', width: '42px', height: '58px',
                opacity: isDealt ? 1 : 0,
                transform: isDealt ? 'scale(1)' : 'scale(0.8) translateY(-10px)',
                transition: 'opacity 0.25s ease-out, transform 0.25s ease-out',
              }}
            >
              <div
                style={{
                  transformStyle: 'preserve-3d',
                  transform: `rotateY(${isRevealed ? 180 : 0}deg)`,
                  transition: 'transform 0.6s ease-out',
                  width: '42px', height: '58px', position: 'relative',
                }}
              >
                {/* Back face */}
                <div className="deck-card-back" style={{ position: 'absolute', top: 0, left: 0, width: '42px', height: '58px', backfaceVisibility: 'hidden' }} />
                {/* Front face */}
                <div style={{ position: 'absolute', top: 0, left: 0, backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
                  <FaceUpCard card={card} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A row of dealer cards that flip from face-down to face-up one at a time. */
function DealerRevealRow({ cards, revealedCount, label }: { cards: Card[]; revealedCount: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[10px] text-[var(--gold-dim)] uppercase tracking-wider font-semibold">{label}</span>
      <div className="flex gap-1 justify-center">
        {cards.map((card, i) => {
          const isRevealed = i < revealedCount;
          return (
            <div
              key={i}
              style={{ perspective: '600px', width: '42px', height: '58px' }}
            >
              <div
                style={{
                  transformStyle: 'preserve-3d',
                  transform: `rotateY(${isRevealed ? 180 : 0}deg)`,
                  transition: i === 4
                    ? 'transform 1.1s ease-out'
                    : i === 3
                      ? 'transform 0.9s ease-out'
                      : 'transform 0.6s ease-out',
                  width: '42px', height: '58px', position: 'relative',
                }}
              >
                {/* Back face */}
                <div className="deck-card-back" style={{ position: 'absolute', top: 0, left: 0, width: '42px', height: '58px', backfaceVisibility: 'hidden' }} />
                {/* Front face */}
                <div style={{ position: 'absolute', top: 0, left: 0, backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
                  <FaceUpCard card={card} />
                </div>
              </div>
            </div>
          );
        })}
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
  const [phase, setPhase] = useState<GamePhaseLocal>('idle');
  const [gameState, setGameState] = useState<ClientGameState | null>(null);
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
  const [gameWinner, setGameWinner] = useState<'player' | 'dealer' | null>(null);

  // === Deal-in animation: alternating player/dealer from deck ===
  const [playerDealtCount, setPlayerDealtCount] = useState(0);
  const [dealerDealtCount, setDealerDealtCount] = useState(0);
  const [playerRevealedCount, setPlayerRevealedCount] = useState(0);

  // === Dealer reveal animation (resolution phase) ===
  const [dealerCards, setDealerCards] = useState<Card[]>([]);
  const [dealerRevealCount, setDealerRevealCount] = useState(0);

  // === Hand selector ===
  const [handSelectorOpen, setHandSelectorOpen] = useState(false);
  const [pendingHand, setPendingHand] = useState<HandCall | null>(null);
  const [pendingValid, setPendingValid] = useState(false);

  // === Refs ===
  const engineRef = useRef<GameEngine | null>(null);
  const playersRef = useRef<ServerPlayer[]>([]);
  const botTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
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
  }, [clearAnimTimers]);

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

  // Deck cards remaining during deal animation
  const deckRemaining = 10 - playerDealtCount - dealerDealtCount;

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
    const decision = BotPlayer.decideAction(state, DEALER_ID, dealer.cards, BotDifficulty.HARD, undefined, undefined, undefined, true);

    // Play appropriate sound for dealer action
    switch (decision.action) {
      case 'call': case 'lastChanceRaise': play('callMade'); break;
      case 'bull': play('bullCalled'); break;
      case 'true': play('trueCalled'); break;
    }

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
  }, [play]);

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

  // === Start dealer card reveal sequence ===
  const startDealerReveal = useCallback((result: RoundResult, winner: 'player' | 'dealer' | null) => {
    const dealer = playersRef.current.find(p => p.id === DEALER_ID);
    if (dealer) setDealerCards(dealer.cards);
    setDealerRevealCount(0);
    setPhase('resolving');

    clearAnimTimers();

    // Reveal dealer cards one by one with escalating delays (like deck draw)
    const revealDelays = [0, 500, 1000, 1700, 2800];
    for (let i = 0; i < 5; i++) {
      scheduleAnim(() => {
        play('cardReveal');
        setDealerRevealCount(i + 1);
      }, revealDelays[i]!);
    }

    // After all cards revealed, show result
    const totalRevealTime = revealDelays[4]! + 1500;
    scheduleAnim(() => {
      if (winner) {
        setRoundResult(null);
        finalizeGame(winner);
      } else {
        setPhase('playing');
      }
    }, totalRevealTime);
  }, [clearAnimTimers, scheduleAnim, play, finalizeGame]);

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
        startDealerReveal(result.result, null);
        break;
      case 'game_over': {
        engine.setTurnDeadline(null);
        const winner = result.winnerId === PLAYER_ID ? 'player' as const : 'dealer' as const;
        setGameWinner(winner);
        if (result.finalRoundResult) {
          setGameState(engine.getClientState(PLAYER_ID));
          setRoundResult(result.finalRoundResult);
          startDealerReveal(result.finalRoundResult, winner);
        } else {
          finalizeGame(winner);
        }
        break;
      }
    }
  }, [broadcastState, scheduleBotTurn, addToast, finalizeGame, startDealerReveal]);

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
    const players = [dealerPlayer, humanPlayer];
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
    setDealerCards([]);
    setDealerRevealCount(0);
    setPlayerDealtCount(0);
    setDealerDealtCount(0);
    setPlayerRevealedCount(0);

    // Deal-in animation: alternate player/dealer from deck
    setPhase('dealing');
    broadcastState();
    clearAnimTimers();

    // Deal 10 cards alternating: player1, dealer1, player2, dealer2, ..., player5, dealer5
    // No card dealing sound effect
    for (let i = 0; i < 10; i++) {
      const isPlayerCard = i % 2 === 0;
      const cardIndex = Math.floor(i / 2) + 1; // 1-based count
      scheduleAnim(() => {
        if (isPlayerCard) {
          setPlayerDealtCount(cardIndex);
        } else {
          setDealerDealtCount(cardIndex);
        }
      }, i * DEAL_CARD_INTERVAL);
    }

    // After all 10 dealt, pause then reveal player cards one by one
    const dealDone = 10 * DEAL_CARD_INTERVAL + DEAL_REVEAL_PAUSE;
    for (let i = 0; i < 5; i++) {
      scheduleAnim(() => {
        play('cardReveal');
        setPlayerRevealedCount(i + 1);
      }, dealDone + i * REVEAL_CARD_INTERVAL);
    }

    // Transition to playing after all cards revealed
    const totalDealTime = dealDone + 5 * REVEAL_CARD_INTERVAL + POST_REVEAL_PAUSE;
    scheduleAnim(() => {
      setPhase('playing');
      scheduleBotTurn();
    }, totalDealTime);
  }, [canWager, wager, user, addToast, broadcastState, scheduleBotTurn, play, clearAnimTimers, scheduleAnim]);

  // === Player actions ===
  const callHand = useCallback((hand: HandCall) => {
    if (!engineRef.current) return;
    play('callMade');
    handleTurnResult(engineRef.current.handleCall(PLAYER_ID, hand));
  }, [handleTurnResult, play]);

  const callBull = useCallback(() => {
    if (!engineRef.current) return;
    play('bullCalled');
    handleTurnResult(engineRef.current.handleBull(PLAYER_ID));
  }, [handleTurnResult, play]);

  const callTrue = useCallback(() => {
    if (!engineRef.current) return;
    play('trueCalled');
    handleTurnResult(engineRef.current.handleTrue(PLAYER_ID));
  }, [handleTurnResult, play]);

  const lastChanceRaise = useCallback((hand: HandCall) => {
    if (!engineRef.current) return;
    play('callMade');
    handleTurnResult(engineRef.current.handleLastChanceRaise(PLAYER_ID, hand));
  }, [handleTurnResult, play]);

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

  // Play again — reset to idle (same page, shows wager controls)
  const playAgain = useCallback(() => {
    setPhase('idle');
    setGameState(null);
    setRoundResult(null);
    setGameWinner(null);
    setDealerCards([]);
    setDealerRevealCount(0);
    setPlayerDealtCount(0);
    setDealerDealtCount(0);
    setPlayerRevealedCount(0);
    engineRef.current = null;
    if (botTimerRef.current) clearTimeout(botTimerRef.current);
    clearAnimTimers();
  }, [clearAnimTimers]);

  // === RENDER — single unified layout ===

  const isActive = phase !== 'idle';
  const isPlaying = phase === 'playing';
  const isDealing = phase === 'dealing';
  const isResolving = phase === 'resolving';
  const isResult = phase === 'result';

  // Resolving phase data
  const lastCall = roundResult ? handToString(roundResult.calledHand) : '';
  const callerName = roundResult && gameState
    ? gameState.players.find(p => p.id === roundResult.callerId)?.name ?? '?'
    : '';
  const allDealerRevealed = dealerRevealCount >= 5;

  return (
    <Layout>
      <div className="flex flex-col items-center gap-3 pt-2 max-w-md mx-auto pb-4">
        {/* ── Header / Balance bar ── */}
        <div className="glass rounded-xl px-4 py-1.5 w-full">
          <div className="flex justify-between items-center">
            <span className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)]">5 Draw</span>
            {isActive && (
              <span className="text-xs font-bold text-[var(--gold)]">Wager: {formatNumber(wager)}</span>
            )}
            <span className="text-xs text-[var(--gold-dim)]">
              {isActive ? `Bal: ${formatNumber(balance)}` : ''}
            </span>
          </div>
          {!isActive && (
            <div className="text-center mt-1">
              <p className="text-2xl font-bold text-[var(--gold)]">{formatNumber(balance)}</p>
              {!user && (
                <p className="text-[10px] text-[var(--gold-dim)] mt-0.5">
                  <Link to="/login" className="underline hover:text-[var(--gold)]">Sign in</Link> to save progress
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Dealer cards area ── */}
        {isDealing && (
          <FaceDownRow label="Dealer" dealtCount={dealerDealtCount} />
        )}
        {isPlaying && (
          <FaceDownRow label="Dealer" />
        )}
        {isResolving && dealerCards.length > 0 && (
          <DealerRevealRow cards={dealerCards} revealedCount={dealerRevealCount} label="Dealer" />
        )}
        {isResult && dealerCards.length > 0 && (
          <StaticCardRow cards={dealerCards} label="Dealer" />
        )}

        {/* ── Center deck (visible before/during dealing) ── */}
        {!isActive && (
          <div className="flex flex-col items-center gap-1 py-4">
            <DeckStack count={10} />
            <span className="text-[10px] text-[var(--gold-dim)] uppercase tracking-wider mt-1">Deck</span>
          </div>
        )}
        {isDealing && deckRemaining > 0 && (
          <div className="flex flex-col items-center gap-1">
            <DeckStack count={deckRemaining} />
          </div>
        )}

        {/* ── Current call display (playing phase) ── */}
        {isPlaying && gameState?.currentHand && (
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

        {/* ── Resolving: last call + verdict ── */}
        {isResolving && roundResult && (
          <div className="glass-raised py-2 px-4 w-full text-center animate-fade-in">
            <span className="text-[9px] uppercase tracking-widest text-[var(--gold-dim)]">
              {callerName} called
            </span>
            <p className="font-display font-bold text-[var(--gold)] text-lg">{lastCall}</p>
          </div>
        )}
        {isResolving && allDealerRevealed && roundResult && (
          <div className={`py-3 px-4 rounded-xl border-2 w-full text-center animate-scale-in ${
            roundResult.handExists
              ? 'border-[var(--info)] bg-[var(--info-bg)]'
              : 'border-[var(--danger)] bg-[var(--danger-bg)]'
          }`}>
            <p className={`font-display text-2xl font-bold ${
              roundResult.handExists ? 'text-[var(--info)]' : 'text-[var(--danger)]'
            }`}>
              {roundResult.handExists ? 'The hand EXISTS!' : 'BULL! Hand is fake!'}
            </p>
          </div>
        )}

        {/* ── Dealer thinking indicator ── */}
        {isPlaying && isDealerTurn && (
          <div className="text-center py-1">
            <span className="text-xs text-[var(--gold-dim)] animate-pulse">Dealer is thinking...</span>
          </div>
        )}

        {/* ── Player cards area ── */}
        {isDealing && gameState && (
          <PlayerDealRevealRow cards={gameState.myCards} dealtCount={playerDealtCount} revealedCount={playerRevealedCount} label="You" />
        )}
        {(isPlaying || isResolving) && gameState && (
          <div data-tooltip="my-cards">
            <StaticCardRow cards={gameState.myCards} label="You" />
          </div>
        )}
        {isResult && gameState && (
          <StaticCardRow cards={gameState.myCards} label="You" />
        )}

        {/* ── Result overlay ── */}
        {isResult && (
          <div className="w-full animate-fade-in">
            <div className="text-center mb-3">
              <h2 className={`text-3xl font-bold ${gameWinner === 'player' ? 'text-green-400' : 'text-red-400'}`}>
                {gameWinner === 'player' ? 'You Win!' : 'Dealer Wins'}
              </h2>
              <div className="glass rounded-xl px-6 py-3 mt-2">
                {gameWinner === 'player' ? (
                  <p className="text-2xl font-bold text-green-400">+{formatNumber(wager)}</p>
                ) : (
                  <p className="text-2xl font-bold text-red-400">-{formatNumber(wager)}</p>
                )}
                <p className="text-xs text-[var(--gold-dim)] mt-1">Balance: {formatNumber(balance)}</p>
              </div>
            </div>
            <div className="flex gap-3 w-full">
              <button onClick={() => { play('uiClick'); playAgain(); }} className="btn-gold flex-1 py-3 text-base font-bold">
                Play Again
              </button>
              <Link to="/" className="btn-ghost flex-1 py-3 text-base font-bold text-center">Home</Link>
            </div>
          </div>
        )}

        {/* ── Call history (playing phase) ── */}
        {isPlaying && gameState && (
          <div data-tooltip="call-history" className="w-full">
            <CallHistory history={gameState.turnHistory} cardCounts={cardCounts} />
          </div>
        )}

        {/* ── Action buttons (playing phase) ── */}
        {isPlaying && gameState && (
          <div className="flex justify-between items-start relative w-full" data-tooltip="action-area">
            <ActionButtons
              roundPhase={gameState.roundPhase}
              isMyTurn={isMyTurn}
              hasCurrentHand={gameState.currentHand !== null}
              isLastChanceCaller={isLastChanceCaller}
              onBull={callBull}
              onTrue={callTrue}
              onLastChancePass={lastChancePass}
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
        )}

        {/* ── Hand selector (playing phase) ── */}
        {isPlaying && canRaise && handSelectorOpen && (
          <div className="-mt-2 w-full" data-tooltip="hand-selector">
            <HandSelector
              currentHand={gameState?.currentHand ?? null}
              onSubmit={handleHandSubmit}
              onHandChange={handleHandChange}
              showSubmit={false}
            />
          </div>
        )}

        {/* ── Wager controls (idle phase) ── */}
        {!isActive && (
          <div className="w-full space-y-3 animate-fade-in">
            <p className="text-sm text-[var(--gold-dim)] text-center">
              1v1 Bull &rsquo;Em against the Dealer. 5 cards each, winner takes all.
            </p>
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

            <Link to="/" className="block text-center text-[var(--gold-dim)] hover:text-[var(--gold)] text-sm transition-colors mb-8">
              Back to Home
            </Link>
          </div>
        )}
      </div>
    </Layout>
  );
}

export default FiveDrawPage;
