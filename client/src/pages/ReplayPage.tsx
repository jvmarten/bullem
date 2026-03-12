import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { handToString, TurnAction } from '@bull-em/shared';
import type { GameReplay, TurnEntry, HandCall, PlayerId, RoundResult, SpectatorPlayerCards } from '@bull-em/shared';
import { ReplayEngine, loadReplay } from '@bull-em/shared';
import { Layout } from '../components/Layout.js';
import { HandDisplay } from '../components/HandDisplay.js';
import { useGameContext } from '../context/GameContext.js';
import { useToast } from '../context/ToastContext.js';
import { fetchReplay } from '../api/replays.js';

function actionLabel(entry: TurnEntry): string {
  switch (entry.action) {
    case TurnAction.CALL:
      return entry.hand ? `calls ${handToString(entry.hand)}` : 'calls';
    case TurnAction.BULL:
      return 'BULL!';
    case TurnAction.TRUE:
      return 'TRUE';
    case TurnAction.LAST_CHANCE_RAISE:
      return entry.hand ? `raises to ${handToString(entry.hand)}` : 'raises';
    case TurnAction.LAST_CHANCE_PASS:
      return 'passes';
    default:
      return String(entry.action);
  }
}

function ResolutionPanel({ result, players }: { result: RoundResult; players: { id: PlayerId; name: string }[] }) {
  const callerName = players.find(p => p.id === result.callerId)?.name ?? 'Unknown';
  return (
    <div className="space-y-3 animate-fade-in">
      <p className="text-[var(--card-face)] text-sm text-center">
        {callerName} called:{' '}
        <span className="text-[var(--gold)] font-bold">{handToString(result.calledHand)}</span>
      </p>
      <div className={`text-lg font-display font-bold py-2 rounded-lg text-center ${
        result.handExists
          ? 'text-[var(--info)] bg-[var(--info-bg)] border border-[var(--info)]'
          : 'text-[var(--danger)] bg-[var(--danger-bg)] border border-[var(--danger)]'
      }`}>
        {result.handExists ? 'The hand EXISTS!' : 'BULL! Hand is fake!'}
      </div>
      <div className="space-y-1">
        {players.filter(p => result.penalties[p.id] !== undefined).map(p => {
          const newCardCount = result.penalties[p.id];
          const wasWrong = result.penalizedPlayerIds?.includes(p.id) ?? false;
          const isEliminated = result.eliminatedPlayerIds.includes(p.id);
          return (
            <div key={p.id} className={`flex justify-between items-center text-xs px-2 py-1 rounded-lg ${
              isEliminated ? 'bg-[var(--danger-bg)] text-[var(--danger)]' :
              wasWrong ? 'bg-amber-900/20 text-[var(--gold)]' : 'glass text-[var(--safe)]'
            }`}>
              <span className="font-medium">{p.name}</span>
              <span className="font-semibold">
                {isEliminated ? 'ELIMINATED' :
                 wasWrong ? `+1 card (${newCardCount} total)` :
                 'Safe'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ReplayPage() {
  const navigate = useNavigate();
  const { gameId: gameIdParam } = useParams<{ gameId: string }>();
  const [searchParams] = useSearchParams();
  const { lastReplay } = useGameContext();
  const { addToast } = useToast();

  const [replay, setReplay] = useState<GameReplay | null>(null);
  const [loadingReplay, setLoadingReplay] = useState(true);
  /** Track whether we've applied the initial deep-link seek so we only do it once. */
  const deepLinkApplied = useRef(false);

  // Load replay from context (just finished game), API (by game ID), or localStorage fallback
  useEffect(() => {
    const replayId = gameIdParam ?? null;

    if (!replayId) {
      // No ID param — use the in-memory replay from the game that just ended
      setReplay(lastReplay);
      setLoadingReplay(false);
      return;
    }

    // Try localStorage first (instant), then API
    const localReplay = loadReplay(replayId);
    if (localReplay) {
      setReplay(localReplay);
      setLoadingReplay(false);
      return;
    }

    // Fetch from API (the ID might be a database game UUID)
    let cancelled = false;
    setLoadingReplay(true);
    fetchReplay(replayId)
      .then(apiReplay => {
        if (!cancelled) {
          setReplay(apiReplay);
          setLoadingReplay(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReplay(null);
          setLoadingReplay(false);
        }
      });

    return () => { cancelled = true; };
  }, [gameIdParam, lastReplay]);

  const engine = useMemo(() => {
    if (!replay) return null;
    try {
      return new ReplayEngine(replay);
    } catch {
      return null;
    }
  }, [replay]);

  // Force re-render on step changes
  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick(t => t + 1), []);

  // Deep-link: seek to the round/turn specified in query params on first load
  useEffect(() => {
    if (!engine || deepLinkApplied.current) return;
    deepLinkApplied.current = true;

    const roundParam = searchParams.get('r');
    const turnParam = searchParams.get('t');

    if (roundParam !== null) {
      const roundIdx = parseInt(roundParam, 10);
      if (!Number.isNaN(roundIdx) && roundIdx >= 0 && roundIdx < engine.roundCount) {
        engine.seekToRound(roundIdx);

        if (turnParam !== null) {
          const turnIdx = parseInt(turnParam, 10);
          if (!Number.isNaN(turnIdx) && turnIdx > 0) {
            // Step forward turnIdx times within the current round
            for (let i = 0; i < turnIdx; i++) {
              if (!engine.stepForward()) break;
              // Stop if we moved past this round
              if (engine.currentRoundIndex !== roundIdx) {
                engine.seekToRound(roundIdx);
                engine.seekToRoundEnd();
                break;
              }
            }
          }
        }

        rerender();
      }
    }
  }, [engine, searchParams, rerender]);

  /** Build a shareable URL pointing to the current replay position. */
  const buildShareUrl = useCallback((): string => {
    if (!replay || !engine) return window.location.href;
    const url = new URL(window.location.origin + `/replay/${encodeURIComponent(replay.id)}`);
    const ri = engine.currentRoundIndex;
    const ti = engine.currentTurnIndex;
    if (ri > 0 || ti > 0) {
      url.searchParams.set('r', String(ri));
      if (ti > 0) {
        url.searchParams.set('t', String(ti));
      }
    }
    return url.toString();
  }, [replay, engine]);

  const handleShare = useCallback(async () => {
    const url = buildShareUrl();
    try {
      await navigator.clipboard.writeText(url);
      addToast('Replay link copied!', 'success');
    } catch {
      // Fallback for contexts where clipboard API is unavailable
      addToast('Could not copy link', 'error');
    }
  }, [buildShareUrl, addToast]);

  // Auto-play state
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (!isPlaying || !engine) return;
    const interval = setInterval(() => {
      if (!engine.stepForward()) {
        setIsPlaying(false);
      }
      rerender();
    }, 1500);
    return () => clearInterval(interval);
  }, [isPlaying, engine, rerender]);

  // Keyboard controls
  useEffect(() => {
    if (!engine) return;
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          engine.stepForward();
          rerender();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          engine.stepBackward();
          rerender();
          break;
        case ' ':
          e.preventDefault();
          setIsPlaying(p => !p);
          break;
        case 'Home':
          e.preventDefault();
          engine.seekToStart();
          rerender();
          break;
        case 'End':
          e.preventDefault();
          engine.seekToEnd();
          rerender();
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [engine, rerender]);

  if (loadingReplay) {
    return (
      <Layout>
        <div className="flex flex-col items-center gap-4 pt-12 text-center">
          <p className="text-[var(--gold-dim)]">Loading replay...</p>
        </div>
      </Layout>
    );
  }

  if (!replay || !engine) {
    return (
      <Layout>
        <div className="flex flex-col items-center gap-4 pt-12 text-center">
          <p className="text-[var(--gold-dim)]">No replay data available.</p>
          <button onClick={() => navigate('/')} className="btn-gold px-6 py-2">
            Back to Home
          </button>
        </div>
      </Layout>
    );
  }

  const viewState = engine.getViewState();
  const winnerName = replay.players.find(p => p.id === replay.winnerId)?.name ?? 'Unknown';

  return (
    <Layout>
      <div className="flex flex-col gap-3 pt-4 pb-20 max-w-lg mx-auto px-3">
        {/* Header */}
        <div className="text-center">
          <h2 className="font-display text-xl font-bold text-[var(--gold)]">
            Game Replay
          </h2>
          <p className="text-[var(--gold-dim)] text-xs mt-0.5">
            Winner: {winnerName} &middot; {replay.rounds.length} rounds
          </p>
          {/* Share button — copies a deep-link to the current round/turn position */}
          <button
            onClick={handleShare}
            className="mt-2 inline-flex items-center gap-1.5 text-xs text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors px-3 py-1.5 glass rounded-full"
            title="Copy shareable link to current position"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
            Share
          </button>
        </div>

        {/* Round indicator */}
        <div className="flex items-center justify-center gap-2">
          {replay.rounds.map((_, i) => (
            <button
              key={i}
              onClick={() => { engine.seekToRound(i); setIsPlaying(false); rerender(); }}
              className={`w-7 h-7 rounded-full text-xs font-bold transition-all ${
                i === viewState.roundIndex
                  ? 'bg-[var(--gold)] text-[var(--surface)]'
                  : 'glass text-[var(--gold-dim)] hover:text-[var(--gold)]'
              }`}
            >
              {i + 1}
            </button>
          ))}
        </div>

        {/* Round title */}
        <div className="text-center">
          <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold">
            Round {viewState.roundIndex + 1} of {replay.rounds.length}
          </p>
        </div>

        {/* Player cards */}
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold text-center">
            All Players' Cards
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {viewState.playerCards.map(({ playerId, playerName, cards }) => (
              <div key={playerId} className="glass px-2 py-1.5">
                <p className="text-xs text-[var(--gold-dim)] font-semibold mb-0.5 truncate">
                  {playerName} ({cards.length} {cards.length === 1 ? 'card' : 'cards'})
                </p>
                <HandDisplay cards={cards} />
              </div>
            ))}
          </div>
        </div>

        {/* Current hand */}
        {viewState.currentHand && (
          <div className="glass-raised p-3 text-center animate-fade-in">
            <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-1">
              Current Call
            </p>
            <p className="text-[var(--gold)] font-display text-lg font-bold">
              {handToString(viewState.currentHand)}
            </p>
            {viewState.lastCallerId && (
              <p className="text-[var(--gold-dim)] text-xs mt-0.5">
                by {replay.players.find(p => p.id === viewState.lastCallerId)?.name ?? 'Unknown'}
              </p>
            )}
          </div>
        )}

        {/* Turn history */}
        {viewState.visibleHistory.length > 0 && (
          <div className="glass p-2">
            <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-1 text-center">
              Actions ({viewState.visibleHistory.length}/{engine.getCurrentRoundResult().turnHistory?.length ?? 0})
            </p>
            <div className="space-y-0.5 max-h-40 overflow-y-auto">
              {viewState.visibleHistory.map((entry, i) => (
                <div key={i} className={`text-xs px-2 py-0.5 rounded ${
                  i === viewState.visibleHistory.length - 1 ? 'bg-[var(--gold)]/10' : ''
                }`}>
                  <span className="font-medium text-[var(--gold-light)]">{entry.playerName}</span>{' '}
                  <span className="text-[var(--gold-dim)]">{actionLabel(entry)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Resolution */}
        {viewState.showingResolution && (
          <div className="glass-raised p-4">
            <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2 text-center">
              Round Result
            </p>
            <ResolutionPanel result={engine.getCurrentRoundResult()} players={replay.players} />
          </div>
        )}

        {/* Playback controls */}
        <div className="fixed bottom-0 left-0 right-0 glass-raised border-t border-[var(--gold)]/20 px-4 py-3 z-40" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))', paddingLeft: 'max(1rem, env(safe-area-inset-left, 0px))', paddingRight: 'max(1rem, env(safe-area-inset-right, 0px))' }}>
          <div className="max-w-lg mx-auto flex items-center justify-between gap-2">
            <button
              onClick={() => { engine.seekToStart(); setIsPlaying(false); rerender(); }}
              disabled={engine.isAtStart}
              className="text-[var(--gold)] disabled:text-[var(--gold-dim)] disabled:opacity-40 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center"
              title="Go to start (Home)"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="11 19 2 12 11 5" />
                <polyline points="22 19 13 12 22 5" />
              </svg>
            </button>
            <button
              onClick={() => { engine.stepBackward(); setIsPlaying(false); rerender(); }}
              disabled={engine.isAtStart}
              className="text-[var(--gold)] disabled:text-[var(--gold-dim)] disabled:opacity-40 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center"
              title="Step back (Left arrow)"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button
              onClick={() => setIsPlaying(p => !p)}
              className="btn-gold px-5 py-2 min-w-[44px] min-h-[44px] flex items-center justify-center"
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            >
              {isPlaying ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21" />
                </svg>
              )}
            </button>
            <button
              onClick={() => { engine.stepForward(); setIsPlaying(false); rerender(); }}
              disabled={engine.isAtEnd}
              className="text-[var(--gold)] disabled:text-[var(--gold-dim)] disabled:opacity-40 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center"
              title="Step forward (Right arrow)"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
            <button
              onClick={() => { engine.seekToEnd(); setIsPlaying(false); rerender(); }}
              disabled={engine.isAtEnd}
              className="text-[var(--gold)] disabled:text-[var(--gold-dim)] disabled:opacity-40 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center"
              title="Go to end (End)"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="13 19 22 12 13 5" />
                <polyline points="2 19 11 12 2 5" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </Layout>
  );
}
