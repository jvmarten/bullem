import { useParams, useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { PlayerList } from '../components/PlayerList.js';
import { useGameContext } from '../context/GameContext.js';
import { GamePhase, MIN_PLAYERS, MAX_PLAYERS, MAX_CARDS, MIN_MAX_CARDS, ONLINE_TURN_TIMER_OPTIONS, maxPlayersForMaxCards } from '@bull-em/shared';
import { useEffect, useState, useRef } from 'react';

export function LobbyPage() {
  const { roomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const { roomState, gameState, playerId, startGame, joinRoom, leaveRoom, addBot, removeBot, error, updateSettings } = useGameContext();
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

  const copyInviteLink = async () => {
    if (!roomState) return;
    try {
      const url = `${window.location.origin}/room/${roomState.roomCode}`;
      await navigator.clipboard.writeText(url);
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
  const settings = roomState.settings;
  const maxCards = settings?.maxCards ?? MAX_CARDS;
  const turnTimer = settings?.turnTimer ?? 30;
  const dynamicMaxPlayers = Math.min(MAX_PLAYERS, maxPlayersForMaxCards(maxCards));
  const canStart = isHost && roomState.players.length >= MIN_PLAYERS;

  const handleMaxCardsChange = (newMax: number) => {
    if (roomState.players.length > Math.min(MAX_PLAYERS, maxPlayersForMaxCards(newMax))) {
      setLocalError(`Can't set max cards to ${newMax} with ${roomState.players.length} players`);
      return;
    }
    setLocalError('');
    updateSettings({ maxCards: newMax, turnTimer });
  };

  const handleTimerChange = (seconds: number) => {
    updateSettings({ maxCards, turnTimer: seconds });
  };

  return (
    <Layout>
      <div className="space-y-6 pt-4 animate-fade-in">
        {/* Room code display */}
        <div className="text-center">
          <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-1">
            Room Code
          </p>
          <button
            onClick={copyInviteLink}
            className="font-display text-5xl font-bold tracking-[0.3em] text-[var(--gold)] hover:text-[var(--gold-light)] transition-colors cursor-pointer"
            title="Click to copy"
          >
            {roomState.roomCode}
          </button>
          <p className="text-sm text-[var(--gold-dim)] mt-1.5">
            {copied ? (
              <span className="text-[var(--gold-light)] animate-fade-in">Invite link copied!</span>
            ) : (
              <>
                {roomState.players.length} player{roomState.players.length !== 1 ? 's' : ''} in lobby
                {' \u00b7 '}
                <span className="cursor-pointer hover:text-[var(--gold)] transition-colors" onClick={copyInviteLink}>
                  tap to copy invite link
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

        <PlayerList
          players={roomState.players}
          myPlayerId={playerId}
          maxCards={maxCards}
          showRemoveBot={isHost}
          onRemoveBot={removeBot}
        />

        {isHost && (
          <>
            <button
              onClick={() => addBot().catch(e => setLocalError(e instanceof Error ? e.message : 'Failed to add bot'))}
              disabled={roomState.players.length >= dynamicMaxPlayers}
              className="w-full glass px-4 py-2.5 text-sm text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors"
            >
              + Add Bot
            </button>

            {/* Max Cards setting */}
            <div className="glass px-4 py-3">
              <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">
                Max Cards
              </p>
              <div className="flex gap-1.5">
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    onClick={() => handleMaxCardsChange(n)}
                    className={`flex-1 px-2 py-2 text-sm rounded transition-colors ${
                      maxCards === n
                        ? 'bg-[var(--gold)] text-[var(--felt-dark)] font-semibold'
                        : 'glass text-[var(--gold-dim)] hover:text-[var(--gold)]'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-[var(--gold-dim)] mt-1.5">
                Eliminated after {maxCards + 1} cards &middot; Max {dynamicMaxPlayers} players
              </p>
            </div>

            {/* Turn Timer setting */}
            <div className="glass px-4 py-3">
              <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">
                Turn Timer
              </p>
              <div className="flex gap-1.5">
                {ONLINE_TURN_TIMER_OPTIONS.map(seconds => (
                  <button
                    key={seconds}
                    onClick={() => handleTimerChange(seconds)}
                    className={`flex-1 px-2 py-2 text-sm rounded transition-colors ${
                      turnTimer === seconds
                        ? 'bg-[var(--gold)] text-[var(--felt-dark)] font-semibold'
                        : 'glass text-[var(--gold-dim)] hover:text-[var(--gold)]'
                    }`}
                  >
                    {seconds}s
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {!isHost && settings && (
          <div className="glass px-4 py-3 text-center text-xs text-[var(--gold-dim)]">
            Max {maxCards} cards &middot; {turnTimer}s turn timer
          </div>
        )}

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
