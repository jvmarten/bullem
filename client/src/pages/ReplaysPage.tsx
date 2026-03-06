import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadAllReplays, deleteReplay } from '@bull-em/shared';
import type { GameReplay } from '@bull-em/shared';
import { Layout } from '../components/Layout.js';

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return 'Unknown date';
  }
}

export function ReplaysPage() {
  const navigate = useNavigate();
  const [replays, setReplays] = useState<GameReplay[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    setReplays(loadAllReplays());
  }, []);

  const handleDelete = useCallback((id: string) => {
    deleteReplay(id);
    setReplays(loadAllReplays());
    setConfirmDeleteId(null);
  }, []);

  const handleWatch = useCallback((id: string) => {
    navigate(`/replay?id=${encodeURIComponent(id)}`);
  }, [navigate]);

  return (
    <Layout>
      <div className="flex flex-col gap-4 pt-4 pb-20 max-w-lg mx-auto px-3">
        {/* Header */}
        <div className="text-center">
          <h2 className="font-display text-xl font-bold text-[var(--gold)]">
            My Replays
          </h2>
          <p className="text-[var(--gold-dim)] text-xs mt-0.5">
            {replays.length === 0
              ? 'No saved replays yet'
              : `${replays.length} saved replay${replays.length === 1 ? '' : 's'}`}
          </p>
        </div>

        {/* Replay list */}
        {replays.length === 0 ? (
          <div className="glass px-4 py-8 text-center animate-fade-in">
            <p className="text-[var(--gold-dim)] text-sm mb-1">No replays found</p>
            <p className="text-[var(--gold-dim)] text-xs opacity-70">
              Complete a game to save a replay
            </p>
          </div>
        ) : (
          <div className="space-y-2 animate-fade-in">
            {replays.map((replay) => {
              const winnerName = replay.players.find(p => p.id === replay.winnerId)?.name ?? 'Unknown';
              const isConfirming = confirmDeleteId === replay.id;

              return (
                <div key={replay.id} className="glass px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    {/* Replay info — tappable to watch */}
                    <button
                      onClick={() => handleWatch(replay.id)}
                      className="flex-1 text-left min-w-0"
                    >
                      <p className="text-sm font-semibold text-[var(--gold)] truncate">
                        {winnerName} wins
                      </p>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                        <span className="text-xs text-[var(--gold-dim)]">
                          {replay.players.length} player{replay.players.length === 1 ? '' : 's'}
                        </span>
                        <span className="text-xs text-[var(--gold-dim)]">
                          {replay.rounds.length} round{replay.rounds.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <p className="text-[10px] text-[var(--gold-dim)] opacity-60 mt-0.5">
                        {formatDate(replay.completedAt)}
                      </p>
                    </button>

                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {isConfirming ? (
                        <>
                          <button
                            onClick={() => handleDelete(replay.id)}
                            className="text-[var(--danger)] text-xs font-semibold px-2 py-1 min-w-[44px] min-h-[44px] flex items-center justify-center"
                          >
                            Delete
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-[var(--gold-dim)] text-xs px-2 py-1 min-w-[44px] min-h-[44px] flex items-center justify-center"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(replay.id)}
                          className="text-[var(--gold-dim)] hover:text-[var(--danger)] transition-colors p-2 min-w-[44px] min-h-[44px] flex items-center justify-center"
                          title="Delete replay"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Back button */}
        <div className="text-center">
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
