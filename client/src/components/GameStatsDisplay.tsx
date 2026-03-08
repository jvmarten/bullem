import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import { HandType } from '@bull-em/shared';
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

const HAND_TYPE_LABELS: Record<number, string> = {
  [HandType.HIGH_CARD]: 'High Card',
  [HandType.PAIR]: 'Pair',
  [HandType.TWO_PAIR]: 'Two Pair',
  [HandType.FLUSH]: 'Flush',
  [HandType.THREE_OF_A_KIND]: '3 of a Kind',
  [HandType.STRAIGHT]: 'Straight',
  [HandType.FULL_HOUSE]: 'Full House',
  [HandType.FOUR_OF_A_KIND]: '4 of a Kind',
  [HandType.STRAIGHT_FLUSH]: 'Str. Flush',
  [HandType.ROYAL_FLUSH]: 'Royal Flush',
};

const PIE_COLORS = ['#d4a843', '#e06c5f', '#5fa3e0', '#6dd45f', '#c05fd4', '#d4975f', '#5fd4c0', '#d45fa3', '#8b8be0', '#e0c05f'];

/** Aggregate hand breakdown across all players to get match-level existence counts. */
function aggregateHandExistence(stats: GameStats): { handType: number; called: number; existed: number }[] {
  const totals = new Map<number, { called: number; existed: number }>();
  for (const s of Object.values(stats.playerStats)) {
    if (!s.handBreakdown) continue;
    for (const entry of s.handBreakdown) {
      const t = totals.get(entry.handType) ?? { called: 0, existed: 0 };
      t.called += entry.called;
      t.existed += entry.existed;
      totals.set(entry.handType, t);
    }
  }
  return [...totals.entries()]
    .map(([handType, { called, existed }]) => ({ handType, called, existed }))
    .sort((a, b) => a.handType - b.handType);
}

interface Props {
  stats: GameStats;
  players: Player[];
  winnerId: PlayerId | null;
}

export function GameStatsDisplay({ stats, players, winnerId }: Props) {
  const awards = computeAwards(stats, players, winnerId);
  const handExistence = aggregateHandExistence(stats);

  // Accuracy bar chart data
  const accuracyData = useMemo(() => {
    return players
      .filter(p => stats.playerStats[p.id])
      .map(p => {
        const s = stats.playerStats[p.id]!;
        const bullAcc = s.bullsCalled > 0 ? Math.round((s.correctBulls / s.bullsCalled) * 100) : 0;
        const trueAcc = s.truesCalled > 0 ? Math.round((s.correctTrues / s.truesCalled) * 100) : 0;
        return { name: p.name.length > 8 ? p.name.slice(0, 7) + '\u2026' : p.name, bullAcc, trueAcc, fullName: p.name };
      });
  }, [stats, players]);

  // Call distribution donut data
  const callDistData = useMemo(() => {
    const totalCalls = handExistence.reduce((sum, h) => sum + h.called, 0);
    if (totalCalls === 0) return [];
    return handExistence
      .filter(h => h.called > 0)
      .map(h => ({
        name: HAND_TYPE_LABELS[h.handType] ?? `Type ${h.handType}`,
        value: h.called,
        existed: h.existed,
        pct: Math.round((h.called / totalCalls) * 100),
      }));
  }, [handExistence]);

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

      {/* Accuracy bar chart */}
      {accuracyData.length > 0 && accuracyData.some(d => d.bullAcc > 0 || d.trueAcc > 0) && (
        <div>
          <h3 className="font-display text-sm font-bold text-[var(--gold)] mb-2 text-center">Accuracy</h3>
          <div className="glass p-3">
            <div style={{ width: '100%', height: Math.max(140, accuracyData.length * 32 + 50) }}>
              <ResponsiveContainer>
                <BarChart
                  data={accuracyData}
                  layout="vertical"
                  margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                >
                  <XAxis
                    type="number"
                    domain={[0, 100]}
                    tick={{ fill: '#a0977a', fontSize: 10 }}
                    stroke="rgba(212,168,67,0.2)"
                    tickFormatter={(v: number) => `${v}%`}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fill: '#a0977a', fontSize: 10 }}
                    stroke="rgba(212,168,67,0.2)"
                    width={60}
                  />
                  <Tooltip
                    contentStyle={{ background: '#1a1510', border: '1px solid rgba(212,168,67,0.3)', borderRadius: 8, fontSize: 12 }}
                    itemStyle={{ color: '#e8e0d4' }}
                    formatter={(value: unknown, name: unknown) => [`${typeof value === 'number' ? value : 0}%`, name === 'bullAcc' ? 'Bull Accuracy' : 'True Accuracy']}
                    labelFormatter={(_label, payload) => {
                      if (payload && payload.length > 0) {
                        const first = payload[0];
                        if (first) {
                          const item = first.payload as { fullName: string };
                          return item.fullName;
                        }
                      }
                      return _label;
                    }}
                  />
                  <Bar dataKey="bullAcc" name="Bull Accuracy" fill="#e06c5f" radius={[0, 4, 4, 0]} animationDuration={800} />
                  <Bar dataKey="trueAcc" name="True Accuracy" fill="#5fa3e0" radius={[0, 4, 4, 0]} animationDuration={800} animationBegin={200} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-center gap-4 mt-1 text-[10px]">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: '#e06c5f' }} /> Bull</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: '#5fa3e0' }} /> True</span>
            </div>
          </div>
        </div>
      )}

      {/* Call distribution donut */}
      {callDistData.length > 0 && (
        <div>
          <h3 className="font-display text-sm font-bold text-[var(--gold)] mb-2 text-center">Call Distribution</h3>
          <div className="glass p-3">
            <div style={{ width: '100%', height: 180 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={callDistData}
                    cx="50%"
                    cy="50%"
                    innerRadius={35}
                    outerRadius={65}
                    dataKey="value"
                    stroke="none"
                    animationDuration={800}
                    animationBegin={300}
                    label={({ name, pct }: { name?: string; pct?: number }) => `${name ?? ''} ${pct ?? 0}%`}
                    labelLine={false}
                  >
                    {callDistData.map((_entry, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length] ?? '#d4a843'} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#1a1510', border: '1px solid rgba(212,168,67,0.3)', borderRadius: 8, fontSize: 12 }}
                    itemStyle={{ color: '#e8e0d4' }}
                    formatter={(value: unknown, name: unknown) => { const v = typeof value === 'number' ? value : 0; return [`${v} call${v !== 1 ? 's' : ''}`, String(name ?? '')]; }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            {/* Existence rate legend */}
            <div className="space-y-1 mt-2">
              {callDistData.map((d, i) => (
                <div key={d.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="text-[var(--gold-dim)]">{d.name}</span>
                  </div>
                  <span className="text-[#e8e0d4] font-semibold">
                    {d.existed}/{d.value} existed
                  </span>
                </div>
              ))}
            </div>
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
