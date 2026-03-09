import { BOT_AVATAR_MAP } from '@bull-em/shared';
import type { AvatarId } from '@bull-em/shared';

/** Emoji icons for each avatar template. */
const AVATAR_ICONS: Record<string, string> = {
  bull: '\u{1F402}',
  ace: '\u{1F0CF}',
  crown: '\u{1F451}',
  diamond: '\u{1F48E}',
  skull: '\u{1F480}',
  star: '\u{2B50}',
  wolf: '\u{1F43A}',
  eagle: '\u{1F985}',
  lion: '\u{1F981}',
  fox: '\u{1F98A}',
  bear: '\u{1F43B}',
};

/** Returns the emoji for a given avatar ID, or the user's initial as fallback. */
function avatarText(avatar: AvatarId | null | undefined, fallbackName: string): string {
  if (avatar && avatar in AVATAR_ICONS) return AVATAR_ICONS[avatar]!;
  return fallbackName.charAt(0).toUpperCase();
}

interface PlayerAvatarProps {
  /** Player name (used for fallback initial). */
  name: string;
  /** Emoji avatar ID. */
  avatar?: AvatarId | null;
  /** Custom profile photo URL — takes priority over emoji avatar. */
  photoUrl?: string | null;
  /** Whether this is a bot player. */
  isBot?: boolean;
}

/**
 * Renders a player's avatar content: profile photo (if set) > emoji avatar > name initial.
 * For bots, uses the BOT_AVATAR_MAP emoji or a gear icon.
 *
 * Use inside a container that provides sizing and rounding (e.g. `.avatar` class).
 */
export function PlayerAvatarContent({ name, avatar, photoUrl, isBot }: PlayerAvatarProps): React.JSX.Element {
  // Bots always use their emoji or gear icon
  if (isBot) {
    return <>{BOT_AVATAR_MAP.get(name) ?? '\u2699'}</>;
  }

  // Profile photo takes priority over emoji avatar
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name}
        className="w-full h-full object-cover rounded-full"
        draggable={false}
      />
    );
  }

  // Fall back to emoji avatar or name initial
  return <>{avatarText(avatar, name)}</>;
}
