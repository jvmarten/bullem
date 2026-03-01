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
import { useGameContext } from '../context/GameContext.js';
import { useSound, useGameSounds } from '../hooks/useSound.js';
import { handToString } from '@bull-em/shared';
import { useEffect } from 'react';

export function GamePage() {
  const { roomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const {
    gameState, roundResult, roundTransition, winnerId, playerId,
    callHand, callBull, callTrue, lastChanceRaise, lastChancePass,
    clearRoundResult, leaveRoom,
  } = useGameContext();
  const { muted, toggleMute } = useSound();
  useGameSounds(gameState, roundResult, winnerId, playerId);

  useEffect(() => {
    if (winnerId) navigate(`/results/${roomCode}`);
  }, [winnerId, roomCode, navigate]);

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
  const isMyTurn = gameState.currentPlayerId === playerId && !isEliminated;
  const isLastChanceCaller = gameState.roundPhase === RoundPhase.LAST_CHANCE
    && gameState.lastCallerId === playerId;

  const canCallHand = isMyTurn && (
    gameState.roundPhase === RoundPhase.CALLING
    || gameState.roundPhase === RoundPhase.BULL_PHASE
  );

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
            <button
              onClick={toggleMute}
              className="text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors p-1"
              title={muted ? 'Unmute sounds' : 'Mute sounds'}
              aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
            >
              {muted ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
              )}
            </button>
            <span className="font-mono tracking-wider text-[var(--gold-dim)]">{roomCode}</span>
            <button
              onClick={handleLeave}
              className="text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors text-xs"
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
        />

        <PlayerList
          players={gameState.players}
          currentPlayerId={gameState.currentPlayerId}
          myPlayerId={playerId}
          maxCards={gameState.maxCards}
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
          </div>
        )}

        {/* My cards */}
        {!isEliminated && <HandDisplay cards={gameState.myCards} large />}

        {/* Spectator view — eliminated players see all cards */}
        {isEliminated && gameState.spectatorCards && (
          <SpectatorView spectatorCards={gameState.spectatorCards} />
        )}

        <CallHistory history={gameState.turnHistory} />

        {/* Action buttons */}
        {!isEliminated && (
          <ActionButtons
            roundPhase={gameState.roundPhase}
            isMyTurn={isMyTurn}
            hasCurrentHand={gameState.currentHand !== null}
            isLastChanceCaller={isLastChanceCaller}
            onBull={callBull}
            onTrue={callTrue}
            onLastChancePass={lastChancePass}
          />
        )}

        {/* Hand selector for calling */}
        {canCallHand && (
          <HandSelector
            currentHand={gameState.currentHand}
            onSubmit={callHand}
          />
        )}

        {/* Hand selector for last chance raise */}
        {isLastChanceCaller && (
          <HandSelector
            currentHand={gameState.currentHand}
            onSubmit={lastChanceRaise}
          />
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
      </div>
    </Layout>
  );
}
