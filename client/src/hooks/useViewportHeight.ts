import { useEffect } from 'react';

/**
 * Sets a CSS custom property `--vh-real` on the document element equal to
 * `window.innerHeight` in pixels. Updates on resize and orientation change.
 *
 * iOS Safari reports `window.innerHeight` accurately even with
 * `viewport-fit=cover`, unlike CSS viewport units (`100dvh`, `100vh`)
 * which can be wrong on first paint or during orientation transitions —
 * leaving a visible gap at the bottom of the screen.
 *
 * Usage in CSS: `height: var(--vh-real, 100dvh);`
 */
export function useViewportHeight(): void {
  useEffect(() => {
    function update() {
      document.documentElement.style.setProperty(
        '--vh-real',
        `${window.innerHeight}px`,
      );
    }

    update();

    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);

    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);
}
