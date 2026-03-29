import { useNavigate, useParams } from 'react-router-dom';
import { RoundPhase, getDeckSize } from '@bull-em/shared';
import { Layout } from '../components/Layout.js';
import { PlayerList } from '../components/PlayerList.js';
import { HandDisplay } from '../components/HandDisplay.js';
import { HandSelector } from '../components/HandSelector.js';
import { ActionButtons } from '../components/ActionButtons.js';
import { TurnIndicator } from '../components/TurnIndicator.js';
import { CallHistory, CallHistoryToggleButton } from '../components/CallHistory.js';
import { RevealOverlay } from '../components/RevealOverlay.js';
import { SpectatorView } from '../components/SpectatorView.js';
import { SpectatorPill } from '../components/SpectatorPill.js';
import { ShareButton } from '../components/ShareButton.js';
import { ReconnectOverlay } from '../components/ReconnectOverlay.js';
import { SessionTransferredOverlay } from '../components/SessionTransferredOverlay.js';
import { DisconnectBanner } from '../components/DisconnectBanner.js';
import { EmojiReactionBar } from '../components/EmojiReactionBar.js';
import { ChatPanel } from '../components/ChatPanel.js';
import { GameTooltips } from '../components/GameTooltips.js';

import { BotProfileModal } from '../components/BotProfileModal.js';

import { useGameContext, useReactions, useChatMessages } from '../context/GameContext.js';
import { useAuth } from '../context/AuthContext.js';
import { useErrorToast } from '../hooks/useErrorToast.js';
import { useSound, useGameSounds } from '../hooks/useSound.js';
import { handToString } from '@bull-em/shared';
import { Component, lazy, Suspense, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

/** Lazy-load InGameStats (and its recharts dependency ~150KB gzipped) — only
 *  rendered for eliminated players and spectators, not during active gameplay. */
const InGameStats = lazy(() => import('../components/InGameStats.js').then(m => ({ default: m.InGameStats })));
import type { HandCall, Card, Player } from '@bull-em/shared';
import { getQuickDrawSuggestions, type QuickDrawSuggestion } from '@bull-em/shared';
import { QuickDrawChips } from '../components/QuickDrawChips.js';
import { QuickDrawHint } from '../components/QuickDrawHint.js';
import { useToast } from '../context/ToastContext.js';
import { useNavigationGuard } from '../hooks/useNavigationGuard.js';
import { useGameKeyboardShortcuts } from '../hooks/useGameKeyboardShortcuts.js';
import { useInGameStats } from '../hooks/useInGameStats.js';
import { useUISettings, VolumeControl } from '../components/VolumeControl.js';
import { useIsLandscape } from '../hooks/useIsLandscape.js';
import { useRevealPhase } from '../hooks/useRevealPhase.js';
import { useGameAnnouncements } from '../hooks/useGameAnnouncements.js';
import { RoundtableGameLayout } from '../components/RoundtableGameLayout.js';
import { RoundtableRevealOverlay } from '../components/RoundtableRevealOverlay.js';
import { SeriesBanner } from '../components/SeriesBanner.js';
import { CountdownOverlay } from '../components/CountdownOverlay.js';
import { useCardHide } from '../hooks/useCardHide.js';

/** Tooltip areas that should suppress "tap outside to close" for the hand selector */
const HAND_SELECTOR_AREAS = ['hand-selector', 'action-area', 'raise-area', 'my-cards', 'call-history', 'quick-draw'] as const;
/** Tooltip areas that should suppress "tap outside to close" for quick draw */
const QUICK_DRAW_AREAS = ['quick-draw', 'my-cards', 'action-area', 'call-history'] as const;

function isInsideTooltipArea(target: HTMLElement, areas: readonly string[]): boolean {
  return areas.some(area => target.closest(`[data-tooltip="${area}"]`) !== null);
}

function TransitionOverlay({ deadline }: { deadline: number | null }) {
  const [remaining, setRemaining] = useState(() =>
    deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : 0,
  );

  useEffect(() => {
    if (!deadline) return;
    const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [deadline]);

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50"
         style={{ background: 'var(--overlay)' }}>
      <div className="text-center space-y-3 animate-fade-in">
        <div className="w-8 h-8 border-2 border-[var(--gold)] border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-[var(--gold)] font-display text-lg font-semibold">
          Next round starting&hellip;
        </p>
        {deadline && remaining > 0 && (
          <p className="text-[var(--gold-dim)] text-sm">
            {remaining}s
          </p>
        )}
      </div>
    </div>
  );
}

/** Lightweight error boundary for overlay components (reveal, countdown, etc.).
 *  Instead of crashing the whole game page, catches the error and calls
 *  onError so the parent can dismiss the overlay gracefully. */
class OverlayErrorBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[OverlayErrorBoundary] Caught error in overlay:', error);
    if (info.componentStack) {
      console.error('[OverlayErrorBoundary] Component stack:', info.componentStack);
    }
    this.props.onError();
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

export function GamePage() {
  const { roomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const {
    gameState, roomState, roundResult, roundTransition, roundTransitionDeadline, winnerId, playerId,
    callHand, callBull, callTrue, lastChanceRaise, lastChancePass,
    clearRoundResult, leaveRoom, joinRoom, error, clearError,
    isConnected, hasConnected, disconnectDeadlines,
    sendReaction,
    sendChatMessage,
    spectatorInitialStats,
    sessionTransferred,
    countdown,
    roundSeedHash,
    isServerRestarting,
  } = useGameContext();
  // Reactions and chat from dedicated contexts — prevents game UI re-renders
  // on every emoji event (2s lifecycle) or incoming chat message.
  const { reactions } = useReactions();
  const { chatMessages } = useChatMessages();
  const { user } = useAuth();
  const spectatorCount = roomState?.spectatorCount ?? 0;
  useErrorToast(error, clearError);
  const { play } = useSound();
  // Derived state — safe to compute with null gameState (computed early for useGameSounds)
  const myPlayer = gameState?.players.find(p => p.id === playerId) ?? null;
  const isEliminated = myPlayer?.isEliminated ?? false;
  const isSpectator = gameState ? !myPlayer : false;

  const isLandscape = useIsLandscape();
  useGameSounds(gameState, roundResult, winnerId, playerId, isSpectator || isEliminated, isLandscape, isConnected);
  useGameAnnouncements(gameState, roundResult, playerId);
  const { chatEnabled, emojiEnabled, quickDrawEnabled } = useUISettings();
  const { addToast } = useToast();
  const inGameStats = useInGameStats(gameState, roundResult, spectatorInitialStats);
  const { cardsHidden, swipeHint, isFlipping, gestureHandlers: cardHideGestureHandlers } = useCardHide();

  const rejoinAttemptedRef = useRef(false);
  const wasEliminatedRef = useRef(false);
  const lastResultRef = useRef(roundResult);

  // All useState hooks — must be called unconditionally (before any early return)
  const [handSelectorOpen, setHandSelectorOpen] = useState(false);
  const [pendingHand, setPendingHand] = useState<HandCall | null>(null);
  const [pendingValid, setPendingValid] = useState(false);
  const [quickDrawOpen, setQuickDrawOpen] = useState(false);
  const [tappedCard, setTappedCard] = useState<Card | null>(null);
  const [callHistoryOpen, setCallHistoryOpen] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  // Delay showing ReconnectOverlay to avoid flashing on brief disconnects
  const [showReconnectOverlay, setShowReconnectOverlay] = useState(false);
  // Orientation-independent reveal phase — survives landscape/portrait switches
  const { cinematicComplete, revealStartedAt, markCinematicComplete } = useRevealPhase(roundResult);
  const cinematicStartedRef = useRef(false);
  const isMyTurn = gameState ? gameState.currentPlayerId === playerId && !isEliminated && !isSpectator : false;
  const isAtMaxCards = !isEliminated && !isSpectator && myPlayer && gameState
    ? myPlayer.cardCount >= gameState.maxCards
    : false;
  const isLastChanceCaller = gameState
    ? gameState.roundPhase === RoundPhase.LAST_CHANCE && gameState.lastCallerId === playerId
    : false;
  const canCallHand = isMyTurn && gameState && (
    gameState.roundPhase === RoundPhase.CALLING
    || gameState.roundPhase === RoundPhase.BULL_PHASE
  );
  const canRaise = canCallHand || isLastChanceCaller;

  // Track when the page becomes visible (returns from background) so we can
  // extend the reconnect overlay grace period. Mobile browsers suspend JS
  // when backgrounded, causing ping timeouts and socket disconnects that
  // resolve quickly once the tab is foregrounded again.
  //
  // Also unsticks the "next round starting" transition overlay if the deadline
  // passed while the page was backgrounded. Previously two separate
  // visibilitychange handlers — merged to avoid duplicate listener overhead.
  const lastVisibleAtRef = useRef(Date.now());
  const roundTransitionRef = useRef(roundTransition);
  const roundTransitionDeadlineRef = useRef(roundTransitionDeadline);
  const clearRoundResultRef = useRef(clearRoundResult);
  roundTransitionRef.current = roundTransition;
  roundTransitionDeadlineRef.current = roundTransitionDeadline;
  clearRoundResultRef.current = clearRoundResult;

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      lastVisibleAtRef.current = Date.now();
      // Unstick transition overlay if its deadline passed while backgrounded
      if (roundTransitionRef.current && roundTransitionDeadlineRef.current && Date.now() > roundTransitionDeadlineRef.current) {
        clearRoundResultRef.current();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Delay showing ReconnectOverlay to avoid flashing on brief network blips
  // or background-tab ping timeouts. Use a longer delay (8s) if the page just
  // came back from being hidden, since the disconnect is almost certainly
  // caused by the browser suspending the socket while backgrounded.
  useEffect(() => {
    if (isConnected || !hasConnected) {
      setShowReconnectOverlay(false);
      return;
    }
    const msSinceVisible = Date.now() - lastVisibleAtRef.current;
    const delay = msSinceVisible < 2000 ? 8000 : 4000;
    const timer = setTimeout(() => setShowReconnectOverlay(true), delay);
    return () => clearTimeout(timer);
  }, [isConnected, hasConnected]);

  // Prevent accidental tab close / refresh during an active game
  useNavigationGuard(!!gameState && !winnerId);

  // Defer navigation to results if a round result overlay is still showing
  useEffect(() => {
    if (winnerId && !roundResult) navigate(`/results/${roomCode}`);
  }, [winnerId, roundResult, roomCode, navigate]);

  useEffect(() => {
    if (gameState || !roomCode || rejoinAttemptedRef.current) return;

    // Spectators don't rejoin as players — their reconnect is handled by
    // GameContext's connect/reconnect handlers via SPECTATOR_ROOM_KEY.
    if (sessionStorage.getItem('bull-em-spectator-room')) {
      rejoinAttemptedRef.current = true;
      return;
    }

    // If we already have a playerId set (e.g., from matchmaking auto-join),
    // we're already in the room on the server side. Don't attempt a rejoin
    // that will fail with "Room is full" or "Game already in progress" —
    // just wait for the server to send game:state when the game starts.
    if (playerId) {
      rejoinAttemptedRef.current = true;
      // Safety timeout: if game state never arrives, redirect home.
      // 30s is generous enough for slow reconnections with retries.
      const timeout = setTimeout(() => {
        addToast('Could not rejoin game');
        navigate('/');
      }, 30000);
      return () => clearTimeout(timeout);
    }

    // Only attempt rejoin if we have a reconnect token for this room — that
    // proves we were a player in this game. Without it we may be a spectator
    // whose SPECTATOR_ROOM_KEY was cleared (e.g., by leaveRoom()), so falling
    // through to joinRoom() would fail with "Game already in progress".
    const storedRoomCode = sessionStorage.getItem('bull-em-room-code');
    const storedToken = sessionStorage.getItem('bull-em-reconnect-token');
    const storedName = sessionStorage.getItem('bull-em-player-name') || localStorage.getItem('bull-em-player-name');
    if (!storedName || !storedToken || storedRoomCode !== roomCode) {
      navigate('/');
      return;
    }
    rejoinAttemptedRef.current = true;

    let settled = false;
    // Allow enough time for reconnection retries (up to 2 retries with 1-2s backoff).
    // 30s is generous enough for slow networks and Socket.io reconnection cycles.
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        addToast('Could not rejoin game');
        navigate('/');
      }
    }, 30000);

    joinRoom(roomCode, storedName, user?.avatar)
      .then(() => { settled = true; clearTimeout(timeout); })
      .catch(() => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          addToast('Could not rejoin game');
          navigate('/');
        }
      });
  }, [gameState, roomCode, joinRoom, navigate, playerId, addToast]);

  useEffect(() => {
    if (!gameState && !countdown && roomState?.gamePhase === 'lobby' && roomCode) {
      navigate(`/room/${roomCode}`);
    }
  }, [gameState, countdown, roomState?.gamePhase, roomCode, navigate]);

  // Show a one-time prominent notification when the player gets eliminated
  useEffect(() => {
    if (isEliminated && !wasEliminatedRef.current && !winnerId) {
      addToast("You've been eliminated! You're now spectating.", 'info');
    }
    wasEliminatedRef.current = isEliminated;
  }, [isEliminated, winnerId, addToast]);

  // Show a toast for every player eliminated this round
  useEffect(() => {
    if (roundResult && roundResult !== lastResultRef.current && gameState) {
      for (const eliminatedId of roundResult.eliminatedPlayerIds) {
        if (eliminatedId === playerId) continue;
        const name = gameState.players.find(p => p.id === eliminatedId)?.name ?? 'A player';
        addToast(`${name} has been eliminated!`, 'info');
      }
    }
    lastResultRef.current = roundResult;
  }, [roundResult, playerId, gameState, addToast]);

  // Reset cinematicStarted tracking when new round result arrives
  useEffect(() => {
    if (roundResult) cinematicStartedRef.current = false;
  }, [roundResult]);

  // Portrait mode skips the cinematic — mark complete so landscape won't replay if user rotates
  useEffect(() => {
    if (roundResult && !isLandscape && !cinematicComplete) {
      markCinematicComplete();
    }
  }, [roundResult, isLandscape, cinematicComplete, markCinematicComplete]);

  const deckSize = getDeckSize(roomState?.settings?.jokerCount ?? 0);
  const cardStats = useMemo(() => {
    if (!gameState) return { total: 0, pct: 0 };
    const total = gameState.players.filter(p => !p.isEliminated).reduce((sum, p) => sum + p.cardCount, 0);
    return { total, pct: Math.round((total / deckSize) * 100) };
  }, [gameState, deckSize]);

  const cardCounts = useMemo(() => {
    if (!gameState) return {};
    const counts: Record<string, number> = {};
    for (const p of gameState.players) counts[p.id] = p.cardCount;
    return counts;
  }, [gameState]);

  // Ordered players for landscape reveal overlay (same logic as RoundtableGameLayout)
  const orderedPlayersForReveal = useMemo(() => {
    if (!gameState) return [];
    const ps = gameState.players;
    const myIdx = ps.findIndex(p => p.id === playerId);
    if (myIdx <= 0) return ps;
    return [...ps.slice(myIdx), ...ps.slice(0, myIdx)];
  }, [gameState, playerId]);

  // Spectator reactions whose playerId doesn't match any player in the game
  // (spectators use socket.id which has no PlayerCard) — shown as floating emojis.
  const orphanReactions = useMemo(() => {
    if (!reactions.length || !gameState) return [];
    const playerIds = new Set(gameState.players.map(p => p.id));
    return reactions.filter(r => !playerIds.has(r.playerId));
  }, [reactions, gameState]);

  const handlePlayerClick = useCallback((player: Player) => {
    // All players (human, bot, guest) → show in-game overlay with stats
    setSelectedPlayer(player);
  }, []);

  // Cache suggestions from handleCardTap so the useMemo below doesn't
  // recompute getQuickDrawSuggestions with the same inputs on the next render.
  const cachedSuggestionsRef = useRef<QuickDrawSuggestion[]>([]);

  const quickDrawSuggestions = useMemo(() => {
    if (!quickDrawOpen || !canRaise || !gameState) return [];
    // If handleCardTap already computed suggestions for this exact state,
    // return the cached result instead of recomputing.
    if (cachedSuggestionsRef.current.length > 0) {
      const cached = cachedSuggestionsRef.current;
      cachedSuggestionsRef.current = [];
      return cached;
    }
    return getQuickDrawSuggestions(gameState.myCards, gameState.currentHand, tappedCard ?? undefined);
  }, [quickDrawOpen, canRaise, gameState, tappedCard]);

  // Tapping own cards: toggle Quick Draw chips (biased toward the tapped card).
  // Computes suggestions once and caches the result so the useMemo above can
  // skip recomputing with the same inputs on the triggered re-render.
  const handleCardTap = useCallback((card: Card) => {
    if (!quickDrawEnabled || !canRaise || !gameState) return;
    play('uiClick');
    if (quickDrawOpen) {
      setQuickDrawOpen(false);
      setTappedCard(null);
      return;
    }
    const suggestions = getQuickDrawSuggestions(gameState.myCards, gameState.currentHand, card);
    if (suggestions.length === 0) {
      setHandSelectorOpen(true);
    } else {
      cachedSuggestionsRef.current = suggestions;
      setTappedCard(card);
      setQuickDrawOpen(true);
    }
  }, [quickDrawEnabled, canRaise, play, gameState, quickDrawOpen]);

  const handleQuickDrawSelect = useCallback((suggestion: QuickDrawSuggestion) => {
    // Sound is played by useGameSounds when the turn history updates
    if (isLastChanceCaller) {
      lastChanceRaise(suggestion.hand);
    } else {
      callHand(suggestion.hand);
    }
    setHandSelectorOpen(false);
    setQuickDrawOpen(false);
    setTappedCard(null);
  }, [isLastChanceCaller, lastChanceRaise, callHand]);

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

  // Stable callback references so ActionButtons' React.memo isn't broken
  const closeHandSelector = useCallback(() => setHandSelectorOpen(false), []);
  const openHandSelector = useCallback(() => { play('uiClick'); setHandSelectorOpen(true); }, [play]);
  const handleQuickDrawDismiss = useCallback(() => { setQuickDrawOpen(false); setTappedCard(null); }, []);

  // Close hand selector on tap outside
  useEffect(() => {
    if (!handSelectorOpen) return;
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
      if (isInsideTooltipArea(target, HAND_SELECTOR_AREAS)) return;
      setHandSelectorOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [handSelectorOpen]);

  // Close quick draw chips on tap outside
  useEffect(() => {
    if (!quickDrawOpen) return;
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
      if (isInsideTooltipArea(target, QUICK_DRAW_AREAS)) return;
      setQuickDrawOpen(false);
      setTappedCard(null);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [quickDrawOpen]);

  // Close hand selector and quick draw when turn changes
  const roundPhase = gameState?.roundPhase;
  useEffect(() => {
    setHandSelectorOpen(false);
    setQuickDrawOpen(false);
    setTappedCard(null);
  }, [isMyTurn, roundPhase]);

  // Keyboard shortcuts (B=bull, T=true, C=raise/call, Esc=close, Enter=submit, P=pass)
  const showBull = isMyTurn && gameState?.currentHand !== null
    && (gameState?.roundPhase === RoundPhase.CALLING || gameState?.roundPhase === RoundPhase.BULL_PHASE);
  const showTrue = isMyTurn && gameState?.roundPhase === RoundPhase.BULL_PHASE;
  const showPass = isMyTurn && isLastChanceCaller;
  const overlayActive = !!roundResult || !!roundTransition;

  useGameKeyboardShortcuts({
    onBull: showBull ? () => { callBull(); } : null,
    onTrue: showTrue ? () => { play('uiClick'); callTrue(); } : null,
    onRaise: canRaise && !handSelectorOpen ? () => { play('uiClick'); setHandSelectorOpen(true); } : null,
    onSubmitHand: canRaise && handSelectorOpen && pendingValid ? handleHandSubmit : null,
    onPass: showPass ? () => { play('uiClick'); lastChancePass(); } : null,
    onEscape: roundResult
      ? clearRoundResult
      : handSelectorOpen
        ? closeHandSelector
        : null,
    overlayActive,
  });

  const handleLeave = useCallback(() => {
    // Spectators and eliminated players aren't in the game — no forfeit penalty
    if (isSpectator || isEliminated) {
      leaveRoom();
      navigate('/');
      return;
    }
    const message = gameState?.ranked
      ? 'Forfeit this match? You will receive a loss and your rating will be affected.'
      : 'Forfeit this game? You will be eliminated and cannot rejoin.';
    if (window.confirm(message)) {
      leaveRoom();
      navigate('/');
    }
  }, [isSpectator, isEliminated, gameState?.ranked, leaveRoom, navigate]);

  // ── Early return: loading state (all hooks called above) ──────────────
  if (!gameState) {
    // Show countdown overlay while waiting for the game to start
    if (countdown) {
      return (
        <Layout>
          <CountdownOverlay seconds={countdown.secondsLeft} label={countdown.label} />
        </Layout>
      );
    }
    // Show progressive status so users know the system is working, not stuck
    const loadingMessage = !hasConnected
      ? 'Connecting to server\u2026'
      : !roomState
        ? 'Joining room\u2026'
        : 'Waiting for game state\u2026';
    return (
      <Layout>
        <div className="flex items-center justify-center pt-16">
          <div className="text-center space-y-3">
            <div className="w-8 h-8 border-2 border-[var(--gold)] border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-[var(--gold-dim)]">{loadingMessage}</p>
          </div>
        </div>
      </Layout>
    );
  }

  const seriesInfo = gameState.seriesInfo;

  /* Landscape/desktop: merge game info into the Layout header bar */
  const headerLeftExtra = (
    <div className="flex flex-col items-start gap-0">
      <div className="flex items-center gap-2">
        <span className="text-[var(--gold-dim)] font-semibold uppercase tracking-wider text-xs">
          Round {gameState.roundNumber}
        </span>
        {seriesInfo && seriesInfo.bestOf > 1 && (
          <span className="text-[var(--gold-dim)] font-mono text-xs">
            Bo{seriesInfo.bestOf} Set {seriesInfo.currentSet}
          </span>
        )}
        <span className="text-[var(--gold-dim)] font-mono text-xs" title={`${cardStats.total} of ${deckSize} cards in play`}>
          {cardStats.total}/{deckSize} ({cardStats.pct}%)
        </span>
      </div>
      <CallHistoryToggleButton
        count={gameState.turnHistory.length}
        isOpen={callHistoryOpen}
        onToggle={() => { setCallHistoryOpen(v => !v); setQuickDrawOpen(false); }}
      />
    </div>
  );

  const headerRightExtra = (
    <>
      <span
        className="font-mono tracking-wider text-[var(--gold-dim)] text-xs mr-1 cursor-pointer active:scale-95 transition-transform"
        onClick={() => { if (roomCode) { navigator.clipboard.writeText(roomCode); addToast('Room code copied!', 'info'); } }}
        title="Tap to copy"
      >{roomCode}</span>
      {spectatorCount > 0 && (
        <span className="text-[var(--gold-dim)] text-xs" title={`${spectatorCount} spectator${spectatorCount !== 1 ? 's' : ''} watching`}>
          &#128065; {spectatorCount}
        </span>
      )}
      {roomCode && <ShareButton roomCode={roomCode} variant="compact" />}
      <VolumeControl />
      <button
        onClick={handleLeave}
        className="text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors text-xs min-h-[44px] min-w-[44px] flex items-center justify-center"
        title="Leave game"
      >
        Leave
      </button>
      <span className="font-mono tracking-wider text-[var(--gold-dim)] text-xs">{gameState.ranked ? 'RANKED' : 'ONLINE'}</span>
    </>
  );

  return (
    <Layout headerLeftExtra={headerLeftExtra} headerRightExtra={headerRightExtra} hideHeaderLandscape>
      {/* ── Roundtable layout (landscape/desktop) ── */}
      {isLandscape ? (
        <div className={`${(isEliminated || isSpectator) && !winnerId ? 'spectating' : ''}`}>
          {(isEliminated || isSpectator) && !winnerId && (
            <SpectatorPill isEliminated={isEliminated} />
          )}
          <RoundtableGameLayout
            players={gameState.players}
            currentPlayerId={gameState.currentPlayerId}
            myPlayerId={playerId}
            maxCards={gameState.maxCards}
            roundNumber={gameState.roundNumber}
            roundPhase={gameState.roundPhase}
            currentHand={gameState.currentHand}
            lastCallerId={gameState.lastCallerId}
            myCards={gameState.myCards}
            turnHistory={gameState.turnHistory}
            turnDeadline={gameState.turnDeadline}
            turnDurationMs={gameState.turnDurationMs}
            spectatorCards={gameState.spectatorCards}
            isMyTurn={isMyTurn}
            isEliminated={isEliminated}
            isSpectator={isSpectator}
            isLastChanceCaller={isLastChanceCaller}
            canRaise={canRaise}
            handSelectorOpen={handSelectorOpen}
            pendingValid={pendingValid}
            pendingHand={pendingHand}
            quickDrawOpen={quickDrawOpen}
            quickDrawEnabled={quickDrawEnabled}
            quickDrawSuggestions={quickDrawSuggestions}
            callHistoryVisible={callHistoryOpen}
            disconnectDeadlines={disconnectDeadlines}
            revealInProgress={!!roundResult && !cinematicComplete}
            onBull={callBull}
            onTrue={callTrue}
            onLastChancePass={lastChancePass}
            onOpenHandSelector={openHandSelector}
            onHandSubmit={handleHandSubmit}
            onHandChange={handleHandChange}
            onCardTap={canRaise && quickDrawEnabled ? handleCardTap : undefined}
            onQuickDrawSelect={handleQuickDrawSelect}
            onQuickDrawDismiss={handleQuickDrawDismiss}
            onPlayerClick={handlePlayerClick}
            cardsHidden={cardsHidden}
            swipeHint={swipeHint}
            isFlipping={isFlipping}
            cardHideGestureHandlers={cardHideGestureHandlers}
          />

          {/* Overlays still render on top */}
          <GameTooltips gameActive={!roundResult && !roundTransition} />
          {countdown && (
            <CountdownOverlay seconds={countdown.secondsLeft} label={countdown.label} />
          )}
          {roundTransition && !roundResult && !countdown && (
            <TransitionOverlay deadline={roundTransitionDeadline} />
          )}
          {roundResult && !cinematicComplete && (
            <OverlayErrorBoundary onError={clearRoundResult}>
              <RoundtableRevealOverlay
                result={roundResult}
                orderedPlayers={orderedPlayersForReveal}
                playerCount={Math.min(gameState.players.length, 12)}
                myPlayerId={playerId ?? undefined}
                onComplete={markCinematicComplete}
                skipToEnd={cinematicStartedRef.current}
                onAnimationStart={() => { cinematicStartedRef.current = true; }}
                roundSeedHash={roundSeedHash}
              />
            </OverlayErrorBoundary>
          )}
          {roundResult && cinematicComplete && (
            <OverlayErrorBoundary onError={clearRoundResult}>
              <RevealOverlay
                result={roundResult}
                players={gameState.players}
                myPlayerId={playerId ?? undefined}
                onDismiss={clearRoundResult}
                startedAt={revealStartedAt}
                roundSeedHash={roundSeedHash}
              />
            </OverlayErrorBoundary>
          )}
          {isAtMaxCards && (
            <div className="max-cards-warning-glow" aria-hidden="true" />
          )}
          {sessionTransferred && <SessionTransferredOverlay />}
          {showReconnectOverlay && !sessionTransferred && <ReconnectOverlay isServerRestarting={isServerRestarting} />}
        </div>
      ) : (
      /* ── Portrait layout (existing) ── */
      <div className={`game-layout ${(isEliminated || isSpectator) && !winnerId ? 'spectating' : ''}`}>
        {/* Top bar — portrait only (merged into header in landscape) */}
        <div className="game-top-bar flex justify-between items-center text-xs">
          <div className="flex items-center gap-3">
            <span className="text-[var(--gold-dim)] font-semibold uppercase tracking-wider">
              Round {gameState.roundNumber}
            </span>
            <span className="text-[var(--gold-dim)] font-mono" title={`${cardStats.total} of ${deckSize} cards in play`}>
              {cardStats.total}/{deckSize} ({cardStats.pct}%)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="font-mono tracking-wider text-[var(--gold-dim)] cursor-pointer active:scale-95 transition-transform"
              onClick={() => { if (roomCode) { navigator.clipboard.writeText(roomCode); addToast('Room code copied!', 'info'); } }}
              title="Tap to copy"
            >{roomCode}</span>
            {spectatorCount > 0 && (
              <span className="text-[var(--gold-dim)]" title={`${spectatorCount} spectator${spectatorCount !== 1 ? 's' : ''} watching`}>
                &#128065; {spectatorCount}
              </span>
            )}
            {roomCode && <ShareButton roomCode={roomCode} variant="compact" />}
            <VolumeControl />
            <button
              onClick={handleLeave}
              className="text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors text-xs min-h-[44px] min-w-[44px] flex items-center justify-center"
              title="Leave game"
            >
              Leave
            </button>
            <span className="font-mono tracking-wider text-[var(--gold-dim)]">{gameState.ranked ? 'RANKED' : 'ONLINE'}</span>
          </div>
        </div>

        {/* Series banner — shows best-of info, set number, and series score */}
        {seriesInfo && seriesInfo.bestOf > 1 && (
          <SeriesBanner seriesInfo={seriesInfo} players={gameState.players} playerId={playerId} className="glass" />
        )}

        {/* Floating spectator pill — unobtrusive indicator at top of screen.
            Hidden when winnerId is set because the match is over (no active game to spectate). */}
        {(isEliminated || isSpectator) && !winnerId && (
          <SpectatorPill isEliminated={isEliminated} />
        )}

        <div className="game-content">
          {/* Sidebar — player list */}
          <div className="game-sidebar">
            <div data-tooltip="players">
              <PlayerList
                players={gameState.players}
                currentPlayerId={gameState.currentPlayerId}
                myPlayerId={playerId}
                maxCards={gameState.maxCards}
                roundNumber={gameState.roundNumber}
                turnHistory={gameState.turnHistory}
                collapsible
                reactions={reactions}
                onPlayerClick={handlePlayerClick}
                turnDeadline={gameState.turnDeadline}
                turnDurationMs={gameState.turnDurationMs}
              />
            </div>
          </div>

          {/* Main area — cards, actions, hand selector */}
          <div className="game-main">
            <div data-tooltip="turn-indicator">
              <TurnIndicator
                currentPlayerId={gameState.currentPlayerId}
                roundPhase={gameState.roundPhase}
                players={gameState.players}
                myPlayerId={playerId}
                turnDeadline={gameState.turnDeadline}
                hasCurrentHand={gameState.currentHand !== null}
              />
            </div>

            {/* Disconnect countdown banners for other players */}
            <DisconnectBanner
              players={gameState.players}
              disconnectDeadlines={disconnectDeadlines}
            />

            {/* Current call display */}
            {gameState.currentHand && (
              <div className="glass-raised py-1.5 animate-slide-up flex items-baseline" style={{ padding: '0.375rem clamp(0.5rem, 2.9vw, 0.75rem)' }}>
                <div className="w-1/4 min-w-0 shrink-0">
                  <span className="text-[9px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold whitespace-nowrap">
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
            {!isEliminated && !isSpectator && <div data-tooltip="my-cards"><HandDisplay cards={gameState.myCards} large onCardTap={canRaise && quickDrawEnabled ? handleCardTap : undefined} cardsHidden={cardsHidden} swipeHint={swipeHint} isFlipping={isFlipping} gestureHandlers={cardHideGestureHandlers} /></div>}

            {/* Quick Draw first-use hint */}
            {!isEliminated && !isSpectator && quickDrawEnabled && !quickDrawOpen && (
              <QuickDrawHint visible={canRaise} />
            )}

            {/* Quick Draw suggestion chips */}
            {quickDrawOpen && canRaise && quickDrawSuggestions.length > 0 && (
              <QuickDrawChips
                suggestions={quickDrawSuggestions}
                onSelect={handleQuickDrawSelect}
                onDismiss={handleQuickDrawDismiss}
              />
            )}

            {/* Spectator view — eliminated players and external spectators see all cards */}
            {(isEliminated || isSpectator) && gameState.spectatorCards && (
              <SpectatorView spectatorCards={gameState.spectatorCards} currentPlayerId={gameState.currentPlayerId} />
            )}

            {/* Call history */}
            <div data-tooltip="call-history">
              <CallHistory history={gameState.turnHistory} cardCounts={cardCounts} />
            </div>

            {/* Action row — BULL/TRUE on left, Raise/Call on right */}
            {/* Placed BEFORE the hand selector so buttons never move when picker opens */}
            {!isEliminated && !isSpectator && (
              <div className="flex justify-between items-start relative" data-tooltip="action-area">
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
                      onClick={openHandSelector}
                      className="btn-ghost border-[var(--gold-dim)] action-btn-base font-bold animate-pulse-glow action-btn-primary kbd-shortcut"
                      data-kbd="C"
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
                    >
                      {gameState.currentHand ? 'Raise' : 'Call'}
                    </button>
                    <p className={`text-[var(--danger)] mt-1 h-4 transition-opacity action-btn-hint ${pendingHand && !pendingValid ? 'opacity-100' : 'opacity-0'}`}>Must be higher</p>
                  </div>
                )}
              </div>
            )}

            {/* Hand selector — appears below the action buttons so buttons stay put */}
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

        {/* First-game contextual tooltips */}
        <GameTooltips gameActive={!roundResult && !roundTransition} />

        {/* Game countdown overlay (initial start or Bo3/Bo5 set transition) */}
        {countdown && (
          <CountdownOverlay seconds={countdown.secondsLeft} label={countdown.label} />
        )}

        {/* Round transition overlay */}
        {roundTransition && !roundResult && !countdown && (
          <TransitionOverlay deadline={roundTransitionDeadline} />
        )}

        {/* Round result overlay */}
        {roundResult && (
          <OverlayErrorBoundary onError={clearRoundResult}>
            <RevealOverlay
              result={roundResult}
              players={gameState.players}
              myPlayerId={playerId ?? undefined}
              onDismiss={clearRoundResult}
              startedAt={revealStartedAt}
              roundSeedHash={roundSeedHash}
            />
          </OverlayErrorBoundary>
        )}

        {/* Max cards warning — steady (non-pulsating) edge glow when one loss away from elimination */}
        {isAtMaxCards && (
          <div className="max-cards-warning-glow" aria-hidden="true" />
        )}

        {/* Session transferred overlay — shown on old device/tab (non-dismissable) */}
        {sessionTransferred && <SessionTransferredOverlay />}

        {/* Reconnecting overlay — shown when own connection drops */}
        {showReconnectOverlay && !sessionTransferred && <ReconnectOverlay isServerRestarting={isServerRestarting} />}
      </div>
      )}

      {/* Emoji, stats, and chat rendered OUTSIDE game-layout so they are not affected
          by the .spectating CSS filter which breaks position:fixed children. */}
      {emojiEnabled && (
        <>
          <EmojiReactionBar onReaction={sendReaction} />
          {/* Spectator reactions that don't match any player tile (spectators use socket.id
              as playerId which has no corresponding PlayerCard) — render as floating emojis
              near the emoji bar so the sender gets visual feedback. */}
          {orphanReactions.length > 0 && (
            <div className="fixed bottom-16 left-4 z-40 pointer-events-none flex gap-1">
              {orphanReactions.map(r => (
                <span key={`${r.playerId}-${r.timestamp}`} className="emoji-bubble">
                  {r.emoji}
                </span>
              ))}
            </div>
          )}
        </>
      )}
      {(isEliminated || isSpectator) && (
        <div className="fixed bottom-4 inset-x-0 z-40 flex justify-center pointer-events-none">
          <div className="pointer-events-auto">
            <Suspense fallback={null}>
              <InGameStats stats={inGameStats} players={gameState.players} myPlayerId={playerId} label="Match Stats" />
            </Suspense>
          </div>
        </div>
      )}
      {chatEnabled && (
        <ChatPanel
          messages={chatMessages}
          onSend={sendChatMessage}
          disabled={!isEliminated && !isSpectator && !roundResult && !roundTransition && !winnerId}
          label={isEliminated || isSpectator ? 'Spectator Chat' : 'Chat'}
        />
      )}

      {selectedPlayer && gameState && (
        <BotProfileModal
          player={selectedPlayer}
          playerIndex={gameState.players.findIndex(p => p.id === selectedPlayer.id)}
          stats={inGameStats.playerStats[selectedPlayer.id] ?? null}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </Layout>
  );
}
