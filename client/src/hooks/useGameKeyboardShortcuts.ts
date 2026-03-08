import { useEffect } from 'react';

interface ShortcutActions {
  /** Call bull — available when bull button is shown */
  onBull: (() => void) | null;
  /** Call true — available in bull phase */
  onTrue: (() => void) | null;
  /** Toggle the raise/call hand selector */
  onRaise: (() => void) | null;
  /** Submit the currently selected hand in the hand selector */
  onSubmitHand: (() => void) | null;
  /** Pass during last chance */
  onPass: (() => void) | null;
  /** Close hand selector or dismiss overlay */
  onEscape: (() => void) | null;
  /** Whether a full-screen overlay is showing (disables game shortcuts) */
  overlayActive: boolean;
}

/**
 * Keyboard shortcuts for in-game actions.
 *
 * - B → Bull
 * - T → True
 * - C → Open raise/call hand selector
 * - Enter → Submit selected hand
 * - P → Pass (last chance)
 * - Escape → Close hand selector / dismiss overlay
 *
 * Shortcuts are suppressed when the user is typing in an input/textarea,
 * or when a full-screen overlay (round result, transition) is active.
 */
export function useGameKeyboardShortcuts({
  onBull,
  onTrue,
  onRaise,
  onSubmitHand,
  onPass,
  onEscape,
  overlayActive,
}: ShortcutActions): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing in form fields
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // Escape always works — close overlays or hand selector
      if (e.key === 'Escape') {
        if (onEscape) {
          e.preventDefault();
          onEscape();
        }
        return;
      }

      // All other shortcuts suppressed while overlay is active
      if (overlayActive) return;

      switch (e.key.toLowerCase()) {
        case 'b':
          if (onBull) { e.preventDefault(); onBull(); }
          break;
        case 't':
          if (onTrue) { e.preventDefault(); onTrue(); }
          break;
        case 'c':
          if (onRaise) { e.preventDefault(); onRaise(); }
          break;
        case 'p':
          if (onPass) { e.preventDefault(); onPass(); }
          break;
        case 'enter':
          if (onSubmitHand) { e.preventDefault(); onSubmitHand(); }
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onBull, onTrue, onRaise, onSubmitHand, onPass, onEscape, overlayActive]);
}
