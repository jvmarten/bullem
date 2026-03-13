import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadAllReplays, deleteReplay } from '@bull-em/shared';
import type { GameReplay, ReplayListEntry } from '@bull-em/shared';
import { Layout } from '../components/Layout.js';
import { useToast } from '../context/ToastContext.js';
import { fetchReplayList } from '../api/replays.js';

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

/** Unified replay item that works for both API and localStorage sources. */
interface ReplayItem {
  id: string;
  winnerName: string;
  playerCount: number;
  roundCount: number;
  completedAt: string;
  /** 'api' replays are server-persisted; 'local' replays are localStorage-only. */
  source: 'api' | 'local';
}

function localReplayToItem(replay: GameReplay): ReplayItem {
  return {
    id: replay.id,
    winnerName: replay.players.find(p => p.id === replay.winnerId)?.name ?? 'Unknown',
    playerCount: replay.players.length,
    roundCount: replay.rounds.length,
    completedAt: replay.completedAt,
    source: 'local',
  };
}

function apiReplayToItem(entry: ReplayListEntry): ReplayItem {
  return {
    id: entry.id,
    winnerName: entry.winnerName,
    playerCount: entry.playerCount,
    roundCount: entry.roundCount,
    completedAt: entry.completedAt,
    source: 'api',
  };
}

export function ReplaysPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [replays, setReplays] = useState<ReplayItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleShare = useCallback(async (replayId: string) => {
    const url = `${window.location.origin}/replay/${encodeURIComponent(replayId)}`;
    try {
      await navigator.clipboard.writeText(url);
      addToast('Replay link copied!', 'success');
    } catch {
      addToast('Could not copy link', 'error');
    }
  }, [addToast]);

  const loadReplays = useCallback(async () => {
    setLoading(true);
    setFetchError(false);

    // Start with localStorage replays as immediate fallback
    const localReplays = loadAllReplays().map(localReplayToItem);

    try {
      const result = await fetchReplayList(50, 0);

      const apiReplays = result.replays.map(apiReplayToItem);

      // Merge: API replays first, then any localStorage replays not already in API results
      const apiIds = new Set(apiReplays.map(r => r.id));
      const uniqueLocal = localReplays.filter(r => !apiIds.has(r.id));
      setReplays([...apiReplays, ...uniqueLocal]);
    } catch {
      // API unavailable — fall back to localStorage only
      setReplays(localReplays);
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReplays();
  }, [loadReplays]);

  const handleDelete = useCallback((id: string) => {
    // Only localStorage replays can be deleted from the client
    deleteReplay(id);
    setReplays(prev => prev.filter(r => r.id !== id));
    setConfirmDeleteId(null);
  }, []);

  const handleWatch = useCallback((id: string) => {
    navigate(`/replay/${encodeURIComponent(id)}`);
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
            {loading
              ? 'Loading replays...'
              : replays.length === 0
                ? 'No saved replays yet'
                : `${replays.length} saved replay${replays.length === 1 ? '' : 's'}`}
          </p>
        </div>

        {/* API error banner */}
        {fetchError && (
          <div className="glass px-4 py-3 text-center">
            <p className="text-sm text-red-400">Failed to load replays from server</p>
            <button
              onClick={() => void loadReplays()}
              className="mt-2 text-xs text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Replay list */}
        {!loading && replays.length === 0 && !fetchError ? (
          <div className="glass px-4 py-8 text-center animate-fade-in">
            <p className="text-[var(--gold-dim)] text-sm mb-2">
              No replays yet — play a game to see it here!
            </p>
            <button
              onClick={() => navigate('/')}
              className="btn-gold py-2 px-6 text-sm"
            >
              Play Now
            </button>
          </div>
        ) : (
          <div className="space-y-2 animate-fade-in">
            {replays.map((replay) => {
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
                        {replay.winnerName} wins
                      </p>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                        <span className="text-xs text-[var(--gold-dim)]">
                          {replay.playerCount} player{replay.playerCount === 1 ? '' : 's'}
                        </span>
                        <span className="text-xs text-[var(--gold-dim)]">
                          {replay.roundCount} round{replay.roundCount === 1 ? '' : 's'}
                        </span>
                      </div>
                      <p className="text-[10px] text-[var(--gold-dim)] opacity-60 mt-0.5">
                        {formatDate(replay.completedAt)}
                      </p>
                    </button>

                    {/* Actions: share + delete */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {/* Share button — available for all replays */}
                      <button
                        onClick={() => void handleShare(replay.id)}
                        className="text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors p-2 min-w-[44px] min-h-[44px] flex items-center justify-center"
                        title="Copy share link"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="18" cy="5" r="3" />
                          <circle cx="6" cy="12" r="3" />
                          <circle cx="18" cy="19" r="3" />
                          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                        </svg>
                      </button>

                      {/* Delete — only for localStorage replays */}
                      {replay.source === 'local' && (
                        <>
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
                        </>
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
            className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-sm transition-colors min-h-[44px] flex items-center justify-center"
          >
            Back to Home
          </button>
        </div>
      </div>
    </Layout>
  );
}
