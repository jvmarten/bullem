import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { GameStatsDisplay } from '../components/GameStatsDisplay.js';
import { PlayerRankingReveal } from '../components/PlayerRankingReveal.js';
import { useGameContext } from '../context/GameContext.js';
import { useWinConfetti } from '../hooks/useWinConfetti.js';
import { useSound } from '../hooks/useSound.js';
import { RankBadge } from '../components/RankBadge.js';
import { playerColor } from '../utils/cardUtils.js';
import { PlayerAvatarContent } from '../components/PlayerAvatar.js';
import { markFirstGamePlayed } from '../utils/tutorialProgress.js';
import type { RatingChange, RankedMode } from '@bull-em/shared';

function RatingChangeDisplay({ change }: { change: RatingChange }) {
  const isGain = change.delta >= 0;
  const sign = isGain ? '+' : '\u2212';
  const color = isGain ? 'var(--safe)' : 'var(--danger)';
  const modeLabel = change.mode === 'heads_up' ? '1v1 Rating' : 'Multiplayer Rating';

  return (
    <div className="glass px-6 py-4 text-center animate-rating-slide-up" style={{ animationDelay: '0.3s' }}>
      <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">
        {modeLabel}
      </p>
      <div className="flex items-center justify-center gap-3">
        <span className="text-sm text-[var(--gold-dim)]">
          {Math.round(change.before)}
        </span>
        <span className="text-[var(--gold-dim)]">&rarr;</span>
        <span className="text-lg font-bold text-[var(--gold)] flex items-center gap-1">
          {Math.round(change.after)}
          <RankBadge rating={change.after} size="md" />
        </span>
      </div>
      <p
        className="text-lg font-bold mt-1 animate-rating-slide-up"
        style={{ color, animationDelay: '0.6s' }}
      >
        {sign}{Math.round(Math.abs(change.delta))}
      </p>
    </div>
  );
}

export function ResultsPage() {
  const navigate = useNavigate();
  const { roomCode } = useParams<{ roomCode: string }>();
  const { winnerId, gameState, gameStats, playerId, leaveRoom, requestRematch, roomState, lastReplay, ratingChanges, watchRandomGame, joinMatchmaking, leaveMatchmaking, matchmakingStatus, matchmakingFound, clearMatchmakingFound } = useGameContext();
  const [watchingAnother, setWatchingAnother] = useState(false);
  const [rankingDone, setRankingDone] = useState(false);
  const [statsVisible, setStatsVisible] = useState(false);
  const [replayShared, setReplayShared] = useState(false);
  const [rankedQueuing, setRankedQueuing] = useState<RankedMode | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up retry timer on unmount
  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  const handleWatchAnother = useCallback(async () => {
    setWatchingAnother(true);
    const tryWatch = async (): Promise<void> => {
      try {
        // Leave old room BEFORE joining new one — watchRandomGame() auto-joins
        // the socket to the new room on the server, so if leaveRoom() fires
        // after, it removes the socket from the *new* room instead.
        leaveRoom();
        const code = await watchRandomGame();
        navigate(`/game/${code}`);
      } catch {
        // No match available — retry after a short delay
        retryTimerRef.current = setTimeout(() => {
          void tryWatch();
        }, 3000);
      }
    };
    await tryWatch();
  }, [watchRandomGame, leaveRoom, navigate]);

  // Mark that the player has completed their first real game
  useEffect(() => {
    if (winnerId) markFirstGamePlayed();
  }, [winnerId]);

  // When winnerId is cleared (rematch started), navigate back to the game page
  useEffect(() => {
    if (!winnerId && roomCode && gameState) {
      navigate(`/game/${roomCode}`);
    }
  }, [winnerId, roomCode, gameState, navigate]);

  const winnerIndex = gameState?.players.findIndex((p) => p.id === winnerId) ?? -1;
  const winnerPlayer = winnerIndex >= 0 ? gameState!.players[winnerIndex]! : null;
  const winnerName = winnerPlayer?.name ?? 'Unknown';
  const isPlayerInGame = gameState?.players.some(p => p.id === playerId) ?? false;
  const isWinner = isPlayerInGame && winnerId === playerId;
  const isSpectator = !isPlayerInGame;
  const isHost = roomState?.hostId === playerId;

  useWinConfetti(isWinner);

  // Play victory/gameOver sound once per game — persisted in sessionStorage so
  // navigating to replay and back doesn't re-trigger the audio.
  const { play } = useSound();
  useEffect(() => {
    if (!winnerId || !roomCode) return;
    const storageKey = `victory-played:${roomCode}:${winnerId}`;
    if (sessionStorage.getItem(storageKey)) return;
    sessionStorage.setItem(storageKey, '1');
    play(isWinner ? 'victory' : 'gameOver');
  }, [winnerId, roomCode, isWinner, play]);

  const isRanked = roomState?.settings.ranked === true;
  const rankedMode = roomState?.settings.rankedMode;

  // Sync queuing state with matchmaking status from context
  useEffect(() => {
    if (matchmakingStatus) {
      setRankedQueuing(matchmakingStatus.mode);
    } else if (!matchmakingFound) {
      setRankedQueuing(null);
    }
  }, [matchmakingStatus, matchmakingFound]);

  // When a ranked rematch is found, leave the old room and navigate to the new game
  useEffect(() => {
    if (!matchmakingFound) return;
    const timer = setTimeout(() => {
      leaveRoom();
      clearMatchmakingFound();
      navigate(`/game/${matchmakingFound.roomCode}`);
    }, 2500);
    return () => clearTimeout(timer);
  }, [matchmakingFound, leaveRoom, clearMatchmakingFound, navigate]);

  const handleRankedPlayAgain = useCallback(() => {
    if (rankedQueuing) return;
    const mode = rankedMode ?? 'heads_up';
    setRankedQueuing(mode);
    joinMatchmaking(mode).catch(() => { setRankedQueuing(null); });
  }, [rankedQueuing, rankedMode, joinMatchmaking]);

  const handleCancelQueue = useCallback(() => {
    setRankedQueuing(null);
    leaveMatchmaking().catch(() => {});
  }, [leaveMatchmaking]);

  const handleRankingComplete = useCallback(() => {
    setRankingDone(true);
  }, []);

  return (
    <Layout>
      <div className="results-content flex flex-col items-center gap-6 pt-8 text-center animate-scale-in">
        <div className="results-left">
        <div className="animate-float">
          <div className={`avatar ${playerColor(winnerIndex >= 0 ? winnerIndex : 0)} flex items-center justify-center overflow-hidden`}
               style={{ width: '4rem', height: '4rem', fontSize: '1.75rem' }}>
            <PlayerAvatarContent name={winnerName} avatar={winnerPlayer?.avatar} photoUrl={winnerPlayer?.photoUrl} isBot={winnerPlayer?.isBot} />
          </div>
        </div>

        <div>
          <h2 className="font-display text-3xl font-bold text-[var(--gold)]">
            {isWinner ? 'You Win!' : `${winnerName} Wins!`}
          </h2>
          <p className="text-[var(--gold-dim)] mt-1 text-sm">
            {isWinner
              ? 'You outsmarted everyone at the table.'
              : isSpectator
                ? `${winnerName} won the game!`
                : 'Better luck next time.'}
          </p>
        </div>

        {/* Rating change for ranked games */}
        {playerId && ratingChanges && ratingChanges[playerId] && (
          <RatingChangeDisplay change={ratingChanges[playerId]} />
        )}

        {/* Animated ranking reveal */}
        {gameStats && gameState && gameState.players.length > 1 && (
          <PlayerRankingReveal
            players={gameState.players}
            winnerId={winnerId}
            stats={gameStats}
            onRevealComplete={handleRankingComplete}
          />
        )}

        {/* Stats toggle — hidden by default, shown after ranking animation completes */}
        {rankingDone && gameStats && gameState && (
          <div className="w-full">
            <button
              onClick={() => setStatsVisible(v => !v)}
              className="w-full flex items-center justify-center gap-1.5 text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold py-2"
            >
              <span>{statsVisible ? 'Hide' : 'View'} Match Stats</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className={`transition-transform ${statsVisible ? 'rotate-180' : ''}`}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {statsVisible && (
              <div className="animate-slide-up">
                <GameStatsDisplay stats={gameStats} players={gameState.players} winnerId={winnerId} />
              </div>
            )}
          </div>
        )}
        </div>{/* end results-left */}

        <div className="results-right">
        <div className="flex flex-col gap-3 w-full max-w-xs items-center">
          {/* Ranked: queue for a new match instead of rematching same players */}
          {isRanked && !isSpectator && (
            <>
              <button
                onClick={handleRankedPlayAgain}
                disabled={rankedQueuing !== null}
                className={`px-10 py-3 text-lg w-full ${rankedQueuing ? 'btn-safe animate-pulse' : 'btn-gold'}`}
              >
                {rankedQueuing ? 'In Queue...' : 'Play Again'}
              </button>
              {rankedQueuing && (
                <button
                  onClick={handleCancelQueue}
                  className="btn-ghost text-sm py-2"
                >
                  Cancel
                </button>
              )}
            </>
          )}
          {/* Non-ranked: host starts rematch with same players */}
          {!isRanked && isHost && !isSpectator && (
            <button
              onClick={requestRematch}
              className="btn-gold px-10 py-3 text-lg w-full"
            >
              Play Again
            </button>
          )}
          {!isRanked && !isHost && !isSpectator && (
            <p className="text-[var(--gold-dim)] text-sm">
              Waiting for host to start rematch...
            </p>
          )}
          {isSpectator && (
            watchingAnother ? (
              <div className="flex items-center justify-center gap-2 py-3">
                <div className="w-4 h-4 border-2 border-[var(--gold)] border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-[var(--gold-dim)]">Waiting for matches to start...</span>
              </div>
            ) : (
              <button
                onClick={handleWatchAnother}
                className="btn-gold px-10 py-3 text-lg"
              >
                Watch Another Match
              </button>
            )
          )}

          {lastReplay && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/replay')}
                className="text-[var(--gold)] hover:text-[var(--gold-light)] text-sm font-medium transition-colors"
              >
                Watch Replay
              </button>
              <span className="text-[var(--gold-dim)] text-xs">|</span>
              <button
                onClick={async () => {
                  const replayUrl = `${window.location.origin}/replay?id=${encodeURIComponent(lastReplay.id)}`;
                  if (navigator.share) {
                    try {
                      await navigator.share({ title: "Bull 'Em — Watch my match!", url: replayUrl });
                      return;
                    } catch { /* user cancelled or share failed — fall through to clipboard */ }
                  }
                  try {
                    await navigator.clipboard.writeText(replayUrl);
                    setReplayShared(true);
                    window.setTimeout(() => setReplayShared(false), 2000);
                  } catch { /* clipboard unavailable */ }
                }}
                className="text-[var(--gold)] hover:text-[var(--gold-light)] text-sm font-medium transition-colors"
              >
                {replayShared ? 'Link Copied!' : 'Share Replay'}
              </button>
            </div>
          )}
          <button
            onClick={() => { leaveRoom(); navigate('/'); }}
            className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-sm transition-colors"
          >
            Leave Game
          </button>
        </div>
        </div>{/* end results-right */}
      </div>

      {/* Match Found overlay for ranked rematch queue */}
      {matchmakingFound && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'var(--overlay)' }}>
          <div className="glass p-8 rounded-xl max-w-xs text-center space-y-4 animate-scale-in">
            <p className="text-2xl font-bold text-[var(--gold)] font-display">Match Found!</p>
            <div className="space-y-2">
              {matchmakingFound.opponents.map((opp, i) => (
                <div key={i} className="flex items-center justify-center gap-2">
                  <span className="text-sm text-[var(--gold)]">{opp.name}</span>
                  <RankBadge rating={opp.rating} size="md" />
                </div>
              ))}
            </div>
            <div className="w-6 h-6 border-2 border-[var(--gold)] border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        </div>
      )}
    </Layout>
  );
}
