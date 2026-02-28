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
    gameState, roundResult, winnerId, playerId,
    callHand, callBull, callTrue, lastChanceRaise, lastChancePass,
    clearRoundResult,
  } = useGameContext();

  useEffect(() => {
    if (winnerId) navigate(`/results/${roomCode}`);
  }, [winnerId, roomCode, navigate]);

  if (!gameState) {
    return (
      <Layout>
        <p className="text-center pt-8 text-green-300">Loading game...</p>
      </Layout>
    );
  }

  const isMyTurn = gameState.currentPlayerId === playerId;
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
          <span>{roomCode}</span>
        </div>

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
          <div className="text-center bg-green-800/50 rounded-lg p-3">
            <p className="text-xs text-green-400">Current Call</p>
            <p className="text-lg font-bold text-yellow-300">
              {handToString(gameState.currentHand)}
            </p>
          </div>
        )}

        <HandDisplay cards={gameState.myCards} />

        <CallHistory history={gameState.turnHistory} />

        <ActionButtons
          roundPhase={gameState.roundPhase}
          isMyTurn={isMyTurn}
          hasCurrentHand={gameState.currentHand !== null}
          isLastChanceCaller={isLastChanceCaller}
          onBull={callBull}
          onTrue={callTrue}
          onLastChancePass={lastChancePass}
        />

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
