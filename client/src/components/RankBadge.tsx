import { RankTier, getRankTier } from '@bull-em/shared';

/** Tier display config: label, color, and icon character. */
const TIER_CONFIG: Record<RankTier, { label: string; color: string; bg: string; icon: string }> = {
  [RankTier.BRONZE]:   { label: 'Bronze',   color: '#cd7f32', bg: 'rgba(205,127,50,0.15)',  icon: '\u25C6' },
  [RankTier.SILVER]:   { label: 'Silver',   color: '#c0c0c0', bg: 'rgba(192,192,192,0.15)', icon: '\u25C6' },
  [RankTier.GOLD]:     { label: 'Gold',     color: '#d4a843', bg: 'rgba(212,168,67,0.15)',   icon: '\u25C6' },
  [RankTier.PLATINUM]: { label: 'Platinum', color: '#7dd3e0', bg: 'rgba(125,211,224,0.15)',  icon: '\u25C6' },
  [RankTier.DIAMOND]:  { label: 'Diamond',  color: '#b9f2ff', bg: 'rgba(185,242,255,0.2)',   icon: '\u2666' },
};

interface RankBadgeProps {
  /** Numeric rating (Elo or converted OpenSkill display rating). */
  rating: number;
  /** Override tier instead of computing from rating. */
  tier?: RankTier;
  /** Show the rating number next to the badge. Default false. */
  showRating?: boolean;
  /** Size variant. Default 'sm'. */
  size?: 'sm' | 'md';
}

/**
 * Small colored pip/icon indicating a player's rank tier.
 * Used next to player names in ranked contexts.
 */
export function RankBadge({ rating, tier, showRating = false, size = 'sm' }: RankBadgeProps) {
  const resolvedTier = tier ?? getRankTier(rating);
  const config = TIER_CONFIG[resolvedTier];

  const iconSize = size === 'md' ? '12px' : '9px';
  const fontSize = size === 'md' ? '11px' : '9px';

  return (
    <span
      className="inline-flex items-center gap-0.5 shrink-0"
      title={`${config.label} — ${Math.round(rating)}`}
    >
      <span
        style={{
          color: config.color,
          fontSize: iconSize,
          lineHeight: 1,
          filter: resolvedTier === RankTier.DIAMOND ? 'drop-shadow(0 0 2px rgba(185,242,255,0.6))' : undefined,
        }}
      >
        {config.icon}
      </span>
      {showRating && (
        <span
          style={{
            color: config.color,
            fontSize,
            fontWeight: 600,
            lineHeight: 1,
          }}
        >
          {Math.round(rating)}
        </span>
      )}
    </span>
  );
}

/** Larger badge for the matchmaking found screen — shows tier + label. */
export function RankBadgeLarge({ rating, tier }: { rating: number; tier?: RankTier }) {
  const resolvedTier = tier ?? getRankTier(rating);
  const config = TIER_CONFIG[resolvedTier];

  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
      style={{ background: config.bg, border: `1px solid ${config.color}40` }}
    >
      <span style={{ color: config.color, fontSize: '12px', lineHeight: 1 }}>
        {config.icon}
      </span>
      <span style={{ color: config.color, fontSize: '11px', fontWeight: 600, lineHeight: 1 }}>
        {config.label}
      </span>
      <span style={{ color: config.color, fontSize: '11px', fontWeight: 400, opacity: 0.8, lineHeight: 1 }}>
        {Math.round(rating)}
      </span>
    </span>
  );
}

export { TIER_CONFIG, getRankTier };
