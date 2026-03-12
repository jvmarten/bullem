interface SpectatorPillProps {
  isEliminated: boolean;
}

/**
 * Inline spectator/eliminated pill banner — sits in document flow
 * between the top bar and player list so it never overlaps content.
 */
export function SpectatorPill({ isEliminated }: SpectatorPillProps) {
  return (
    <div className="spectator-pill-wrapper animate-fade-in">
      <span className="spectator-pill">
        {isEliminated ? 'Eliminated — Spectating' : 'Spectating'}
      </span>
    </div>
  );
}
