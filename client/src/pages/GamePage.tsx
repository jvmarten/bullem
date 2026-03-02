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
import { VolumeControl } from '../components/VolumeControl.js';
import { useGameContext } from '../context/GameContext.js';
import { useGameSounds } from '../hooks/useSound.js';
import { handToString } from '@bull-em/shared';
import { useEffect, useRef } from 'react';

export function GamePage() {
  const { roomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const {
    gameState, roomState, roundResult, roundTransition, winnerId, playerId,
    callHand, callBull, callTrue, lastChanceRaise, lastChancePass,
    clearRoundResult, leaveRoom, joinRoom,
  } = useGameContext();
  useGameSounds(gameState, roundResult, winnerId, playerId);

  const rejoinAttemptedRef = useRef(false);

  useEffect(() => {
    if (winnerId) navigate(`/results/${roomCode}`);
  }, [winnerId, roomCode, navigate]);

  useEffect(() => {
    if (gameState || !roomCode || rejoinAttemptedRef.current) return;
    const storedName = sessionStorage.getItem('bull-em-player-name') || localStorage.getItem('bull-em-player-name');
    if (!storedName) return;
    rejoinAttemptedRef.current = true;
    joinRoom(roomCode, storedName).catch(() => {
      // If rejoin fails, send user home instead of trapping in loading state.
      navigate('/');
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
  const isMyTurn = gameState.currentPlayerId === playerId && !isEliminated;
  const isLastChanceCaller = gameState.roundPhase === RoundPhase.LAST_CHANCE
    && gameState.lastCallerId === playerId;

  const canCallHand = isMyTurn && (
    gameState.roundPhase === RoundPhase.CALLING
    || gameState.roundPhase === RoundPhase.BULL_PHASE
  );

  return (
    <Layout>
      <div className={`space-y-2 ${isEliminated ? 'spectating' : ''} max-w-5xl mx-auto`}>
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
            <VolumeControl />
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
          hasCurrentHand={gameState.currentHand !== null}
        />

        <div className="lg:grid lg:grid-cols-2 lg:gap-4">
          <PlayerList
            players={gameState.players}
            currentPlayerId={gameState.currentPlayerId}
            myPlayerId={playerId}
            maxCards={gameState.maxCards}
            roundNumber={gameState.roundNumber}
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
        </div>

        {/* Action buttons */}
        <div className="lg:max-w-xl lg:mx-auto">
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
        </div>

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
