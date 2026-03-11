import { useState, useEffect } from 'react';

/**
 * Detects landscape orientation suitable for roundtable layout.
 * Returns true when:
 * - orientation is landscape AND viewport width >= 600px (tablet/phone landscape)
 * - OR viewport width >= 1024px (desktop, regardless of orientation)
 *
 * Matches the CSS breakpoint used for .landscape-only / .portrait-only.
 */
export function useIsLandscape(): boolean {
  const [isLandscape, setIsLandscape] = useState(() => matchLandscape());

  useEffect(() => {
    const mql = window.matchMedia(
      '(orientation: landscape) and (min-width: 600px), (min-width: 1024px)',
    );

    const handler = (e: MediaQueryListEvent) => setIsLandscape(e.matches);
    mql.addEventListener('change', handler);
    // Sync in case initial state drifted between SSR / first render
    setIsLandscape(mql.matches);

    return () => mql.removeEventListener('change', handler);
  }, []);

  return isLandscape;
}

function matchLandscape(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(
    '(orientation: landscape) and (min-width: 600px), (min-width: 1024px)',
  ).matches;
}
