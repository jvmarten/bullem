import { useEffect } from 'react';

/**
 * Prevents accidental tab close or refresh during a game session by showing
 * a browser-native "Leave site?" confirmation dialog (beforeunload).
 *
 * @param active Whether the guard is currently active (e.g., only when in a game)
 */
export function useNavigationGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [active]);
}
