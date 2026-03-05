import { useParams, useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { PlayerList } from '../components/PlayerList.js';
import { ShareButton } from '../components/ShareButton.js';
import { useGameContext } from '../context/GameContext.js';
import { GamePhase, MIN_PLAYERS, MAX_PLAYERS, MAX_CARDS, MIN_MAX_CARDS, ONLINE_TURN_TIMER_OPTIONS, MAX_PLAYERS_OPTIONS, maxPlayersForMaxCards, BotSpeed } from '@bull-em/shared';
import { useEffect, useState, useRef } from 'react';
import { useToast } from '../context/ToastContext.js';
import { useErrorToast } from '../hooks/useErrorToast.js';
import { useSound } from '../hooks/useSound.js';
import { socket } from '../socket.js';

export function LobbyPage() {
  const { roomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const { roomState, gameState, playerId, startGame, joinRoom, leaveRoom, deleteRoom, addBot, removeBot, kickPlayer, error, clearError, updateSettings } = useGameContext();
  const { addToast } = useToast();
  const { play } = useSound();
  useErrorToast(error, clearError);
  const [joining, setJoining] = useState(false);
  const [joinName, setJoinName] = useState('');
  const joinAttemptedRef = useRef(false);

  // Navigate to game when it starts
  useEffect(() => {
    if (gameState && roomState?.gamePhase === GamePhase.PLAYING) {
      navigate(`/game/${roomCode}`);
    }
  }, [gameState, roomState?.gamePhase, roomCode, navigate]);

  // Navigate kicked players back to home with a toast notification
  useEffect(() => {
    const handleKicked = () => {
      addToast('You were kicked from the room by the host');
      navigate('/');
    };
    socket.on('room:kicked', handleKicked);
    return () => { socket.off('room:kicked', handleKicked); };
  }, [addToast, navigate]);

  // Auto-join room when navigating directly to /room/:roomCode
  useEffect(() => {
    if (roomState || !roomCode || joining || joinAttemptedRef.current) return;
    const storedName = sessionStorage.getItem('bull-em-player-name') || localStorage.getItem('bull-em-player-name');
    if (storedName) {
      joinAttemptedRef.current = true;
      setJoining(true);
      joinRoom(roomCode, storedName)
        .catch((e) => {
          addToast(e instanceof Error ? e.message : 'Failed to join room');
          setTimeout(() => navigate('/'), 3000);
        })
        .finally(() => setJoining(false));
    }
  }, [roomState, roomCode, joining, joinRoom, navigate]);

  const handleManualJoin = async () => {
    if (!joinName.trim() || !roomCode) return;
    setJoining(true);
    try {
      await joinRoom(roomCode, joinName.trim());
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to join room');
    } finally {
      setJoining(false);
    }
  };

  const handleStartGame = () => {
    if (!roomState) return;
    if (roomState.players.length < MIN_PLAYERS) {
      addToast(`Need at least ${MIN_PLAYERS} players to start the game`);
      return;
    }
    startGame();
  };

  const handleCloseRoom = () => {
    const ok = window.confirm('Are you sure you want to close this room? All players will be disconnected.');
    if (!ok) return;
    deleteRoom();
    navigate('/');
  };

  // Show name input for direct URL visitors who have no stored name
  if (!roomState && !joining && !joinAttemptedRef.current && !sessionStorage.getItem('bull-em-player-name') && !localStorage.getItem('bull-em-player-name')) {
    return (
      <Layout>
        <div className="flex items-center justify-center pt-16">
          <div className="text-center space-y-4 w-full max-w-xs animate-fade-in">
            <h2 className="font-display text-2xl font-bold text-[var(--gold)]">
              Join Room {roomCode}
            </h2>
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
          </div>
        </div>
      </Layout>
    );
  }

  const isHost = playerId === roomState.hostId;
  const settings = roomState.settings;
  const maxCards = settings?.maxCards ?? MAX_CARDS;
  const turnTimer = settings?.turnTimer ?? 0;
  const maxPlayersSetting = settings?.maxPlayers ?? MAX_PLAYERS;
  const cardBasedMax = maxPlayersForMaxCards(maxCards);
  const effectiveMaxPlayers = Math.min(MAX_PLAYERS, cardBasedMax, maxPlayersSetting);
  const canStart = isHost && roomState.players.length >= MIN_PLAYERS;
  // Settings locked once another human (non-bot) player has joined
  const hasOtherHumans = roomState.players.some(p => !p.isBot && p.id !== roomState.hostId);
  const settingsLocked = hasOtherHumans;

  const handleMaxCardsChange = (newMax: number) => {
    if (settingsLocked) return;
    play('uiSoft');
    const newCardMax = maxPlayersForMaxCards(newMax);
    const cap = Math.min(MAX_PLAYERS, newCardMax, maxPlayersSetting);
    if (roomState.players.length > cap) {
      addToast(`Can't set max cards to ${newMax} with ${roomState.players.length} players`);
      return;
    }
    updateSettings({ maxCards: newMax, turnTimer, maxPlayers: maxPlayersSetting, allowSpectators: settings.allowSpectators, spectatorsCanSeeCards: settings.spectatorsCanSeeCards, botSpeed: settings.botSpeed });
  };

  const handleTimerChange = (seconds: number) => {
    if (settingsLocked) return;
    play('uiSoft');
    updateSettings({ maxCards, turnTimer: seconds, maxPlayers: maxPlayersSetting, allowSpectators: settings.allowSpectators, spectatorsCanSeeCards: settings.spectatorsCanSeeCards, botSpeed: settings.botSpeed });
  };

  const handleMaxPlayersChange = (cap: number) => {
    if (settingsLocked) return;
    play('uiSoft');
    if (roomState.players.length > cap) {
      addToast(`Can't set max players to ${cap} with ${roomState.players.length} players`);
      return;
    }
    updateSettings({ maxCards, turnTimer, maxPlayers: cap, allowSpectators: settings.allowSpectators, spectatorsCanSeeCards: settings.spectatorsCanSeeCards, botSpeed: settings.botSpeed });
  };

  // Filter max player options to only show values <= card-based max
  const availableMaxPlayerOptions = MAX_PLAYERS_OPTIONS.filter(n => n <= Math.min(MAX_PLAYERS, cardBasedMax));

  return (
    <Layout>
      <div className="lobby-content space-y-6 pt-4 animate-fade-in">
        {/* Left panel in landscape: room info + players */}
        <div className="lobby-left">
        {/* Room code display */}
        <div className="text-center">
          <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-1">
            Room Code
          </p>
          <p className="font-display text-5xl font-bold tracking-[0.3em] text-[var(--gold)]">
            {roomState.roomCode}
          </p>
          <p className="text-sm text-[var(--gold-dim)] mt-1.5">
            {roomState.players.length}/{effectiveMaxPlayers} players in lobby
          </p>
        </div>

        {/* Share invite link — prominent one-tap share */}
        <ShareButton roomCode={roomState.roomCode} />

        <PlayerList
          players={roomState.players}
          myPlayerId={playerId}
          maxCards={maxCards}
          showRemoveBot={isHost}
          onRemoveBot={removeBot}
          showKickPlayer={isHost}
          onKickPlayer={(targetId) => kickPlayer(targetId).catch(e => addToast(e instanceof Error ? e.message : 'Failed to kick player'))}
        />

        {isHost && (
          <button
            onClick={() => addBot().catch(e => addToast(e instanceof Error ? e.message : 'Failed to add bot'))}
            disabled={roomState.players.length >= effectiveMaxPlayers}
            className="w-full glass px-4 py-2.5 text-sm text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors"
          >
            + Add Bot
          </button>
        )}
        </div>{/* end lobby-left */}

        {/* Right panel in landscape: settings + actions */}
        <div className="lobby-right">
        {/* Settings — host can edit until other humans join */}
        {isHost && !settingsLocked && (
          <>
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
                Eliminated after {maxCards + 1} cards
              </p>
            </div>

            {/* Max Players setting */}
            <div className="glass px-4 py-3">
              <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">
                Max Players
              </p>
              <div className="flex gap-1.5 flex-wrap">
                {availableMaxPlayerOptions.map(n => (
                  <button
                    key={n}
                    onClick={() => handleMaxPlayersChange(n)}
                    className={`flex-1 min-w-[2.5rem] px-2 py-2 text-sm rounded transition-colors ${
                      maxPlayersSetting === n || (n === Math.min(MAX_PLAYERS, cardBasedMax) && maxPlayersSetting >= n)
                        ? maxPlayersSetting === n
                          ? 'bg-[var(--gold)] text-[var(--felt-dark)] font-semibold'
                          : 'glass text-[var(--gold-dim)] hover:text-[var(--gold)]'
                        : 'glass text-[var(--gold-dim)] hover:text-[var(--gold)]'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
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

            {/* Bot Speed setting */}
            <div className="glass px-4 py-3">
              <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">
                Bot Speed
              </p>
              <div className="flex gap-1.5">
                {([BotSpeed.SLOW, BotSpeed.NORMAL, BotSpeed.FAST] as const).map(speed => (
                  <button
                    key={speed}
                    onClick={() => { play('uiSoft'); updateSettings({
                      maxCards, turnTimer, maxPlayers: maxPlayersSetting,
                      allowSpectators: settings.allowSpectators, spectatorsCanSeeCards: settings.spectatorsCanSeeCards,
                      botSpeed: speed,
                    }); }}
                    className={`flex-1 px-2 py-2 text-sm rounded transition-colors capitalize ${
                      (settings.botSpeed ?? BotSpeed.NORMAL) === speed
                        ? 'bg-[var(--gold)] text-[var(--felt-dark)] font-semibold'
                        : 'glass text-[var(--gold-dim)] hover:text-[var(--gold)]'
                    }`}
                  >
                    {speed}
                  </button>
                ))}
              </div>
            </div>

            {/* Last Chance Rules setting */}
            <div className="glass px-4 py-3">
              <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">
                Last Chance Rules
              </p>
              <div className="flex gap-1.5">
                {(['classic', 'strict'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => { play('uiSoft'); updateSettings({
                      maxCards, turnTimer, maxPlayers: maxPlayersSetting,
                      allowSpectators: settings.allowSpectators, spectatorsCanSeeCards: settings.spectatorsCanSeeCards,
                      botSpeed: settings.botSpeed, lastChanceMode: mode,
                    }); }}
                    className={`flex-1 px-2 py-2 text-sm rounded transition-colors capitalize ${
                      (settings.lastChanceMode ?? 'classic') === mode
                        ? 'bg-[var(--gold)] text-[var(--felt-dark)] font-semibold'
                        : 'glass text-[var(--gold-dim)] hover:text-[var(--gold)]'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-[var(--gold-dim)] mt-1.5">
                {(settings.lastChanceMode ?? 'classic') === 'classic'
                  ? 'After a last chance raise, all players can bull, true, or raise'
                  : 'After a last chance raise, next player must bull or raise. True unlocks after a bull is called'}
              </p>
            </div>

            {/* Spectator settings */}
            <div className="glass px-4 py-3">
              <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">
                Spectators
              </p>
              <div className="space-y-2">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm text-[var(--gold-dim)]">Allow spectators</span>
                  <button
                    onClick={() => { play('uiSoft'); updateSettings({
                      maxCards, turnTimer, maxPlayers: maxPlayersSetting,
                      allowSpectators: !settings.allowSpectators,
                      spectatorsCanSeeCards: settings.spectatorsCanSeeCards,
                      botSpeed: settings.botSpeed,
                    }); }}
                    className={`w-11 h-6 rounded-full transition-colors relative border ${
                      settings.allowSpectators
                        ? 'bg-[var(--gold)] border-[var(--gold)]'
                        : 'bg-[rgba(255,255,255,0.1)] border-[rgba(255,255,255,0.3)]'
                    }`}
                  >
                    <span className={`absolute left-0 top-[3px] w-[18px] h-[18px] rounded-full transition-transform bg-white shadow-sm ${
                      settings.allowSpectators ? 'translate-x-[23px]' : 'translate-x-[2px]'
                    }`} />
                  </button>
                </label>
                {settings.allowSpectators && (
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm text-[var(--gold-dim)]">Spectators see cards</span>
                    <button
                      onClick={() => { play('uiSoft'); updateSettings({
                        maxCards, turnTimer, maxPlayers: maxPlayersSetting,
                        allowSpectators: settings.allowSpectators,
                        spectatorsCanSeeCards: !settings.spectatorsCanSeeCards,
                        botSpeed: settings.botSpeed,
                      }); }}
                      className={`w-11 h-6 rounded-full transition-colors relative border ${
                        settings.spectatorsCanSeeCards
                          ? 'bg-[var(--gold)] border-[var(--gold)]'
                          : 'bg-[rgba(255,255,255,0.1)] border-[rgba(255,255,255,0.3)]'
                      }`}
                    >
                      <span className={`absolute left-0 top-[3px] w-[18px] h-[18px] rounded-full transition-transform bg-white shadow-sm ${
                        settings.spectatorsCanSeeCards ? 'translate-x-[23px]' : 'translate-x-[2px]'
                      }`} />
                    </button>
                  </label>
                )}
              </div>
            </div>
          </>
        )}

        {/* Settings display — shown when host settings are locked, or for non-host players */}
        {((!isHost) || (isHost && settingsLocked)) && settings && (
          <div className="glass px-4 py-3">
            <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">
              Game Settings{settingsLocked ? ' (Locked)' : ''}
            </p>
            <div className="flex justify-around text-center text-xs">
              <div>
                <p className="text-[var(--gold)] font-bold text-base">{maxCards}</p>
                <p className="text-[var(--gold-dim)]">Max Cards</p>
              </div>
              <div>
                <p className="text-[var(--gold)] font-bold text-base">{turnTimer}s</p>
                <p className="text-[var(--gold-dim)]">Turn Timer</p>
              </div>
              <div>
                <p className="text-[var(--gold)] font-bold text-base">{effectiveMaxPlayers}</p>
                <p className="text-[var(--gold-dim)]">Max Players</p>
              </div>
              <div>
                <p className="text-[var(--gold)] font-bold text-base capitalize">{settings.lastChanceMode ?? 'classic'}</p>
                <p className="text-[var(--gold-dim)]">Last Chance</p>
              </div>
            </div>
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
          {isHost ? (
            <>
              <button
                onClick={() => navigate('/', { state: { mode: 'online' } })}
                className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-sm transition-colors text-center"
              >
                Back to Menu
              </button>
              <button
                onClick={handleCloseRoom}
                className="text-[var(--danger)] hover:text-red-400 text-xs transition-colors text-center"
              >
                Close Room
              </button>
            </>
          ) : (
            <button
              onClick={() => { leaveRoom(); navigate('/'); }}
              className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-sm transition-colors text-center"
            >
              Leave Room
            </button>
          )}
        </div>
        </div>{/* end lobby-right */}
      </div>
    </Layout>
  );
}
