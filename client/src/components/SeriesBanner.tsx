import type { SeriesInfo } from '@bull-em/shared';

interface SeriesBannerProps {
  seriesInfo: NonNullable<SeriesInfo>;
  players: { id: string; name: string }[];
  playerId: string | null;
  /** Extra CSS classes on the root element (e.g. 'glass' for the online game page) */
  className?: string;
}

export function SeriesBanner({ seriesInfo, players, playerId, className }: SeriesBannerProps) {
  const playerIds = Object.keys(seriesInfo.wins);
  const getLabel = (pid: string) => {
    if (pid === playerId) return 'You';
    return players.find(p => p.id === pid)?.name ?? '?';
  };

  return (
    <div
      className={`flex items-center justify-center gap-2 text-xs py-1.5 px-3 ${className ?? ''}`}
      style={{ borderBottom: '1px solid rgba(212,168,67,0.15)' }}
    >
      <span className="text-[var(--gold-dim)] uppercase tracking-widest font-semibold text-[10px]">
        Bo{seriesInfo.bestOf}
      </span>
      <span className="text-[var(--gold-dim)]">|</span>
      <span className="text-[var(--gold-dim)]">Set {seriesInfo.currentSet}</span>
      <span className="text-[var(--gold-dim)]">|</span>
      {playerIds.map((pid, i) => (
        <span key={pid} className="text-[var(--gold)]">
          {i > 0 && <span className="text-[var(--gold-dim)] mx-1">-</span>}
          <span className={pid === playerId ? 'font-bold' : ''}>{getLabel(pid)}</span>
          {' '}
          <span className="font-mono font-bold">{seriesInfo.wins[pid] ?? 0}</span>
        </span>
      ))}
    </div>
  );
}
