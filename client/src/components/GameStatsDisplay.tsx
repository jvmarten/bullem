import type { GameStats, Player, PlayerId } from '@bull-em/shared';

interface Award {
  name: string;
  playerId: PlayerId;
  playerName: string;
  detail: string;
}

function computeAwards(stats: GameStats, players: Player[], winnerId: PlayerId | null): Award[] {
  const awards: Award[] = [];
  const getName = (id: PlayerId) => players.find(p => p.id === id)?.name ?? 'Unknown';

  // Best Bluffer — most successful bluffs
  let bestBluffer: { id: string; count: number } | null = null;
  for (const [id, s] of Object.entries(stats.playerStats)) {
    if (s.bluffsSuccessful > 0 && (!bestBluffer || s.bluffsSuccessful > bestBluffer.count)) {
      bestBluffer = { id, count: s.bluffsSuccessful };
    }
  }
  if (bestBluffer) {
    awards.push({
      name: 'Best Bluffer',
      playerId: bestBluffer.id,
      playerName: getName(bestBluffer.id),
      detail: `${bestBluffer.count} successful bluff${bestBluffer.count !== 1 ? 's' : ''}`,
    });
  }

  // Bull Detective — most correct bull calls
  let bestDetective: { id: string; count: number } | null = null;
  for (const [id, s] of Object.entries(stats.playerStats)) {
    if (s.correctBulls > 0 && (!bestDetective || s.correctBulls > bestDetective.count)) {
      bestDetective = { id, count: s.correctBulls };
    }
  }
  if (bestDetective) {
    awards.push({
      name: 'Bull Detective',
      playerId: bestDetective.id,
      playerName: getName(bestDetective.id),
      detail: `${bestDetective.count} correct bull call${bestDetective.count !== 1 ? 's' : ''}`,
    });
  }

  // Honest Player — most correct true calls
  let bestHonest: { id: string; count: number } | null = null;
  for (const [id, s] of Object.entries(stats.playerStats)) {
    if (s.correctTrues > 0 && (!bestHonest || s.correctTrues > bestHonest.count)) {
      bestHonest = { id, count: s.correctTrues };
    }
  }
  if (bestHonest) {
    awards.push({
      name: 'Honest Player',
      playerId: bestHonest.id,
      playerName: getName(bestHonest.id),
      detail: `${bestHonest.count} correct true call${bestHonest.count !== 1 ? 's' : ''}`,
    });
  }

  // Quick Exit — fewest rounds survived (excluding winner)
  let quickExit: { id: string; count: number } | null = null;
  for (const [id, s] of Object.entries(stats.playerStats)) {
    if (id === winnerId) continue;
    if (s.roundsSurvived > 0 && (!quickExit || s.roundsSurvived < quickExit.count)) {
      quickExit = { id, count: s.roundsSurvived };
    }
  }
  if (quickExit) {
    awards.push({
      name: 'Quick Exit',
      playerId: quickExit.id,
      playerName: getName(quickExit.id),
      detail: `Survived ${quickExit.count} round${quickExit.count !== 1 ? 's' : ''}`,
    });
  }

  return awards;
}

interface Props {
  stats: GameStats;
  players: Player[];
  winnerId: PlayerId | null;
}

export function GameStatsDisplay({ stats, players, winnerId }: Props) {
  const awards = computeAwards(stats, players, winnerId);

  return (
    <div className="w-full space-y-4">
      {/* Awards */}
      {awards.length > 0 && (
        <div>
          <h3 className="font-display text-sm font-bold text-[var(--gold)] mb-2 text-center">Awards</h3>
          <div className="grid grid-cols-2 gap-2">
            {awards.map((award) => (
              <div key={award.name} className="glass p-2.5 text-center">
                <p className="text-[var(--gold)] font-display font-bold text-xs">{award.name}</p>
                <p className="text-sm font-semibold mt-0.5">{award.playerName}</p>
                <p className="text-[10px] text-[var(--gold-dim)]">{award.detail}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-player stats */}
      <div>
        <h3 className="font-display text-sm font-bold text-[var(--gold)] mb-2 text-center">Player Stats</h3>
        <div className="space-y-1.5">
          {players.map((p) => {
            const s = stats.playerStats[p.id];
            if (!s) return null;
            return (
              <div key={p.id} className="glass p-2 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">
                    {p.name}
                    {p.id === winnerId && <span className="text-[var(--gold)] ml-1 text-xs">Winner</span>}
                  </p>
                </div>
                <div className="flex gap-3 text-[10px] text-[var(--gold-dim)] flex-shrink-0">
                  <div className="text-center">
                    <p className="text-sm font-bold text-[#e8e0d4]">{s.roundsSurvived}</p>
                    <p>Rounds</p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-[#e8e0d4]">{s.correctBulls}/{s.bullsCalled}</p>
                    <p>Bulls</p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-[#e8e0d4]">{s.correctTrues}/{s.truesCalled}</p>
                    <p>Trues</p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-[#e8e0d4]">{s.callsMade}</p>
                    <p>Calls</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
