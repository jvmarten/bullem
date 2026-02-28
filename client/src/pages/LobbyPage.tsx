import { useParams, useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { PlayerList } from '../components/PlayerList.js';
import { useGameContext } from '../context/GameContext.js';
import { GamePhase, MIN_PLAYERS } from '@bull-em/shared';
import { useEffect, useState, useRef } from 'react';

export function LobbyPage() {
  const { roomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const { roomState, gameState, playerId, startGame, joinRoom, leaveRoom, error } = useGameContext();
  const [copied, setCopied] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinName, setJoinName] = useState('');
  const [localError, setLocalError] = useState('');
  const joinAttemptedRef = useRef(false);

  // Navigate to game when it starts
  useEffect(() => {
    if (gameState && roomState?.gamePhase === GamePhase.PLAYING) {
      navigate(`/game/${roomCode}`);
    }
  }, [gameState, roomState?.gamePhase, roomCode, navigate]);

  // Auto-join room when navigating directly to /room/:roomCode
  useEffect(() => {
    if (roomState || !roomCode || joining || joinAttemptedRef.current) return;
    const storedName = sessionStorage.getItem('bull-em-player-name');
    if (storedName) {
      joinAttemptedRef.current = true;
      setJoining(true);
      joinRoom(roomCode, storedName)
        .catch((e) => {
          setLocalError(e instanceof Error ? e.message : 'Failed to join room');
          setTimeout(() => navigate('/'), 3000);
        })
        .finally(() => setJoining(false));
    }
  }, [roomState, roomCode, joining, joinRoom, navigate]);

  const handleManualJoin = async () => {
    if (!joinName.trim() || !roomCode) return;
    setJoining(true);
    setLocalError('');
    try {
      await joinRoom(roomCode, joinName.trim());
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Failed to join room');
    } finally {
      setJoining(false);
    }
  };

  const handleStartGame = () => {
    if (!roomState) return;
    if (roomState.players.length < MIN_PLAYERS) {
      setLocalError(`Need at least ${MIN_PLAYERS} players to start the game`);
      return;
    }
    startGame();
  };

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

  const displayError = localError || error;

  // Show name input for direct URL visitors who have no stored name
  if (!roomState && !joining && !joinAttemptedRef.current && !sessionStorage.getItem('bull-em-player-name')) {
    return (
      <Layout>
        <div className="flex items-center justify-center pt-16">
          <div className="text-center space-y-4 w-full max-w-xs">
            <h2 className="text-xl font-bold text-green-300">Join Room {roomCode}</h2>
            {displayError && (
              <div className="bg-red-900/50 border border-red-600 rounded-lg px-4 py-2 text-sm text-red-200">
                {displayError}
              </div>
            )}
            <input
              type="text"
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleManualJoin()}
              placeholder="Enter your name"
              maxLength={20}
              className="w-full px-4 py-3 bg-green-800/50 border border-green-600 rounded-lg text-green-100 placeholder-green-500 focus:outline-none focus:border-yellow-400"
            />
            <button
              onClick={handleManualJoin}
              disabled={!joinName.trim() || joining}
              className="w-full py-3 bg-yellow-500 hover:bg-yellow-400 text-gray-900 rounded-lg font-bold text-lg transition-all duration-150 active:scale-[0.98] disabled:bg-gray-600 disabled:text-gray-400 disabled:cursor-not-allowed"
            >
              {joining ? 'Joining...' : 'Join'}
            </button>
            <button
              onClick={() => navigate('/')}
              className="text-green-400 hover:text-white text-sm transition-colors"
            >
              Back to Home
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  if (!roomState) {
    return (
      <Layout>
        <div className="flex items-center justify-center pt-16">
          <div className="text-center space-y-3">
            <div className="w-8 h-8 border-2 border-green-400 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-green-300">
              {joining ? 'Joining room...' : `Connecting to room ${roomCode}...`}
            </p>
            {displayError && (
              <p className="text-red-300 text-sm">{displayError}</p>
            )}
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

        {displayError && (
          <div className="bg-red-900/50 border border-red-600 rounded-lg px-4 py-2 text-sm text-red-200 animate-fade-in">
            {displayError}
          </div>
        )}

        <PlayerList players={roomState.players} myPlayerId={playerId} />

        <div className="flex flex-col gap-3">
          {isHost && (
            <button
              onClick={handleStartGame}
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
