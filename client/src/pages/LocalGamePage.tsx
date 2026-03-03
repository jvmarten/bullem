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
import { VolumeControl } from '../components/VolumeControl.js';
import { useGameContext } from '../context/GameContext.js';
import { useGameSounds } from '../hooks/useSound.js';
import { useEffect, useState } from 'react';

export function LocalGamePage() {
  const navigate = useNavigate();
  const {
    gameState, roundResult, roundTransition, winnerId, playerId,
    callHand, callBull, callTrue, lastChanceRaise, lastChancePass,
    clearRoundResult, leaveRoom, isPaused, togglePause,
  } = useGameContext();
  useGameSounds(gameState, roundResult, winnerId, playerId);

  // Defer navigation to results if a round result overlay is still showing
  useEffect(() => {
    if (winnerId && !roundResult) navigate('/local/results');
  }, [winnerId, roundResult, navigate]);

  const handleLeave = () => {
    if (window.confirm('Leave this game?')) {
      leaveRoom();
      navigate('/');
    }
  };

  // Local games are in-memory only — if gameState is null (e.g. page refresh),
  // redirect back to the lobby instead of showing a loading spinner forever.
  useEffect(() => {
    if (!gameState) navigate('/local');
  }, [gameState, navigate]);

  if (!gameState) return null;

  const myPlayer = gameState.players.find(p => p.id === playerId);
  const isEliminated = myPlayer?.isEliminated ?? false;
  const isMyTurn = gameState.currentPlayerId === playerId && !isEliminated;
  const isLastChanceCaller = gameState.roundPhase === RoundPhase.LAST_CHANCE
    && gameState.lastCallerId === playerId;

  const canCallHand = isMyTurn && (
    gameState.roundPhase === RoundPhase.CALLING
    || gameState.roundPhase === RoundPhase.BULL_PHASE
  );

  const canRaise = canCallHand || isLastChanceCaller;
  const [handSelectorOpen, setHandSelectorOpen] = useState(false);

  // Close hand selector when turn changes
  useEffect(() => {
    setHandSelectorOpen(false);
  }, [isMyTurn, gameState.roundPhase]);

  return (
    <Layout>
      <div className={`space-y-2 ${isEliminated ? 'spectating' : ''}`}>
        {/* Top bar */}
        <div className="flex justify-between items-center text-xs">
          <div className="flex items-center gap-3">
            <span className="text-[var(--gold-dim)] font-semibold uppercase tracking-wider">
              Round {gameState.roundNumber}
            </span>
            {(() => {
              const total = gameState.players.filter(p => !p.isEliminated).reduce((sum, p) => sum + p.cardCount, 0);
              const pct = Math.round((total / 52) * 100);
              return (
                <span className="text-[var(--gold-dim)] font-mono" title={`${total} of 52 cards in play`}>
                  {total}/52 cards ({pct}%)
                </span>
              );
            })()}
          </div>
          <div className="flex items-center gap-3">
            {togglePause && (
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
            )}
            <VolumeControl />
            <span className="font-mono tracking-wider text-[var(--gold-dim)]">LOCAL</span>
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
        {isEliminated && (
          <div className="text-center glass p-2 animate-fade-in">
            <p className="text-[var(--gold-dim)] text-xs font-semibold uppercase tracking-widest">
              Spectating
            </p>
          </div>
        )}

        <TurnIndicator
          currentPlayerId={gameState.currentPlayerId}
          roundPhase={gameState.roundPhase}
          players={gameState.players}
          myPlayerId={playerId}
          turnDeadline={gameState.turnDeadline}
          hasCurrentHand={gameState.currentHand !== null}
        />

        <PlayerList
          players={gameState.players}
          currentPlayerId={gameState.currentPlayerId}
          myPlayerId={playerId}
          maxCards={gameState.maxCards}
          roundNumber={gameState.roundNumber}
          turnHistory={gameState.turnHistory}
          collapsible
        />

        {/* Current call display */}
        {gameState.currentHand && (
          <div className="text-center glass-raised px-3 py-1.5 animate-slide-up">
            <span className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mr-2">
              Current Call
            </span>
            <span className="font-display text-base font-bold text-[var(--gold)]">
              {handToString(gameState.currentHand)}
            </span>
            {gameState.lastCallerId && (
              <span className="text-[8px] text-[var(--gold-dim)] opacity-50 ml-1.5">
                {gameState.players.find(p => p.id === gameState.lastCallerId)?.name ?? '?'}
              </span>
            )}
          </div>
        )}

        {/* My cards */}
        {!isEliminated && <HandDisplay cards={gameState.myCards} large />}

        {/* Spectator view — eliminated players see all cards */}
        {isEliminated && gameState.spectatorCards && (
          <SpectatorView spectatorCards={gameState.spectatorCards} />
        )}

        <CallHistory history={gameState.turnHistory} />

        {/* Hand selector — opens above the action row */}
        {canRaise && handSelectorOpen && (
          <HandSelector
            currentHand={gameState.currentHand}
            onSubmit={(hand) => {
              if (isLastChanceCaller) {
                lastChanceRaise(hand);
              } else {
                callHand(hand);
              }
              setHandSelectorOpen(false);
            }}
            submitLabel={gameState.currentHand ? 'Raise' : 'Call'}
          />
        )}

        {/* Action row — BULL/TRUE on left, Raise/Call on right */}
        {!isEliminated && (
          <div className="flex justify-between items-start">
            <ActionButtons
              roundPhase={gameState.roundPhase}
              isMyTurn={isMyTurn}
              hasCurrentHand={gameState.currentHand !== null}
              isLastChanceCaller={isLastChanceCaller}
              onBull={callBull}
              onTrue={callTrue}
              onLastChancePass={lastChancePass}
              onExpand={() => setHandSelectorOpen(false)}
            />
            {canRaise && !handSelectorOpen && (
              <div className="flex justify-end animate-slide-up ml-auto">
                <button
                  onClick={() => setHandSelectorOpen(true)}
                  className="btn-ghost border-[var(--gold-dim)] px-6 py-2 text-base font-bold animate-pulse-glow min-w-[9rem]"
                >
                  {gameState.currentHand ? 'Raise' : 'Call'}
                </button>
              </div>
            )}
          </div>
        )}

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
