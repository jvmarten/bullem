import { useState } from 'react';
import { getSeatPosition } from '../utils/roundtablePositions.js';

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
