import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { TurnAction } from '@bull-em/shared';
import type { ClientGameState, RoundResult, PlayerId, TurnEntry } from '@bull-em/shared';
import { createSoundController } from './soundEngine.js';
import type { SoundName } from './soundEngine.js';

// Single shared instance so mute state is consistent
const sound = createSoundController();

// Tiny external-store for muted/volume state so React re-renders on toggle
let soundListeners = new Set<() => void>();
function subscribeSoundState(cb: () => void) {
  soundListeners.add(cb);
  return () => { soundListeners.delete(cb); };
}
function getMuted() { return sound.muted; }
function getVolume() { return sound.volume; }

function notifyListeners() {
  soundListeners.forEach(cb => cb());
}

export function useSound() {
  const muted = useSyncExternalStore(subscribeSoundState, getMuted);
  const volume = useSyncExternalStore(subscribeSoundState, getVolume);

  const play = useCallback((name: SoundName) => {
    sound.play(name);
  }, []);

  const toggleMute = useCallback(() => {
    sound.toggleMute();
    notifyListeners();
  }, []);

  const setVolume = useCallback((v: number) => {
    sound.setVolume(v);
    notifyListeners();
  }, []);

  return { play, muted, toggleMute, volume, setVolume };
}

/**
 * Hook that watches game state changes and plays appropriate sounds.
 * Must be called inside a component that has access to game state.
 */
export function useGameSounds(
  gameState: ClientGameState | null,
  roundResult: RoundResult | null,
  winnerId: PlayerId | null,
  playerId: string | null,
) {
  const { play } = useSound();
  const prevHistoryLenRef = useRef(0);
  const prevRoundNumberRef = useRef(0);
  const prevCurrentPlayerRef = useRef<string | null>(null);
  const prevRoundResultRef = useRef<RoundResult | null>(null);
  const prevWinnerRef = useRef<PlayerId | null>(null);

  // React to turn history changes (new calls/bulls/trues)
  useEffect(() => {
    if (!gameState) return;

    const history = gameState.turnHistory;
    const prevLen = prevHistoryLenRef.current;

    if (history.length > prevLen) {
      // Play sound for each new entry
      for (let i = prevLen; i < history.length; i++) {
        const entry: TurnEntry = history[i];
        switch (entry.action) {
          case TurnAction.CALL:
          case TurnAction.LAST_CHANCE_RAISE:
            play('callMade');
            break;
          case TurnAction.BULL:
            play('bullCalled');
            break;
          case TurnAction.TRUE:
            play('trueCalled');
            break;
          // LAST_CHANCE_PASS is silent
        }
      }
    }

    prevHistoryLenRef.current = history.length;
  }, [gameState?.turnHistory.length, play, gameState]);

  // React to new round starting (card deal)
  useEffect(() => {
    if (!gameState) return;
    const roundNum = gameState.roundNumber;

    if (roundNum > prevRoundNumberRef.current && prevRoundNumberRef.current > 0) {
      play('cardDeal');
    }

    prevRoundNumberRef.current = roundNum;
  }, [gameState?.roundNumber, play, gameState]);

  // React to it becoming your turn
  useEffect(() => {
    if (!gameState || !playerId) return;
    const currentPlayer = gameState.currentPlayerId;

    if (
      currentPlayer === playerId
      && prevCurrentPlayerRef.current !== null
      && prevCurrentPlayerRef.current !== playerId
    ) {
      play('yourTurn');
    }

    prevCurrentPlayerRef.current = currentPlayer;
  }, [gameState?.currentPlayerId, playerId, play, gameState]);

  // React to round result
  useEffect(() => {
    if (!roundResult || roundResult === prevRoundResultRef.current) return;
    prevRoundResultRef.current = roundResult;

    if (!playerId) return;

    if (roundResult.eliminatedPlayerIds.includes(playerId)) {
      play('eliminated');
    } else if (roundResult.penalties[playerId] !== undefined) {
      const wasPenalized = roundResult.penalizedPlayerIds?.includes(playerId) ?? false;
      play(wasPenalized ? 'roundLose' : 'roundWin');
    }
  }, [roundResult, playerId, play, gameState]);

  // React to game over
  useEffect(() => {
    if (!winnerId || winnerId === prevWinnerRef.current) return;
    prevWinnerRef.current = winnerId;
    play('gameOver');
  }, [winnerId, play]);
}
