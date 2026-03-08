import { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend, PieChart, Pie, Cell,
} from 'recharts';
import { HandType } from '@bull-em/shared';
import type { InGameStats, Player, PlayerId } from '@bull-em/shared';

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

const PLAYER_COLORS = [
  '#d4a843', '#e06c5f', '#5fa3e0', '#6dd45f',
  '#c05fd4', '#d4975f', '#5fd4c0', '#d45fa3',
  '#8b8be0', '#e0c05f', '#5fe08b', '#e05f5f',
];

type Tab = 'players' | 'hands' | 'timeline';

interface Props {
  stats: InGameStats;
  players: Player[];
  myPlayerId: string | null;
}

export function InGameStats({ stats, players, myPlayerId }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('players');

  const hasData = Object.keys(stats.playerStats).length > 0;

  const playerAccuracyData = useMemo(() => {
    return players
      .filter(p => stats.playerStats[p.id])
      .map(p => {
        const s = stats.playerStats[p.id]!;
        const bullAcc = s.bullsCalled > 0 ? Math.round((s.correctBulls / s.bullsCalled) * 100) : null;
        const trueAcc = s.truesCalled > 0 ? Math.round((s.correctTrues / s.truesCalled) * 100) : null;
        const bluffRate = s.callsMade > 0 ? Math.round((s.bluffsSuccessful / s.callsMade) * 100) : null;
        return {
          name: p.id === myPlayerId ? 'You' : p.name,
          playerId: p.id,
          bullAcc,
          trueAcc,
          bluffRate,
          bulls: `${s.correctBulls}/${s.bullsCalled}`,
          trues: `${s.correctTrues}/${s.truesCalled}`,
          calls: s.callsMade,
          bluffs: s.bluffsSuccessful,
        };
      });
  }, [stats, players, myPlayerId]);

  const handDistData = useMemo(() => {
    return Object.entries(stats.handTypeCalls)
      .map(([type, count]) => ({
        name: HAND_TYPE_LABELS[Number(type)] ?? `Type ${type}`,
        count,
        type: Number(type),
      }))
      .sort((a, b) => a.type - b.type);
  }, [stats.handTypeCalls]);

  const totalCalls = useMemo(() =>
    handDistData.reduce((sum, d) => sum + d.count, 0),
  [handDistData]);

  const pieData = useMemo(() => {
    if (totalCalls === 0) return [];
    return handDistData
      .filter(d => d.count > 0)
      .map(d => ({
        name: d.name,
        value: d.count,
        pct: Math.round((d.count / totalCalls) * 100),
      }));
  }, [handDistData, totalCalls]);

  const timelineData = useMemo(() => {
    const activePlayers = players.filter(p => stats.playerStats[p.id]);
    return stats.roundSnapshots.map(snap => {
      const point: Record<string, string | number> = { round: `R${snap.roundNumber}` };
      for (const p of activePlayers) {
        const label = p.id === myPlayerId ? 'You' : p.name;
        point[label] = snap.cardCounts[p.id] ?? 0;
      }
      return point;
    });
  }, [stats.roundSnapshots, players, myPlayerId, stats.playerStats]);

  const timelinePlayerNames = useMemo(() => {
    return players
      .filter(p => stats.playerStats[p.id])
      .map((p, i) => ({
        name: p.id === myPlayerId ? 'You' : p.name,
        color: PLAYER_COLORS[i % PLAYER_COLORS.length] ?? '#d4a843',
      }));
  }, [players, myPlayerId, stats.playerStats]);

  const PIE_COLORS = ['#d4a843', '#e06c5f', '#5fa3e0', '#6dd45f', '#c05fd4', '#d4975f', '#5fd4c0', '#d45fa3', '#8b8be0', '#e0c05f'];

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="btn-ghost border-[var(--gold-dim)] text-[var(--gold-dim)] text-xs px-3 py-1.5 min-h-[44px]"
        title="View match stats"
      >
        Stats
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div
        className="w-full max-w-lg glass animate-slide-up"
        style={{
          maxHeight: '70vh',
          borderTopLeftRadius: '1rem',
          borderTopRightRadius: '1rem',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid rgba(212,168,67,0.15)' }}>
          <h3 className="font-display text-sm font-bold text-[var(--gold)] uppercase tracking-widest">
            Match Stats
          </h3>
          <button
            onClick={() => setOpen(false)}
            className="text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            &times;
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b" style={{ borderColor: 'rgba(212,168,67,0.15)' }}>
          {(['players', 'hands', 'timeline'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wider transition-colors min-h-[44px] ${
                tab === t
                  ? 'text-[var(--gold)] border-b-2 border-[var(--gold)]'
                  : 'text-[var(--gold-dim)]'
              }`}
            >
              {t === 'players' ? 'Players' : t === 'hands' ? 'Calls' : 'Timeline'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4" style={{ WebkitOverflowScrolling: 'touch' }}>
          {!hasData ? (
            <p className="text-center text-[var(--gold-dim)] text-sm py-8">
              Stats will appear after the first round completes.
            </p>
          ) : (
            <>
              {tab === 'players' && (
                <PlayerStatsTab data={playerAccuracyData} />
              )}
              {tab === 'hands' && (
                <HandDistTab pieData={pieData} totalCalls={totalCalls} />
              )}
              {tab === 'timeline' && (
                <TimelineTab data={timelineData} playerNames={timelinePlayerNames} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Player Stats Tab ───────────────────────────────────────────────────

interface PlayerAccRow {
  name: string;
  playerId: PlayerId;
  bullAcc: number | null;
  trueAcc: number | null;
  bluffRate: number | null;
  bulls: string;
  trues: string;
  calls: number;
  bluffs: number;
}

function PlayerStatsTab({ data }: { data: PlayerAccRow[] }) {
  return (
    <div className="space-y-2">
      {data.map(row => (
        <div key={row.playerId} className="glass p-3">
          <p className="text-sm font-semibold mb-2">{row.name}</p>
          <div className="grid grid-cols-4 gap-2 text-center text-[10px]">
            <div>
              <p className="text-sm font-bold text-[#e8e0d4]">{row.bulls}</p>
              <p className="text-[var(--gold-dim)]">Bulls</p>
              {row.bullAcc !== null && (
                <p className="text-[var(--gold)] font-semibold">{row.bullAcc}%</p>
              )}
            </div>
            <div>
              <p className="text-sm font-bold text-[#e8e0d4]">{row.trues}</p>
              <p className="text-[var(--gold-dim)]">Trues</p>
              {row.trueAcc !== null && (
                <p className="text-[var(--gold)] font-semibold">{row.trueAcc}%</p>
              )}
            </div>
            <div>
              <p className="text-sm font-bold text-[#e8e0d4]">{row.calls}</p>
              <p className="text-[var(--gold-dim)]">Calls</p>
            </div>
            <div>
              <p className="text-sm font-bold text-[#e8e0d4]">{row.bluffs}</p>
              <p className="text-[var(--gold-dim)]">Bluffs</p>
              {row.bluffRate !== null && (
                <p className="text-[var(--gold)] font-semibold">{row.bluffRate}%</p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Hand Distribution Tab ──────────────────────────────────────────────

function HandDistTab({ pieData, totalCalls }: { pieData: { name: string; value: number; pct: number }[]; totalCalls: number }) {
  const PIE_COLORS = ['#d4a843', '#e06c5f', '#5fa3e0', '#6dd45f', '#c05fd4', '#d4975f', '#5fd4c0', '#d45fa3', '#8b8be0', '#e0c05f'];

  if (totalCalls === 0) {
    return <p className="text-center text-[var(--gold-dim)] text-sm py-8">No calls yet.</p>;
  }

  return (
    <div className="space-y-4">
      <div style={{ width: '100%', height: 200 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={pieData}
              cx="50%"
              cy="50%"
              innerRadius={40}
              outerRadius={75}
              dataKey="value"
              stroke="none"
              label={({ name, pct }: { name?: string; pct?: number }) => `${name ?? ''} ${pct ?? 0}%`}
              labelLine={false}
            >
              {pieData.map((_entry, i) => (
                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length] ?? '#d4a843'} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ background: '#1a1510', border: '1px solid rgba(212,168,67,0.3)', borderRadius: 8, fontSize: 12 }}
              itemStyle={{ color: '#e8e0d4' }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-1">
        {pieData.map((d, i) => (
          <div key={d.name} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
              <span className="text-[var(--gold-dim)]">{d.name}</span>
            </div>
            <span className="text-[#e8e0d4] font-semibold">{d.value} ({d.pct}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Timeline Tab ───────────────────────────────────────────────────────

function TimelineTab({ data, playerNames }: {
  data: Record<string, string | number>[];
  playerNames: { name: string; color: string }[];
}) {
  if (data.length === 0) {
    return <p className="text-center text-[var(--gold-dim)] text-sm py-8">Timeline appears after rounds complete.</p>;
  }

  return (
    <div style={{ width: '100%', height: Math.max(200, playerNames.length * 20 + 160) }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
          <XAxis
            dataKey="round"
            tick={{ fill: '#a0977a', fontSize: 10 }}
            stroke="rgba(212,168,67,0.2)"
          />
          <YAxis
            tick={{ fill: '#a0977a', fontSize: 10 }}
            stroke="rgba(212,168,67,0.2)"
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{ background: '#1a1510', border: '1px solid rgba(212,168,67,0.3)', borderRadius: 8, fontSize: 12 }}
            itemStyle={{ color: '#e8e0d4' }}
            labelStyle={{ color: '#d4a843' }}
            formatter={(value: unknown) => { const v = typeof value === 'number' ? value : 0; return [`${v} card${v !== 1 ? 's' : ''}`]; }}
          />
          <Legend
            iconSize={8}
            wrapperStyle={{ fontSize: 10, color: '#a0977a' }}
          />
          {playerNames.map(({ name, color }) => (
            <Line
              key={name}
              type="monotone"
              dataKey={name}
              stroke={color}
              strokeWidth={2}
              dot={{ r: 3, fill: color }}
              activeDot={{ r: 5 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
