import { useParams, useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { PlayerList } from '../components/PlayerList.js';
import { useGameContext } from '../context/GameContext.js';
import { GamePhase, MIN_PLAYERS } from '@bull-em/shared';
import { useEffect, useState } from 'react';

export function LobbyPage() {
  const { roomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const { roomState, gameState, playerId, startGame, leaveRoom, error } = useGameContext();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (gameState && roomState?.gamePhase === GamePhase.PLAYING) {
      navigate(`/game/${roomCode}`);
    }
  }, [gameState, roomState?.gamePhase, roomCode, navigate]);

  const copyRoomCode = async () => {
    if (!roomState) return;
    try {
      await navigator.clipboard.writeText(roomState.roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may not be available
    }
  };

  if (!roomState) {
    return (
      <Layout>
        <div className="flex items-center justify-center pt-16">
          <div className="text-center space-y-3">
            <div className="w-8 h-8 border-2 border-green-400 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-green-300">Connecting to room {roomCode}...</p>
          </div>
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
          <button
            onClick={copyRoomCode}
            className="text-4xl font-bold tracking-[0.3em] hover:text-yellow-300 transition-colors cursor-pointer"
            title="Click to copy"
          >
            {roomState.roomCode}
          </button>
          <p className="text-sm text-green-400 mt-1">
            {copied ? (
              <span className="text-yellow-300">Copied!</span>
            ) : (
              <>
                {roomState.players.length} player{roomState.players.length !== 1 ? 's' : ''} in lobby
                {' · '}
                <span className="text-green-500 cursor-pointer hover:text-green-300" onClick={copyRoomCode}>
                  tap code to copy
                </span>
              </>
            )}
          </p>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-600 rounded-lg px-4 py-2 text-sm text-red-200 animate-fade-in">
            {error}
          </div>
        )}

        <PlayerList players={roomState.players} myPlayerId={playerId} />

        <div className="flex flex-col gap-3">
          {isHost && (
            <button
              onClick={startGame}
              disabled={!canStart}
              className={`w-full py-3 rounded-lg font-bold text-lg transition-all duration-150 ${
                canStart
                  ? 'bg-yellow-500 hover:bg-yellow-400 text-gray-900 active:scale-[0.98]'
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
