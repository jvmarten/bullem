import { useEffect, useState, useRef, useCallback, useLayoutEffect, type ReactNode } from 'react';

export type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

interface TutorialOverlayProps {
  /** CSS selector or ref-based element to highlight. Null = no highlight (centered tooltip). */
  targetSelector?: string | null;
  /** Tooltip content */
  children: ReactNode;
  /** Preferred tooltip position relative to the highlighted element */
  position?: TooltipPosition;
  /** Whether to show the overlay */
  visible: boolean;
  /** Called when the overlay backdrop is tapped (optional dismiss) */
  onBackdropTap?: () => void;
}

/**
 * Tutorial highlight + tooltip overlay. Highlights a target element by
 * cutting a rounded hole in a dark backdrop and positioning a tooltip
 * near it. When no target is specified, the tooltip is centered on screen.
 */
export function TutorialOverlay({
  targetSelector,
  children,
  position = 'bottom',
  visible,
  onBackdropTap,
}: TutorialOverlayProps) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const measure = useCallback(() => {
    if (!targetSelector) { setRect(null); return; }
    const el = document.querySelector(targetSelector);
    if (el) {
      setRect(el.getBoundingClientRect());
    } else {
      setRect(null);
    }
  }, [targetSelector]);

  useEffect(() => {
    if (!visible) return;
    measure();
    // Re-measure after a short delay so layout has fully settled
    const raf = requestAnimationFrame(() => measure());
    const delayed = setTimeout(() => measure(), 100);

    // Re-measure on scroll/resize
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);

    // Re-measure when the DOM layout changes (e.g. content shifts the target)
    const observer = new MutationObserver(() => measure());
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(delayed);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      observer.disconnect();
    };
  }, [visible, measure]);

  if (!visible) return null;

  const pad = 8; // padding around highlighted element

  // Build clip-path to cut a rounded rect hole in the backdrop
  const clipPath = rect
    ? `polygon(
        0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
        ${rect.left - pad}px ${rect.top - pad}px,
        ${rect.left - pad}px ${rect.bottom + pad}px,
        ${rect.right + pad}px ${rect.bottom + pad}px,
        ${rect.right + pad}px ${rect.top - pad}px,
        ${rect.left - pad}px ${rect.top - pad}px
      )`
    : undefined;

  // Clamp tooltip position so it stays within viewport
  const [clampedStyle, setClampedStyle] = useState<React.CSSProperties>({});

  useLayoutEffect(() => {
    if (!visible) return;

    const style: React.CSSProperties = {};
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8; // minimum distance from viewport edge
    const gap = 12;

    if (rect) {
      switch (position) {
        case 'bottom':
          style.top = rect.bottom + pad + gap;
          style.left = rect.left + rect.width / 2;
          style.transform = 'translateX(-50%)';
          break;
        case 'top':
          style.bottom = vh - rect.top + pad + gap;
          style.left = rect.left + rect.width / 2;
          style.transform = 'translateX(-50%)';
          break;
        case 'left':
          style.top = rect.top + rect.height / 2;
          style.right = vw - rect.left + pad + gap;
          style.transform = 'translateY(-50%)';
          break;
        case 'right':
          style.top = rect.top + rect.height / 2;
          style.left = rect.right + pad + gap;
          style.transform = 'translateY(-50%)';
          break;
      }
    } else {
      style.top = '50%';
      style.left = '50%';
      style.transform = 'translate(-50%, -50%)';
    }

    setClampedStyle(style);

    // After paint, check if tooltip overflows and clamp
    requestAnimationFrame(() => {
      const el = tooltipRef.current;
      if (!el) return;
      const tr = el.getBoundingClientRect();
      const fixes: React.CSSProperties = {};
      let needsFix = false;

      // Horizontal clamping
      if (tr.left < margin) {
        fixes.left = margin;
        fixes.transform = (style.transform as string)?.replace('translateX(-50%)', '') || 'none';
        needsFix = true;
      } else if (tr.right > vw - margin) {
        fixes.left = undefined;
        fixes.right = margin;
        fixes.transform = (style.transform as string)?.replace('translateX(-50%)', '') || 'none';
        needsFix = true;
      }

      // Vertical clamping
      if (tr.top < margin) {
        fixes.top = margin;
        fixes.bottom = undefined;
        fixes.transform = fixes.transform ?? ((style.transform as string)?.replace('translateY(-50%)', '') || 'none');
        needsFix = true;
      } else if (tr.bottom > vh - margin) {
        fixes.bottom = margin;
        fixes.top = undefined;
        fixes.transform = fixes.transform ?? ((style.transform as string)?.replace('translateY(-50%)', '') || 'none');
        needsFix = true;
      }

      if (needsFix) {
        setClampedStyle(prev => ({ ...prev, ...fixes }));
      }
    });
  }, [visible, rect, position, pad]);

  return (
    <div className="fixed inset-0 z-[100]" aria-live="polite">
      {/* Dark backdrop with optional cutout */}
      <div
        className="absolute inset-0 transition-all duration-300"
        style={{
          background: 'rgba(5, 20, 10, 0.75)',
          clipPath,
        }}
        onClick={onBackdropTap}
      />

      {/* Highlight ring around target */}
      {rect && (
        <div
          className="absolute rounded-lg pointer-events-none animate-pulse-glow"
          style={{
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            border: '2px solid var(--gold)',
            boxShadow: '0 0 16px var(--gold-glow)',
          }}
        />
      )}

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className="absolute glass-raised p-4 rounded-xl max-w-[min(85vw,360px)] animate-fade-in"
        style={{
          ...clampedStyle,
          border: '1px solid var(--gold-dim)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
        }}
      >
        {children}
      </div>
    </div>
  );
}
