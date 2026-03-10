/**
 * Tracks tutorial completion, first-game state, and tooltip dismissal via localStorage.
 *
 * Keys:
 * - bull-em-tutorial-completed: "true" once the tutorial is finished
 * - bull-em-first-game-tooltips-shown: "true" once in-game tooltips have been dismissed
 * - bull-em-first-game-played: "true" once the player has completed their first real game
 * - bull-em-tutorial-step: highest step index reached in the tutorial (for resume)
 */

const TUTORIAL_COMPLETED_KEY = 'bull-em-tutorial-completed';
const FIRST_GAME_TOOLTIPS_KEY = 'bull-em-first-game-tooltips-shown';
const FIRST_GAME_PLAYED_KEY = 'bull-em-first-game-played';
const TUTORIAL_STEP_KEY = 'bull-em-tutorial-step';
const QUICK_DRAW_HINT_KEY = 'bull-em-quick-draw-hint-shown';

/* ── Tutorial completion ─────────────────────────────── */

export function isTutorialCompleted(): boolean {
  return localStorage.getItem(TUTORIAL_COMPLETED_KEY) === 'true';
}

export function markTutorialCompleted(): void {
  localStorage.setItem(TUTORIAL_COMPLETED_KEY, 'true');
}

/* ── First-game tooltips ─────────────────────────────── */

export function shouldShowFirstGameTooltips(): boolean {
  return localStorage.getItem(FIRST_GAME_TOOLTIPS_KEY) !== 'true';
}

export function markFirstGameTooltipsShown(): void {
  localStorage.setItem(FIRST_GAME_TOOLTIPS_KEY, 'true');
}

/* ── First game tracking ─────────────────────────────── */

/** Returns true if the player hasn't yet completed a real game. */
export function isFirstGame(): boolean {
  return localStorage.getItem(FIRST_GAME_PLAYED_KEY) !== 'true';
}

/** Mark that the player has completed their first real game. */
export function markFirstGamePlayed(): void {
  localStorage.setItem(FIRST_GAME_PLAYED_KEY, 'true');
}

/* ── Tutorial step progress (for resume) ─────────────── */

/** Get the highest tutorial step the player has reached (0-indexed). Returns 0 if none saved. */
export function getTutorialStepReached(): number {
  const raw = localStorage.getItem(TUTORIAL_STEP_KEY);
  if (!raw) return 0;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/** Save the highest tutorial step reached. Only updates if higher than the current saved value. */
export function setTutorialStepReached(step: number): void {
  const current = getTutorialStepReached();
  if (step > current) {
    localStorage.setItem(TUTORIAL_STEP_KEY, String(step));
  }
}

/** Clear saved tutorial step progress so the tutorial starts from the beginning next time. */
export function clearTutorialStepProgress(): void {
  localStorage.removeItem(TUTORIAL_STEP_KEY);
}

/* ── Quick Draw hint ───────────────────────────────────── */

/** Returns true if the Quick Draw hint has NOT been shown yet. */
export function shouldShowQuickDrawHint(): boolean {
  return localStorage.getItem(QUICK_DRAW_HINT_KEY) !== 'true';
}

/** Mark the Quick Draw hint as shown so it never appears again. */
export function markQuickDrawHintShown(): void {
  localStorage.setItem(QUICK_DRAW_HINT_KEY, 'true');
}
