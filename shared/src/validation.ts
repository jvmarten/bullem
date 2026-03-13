/**
 * Centralized game settings validation.
 *
 * Validates untrusted client input against known allowlists and type constraints.
 * Used by the server to validate settings from the host before applying them.
 * Pure function — no I/O, no side effects.
 */

import {
  MIN_MAX_CARDS, MAX_CARDS, ONLINE_TURN_TIMER_OPTIONS,
  MAX_PLAYERS_OPTIONS, LAST_CHANCE_MODES, BEST_OF_OPTIONS, JOKER_COUNT_OPTIONS,
} from './constants.js';
import { BotSpeed } from './types.js';
import type { BotLevelCategory } from './types.js';

/** Valid bot level category values, defined once to prevent duplication. */
export const BOT_LEVEL_CATEGORIES: readonly BotLevelCategory[] = ['easy', 'normal', 'hard', 'mixed'] as const;

/** Result of settings validation — either valid settings or an error message. */
export type SettingsValidationResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Validate individual game settings fields from untrusted client input.
 * Only validates the settings object fields — does not validate host
 * permissions, room phase, or any other contextual constraints.
 *
 * @param settings The raw settings object from the client (already verified as a plain object).
 */
export function validateGameSettings(settings: Record<string, unknown>): SettingsValidationResult {
  // ── Required fields ──────────────────────────────────────────────────

  const { maxCards, turnTimer } = settings;

  if (typeof maxCards !== 'number' || maxCards < MIN_MAX_CARDS || maxCards > MAX_CARDS || !Number.isInteger(maxCards)) {
    return { ok: false, error: 'Invalid max cards setting' };
  }

  if (typeof turnTimer !== 'number' || !(ONLINE_TURN_TIMER_OPTIONS as readonly number[]).includes(turnTimer)) {
    return { ok: false, error: 'Invalid turn timer setting' };
  }

  // ── Optional fields ──────────────────────────────────────────────────

  const { maxPlayers } = settings;
  if (maxPlayers !== undefined) {
    if (typeof maxPlayers !== 'number' || !(MAX_PLAYERS_OPTIONS as readonly number[]).includes(maxPlayers)) {
      return { ok: false, error: 'Invalid max players setting' };
    }
  }

  const { botSpeed } = settings;
  if (botSpeed !== undefined && !Object.values(BotSpeed).includes(botSpeed as BotSpeed)) {
    return { ok: false, error: 'Invalid bot speed setting' };
  }

  const { lastChanceMode } = settings;
  if (lastChanceMode !== undefined && !(LAST_CHANCE_MODES as readonly string[]).includes(lastChanceMode as string)) {
    return { ok: false, error: 'Invalid last chance mode setting' };
  }

  const { bestOf } = settings;
  if (bestOf !== undefined && !(BEST_OF_OPTIONS as readonly number[]).includes(bestOf as number)) {
    return { ok: false, error: 'Invalid best-of setting' };
  }

  const { botLevelCategory } = settings;
  if (botLevelCategory !== undefined && !(BOT_LEVEL_CATEGORIES as readonly string[]).includes(botLevelCategory as string)) {
    return { ok: false, error: 'Invalid bot level category' };
  }

  const { jokerCount } = settings;
  if (jokerCount !== undefined && !(JOKER_COUNT_OPTIONS as readonly number[]).includes(jokerCount as number)) {
    return { ok: false, error: 'Invalid joker count (must be 0, 1, or 2)' };
  }

  // ── Boolean fields — reject non-boolean values from untrusted input ──
  for (const field of ['isPublic', 'ranked', 'allowSpectators', 'spectatorsCanSeeCards'] as const) {
    if (settings[field] !== undefined && typeof settings[field] !== 'boolean') {
      return { ok: false, error: `Invalid ${field} setting (must be boolean)` };
    }
  }

  return { ok: true };
}
