import { BOT_PROFILE_MAP, BOT_AVATAR_MAP, IMPOSSIBLE_BOT } from '@bull-em/shared';
import type { BotProfileDefinition } from '@bull-em/shared';

interface Props {
  botName: string;
  onClose: () => void;
}

function getBotProfile(name: string): BotProfileDefinition | null {
  for (const [, profile] of BOT_PROFILE_MAP) {
    if (profile.name === name) return profile;
  }
  if (name === IMPOSSIBLE_BOT.name) return IMPOSSIBLE_BOT;
  return null;
}

function getLevelFromKey(key: string): number {
  const match = key.match(/_lvl(\d+)$/);
  return match ? parseInt(match[1]!, 10) : 0;
}

export function BotProfileModal({ botName, onClose }: Props) {
  const profile = getBotProfile(botName);
  const avatar = BOT_AVATAR_MAP.get(botName) ?? '\u2699';

  if (!profile) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
        <div className="glass p-6 rounded-xl max-w-xs text-center space-y-3" onClick={e => e.stopPropagation()}>
          <p className="text-lg font-bold text-[var(--gold)]">{botName}</p>
          <p className="text-sm text-[var(--gold-dim)]">Bot player</p>
        </div>
      </div>
    );
  }

  const level = getLevelFromKey(profile.key);
  const isImpossible = profile.key === IMPOSSIBLE_BOT.key;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="glass p-6 rounded-xl max-w-xs w-full space-y-4 animate-scale-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-[var(--gold)]/20 border-2 border-[var(--gold)] flex items-center justify-center mx-auto mb-3">
            <span className="text-3xl">{avatar}</span>
          </div>
          <h3 className="text-xl font-bold text-[var(--gold)]" style={{ fontFamily: "'Cormorant Garamond', serif" }}>
            {profile.name}
          </h3>
          <p className={`text-xs mt-1 ${isImpossible ? 'text-[var(--danger)]' : 'text-[var(--gold-dim)]'}`}>
            {isImpossible ? 'Level 10 — Impossible' : `Level ${level}`}
          </p>
        </div>

        {/* Personality */}
        <div>
          <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-1">
            Personality
          </p>
          <p className="text-xs text-[var(--gold-dim)]">{profile.personality}</p>
        </div>

        {/* Flavor text */}
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-1">
            Quotes
          </p>
          <p className="text-xs text-[var(--gold-dim)]">
            <span className="text-[var(--gold)]">Calls bull:</span> &ldquo;{profile.flavorText.callBull[0]}&rdquo;
          </p>
          <p className="text-xs text-[var(--gold-dim)]">
            <span className="text-[var(--gold)]">Big raise:</span> &ldquo;{profile.flavorText.bigRaise[0]}&rdquo;
          </p>
          <p className="text-xs text-[var(--gold-dim)]">
            <span className="text-[var(--gold)]">Wins:</span> &ldquo;{profile.flavorText.winRound[0]}&rdquo;
          </p>
          <p className="text-xs text-[var(--gold-dim)]">
            <span className="text-[var(--gold)]">Eliminated:</span> &ldquo;{profile.flavorText.eliminated[0]}&rdquo;
          </p>
        </div>

        {/* Close */}
        <button
          onClick={onClose}
          className="w-full btn-ghost py-2 text-sm"
        >
          Close
        </button>
      </div>
    </div>
  );
}
