import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { TurnAction } from '@bull-em/shared';
import type { ClientGameState, RoundResult, PlayerId, TurnEntry, HandCall } from '@bull-em/shared';
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
function getHapticsEnabled() { return sound.hapticsEnabled; }

function notifyListeners() {
  soundListeners.forEach(cb => cb());
}

export function useSound() {
  const muted = useSyncExternalStore(subscribeSoundState, getMuted);
  const volume = useSyncExternalStore(subscribeSoundState, getVolume);
  const hapticsEnabled = useSyncExternalStore(subscribeSoundState, getHapticsEnabled);

  const play = useCallback((name: SoundName) => {
    sound.play(name);
  }, []);

  const playHandPreview = useCallback((hand: HandCall) => {
    sound.playHandPreview(hand);
  }, []);

  const toggleMute = useCallback(() => {
    sound.toggleMute();
    notifyListeners();
  }, []);

  const setVolume = useCallback((v: number) => {
    sound.setVolume(v);
    notifyListeners();
  }, []);

  const startLoop = useCallback((name: SoundName) => {
    sound.startLoop(name);
  }, []);

  const stopLoop = useCallback((name: SoundName) => {
    sound.stopLoop(name);
  }, []);

  const stopAllLoops = useCallback(() => {
    sound.stopAllLoops();
  }, []);

  const toggleHaptics = useCallback(() => {
    sound.toggleHaptics();
    notifyListeners();
  }, []);

  return { play, playHandPreview, muted, toggleMute, volume, setVolume, startLoop, stopLoop, stopAllLoops, hapticsEnabled, toggleHaptics };
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

  // Stable ref so effects below can access gameState without depending on it.
  // Previously, including `gameState` as a dependency caused every effect to
  // re-fire on every server broadcast (any player action, timer tick, etc.)
  // even when the specific field the effect watched hadn't changed.
  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;

  // React to turn history changes (new calls/bulls/trues)
  const historyLen = gameState?.turnHistory.length ?? 0;
  useEffect(() => {
    const gs = gameStateRef.current;
    if (!gs) return;

    const history = gs.turnHistory;
    const prevLen = prevHistoryLenRef.current;

    if (history.length > prevLen) {
      // Play sound for each new entry
      for (let i = prevLen; i < history.length; i++) {
        const entry: TurnEntry = history[i]!;
        switch (entry.action) {
          case TurnAction.CALL:
          case TurnAction.LAST_CHANCE_RAISE:
            play('callMade');
            break;
          case TurnAction.BULL:
            if (entry.playerId !== playerId) play('bullCalled');
            break;
          case TurnAction.TRUE:
            play('trueCalled');
            break;
          // LAST_CHANCE_PASS is silent
        }
      }
    }

    prevHistoryLenRef.current = history.length;
  }, [historyLen, play, playerId]);

  // React to new round starting (card deal).
  // Skip the sound on the initial mount (prevRoundNumber is 0) so that
  // spectators joining mid-game don't hear a stale deal sound.
  const roundNumber = gameState?.roundNumber ?? 0;
  useEffect(() => {
    if (prevRoundNumberRef.current > 0 && roundNumber > prevRoundNumberRef.current) {
      play('cardDeal');
    }
    prevRoundNumberRef.current = roundNumber;
  }, [roundNumber, play]);

  // React to it becoming your turn
  const currentPlayer = gameState?.currentPlayerId ?? null;
  useEffect(() => {
    if (!currentPlayer || !playerId) return;

    if (
      currentPlayer === playerId
      && prevCurrentPlayerRef.current !== null
      && prevCurrentPlayerRef.current !== playerId
    ) {
      play('yourTurn');
    }

    prevCurrentPlayerRef.current = currentPlayer;
  }, [currentPlayer, playerId, play]);

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
  }, [roundResult, playerId, play]);

  // React to game over
  useEffect(() => {
    if (!winnerId || winnerId === prevWinnerRef.current) return;
    prevWinnerRef.current = winnerId;
    play('gameOver');
  }, [winnerId, play]);
}
