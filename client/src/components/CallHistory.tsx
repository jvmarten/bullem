import { TurnAction, handToString } from '@bull-em/shared';
import type { TurnEntry } from '@bull-em/shared';

export function CallHistory({ history }: { history: TurnEntry[] }) {
  if (history.length === 0) return null;
  return (
    <div className="glass p-2 max-h-20 overflow-y-auto">
      <h3 className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] mb-1 font-semibold">
        Call History
      </h3>
      <div className="flex flex-col-reverse gap-0.5">
        {history.map((entry, i) => (
          <div key={i} className="text-xs">
            <span className="font-medium text-[var(--gold-light)]">{entry.playerName}</span>{' '}
            {entry.action === TurnAction.CALL && entry.hand && (
              <span>
                calls <span className="text-[var(--gold)] font-semibold">{handToString(entry.hand)}</span>
              </span>
            )}
            {entry.action === TurnAction.BULL && (
              <span className="text-[var(--danger)] font-bold">BULL!</span>
            )}
            {entry.action === TurnAction.TRUE && (
              <span className="text-[var(--info)] font-bold">TRUE!</span>
            )}
            {entry.action === TurnAction.LAST_CHANCE_RAISE && entry.hand && (
              <span>
                raises to <span className="text-[var(--gold)] font-semibold">{handToString(entry.hand)}</span>
              </span>
            )}
            {entry.action === TurnAction.LAST_CHANCE_PASS && (
              <span className="opacity-50">passes</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
