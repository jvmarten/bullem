/**
 * Seat positions for the roundtable layout.
 * Maps (playerCount, seatIndex) → { top, left } as percentages of the table container.
 * Seat 0 is always the local player at bottom center.
 * Seats go clockwise from bottom center.
 */

export interface SeatPosition {
  top: string;   // CSS top as %
  left: string;  // CSS left as %
}

const layouts: Record<number, SeatPosition[]> = {
  2: [
    { top: '88%', left: '50%' },
    { top: '5%', left: '50%' },
  ],
  3: [
    { top: '88%', left: '50%' },
    { top: '15%', left: '18%' },
    { top: '15%', left: '82%' },
  ],
  4: [
    { top: '88%', left: '50%' },
    { top: '45%', left: '8%' },
    { top: '5%', left: '50%' },
    { top: '45%', left: '92%' },
  ],
  5: [
    { top: '88%', left: '50%' },
    { top: '68%', left: '8%' },
    { top: '12%', left: '15%' },
    { top: '12%', left: '85%' },
    { top: '68%', left: '92%' },
  ],
  6: [
    { top: '88%', left: '50%' },
    { top: '62%', left: '8%' },
    { top: '15%', left: '12%' },
    { top: '5%', left: '50%' },
    { top: '15%', left: '88%' },
    { top: '62%', left: '92%' },
  ],
  7: [
    { top: '88%', left: '50%' },
    { top: '70%', left: '8%' },
    { top: '30%', left: '5%' },
    { top: '5%', left: '30%' },
    { top: '5%', left: '70%' },
    { top: '30%', left: '95%' },
    { top: '70%', left: '92%' },
  ],
  8: [
    { top: '88%', left: '50%' },
    { top: '72%', left: '8%' },
    { top: '35%', left: '5%' },
    { top: '8%', left: '22%' },
    { top: '5%', left: '50%' },
    { top: '8%', left: '78%' },
    { top: '35%', left: '95%' },
    { top: '72%', left: '92%' },
  ],
  9: [
    { top: '88%', left: '50%' },
    { top: '75%', left: '8%' },
    { top: '42%', left: '4%' },
    { top: '12%', left: '14%' },
    { top: '3%', left: '38%' },
    { top: '3%', left: '62%' },
    { top: '12%', left: '86%' },
    { top: '42%', left: '96%' },
    { top: '75%', left: '92%' },
  ],
};

/** Default fallback position (center). */
const CENTER: SeatPosition = { top: '50%', left: '50%' };

/**
 * Returns the absolute-positioning (top/left %) for a player seat around the roundtable.
 * @param playerCount Total number of players (2-9)
 * @param seatIndex   Index of this seat (0 = local player, clockwise)
 */
export function getSeatPosition(playerCount: number, seatIndex: number): SeatPosition {
  const seats = layouts[playerCount];
  if (!seats || seatIndex >= seats.length) return CENTER;
  return seats[seatIndex] as SeatPosition;
}
