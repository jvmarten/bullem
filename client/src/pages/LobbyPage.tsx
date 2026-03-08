import { useParams, useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { PlayerList } from '../components/PlayerList.js';
import { ShareButton } from '../components/ShareButton.js';
import { RoomQRCode } from '../components/RoomQRCode.js';
import { useGameContext } from '../context/GameContext.js';
import { useAuth } from '../context/AuthContext.js';
import { GamePhase, MIN_PLAYERS, MAX_PLAYERS, MAX_CARDS, MIN_MAX_CARDS, ONLINE_TURN_TIMER_OPTIONS, MAX_PLAYERS_OPTIONS, maxPlayersForMaxCards, BotSpeed, BEST_OF_OPTIONS, DEFAULT_BEST_OF, pickRandomBot, IMPOSSIBLE_BOT, BotDifficulty } from '@bull-em/shared';
import type { BestOf, BotLevelCategory } from '@bull-em/shared';
import type { Player } from '@bull-em/shared';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useToast } from '../context/ToastContext.js';
import { BotProfileModal } from '../components/BotProfileModal.js';
import { useErrorToast } from '../hooks/useErrorToast.js';
import { useSound } from '../hooks/useSound.js';
import { usePushNotifications } from '../hooks/usePushNotifications.js';
import { socket } from '../socket.js';
import { useUISettings } from '../components/VolumeControl.js';

export function LobbyPage() {
  const { roomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const { roomState, gameState, playerId, startGame, joinRoom, leaveRoom, deleteRoom, addBot, removeBot, kickPlayer, error, clearError, updateSettings } = useGameContext();
  const { user } = useAuth();
  const { addToast } = useToast();
  const { play } = useSound();
  const { state: pushState, subscribe: pushSubscribe, unsubscribe: pushUnsubscribe } = usePushNotifications();
  useErrorToast(error, clearError);
  const [joining, setJoining] = useState(false);
  const [joinName, setJoinName] = useState('');
  const [showLcrInfo, setShowLcrInfo] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const { impossibleBotEnabled: impossibleEnabled } = useUISettings();
  const joinAttemptedRef = useRef(false);
  const handlePlayerClick = useCallback((player: Player) => {
    if (player.isBot) {
      setSelectedPlayer(player);
    } else if (player.id === playerId) {
      navigate('/profile');
    }
  }, [playerId, navigate]);

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
      joinRoom(roomCode, storedName, user?.avatar)
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
      await joinRoom(roomCode, joinName.trim(), user?.avatar);
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
    updateSettings({ maxCards: newMax, turnTimer, maxPlayers: maxPlayersSetting, allowSpectators: settings.allowSpectators, spectatorsCanSeeCards: settings.spectatorsCanSeeCards, botSpeed: settings.botSpeed, lastChanceMode: settings.lastChanceMode });
  };

  const handleTimerChange = (seconds: number) => {
    if (settingsLocked) return;
    play('uiSoft');
    updateSettings({ maxCards, turnTimer: seconds, maxPlayers: maxPlayersSetting, allowSpectators: settings.allowSpectators, spectatorsCanSeeCards: settings.spectatorsCanSeeCards, botSpeed: settings.botSpeed, lastChanceMode: settings.lastChanceMode });
  };

  const handleMaxPlayersChange = (cap: number) => {
    if (settingsLocked) return;
    play('uiSoft');
    if (roomState.players.length > cap) {
      addToast(`Can't set max players to ${cap} with ${roomState.players.length} players`);
      return;
    }
    updateSettings({ maxCards, turnTimer, maxPlayers: cap, allowSpectators: settings.allowSpectators, spectatorsCanSeeCards: settings.spectatorsCanSeeCards, botSpeed: settings.botSpeed, lastChanceMode: settings.lastChanceMode });
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
          <p
            className="font-display text-5xl font-bold tracking-[0.3em] text-[var(--gold)] cursor-pointer active:scale-95 transition-transform"
            onClick={() => { navigator.clipboard.writeText(roomState.roomCode); addToast('Room code copied!', 'info'); }}
            title="Tap to copy"
          >
            {roomState.roomCode}
          </p>
          <p className="text-sm text-[var(--gold-dim)] mt-1.5">
            {roomState.players.length}/{effectiveMaxPlayers} players in lobby
          </p>
        </div>

        {/* Share invite link — prominent one-tap share */}
        <ShareButton roomCode={roomState.roomCode} />

        {/* QR code — togglable, great for in-person "scan to join" */}
        <RoomQRCode roomCode={roomState.roomCode} />

        <PlayerList
          players={roomState.players}
          myPlayerId={playerId}
          maxCards={maxCards}
          showRemoveBot={isHost}
          onRemoveBot={removeBot}
          showKickPlayer={isHost}
          onKickPlayer={(targetId) => kickPlayer(targetId).catch(e => addToast(e instanceof Error ? e.message : 'Failed to kick player'))}
          onPlayerClick={handlePlayerClick}
        />

        {isHost && (() => {
          const bots = roomState.players.filter(p => p.isBot);
          const humanCount = roomState.players.length - bots.length;
          const maxBots = effectiveMaxPlayers - humanCount;
          return (
            <div className="glass px-4 py-3">
              <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">
                Bots
              </p>
              <div className="flex gap-1.5">
                {Array.from({ length: maxBots + 1 }, (_, i) => i).map(n => (
                  <button
                    key={n}
                    onClick={() => {
                      play('uiSoft');
                      if (n > bots.length) {
                        const toAdd = n - bots.length;
                        for (let i = 0; i < toAdd; i++) {
                          addBot().catch(() => {});
                        }
                      } else if (n < bots.length) {
                        const toRemove = bots.length - n;
                        for (let i = 0; i < toRemove; i++) {
                          removeBot(bots[bots.length - 1 - i]!.id);
                        }
                      }
                    }}
                    className={`flex-1 px-2 py-2 text-sm rounded transition-colors ${
                      bots.length === n
                        ? 'bg-[var(--gold)] text-[var(--felt-dark)] font-semibold'
                        : 'glass text-[var(--gold-dim)] hover:text-[var(--gold)]'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-[var(--gold-dim)] mt-1.5">
                {bots.length} bot{bots.length !== 1 ? 's' : ''} in lobby
              </p>
            </div>
          );
        })()}
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
                      maxPlayersSetting === n
                        ? 'bg-[var(--gold)] text-[var(--felt-dark)] font-semibold'
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
                      botSpeed: speed, lastChanceMode: settings.lastChanceMode,
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

            {/* Bot Level Category setting */}
            <div className="glass px-4 py-3">
              <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">
                Bot Level
              </p>
              <div className="flex gap-1.5">
                {(['easy', 'normal', 'hard', 'mixed'] as const).map(cat => (
                  <button
                    key={cat}
                    onClick={() => {
                      play('uiSoft');
                      updateSettings({
                        maxCards, turnTimer, maxPlayers: maxPlayersSetting,
                        allowSpectators: settings.allowSpectators, spectatorsCanSeeCards: settings.spectatorsCanSeeCards,
                        botSpeed: settings.botSpeed, lastChanceMode: settings.lastChanceMode,
                        botLevelCategory: cat,
                      });
                      // Replace existing bots with bots from the new category
                      const bots = roomState.players.filter(p => p.isBot);
                      const usedNames = new Set(roomState.players.filter(p => !p.isBot).map(p => p.name));
                      for (const bot of bots) {
                        removeBot(bot.id);
                      }
                      for (let i = 0; i < bots.length; i++) {
                        const picked = pickRandomBot(cat, usedNames);
                        if (picked) {
                          usedNames.add(picked.name);
                          addBot(picked.name).catch(() => {});
                        } else {
                          addBot().catch(() => {});
                        }
                      }
                    }}
                    className={`flex-1 px-2 py-2 text-sm rounded transition-colors capitalize ${
                      (settings.botLevelCategory ?? 'normal') === cat
                        ? 'bg-[var(--gold)] text-[var(--felt-dark)] font-semibold'
                        : 'glass text-[var(--gold-dim)] hover:text-[var(--gold)]'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-[var(--gold-dim)] mt-1.5">
                {(settings.botLevelCategory ?? 'normal') === 'easy' ? 'Levels 1-3 — beginner bots' :
                 (settings.botLevelCategory ?? 'normal') === 'normal' ? 'Levels 4-6 — standard difficulty' :
                 (settings.botLevelCategory ?? 'normal') === 'hard' ? 'Levels 7-9 — expert bots' :
                 'Levels 1-9 — all skill levels'}
              </p>
            </div>

            {/* Best-of Series setting — only for 1v1 (maxPlayers = 2) unranked */}
            {maxPlayersSetting === 2 && !settings.ranked && (
              <div className="glass px-4 py-3">
                <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">
                  Match Format
                </p>
                <div className="flex gap-1.5">
                  {BEST_OF_OPTIONS.map(bo => (
                    <button
                      key={bo}
                      onClick={() => { play('uiSoft'); updateSettings({
                        maxCards, turnTimer, maxPlayers: maxPlayersSetting,
                        allowSpectators: settings.allowSpectators, spectatorsCanSeeCards: settings.spectatorsCanSeeCards,
                        botSpeed: settings.botSpeed, lastChanceMode: settings.lastChanceMode,
                        bestOf: bo as BestOf,
                      }); }}
                      className={`flex-1 px-2 py-2 text-sm rounded transition-colors ${
                        (settings.bestOf ?? DEFAULT_BEST_OF) === bo
                          ? 'bg-[var(--gold)] text-[var(--felt-dark)] font-semibold'
                          : 'glass text-[var(--gold-dim)] hover:text-[var(--gold)]'
                      }`}
                    >
                      {bo === 1 ? 'Bo1' : `Bo${bo}`}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-[var(--gold-dim)] mt-1.5">
                  {(settings.bestOf ?? DEFAULT_BEST_OF) === 1
                    ? 'Single game — winner takes all'
                    : `Best of ${settings.bestOf ?? DEFAULT_BEST_OF} — first to ${Math.ceil((settings.bestOf ?? DEFAULT_BEST_OF) / 2)} wins`}
                </p>
              </div>
            )}

            {/* Last Chance Rules setting */}
            <div className="glass px-4 py-3">
              <div className="flex items-center gap-1.5 mb-2">
                <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold">
                  Allow &lsquo;True&rsquo; in LCR?
                </p>
                <button
                  type="button"
                  onClick={() => setShowLcrInfo(v => !v)}
                  className="w-4 h-4 rounded-full border border-[var(--gold-dim)] text-[var(--gold-dim)] text-[9px] leading-none flex items-center justify-center hover:border-[var(--gold)] hover:text-[var(--gold)] transition-colors"
                  aria-label="What is LCR?"
                >
                  ?
                </button>
              </div>
              {showLcrInfo && (
                <div className="bg-black/40 rounded px-3 py-2 mb-2 text-[10px] text-[var(--gold-dim)] leading-relaxed">
                  <strong className="text-[var(--gold)]">LCR</strong> = Last Chance Raise — when everyone calls bull, the last caller gets one chance to raise. This setting controls whether the next player can call &lsquo;True&rsquo; after that raise.
                </div>
              )}
              <div className="flex gap-1.5">
                {([['classic', 'Yes'], ['strict', 'No']] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    onClick={() => { play('uiSoft'); updateSettings({
                      maxCards, turnTimer, maxPlayers: maxPlayersSetting,
                      allowSpectators: settings.allowSpectators, spectatorsCanSeeCards: settings.spectatorsCanSeeCards,
                      botSpeed: settings.botSpeed, lastChanceMode: mode,
                    }); }}
                    className={`flex-1 px-2 py-2 text-sm rounded transition-colors ${
                      (settings.lastChanceMode ?? 'classic') === mode
                        ? 'bg-[var(--gold)] text-[var(--felt-dark)] font-semibold'
                        : 'glass text-[var(--gold-dim)] hover:text-[var(--gold)]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-[var(--gold-dim)] mt-1.5">
                {(settings.lastChanceMode ?? 'classic') === 'classic'
                  ? 'After LCR, all players can bull, true, or raise'
                  : 'After LCR, next player must bull or raise — no true option'}
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
                      botSpeed: settings.botSpeed, lastChanceMode: settings.lastChanceMode,
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
                        botSpeed: settings.botSpeed, lastChanceMode: settings.lastChanceMode,
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


        {/* Oracle bot button — shown when impossible mode is enabled */}
        {isHost && impossibleEnabled && (
          <button
            onClick={() => {
              play('uiSoft');
              const hasOracle = roomState.players.some(p => p.name === IMPOSSIBLE_BOT.name);
              if (hasOracle) {
                const oracleBot = roomState.players.find(p => p.name === IMPOSSIBLE_BOT.name);
                if (oracleBot) removeBot(oracleBot.id);
              } else {
                addBot(IMPOSSIBLE_BOT.name).catch(e => addToast(e instanceof Error ? e.message : 'Failed to add bot'));
              }
            }}
            disabled={!roomState.players.some(p => p.name === IMPOSSIBLE_BOT.name) && roomState.players.length >= effectiveMaxPlayers}
            className={`w-full glass px-4 py-2.5 text-sm transition-colors ${
              roomState.players.some(p => p.name === IMPOSSIBLE_BOT.name)
                ? 'text-[var(--danger)] hover:text-red-300'
                : 'text-[var(--gold-dim)] hover:text-[var(--gold)]'
            }`}
          >
            {roomState.players.some(p => p.name === IMPOSSIBLE_BOT.name) ? 'The Oracle Active (lvl 10)' : 'Add The Oracle (lvl 10)'}
          </button>
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
                <p className="text-[var(--gold)] font-bold text-base">{(settings.lastChanceMode ?? 'classic') === 'classic' ? 'Yes' : 'No'}</p>
                <p className="text-[var(--gold-dim)]">True in LCR</p>
              </div>
              {maxPlayersSetting === 2 && (settings.bestOf ?? DEFAULT_BEST_OF) > 1 && (
                <div>
                  <p className="text-[var(--gold)] font-bold text-base">Bo{settings.bestOf ?? DEFAULT_BEST_OF}</p>
                  <p className="text-[var(--gold-dim)]">Format</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Push notification toggle — available to all players, not a game setting */}
        {pushState !== 'unsupported' && (
          <div className="glass px-4 py-3">
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <span className="text-sm text-[var(--gold-dim)]">Turn notifications</span>
                {pushState === 'denied' && (
                  <p className="text-[10px] text-[var(--danger)]">Blocked by browser</p>
                )}
              </div>
              <button
                onClick={async () => {
                  play('uiSoft');
                  if (pushState === 'subscribed') {
                    await pushUnsubscribe();
                    addToast('Notifications disabled');
                  } else if (pushState !== 'denied') {
                    const ok = await pushSubscribe();
                    addToast(ok ? 'Notifications enabled' : 'Could not enable notifications');
                  }
                }}
                disabled={pushState === 'denied' || pushState === 'loading'}
                className={`w-11 h-6 rounded-full transition-colors relative border ${
                  pushState === 'subscribed'
                    ? 'bg-[var(--gold)] border-[var(--gold)]'
                    : 'bg-[rgba(255,255,255,0.1)] border-[rgba(255,255,255,0.3)]'
                } ${pushState === 'denied' ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <span className={`absolute left-0 top-[3px] w-[18px] h-[18px] rounded-full transition-transform bg-white shadow-sm ${
                  pushState === 'subscribed' ? 'translate-x-[23px]' : 'translate-x-[2px]'
                }`} />
              </button>
            </label>
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
            <>
              <button
                onClick={() => navigate('/', { state: { mode: 'online' } })}
                className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-sm transition-colors text-center"
              >
                Browse while waiting
              </button>
              <button
                onClick={() => { leaveRoom(); navigate('/'); }}
                className="text-[var(--danger)] hover:text-red-400 text-xs transition-colors text-center"
              >
                Leave Room
              </button>
            </>
          )}
        </div>
        </div>{/* end lobby-right */}
      </div>
      {selectedPlayer && (
        <BotProfileModal
          player={selectedPlayer}
          playerIndex={roomState?.players.findIndex(p => p.id === selectedPlayer.id) ?? 0}
          stats={null}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </Layout>
  );
}
