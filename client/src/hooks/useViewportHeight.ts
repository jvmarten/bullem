import { useEffect } from 'react';

const LANDSCAPE_MQ = '(orientation: landscape) and (min-width: 600px), (min-width: 1024px)';

/**
 * Force the browser to fully recalculate the positioning context and
 * hit-test regions. Mobile Safari desyncs touch targets from visual
 * positions after viewport meta changes when body uses position:fixed.
 * Toggling body out of fixed positioning and back forces the browser to
 * rebuild the entire layout and compositing tree, re-syncing hitboxes.
 */
function forceLayoutResync(): void {
  const body = document.body;
  body.style.position = 'static';
  void body.offsetHeight; // synchronous reflow with new positioning
  body.style.position = 'fixed';
  void body.offsetHeight; // synchronous reflow back to fixed

  // Double rAF to ensure the compositor fully processes the layout
  // change before the next paint frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.scrollTo(0, 0);
    });
  });
}

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

      forceLayoutResync();
    }

    // Set initial state
    update(mql.matches);

    const handler = (e: MediaQueryListEvent) => update(e.matches);
    mql.addEventListener('change', handler);

    // Also listen for resize as a safety net — on iOS Safari, the media
    // query change event can fire before the viewport has fully settled.
    // A follow-up resize event arrives once layout is finalized, giving us
    // a second chance to re-sync hit-test regions.
    let lastWidth = window.innerWidth;
    let lastHeight = window.innerHeight;
    function onResize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      // Only re-sync when dimensions actually changed (orientation flip),
      // not on every minor resize (keyboard, scroll bar)
      if (w !== lastWidth || h !== lastHeight) {
        lastWidth = w;
        lastHeight = h;
        forceLayoutResync();
      }
    }
    window.addEventListener('resize', onResize);

    return () => {
      mql.removeEventListener('change', handler);
      window.removeEventListener('resize', onResize);
    };
  }, []);
}
