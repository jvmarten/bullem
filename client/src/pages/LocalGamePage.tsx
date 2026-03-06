import { useNavigate } from 'react-router-dom';
import { RoundPhase, handToString } from '@bull-em/shared';
import { Layout } from '../components/Layout.js';
import { PlayerList } from '../components/PlayerList.js';
import { HandDisplay } from '../components/HandDisplay.js';
import { HandSelector } from '../components/HandSelector.js';
import { ActionButtons } from '../components/ActionButtons.js';
import { TurnIndicator } from '../components/TurnIndicator.js';
import { CallHistory } from '../components/CallHistory.js';
import { RevealOverlay } from '../components/RevealOverlay.js';
import { SpectatorView } from '../components/SpectatorView.js';
import { GameTooltips } from '../components/GameTooltips.js';

import { useGameContext } from '../context/GameContext.js';
import { useToast } from '../context/ToastContext.js';
import { useErrorToast } from '../hooks/useErrorToast.js';
import { useSound, useGameSounds } from '../hooks/useSound.js';
import { useNavigationGuard } from '../hooks/useNavigationGuard.js';
import { useGameKeyboardShortcuts } from '../hooks/useGameKeyboardShortcuts.js';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { HandCall } from '@bull-em/shared';
import { getMinimumRaise } from '@bull-em/shared';

export function LocalGamePage() {
  const navigate = useNavigate();
  const {
    gameState, roundResult, roundTransition, winnerId, playerId,
    callHand, callBull, callTrue, lastChanceRaise, lastChancePass,
    clearRoundResult, leaveRoom, isPaused, togglePause, error, clearError,
  } = useGameContext();
  useErrorToast(error, clearError);
  const { play } = useSound();
  useGameSounds(gameState, roundResult, winnerId, playerId);

  // Defer navigation to results if a round result overlay is still showing
  useEffect(() => {
    if (winnerId && !roundResult) navigate('/local/results');
  }, [winnerId, roundResult, navigate]);

  // Prevent accidental tab close / refresh during an active game
  useNavigationGuard(!!gameState && !winnerId);

  const handleLeave = () => {
    if (window.confirm('Leave this game?')) {
      leaveRoom();
      navigate('/');
    }
  };

  // If gameState is null, there's no active local game — redirect to the lobby.
  // Game state is restored synchronously in LocalGameProvider, so after a
  // browser refresh gameState is already set on the first render.
  useEffect(() => {
    if (!gameState) navigate('/local');
  }, [gameState, navigate]);

  if (!gameState) return null;

  const myPlayer = gameState.players.find(p => p.id === playerId);
  const isEliminated = myPlayer?.isEliminated ?? false;
  const isMyTurn = gameState.currentPlayerId === playerId && !isEliminated;

  // Show a one-time prominent notification when the player gets eliminated
  const { addToast } = useToast();
  const wasEliminatedRef = useRef(isEliminated);
  useEffect(() => {
    if (isEliminated && !wasEliminatedRef.current) {
      addToast("You've been eliminated! You're now spectating.", 'info');
    }
    wasEliminatedRef.current = isEliminated;
  }, [isEliminated, addToast]);

  // Show a toast for every player eliminated this round (including other players).
  // Fires when roundResult arrives so the notification coincides with the reveal overlay.
  const lastResultRef = useRef(roundResult);
  useEffect(() => {
    if (roundResult && roundResult !== lastResultRef.current) {
      for (const eliminatedId of roundResult.eliminatedPlayerIds) {
        if (eliminatedId === playerId) continue; // already handled above
        const name = gameState.players.find(p => p.id === eliminatedId)?.name ?? 'A player';
        addToast(`${name} has been eliminated!`, 'info');
      }
    }
    lastResultRef.current = roundResult;
  }, [roundResult, playerId, gameState.players, addToast]);

  const cardStats = useMemo(() => {
    const total = gameState.players.filter(p => !p.isEliminated).reduce((sum, p) => sum + p.cardCount, 0);
    return { total, pct: Math.round((total / 52) * 100) };
  }, [gameState.players]);

  const cardCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of gameState.players) counts[p.id] = p.cardCount;
    return counts;
  }, [gameState.players]);
  const isLastChanceCaller = gameState.roundPhase === RoundPhase.LAST_CHANCE
    && gameState.lastCallerId === playerId;

  const canCallHand = isMyTurn && (
    gameState.roundPhase === RoundPhase.CALLING
    || gameState.roundPhase === RoundPhase.BULL_PHASE
  );

  const canRaise = canCallHand || isLastChanceCaller;
  const [handSelectorOpen, setHandSelectorOpen] = useState(false);
  const [pendingHand, setPendingHand] = useState<HandCall | null>(null);
  const [pendingValid, setPendingValid] = useState(false);

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

  // Quick raise — immediately submit the minimum valid raise
  const handleQuickRaise = useCallback(() => {
    const current = gameState.currentHand;
    if (!current) return;
    const minRaise = getMinimumRaise(current);
    if (!minRaise) return;
    if (isLastChanceCaller) {
      lastChanceRaise(minRaise);
    } else {
      callHand(minRaise);
    }
    setHandSelectorOpen(false);
  }, [gameState.currentHand, isLastChanceCaller, lastChanceRaise, callHand]);

  // Stable callback reference so ActionButtons' React.memo isn't broken by
  // an inline arrow function creating a new reference on every render.
  const closeHandSelector = useCallback(() => setHandSelectorOpen(false), []);

  // Close hand selector when turn changes
  useEffect(() => {
    setHandSelectorOpen(false);
  }, [isMyTurn, gameState.roundPhase]);

  // Keyboard shortcuts (B=bull, T=true, R=raise, Esc=close, Enter=submit, P=pass)
  const showBull = isMyTurn && gameState.currentHand !== null
    && (gameState.roundPhase === RoundPhase.CALLING || gameState.roundPhase === RoundPhase.BULL_PHASE);
  const showTrue = isMyTurn && gameState.roundPhase === RoundPhase.BULL_PHASE;
  const showPass = isMyTurn && isLastChanceCaller;
  const overlayActive = !!roundResult || !!roundTransition;

  useGameKeyboardShortcuts({
    onBull: showBull ? () => { play('bullCalled'); callBull(); } : null,
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

  const headerLeftExtra = (
    <>
      <span className="text-[var(--gold-dim)] font-semibold uppercase tracking-wider text-xs">
        Round {gameState.roundNumber}
      </span>
      <span className="text-[var(--gold-dim)] font-mono text-xs" title={`${cardStats.total} of 52 cards in play`}>
        {cardStats.total}/52 ({cardStats.pct}%)
      </span>
    </>
  );

  const headerRightExtra = (
    <>
      {pauseButton}
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
    <Layout headerLeftExtra={headerLeftExtra} headerRightExtra={headerRightExtra}>
      <div className={`game-layout ${isEliminated ? 'spectating' : ''}`}>
        {/* Top bar — portrait only (merged into header in landscape) */}
        <div className="game-top-bar portrait-only flex justify-between items-center text-xs">
          <div className="flex items-center gap-3">
            <span className="text-[var(--gold-dim)] font-semibold uppercase tracking-wider">
              Round {gameState.roundNumber}
            </span>
            <span className="text-[var(--gold-dim)] font-mono" title={`${cardStats.total} of 52 cards in play`}>
              {cardStats.total}/52 ({cardStats.pct}%)
            </span>
          </div>
          <div className="flex items-center gap-3">
            {pauseButton}
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

        {/* Spectator banner — uses spectator-banner class to escape .spectating dimming filter */}
        {isEliminated && (
          <div className="text-center glass p-2 animate-fade-in spectator-banner">
            <p className="text-xs font-semibold uppercase tracking-widest">
              <span className="text-[var(--gold-dim)]">Eliminated — </span><span className="text-[var(--gold)]">Spectating</span>
            </p>
          </div>
        )}

        <div className="game-content">
          {/* Sidebar — player list + call history (side column in landscape) */}
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
              />
            </div>
            {/* Call history in sidebar — landscape only */}
            <div className="landscape-only flex-col">
              <CallHistory history={gameState.turnHistory} cardCounts={cardCounts} />
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
                  <span className="text-[9px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold">
                    Current Call
                  </span>
                </div>
                <div className="flex-1 min-w-0 text-center">
                  <span className="font-display font-bold text-[var(--gold)] whitespace-nowrap" style={{ fontSize: 'clamp(0.85rem, 3.86vw, 1rem)' }}>
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
            {!isEliminated && <div data-tooltip="my-cards"><HandDisplay cards={gameState.myCards} large /></div>}

            {/* Spectator view — eliminated players see all cards */}
            {isEliminated && gameState.spectatorCards && (
              <SpectatorView spectatorCards={gameState.spectatorCards} />
            )}

            {/* Call history — portrait only (in sidebar for landscape) */}
            <div className="portrait-only" data-tooltip="call-history">
              <CallHistory history={gameState.turnHistory} cardCounts={cardCounts} />
            </div>

            {/* Action row — BULL/TRUE on left, Raise/Call on right */}
            {/* Placed BEFORE the hand selector so buttons never move when picker opens */}
            {!isEliminated && (
              <div className="flex justify-between items-start" data-tooltip="action-area">
                <ActionButtons
                  roundPhase={gameState.roundPhase}
                  isMyTurn={isMyTurn}
                  hasCurrentHand={gameState.currentHand !== null}
                  isLastChanceCaller={isLastChanceCaller}
                  onBull={callBull}
                  onTrue={callTrue}
                  onLastChancePass={lastChancePass}
                  onExpand={closeHandSelector}
                />
                {canRaise && !handSelectorOpen && (
                  <div className="flex justify-end animate-slide-up ml-auto action-btn-gap">
                    <button
                      onClick={() => { play('uiClick'); setHandSelectorOpen(true); }}
                      className="btn-ghost border-[var(--gold-dim)] py-2 font-bold animate-pulse-glow action-btn-primary kbd-shortcut"
                      data-kbd="R"
                    >
                      {gameState.currentHand ? 'Raise' : 'Call'}
                    </button>
                  </div>
                )}
                {canRaise && handSelectorOpen && (
                  <div className="flex items-start ml-auto action-btn-gap">
                    {gameState.currentHand && getMinimumRaise(gameState.currentHand) && (
                      <button
                        onClick={handleQuickRaise}
                        className="btn-amber font-semibold leading-tight self-center text-center"
                        style={{ fontSize: 'clamp(9px, 2.4vw, 10px)', padding: 'clamp(3px, 0.8vw, 4px) clamp(6px, 1.6vw, 8px)' }}
                        title="Auto-raise to the minimum valid hand"
                      >
                        min<br />raise
                      </button>
                    )}
                    <div className="flex flex-col items-center">
                      <button
                        onClick={handleHandSubmit}
                        disabled={!pendingValid}
                        className={`btn-gold py-2 font-bold action-btn-primary ${pendingValid ? 'hs-call-pulse' : ''}`}
                      >
                        {gameState.currentHand ? 'Raise' : 'Call'}
                      </button>
                      <p className={`text-[var(--danger)] mt-1 h-4 transition-opacity action-btn-hint ${pendingHand && !pendingValid ? 'opacity-100' : 'opacity-0'}`}>Must be higher</p>
                    </div>
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
        <GameTooltips gameActive={!roundResult && !roundTransition && !isPaused} />

        {/* Round transition overlay */}
        {roundTransition && !roundResult && (
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
            onDismiss={clearRoundResult}
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
    </Layout>
  );
}
