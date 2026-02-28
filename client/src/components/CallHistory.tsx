import { TurnAction, handToString } from '@bull-em/shared';
import type { TurnEntry } from '@bull-em/shared';

export function CallHistory({ history }: { history: TurnEntry[] }) {
  if (history.length === 0) return null;
  return (
    <div className="bg-green-800/50 rounded-lg p-3 max-h-40 overflow-y-auto">
      <h3 className="text-xs uppercase text-green-400 mb-2">Call History</h3>
      <div className="space-y-1">
        {history.map((entry, i) => (
          <div key={i} className="text-sm">
            <span className="font-medium text-green-200">{entry.playerName}</span>{' '}
            {entry.action === TurnAction.CALL && entry.hand && (
              <span>
                calls <span className="text-yellow-300">{handToString(entry.hand)}</span>
              </span>
            )}
            {entry.action === TurnAction.LAST_CHANCE_RAISE && entry.hand && (
              <span>
                raises to <span className="text-yellow-300">{handToString(entry.hand)}</span>
              </span>
            )}
            {entry.action === TurnAction.LAST_CHANCE_PASS && (
              <span className="text-gray-400">passes</span>
            )}
            {entry.action === TurnAction.BULL && (
              <span className="text-red-400 font-bold">BULL!</span>
            )}
            {entry.action === TurnAction.TRUE && (
              <span className="text-blue-400 font-bold">TRUE!</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
