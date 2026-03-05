import { useNavigate, useParams } from 'react-router-dom';
import { RoundPhase } from '@bull-em/shared';
import { Layout } from '../components/Layout.js';
import { PlayerList } from '../components/PlayerList.js';
import { HandDisplay } from '../components/HandDisplay.js';
import { HandSelector } from '../components/HandSelector.js';
import { ActionButtons } from '../components/ActionButtons.js';
import { TurnIndicator } from '../components/TurnIndicator.js';
import { CallHistory } from '../components/CallHistory.js';
import { RevealOverlay } from '../components/RevealOverlay.js';
import { SpectatorView } from '../components/SpectatorView.js';
import { ShareButton } from '../components/ShareButton.js';
import { ReconnectOverlay } from '../components/ReconnectOverlay.js';
import { DisconnectBanner } from '../components/DisconnectBanner.js';

import { useGameContext } from '../context/GameContext.js';
import { useErrorToast } from '../hooks/useErrorToast.js';
import { useSound, useGameSounds } from '../hooks/useSound.js';
import { handToString } from '@bull-em/shared';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { HandCall } from '@bull-em/shared';
import { getMinimumRaise } from '@bull-em/shared';

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

export function GamePage() {
  const { roomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const {
    gameState, roomState, roundResult, roundTransition, roundTransitionDeadline, winnerId, playerId,
    callHand, callBull, callTrue, lastChanceRaise, lastChancePass,
    clearRoundResult, leaveRoom, joinRoom, error, clearError,
    isConnected, hasConnected, disconnectDeadlines,
  } = useGameContext();
  useErrorToast(error, clearError);
  const { play } = useSound();
  useGameSounds(gameState, roundResult, winnerId, playerId);

  const rejoinAttemptedRef = useRef(false);

  // Defer navigation to results if a round result overlay is still showing
  useEffect(() => {
    if (winnerId && !roundResult) navigate(`/results/${roomCode}`);
  }, [winnerId, roundResult, roomCode, navigate]);

  useEffect(() => {
    if (gameState || !roomCode || rejoinAttemptedRef.current) return;
    const storedName = sessionStorage.getItem('bull-em-player-name') || localStorage.getItem('bull-em-player-name');
    if (!storedName) {
      // No stored name means we can't rejoin — redirect home instead of
      // showing the loading spinner forever.
      navigate('/');
      return;
    }
    rejoinAttemptedRef.current = true;

    // Timeout: if the rejoin doesn't resolve within 8 seconds (socket buffering,
    // server unreachable, etc.), redirect home instead of trapping in loading state.
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        navigate('/');
      }
    }, 8000);

    joinRoom(roomCode, storedName)
      .then(() => { settled = true; clearTimeout(timeout); })
      .catch(() => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          navigate('/');
        }
      });
  }, [gameState, roomCode, joinRoom, navigate]);

  useEffect(() => {
    if (!gameState && roomState?.gamePhase === 'lobby' && roomCode) {
      navigate(`/room/${roomCode}`);
    }
  }, [gameState, roomState?.gamePhase, roomCode, navigate]);

  const handleLeave = () => {
    if (window.confirm('Leave this game? You will lose your spot.')) {
      leaveRoom();
      navigate('/');
    }
  };

  if (!gameState) {
    return (
      <Layout>
        <div className="flex items-center justify-center pt-16">
          <div className="text-center space-y-3">
            <div className="w-8 h-8 border-2 border-[var(--gold)] border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-[var(--gold-dim)]">Loading game&hellip;</p>
          </div>
        </div>
      </Layout>
    );
  }

  const myPlayer = gameState.players.find(p => p.id === playerId);
  const isEliminated = myPlayer?.isEliminated ?? false;
  const isSpectator = !myPlayer;
  const isMyTurn = gameState.currentPlayerId === playerId && !isEliminated && !isSpectator;

  const cardStats = useMemo(() => {
    const total = gameState.players.filter(p => !p.isEliminated).reduce((sum, p) => sum + p.cardCount, 0);
    return { total, pct: Math.round((total / 52) * 100) };
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
    play('callMade');
    if (isLastChanceCaller) {
      lastChanceRaise(minRaise);
    } else {
      callHand(minRaise);
    }
    setHandSelectorOpen(false);
  }, [gameState.currentHand, isLastChanceCaller, lastChanceRaise, callHand, play]);

  // Stable callback reference so ActionButtons' React.memo isn't broken by
  // an inline arrow function creating a new reference on every render.
  const closeHandSelector = useCallback(() => setHandSelectorOpen(false), []);

  // Close hand selector when turn changes
  useEffect(() => {
    setHandSelectorOpen(false);
  }, [isMyTurn, gameState.roundPhase]);

  /* Landscape/desktop: merge game info into the Layout header bar */
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
      <span className="font-mono tracking-wider text-[var(--gold-dim)] text-xs">{roomCode}</span>
      {roomCode && <ShareButton roomCode={roomCode} variant="compact" />}
      <button
        onClick={handleLeave}
        className="text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors text-xs min-h-[44px] min-w-[44px] flex items-center justify-center"
        title="Leave game"
      >
        Leave
      </button>
    </>
  );

  return (
    <Layout headerLeftExtra={headerLeftExtra} headerRightExtra={headerRightExtra}>
      <div className={`game-layout ${isEliminated || isSpectator ? 'spectating' : ''}`}>
        {/* Top bar — portrait only (merged into header in landscape) */}
        <div className="game-top-bar portrait-only flex justify-between items-center text-xs">
          <div className="flex items-center gap-3">
            <span className="text-[var(--gold-dim)] font-semibold uppercase tracking-wider">
              Round {gameState.roundNumber}
            </span>
            <span className="text-[var(--gold-dim)] font-mono" title={`${cardStats.total} of 52 cards in play`}>
              {cardStats.total}/52 cards ({cardStats.pct}%)
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono tracking-wider text-[var(--gold-dim)]">{roomCode}</span>
            {roomCode && <ShareButton roomCode={roomCode} variant="compact" />}
            <button
              onClick={handleLeave}
              className="text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors text-xs min-h-[44px] min-w-[44px] flex items-center justify-center"
              title="Leave game"
            >
              Leave
            </button>
          </div>
        </div>

        {/* Spectator banner */}
        {(isEliminated || isSpectator) && (
          <div className="text-center glass p-2 animate-fade-in">
            <p className="text-[var(--gold-dim)] text-xs font-semibold uppercase tracking-widest">
              Spectating
            </p>
          </div>
        )}

        <div className="game-content">
          {/* Sidebar — player list + call history (side column in landscape) */}
          <div className="game-sidebar">
            <PlayerList
              players={gameState.players}
              currentPlayerId={gameState.currentPlayerId}
              myPlayerId={playerId}
              maxCards={gameState.maxCards}
              roundNumber={gameState.roundNumber}
              turnHistory={gameState.turnHistory}
              collapsible
            />
            {/* Call history in sidebar — landscape only */}
            <div className="landscape-only flex-col">
              <CallHistory history={gameState.turnHistory} />
            </div>
          </div>

          {/* Main area — cards, actions, hand selector */}
          <div className="game-main">
            <TurnIndicator
              currentPlayerId={gameState.currentPlayerId}
              roundPhase={gameState.roundPhase}
              players={gameState.players}
              myPlayerId={playerId}
              turnDeadline={gameState.turnDeadline}
              hasCurrentHand={gameState.currentHand !== null}
            />

            {/* Disconnect countdown banners for other players */}
            <DisconnectBanner
              players={gameState.players}
              disconnectDeadlines={disconnectDeadlines}
            />

            {/* Current call display */}
            {gameState.currentHand && (
              <div className="glass-raised px-3 py-1.5 animate-slide-up flex items-baseline">
                <div className="w-1/4 min-w-0 shrink-0">
                  <span className="text-[9px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold">
                    Current Call
                  </span>
                </div>
                <div className="flex-1 min-w-0 text-center">
                  <span className="font-display text-base font-bold text-[var(--gold)] break-words">
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
            {!isEliminated && !isSpectator && <HandDisplay cards={gameState.myCards} large />}

            {/* Spectator view — eliminated players and external spectators see all cards */}
            {(isEliminated || isSpectator) && gameState.spectatorCards && (
              <SpectatorView spectatorCards={gameState.spectatorCards} />
            )}

            {/* Call history — portrait only (in sidebar for landscape) */}
            <div className="portrait-only">
              <CallHistory history={gameState.turnHistory} />
            </div>

            {/* Action row — BULL/TRUE on left, Raise/Call on right */}
            {/* Placed BEFORE the hand selector so buttons never move when picker opens */}
            {!isEliminated && !isSpectator && (
              <div className="flex justify-between items-start">
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
                  <div className="flex justify-end animate-slide-up ml-auto gap-2">
                    <button
                      onClick={() => { play('uiClick'); setHandSelectorOpen(true); }}
                      className="btn-ghost border-[var(--gold-dim)] px-6 py-2 text-base font-bold animate-pulse-glow min-w-[9rem]"
                    >
                      {gameState.currentHand ? 'Raise' : 'Call'}
                    </button>
                  </div>
                )}
                {canRaise && handSelectorOpen && (
                  <div className="flex gap-2 items-start ml-auto">
                    {gameState.currentHand && getMinimumRaise(gameState.currentHand) && (
                      <button
                        onClick={handleQuickRaise}
                        className="btn-amber px-2 py-1 font-semibold leading-tight self-center"
                        style={{ fontSize: '10px' }}
                        title="Auto-raise to the minimum valid hand"
                      >
                        min<br />raise
                      </button>
                    )}
                    <div className="flex flex-col items-center">
                      <button
                        onClick={handleHandSubmit}
                        disabled={!pendingValid}
                        className={`btn-gold px-6 py-2 text-base font-bold min-w-[9rem] ${pendingValid ? 'hs-call-pulse' : ''}`}
                      >
                        {gameState.currentHand ? 'Raise' : 'Call'}
                      </button>
                      <p className={`text-[10px] text-[var(--danger)] mt-1 h-4 transition-opacity ${pendingHand && !pendingValid ? 'opacity-100' : 'opacity-0'}`}>Must be higher</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Hand selector — appears below the action buttons so buttons stay put */}
            {canRaise && handSelectorOpen && (
              <div className="-mt-2">
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

        {/* Round transition overlay */}
        {roundTransition && !roundResult && (
          <TransitionOverlay deadline={roundTransitionDeadline} />
        )}

        {/* Round result overlay */}
        {roundResult && (
          <RevealOverlay
            result={roundResult}
            players={gameState.players}
            onDismiss={clearRoundResult}
          />
        )}

        {/* Reconnecting overlay — shown when own connection drops */}
        {!isConnected && hasConnected && <ReconnectOverlay />}
      </div>
    </Layout>
  );
}
