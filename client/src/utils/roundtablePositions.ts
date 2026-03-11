/**
 * Seat positions for the roundtable layout.
 * Maps (playerCount, seatIndex) → { top, left } as percentages of the table container.
 * Seat 0 is always the local player at bottom center.
 * Seats go clockwise from bottom center.
 *
 * Positions are calibrated so opponent seats sit ON the table edge (border),
 * matching a real poker table layout. The table occupies roughly
 * top: 12%, left: 12%, width: 76%, height: 64% with a stadium border-radius.
 *
 * For 7+ players, positions follow an elliptical curve:
 *   center (50%, 44%), semi-axes a=38 (horizontal), b=30 (vertical)
 *   x = 50 - 38*sin(θ), y = 44 + 30*cos(θ) where θ = 360° × seatIndex/playerCount
 * This prevents the "rectangular" look that occurs when side seats use fixed left values.
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
    { top: '63%', left: '20%' },   // bottom-left on ellipse edge
    { top: '37%', left: '13%' },   // left side on ellipse edge
    { top: '17%', left: '34%' },   // top-left on ellipse edge
    { top: '17%', left: '66%' },   // top-right on ellipse edge
    { top: '37%', left: '87%' },   // right side on ellipse edge
    { top: '63%', left: '80%' },   // bottom-right on ellipse edge
  ],
  8: [
    { top: '78%', left: '50%' },
    { top: '65%', left: '23%' },   // bottom-left on ellipse edge
    { top: '44%', left: '12%' },   // left side on ellipse edge
    { top: '23%', left: '23%' },   // top-left on ellipse edge
    { top: '14%', left: '50%' },   // top center on ellipse edge
    { top: '23%', left: '77%' },   // top-right on ellipse edge
    { top: '44%', left: '88%' },   // right side on ellipse edge
    { top: '65%', left: '77%' },   // bottom-right on ellipse edge
  ],
  9: [
    { top: '78%', left: '50%' },
    { top: '67%', left: '26%' },   // bottom-left on ellipse edge
    { top: '49%', left: '13%' },   // left-mid on ellipse edge
    { top: '29%', left: '17%' },   // upper-left on ellipse edge
    { top: '16%', left: '37%' },   // top-left on ellipse edge
    { top: '16%', left: '63%' },   // top-right on ellipse edge
    { top: '29%', left: '83%' },   // upper-right on ellipse edge
    { top: '49%', left: '87%' },   // right-mid on ellipse edge
    { top: '67%', left: '74%' },   // bottom-right on ellipse edge
  ],
  10: [
    { top: '78%', left: '50%' },
    { top: '68%', left: '28%' },   // bottom-left on ellipse edge
    { top: '53%', left: '14%' },   // left-lower on ellipse edge
    { top: '35%', left: '14%' },   // left-upper on ellipse edge
    { top: '20%', left: '28%' },   // top-left on ellipse edge
    { top: '14%', left: '50%' },   // top center on ellipse edge
    { top: '20%', left: '72%' },   // top-right on ellipse edge
    { top: '35%', left: '86%' },   // right-upper on ellipse edge
    { top: '53%', left: '86%' },   // right-lower on ellipse edge
    { top: '68%', left: '72%' },   // bottom-right on ellipse edge
  ],
  11: [
    { top: '78%', left: '50%' },
    { top: '69%', left: '30%' },   // bottom-left on ellipse edge
    { top: '56%', left: '15%' },   // left-lower on ellipse edge
    { top: '40%', left: '12%' },   // left-mid on ellipse edge
    { top: '24%', left: '21%' },   // upper-left on ellipse edge
    { top: '15%', left: '39%' },   // top-left on ellipse edge
    { top: '15%', left: '61%' },   // top-right on ellipse edge
    { top: '24%', left: '79%' },   // upper-right on ellipse edge
    { top: '40%', left: '88%' },   // right-mid on ellipse edge
    { top: '56%', left: '85%' },   // right-lower on ellipse edge
    { top: '69%', left: '70%' },   // bottom-right on ellipse edge
  ],
  12: [
    { top: '78%', left: '50%' },
    { top: '70%', left: '31%' },   // bottom-left on ellipse edge
    { top: '59%', left: '17%' },   // left-lower on ellipse edge
    { top: '44%', left: '12%' },   // left-mid on ellipse edge
    { top: '29%', left: '17%' },   // upper-left on ellipse edge
    { top: '18%', left: '31%' },   // top-left on ellipse edge
    { top: '14%', left: '50%' },   // top center on ellipse edge
    { top: '18%', left: '69%' },   // top-right on ellipse edge
    { top: '29%', left: '83%' },   // upper-right on ellipse edge
    { top: '44%', left: '88%' },   // right-mid on ellipse edge
    { top: '59%', left: '83%' },   // right-lower on ellipse edge
    { top: '70%', left: '69%' },   // bottom-right on ellipse edge
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
