import { useRef, useEffect, useState, useCallback } from 'react';
import type { Player, PlayerId, GameStats } from '@bull-em/shared';

interface Props {
  players: Player[];
  winnerId: PlayerId | null;
  stats: GameStats;
}

/** Canvas dimensions for the share card image. */
const CARD_WIDTH = 600;
const CARD_HEIGHT = 400;

/** Colors matching the Bull 'Em palette. */
const COLORS = {
  feltDark: '#072914',
  felt: '#0b3d1e',
  feltLight: '#0f4d28',
  gold: '#d4a843',
  goldLight: '#e8c56e',
  goldDim: '#c49a3a',
  text: '#e8e0d4',
  textDim: '#a09888',
} as const;

function drawShareCard(
  ctx: CanvasRenderingContext2D,
  players: Player[],
  winnerId: PlayerId | null,
  stats: GameStats,
): void {
  const w = CARD_WIDTH;
  const h = CARD_HEIGHT;

  // Background gradient (felt green)
  const bgGrad = ctx.createRadialGradient(w / 2, h * 0.3, 0, w / 2, h * 0.3, w * 0.8);
  bgGrad.addColorStop(0, COLORS.feltLight);
  bgGrad.addColorStop(0.5, COLORS.felt);
  bgGrad.addColorStop(1, COLORS.feltDark);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  // Subtle border
  ctx.strokeStyle = COLORS.goldDim;
  ctx.lineWidth = 2;
  ctx.strokeRect(4, 4, w - 8, h - 8);

  // Gold accent line at top
  ctx.fillStyle = COLORS.gold;
  ctx.fillRect(20, 15, w - 40, 2);

  // Title
  ctx.font = 'bold 28px "Space Grotesk", system-ui, sans-serif';
  ctx.fillStyle = COLORS.gold;
  ctx.textAlign = 'center';
  ctx.fillText("Bull 'Em", w / 2, 50);

  // Subtitle — "Game Results"
  ctx.font = '12px "Inter", system-ui, sans-serif';
  ctx.fillStyle = COLORS.goldDim;
  ctx.fillText('GAME RESULTS', w / 2, 68);

  // Winner section
  const winner = players.find(p => p.id === winnerId);
  if (winner) {
    // Crown
    ctx.font = '32px serif';
    ctx.textAlign = 'center';
    ctx.fillText('\u{1F451}', w / 2, 108);

    // Winner name
    ctx.font = 'bold 22px "Space Grotesk", system-ui, sans-serif';
    ctx.fillStyle = COLORS.goldLight;
    ctx.fillText(winner.name, w / 2, 136);

    ctx.font = '13px "Inter", system-ui, sans-serif';
    ctx.fillStyle = COLORS.text;
    ctx.fillText('Winner', w / 2, 155);
  }

  // Divider
  ctx.fillStyle = COLORS.goldDim;
  ctx.fillRect(w * 0.15, 170, w * 0.7, 1);

  // Stats summary
  ctx.textAlign = 'left';
  const statsY = 195;
  const col1X = 40;
  const col2X = w / 2 + 20;

  ctx.font = 'bold 11px "Inter", system-ui, sans-serif';
  ctx.fillStyle = COLORS.gold;
  ctx.fillText('MATCH STATS', col1X, statsY);

  ctx.font = '12px "Inter", system-ui, sans-serif';
  ctx.fillStyle = COLORS.text;
  ctx.fillText(`Rounds: ${stats.totalRounds}`, col1X, statsY + 20);
  ctx.fillText(`Players: ${players.length}`, col1X, statsY + 38);

  // Player rankings
  const ranked = [...players].sort((a, b) => {
    if (a.id === winnerId) return -1;
    if (b.id === winnerId) return 1;
    const aSurvived = stats.playerStats[a.id]?.roundsSurvived ?? 0;
    const bSurvived = stats.playerStats[b.id]?.roundsSurvived ?? 0;
    return bSurvived - aSurvived;
  });

  ctx.font = 'bold 11px "Inter", system-ui, sans-serif';
  ctx.fillStyle = COLORS.gold;
  ctx.fillText('FINAL STANDINGS', col2X, statsY);

  ctx.font = '12px "Inter", system-ui, sans-serif';
  const maxDisplay = Math.min(ranked.length, 5);
  for (let i = 0; i < maxDisplay; i++) {
    const p = ranked[i]!;
    const ps = stats.playerStats[p.id];
    const label = i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i + 1}th`;
    ctx.fillStyle = i === 0 ? COLORS.goldLight : COLORS.text;
    ctx.fillText(`${label}  ${p.name}`, col2X, statsY + 20 + i * 18);
    if (ps) {
      ctx.fillStyle = COLORS.textDim;
      const detail = `${ps.roundsSurvived}r`;
      ctx.textAlign = 'right';
      ctx.fillText(detail, w - 40, statsY + 20 + i * 18);
      ctx.textAlign = 'left';
    }
  }

  // Bottom divider
  ctx.fillStyle = COLORS.goldDim;
  ctx.fillRect(w * 0.15, h - 60, w * 0.7, 1);

  // Footer
  ctx.font = '11px "Inter", system-ui, sans-serif';
  ctx.fillStyle = COLORS.goldDim;
  ctx.textAlign = 'center';
  ctx.fillText('bullem.fly.dev', w / 2, h - 35);

  // Gold accent line at bottom
  ctx.fillStyle = COLORS.gold;
  ctx.fillRect(20, h - 17, w - 40, 2);
}

export function ShareCard({ players, winnerId, stats }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    drawShareCard(ctx, players, winnerId, stats);

    // Generate data URL for download
    const url = canvas.toDataURL('image/png');
    setImageUrl(url);

    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, winnerId, stats]);

  const handleDownload = useCallback(() => {
    if (!imageUrl) return;
    const link = document.createElement('a');
    link.download = 'bull-em-results.png';
    link.href = imageUrl;
    link.click();
  }, [imageUrl]);

  const handleShare = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Try native share API first (mobile)
    if (navigator.share && navigator.canShare) {
      try {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob) return;

        const file = new File([blob], 'bull-em-results.png', { type: 'image/png' });
        const shareData = { files: [file], title: "Bull 'Em Results" };

        if (navigator.canShare(shareData)) {
          await navigator.share(shareData);
          return;
        }
      } catch {
        // User cancelled or share failed — fall through to clipboard
      }
    }

    // Fallback: copy image to clipboard
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) return;
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available — just download
      handleDownload();
    }
  }, [handleDownload]);

  return (
    <div className="flex flex-col items-center gap-2">
      <canvas
        ref={canvasRef}
        width={CARD_WIDTH}
        height={CARD_HEIGHT}
        className="rounded-lg border border-[var(--gold-dim)] max-w-full h-auto"
        style={{ maxWidth: '300px' }}
      />
      <div className="flex gap-2">
        <button
          onClick={handleShare}
          className="text-[var(--gold)] hover:text-[var(--gold-light)] text-xs font-medium transition-colors flex items-center gap-1"
        >
          {copied ? 'Copied!' : 'Share'}
        </button>
        <span className="text-[var(--gold-dim)] text-xs">|</span>
        <button
          onClick={handleDownload}
          className="text-[var(--gold)] hover:text-[var(--gold-light)] text-xs font-medium transition-colors"
        >
          Download
        </button>
      </div>
    </div>
  );
}
