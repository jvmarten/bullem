import { useEffect, useState } from 'react';
import type { Player } from '@bull-em/shared';
import type { DisconnectDeadlines } from '../context/GameContext.js';

interface Props {
  players: Player[];
  disconnectDeadlines: DisconnectDeadlines;
}

/** Displays a compact banner for each disconnected player with a countdown timer. */
export function DisconnectBanner({ players, disconnectDeadlines }: Props) {
  const [now, setNow] = useState(Date.now());

  // Tick every second while there are active disconnect deadlines
  useEffect(() => {
    if (disconnectDeadlines.size === 0) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [disconnectDeadlines.size]);

  if (disconnectDeadlines.size === 0) return null;

  const entries = [...disconnectDeadlines.entries()]
    .map(([playerId, deadline]) => {
      const player = players.find(p => p.id === playerId);
      const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));
      return { playerId, player, remaining };
    })
    .filter(e => e.player && e.remaining > 0);

  if (entries.length === 0) return null;

  return (
    <div className="space-y-1 animate-slide-down">
      {entries.map(({ playerId, player, remaining }) => (
        <div key={playerId} className="disconnect-banner">
          <span className="disconnect-banner-dot" />
          <span className="disconnect-banner-name">{player!.name}</span>
          <span className="disconnect-banner-text">has {remaining}s to reconnect</span>
        </div>
      ))}
    </div>
  );
}
