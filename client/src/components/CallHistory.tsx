import { useState, memo } from 'react';
import { TurnAction, handToString } from '@bull-em/shared';
import type { TurnEntry, PlayerId } from '@bull-em/shared';

interface CallHistoryProps {
  history: TurnEntry[];
  /** Map from playerId to their current card count — shown as a badge next to the name. */
  cardCounts?: Record<PlayerId, number>;
}

// Memoized: the history array reference changes on every game state update
// (it's spread in getClientState), but the length is the primary render driver.
// React.memo with a custom comparator avoids re-rendering the (potentially
// long) list when nothing actually changed.
export const CallHistory = memo(function CallHistory({ history, cardCounts }: CallHistoryProps) {
  const [visible, setVisible] = useState(false);

  if (history.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setVisible(v => !v)}
        className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold px-1 mx-auto"
      >
        <span>{visible ? 'Hide' : 'Show'} Call History ({history.length})</span>
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className={`transition-transform ${visible ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {visible && (
        <div className="glass p-2 max-h-48 overflow-y-auto mt-1 animate-fade-in">
          <div className="flex flex-col-reverse gap-0.5">
            {history.map((entry, i) => {
              const count = cardCounts?.[entry.playerId];
              return (
                <div key={i} className="text-xs">
                  <span className="font-medium text-[var(--gold-light)]">{entry.playerName}</span>
                  {count != null && (
                    <span className="text-[var(--gold-dim)] opacity-70 ml-0.5 text-[10px]">[{count}]</span>
                  )}
                  {' '}
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
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}, (prev, next) => prev.history.length === next.history.length && prev.cardCounts === next.cardCounts);
