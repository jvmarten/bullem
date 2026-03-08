import { handToString, TurnAction } from '@bull-em/shared';
import type { RoundResult, Player, OwnedCard, TurnEntry, Card, PlayerId } from '@bull-em/shared';
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
  myPlayerId?: PlayerId;
  onDismiss: () => void;
  /** When false, no countdown timer is shown and auto-dismiss is disabled. Defaults to true. */
  autoCountdown?: boolean;
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
export const RevealOverlay = memo(function RevealOverlay({ result, players, myPlayerId, onDismiss, autoCountdown = true }: Props) {
  const callerName = players.find((p) => p.id === result.callerId)?.name ?? 'Unknown';
  const [countdown, setCountdown] = useState(30);
  const [showBeat2, setShowBeat2] = useState(false);
  const [actionsExpanded, setActionsExpanded] = useState(false);

  // Determine personalized beat 1 message
  const beat1 = useMemo(() => {
    if (!myPlayerId) return null;
    const isCaller = myPlayerId === result.callerId;
    const wasPenalized = result.penalizedPlayerIds.includes(myPlayerId);

    if (isCaller && wasPenalized && !result.handExists) {
      // Was bluffing and got caught
      return { text: 'BUSTED', color: 'var(--danger)' };
    }
    if (wasPenalized) {
      return { text: 'WRONG', color: 'var(--danger)' };
    }
    return { text: 'SAFE', color: 'var(--safe)' };
  }, [myPlayerId, result.callerId, result.handExists, result.penalizedPlayerIds]);

  // Beat 2 is always the factual detail about the hand
  const beat2 = useMemo(() => {
    if (result.handExists) {
      return { text: 'The hand exists', color: 'var(--info)' };
    }
    return { text: 'Hand is fake', color: 'var(--danger)' };
  }, [result.handExists]);

  // Transition from beat 1 to beat 2 after a brief moment
  useEffect(() => {
    if (!beat1) return;
    const timer = setTimeout(() => setShowBeat2(true), 1500);
    return () => clearTimeout(timer);
  }, [beat1]);

  // Single interval instead of chained timeouts — avoids creating 30 timeout
  // closures and re-running the effect on every tick. Disabled when autoCountdown is false.
  const mountedAtRef = useRef(Date.now());
  useEffect(() => {
    if (!autoCountdown) return;
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - mountedAtRef.current) / 1000);
      const remaining = Math.max(0, 30 - elapsed);
      setCountdown(remaining);
      if (remaining <= 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [autoCountdown]);

  // Memoize card grouping — result.revealedCards doesn't change once the
  // overlay is shown, so this avoids re-running the reduce on every countdown tick.
  const groupedCards = useMemo(() => {
    const grouped: Record<string, { name: string; cards: OwnedCard[] }> = {};
    for (const card of result.revealedCards) {
      if (!grouped[card.playerId]) {
        grouped[card.playerId] = { name: card.playerName, cards: [] };
      }
      grouped[card.playerId]!.cards.push(card);
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
        <p className="text-[var(--card-face)]">
          {callerName} called:{' '}
          <span className="text-[var(--gold)] font-bold">{handToString(result.calledHand)}</span>
        </p>

        {/* Two-beat personalized result message */}
        {beat1 ? (
          <div
            className="py-3 px-4 rounded-xl border-2 animate-cube-roll-in relative overflow-hidden"
            style={{
              minHeight: '3.5rem',
              borderColor: showBeat2 ? beat2.color : beat1.color,
              background: showBeat2
                ? (result.handExists ? 'var(--info-bg)' : 'var(--danger-bg)')
                : (beat1.color === 'var(--safe)' ? 'rgba(40, 167, 69, 0.15)' : 'var(--danger-bg)'),
              transition: 'border-color 0.5s ease, background 0.5s ease',
            }}
          >
            {/* Beat 1 text — fades out and scales down */}
            <div
              className="font-display text-3xl font-bold"
              style={{
                color: beat1.color,
                transition: 'opacity 0.4s ease, transform 0.4s ease',
                opacity: showBeat2 ? 0 : 1,
                transform: showBeat2 ? 'scale(0.8) translateY(-4px)' : 'scale(1) translateY(0)',
                position: showBeat2 ? 'absolute' : 'relative',
                inset: showBeat2 ? 0 : undefined,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {beat1.text}
            </div>
            {/* Beat 2 text — fades in and scales up */}
            <div
              className="font-display text-3xl font-bold"
              style={{
                color: beat2.color,
                transition: 'opacity 0.4s ease 0.15s, transform 0.4s ease 0.15s',
                opacity: showBeat2 ? 1 : 0,
                transform: showBeat2 ? 'scale(1) translateY(0)' : 'scale(1.15) translateY(4px)',
                position: showBeat2 ? 'relative' : 'absolute',
                inset: showBeat2 ? undefined : 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {beat2.text}
            </div>
          </div>
        ) : (
          /* Fallback for spectators / no player context */
          <div className={`text-2xl font-display font-bold py-3 px-4 rounded-xl border-2 animate-cube-roll-in ${
            result.handExists
              ? 'text-[var(--info)] bg-[var(--info-bg)] border-[var(--info)]'
              : 'text-[var(--danger)] bg-[var(--danger-bg)] border-[var(--danger)]'
          }`}>
            {result.handExists ? 'The hand EXISTS!' : 'BULL! Hand is fake!'}
          </div>
        )}

        {result.turnHistory && result.turnHistory.length > 0 && (
          <div>
            <button
              onClick={() => setActionsExpanded(v => !v)}
              className="w-full flex items-center justify-between text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-1 bg-transparent border-none p-0 cursor-pointer"
            >
              <span>Round Actions</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className={`transition-transform duration-200 ${actionsExpanded ? 'rotate-180' : ''}`}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {actionsExpanded && (
              <div className="space-y-1 max-h-24 overflow-y-auto animate-fade-in">
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
            )}
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
            const wasWrong = result.penalizedPlayerIds?.includes(p.id) ?? newCardCount! > p.cardCount;
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
          <button onClick={onDismiss} className={`w-full btn-gold py-3 transition-all ${autoCountdown && countdown > 0 && countdown <= 5 ? 'animate-pulse-glow' : ''}`}>
            {autoCountdown && countdown > 0 ? (
              <>
                Continue{' '}
                <span className={`inline-block transition-all ${
                  countdown <= 5 ? 'text-[var(--danger)] font-bold text-lg' : ''
                }`}>
                  ({countdown}s)
                </span>
              </>
            ) : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
});
