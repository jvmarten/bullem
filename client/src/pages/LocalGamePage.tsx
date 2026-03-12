import { useNavigate } from 'react-router-dom';
import { RoundPhase, handToString, getDeckSize } from '@bull-em/shared';
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
import { GameTooltips } from '../components/GameTooltips.js';

import { BotProfileModal } from '../components/BotProfileModal.js';
import { InGameStats } from '../components/InGameStats.js';

import { useGameContext } from '../context/GameContext.js';
import { useToast } from '../context/ToastContext.js';
import { useErrorToast } from '../hooks/useErrorToast.js';
import { useSound, useGameSounds } from '../hooks/useSound.js';
import { useNavigationGuard } from '../hooks/useNavigationGuard.js';
import { useGameKeyboardShortcuts } from '../hooks/useGameKeyboardShortcuts.js';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { HandCall, Card, Player } from '@bull-em/shared';
import { getQuickDrawSuggestions, type QuickDrawSuggestion } from '@bull-em/shared';
import { QuickDrawChips } from '../components/QuickDrawChips.js';
import { QuickDrawHint } from '../components/QuickDrawHint.js';
import { useUISettings, VolumeControl } from '../components/VolumeControl.js';
import { useInGameStats } from '../hooks/useInGameStats.js';
import { useIsLandscape } from '../hooks/useIsLandscape.js';
import { useRevealPhase } from '../hooks/useRevealPhase.js';
import { useGameAnnouncements } from '../hooks/useGameAnnouncements.js';
import { RoundtableGameLayout } from '../components/RoundtableGameLayout.js';
import { RoundtableRevealOverlay } from '../components/RoundtableRevealOverlay.js';
import { SeriesBanner } from '../components/SeriesBanner.js';
import { CountdownOverlay } from '../components/CountdownOverlay.js';

/** Tooltip areas that should suppress "tap outside to close" for the hand selector */
const HAND_SELECTOR_AREAS = ['hand-selector', 'action-area', 'raise-area', 'my-cards', 'call-history', 'quick-draw'] as const;
/** Tooltip areas that should suppress "tap outside to close" for quick draw */
const QUICK_DRAW_AREAS = ['quick-draw', 'my-cards', 'action-area'] as const;

function isInsideTooltipArea(target: HTMLElement, areas: readonly string[]): boolean {
  return areas.some(area => target.closest(`[data-tooltip="${area}"]`) !== null);
}

export function LocalGamePage() {
  const navigate = useNavigate();
  const {
    gameState, roundResult, roundTransition, winnerId, playerId,
    callHand, callBull, callTrue, lastChanceRaise, lastChancePass,
    clearRoundResult, leaveRoom, isPaused, togglePause, error, clearError,
    gameSettings, countdown,
  } = useGameContext();
  useErrorToast(error, clearError);
  const { play } = useSound();
  const isLandscape = useIsLandscape();
  useGameSounds(gameState, roundResult, winnerId, playerId, false, isLandscape);
  useGameAnnouncements(gameState, roundResult, playerId);
  const { quickDrawEnabled } = useUISettings();
  const { addToast } = useToast();
  const inGameStats = useInGameStats(gameState, roundResult);

  // All useState hooks — must be called unconditionally (before any early return)
  const [handSelectorOpen, setHandSelectorOpen] = useState(false);
  const [pendingHand, setPendingHand] = useState<HandCall | null>(null);
  const [pendingValid, setPendingValid] = useState(false);
  const [quickDrawOpen, setQuickDrawOpen] = useState(false);
  const [tappedCard, setTappedCard] = useState<Card | null>(null);
  const [callHistoryOpen, setCallHistoryOpen] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  // Orientation-independent reveal phase — survives landscape/portrait switches
  const { cinematicComplete, revealStartedAt, markCinematicComplete } = useRevealPhase(roundResult);
  const cinematicStartedRef = useRef(false);

  // All useRef hooks — unconditional
  const wasEliminatedRef = useRef(false);
  const lastResultRef = useRef(roundResult);

  // Derived state — safe to compute with null gameState
  const myPlayer = gameState?.players.find(p => p.id === playerId) ?? null;
  const isEliminated = myPlayer?.isEliminated ?? false;
  const isMyTurn = gameState ? gameState.currentPlayerId === playerId && !isEliminated : false;
  const isAtMaxCards = !isEliminated && myPlayer && gameState
    ? myPlayer.cardCount >= gameState.maxCards
    : false;
  const isLastChanceCaller = gameState
    ? gameState.roundPhase === RoundPhase.LAST_CHANCE && gameState.lastCallerId === playerId
    : false;
  const canCallHand = isMyTurn && gameState !== null && (
    gameState.roundPhase === RoundPhase.CALLING
    || gameState.roundPhase === RoundPhase.BULL_PHASE
  );
  const canRaise = canCallHand || isLastChanceCaller;

  // Defer navigation to results if a round result overlay is still showing
  useEffect(() => {
    if (winnerId && !roundResult) navigate('/local/results');
  }, [winnerId, roundResult, navigate]);

  // Prevent accidental tab close / refresh during an active game
  useNavigationGuard(!!gameState && !winnerId);

  // If gameState is null and no countdown is active, there's no active local
  // game — redirect to the lobby. Game state is restored synchronously in
  // LocalGameProvider, so after a browser refresh gameState is already set on
  // the first render. Use replace so this redirect doesn't pollute the history stack.
  useEffect(() => {
    if (!gameState && !countdown) navigate('/local', { replace: true });
  }, [gameState, countdown, navigate]);

  // Show a one-time prominent notification when the player gets eliminated.
  // Skip when winnerId is set — the game-over flow handles that state.
  useEffect(() => {
    if (isEliminated && !wasEliminatedRef.current && !winnerId) {
      addToast("You've been eliminated! You're now spectating.", 'info');
    }
    wasEliminatedRef.current = isEliminated;
  }, [isEliminated, winnerId, addToast]);

  // Show a toast for every player eliminated this round (including other players).
  // Fires when roundResult arrives so the notification coincides with the reveal overlay.
  useEffect(() => {
    if (roundResult && roundResult !== lastResultRef.current && gameState) {
      for (const eliminatedId of roundResult.eliminatedPlayerIds) {
        if (eliminatedId === playerId) continue; // already handled above
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

  // Ordered players for landscape reveal overlay
  const orderedPlayersForReveal = useMemo(() => {
    if (!gameState) return [];
    const ps = gameState.players;
    const myIdx = ps.findIndex(p => p.id === playerId);
    if (myIdx <= 0) return ps;
    return [...ps.slice(myIdx), ...ps.slice(0, myIdx)];
  }, [gameState, playerId]);

  const localDeckSize = getDeckSize(gameSettings?.jokerCount ?? 0);
  const cardStats = useMemo(() => {
    if (!gameState) return { total: 0, pct: 0 };
    const total = gameState.players.filter(p => !p.isEliminated).reduce((sum, p) => sum + p.cardCount, 0);
    return { total, pct: Math.round((total / localDeckSize) * 100) };
  }, [gameState, localDeckSize]);

  const cardCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!gameState) return counts;
    for (const p of gameState.players) counts[p.id] = p.cardCount;
    return counts;
  }, [gameState]);

  const handlePlayerClick = useCallback((player: Player) => {
    setSelectedPlayer(player);
  }, []);

  const quickDrawSuggestions = useMemo(() => {
    if (!quickDrawOpen || !canRaise || !gameState) return [];
    return getQuickDrawSuggestions(gameState.myCards, gameState.currentHand, tappedCard ?? undefined);
  }, [quickDrawOpen, canRaise, gameState, tappedCard]);

  // Tapping own cards: toggle Quick Draw chips (biased toward the tapped card)
  const handleCardTap = useCallback((card: Card) => {
    if (!quickDrawEnabled || !canRaise || !gameState) return;
    play('uiClick');
    const suggestions = getQuickDrawSuggestions(gameState.myCards, gameState.currentHand, card);
    if (suggestions.length === 0) {
      setHandSelectorOpen(true);
    } else {
      setTappedCard(card);
      setQuickDrawOpen(true);
    }
  }, [quickDrawEnabled, canRaise, play, gameState]);

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

  // Stable callback references so ActionButtons' React.memo isn't broken by
  // inline arrow functions creating new references on every render.
  const closeHandSelector = useCallback(() => setHandSelectorOpen(false), []);
  const openHandSelector = useCallback(() => { play('uiClick'); setHandSelectorOpen(true); }, [play]);
  const handleQuickDrawDismiss = useCallback(() => { setQuickDrawOpen(false); setTappedCard(null); }, []);

  // Close hand selector on tap outside — same pattern as ActionButtons
  useEffect(() => {
    if (!handSelectorOpen) return;
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
      // Keep open if tapping inside the hand selector, action area, or own cards
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
  useEffect(() => {
    setHandSelectorOpen(false);
    setQuickDrawOpen(false);
    setTappedCard(null);
  }, [isMyTurn, gameState?.roundPhase]);

  // Keyboard shortcuts (B=bull, T=true, C=raise/call, Esc=close, Enter=submit, P=pass)
  const showBull = isMyTurn && gameState !== null && gameState.currentHand !== null
    && (gameState.roundPhase === RoundPhase.CALLING || gameState.roundPhase === RoundPhase.BULL_PHASE);
  const showTrue = isMyTurn && gameState !== null && gameState.roundPhase === RoundPhase.BULL_PHASE;
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

  // --- Early return AFTER all hooks ---
  if (!gameState) {
    // Show countdown overlay while waiting for game to start
    if (countdown) {
      return (
        <Layout>
          <CountdownOverlay seconds={countdown.secondsLeft} label={countdown.label} />
        </Layout>
      );
    }
    return null;
  }

  const handleLeave = () => {
    if (window.confirm('Leave this game?')) {
      // Navigate first so the route change is committed before leaveRoom()
      // clears game state — prevents the "no gameState → /local" redirect
      // from racing and overriding the intended destination.
      navigate('/');
      leaveRoom();
    }
  };

  /* Landscape/desktop: merge game info into the Layout header bar */
  const pauseButton = togglePause ? (
    <button
      onClick={togglePause}
      className="text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors p-1"
      title={isPaused ? 'Resume game' : 'Pause game'}
      aria-label={isPaused ? 'Resume game' : 'Pause game'}
    >
      {isPaused ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="4" width="4" height="16" />
          <rect x="14" y="4" width="4" height="16" />
        </svg>
      )}
    </button>
  ) : null;

  const seriesInfo = gameState.seriesInfo;

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
        <span className="text-[var(--gold-dim)] font-mono text-xs" title={`${cardStats.total} of ${localDeckSize} cards in play`}>
          {cardStats.total}/{localDeckSize} ({cardStats.pct}%)
        </span>
      </div>
      <CallHistoryToggleButton
        count={gameState.turnHistory.length}
        isOpen={callHistoryOpen}
        onToggle={() => setCallHistoryOpen(v => !v)}
      />
    </div>
  );

  const headerRightExtra = (
    <>
      {pauseButton}
      {isEliminated && <InGameStats stats={inGameStats} players={gameState.players} myPlayerId={playerId} />}
      <button
        onClick={handleLeave}
        className="text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors text-xs min-h-[44px] min-w-[44px] flex items-center justify-center"
        title="Leave game"
      >
        Leave
      </button>
      <span className="font-mono tracking-wider text-[var(--gold-dim)] text-xs">LOCAL</span>
    </>
  );

  return (
    <Layout headerLeftExtra={headerLeftExtra} headerRightExtra={headerRightExtra} hideHeaderLandscape>
      {/* ── Roundtable layout (landscape/desktop) ── */}
      {isLandscape ? (
        <div className={`${isEliminated && !winnerId ? 'spectating' : ''}`}>
          {isEliminated && !winnerId && (
            <SpectatorPill isEliminated={true} />
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
            isSpectator={false}
            isLastChanceCaller={isLastChanceCaller}
            canRaise={canRaise}
            handSelectorOpen={handSelectorOpen}
            pendingValid={pendingValid}
            pendingHand={pendingHand}
            quickDrawOpen={quickDrawOpen}
            quickDrawEnabled={quickDrawEnabled}
            quickDrawSuggestions={quickDrawSuggestions}
            callHistoryVisible={callHistoryOpen}
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
          />

          {/* Overlays */}
          <GameTooltips gameActive={!roundResult && !roundTransition && !isPaused && !countdown} />
          {isAtMaxCards && <div className="max-cards-warning-glow" aria-hidden="true" />}
          {countdown && (
            <CountdownOverlay seconds={countdown.secondsLeft} label={countdown.label} />
          )}
          {roundTransition && !roundResult && !countdown && (
            <div className="fixed inset-0 flex items-center justify-center z-50"
                 style={{ background: 'var(--overlay)' }}>
              <div className="text-center space-y-3 animate-fade-in">
                <div className="w-8 h-8 border-2 border-[var(--gold)] border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-[var(--gold)] font-display text-lg font-semibold">
                  Next round starting&hellip;
                </p>
              </div>
            </div>
          )}
          {roundResult && !cinematicComplete && (
            <RoundtableRevealOverlay
              result={roundResult}
              orderedPlayers={orderedPlayersForReveal}
              playerCount={Math.min(gameState.players.length, 12)}
              myPlayerId={playerId ?? undefined}
              onComplete={markCinematicComplete}
              skipToEnd={cinematicStartedRef.current}
              onAnimationStart={() => { cinematicStartedRef.current = true; }}
            />
          )}
          {roundResult && cinematicComplete && (
            <RevealOverlay
              result={roundResult}
              players={gameState.players}
              myPlayerId={playerId ?? undefined}
              onDismiss={clearRoundResult}
              autoCountdown={false}
              startedAt={revealStartedAt}
            />
          )}
          {isPaused && !roundResult && (
            <div className="fixed inset-0 flex items-center justify-center z-40"
                 style={{ background: 'rgba(0, 0, 0, 0.6)' }}>
              <div className="text-center space-y-4 animate-fade-in">
                <p className="text-[var(--gold)] font-display text-2xl font-bold uppercase tracking-widest">
                  Paused
                </p>
                <button onClick={togglePause} className="btn-gold px-6 py-2 text-sm font-semibold">
                  Resume
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
      /* ── Portrait layout (existing) ── */
      <div className={`game-layout ${isEliminated && !winnerId ? 'spectating' : ''}`}>
        {/* Top bar */}
        <div className="game-top-bar flex justify-between items-center text-xs">
          <div className="flex items-center gap-3">
            <span className="text-[var(--gold-dim)] font-semibold uppercase tracking-wider">
              Round {gameState.roundNumber}
            </span>
            <span className="text-[var(--gold-dim)] font-mono" title={`${cardStats.total} of ${localDeckSize} cards in play`}>
              {cardStats.total}/{localDeckSize} ({cardStats.pct}%)
            </span>
          </div>
          <div className="flex items-center gap-3">
            {pauseButton}
            {isEliminated && <InGameStats stats={inGameStats} players={gameState.players} myPlayerId={playerId} />}
            <VolumeControl />
            <button
              onClick={handleLeave}
              className="text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors text-xs min-h-[44px] min-w-[44px] flex items-center justify-center"
              title="Leave game"
            >
              Leave
            </button>
            <span className="font-mono tracking-wider text-[var(--gold-dim)]">LOCAL</span>
          </div>
        </div>

        {/* Series banner — shows best-of info, set number, and series score */}
        {seriesInfo && seriesInfo.bestOf > 1 && (
          <SeriesBanner seriesInfo={seriesInfo} players={gameState.players} playerId={playerId} />
        )}

        {/* Floating spectator pill */}
        {isEliminated && !winnerId && (
          <SpectatorPill isEliminated={true} />
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
            {!isEliminated && <div data-tooltip="my-cards"><HandDisplay cards={gameState.myCards} large onCardTap={canRaise && quickDrawEnabled ? handleCardTap : undefined} /></div>}

            {/* Quick Draw first-use hint */}
            {!isEliminated && quickDrawEnabled && !quickDrawOpen && (
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

            {/* Spectator view — eliminated players see all cards */}
            {isEliminated && gameState.spectatorCards && (
              <SpectatorView spectatorCards={gameState.spectatorCards} currentPlayerId={gameState.currentPlayerId} />
            )}

            {/* Call history */}
            <div data-tooltip="call-history">
              <CallHistory history={gameState.turnHistory} cardCounts={cardCounts} />
            </div>

            {/* Action row — BULL/TRUE on left, Raise/Call on right */}
            {!isEliminated && (
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
        <GameTooltips gameActive={!roundResult && !roundTransition && !isPaused && !countdown} />

        {/* Max cards warning */}
        {isAtMaxCards && (
          <div className="max-cards-warning-glow" aria-hidden="true" />
        )}

        {/* Game countdown overlay (initial start or Bo3/Bo5 set transition) */}
        {countdown && (
          <CountdownOverlay seconds={countdown.secondsLeft} label={countdown.label} />
        )}

        {/* Round transition overlay */}
        {roundTransition && !roundResult && !countdown && (
          <div className="fixed inset-0 flex items-center justify-center z-50"
               style={{ background: 'var(--overlay)' }}>
            <div className="text-center space-y-3 animate-fade-in">
              <div className="w-8 h-8 border-2 border-[var(--gold)] border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-[var(--gold)] font-display text-lg font-semibold">
                Next round starting&hellip;
              </p>
            </div>
          </div>
        )}

        {/* Round result overlay */}
        {roundResult && (
          <RevealOverlay
            result={roundResult}
            players={gameState.players}
            myPlayerId={playerId ?? undefined}
            onDismiss={clearRoundResult}
            autoCountdown={false}
            startedAt={revealStartedAt}
          />
        )}

        {/* Pause overlay */}
        {isPaused && !roundResult && (
          <div className="fixed inset-0 flex items-center justify-center z-40"
               style={{ background: 'rgba(0, 0, 0, 0.6)' }}>
            <div className="text-center space-y-4 animate-fade-in">
              <p className="text-[var(--gold)] font-display text-2xl font-bold uppercase tracking-widest">
                Paused
              </p>
              <button
                onClick={togglePause}
                className="btn-gold px-6 py-2 text-sm font-semibold"
              >
                Resume
              </button>
            </div>
          </div>
        )}
      </div>
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
