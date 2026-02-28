import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { PlayerList } from '../components/PlayerList.js';
import { useGameContext } from '../context/GameContext.js';
import { MIN_PLAYERS, MAX_PLAYERS, BotDifficulty } from '@bull-em/shared';
import { useEffect, useState } from 'react';

export function LocalLobbyPage() {
  const navigate = useNavigate();
  const { roomState, gameState, playerId, startGame, createRoom, leaveRoom, addBot, removeBot, error, botDifficulty, setBotDifficulty } = useGameContext();
  const [localError, setLocalError] = useState('');
  const [initialized, setInitialized] = useState(false);

  // Initialize the local room on mount
  useEffect(() => {
    if (initialized || roomState) return;
    setInitialized(true);
    const name = sessionStorage.getItem('bull-em-local-name') || 'Player';
    createRoom(name).then(() => {
      // Auto-add 3 bots for a quick start
      return Promise.all([addBot(), addBot(), addBot()]);
    }).catch(e => {
      setLocalError(e instanceof Error ? e.message : 'Failed to set up game');
    });
  }, [initialized, roomState, createRoom, addBot]);

  // Navigate to game when it starts
  useEffect(() => {
    if (gameState) {
      navigate('/local/game');
    }
  }, [gameState, navigate]);

  const displayError = localError || error;
  const canStart = roomState && roomState.players.length >= MIN_PLAYERS;

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
            {roomState.players.length} player{roomState.players.length !== 1 ? 's' : ''} at the table
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
          showRemoveBot
          onRemoveBot={removeBot}
        />

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
          </div>
        )}

        <div className="flex flex-col gap-3">
          <button
            onClick={() => addBot().catch(e => setLocalError(e instanceof Error ? e.message : 'Failed to add bot'))}
            disabled={roomState.players.length >= MAX_PLAYERS}
            className="w-full glass px-4 py-2.5 text-sm text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors"
          >
            + Add Bot
          </button>
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
      </div>
    </Layout>
  );
}
