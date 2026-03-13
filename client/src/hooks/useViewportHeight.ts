import { useEffect } from 'react';

const LANDSCAPE_MQ = '(orientation: landscape) and (min-width: 600px), (min-width: 1024px)';

/**
 * Dynamically toggles `viewport-fit=cover` on the viewport meta tag based on
 * orientation. This sidesteps an iOS Safari bug where `viewport-fit=cover`
 * causes the bottom safe area to render incorrectly on first portrait paint.
 *
 * - **Portrait:** no `viewport-fit=cover` → browser handles safe areas
 *   natively (no bottom bar, top status bar works)
 * - **Landscape:** `viewport-fit=cover` enabled → app extends behind side
 *   safe areas so the gradient bleeds behind the notch seamlessly
 *
 * iOS Safari supports dynamic viewport meta changes — the page re-layouts
 * during the orientation change animation, so there's no visible flash.
 *
 * After modifying the viewport meta, we force a layout reflow to ensure the
 * browser recalculates hit-test regions for all interactive elements. Without
 * this, mobile Safari can desync visual rendering from touch targets after
 * orientation changes (especially with position:fixed on body), causing button
 * hitboxes to shift right of their visual position.
 */
export function useViewportHeight(): void {
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta) return;

    const mql = window.matchMedia(LANDSCAPE_MQ);

    function update(isLandscape: boolean) {
      const content = meta!.getAttribute('content') ?? '';
      if (isLandscape) {
        // Add viewport-fit=cover if not already present
        if (!content.includes('viewport-fit=cover')) {
          meta!.setAttribute('content', content + ', viewport-fit=cover');
        }
      } else {
        // Remove viewport-fit=cover
        meta!.setAttribute(
          'content',
          content.replace(/,?\s*viewport-fit=cover/g, ''),
        );
      }

      // Force the browser to recalculate layout and hit-test regions.
      // Mobile Safari can desync touch targets from visual positions after
      // viewport meta changes — reading offsetHeight triggers a synchronous
      // reflow, and the follow-up rAF ensures the composited layer tree is
      // fully updated before the next frame paints.
      void document.documentElement.offsetHeight;
      requestAnimationFrame(() => {
        window.scrollTo(0, 0);
      });
    }

    // Set initial state
    update(mql.matches);

    const handler = (e: MediaQueryListEvent) => update(e.matches);
    mql.addEventListener('change', handler);

    return () => {
      mql.removeEventListener('change', handler);
    };
  }, []);
}
