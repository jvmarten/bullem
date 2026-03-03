import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { PlayerList } from '../components/PlayerList.js';
import { useGameContext } from '../context/GameContext.js';
import { MIN_PLAYERS, MAX_PLAYERS, BotDifficulty, MAX_CARDS, MIN_MAX_CARDS, DECK_SIZE, maxPlayersForMaxCards, TURN_TIMER_OPTIONS } from '@bull-em/shared';
import { useEffect, useState, useRef } from 'react';

export function LocalLobbyPage() {
  const navigate = useNavigate();
  const {
    roomState, gameState, playerId, startGame, createRoom, leaveRoom,
    addBot, removeBot, error, botDifficulty, setBotDifficulty,
    gameSettings, setGameSettings,
  } = useGameContext();
  const [localError, setLocalError] = useState('');
  const initializedRef = useRef(false);

  const maxCards = gameSettings?.maxCards ?? MAX_CARDS;
  const dynamicMaxPlayers = Math.min(MAX_PLAYERS, maxPlayersForMaxCards(maxCards));
  const playerCount = roomState?.players.length ?? 0;

  // Initialize the local room on mount
  useEffect(() => {
    if (initializedRef.current || roomState) return;
    initializedRef.current = true;
    const name = sessionStorage.getItem('bull-em-local-name') || localStorage.getItem('bull-em-player-name') || 'Player';
    createRoom(name).then(() => {
      // Auto-add 5 bots for a quick start
      return Promise.all([addBot(), addBot(), addBot(), addBot(), addBot()]);
    }).catch(e => {
      setLocalError(e instanceof Error ? e.message : 'Failed to set up game');
    });
  }, [roomState, createRoom, addBot]);

  // Navigate to game when it starts
  useEffect(() => {
    if (gameState) {
      navigate('/local/game');
    }
  }, [gameState, navigate]);

  const handleMaxCardsChange = (newMax: number) => {
    if (!setGameSettings || !gameSettings) return;
    const newDynamic = Math.min(MAX_PLAYERS, maxPlayersForMaxCards(newMax));
    // If reducing max cards would make current player count invalid, block
    if (playerCount > newDynamic) {
      setLocalError(`Can't set max cards to ${newMax} with ${playerCount} players (max ${newDynamic} players at ${newMax} cards)`);
      return;
    }
    setLocalError('');
    setGameSettings({ ...gameSettings, maxCards: newMax });
  };

  const displayError = localError || error;
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
      <div className="space-y-6 pt-4 animate-fade-in">
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

        {displayError && (
          <div className="glass px-4 py-2.5 text-sm text-[var(--danger)] border-[var(--danger)] animate-shake">
            {displayError}
          </div>
        )}

        <PlayerList
          players={roomState.players}
          myPlayerId={playerId}
          maxCards={maxCards}
          showRemoveBot
          onRemoveBot={removeBot}
        />

        <button
          onClick={() => addBot().catch(e => setLocalError(e instanceof Error ? e.message : 'Failed to add bot'))}
          disabled={!canAddBot}
          className="w-full glass px-4 py-2.5 text-sm text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors"
        >
          + Add Bot
        </button>

        <div className="flex flex-col gap-3">
          <button
            onClick={startGame}
            disabled={!canStart}
            className="w-full btn-gold py-3 text-lg"
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

        {setGameSettings && gameSettings && (
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
        )}

        {setBotDifficulty && (
          <div className="glass px-4 py-3">
            <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">
              Bot Difficulty
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setBotDifficulty(BotDifficulty.EASY)}
                className={`flex-1 px-3 py-2 text-sm rounded transition-colors ${
                  botDifficulty === BotDifficulty.EASY
                    ? 'bg-[var(--gold)] text-[var(--felt-dark)] font-semibold'
                    : 'glass text-[var(--gold-dim)] hover:text-[var(--gold)]'
                }`}
              >
                Easy
              </button>
              <button
                onClick={() => setBotDifficulty(BotDifficulty.HARD)}
                className={`flex-1 px-3 py-2 text-sm rounded transition-colors ${
                  botDifficulty === BotDifficulty.HARD
                    ? 'bg-[var(--gold)] text-[var(--felt-dark)] font-semibold'
                    : 'glass text-[var(--gold-dim)] hover:text-[var(--gold)]'
                }`}
              >
                Hard
              </button>
            </div>
            <div className="flex justify-center mt-2">
              <button
                onClick={() => setBotDifficulty(BotDifficulty.IMPOSSIBLE)}
                className={`px-2 py-1 text-[10px] rounded transition-colors ${
                  botDifficulty === BotDifficulty.IMPOSSIBLE
                    ? 'bg-[var(--danger)] text-white font-semibold'
                    : 'text-[var(--danger)] opacity-50 hover:opacity-80 border border-[var(--danger)] border-opacity-30'
                }`}
              >
                Impossible
              </button>
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
                  onClick={() => setGameSettings({ ...gameSettings, turnTimer: seconds })}
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
      </div>
    </Layout>
  );
}
