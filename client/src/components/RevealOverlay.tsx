import { handToString, TurnAction } from '@bull-em/shared';
import type { RoundResult, Player, OwnedCard, TurnEntry, Card } from '@bull-em/shared';
import { CardDisplay } from './CardDisplay.js';
import { useEffect, useRef, useState, useMemo, memo } from 'react';

function FlipCard({ card, delay }: { card: Card; delay: number }) {
  return (
    <div className="card-flip-container">
      <div className={`card-flip-inner flip-delay-${Math.min(delay, 4)}`}>
        <div className="card-flip-front">
          <CardDisplay card={card} />
        </div>
        <div className="card-flip-back" />
      </div>
    </div>
  );
}

interface Props {
  result: RoundResult;
  players: Player[];
  onDismiss: () => void;
}

function actionLabel(entry: TurnEntry): string {
  switch (entry.action) {
    case TurnAction.CALL:
      return entry.hand ? `calls ${handToString(entry.hand)}` : 'calls';
    case TurnAction.BULL:
      return 'BULL!';
    case TurnAction.TRUE:
      return 'TRUE';
    case TurnAction.LAST_CHANCE_RAISE:
      return entry.hand ? `raises to ${handToString(entry.hand)}` : 'raises';
    case TurnAction.LAST_CHANCE_PASS:
      return 'passes';
    default:
      return String(entry.action);
  }
}

// Memoized: props are stable for the duration of the overlay. Without memo,
// parent re-renders (e.g. from the countdown timer in the game page) would
// re-render the entire overlay including flip-card animations.
export const RevealOverlay = memo(function RevealOverlay({ result, players, onDismiss }: Props) {
  const callerName = players.find((p) => p.id === result.callerId)?.name ?? 'Unknown';
  const [countdown, setCountdown] = useState(30);

  // Single interval instead of chained timeouts — avoids creating 30 timeout
  // closures and re-running the effect on every tick.
  const mountedAtRef = useRef(Date.now());
  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - mountedAtRef.current) / 1000);
      const remaining = Math.max(0, 30 - elapsed);
      setCountdown(remaining);
      if (remaining <= 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Memoize card grouping — result.revealedCards doesn't change once the
  // overlay is shown, so this avoids re-running the reduce on every countdown tick.
  const groupedCards = useMemo(() => {
    const grouped: Record<string, { name: string; cards: OwnedCard[] }> = {};
    for (const card of result.revealedCards) {
      if (!grouped[card.playerId]) {
        grouped[card.playerId] = { name: card.playerName, cards: [] };
      }
      grouped[card.playerId].cards.push(card);
    }
    let idx = 0;
    return Object.entries(grouped).map(([playerId, { name, cards }]) => {
      const startIndex = idx;
      idx += cards.length;
      return { playerId, name, cards, startIndex };
    });
  }, [result.revealedCards]);

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4"
         style={{ background: 'var(--overlay)' }}>
      <div className="glass-raised p-6 max-w-sm w-full space-y-5 text-center animate-scale-in max-h-[90vh] overflow-y-auto reveal-scroll"
           style={{ overscrollBehavior: 'contain' }}>
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

        {result.turnHistory && result.turnHistory.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] mb-2 font-semibold">
              Round Actions
            </p>
            <div className="space-y-1 max-h-24 overflow-y-auto">
              {result.turnHistory.map((entry, i) => {
                const name = players.find(p => p.id === entry.playerId)?.name ?? entry.playerName;
                return (
                  <div key={i} className="text-xs text-left px-2 py-0.5">
                    <span className="text-[var(--card-face)]">{name}</span>
                    <span className="text-[var(--gold-dim)] ml-1">
                      {actionLabel(entry)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {groupedCards.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] mb-2 font-semibold">
              Revealed Cards
            </p>
            {groupedCards.map(({ playerId, name, cards, startIndex }) => (
              <div key={playerId} className="mb-2">
                <p className="text-xs text-[var(--card-face)] font-medium mb-1">{name}</p>
                <div className="flex justify-center gap-1.5 flex-wrap">
                  {cards.map((card, j) => (
                    <FlipCard key={startIndex + j} card={card} delay={startIndex + j} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="text-left space-y-1">
          <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] mb-1.5 font-semibold">
            Results
          </p>
          {players.filter(p => result.penalties[p.id] !== undefined).map((p) => {
            const newCardCount = result.penalties[p.id];
            const wasWrong = result.penalizedPlayerIds?.includes(p.id) ?? newCardCount > p.cardCount;
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

        <div className="sticky bottom-0 pt-2 bg-gradient-to-t from-[var(--surface-raised)] to-transparent">
          <button onClick={onDismiss} className="w-full btn-gold py-3">
            {countdown > 0 ? `Continue (${countdown}s)` : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
});
