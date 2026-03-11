import { useRef, useEffect, useState, useCallback } from 'react';
import type { AdvancedStatsResponse } from '@bull-em/shared';

/** Summary stats passed in from the parent that fetches player stats separately. */
export interface StatCardSummary {
  gamesPlayed: number;
  wins: number;
  winRate: number | null;
  bullAccuracy: number | null;
}

interface Props {
  displayName: string;
  summary: StatCardSummary;
  advancedStats: AdvancedStatsResponse;
}

const CARD_WIDTH = 600;
const CARD_HEIGHT = 480;

const COLORS = {
  feltDark: '#072914',
  felt: '#0b3d1e',
  feltLight: '#0f4d28',
  gold: '#d4a843',
  goldLight: '#e8c56e',
  goldDim: '#c49a3a',
  text: '#e8e0d4',
  textDim: '#a09888',
  green: '#22c55e',
  red: '#ef4444',
} as const;

function drawStatCard(
  ctx: CanvasRenderingContext2D,
  displayName: string,
  summary: StatCardSummary,
  advancedStats: AdvancedStatsResponse,
): void {
  const w = CARD_WIDTH;
  const h = CARD_HEIGHT;

  // Background gradient
  const bgGrad = ctx.createRadialGradient(w / 2, h * 0.3, 0, w / 2, h * 0.3, w * 0.8);
  bgGrad.addColorStop(0, COLORS.feltLight);
  bgGrad.addColorStop(0.5, COLORS.felt);
  bgGrad.addColorStop(1, COLORS.feltDark);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  // Border
  ctx.strokeStyle = COLORS.goldDim;
  ctx.lineWidth = 2;
  ctx.strokeRect(4, 4, w - 8, h - 8);

  // Top gold line
  ctx.fillStyle = COLORS.gold;
  ctx.fillRect(20, 15, w - 40, 2);

  // Title
  ctx.font = 'bold 24px "Space Grotesk", system-ui, sans-serif';
  ctx.fillStyle = COLORS.gold;
  ctx.textAlign = 'center';
  ctx.fillText("Bull 'Em", w / 2, 48);

  // Player name
  ctx.font = 'bold 20px "Space Grotesk", system-ui, sans-serif';
  ctx.fillStyle = COLORS.goldLight;
  ctx.fillText(displayName, w / 2, 78);

  ctx.font = '11px "Inter", system-ui, sans-serif';
  ctx.fillStyle = COLORS.goldDim;
  ctx.fillText('PLAYER STATS', w / 2, 96);

  // Divider
  ctx.fillStyle = COLORS.goldDim;
  ctx.fillRect(w * 0.1, 108, w * 0.8, 1);

  // Big stats row
  const statsY = 140;
  const colWidth = w / 4;

  const bigStats = [
    { label: 'Games', value: String(summary.gamesPlayed) },
    { label: 'Wins', value: String(summary.wins) },
    { label: 'Win Rate', value: summary.winRate !== null ? `${summary.winRate}%` : '—' },
    { label: 'Bull Acc.', value: summary.bullAccuracy !== null ? `${summary.bullAccuracy}%` : '—' },
  ];

  for (let i = 0; i < bigStats.length; i++) {
    const s = bigStats[i]!;
    const x = colWidth * i + colWidth / 2;

    ctx.font = 'bold 28px "Space Grotesk", system-ui, sans-serif';
    ctx.fillStyle = COLORS.goldLight;
    ctx.textAlign = 'center';
    ctx.fillText(s.value, x, statsY);

    ctx.font = '10px "Inter", system-ui, sans-serif';
    ctx.fillStyle = COLORS.goldDim;
    ctx.fillText(s.label, x, statsY + 16);
  }

  // Divider
  ctx.fillStyle = COLORS.goldDim;
  ctx.fillRect(w * 0.1, 175, w * 0.8, 1);

  // Bluff heat map mini visualization
  const heatY = 200;
  ctx.font = 'bold 10px "Inter", system-ui, sans-serif';
  ctx.fillStyle = COLORS.gold;
  ctx.textAlign = 'left';
  ctx.fillText('BLUFF PATTERN', 40, heatY);

  if (advancedStats.bluffHeatMap.length > 0) {
    const maxCalls = Math.max(...advancedStats.bluffHeatMap.map(d => d.totalCalls), 1);
    const cellSize = 24;
    const gap = 4;
    const startX = 40;
    const maxCells = Math.min(advancedStats.bluffHeatMap.length, 15);

    for (let i = 0; i < maxCells; i++) {
      const entry = advancedStats.bluffHeatMap[i]!;
      const bluffRate = entry.totalCalls > 0
        ? (entry.bluffsAttempted / entry.totalCalls) * 100
        : 0;
      const intensity = entry.totalCalls / maxCalls;
      const x = startX + i * (cellSize + gap);
      const y = heatY + 10;

      // Color based on bluff rate
      let color: string;
      if (bluffRate >= 60) color = '#ef4444';
      else if (bluffRate >= 45) color = '#f97316';
      else if (bluffRate >= 30) color = '#eab308';
      else if (bluffRate >= 15) color = '#22c55e';
      else color = '#334155';

      ctx.globalAlpha = 0.5 + intensity * 0.5;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, y, cellSize, cellSize, 3);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Round number
      ctx.font = '8px "Inter", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.textAlign = 'center';
      ctx.fillText(`R${entry.roundNumber}`, x + cellSize / 2, y + cellSize / 2 + 3);
    }
  } else {
    ctx.font = '11px "Inter", system-ui, sans-serif';
    ctx.fillStyle = COLORS.textDim;
    ctx.fillText('No bluff data yet', 40, heatY + 26);
  }

  // Career trend section
  const trendY = 260;
  ctx.font = 'bold 10px "Inter", system-ui, sans-serif';
  ctx.fillStyle = COLORS.gold;
  ctx.textAlign = 'left';
  ctx.fillText('CAREER TREND', 40, trendY);

  if (advancedStats.careerTrajectory.length >= 2) {
    const trajectory = advancedStats.careerTrajectory;
    const chartLeft = 40;
    const chartRight = w - 40;
    const chartTop = trendY + 12;
    const chartBottom = trendY + 80;
    const chartW = chartRight - chartLeft;
    const chartH = chartBottom - chartTop;

    const ratings = trajectory.map(p => p.rating);
    const minRating = Math.min(...ratings) - 20;
    const maxRating = Math.max(...ratings) + 20;
    const ratingRange = maxRating - minRating || 1;

    // Draw rating line
    ctx.beginPath();
    ctx.strokeStyle = COLORS.gold;
    ctx.lineWidth = 2;
    for (let i = 0; i < trajectory.length; i++) {
      const x = chartLeft + (i / (trajectory.length - 1)) * chartW;
      const y = chartBottom - ((trajectory[i]!.rating - minRating) / ratingRange) * chartH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Start and end ratings
    ctx.font = '10px "Inter", system-ui, sans-serif';
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'left';
    ctx.fillText(String(Math.round(ratings[0]!)), chartLeft, chartBottom + 14);
    ctx.textAlign = 'right';
    ctx.fillText(String(Math.round(ratings[ratings.length - 1]!)), chartRight, chartBottom + 14);

    // Rating change
    const ratingDelta = Math.round(ratings[ratings.length - 1]! - ratings[0]!);
    ctx.textAlign = 'center';
    ctx.fillStyle = ratingDelta >= 0 ? COLORS.green : COLORS.red;
    ctx.font = 'bold 12px "Inter", system-ui, sans-serif';
    ctx.fillText(`${ratingDelta >= 0 ? '+' : ''}${ratingDelta}`, w / 2, chartBottom + 14);
  } else {
    ctx.font = '11px "Inter", system-ui, sans-serif';
    ctx.fillStyle = COLORS.textDim;
    ctx.fillText('Need more data for trend', 40, trendY + 26);
  }

  // Rivalry section
  const rivalryY = 370;
  ctx.font = 'bold 10px "Inter", system-ui, sans-serif';
  ctx.fillStyle = COLORS.gold;
  ctx.textAlign = 'left';
  ctx.fillText('TOP RIVALRIES', 40, rivalryY);

  const rivals = advancedStats.rivalries.slice(0, 3);
  if (rivals.length > 0) {
    for (let i = 0; i < rivals.length; i++) {
      const rival = rivals[i]!;
      const y = rivalryY + 18 + i * 22;
      ctx.font = '12px "Inter", system-ui, sans-serif';
      ctx.fillStyle = COLORS.text;
      ctx.textAlign = 'left';
      ctx.fillText(rival.opponentName, 40, y);

      ctx.textAlign = 'right';
      const winRate = rival.gamesPlayed > 0
        ? Math.round((rival.wins / rival.gamesPlayed) * 100)
        : 0;
      ctx.fillStyle = winRate >= 50 ? COLORS.green : COLORS.red;
      ctx.fillText(`${rival.wins}W-${rival.losses}L (${winRate}%)`, w - 40, y);
    }
  } else {
    ctx.font = '11px "Inter", system-ui, sans-serif';
    ctx.fillStyle = COLORS.textDim;
    ctx.fillText('No rivalries yet', 40, rivalryY + 20);
  }

  // Bottom divider
  ctx.fillStyle = COLORS.goldDim;
  ctx.fillRect(w * 0.1, h - 45, w * 0.8, 1);

  // Footer
  ctx.font = '11px "Inter", system-ui, sans-serif';
  ctx.fillStyle = COLORS.goldDim;
  ctx.textAlign = 'center';
  ctx.fillText('bullem.fly.dev', w / 2, h - 25);

  // Bottom gold line
  ctx.fillStyle = COLORS.gold;
  ctx.fillRect(20, h - 15, w - 40, 2);
}

/**
 * Canvas-generated shareable stat card for social media.
 * Renders player stats, bluff heat map, career trend, and rivalries
 * into a downloadable/shareable image.
 */
export function ShareableStatCard({ displayName, summary, advancedStats }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    drawStatCard(ctx, displayName, summary, advancedStats);
    setImageUrl(canvas.toDataURL('image/png'));
  }, [displayName, summary, advancedStats]);

  const handleDownload = useCallback(() => {
    if (!imageUrl) return;
    const link = document.createElement('a');
    link.download = 'bull-em-stats.png';
    link.href = imageUrl;
    link.click();
  }, [imageUrl]);

  const handleShare = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (navigator.share && navigator.canShare) {
      try {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob) return;
        const file = new File([blob], 'bull-em-stats.png', { type: 'image/png' });
        const shareData = { files: [file], title: "Bull 'Em Stats" };
        if (navigator.canShare(shareData)) {
          await navigator.share(shareData);
          return;
        }
      } catch {
        // Fall through to clipboard
      }
    }

    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) return;
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      handleDownload();
    }
  }, [handleDownload]);

  return (
    <div className="w-full mb-6">
      <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-3 px-1">
        Shareable Stat Card
      </p>
      <div className="flex flex-col items-center gap-2">
        <canvas
          ref={canvasRef}
          width={CARD_WIDTH}
          height={CARD_HEIGHT}
          className="rounded-lg border border-[var(--gold-dim)] max-w-full h-auto"
          style={{ maxWidth: '300px' }}
        />
        <div className="flex gap-3">
          <button
            onClick={handleShare}
            className="text-[var(--gold)] hover:text-[var(--gold-light)] text-xs font-medium transition-colors flex items-center gap-1 min-h-[44px] px-3"
          >
            {copied ? 'Copied!' : 'Share'}
          </button>
          <span className="text-[var(--gold-dim)] text-xs flex items-center">|</span>
          <button
            onClick={handleDownload}
            className="text-[var(--gold)] hover:text-[var(--gold-light)] text-xs font-medium transition-colors min-h-[44px] px-3"
          >
            Download
          </button>
        </div>
      </div>
    </div>
  );
}
