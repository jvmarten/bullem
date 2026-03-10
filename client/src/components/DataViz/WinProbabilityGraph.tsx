import { useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import type { WinProbabilityEntry } from '@bull-em/shared';

interface Props {
  data: WinProbabilityEntry[];
}

interface ChartPoint {
  round: number;
  advantage: number;
  playerCards: number;
  avgOpponentCards: number;
  playersAlive: number;
}

/**
 * Win probability graph showing card count advantage over time.
 * Lower cards = better position, so we show "advantage" as the difference
 * between opponent average and player cards (positive = player is ahead).
 */
export function WinProbabilityGraph({ data }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  if (data.length === 0) return null;

  const game = data[selectedIndex];
  if (!game) return null;

  const chartData: ChartPoint[] = game.snapshots.map(s => ({
    round: s.roundNumber,
    advantage: s.avgOpponentCards - s.playerCards,
    playerCards: s.playerCards,
    avgOpponentCards: s.avgOpponentCards,
    playersAlive: s.playersAlive,
  }));

  const maxAbs = Math.max(
    ...chartData.map(d => Math.abs(d.advantage)),
    1,
  );
  const yBound = Math.ceil(maxAbs) + 0.5;

  const gameDate = new Date(game.playedAt).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric',
  });

  return (
    <div className="w-full mb-6">
      <div className="flex items-center justify-between mb-3 px-1">
        <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold">
          Match Advantage
        </p>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSelectedIndex(Math.max(0, selectedIndex - 1))}
            disabled={selectedIndex === 0}
            className="text-[10px] px-1.5 py-0.5 text-[var(--gold-dim)] disabled:opacity-30 hover:text-[var(--gold)] transition-colors min-w-[28px] min-h-[28px] flex items-center justify-center"
          >
            &lt;
          </button>
          <span className="text-[10px] text-[var(--gold)] font-medium min-w-[80px] text-center">
            {gameDate} {game.won ? 'W' : 'L'}
          </span>
          <button
            onClick={() => setSelectedIndex(Math.min(data.length - 1, selectedIndex + 1))}
            disabled={selectedIndex === data.length - 1}
            className="text-[10px] px-1.5 py-0.5 text-[var(--gold-dim)] disabled:opacity-30 hover:text-[var(--gold)] transition-colors min-w-[28px] min-h-[28px] flex items-center justify-center"
          >
            &gt;
          </button>
        </div>
      </div>

      {/* Game selector pills */}
      <div className="flex gap-1 mb-2 px-1 overflow-x-auto scrollbar-none">
        {data.map((g, i) => (
          <button
            key={g.gameId}
            onClick={() => setSelectedIndex(i)}
            className={`shrink-0 text-[9px] px-2 py-0.5 rounded-full transition-colors min-h-[24px] ${
              i === selectedIndex
                ? 'bg-[var(--gold)] text-black font-semibold'
                : g.won
                  ? 'text-green-400/70 hover:text-green-400'
                  : 'text-red-400/70 hover:text-red-400'
            }`}
          >
            {g.won ? 'W' : 'L'}
          </button>
        ))}
      </div>

      <div className="glass px-2 py-3" style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id="advantageGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity={0.4} />
                <stop offset="50%" stopColor="#22c55e" stopOpacity={0} />
                <stop offset="50%" stopColor="#ef4444" stopOpacity={0} />
                <stop offset="100%" stopColor="#ef4444" stopOpacity={0.4} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="round"
              tick={{ fill: '#8b7340', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              label={{ value: 'Round', position: 'insideBottom', offset: -2, fill: '#8b7340', fontSize: 9 }}
            />
            <YAxis
              domain={[-yBound, yBound]}
              tick={{ fill: '#8b7340', fontSize: 10 }}
              width={30}
              axisLine={false}
              tickLine={false}
            />
            <ReferenceLine y={0} stroke="rgba(212,175,55,0.3)" strokeDasharray="3 3" />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const d = payload[0].payload as ChartPoint;
                const sign = d.advantage >= 0 ? '+' : '';
                return (
                  <div style={{
                    background: '#1a1410',
                    border: '1px solid rgba(212,175,55,0.3)',
                    borderRadius: 8,
                    padding: '6px 10px',
                    fontSize: 11,
                    color: '#d4af37',
                  }}>
                    <p>Round {d.round}</p>
                    <p style={{ color: d.advantage >= 0 ? '#22c55e' : '#ef4444' }}>
                      Advantage: {sign}{d.advantage.toFixed(1)}
                    </p>
                    <p className="text-[10px]" style={{ color: '#a09888' }}>
                      You: {d.playerCards} | Opp avg: {d.avgOpponentCards}
                    </p>
                    <p className="text-[10px]" style={{ color: '#a09888' }}>
                      {d.playersAlive} alive
                    </p>
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="advantage"
              stroke="#d4af37"
              strokeWidth={2}
              fill="url(#advantageGrad)"
              dot={false}
              activeDot={{ r: 4, fill: '#d4af37' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Outcome badge */}
      <div className="flex justify-center mt-2">
        <span
          className="text-[10px] font-semibold px-3 py-0.5 rounded-full"
          style={{
            background: game.won ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
            color: game.won ? '#22c55e' : '#ef4444',
          }}
        >
          {game.won ? 'Victory' : 'Defeat'} &middot; {game.snapshots.length} rounds
        </span>
      </div>
    </div>
  );
}
