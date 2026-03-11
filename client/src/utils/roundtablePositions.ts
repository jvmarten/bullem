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

/**
 * Seat positions adjusted for the poker-table layout with card backs + avatar + name.
 * Seats are slightly inward from the edges to accommodate the larger seat elements.
 * Seat 0 (local player) is at bottom center, remaining seats go clockwise.
 */
const layouts: Record<number, SeatPosition[]> = {
  2: [
    { top: '76%', left: '50%' },
    { top: '14%', left: '50%' },
  ],
  3: [
    { top: '76%', left: '50%' },
    { top: '18%', left: '20%' },
    { top: '18%', left: '80%' },
  ],
  4: [
    { top: '76%', left: '50%' },
    { top: '45%', left: '10%' },
    { top: '14%', left: '50%' },
    { top: '45%', left: '90%' },
  ],
  5: [
    { top: '76%', left: '50%' },
    { top: '66%', left: '10%' },
    { top: '17%', left: '17%' },
    { top: '17%', left: '83%' },
    { top: '66%', left: '90%' },
  ],
  6: [
    { top: '76%', left: '50%' },
    { top: '60%', left: '10%' },
    { top: '18%', left: '14%' },
    { top: '14%', left: '50%' },
    { top: '18%', left: '86%' },
    { top: '60%', left: '90%' },
  ],
  7: [
    { top: '76%', left: '50%' },
    { top: '68%', left: '10%' },
    { top: '28%', left: '7%' },
    { top: '14%', left: '32%' },
    { top: '14%', left: '68%' },
    { top: '28%', left: '93%' },
    { top: '68%', left: '90%' },
  ],
  8: [
    { top: '76%', left: '50%' },
    { top: '70%', left: '10%' },
    { top: '34%', left: '7%' },
    { top: '14%', left: '24%' },
    { top: '14%', left: '50%' },
    { top: '14%', left: '76%' },
    { top: '34%', left: '93%' },
    { top: '70%', left: '90%' },
  ],
  9: [
    { top: '76%', left: '50%' },
    { top: '73%', left: '10%' },
    { top: '40%', left: '6%' },
    { top: '17%', left: '16%' },
    { top: '13%', left: '38%' },
    { top: '13%', left: '62%' },
    { top: '17%', left: '84%' },
    { top: '40%', left: '94%' },
    { top: '73%', left: '90%' },
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
