/**
 * Seat positions for the roundtable layout.
 * Maps (playerCount, seatIndex) → { top, left } as percentages of the table container.
 * Seat 0 is always the local player at bottom center.
 * Seats go clockwise from bottom center.
 *
 * Positions are calibrated so opponent seats sit ON the table edge (border),
 * matching a real poker table layout. The table occupies roughly
 * top: 12%, left: 12%, width: 76%, height: 64% with a stadium border-radius.
 */

export interface SeatPosition {
  top: string;   // CSS top as %
  left: string;  // CSS left as %
}

/**
 * Seat positions placed on the table edge.
 * The table spans roughly x:[12%-88%], y:[12%-76%].
 * The edge of the stadium shape is where opponents should sit.
 * Seat 0 (local player) is slightly below the bottom edge.
 */
const layouts: Record<number, SeatPosition[]> = {
  2: [
    { top: '78%', left: '50%' },   // local player — below table
    { top: '14%', left: '50%' },   // top center — on table edge
  ],
  3: [
    { top: '78%', left: '50%' },
    { top: '18%', left: '22%' },   // top-left on edge
    { top: '18%', left: '78%' },   // top-right on edge
  ],
  4: [
    { top: '78%', left: '50%' },
    { top: '44%', left: '12%' },   // left side on edge
    { top: '14%', left: '50%' },   // top center on edge
    { top: '44%', left: '88%' },   // right side on edge
  ],
  5: [
    { top: '78%', left: '50%' },
    { top: '63%', left: '12%' },   // bottom-left on edge
    { top: '18%', left: '18%' },   // top-left on edge
    { top: '18%', left: '82%' },   // top-right on edge
    { top: '63%', left: '88%' },   // bottom-right on edge
  ],
  6: [
    { top: '78%', left: '50%' },
    { top: '56%', left: '12%' },   // left-lower on edge
    { top: '20%', left: '16%' },   // top-left on edge
    { top: '14%', left: '50%' },   // top center on edge
    { top: '20%', left: '84%' },   // top-right on edge
    { top: '56%', left: '88%' },   // right-lower on edge
  ],
  7: [
    { top: '78%', left: '50%' },
    { top: '63%', left: '12%' },   // bottom-left on edge
    { top: '30%', left: '12%' },   // top-left side on edge
    { top: '14%', left: '34%' },   // top-left on edge
    { top: '14%', left: '66%' },   // top-right on edge
    { top: '30%', left: '88%' },   // top-right side on edge
    { top: '63%', left: '88%' },   // bottom-right on edge
  ],
  8: [
    { top: '78%', left: '50%' },
    { top: '66%', left: '12%' },   // bottom-left on edge
    { top: '36%', left: '12%' },   // left side on edge
    { top: '14%', left: '26%' },   // top-left on edge
    { top: '14%', left: '50%' },   // top center on edge
    { top: '14%', left: '74%' },   // top-right on edge
    { top: '36%', left: '88%' },   // right side on edge
    { top: '66%', left: '88%' },   // bottom-right on edge
  ],
  9: [
    { top: '78%', left: '50%' },
    { top: '68%', left: '12%' },   // bottom-left on edge
    { top: '42%', left: '12%' },   // left-mid on edge
    { top: '18%', left: '18%' },   // top-left corner on edge
    { top: '14%', left: '38%' },   // top-left on edge
    { top: '14%', left: '62%' },   // top-right on edge
    { top: '18%', left: '82%' },   // top-right corner on edge
    { top: '42%', left: '88%' },   // right-mid on edge
    { top: '68%', left: '88%' },   // bottom-right on edge
  ],
  10: [
    { top: '78%', left: '50%' },
    { top: '68%', left: '12%' },   // bottom-left on edge
    { top: '44%', left: '12%' },   // left-mid-low on edge
    { top: '24%', left: '14%' },   // left-mid-high on edge
    { top: '14%', left: '32%' },   // top-left on edge
    { top: '14%', left: '50%' },   // top center on edge
    { top: '14%', left: '68%' },   // top-right on edge
    { top: '24%', left: '86%' },   // right-mid-high on edge
    { top: '44%', left: '88%' },   // right-mid-low on edge
    { top: '68%', left: '88%' },   // bottom-right on edge
  ],
  11: [
    { top: '78%', left: '50%' },
    { top: '70%', left: '12%' },   // bottom-left on edge
    { top: '49%', left: '12%' },   // left-mid-low on edge
    { top: '28%', left: '12%' },   // left-mid-high on edge
    { top: '16%', left: '22%' },   // top-left corner on edge
    { top: '14%', left: '40%' },   // top-left on edge
    { top: '14%', left: '60%' },   // top-right on edge
    { top: '16%', left: '78%' },   // top-right corner on edge
    { top: '28%', left: '88%' },   // right-mid-high on edge
    { top: '49%', left: '88%' },   // right-mid-low on edge
    { top: '70%', left: '88%' },   // bottom-right on edge
  ],
  12: [
    { top: '78%', left: '50%' },
    { top: '70%', left: '12%' },   // bottom-left on edge
    { top: '51%', left: '12%' },   // left-mid-low on edge
    { top: '32%', left: '12%' },   // left-mid-high on edge
    { top: '16%', left: '18%' },   // top-left corner on edge
    { top: '14%', left: '34%' },   // top-left on edge
    { top: '14%', left: '50%' },   // top center on edge
    { top: '14%', left: '66%' },   // top-right on edge
    { top: '16%', left: '82%' },   // top-right corner on edge
    { top: '32%', left: '88%' },   // right-mid-high on edge
    { top: '51%', left: '88%' },   // right-mid-low on edge
    { top: '70%', left: '88%' },   // bottom-right on edge
  ],
};

/** Default fallback position (center). */
const CENTER: SeatPosition = { top: '50%', left: '50%' };

/**
 * Returns the absolute-positioning (top/left %) for a player seat around the roundtable.
 * @param playerCount Total number of players (2-12)
 * @param seatIndex   Index of this seat (0 = local player, clockwise)
 */
export function getSeatPosition(playerCount: number, seatIndex: number): SeatPosition {
  const seats = layouts[playerCount];
  if (!seats || seatIndex >= seats.length) return CENTER;
  return seats[seatIndex] as SeatPosition;
}
