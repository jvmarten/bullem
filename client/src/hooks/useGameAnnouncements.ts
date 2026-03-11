import { useEffect, useRef } from 'react';
import { handToString, TurnAction } from '@bull-em/shared';
import type { ClientGameState, RoundResult, PlayerId, TurnEntry, Player } from '@bull-em/shared';
import { useAnnouncer } from '../components/ScreenReaderAnnouncer.js';

/**
 * Announces game state changes to screen readers via aria-live regions.
 * Tracks turn changes, bull/true calls, round results, and eliminations.
 */
export function useGameAnnouncements(
  gameState: ClientGameState | null,
  roundResult: RoundResult | null,
  myPlayerId: PlayerId | null,
): void {
  const { announce } = useAnnouncer();
  const prevTurnPlayerRef = useRef<PlayerId | null>(null);
  const prevHistoryLenRef = useRef(0);
  const prevRoundResultRef = useRef<RoundResult | null>(null);

  // Announce turn changes
  useEffect(() => {
    if (!gameState) return;
    const currentPlayer = gameState.currentPlayerId;
    if (currentPlayer === prevTurnPlayerRef.current) return;
    prevTurnPlayerRef.current = currentPlayer;

    const player = gameState.players.find((p: Player) => p.id === currentPlayer);
    if (!player) return;

    if (currentPlayer === myPlayerId) {
      announce('Your turn', 'assertive');
    } else {
      announce(`${player.name}'s turn`, 'polite');
    }
  }, [gameState?.currentPlayerId, gameState?.players, myPlayerId, announce, gameState]);

  // Announce new call history entries (bull, true, hand calls)
  useEffect(() => {
    if (!gameState) return;
    const history = gameState.turnHistory;
    const prevLen = prevHistoryLenRef.current;
    prevHistoryLenRef.current = history.length;

    if (history.length <= prevLen) return;

    // Announce the latest entry
    const latest = history[history.length - 1];
    if (!latest) return;

    const playerName = latest.playerName ?? gameState.players.find((p: Player) => p.id === latest.playerId)?.name ?? 'A player';
    const msg = formatTurnAnnouncement(latest, playerName);
    if (msg) announce(msg, 'polite');
  }, [gameState?.turnHistory.length, gameState, announce]);

  // Announce round results
  useEffect(() => {
    if (!roundResult || roundResult === prevRoundResultRef.current) return;
    prevRoundResultRef.current = roundResult;

    const handStr = handToString(roundResult.calledHand);
    const exists = roundResult.handExists;
    const msg = `Round result: ${handStr} — ${exists ? 'the hand exists' : 'the hand is fake'}`;
    announce(msg, 'assertive');

    // Announce eliminations
    if (roundResult.eliminatedPlayerIds.length > 0) {
      const eliminated = roundResult.eliminatedPlayerIds
        .map(id => roundResult.revealedCards.find(c => c.playerId === id)?.playerName ?? 'A player')
        .join(', ');
      setTimeout(() => {
        announce(`${eliminated} eliminated`, 'assertive');
      }, 2000);
    }
  }, [roundResult, announce]);
}

function formatTurnAnnouncement(entry: TurnEntry, playerName: string): string | null {
  switch (entry.action) {
    case TurnAction.CALL:
      return entry.hand ? `${playerName} calls ${handToString(entry.hand)}` : null;
    case TurnAction.BULL:
      return `${playerName} calls bull`;
    case TurnAction.TRUE:
      return `${playerName} calls true`;
    case TurnAction.LAST_CHANCE_RAISE:
      return entry.hand ? `${playerName} raises to ${handToString(entry.hand)}` : null;
    case TurnAction.LAST_CHANCE_PASS:
      return `${playerName} passes`;
    default:
      return null;
  }
}
