import { useState, useEffect, useCallback } from 'react';
import { shouldShowQuickDrawHint, markQuickDrawHintShown } from '../utils/tutorialProgress.js';

interface QuickDrawHintProps {
  /** Whether the player can currently raise (it's their turn and raise is valid) */
  visible: boolean;
}

/**
 * A one-time callout that teaches users about Quick Draw (tap cards for suggestions).
 * Shows on the player's first actionable turn, then persists dismissal in localStorage.
 * Renders as a small floating hint with an upward arrow pointing at the card area.
 */
export function QuickDrawHint({ visible }: QuickDrawHintProps) {
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!visible || dismissed) return;
    if (!shouldShowQuickDrawHint()) {
      setDismissed(true);
      return;
    }
    // Brief delay so the cards have rendered and the player sees them first
    const timer = setTimeout(() => setShow(true), 800);
    return () => clearTimeout(timer);
  }, [visible, dismissed]);

  // Auto-dismiss after 6 seconds
  useEffect(() => {
    if (!show) return;
    const timer = setTimeout(() => dismiss(), 6000);
    return () => clearTimeout(timer);
  }, [show]);

  const dismiss = useCallback(() => {
    markQuickDrawHintShown();
    setShow(false);
    setDismissed(true);
  }, []);

  if (!show || dismissed) return null;

  return (
    <div className="quick-draw-hint animate-quick-draw-hint-in" onClick={dismiss}>
      {/* Upward-pointing arrow */}
      <div className="quick-draw-hint-arrow" />
      <div className="quick-draw-hint-content">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
        <span>Tap your cards for quick suggestions</span>
      </div>
    </div>
  );
}
