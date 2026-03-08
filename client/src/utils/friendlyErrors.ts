/**
 * Maps server-side error strings to user-friendly messages for display in toasts.
 * Server errors are developer-oriented; this ensures players see helpful, clear text.
 */

const ERROR_MAP: ReadonlyMap<string, string> = new Map([
  // room:join errors
  ['Room not found', 'Room not found — it may have been closed'],
  ['Room is full', 'This room is full'],
  ['Game already in progress', "Can't join — a game is already in progress"],
  ['Name already taken in this room', 'That name is already taken — try a different one'],
  ['Invalid room code', "That doesn't look like a valid room code"],
  ['Invalid name (1-20 chars, letters/numbers/spaces)', 'Name must be 1–20 characters using letters, numbers, or spaces'],

  // room:create errors
  ['Already in a room — leave or close it first', "You're already in a room — leave it first"],

  // timeout from client-side withTimeout wrapper
  ['Request timed out', 'Connection timed out — please check your internet and try again'],

  // spectate errors
  ['Spectating not allowed', 'This room has spectating disabled'],
  ['No game in progress', 'No game in progress to spectate'],
  ['No live games available', 'No live games to watch right now'],
]);

/** Return a user-friendly error message, falling back to the original if no mapping exists. */
export function friendlyError(message: string): string {
  return ERROR_MAP.get(message) ?? message;
}
