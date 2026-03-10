import { useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import type { CareerTrajectoryPoint } from '@bull-em/shared';

interface Props {
  data: CareerTrajectoryPoint[];
}

type MetricKey = 'rating' | 'winRate' | 'bluffRate' | 'bullAccuracy';

const METRICS: { key: MetricKey; label: string; color: string; unit: string }[] = [
  { key: 'rating', label: 'Rating', color: '#d4af37', unit: '' },
  { key: 'winRate', label: 'Win Rate', color: '#22c55e', unit: '%' },
  { key: 'bluffRate', label: 'Bluff Rate', color: '#f97316', unit: '%' },
  { key: 'bullAccuracy', label: 'Bull Acc.', color: '#3b82f6', unit: '%' },
];

interface ChartPoint {
  label: string;
  rating: number;
  winRate: number;
  bluffRate: number | null;
  bullAccuracy: number | null;
  gamesPlayed: number;
}

/**
 * Career trajectory chart showing rating, win rate, and play style
 * evolution over time. Uses weekly data points with multiple metrics.
 */
export function CareerTrajectory({ data }: Props) {
  const [activeMetrics, setActiveMetrics] = useState<Set<MetricKey>>(
    new Set(['rating', 'winRate']),
  );

  if (data.length < 2) return null;

  const chartData: ChartPoint[] = data.map(p => ({
    label: new Date(p.periodStart).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric',
    }),
    rating: p.rating,
    winRate: p.winRate,
    bluffRate: p.bluffRate,
    bullAccuracy: p.bullAccuracy,
    gamesPlayed: p.gamesPlayed,
  }));

  const toggleMetric = (key: MetricKey) => {
    setActiveMetrics(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key); // Keep at least one active
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Determine if we need dual Y axes (rating uses a different scale than %)
  const showRating = activeMetrics.has('rating');
  const showPercent = activeMetrics.has('winRate') || activeMetrics.has('bluffRate') || activeMetrics.has('bullAccuracy');

  return (
    <div className="w-full mb-6">
      <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-3 px-1">
        Career Trajectory
      </p>

      {/* Metric toggle buttons */}
      <div className="flex flex-wrap gap-1 mb-2 px-1">
        {METRICS.map(m => (
          <button
            key={m.key}
            onClick={() => toggleMetric(m.key)}
            className={`text-[10px] px-2.5 py-1 rounded-full transition-colors min-h-[28px] ${
              activeMetrics.has(m.key)
                ? 'font-semibold'
                : 'opacity-40 hover:opacity-70'
            }`}
            style={{
              backgroundColor: activeMetrics.has(m.key)
                ? `${m.color}20`
                : 'transparent',
              color: m.color,
              border: `1px solid ${activeMetrics.has(m.key) ? m.color + '40' : 'transparent'}`,
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="glass px-2 py-3" style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <XAxis
              dataKey="label"
              tick={{ fill: '#8b7340', fontSize: 9 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            {/* Left Y axis for rating */}
            {showRating && (
              <YAxis
                yAxisId="rating"
                domain={['auto', 'auto']}
                tick={{ fill: '#8b7340', fontSize: 10 }}
                width={35}
                axisLine={false}
                tickLine={false}
              />
            )}
            {/* Right Y axis for percentages */}
            {showPercent && (
              <YAxis
                yAxisId="percent"
                orientation={showRating ? 'right' : 'left'}
                domain={[0, 100]}
                tick={{ fill: '#8b7340', fontSize: 10 }}
                width={30}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `${v}%`}
              />
            )}
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0) return null;
                const point = payload[0]?.payload as ChartPoint | undefined;
                return (
                  <div style={{
                    background: '#1a1410',
                    border: '1px solid rgba(212,175,55,0.3)',
                    borderRadius: 8,
                    padding: '6px 10px',
                    fontSize: 11,
                    color: '#d4af37',
                  }}>
                    <p className="font-semibold">{label}</p>
                    {point && <p style={{ color: '#a09888', fontSize: 10 }}>{point.gamesPlayed} games</p>}
                    {payload.map((p) => (
                      <p key={p.dataKey as string} style={{ color: p.color as string, fontSize: 11 }}>
                        {METRICS.find(m => m.key === p.dataKey)?.label}: {
                          typeof p.value === 'number' ? Math.round(p.value) : '—'
                        }{METRICS.find(m => m.key === p.dataKey)?.unit}
                      </p>
                    ))}
                  </div>
                );
              }}
            />
            <Legend
              verticalAlign="bottom"
              height={20}
              iconSize={8}
              wrapperStyle={{ fontSize: 10 }}
            />
            {activeMetrics.has('rating') && (
              <Line
                yAxisId="rating"
                type="monotone"
                dataKey="rating"
                stroke="#d4af37"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3 }}
                name="Rating"
                connectNulls
              />
            )}
            {activeMetrics.has('winRate') && (
              <Line
                yAxisId="percent"
                type="monotone"
                dataKey="winRate"
                stroke="#22c55e"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3 }}
                name="Win Rate"
                connectNulls
              />
            )}
            {activeMetrics.has('bluffRate') && (
              <Line
                yAxisId="percent"
                type="monotone"
                dataKey="bluffRate"
                stroke="#f97316"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3 }}
                name="Bluff Rate"
                connectNulls
              />
            )}
            {activeMetrics.has('bullAccuracy') && (
              <Line
                yAxisId="percent"
                type="monotone"
                dataKey="bullAccuracy"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3 }}
                name="Bull Acc."
                connectNulls
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
