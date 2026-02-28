import { handToString } from '@bull-em/shared';
import type { RoundResult, Player } from '@bull-em/shared';
import { CardDisplay } from './CardDisplay.js';
import { useEffect, useState } from 'react';

interface Props {
  result: RoundResult;
  players: Player[];
  onDismiss: () => void;
}

export function RevealOverlay({ result, players, onDismiss }: Props) {
  const callerName = players.find((p) => p.id === result.callerId)?.name ?? 'Unknown';
  const [countdown, setCountdown] = useState(30);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4"
         style={{ background: 'var(--overlay)' }}>
      <div className="glass-raised p-6 max-w-sm w-full space-y-5 text-center animate-scale-in">
        <h2 className="font-display text-2xl font-bold text-[var(--gold)]">Round Over</h2>

        <p className="text-[var(--card-face)]">
          {callerName} called:{' '}
          <span className="text-[var(--gold)] font-bold">{handToString(result.calledHand)}</span>
        </p>

        <div className={`text-2xl font-display font-bold py-3 rounded-lg ${
          result.handExists
            ? 'text-[var(--info)] bg-[var(--info-bg)] border border-[var(--info)]'
            : 'text-[var(--danger)] bg-[var(--danger-bg)] border border-[var(--danger)]'
        }`}>
          {result.handExists ? 'The hand EXISTS!' : 'BULL! Hand is fake!'}
        </div>

        {result.revealedCards.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] mb-2 font-semibold">
              Revealed Cards
            </p>
            <div className="flex justify-center gap-1.5 flex-wrap" style={{ perspective: '600px' }}>
              {result.revealedCards.map((card, i) => (
                <CardDisplay
                  key={i}
                  card={card}
                  className={`animate-stagger-reveal reveal-delay-${Math.min(i, 4)}`}
                />
              ))}
            </div>
          </div>
        )}

        <div className="text-left space-y-1">
          <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] mb-1.5 font-semibold">
            Results
          </p>
          {players.filter(p => result.penalties[p.id] !== undefined).map((p) => {
            const newCardCount = result.penalties[p.id];
            const wasWrong = newCardCount > p.cardCount;
            const isEliminated = result.eliminatedPlayerIds.includes(p.id);
            return (
              <div key={p.id} className={`flex justify-between items-center text-sm px-3 py-1.5 rounded-lg ${
                isEliminated ? 'bg-[var(--danger-bg)] text-[var(--danger)]' :
                wasWrong ? 'bg-amber-900/20 text-[var(--gold)]' : 'glass text-[var(--safe)]'
              }`}>
                <span className="font-medium">{p.name}</span>
                <span className="text-xs font-semibold">
                  {isEliminated ? 'ELIMINATED' :
                   wasWrong ? `+1 card (${newCardCount} total)` :
                   'Safe'}
                </span>
              </div>
            );
          })}
        </div>

        <button onClick={onDismiss} className="w-full btn-gold py-3">
          {countdown > 0 ? `Continue (${countdown}s)` : 'Continue'}
        </button>
      </div>
    </div>
  );
}
