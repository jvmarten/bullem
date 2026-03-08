import { BOT_AVATAR_MAP } from '@bull-em/shared';
import type { Player, InGamePlayerStats } from '@bull-em/shared';
import { playerInitial, playerColor } from '../utils/cardUtils.js';

interface Props {
  player: Player;
  playerIndex: number;
  stats: InGamePlayerStats | null;
  onClose: () => void;
}

export function BotProfileModal({ player, playerIndex, stats, onClose }: Props) {
  const avatar = player.isBot
    ? (BOT_AVATAR_MAP.get(player.name) ?? '\u2699')
    : playerInitial(player.name);

  const bullAcc = stats && stats.bullsCalled > 0
    ? Math.round((stats.correctBulls / stats.bullsCalled) * 100)
    : null;
  const trueAcc = stats && stats.truesCalled > 0
    ? Math.round((stats.correctTrues / stats.truesCalled) * 100)
    : null;
  const bluffRate = stats && stats.callsMade > 0
    ? Math.round((stats.bluffsSuccessful / stats.callsMade) * 100)
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="glass p-6 rounded-xl max-w-xs w-full space-y-4 animate-scale-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="text-center">
          <div className={`w-16 h-16 rounded-full ${playerColor(playerIndex)} flex items-center justify-center mx-auto mb-3 text-3xl`}>
            {avatar}
          </div>
          <h3 className="text-xl font-bold text-[var(--gold)]" style={{ fontFamily: "'Cormorant Garamond', serif" }}>
            {player.name}
          </h3>
          <p className="text-xs mt-1 text-[var(--gold-dim)]">
            {player.isBot ? 'Bot' : 'Player'}
            {player.isEliminated && ' — Eliminated'}
          </p>
        </div>

        {/* Match Stats */}
        {stats ? (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">
              Match Stats
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="glass p-2 text-center">
                <p className="text-sm font-bold text-[#e8e0d4]">{stats.correctBulls}/{stats.bullsCalled}</p>
                <p className="text-[10px] text-[var(--gold-dim)]">Bulls</p>
                {bullAcc !== null && (
                  <p className="text-[var(--gold)] font-semibold text-xs">{bullAcc}%</p>
                )}
              </div>
              <div className="glass p-2 text-center">
                <p className="text-sm font-bold text-[#e8e0d4]">{stats.correctTrues}/{stats.truesCalled}</p>
                <p className="text-[10px] text-[var(--gold-dim)]">Trues</p>
                {trueAcc !== null && (
                  <p className="text-[var(--gold)] font-semibold text-xs">{trueAcc}%</p>
                )}
              </div>
              <div className="glass p-2 text-center">
                <p className="text-sm font-bold text-[#e8e0d4]">{stats.callsMade}</p>
                <p className="text-[10px] text-[var(--gold-dim)]">Calls Made</p>
              </div>
              <div className="glass p-2 text-center">
                <p className="text-sm font-bold text-[#e8e0d4]">{stats.bluffsSuccessful}</p>
                <p className="text-[10px] text-[var(--gold-dim)]">Bluffs</p>
                {bluffRate !== null && (
                  <p className="text-[var(--gold)] font-semibold text-xs">{bluffRate}%</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-center text-sm text-[var(--gold-dim)]">
            No stats yet — game just started.
          </p>
        )}

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
