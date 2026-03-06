import { useState, useEffect, useCallback } from 'react';
import { TutorialOverlay } from './TutorialOverlay.js';
import { shouldShowFirstGameTooltips, markFirstGameTooltipsShown } from '../utils/tutorialProgress.js';

interface TooltipStep {
  id: string;
  /** CSS selector for the element to highlight */
  target: string;
  /** Tooltip position relative to the target */
  position: 'top' | 'bottom' | 'left' | 'right';
  /** Title text */
  title: string;
  /** Body text */
  body: string;
  /** Only show this tooltip when the target element is in the DOM */
  requiresTarget?: boolean;
}

const TOOLTIP_STEPS: TooltipStep[] = [
  {
    id: 'players',
    target: '[data-tooltip="players"]',
    position: 'bottom',
    title: 'Player List',
    body: 'See all players, their card count, and whose turn it is. The gold glow shows the active player.',
  },
  {
    id: 'cards',
    target: '[data-tooltip="my-cards"]',
    position: 'bottom',
    title: 'Your Cards',
    body: 'These are your cards — only you can see them. Claims are based on ALL players\' combined cards.',
  },
  {
    id: 'turn',
    target: '[data-tooltip="turn-indicator"]',
    position: 'bottom',
    title: 'Turn Indicator',
    body: 'Shows whose turn it is and the current phase. When it\'s your turn, choose to Call, Raise, or challenge with Bull!',
  },
  {
    id: 'actions',
    target: '[data-tooltip="action-area"]',
    position: 'top',
    title: 'Actions',
    body: 'BULL = you don\'t believe the call. TRUE = you do believe it. Raise = call an even higher hand. Use these strategically!',
    requiresTarget: true,
  },
  {
    id: 'hand-selector',
    target: '[data-tooltip="hand-selector"]',
    position: 'top',
    title: 'Hand Selector',
    body: 'Pick a hand type on the left wheel, then choose the rank or suit on the right. Remember: Flush is LOWER than Three of a Kind!',
    requiresTarget: true,
  },
  {
    id: 'call-history',
    target: '[data-tooltip="call-history"]',
    position: 'top',
    title: 'Call History',
    body: 'Track what everyone has called this round. Use it to spot bluffs and plan your strategy!',
    requiresTarget: true,
  },
];

interface GameTooltipsProps {
  /** Whether the game is in an active state (not in transition/overlay) */
  gameActive: boolean;
}

/**
 * Shows contextual tooltips on key game UI elements during the player's
 * first real game. Each tooltip highlights a different element and advances
 * on tap/click. Dismissed permanently via localStorage.
 */
export function GameTooltips({ gameActive }: GameTooltipsProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Check on mount whether we should show tooltips
  useEffect(() => {
    if (shouldShowFirstGameTooltips()) {
      // Small delay so the game UI has time to render and mount elements
      const timer = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(timer);
    } else {
      setDismissed(true);
    }
  }, []);

  const currentStep = TOOLTIP_STEPS[stepIndex];

  // Skip steps whose target isn't in the DOM yet (e.g., hand selector not open)
  useEffect(() => {
    if (!visible || dismissed || !currentStep?.requiresTarget) return;
    const el = document.querySelector(currentStep.target);
    if (!el) {
      // Skip to next step or finish
      if (stepIndex < TOOLTIP_STEPS.length - 1) {
        setStepIndex(prev => prev + 1);
      } else {
        markFirstGameTooltipsShown();
        setDismissed(true);
      }
    }
  }, [visible, dismissed, stepIndex, currentStep]);

  const advance = useCallback(() => {
    if (stepIndex < TOOLTIP_STEPS.length - 1) {
      setStepIndex(prev => prev + 1);
    } else {
      markFirstGameTooltipsShown();
      setDismissed(true);
    }
  }, [stepIndex]);

  const dismiss = useCallback(() => {
    markFirstGameTooltipsShown();
    setDismissed(true);
  }, []);

  if (dismissed || !visible || !gameActive || !currentStep) return null;

  const isLast = stepIndex === TOOLTIP_STEPS.length - 1;

  return (
    <TutorialOverlay
      targetSelector={currentStep.target}
      position={currentStep.position}
      visible
      onBackdropTap={advance}
    >
      <h3 className="font-display text-base font-bold text-[var(--gold)] mb-1">
        {currentStep.title}
      </h3>
      <p className="text-sm text-[#e8e0d4] mb-3">
        {currentStep.body}
      </p>
      <div className="flex justify-between items-center">
        <button
          onClick={dismiss}
          className="text-xs text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors"
        >
          Skip tips
        </button>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-[var(--gold-dim)] font-mono">
            {stepIndex + 1}/{TOOLTIP_STEPS.length}
          </span>
          <button onClick={advance} className="btn-gold px-4 py-1.5 text-sm font-semibold">
            {isLast ? 'Got it!' : 'Next'}
          </button>
        </div>
      </div>
    </TutorialOverlay>
  );
}
