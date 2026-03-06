/**
 * Tracks tutorial completion and first-game tooltip state via localStorage.
 *
 * Keys:
 * - bull-em-tutorial-completed: "true" once the tutorial is finished
 * - bull-em-first-game-tooltips-shown: "true" once in-game tooltips have been dismissed
 */

const TUTORIAL_COMPLETED_KEY = 'bull-em-tutorial-completed';
const FIRST_GAME_TOOLTIPS_KEY = 'bull-em-first-game-tooltips-shown';

export function isTutorialCompleted(): boolean {
  return localStorage.getItem(TUTORIAL_COMPLETED_KEY) === 'true';
}

export function markTutorialCompleted(): void {
  localStorage.setItem(TUTORIAL_COMPLETED_KEY, 'true');
}

export function shouldShowFirstGameTooltips(): boolean {
  return localStorage.getItem(FIRST_GAME_TOOLTIPS_KEY) !== 'true';
}

export function markFirstGameTooltipsShown(): void {
  localStorage.setItem(FIRST_GAME_TOOLTIPS_KEY, 'true');
}
