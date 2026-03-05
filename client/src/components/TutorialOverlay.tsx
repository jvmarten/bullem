import { useEffect, useState, useRef, useCallback, type ReactNode } from 'react';

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
    // Re-measure on scroll/resize
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
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

  // Tooltip positioning
  const tooltipStyle: React.CSSProperties = {};
  if (rect) {
    const gap = 12;
    switch (position) {
      case 'bottom':
        tooltipStyle.top = rect.bottom + pad + gap;
        tooltipStyle.left = rect.left + rect.width / 2;
        tooltipStyle.transform = 'translateX(-50%)';
        break;
      case 'top':
        tooltipStyle.bottom = window.innerHeight - rect.top + pad + gap;
        tooltipStyle.left = rect.left + rect.width / 2;
        tooltipStyle.transform = 'translateX(-50%)';
        break;
      case 'left':
        tooltipStyle.top = rect.top + rect.height / 2;
        tooltipStyle.right = window.innerWidth - rect.left + pad + gap;
        tooltipStyle.transform = 'translateY(-50%)';
        break;
      case 'right':
        tooltipStyle.top = rect.top + rect.height / 2;
        tooltipStyle.left = rect.right + pad + gap;
        tooltipStyle.transform = 'translateY(-50%)';
        break;
    }
  } else {
    // Centered on screen
    tooltipStyle.top = '50%';
    tooltipStyle.left = '50%';
    tooltipStyle.transform = 'translate(-50%, -50%)';
  }

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
          ...tooltipStyle,
          border: '1px solid var(--gold-dim)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
        }}
      >
        {children}
      </div>
    </div>
  );
}
