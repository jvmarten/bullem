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
            <div className="w-8 h-8 border-2 border-green-400 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-green-300">Loading game...</p>
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
      <div className="space-y-4">
        <div className="flex justify-between items-center text-sm text-green-400">
          <span>Round {gameState.roundNumber}</span>
          <span className="font-mono tracking-wider">{roomCode}</span>
        </div>

        {isEliminated && (
          <div className="text-center bg-gray-800/60 border border-gray-600 rounded-lg p-3 animate-fade-in">
            <p className="text-sm font-bold uppercase tracking-wider text-gray-300">Spectating</p>
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

        {gameState.currentHand && (
          <div className="text-center bg-green-800/50 rounded-lg p-3 animate-slide-up">
            <p className="text-xs text-green-400">Current Call</p>
            <p className="text-lg font-bold text-yellow-300">
              {handToString(gameState.currentHand)}
            </p>
          </div>
        )}

        {!isEliminated && <HandDisplay cards={gameState.myCards} />}

        <CallHistory history={gameState.turnHistory} />

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

        {canCallHand && (
          <HandSelector
            currentHand={gameState.currentHand}
            onSubmit={callHand}
          />
        )}

        {isLastChanceCaller && (
          <HandSelector
            currentHand={gameState.currentHand}
            onSubmit={lastChanceRaise}
          />
        )}

        {roundTransition && !roundResult && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <div className="text-center space-y-3 animate-fade-in">
              <div className="w-8 h-8 border-2 border-green-400 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-green-300 text-lg font-bold">Next round starting...</p>
            </div>
          </div>
        )}

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
