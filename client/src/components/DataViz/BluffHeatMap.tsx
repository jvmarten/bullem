import type { BluffHeatMapEntry } from '@bull-em/shared';

interface Props {
  data: BluffHeatMapEntry[];
}

/** Color for heat intensity based on bluff rate (0–100). */
function heatColor(rate: number): string {
  if (rate >= 60) return '#ef4444';    // red — heavy bluff zone
  if (rate >= 45) return '#f97316';    // orange
  if (rate >= 30) return '#eab308';    // yellow
  if (rate >= 15) return '#22c55e';    // green — moderate
  return '#334155';                     // slate — low activity
}

/** Opacity based on sample size (more data = more confident). */
function sampleOpacity(totalCalls: number): number {
  if (totalCalls >= 10) return 1;
  if (totalCalls >= 5) return 0.85;
  if (totalCalls >= 2) return 0.7;
  return 0.5;
}

/**
 * Heat map showing bluff patterns across round numbers.
 * Visualizes when during a game the player bluffs most frequently.
 */
export function BluffHeatMap({ data }: Props) {
  if (data.length === 0) return null;

  const maxCalls = Math.max(...data.map(d => d.totalCalls), 1);

  return (
    <div className="w-full mb-6">
      <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-3 px-1">
        Bluff Patterns by Round
      </p>
      <div className="glass px-4 py-3">
        {/* Legend */}
        <div className="flex items-center gap-3 mb-3 text-[9px] text-[var(--gold-dim)]">
          <div className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#ef4444' }} />
            <span>Heavy</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#f97316' }} />
            <span>High</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#eab308' }} />
            <span>Medium</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#22c55e' }} />
            <span>Low</span>
          </div>
        </div>

        {/* Heat map grid */}
        <div className="flex flex-wrap gap-1.5">
          {data.map(entry => {
            const bluffRate = entry.totalCalls > 0
              ? (entry.bluffsAttempted / entry.totalCalls) * 100
              : 0;
            const sizeRatio = entry.totalCalls / maxCalls;
            const minSize = 32;
            const maxSize = 56;
            const cellSize = minSize + sizeRatio * (maxSize - minSize);

            return (
              <div
                key={entry.roundNumber}
                className="flex flex-col items-center justify-center rounded-md transition-transform hover:scale-110 cursor-default"
                style={{
                  width: cellSize,
                  height: cellSize,
                  backgroundColor: heatColor(bluffRate),
                  opacity: sampleOpacity(entry.totalCalls),
                }}
                title={`Round ${entry.roundNumber}: ${entry.bluffsAttempted} bluffs / ${entry.totalCalls} calls (${Math.round(bluffRate)}% bluff rate)`}
              >
                <span className="text-[10px] font-bold text-white/90">
                  R{entry.roundNumber}
                </span>
                <span className="text-[8px] text-white/70">
                  {Math.round(bluffRate)}%
                </span>
              </div>
            );
          })}
        </div>

        {/* Bull accuracy row */}
        <div className="mt-3 pt-3 border-t border-white/5">
          <p className="text-[9px] text-[var(--gold-dim)] mb-1.5">Bull Accuracy by Round</p>
          <div className="flex flex-wrap gap-1.5">
            {data.filter(e => e.bullsCalled > 0).map(entry => {
              const accuracy = entry.bullsCalled > 0
                ? (entry.correctBulls / entry.bullsCalled) * 100
                : 0;
              return (
                <div
                  key={entry.roundNumber}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[9px]"
                  style={{
                    background: accuracy >= 60 ? 'rgba(34,197,94,0.15)' : accuracy >= 40 ? 'rgba(234,179,8,0.15)' : 'rgba(239,68,68,0.15)',
                    color: accuracy >= 60 ? '#22c55e' : accuracy >= 40 ? '#eab308' : '#ef4444',
                  }}
                >
                  <span className="font-medium">R{entry.roundNumber}</span>
                  <span>{Math.round(accuracy)}%</span>
                  <span className="text-white/40">({entry.bullsCalled})</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
