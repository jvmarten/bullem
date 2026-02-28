import { useParams, useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { PlayerList } from '../components/PlayerList.js';
import { useGameContext } from '../context/GameContext.js';
import { GamePhase, MIN_PLAYERS } from '@bull-em/shared';
import { useEffect } from 'react';

export function LobbyPage() {
  const { roomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const { roomState, gameState, playerId, startGame, leaveRoom, error } = useGameContext();

  useEffect(() => {
    if (gameState && roomState?.gamePhase === GamePhase.PLAYING) {
      navigate(`/game/${roomCode}`);
    }
  }, [gameState, roomState?.gamePhase, roomCode, navigate]);

  if (!roomState) {
    return (
      <Layout>
        <div className="text-center pt-8">
          <p className="text-green-300">Connecting to room {roomCode}...</p>
        </div>
      </Layout>
    );
  }

  const isHost = playerId === roomState.hostId;
  const canStart = isHost && roomState.players.length >= MIN_PLAYERS;

  return (
    <Layout>
      <div className="space-y-6 pt-4">
        <div className="text-center">
          <p className="text-sm text-green-400">Room Code</p>
          <p className="text-4xl font-bold tracking-[0.3em]">{roomState.roomCode}</p>
          <p className="text-sm text-green-400 mt-1">
            {roomState.players.length} player{roomState.players.length !== 1 ? 's' : ''} in lobby
          </p>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-600 rounded-lg px-4 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <PlayerList players={roomState.players} myPlayerId={playerId} />

        <div className="flex flex-col gap-3">
          {isHost && (
            <button
              onClick={startGame}
              disabled={!canStart}
              className={`w-full py-3 rounded-lg font-bold text-lg transition-colors ${
                canStart
                  ? 'bg-yellow-500 hover:bg-yellow-400 text-gray-900'
                  : 'bg-gray-600 text-gray-400 cursor-not-allowed'
              }`}
            >
              {canStart ? 'Start Game' : `Need ${MIN_PLAYERS}+ Players`}
            </button>
          )}
          {!isHost && (
            <p className="text-center text-green-300 text-sm">Waiting for host to start...</p>
          )}
          <button
            onClick={() => { leaveRoom(); navigate('/'); }}
            className="text-green-400 hover:text-white text-sm transition-colors text-center"
          >
            Leave Room
          </button>
        </div>
      </div>
    </Layout>
  );
}
