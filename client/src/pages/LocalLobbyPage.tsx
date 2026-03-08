import { useNavigate, useLocation } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { PlayerList } from '../components/PlayerList.js';
import { useGameContext } from '../context/GameContext.js';
import { MIN_PLAYERS, MAX_PLAYERS, BotDifficulty, MAX_CARDS, MIN_MAX_CARDS, DECK_SIZE, maxPlayersForMaxCards, TURN_TIMER_OPTIONS, BotSpeed, pickRandomBot, IMPOSSIBLE_BOT, BEST_OF_OPTIONS, DEFAULT_BEST_OF } from '@bull-em/shared';
import type { BotLevelCategory, BestOf } from '@bull-em/shared';
import type { Player } from '@bull-em/shared';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useToast } from '../context/ToastContext.js';
import { useErrorToast } from '../hooks/useErrorToast.js';
import { useSound } from '../hooks/useSound.js';
import { BotProfileModal } from '../components/BotProfileModal.js';
import { useUISettings, loadMatchSettings, saveMatchSettings } from '../components/VolumeControl.js';
import { isFirstGame } from '../utils/tutorialProgress.js';

export function LocalLobbyPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const isQuickPlay = (location.state as { quickPlay?: boolean } | null)?.quickPlay === true;
  const {
    roomState, gameState, playerId, startGame, createRoom, leaveRoom,
    addBot, removeBot, error, clearError, botDifficulty, setBotDifficulty,
    gameSettings, setGameSettings,
  } = useGameContext();
  const { addToast } = useToast();
  const { play } = useSound();
  useErrorToast(error, clearError);
  const initializedRef = useRef(false);
  const quickPlayStartedRef = useRef(false);
  // Tracks whether the game was started from this lobby session.
  // Prevents stale restored game state from triggering an immediate redirect.
  const gameStartedRef = useRef(false);
  // Guard against ghost taps: on mobile, the "Play Offline" tap can pass through
  // to "Start Game" if it occupies the same screen position after navigation.
  // 500ms covers slow devices; pointer-events:none on the button provides an
  // extra layer of protection against events that sneak past the disabled attr.
  const [interactionReady, setInteractionReady] = useState(false);
  const [showLcrInfo, setShowLcrInfo] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const handlePlayerClick = useCallback((player: Player) => {
    if (player.isBot) {
      setSelectedPlayer(player);
    }
  }, []);
  const { impossibleBotEnabled: impossibleEnabled } = useUISettings();
  useEffect(() => {
    const timer = setTimeout(() => setInteractionReady(true), 500);
    return () => clearTimeout(timer);
  }, []);

  // Clear any restored in-progress game from a previous session.
  // The lobby should always start fresh when the user explicitly navigates here.
  useEffect(() => {
    if (gameState && !gameStartedRef.current) {
      leaveRoom();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const maxCards = gameSettings?.maxCards ?? MAX_CARDS;
  const dynamicMaxPlayers = Math.min(MAX_PLAYERS, maxPlayersForMaxCards(maxCards));
  const playerCount = roomState?.players.length ?? 0;

  const firstGame = isFirstGame();

  // Initialize the local room on mount
  useEffect(() => {
    if (initializedRef.current || roomState) return;
    initializedRef.current = true;
    const name = sessionStorage.getItem('bull-em-local-name') || localStorage.getItem('bull-em-player-name') || 'Player';

    // Restore saved match settings from previous session
    if (setGameSettings && gameSettings) {
      if (firstGame) {
        // First-game mode: default to easy bots so new players aren't overwhelmed
        setGameSettings({ ...gameSettings, botLevelCategory: 'easy' });
      } else {
        const saved = loadMatchSettings('local');
        if (saved) {
          setGameSettings({
            ...gameSettings,
            ...(saved.maxCards != null && { maxCards: saved.maxCards }),
            ...(saved.turnTimer != null && { turnTimer: saved.turnTimer }),
            ...(saved.botLevelCategory && { botLevelCategory: saved.botLevelCategory as BotLevelCategory }),
            ...(saved.botSpeed && { botSpeed: saved.botSpeed as BotSpeed }),
            ...(saved.lastChanceMode && { lastChanceMode: saved.lastChanceMode as 'classic' | 'strict' }),
            ...(saved.bestOf != null && { bestOf: saved.bestOf as BestOf }),
          });
        }
      }
    }

    createRoom(name).then(() => {
      // Auto-add 5 bots for a quick start
      return Promise.all([addBot(), addBot(), addBot(), addBot(), addBot()]);
    }).catch(e => {
      addToast(e instanceof Error ? e.message : 'Failed to set up game');
    });
  }, [roomState, createRoom, addBot]);

  // Persist match settings to localStorage whenever they change.
  // Merge with existing saved settings to preserve online-specific fields.
  useEffect(() => {
    if (!gameSettings) return;
    saveMatchSettings({
      maxCards: gameSettings.maxCards,
      turnTimer: gameSettings.turnTimer,
      botLevelCategory: gameSettings.botLevelCategory,
      botSpeed: gameSettings.botSpeed,
      lastChanceMode: gameSettings.lastChanceMode,
      bestOf: gameSettings.bestOf,
    }, 'local');
  }, [gameSettings]);

  // Quick Play: auto-start the game once bots have been added
  useEffect(() => {
    if (!isQuickPlay || quickPlayStartedRef.current) return;
    if (!roomState || roomState.players.length < 2) return;
    quickPlayStartedRef.current = true;
    gameStartedRef.current = true;
    startGame();
  }, [isQuickPlay, roomState, startGame]);

  // Navigate to game when it starts — only if started from this lobby session
  useEffect(() => {
    if (gameState && gameStartedRef.current) {
      navigate('/local/game');
    }
  }, [gameState, navigate]);

  const handleMaxCardsChange = (newMax: number) => {
    if (!setGameSettings || !gameSettings) return;
    const newDynamic = Math.min(MAX_PLAYERS, maxPlayersForMaxCards(newMax));
    // If reducing max cards would make current player count invalid, block
    if (playerCount > newDynamic) {
      addToast(`Can't set max cards to ${newMax} with ${playerCount} players (max ${newDynamic} players at ${newMax} cards)`);
      return;
    }
    setGameSettings({ ...gameSettings, maxCards: newMax });
  };

  const canStart = roomState && playerCount >= MIN_PLAYERS;
  const canAddBot = playerCount < dynamicMaxPlayers;

  if (!roomState) {
    return (
      <Layout>
        <div className="flex items-center justify-center pt-16">
          <div className="text-center space-y-3 animate-fade-in">
            <div className="w-8 h-8 border-2 border-[var(--gold)] border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-[var(--gold-dim)]">Setting up game&hellip;</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="lobby-content space-y-6 pt-4 animate-fade-in">
        <div className="lobby-left">
        <div className="text-center">
          <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-1">
            Local Game
          </p>
          <h2 className="font-display text-3xl font-bold text-[var(--gold)]">
            Play vs Bots
          </h2>
          <p className="text-sm text-[var(--gold-dim)] mt-1.5">
            {playerCount} player{playerCount !== 1 ? 's' : ''} at the table
          </p>
        </div>

        {/* First-game banner — gentle nudge for new players */}
        {firstGame && (
          <div className="glass px-4 py-3 rounded-lg animate-fade-in" style={{ border: '1px solid var(--gold-dim)' }}>
            <p className="text-sm text-[var(--gold)] font-semibold mb-1">
              Welcome to your first game!
            </p>
            <p className="text-xs text-[var(--gold-dim)]">
              We&apos;ve set the bots to <strong className="text-[var(--gold)]">Easy</strong> difficulty so you can learn the ropes.
              Remember: <strong className="text-[var(--danger)]">Flush is LOWER than Three of a Kind</strong> in Bull &apos;Em!
            </p>
          </div>
        )}

        <PlayerList
          players={roomState.players}
          myPlayerId={playerId}
          maxCards={maxCards}
          showRemoveBot
          onRemoveBot={removeBot}
          onPlayerClick={handlePlayerClick}
        />

        {/* Bot count selector — quick add/remove bots */}
        <div className="glass px-4 py-3">
          <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">
            Bots
          </p>
          {(() => {
            const allOptions = Array.from({ length: dynamicMaxPlayers }, (_, i) => i);
            const firstRow = allOptions.filter(n => n <= 5);
            const secondRow = allOptions.filter(n => n > 5);
            const currentBotCount = roomState.players.filter(p => p.isBot).length;
            const handleBotCount = (n: number) => {
              play('uiSoft');
              const bots = roomState.players.filter(p => p.isBot);
              if (n > bots.length) {
                const toAdd = n - bots.length;
                for (let j = 0; j < toAdd; j++) {
                  addBot().catch(() => {});
                }
              } else if (n < bots.length) {
                const toRemove = bots.length - n;
                for (let j = 0; j < toRemove; j++) {
                  removeBot(bots[bots.length - 1 - j]!.id);
                }
              }
            };
            const btnClass = (n: number) => `flex-1 px-1.5 py-2 text-sm rounded transition-colors ${
              currentBotCount === n
                ? 'bg-[var(--gold)] text-[var(--felt-dark)] font-semibold'
                : 'glass text-[var(--gold-dim)] hover:text-[var(--gold)]'
            }`;
            return (
              <div className="space-y-1.5">
                <div className="flex gap-1.5">
                  {firstRow.map(n => (
                    <button key={n} onClick={() => handleBotCount(n)} className={btnClass(n)}>
                      {n}
                    </button>
                  ))}
                </div>
                {secondRow.length > 0 && (
                  <div className="flex gap-1.5">
                    {secondRow.map(n => (
                      <button key={n} onClick={() => handleBotCount(n)} className={btnClass(n)}>
                        {n}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
          <p className="text-[10px] text-[var(--gold-dim)] mt-1.5">
            {roomState.players.filter(p => p.isBot).length} bot{roomState.players.filter(p => p.isBot).length !== 1 ? 's' : ''} at the table
          </p>
        </div>

        <div className="flex flex-col gap-3 lobby-start-actions">
          <button
            onClick={() => { gameStartedRef.current = true; startGame(); }}
            disabled={!canStart || !interactionReady}
            className="w-full btn-gold py-3 text-lg"
            style={!interactionReady ? { pointerEvents: 'none' } : undefined}
          >
            {canStart ? 'Start Game' : `Need ${MIN_PLAYERS}+ Players`}
          </button>
          <button
            onClick={() => { leaveRoom(); navigate('/'); }}
            className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-sm transition-colors text-center"
          >
            Back to Home
          </button>
        </div>
        </div>{/* end lobby-left */}

        <div className="lobby-right">
        {setGameSettings && gameSettings && (
          <div className="glass px-4 py-3">
            <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">
              Max Cards
            </p>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  onClick={() => { play('uiSoft'); handleMaxCardsChange(n); }}
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
        )}

        {setGameSettings && gameSettings && (
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
                    setGameSettings({ ...gameSettings, botLevelCategory: cat });
                    // Replace existing bots with bots from the new category
                    const bots = roomState?.players.filter(p => p.isBot && p.name !== IMPOSSIBLE_BOT.name) ?? [];
                    const usedNames = new Set(roomState?.players.filter(p => !p.isBot).map(p => p.name) ?? []);
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
                    (gameSettings.botLevelCategory ?? 'mixed') === cat
                      ? 'bg-[var(--gold)] text-[var(--felt-dark)] font-semibold'
                      : 'glass text-[var(--gold-dim)] hover:text-[var(--gold)]'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-[var(--gold-dim)] mt-1.5">
              {(gameSettings.botLevelCategory ?? 'mixed') === 'easy' ? 'Levels 1-3 — beginner bots' :
               (gameSettings.botLevelCategory ?? 'mixed') === 'normal' ? 'Levels 4-6 — standard difficulty' :
               (gameSettings.botLevelCategory ?? 'mixed') === 'hard' ? 'Levels 7-9 — expert bots' :
               'Levels 1-9 — all skill levels'}
            </p>
            {impossibleEnabled && (
              <div className="flex justify-center mt-2">
                <button
                  onClick={() => {
                    play('uiSoft');
                    setBotDifficulty?.(botDifficulty === BotDifficulty.IMPOSSIBLE ? BotDifficulty.HARD : BotDifficulty.IMPOSSIBLE);
                    if (botDifficulty !== BotDifficulty.IMPOSSIBLE) {
                      // Add the impossible bot
                      addBot(IMPOSSIBLE_BOT.name).catch(() => {});
                    } else {
                      // Remove impossible bot
                      const oracleBot = roomState?.players.find(p => p.name === IMPOSSIBLE_BOT.name);
                      if (oracleBot) removeBot(oracleBot.id);
                    }
                  }}
                  className={`px-3 py-1.5 text-[10px] rounded transition-colors ${
                    botDifficulty === BotDifficulty.IMPOSSIBLE
                      ? 'bg-[var(--danger)] text-white font-semibold'
                      : 'text-[var(--danger)] opacity-50 hover:opacity-80 border border-[var(--danger)] border-opacity-30'
                  }`}
                >
                  {botDifficulty === BotDifficulty.IMPOSSIBLE ? 'The Oracle Active (lvl 10)' : 'Add The Oracle (lvl 10)'}
                </button>
              </div>
            )}
          </div>
        )}

        {setGameSettings && gameSettings && (
          <div className="glass px-4 py-3">
            <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">
              Bot Speed
            </p>
            <div className="flex gap-1.5">
              {([BotSpeed.SLOW, BotSpeed.NORMAL, BotSpeed.FAST] as const).map(speed => (
                <button
                  key={speed}
                  onClick={() => { play('uiSoft'); setGameSettings({ ...gameSettings, botSpeed: speed }); }}
                  className={`flex-1 px-2 py-2 text-sm rounded transition-colors capitalize ${
                    (gameSettings.botSpeed ?? BotSpeed.NORMAL) === speed
                      ? 'bg-[var(--gold)] text-[var(--felt-dark)] font-semibold'
                      : 'glass text-[var(--gold-dim)] hover:text-[var(--gold)]'
                  }`}
                >
                  {speed}
                </button>
              ))}
            </div>
          </div>
        )}

        {setGameSettings && gameSettings && (
          <div className="glass px-4 py-3">
            <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">
              Turn Timer
            </p>
            <div className="flex gap-1.5">
              {TURN_TIMER_OPTIONS.map(seconds => (
                <button
                  key={seconds}
                  onClick={() => { play('uiSoft'); setGameSettings({ ...gameSettings, turnTimer: seconds }); }}
                  className={`flex-1 px-2 py-2 text-sm rounded transition-colors ${
                    (gameSettings.turnTimer ?? 0) === seconds
                      ? 'bg-[var(--gold)] text-[var(--felt-dark)] font-semibold'
                      : 'glass text-[var(--gold-dim)] hover:text-[var(--gold)]'
                  }`}
                >
                  {seconds === 0 ? 'Off' : `${seconds}s`}
                </button>
              ))}
            </div>
          </div>
        )}

        {setGameSettings && gameSettings && (
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
                  onClick={() => { play('uiSoft'); setGameSettings({ ...gameSettings, lastChanceMode: mode }); }}
                  className={`flex-1 px-2 py-2 text-sm rounded transition-colors ${
                    (gameSettings.lastChanceMode ?? 'classic') === mode
                      ? 'bg-[var(--gold)] text-[var(--felt-dark)] font-semibold'
                      : 'glass text-[var(--gold-dim)] hover:text-[var(--gold)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-[var(--gold-dim)] mt-1.5">
              {(gameSettings.lastChanceMode ?? 'classic') === 'classic'
                ? 'After LCR, all players can bull, true, or raise'
                : 'After LCR, next player must bull or raise — no true option'}
            </p>
          </div>
        )}

        {/* Match Format — only for 1v1 (2 players total) */}
        {setGameSettings && gameSettings && playerCount === 2 && (
          <div className="glass px-4 py-3">
            <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">
              Match Format
            </p>
            <div className="flex gap-1.5">
              {BEST_OF_OPTIONS.map(bo => (
                <button
                  key={bo}
                  onClick={() => { play('uiSoft'); setGameSettings({ ...gameSettings, bestOf: bo as BestOf }); }}
                  className={`flex-1 px-2 py-2 text-sm rounded transition-colors ${
                    (gameSettings.bestOf ?? DEFAULT_BEST_OF) === bo
                      ? 'bg-[var(--gold)] text-[var(--felt-dark)] font-semibold'
                      : 'glass text-[var(--gold-dim)] hover:text-[var(--gold)]'
                  }`}
                >
                  {bo === 1 ? 'Bo1' : `Bo${bo}`}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-[var(--gold-dim)] mt-1.5">
              {(gameSettings.bestOf ?? DEFAULT_BEST_OF) === 1
                ? 'Single game — winner takes all'
                : `Best of ${gameSettings.bestOf ?? DEFAULT_BEST_OF} — first to ${Math.ceil((gameSettings.bestOf ?? DEFAULT_BEST_OF) / 2)} wins`}
            </p>
          </div>
        )}
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
