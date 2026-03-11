import { useState } from 'react';

// --- Seat position config ---
// Maps (playerCount, seatIndex) → { top, left } as percentages of the table container.
// Seat 0 is always "You" (local player) at bottom center.
// Seats go clockwise from bottom center.

interface SeatPosition {
  top: string;   // CSS top as %
  left: string;  // CSS left as %
}

/**
 * Returns the position for a seat around the roundtable.
 * All values are percentages relative to the table container.
 *
 * Tweak these numbers to adjust layout — this is the ONLY place positions are defined.
 */
function getSeatPosition(playerCount: number, seatIndex: number): SeatPosition {
  // Pre-defined positions per player count, going clockwise from bottom center (seat 0 = You)
  const layouts: Record<number, SeatPosition[]> = {
    2: [
      { top: '88%', left: '50%' },  // You (bottom)
      { top: '5%', left: '50%' },   // Opponent (top)
    ],
    3: [
      { top: '88%', left: '50%' },  // You (bottom)
      { top: '15%', left: '18%' },  // Top-left
      { top: '15%', left: '82%' },  // Top-right
    ],
    4: [
      { top: '88%', left: '50%' },  // You (bottom)
      { top: '45%', left: '8%' },   // Left
      { top: '5%', left: '50%' },   // Top
      { top: '45%', left: '92%' },  // Right
    ],
    5: [
      { top: '88%', left: '50%' },  // You (bottom)
      { top: '68%', left: '8%' },   // Bottom-left
      { top: '12%', left: '15%' },  // Top-left
      { top: '12%', left: '85%' },  // Top-right
      { top: '68%', left: '92%' },  // Bottom-right
    ],
    6: [
      { top: '88%', left: '50%' },  // You (bottom)
      { top: '62%', left: '8%' },   // Bottom-left
      { top: '15%', left: '12%' },  // Top-left
      { top: '5%', left: '50%' },   // Top
      { top: '15%', left: '88%' },  // Top-right
      { top: '62%', left: '92%' },  // Bottom-right
    ],
    7: [
      { top: '88%', left: '50%' },  // You (bottom)
      { top: '70%', left: '8%' },   // Bottom-left
      { top: '30%', left: '5%' },   // Left
      { top: '5%', left: '30%' },   // Top-left
      { top: '5%', left: '70%' },   // Top-right
      { top: '30%', left: '95%' },  // Right
      { top: '70%', left: '92%' },  // Bottom-right
    ],
    8: [
      { top: '88%', left: '50%' },  // You (bottom)
      { top: '72%', left: '8%' },   // Bottom-left
      { top: '35%', left: '5%' },   // Left
      { top: '8%', left: '22%' },   // Top-left
      { top: '5%', left: '50%' },   // Top
      { top: '8%', left: '78%' },   // Top-right
      { top: '35%', left: '95%' },  // Right
      { top: '72%', left: '92%' },  // Bottom-right
    ],
    9: [
      { top: '88%', left: '50%' },  // You (bottom)
      { top: '75%', left: '8%' },   // Bottom-left
      { top: '42%', left: '4%' },   // Left
      { top: '12%', left: '14%' },  // Top-left
      { top: '3%', left: '38%' },   // Top-left-center
      { top: '3%', left: '62%' },   // Top-right-center
      { top: '12%', left: '86%' },  // Top-right
      { top: '42%', left: '96%' },  // Right
      { top: '75%', left: '92%' },  // Bottom-right
    ],
  };

  const seats = layouts[playerCount];
  if (!seats || seatIndex >= seats.length) {
    return { top: '50%', left: '50%' };
  }
  // seats[seatIndex] is guaranteed to exist by the bounds check above
  return seats[seatIndex] as SeatPosition;
}

// --- Mock data ---

const MOCK_NAMES = ['You', 'Alice', 'Bob', 'Charlie', 'Diana', 'Ethan', 'Fiona', 'George', 'Hannah'];

const SEAT_COLORS = [
  '#d4a843', // gold (You)
  '#e06c75', // red
  '#61afef', // blue
  '#98c379', // green
  '#c678dd', // purple
  '#e5c07b', // yellow
  '#56b6c2', // cyan
  '#be5046', // rust
  '#d19a66', // orange
];

// --- Components ---

function PlayerSeat({ name, color, seatIndex, playerCount }: {
  name: string;
  color: string;
  seatIndex: number;
  playerCount: number;
}) {
  const pos = getSeatPosition(playerCount, seatIndex);
  const isYou = seatIndex === 0;

  return (
    <div
      className="roundtable-seat"
      style={{
        top: pos.top,
        left: pos.left,
      }}
    >
      {/* Avatar circle */}
      <div
        className="roundtable-avatar"
        style={{ background: color, borderColor: isYou ? '#fff' : 'rgba(255,255,255,0.3)' }}
      >
        <span className="roundtable-seat-index">{seatIndex}</span>
      </div>
      {/* Name label */}
      <div className={`roundtable-name ${isYou ? 'roundtable-name--you' : ''}`}>
        {name}
      </div>
      {/* Card placeholders */}
      <div className="roundtable-cards">
        <div className="roundtable-card" />
        <div className="roundtable-card" />
      </div>
    </div>
  );
}

function RoundtableView({ playerCount }: { playerCount: number }) {
  return (
    <div className="roundtable-container">
      {/* Table surface */}
      <div className="roundtable-table">
        <div className="roundtable-table-label">{playerCount}P</div>
      </div>
      {/* Seats */}
      {Array.from({ length: playerCount }, (_, i) => (
        <PlayerSeat
          key={i}
          name={MOCK_NAMES[i] ?? `P${i}`}
          color={SEAT_COLORS[i] ?? '#888'}
          seatIndex={i}
          playerCount={playerCount}
        />
      ))}
    </div>
  );
}

// --- Page ---

export function RoundtableDevPage() {
  const [selectedCount, setSelectedCount] = useState(4);
  const [showAll, setShowAll] = useState(false);

  return (
    <div className="roundtable-dev-page">
      {/* Control bar */}
      <div className="roundtable-controls">
        <span className="roundtable-controls-title">Roundtable Dev</span>
        <div className="roundtable-controls-buttons">
          {[2, 3, 4, 5, 6, 7, 8, 9].map(n => (
            <button
              key={n}
              className={`roundtable-btn ${!showAll && selectedCount === n ? 'roundtable-btn--active' : ''}`}
              onClick={() => { setSelectedCount(n); setShowAll(false); }}
            >
              {n}P
            </button>
          ))}
          <button
            className={`roundtable-btn roundtable-btn--show-all ${showAll ? 'roundtable-btn--active' : ''}`}
            onClick={() => setShowAll(!showAll)}
          >
            All
          </button>
        </div>
      </div>

      {/* Render area */}
      {showAll ? (
        <div className="roundtable-grid">
          {[2, 3, 4, 5, 6, 7, 8, 9].map(n => (
            <div key={n} className="roundtable-grid-cell">
              <RoundtableView playerCount={n} />
            </div>
          ))}
        </div>
      ) : (
        <div className="roundtable-single">
          <RoundtableView playerCount={selectedCount} />
        </div>
      )}
    </div>
  );
}
