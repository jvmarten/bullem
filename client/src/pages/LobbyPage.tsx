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
          <div className="text-center space-y-4 w-full max-w-xs animate-fade-in">
            <h2 className="font-display text-2xl font-bold text-[var(--gold)]">
              Join Room {roomCode}
            </h2>
            {displayError && (
              <div className="glass px-4 py-2.5 text-sm text-[var(--danger)] border-[var(--danger)] animate-shake">
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
              autoFocus
              className="w-full input-felt"
            />
            <button
              onClick={handleManualJoin}
              disabled={!joinName.trim() || joining}
              className="w-full btn-gold py-3 text-lg"
            >
              {joining ? 'Joining\u2026' : 'Join'}
            </button>
            <button
              onClick={() => navigate('/')}
              className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-sm transition-colors"
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
          <div className="text-center space-y-3 animate-fade-in">
            <div className="w-8 h-8 border-2 border-[var(--gold)] border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-[var(--gold-dim)]">
              {joining ? 'Joining room\u2026' : `Connecting to room ${roomCode}\u2026`}
            </p>
            {displayError && (
              <p className="text-[var(--danger)] text-sm">{displayError}</p>
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
      <div className="space-y-6 pt-4 animate-fade-in">
        {/* Room code display */}
        <div className="text-center">
          <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-1">
            Room Code
          </p>
          <button
            onClick={copyRoomCode}
            className="font-display text-5xl font-bold tracking-[0.3em] text-[var(--gold)] hover:text-[var(--gold-light)] transition-colors cursor-pointer"
            title="Click to copy"
          >
            {roomState.roomCode}
          </button>
          <p className="text-sm text-[var(--gold-dim)] mt-1.5">
            {copied ? (
              <span className="text-[var(--gold-light)] animate-fade-in">Copied!</span>
            ) : (
              <>
                {roomState.players.length} player{roomState.players.length !== 1 ? 's' : ''} in lobby
                {' \u00b7 '}
                <span className="cursor-pointer hover:text-[var(--gold)] transition-colors" onClick={copyRoomCode}>
                  tap code to copy
                </span>
              </>
            )}
          </p>
        </div>

        {displayError && (
          <div className="glass px-4 py-2.5 text-sm text-[var(--danger)] border-[var(--danger)] animate-shake">
            {displayError}
          </div>
        )}

        <PlayerList players={roomState.players} myPlayerId={playerId} />

        <div className="flex flex-col gap-3">
          {isHost && (
            <button
              onClick={handleStartGame}
              disabled={!canStart}
              className="w-full btn-gold py-3 text-lg"
            >
              {canStart ? 'Start Game' : `Need ${MIN_PLAYERS}+ Players`}
            </button>
          )}
          {!isHost && (
            <p className="text-center text-[var(--gold-dim)] text-sm">
              Waiting for host to start&hellip;
            </p>
          )}
          <button
            onClick={() => { leaveRoom(); navigate('/'); }}
            className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-sm transition-colors text-center"
          >
            Leave Room
          </button>
        </div>
      </div>
    </Layout>
  );
}
