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
import { useGameContext } from '../context/GameContext.js';
import { handToString } from '@bull-em/shared';
import { useEffect } from 'react';

export function GamePage() {
  const { roomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const {
    gameState, roundResult, roundTransition, winnerId, playerId,
    callHand, callBull, callTrue, lastChanceRaise, lastChancePass,
    clearRoundResult,
  } = useGameContext();

  useEffect(() => {
    if (winnerId) navigate(`/results/${roomCode}`);
  }, [winnerId, roomCode, navigate]);

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
      <div className={`space-y-4 ${isEliminated ? 'spectating' : ''}`}>
        {/* Top bar */}
        <div className="flex justify-between items-center text-xs">
          <span className="text-[var(--gold-dim)] font-semibold uppercase tracking-wider">
            Round {gameState.roundNumber}
          </span>
          <span className="font-mono tracking-wider text-[var(--gold-dim)]">{roomCode}</span>
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
        />

        <PlayerList
          players={gameState.players}
          currentPlayerId={gameState.currentPlayerId}
          myPlayerId={playerId}
        />

        {/* Current call display */}
        {gameState.currentHand && (
          <div className="text-center glass-raised p-3 animate-slide-up">
            <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold">
              Current Call
            </p>
            <p className="font-display text-xl font-bold text-[var(--gold)] mt-1">
              {handToString(gameState.currentHand)}
            </p>
          </div>
        )}

        {/* My cards */}
        {!isEliminated && <HandDisplay cards={gameState.myCards} />}

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
