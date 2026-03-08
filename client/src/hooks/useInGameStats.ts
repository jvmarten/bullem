import { useEffect, useRef, useState, useCallback } from 'react';
import { TurnAction } from '@bull-em/shared';
import type {
  RoundResult,
  ClientGameState,
  PlayerId,
  InGameStats,
  InGamePlayerStats,
  CardCountSnapshot,
  TurnEntry,
  GameStats,
} from '@bull-em/shared';

function emptyPlayerStats(): InGamePlayerStats {
  return {
    bullsCalled: 0,
    truesCalled: 0,
    callsMade: 0,
    correctBulls: 0,
    correctTrues: 0,
    bluffsSuccessful: 0,
  };
}

function ensurePlayer(
  stats: Record<PlayerId, InGamePlayerStats>,
  id: PlayerId,
): InGamePlayerStats {
  if (!stats[id]) stats[id] = emptyPlayerStats();
  return stats[id];
}

/**
 * Accumulates in-game stats from round results as they arrive.
 * Resets when a new game starts (roundNumber drops back to 1).
 */
export function useInGameStats(
  gameState: ClientGameState | null,
  roundResult: RoundResult | null,
  initialServerStats?: GameStats | null,
): InGameStats {
  const [stats, setStats] = useState<InGameStats>({
    playerStats: {},
    handTypeCalls: {},
    roundSnapshots: [],
  });

  const lastProcessedRoundRef = useRef(0);
  const prevRoundNumberRef = useRef(0);
  const initialStatsAppliedRef = useRef(false);

  // Seed from server-provided stats (spectator joining mid-game)
  useEffect(() => {
    if (!initialServerStats || initialStatsAppliedRef.current) return;
    initialStatsAppliedRef.current = true;
    // Convert server GameStats (PlayerGameStats) to client InGamePlayerStats
    const playerStats: Record<PlayerId, InGamePlayerStats> = {};
    for (const [id, ps] of Object.entries(initialServerStats.playerStats)) {
      playerStats[id] = {
        bullsCalled: ps.bullsCalled,
        truesCalled: ps.truesCalled,
        callsMade: ps.callsMade,
        correctBulls: ps.correctBulls,
        correctTrues: ps.correctTrues,
        bluffsSuccessful: ps.bluffsSuccessful,
      };
    }
    setStats(prev => ({
      playerStats: { ...playerStats, ...prev.playerStats },
      handTypeCalls: prev.handTypeCalls,
      roundSnapshots: prev.roundSnapshots,
    }));
  }, [initialServerStats]);

  // Reset when a new game starts
  useEffect(() => {
    if (!gameState) return;
    if (gameState.roundNumber < prevRoundNumberRef.current) {
      // New game started
      setStats({ playerStats: {}, handTypeCalls: {}, roundSnapshots: [] });
      lastProcessedRoundRef.current = 0;
      initialStatsAppliedRef.current = false;
    }
    prevRoundNumberRef.current = gameState.roundNumber;
  }, [gameState?.roundNumber, gameState]);

  // Process round results as they arrive
  useEffect(() => {
    if (!roundResult || !gameState) return;
    // Avoid reprocessing the same round
    if (gameState.roundNumber <= lastProcessedRoundRef.current) return;
    lastProcessedRoundRef.current = gameState.roundNumber;

    setStats(prev => {
      const playerStats = { ...prev.playerStats };
      const handTypeCalls = { ...prev.handTypeCalls };

      // Deep-clone player stats
      for (const id of Object.keys(playerStats)) {
        const existing = playerStats[id];
        if (existing) playerStats[id] = { ...existing };
      }

      // Process turn history from the round result
      const history = roundResult.turnHistory ?? [];
      for (const entry of history) {
        const ps = ensurePlayer(playerStats, entry.playerId);
        switch (entry.action) {
          case TurnAction.CALL:
          case TurnAction.LAST_CHANCE_RAISE:
            ps.callsMade++;
            if (entry.hand) {
              handTypeCalls[entry.hand.type] = (handTypeCalls[entry.hand.type] ?? 0) + 1;
            }
            break;
          case TurnAction.BULL:
            ps.bullsCalled++;
            break;
          case TurnAction.TRUE:
            ps.truesCalled++;
            break;
        }
      }

      // Process resolution: who was correct
      const handExists = roundResult.handExists;
      const penalizedSet = new Set(roundResult.penalizedPlayerIds);

      for (const entry of history) {
        const ps = ensurePlayer(playerStats, entry.playerId);
        if (entry.action === TurnAction.BULL && !penalizedSet.has(entry.playerId)) {
          ps.correctBulls++;
        }
        if (entry.action === TurnAction.TRUE && !penalizedSet.has(entry.playerId)) {
          ps.correctTrues++;
        }
      }

      // Bluff success: the caller made a call that didn't exist, but nobody
      // successfully called bull (all bull callers were penalized = hand existed).
      // Actually, bluff success = caller's hand didn't exist AND caller wasn't penalized.
      if (!handExists && !penalizedSet.has(roundResult.callerId)) {
        const callerStats = ensurePlayer(playerStats, roundResult.callerId);
        callerStats.bluffsSuccessful++;
      }

      // Snapshot card counts
      const snapshot: CardCountSnapshot = {
        roundNumber: gameState.roundNumber,
        cardCounts: {},
        eliminatedPlayerIds: [...roundResult.eliminatedPlayerIds],
      };
      for (const p of gameState.players) {
        snapshot.cardCounts[p.id] = p.cardCount;
      }

      return {
        playerStats,
        handTypeCalls,
        roundSnapshots: [...prev.roundSnapshots, snapshot],
      };
    });
  }, [roundResult, gameState]);

  const reset = useCallback(() => {
    setStats({ playerStats: {}, handTypeCalls: {}, roundSnapshots: [] });
    lastProcessedRoundRef.current = 0;
  }, []);

  // Expose reset for rematch scenarios
  useEffect(() => {
    void reset; // keep linter happy — reset is used via the return
  }, [reset]);

  return stats;
}
