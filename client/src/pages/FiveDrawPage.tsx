/**
 * 5 Draw Minigame — 1v1 Bull 'Em against the Dealer.
 *
 * Both players get dealt 5 cards. One round of standard Bull 'Em is played
 * with the full action set (Call/Raise, Bull/True, Last Chance Raise/Pass).
 * Uses GameEngine directly — same mechanics as local/online games.
 */
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { HandDisplay } from '../components/HandDisplay.js';
import { HandSelector } from '../components/HandSelector.js';
import { ActionButtons } from '../components/ActionButtons.js';
import { TurnIndicator } from '../components/TurnIndicator.js';
import { CallHistory } from '../components/CallHistory.js';
import { RevealOverlay } from '../components/RevealOverlay.js';
import { useSound, useGameSounds } from '../hooks/useSound.js';
import { useAuth } from '../context/AuthContext.js';
import { useToast } from '../context/ToastContext.js';
import {
  RoundPhase, BotDifficulty, GameEngine, BotPlayer, getMinimumRaise, handToString,
  FIVE_DRAW_MIN_WAGER, FIVE_DRAW_MAX_WAGER, FIVE_DRAW_DEFAULT_WAGER, FIVE_DRAW_WIN_MULTIPLIER,
  DECK_DRAW_STARTING_BALANCE,
  type HandCall, type ServerPlayer, type ClientGameState, type RoundResult, type PlayerId,
} from '@bull-em/shared';
import type { TurnResult } from '@bull-em/shared';

const STORAGE_KEY = 'bull-em-five-draw-balance';
const PLAYER_ID = 'player';
const DEALER_ID = 'dealer';

/** Bot delay for the dealer (ms). Quick pace for a minigame. */
const DEALER_DELAY_MIN = 1200;
const DEALER_DELAY_MAX = 2500;
/** Faster delay for bull/true phase responses. */
const DEALER_BULL_DELAY_MIN = 800;
const DEALER_BULL_DELAY_MAX = 1600;

const WAGER_PRESETS = [1, 5, 10, 50, 100];

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

type GamePhaseLocal = 'wager' | 'playing' | 'result';

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

  // === Hand selector ===
  const [handSelectorOpen, setHandSelectorOpen] = useState(false);
  const [pendingHand, setPendingHand] = useState<HandCall | null>(null);
  const [pendingValid, setPendingValid] = useState(false);

  // === Refs ===
  const engineRef = useRef<GameEngine | null>(null);
  const playersRef = useRef<ServerPlayer[]>([]);
  const botTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleTurnResultRef = useRef<(result: TurnResult) => void>(() => {});
  const wagerRef = useRef(wager);
  const balanceRef = useRef(balance);

  // Keep refs in sync
  useEffect(() => { wagerRef.current = wager; }, [wager]);
  useEffect(() => { balanceRef.current = balance; }, [balance]);

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

  // Cleanup timers on unmount
  useEffect(() => () => {
    if (botTimerRef.current) clearTimeout(botTimerRef.current);
  }, []);

  // Sound effects for game events (turn changes, bull/true calls, etc.)
  useGameSounds(gameState, roundResult, gameWinner === 'player' ? PLAYER_ID : gameWinner === 'dealer' ? DEALER_ID : null, PLAYER_ID);

  // === Derived state ===
  const isMyTurn = gameState ? gameState.currentPlayerId === PLAYER_ID : false;
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

  // === Broadcast engine state to React ===
  const broadcastState = useCallback(() => {
    if (!engineRef.current) return;
    setGameState(engineRef.current.getClientState(PLAYER_ID));
  }, []);

  // === Bot turn scheduling ===
  const scheduleBotTurn = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.currentPlayerId !== DEALER_ID) return;

    // Faster response in bull/last chance phase
    const rp = engine.currentRoundPhase;
    const inBullPhase = rp === RoundPhase.BULL_PHASE || rp === RoundPhase.LAST_CHANCE;
    const min = inBullPhase ? DEALER_BULL_DELAY_MIN : DEALER_DELAY_MIN;
    const max = inBullPhase ? DEALER_BULL_DELAY_MAX : DEALER_DELAY_MAX;
    const delay = min + Math.floor(Math.random() * (max - min));

    botTimerRef.current = setTimeout(() => {
      executeBotTurn();
    }, delay);
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
      case 'call':
        result = engine.handleCall(DEALER_ID, decision.hand);
        break;
      case 'bull':
        result = engine.handleBull(DEALER_ID);
        break;
      case 'true':
        result = engine.handleTrue(DEALER_ID);
        break;
      case 'lastChanceRaise':
        result = engine.handleLastChanceRaise(DEALER_ID, decision.hand);
        break;
      case 'lastChancePass':
        result = engine.handleLastChancePass(DEALER_ID);
        break;
    }

    // Fallback if bot made invalid move
    if (result.type === 'error') {
      result = engine.handleBull(DEALER_ID);
      if (result.type === 'error') {
        result = engine.handleLastChancePass(DEALER_ID);
      }
    }

    if (result.type !== 'error') {
      handleTurnResultRef.current(result);
    }
  }, []);

  // === Finalize game — update balance ===
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

  // Keep ref in sync
  handleTurnResultRef.current = handleTurnResult;

  // === Start a new game ===
  const startGame = useCallback(() => {
    if (!canWager) {
      addToast('Insufficient balance');
      return;
    }

    // Deduct wager immediately
    setBalance(prev => {
      const newBal = prev - wager;
      if (!user) saveGuestBalance(newBal);
      return newBal;
    });

    // Create players — both start with 5 cards, maxCards=5 means one loss = elimination
    const humanPlayer: ServerPlayer = {
      id: PLAYER_ID,
      name: 'You',
      cardCount: 5,
      isConnected: true,
      isEliminated: false,
      isHost: true,
      isBot: false,
      cards: [],
    };
    const dealerPlayer: ServerPlayer = {
      id: DEALER_ID,
      name: 'Dealer',
      cardCount: 5,
      isConnected: true,
      isEliminated: false,
      isHost: false,
      isBot: true,
      cards: [],
    };

    // Randomly decide who goes first
    const players = Math.random() < 0.5
      ? [humanPlayer, dealerPlayer]
      : [dealerPlayer, humanPlayer];

    playersRef.current = players;

    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0 });
    engineRef.current = engine;
    engine.startRound();

    setPhase('playing');
    setRoundResult(null);
    setGameWinner(null);
    setHandSelectorOpen(false);
    setPendingHand(null);
    setPendingValid(false);

    broadcastState();
    scheduleBotTurn();
    play('deckShuffle');
  }, [canWager, wager, user, addToast, broadcastState, scheduleBotTurn, play]);

  // === Player actions ===
  const callHand = useCallback((hand: HandCall) => {
    if (!engineRef.current) return;
    const result = engineRef.current.handleCall(PLAYER_ID, hand);
    handleTurnResult(result);
  }, [handleTurnResult]);

  const callBull = useCallback(() => {
    if (!engineRef.current) return;
    const result = engineRef.current.handleBull(PLAYER_ID);
    handleTurnResult(result);
  }, [handleTurnResult]);

  const callTrue = useCallback(() => {
    if (!engineRef.current) return;
    play('uiClick');
    const result = engineRef.current.handleTrue(PLAYER_ID);
    handleTurnResult(result);
  }, [handleTurnResult, play]);

  const lastChanceRaise = useCallback((hand: HandCall) => {
    if (!engineRef.current) return;
    const result = engineRef.current.handleLastChanceRaise(PLAYER_ID, hand);
    handleTurnResult(result);
  }, [handleTurnResult]);

  const lastChancePass = useCallback(() => {
    if (!engineRef.current) return;
    play('uiClick');
    const result = engineRef.current.handleLastChancePass(PLAYER_ID);
    handleTurnResult(result);
  }, [handleTurnResult, play]);

  // === Hand selector callbacks ===
  const handleHandChange = useCallback((hand: HandCall | null, valid: boolean) => {
    setPendingHand(hand);
    setPendingValid(valid);
  }, []);

  const handleHandSubmit = useCallback(() => {
    if (!pendingHand || !pendingValid) return;
    if (isLastChanceCaller) {
      lastChanceRaise(pendingHand);
    } else {
      callHand(pendingHand);
    }
    setHandSelectorOpen(false);
  }, [pendingHand, pendingValid, isLastChanceCaller, lastChanceRaise, callHand]);

  const handleQuickRaise = useCallback(() => {
    const current = gameState?.currentHand;
    if (!current) return;
    const minRaise = getMinimumRaise(current);
    if (!minRaise) return;
    if (isLastChanceCaller) {
      lastChanceRaise(minRaise);
    } else {
      callHand(minRaise);
    }
    setHandSelectorOpen(false);
  }, [gameState?.currentHand, isLastChanceCaller, lastChanceRaise, callHand]);

  const handleActionExpand = useCallback(() => {
    setHandSelectorOpen(false);
  }, []);

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
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [handSelectorOpen]);

  // Close hand selector when turn changes
  useEffect(() => {
    setHandSelectorOpen(false);
  }, [isMyTurn, gameState?.roundPhase]);

  // === Dismiss round result ===
  const handleDismissResult = useCallback(() => {
    setRoundResult(null);
    if (gameWinner) {
      finalizeGame(gameWinner);
    }
  }, [gameWinner, finalizeGame]);

  // === Play again ===
  const playAgain = useCallback(() => {
    setPhase('wager');
    setGameState(null);
    setRoundResult(null);
    setGameWinner(null);
    engineRef.current = null;
    if (botTimerRef.current) clearTimeout(botTimerRef.current);
  }, []);

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

            {/* Deal button */}
            <button
              onClick={() => { play('uiClick'); startGame(); }}
              disabled={!canWager}
              className="btn-gold w-full py-3 text-base font-bold disabled:opacity-50"
            >
              Deal ({formatNumber(wager)})
            </button>

            <p className="text-xs text-center text-[var(--gold-dim)]">
              Win: {FIVE_DRAW_WIN_MULTIPLIER}x wager
            </p>
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

  // --- Playing Phase ---
  if (phase === 'playing' && gameState) {
    return (
      <Layout
        headerLeftExtra={
          <span className="text-[var(--gold-dim)] font-semibold uppercase tracking-wider text-xs">
            5 Draw &middot; Wager: {formatNumber(wager)}
          </span>
        }
        headerRightExtra={
          <span className="text-[var(--gold)] font-mono text-xs">
            Bal: {formatNumber(balance)}
          </span>
        }
      >
        <div className="game-layout">
          <div className="game-content">
            <div className="game-main">
              {/* Turn indicator */}
              <div data-tooltip="turn-indicator">
                <TurnIndicator
                  currentPlayerId={gameState.currentPlayerId}
                  roundPhase={gameState.roundPhase}
                  players={gameState.players}
                  myPlayerId={PLAYER_ID}
                  hasCurrentHand={gameState.currentHand !== null}
                />
              </div>

              {/* Current call display */}
              {gameState.currentHand && (
                <div className="glass-raised py-1.5 animate-slide-up flex items-baseline" style={{ padding: '0.375rem clamp(0.5rem, 2.9vw, 0.75rem)' }}>
                  <div className="w-1/4 min-w-0 shrink-0">
                    <span className="text-[9px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold">
                      Current Call
                    </span>
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

              {/* My cards */}
              <div data-tooltip="my-cards">
                <HandDisplay cards={gameState.myCards} large />
              </div>

              {/* Call history */}
              <div data-tooltip="call-history">
                <CallHistory history={gameState.turnHistory} cardCounts={cardCounts} />
              </div>

              {/* Action buttons — below cards */}
              <div className="flex justify-between items-start relative" data-tooltip="action-area">
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
                  >
                    min<br />raise
                  </button>
                )}
                {canRaise && handSelectorOpen && (
                  <div className="flex flex-col items-center ml-auto">
                    <button
                      onClick={handleHandSubmit}
                      disabled={!pendingValid}
                      className={`btn-gold action-btn-base font-bold action-btn-primary ${pendingValid ? 'hs-call-pulse' : ''}`}
                    >
                      {gameState.currentHand ? 'Raise' : 'Call'}
                    </button>
                    <p className={`text-[var(--danger)] mt-1 h-4 transition-opacity action-btn-hint ${pendingHand && !pendingValid ? 'opacity-100' : 'opacity-0'}`}>Must be higher</p>
                  </div>
                )}
              </div>

              {/* Hand selector — below action buttons (below the hand) */}
              {canRaise && handSelectorOpen && (
                <div className="-mt-2" data-tooltip="hand-selector">
                  <HandSelector
                    currentHand={gameState.currentHand}
                    onSubmit={handleHandSubmit}
                    onHandChange={handleHandChange}
                    showSubmit={false}
                  />
                </div>
              )}
            </div>
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
        </div>
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
            <p className="text-xs text-[var(--gold-dim)] mt-1">
              Balance: {formatNumber(balance)}
            </p>
          </div>

          <div className="flex gap-3 w-full">
            <button
              onClick={() => { play('uiClick'); playAgain(); }}
              className="btn-gold flex-1 py-3 text-base font-bold"
            >
              Play Again
            </button>
            <Link
              to="/"
              className="btn-ghost flex-1 py-3 text-base font-bold text-center"
            >
              Home
            </Link>
          </div>
        </div>
      </Layout>
    );
  }

  // Fallback
  return null;
}

export default FiveDrawPage;
