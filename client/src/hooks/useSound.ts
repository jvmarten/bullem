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
  // Use -1 as sentinel: "not yet initialized from game state". On the first
  // game state we receive, we record the current values without playing any
  // sounds. This prevents stale sounds on mount, refresh, and reconnection
  // (where the full turn history arrives in bulk).
  const prevHistoryLenRef = useRef(-1);
  const prevRoundNumberRef = useRef(-1);
  const prevCurrentPlayerRef = useRef<string | null | undefined>(undefined);
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

    // First time receiving state — just record lengths, don't play sounds.
    // This handles mount, refresh, and reconnection where history arrives in bulk.
    if (prevLen === -1) {
      prevHistoryLenRef.current = history.length;
      return;
    }

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
  }, [historyLen, play, playerId]);

  // React to new round starting (card deal).
  // Track roundNumber changes but defer the sound until the round result overlay
  // has been dismissed, so the deal sound plays when the new round is visually
  // starting — not when the previous round's result is still on screen.
  const roundNumber = gameState?.roundNumber ?? 0;
  const pendingDealSoundRef = useRef(false);

  useEffect(() => {
    // First time receiving state — just record, don't play sound
    if (prevRoundNumberRef.current === -1) {
      prevRoundNumberRef.current = roundNumber;
      return;
    }
    if (roundNumber > prevRoundNumberRef.current) {
      if (roundResult) {
        // Result overlay is showing — defer the sound
        pendingDealSoundRef.current = true;
      } else {
        play('cardDeal');
      }
    }
    prevRoundNumberRef.current = roundNumber;
  }, [roundNumber, play, roundResult]);

  // Play deferred card deal sound when round result overlay is dismissed
  useEffect(() => {
    if (!roundResult && pendingDealSoundRef.current) {
      pendingDealSoundRef.current = false;
      play('cardDeal');
    }
  }, [roundResult, play]);

  // React to it becoming your turn
  const currentPlayer = gameState?.currentPlayerId ?? null;
  useEffect(() => {
    if (!currentPlayer || !playerId) return;

    // First time receiving state — just record, don't play sound
    if (prevCurrentPlayerRef.current === undefined) {
      prevCurrentPlayerRef.current = currentPlayer;
      return;
    }

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

  // Track winnerId changes (no sound here — victory/gameOver audio is played
  // on the ResultsPage so it coincides with the "You Win!" screen, not the
  // round-ending overlay that precedes it).
  useEffect(() => {
    if (!winnerId || winnerId === prevWinnerRef.current) return;
    prevWinnerRef.current = winnerId;
  }, [winnerId]);
}
