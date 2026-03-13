import { memo, useMemo, useEffect, useRef, useCallback, useState } from 'react';
import { handToString, TurnAction, RoundPhase } from '@bull-em/shared';
import type { Player, PlayerId, HandCall, TurnEntry, Card, SpectatorPlayerCards } from '@bull-em/shared';
import type { DisconnectDeadlines } from '../context/GameContext.js';
import { getSeatPosition } from '../utils/roundtablePositions.js';
import { playerColor } from '../utils/cardUtils.js';
import { PlayerAvatarContent } from './PlayerAvatar.js';
import { HandDisplay } from './HandDisplay.js';
import { CardDisplay } from './CardDisplay.js';
import { HandSelector } from './HandSelector.js';
import { ActionButtons } from './ActionButtons.js';
import { CallHistory } from './CallHistory.js';
import { SpectatorView } from './SpectatorView.js';
import { QuickDrawChips } from './QuickDrawChips.js';
import { QuickDrawHint } from './QuickDrawHint.js';
import { DisconnectBanner } from './DisconnectBanner.js';
import { RoundtableDealingOverlay } from './RoundtableDealingOverlay.js';
import { useSound } from '../hooks/useSound.js';
import type { QuickDrawSuggestion } from '@bull-em/shared';

interface RoundtableGameLayoutProps {
  // Player data
  players: Player[];
  currentPlayerId: PlayerId;
  myPlayerId: string | null;
  maxCards: number;
  roundNumber: number;

  // Game state
  roundPhase: RoundPhase;
  currentHand: HandCall | null;
  lastCallerId: PlayerId | null;
  myCards: Card[];
  turnHistory: TurnEntry[];
  turnDeadline?: number | null;
  turnDurationMs?: number | null;
  spectatorCards?: SpectatorPlayerCards[];

  // UI state
  isMyTurn: boolean;
  isEliminated: boolean;
  isSpectator: boolean;
  isLastChanceCaller: boolean;
  canRaise: boolean;
  handSelectorOpen: boolean;
  pendingValid: boolean;
  pendingHand: HandCall | null;
  quickDrawOpen: boolean;
  quickDrawEnabled: boolean;
  quickDrawSuggestions: QuickDrawSuggestion[];

  // Call history visibility (controlled from header toggle in landscape)
  callHistoryVisible: boolean;

  // Disconnect deadlines
  disconnectDeadlines?: DisconnectDeadlines;

  /** When true, hides seat card backs so the cinematic reveal overlay can animate them. */
  revealInProgress?: boolean;

  // Action handlers
  onBull: () => void;
  onTrue: () => void;
  onLastChancePass: () => void;
  onOpenHandSelector: () => void;
  onHandSubmit: () => void;
  onHandChange: (hand: HandCall | null, valid: boolean) => void;
  onCardTap?: (card: Card) => void;
  onQuickDrawSelect: (suggestion: QuickDrawSuggestion) => void;
  onQuickDrawDismiss: () => void;
  onPlayerClick?: (player: Player) => void;
}

/** Format a TurnEntry action into a short display string. */
function formatSeatAction(entry: TurnEntry): { text: string; type: 'call' | 'bull' | 'true' | 'pass' } {
  switch (entry.action) {
    case TurnAction.CALL:
    case TurnAction.LAST_CHANCE_RAISE:
      return { text: entry.hand ? handToString(entry.hand) : 'calls', type: 'call' };
    case TurnAction.BULL:
      return { text: 'BULL', type: 'bull' };
    case TurnAction.TRUE:
      return { text: 'TRUE', type: 'true' };
    case TurnAction.LAST_CHANCE_PASS:
      return { text: 'pass', type: 'pass' };
  }
}

/** SVG circle timer ring around an opponent's avatar in landscape mode.
 *  Mirrors TileMeter's behavior but uses a circle instead of a rounded rect.
 *  Updated at 10fps via direct DOM manipulation. */
const AvatarTimerRing = memo(function AvatarTimerRing({
  turnDeadline,
  turnDurationMs,
}: {
  turnDeadline: number;
  turnDurationMs?: number | null;
}) {
  const circleRef = useRef<SVGCircleElement>(null);

  useEffect(() => {
    const total = turnDurationMs != null && turnDurationMs > 0
      ? turnDurationMs
      : Math.max(0, turnDeadline - Date.now());

    if (total <= 0) return;

    // Circle circumference: 2 * PI * r. Using r=19 for a 42px viewBox (center 21, radius 19)
    const circumference = 2 * Math.PI * 19;

    if (circleRef.current) {
      circleRef.current.style.strokeDasharray = `${circumference} ${circumference}`;
      circleRef.current.style.strokeDashoffset = '0';
      circleRef.current.style.stroke = 'var(--gold-dim)';
    }

    const mountTime = Date.now();

    const update = () => {
      if (!circleRef.current) return;
      const elapsed = Date.now() - mountTime;
      const pct = Math.max(0, 1 - elapsed / total);
      // Diminish clockwise from 12 o'clock — same technique as TileMeter:
      // shrink the visible dash and offset backward so the gap grows from the start.
      const visibleLength = circumference * pct;
      const gapLength = circumference - visibleLength;
      circleRef.current.style.strokeDasharray = `${visibleLength} ${circumference}`;
      circleRef.current.style.strokeDashoffset = String(-gapLength);
      circleRef.current.style.stroke = pct <= 0.3 ? 'var(--danger)' : 'var(--gold-dim)';
    };

    update();
    const interval = setInterval(update, 100);
    return () => clearInterval(interval);
  }, [turnDeadline, turnDurationMs]);

  return (
    <svg className="rt-avatar-timer-ring" viewBox="0 0 42 42" aria-hidden="true">
      <circle
        ref={circleRef}
        cx="21"
        cy="21"
        r="19"
        fill="none"
        strokeWidth="2.5"
        stroke="var(--gold-dim)"
        strokeLinecap="round"
        transform="rotate(-90 21 21)"
      />
    </svg>
  );
});

/** Vertical turn timer bar for the player's own turn in landscape mode.
 *  Runs top-to-bottom on the right edge of the screen, with sound effects
 *  and screen edge glow matching the portrait TurnIndicator. */
const LandscapeTurnTimer = memo(function LandscapeTurnTimer({
  turnDeadline,
  turnDurationMs,
  roundPhase,
  hasCurrentHand,
}: {
  turnDeadline: number;
  turnDurationMs?: number | null;
  roundPhase: RoundPhase;
  hasCurrentHand: boolean;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const lastTickRef = useRef<number | null>(null);
  const [tickPulse, setTickPulse] = useState(false);
  const { play } = useSound();

  const isLastChance = roundPhase === RoundPhase.LAST_CHANCE;

  const timeoutAction = (() => {
    switch (roundPhase) {
      case RoundPhase.LAST_CHANCE: return 'Auto-pass';
      case RoundPhase.BULL_PHASE: return 'Auto-bull';
      case RoundPhase.CALLING: return hasCurrentHand ? 'Auto-bull' : 'Auto-call';
      case RoundPhase.RESOLVING: return '';
    }
  })();

  useEffect(() => {
    const total = turnDurationMs != null && turnDurationMs > 0
      ? turnDurationMs
      : Math.max(0, turnDeadline - Date.now());

    lastTickRef.current = null;

    if (barRef.current) {
      barRef.current.style.height = '100%';
    }
    if (glowRef.current) {
      glowRef.current.style.opacity = '0';
    }

    if (total <= 0) return;

    const mountTime = Date.now();

    const update = () => {
      const elapsed = Date.now() - mountTime;
      const remainingMs = Math.max(0, total - elapsed);
      const pct = remainingMs / total;
      const secs = Math.ceil(remainingMs / 1000);

      if (barRef.current) {
        barRef.current.style.height = `${pct * 100}%`;
        barRef.current.style.background = pct <= 0.3 ? 'var(--danger)' : 'var(--info)';
      }

      // Screen edge glow — ramps from 0 to 1 over last 5 seconds
      if (glowRef.current) {
        const secsRemaining = remainingMs / 1000;
        if (secsRemaining <= 5 && secsRemaining > 0) {
          const intensity = 1 - (secsRemaining / 5);
          glowRef.current.style.opacity = String(intensity);
        } else {
          glowRef.current.style.opacity = '0';
        }
      }

      // Update countdown label
      if (labelRef.current) {
        if (secs > 0 && secs <= 5 && timeoutAction) {
          labelRef.current.textContent = `${timeoutAction} in ${secs}s`;
          labelRef.current.style.opacity = '1';
        } else {
          labelRef.current.style.opacity = '0';
        }
      }

      // Play tick + heartbeat each second during last 5 seconds
      if (secs > 0 && secs <= 5 && secs !== lastTickRef.current) {
        lastTickRef.current = secs;
        play('timerTick');
        play('heartbeat');
        setTickPulse(true);
        setTimeout(() => setTickPulse(false), 300);
      }
    };

    update();
    const interval = setInterval(update, 100);
    return () => clearInterval(interval);
  }, [turnDeadline, turnDurationMs, play, timeoutAction]);

  return (
    <>
      {/* Screen edge glow overlay — same as portrait TurnIndicator */}
      <div
        ref={glowRef}
        className="screen-edge-glow"
        style={{ opacity: 0 }}
        aria-hidden="true"
      />
      {/* Vertical bar on right edge */}
      <div className={`rt-turn-timer-track ${isLastChance ? 'rt-turn-timer-track--last-chance' : ''} ${tickPulse ? 'animate-timer-tick' : ''}`}>
        <div
          ref={barRef}
          className="rt-turn-timer-bar"
        />
      </div>
      {/* Autobull/auto-pass countdown label */}
      <div ref={labelRef} className="rt-autobull-label" style={{ opacity: 0 }} aria-live="polite" />
    </>
  );
});

/** Mini face-up card fan for spectator view at opponent seats. */
const SeatFaceUpCards = memo(function SeatFaceUpCards({ cards }: { cards: Card[] }) {
  if (cards.length <= 0) return null;
  const count = cards.length;
  return (
    <div className="rt-card-backs-fan">
      {cards.map((card, i) => {
        const angle = count === 1 ? 0 : (i - (count - 1) / 2) * 5;
        return (
          <div
            key={`${card.rank}-${card.suit}`}
            style={{
              transform: `rotate(${angle}deg)`,
              marginLeft: i > 0 ? '-6px' : undefined,
              zIndex: i,
            }}
          >
            <CardDisplay card={card} small />
          </div>
        );
      })}
    </div>
  );
});

/** Mini card-back fan for opponent seats — shows face-down cards matching their card count.
 *  When `visibleCount` is provided (during dealing), only that many cards are visible but
 *  all card slots are rendered to maintain stable layout — hidden cards use opacity 0. */
const SeatCardBacks = memo(function SeatCardBacks({ count, visibleCount }: { count: number; visibleCount?: number }) {
  if (count <= 0) return null;
  const showCount = visibleCount ?? count;
  const cards = [];
  for (let i = 0; i < count; i++) {
    const angle = count === 1 ? 0 : (i - (count - 1) / 2) * 5;
    cards.push(
      <div
        key={i}
        className="rt-card-back"
        style={{
          transform: `rotate(${angle}deg)`,
          marginLeft: i > 0 ? '-6px' : undefined,
          zIndex: i,
          opacity: i < showCount ? 1 : 0,
          transition: 'opacity 0.15s ease-out',
        }}
      />,
    );
  }
  return <div className="rt-card-backs-fan">{cards}</div>;
});

/** Player seat around the roundtable — poker-style with card backs, avatar, name, and action chip. */
const RoundtableSeat = memo(function RoundtableSeat({
  player,
  seatIndex,
  playerCount,
  isCurrent,
  isMe,
  lastAction,
  isLatestCaller,
  turnDeadline,
  turnDurationMs,
  visibleCardCount,
  spectatorFaceUpCards,
  onPlayerClick,
}: {
  player: Player;
  seatIndex: number;
  playerCount: number;
  isCurrent: boolean;
  isMe: boolean;
  lastAction: TurnEntry | null;
  isLatestCaller: boolean;
  turnDeadline?: number | null;
  turnDurationMs?: number | null;
  /** When set, only this many card backs are visible (used during dealing animation). */
  visibleCardCount?: number;
  /** When spectating, the player's cards shown face-up at the seat instead of card backs. */
  spectatorFaceUpCards?: Card[];
  /** Callback when a player's avatar is clicked (opens stats modal). */
  onPlayerClick?: (player: Player) => void;
}) {
  const pos = getSeatPosition(playerCount, seatIndex);
  const colorClass = playerColor(seatIndex, player.avatarBgColor);
  const action = lastAction ? formatSeatAction(lastAction) : null;

  return (
    <div
      className={`rt-seat ${isCurrent ? 'rt-seat--active' : ''} ${player.isEliminated ? 'rt-seat--eliminated' : ''}`}
      style={{ top: pos.top, left: pos.left }}
    >
      {/* Card+avatar stack — avatar overlaps bottom of cards */}
      <div className="rt-seat-card-avatar">
        {!player.isEliminated && spectatorFaceUpCards && spectatorFaceUpCards.length > 0 ? (
          <SeatFaceUpCards cards={spectatorFaceUpCards} />
        ) : !player.isEliminated && (
          <SeatCardBacks count={player.cardCount} visibleCount={visibleCardCount} />
        )}
        <div
          className={`rt-avatar ${colorClass} ${isMe ? 'rt-avatar--me' : ''} rt-avatar--overlap ${onPlayerClick ? 'cursor-pointer' : ''}`}
          onClick={onPlayerClick ? (e) => { e.stopPropagation(); onPlayerClick(player); } : undefined}
          role={onPlayerClick ? 'button' : undefined}
          tabIndex={onPlayerClick ? 0 : undefined}
          onKeyDown={onPlayerClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPlayerClick(player); } } : undefined}
          aria-label={onPlayerClick ? `View ${player.name}'s profile` : undefined}
        >
          <PlayerAvatarContent
            name={player.name}
            avatar={player.avatar}
            photoUrl={player.photoUrl}
            isBot={player.isBot}
          />
          {isCurrent && turnDeadline && !player.isEliminated && (
            <AvatarTimerRing turnDeadline={turnDeadline} turnDurationMs={turnDurationMs} />
          )}
        </div>
      </div>

      {/* Name below */}
      <div className="rt-seat-text rt-seat-text--center">
        <div className={`rt-name ${isMe ? 'rt-name--me' : ''}`}>
          {player.name}
        </div>
        {player.isEliminated && (
          <div className="rt-eliminated-badge">OUT</div>
        )}
      </div>

      {/* Last action chip — floats near the seat toward the table center */}
      {action && !player.isEliminated && (
        <div className={`rt-action-chip rt-action-chip--${action.type} ${isLatestCaller ? 'rt-action-chip--latest' : ''} ${action.type === 'call' && !isLatestCaller ? 'rt-action-chip--call-prior' : ''}`}>
          {action.text}
        </div>
      )}
    </div>
  );
});

/**
 * Roundtable game layout — renders the full game UI as a poker-table view.
 * Used in landscape/desktop mode as an alternative to the vertical portrait layout.
 *
 * Layout:
 * - Oval table background with opponent seats around it
 * - Seat 0 (bottom center) shows the local player's cards instead of an avatar
 * - Center of table: current call display
 * - Turn timers: ring around opponent avatars, vertical bar on right edge for own turn
 * - Action buttons + hand selector overlay the bottom area
 * - Call history: compact panel on the left edge
 */
export const RoundtableGameLayout = memo(function RoundtableGameLayout(props: RoundtableGameLayoutProps) {
  const {
    players, currentPlayerId, myPlayerId, maxCards, roundNumber,
    roundPhase, currentHand, lastCallerId, myCards, turnHistory,
    turnDeadline, turnDurationMs,
    spectatorCards,
    isMyTurn, isEliminated, isSpectator, isLastChanceCaller, canRaise,
    handSelectorOpen, pendingValid, pendingHand,
    quickDrawOpen, quickDrawEnabled, quickDrawSuggestions,
    callHistoryVisible,
    disconnectDeadlines,
    revealInProgress,
    onBull, onTrue, onLastChancePass,
    onOpenHandSelector, onHandSubmit, onHandChange,
    onCardTap, onQuickDrawSelect, onQuickDrawDismiss,
    onPlayerClick,
  } = props;

  // ── Dealing animation: show when roundNumber changes ──
  const prevRoundRef = useRef(0); // 0 = sentinel for "first mount"
  const [showDealing, setShowDealing] = useState(false);
  // Track how many cards have "landed" at each seat — used to progressively
  // reveal seat card backs so they appear in sync with the flying card animation.
  const [dealtPerSeat, setDealtPerSeat] = useState<Record<number, number>>({});

  const handleCardDealt = useCallback((seatIndex: number) => {
    setDealtPerSeat(prev => ({ ...prev, [seatIndex]: (prev[seatIndex] ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    const isFirstMount = prevRoundRef.current === 0;
    const roundChanged = prevRoundRef.current !== roundNumber;

    if (!roundChanged) return;

    // On first mount, only animate if the round is fresh (no calls made yet).
    // If there's already a currentHand or turnHistory, the player is joining
    // mid-round (e.g. orientation change or reconnect) — skip the animation.
    if (isFirstMount && (currentHand !== null || turnHistory.length > 0)) {
      prevRoundRef.current = roundNumber;
      return;
    }

    setShowDealing(true);
    setDealtPerSeat({}); // reset dealt counts for new round
    // Auto-hide after animation completes (safety net — overlay also self-removes)
    const activePlayers = players.filter(p => !p.isEliminated);
    const maxPlayerCards = Math.max(...activePlayers.map(p => p.cardCount), 0);
    const totalCards = maxPlayerCards * activePlayers.length;
    const timeout = totalCards * 180 + 350 + 300 + 400; // deal + fly + fade + buffer
    const t = setTimeout(() => setShowDealing(false), timeout);
    prevRoundRef.current = roundNumber;
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only trigger on roundNumber change;
    // players/currentHand/turnHistory are read inside and will have the correct values in that render.
  }, [roundNumber]);

  // Whether seat card backs should be suppressed (dealing or cinematic reveal in progress)
  const suppressSeatCards = showDealing || !!revealInProgress;

  // Spectator mode: build a lookup of player ID → face-up cards for rendering at seats
  const isSpectating = isEliminated || isSpectator;
  const spectatorCardsByPlayerId = useMemo(() => {
    if (!isSpectating || !spectatorCards) return undefined;
    const map = new Map<string, Card[]>();
    for (const sc of spectatorCards) {
      map.set(sc.playerId, sc.cards);
    }
    return map;
  }, [isSpectating, spectatorCards]);

  // Auto-open the hand selector when it becomes our turn in roundtable mode.
  // This replaces the turn indicator — the selector opening IS the turn signal.
  const prevCanRaise = useRef(canRaise);
  useEffect(() => {
    if (canRaise && !prevCanRaise.current && !handSelectorOpen) {
      onOpenHandSelector();
    }
    prevCanRaise.current = canRaise;
  }, [canRaise, handSelectorOpen, onOpenHandSelector]);

  // Reorder players so myPlayerId is seat 0 (bottom center)
  const orderedPlayers = useMemo(() => {
    const myIdx = players.findIndex(p => p.id === myPlayerId);
    if (myIdx <= 0) return players;
    return [...players.slice(myIdx), ...players.slice(0, myIdx)];
  }, [players, myPlayerId]);

  // Use total player count for seat positions (keep stable layout)
  const playerCount = Math.min(orderedPlayers.length, 12);

  const cardCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of players) counts[p.id] = p.cardCount;
    return counts;
  }, [players]);

  // Compute last action per player from turn history
  const lastActions = useMemo(() => {
    const actions: Record<string, TurnEntry> = {};
    for (const entry of turnHistory) {
      actions[entry.playerId] = entry;
    }
    return actions;
  }, [turnHistory]);

  // The player who made the most recent CALL/RAISE action (not bull/true/pass)
  const latestCallEntry = useMemo(() => {
    for (let i = turnHistory.length - 1; i >= 0; i--) {
      const entry = turnHistory[i];
      if (entry && (entry.action === TurnAction.CALL || entry.action === TurnAction.LAST_CHANCE_RAISE)) {
        return entry;
      }
    }
    return undefined;
  }, [turnHistory]);
  const latestCallerId = latestCallEntry?.playerId ?? null;

  // Seat 0 position for placing the player's own cards
  const mySeatPos = getSeatPosition(playerCount, 0);
  const myPlayer = orderedPlayers[0];
  const myAtMax = myPlayer ? myPlayer.cardCount >= maxCards && !myPlayer.isEliminated : false;

  return (
    <div className={`rt-layout ${isMyTurn ? 'rt-layout--my-turn' : ''}`}>
      {/* Table area with oval and player seats */}
      <div className={`rt-table-area ${playerCount >= 9 ? 'rt-table-area--crowded' : ''}`}>
        {/* Poker table surface */}
        <div className="rt-table">
          {/* Center content: action buttons flanking the current call */}
          <div className="rt-table-center">
            {!isEliminated && !isSpectator && (
              <div className="rt-center-left" data-tooltip="action-area">
                <ActionButtons
                  roundPhase={roundPhase}
                  isMyTurn={isMyTurn}
                  hasCurrentHand={currentHand !== null}
                  isLastChanceCaller={isLastChanceCaller}
                  onBull={onBull}
                  onTrue={onTrue}
                  onLastChancePass={onLastChancePass}
                />
              </div>
            )}

            {currentHand && (
              <div className="rt-current-call rt-current-call--lg animate-slide-up">
                <span className="rt-current-call-label">Current Call</span>
                <span className="rt-current-call-hand">
                  {handToString(currentHand)}
                </span>
              </div>
            )}

            {!isEliminated && !isSpectator && (
              <div className="rt-center-right" data-tooltip="raise-area">
                {canRaise && !handSelectorOpen && (
                  <div className="relative flex flex-col items-center">
                    {isLastChanceCaller && (
                      <span className="rt-last-chance-label">last chance</span>
                    )}
                    <button
                      onClick={onOpenHandSelector}
                      className="btn-ghost border-[var(--gold-dim)] action-btn-base font-bold animate-pulse-glow action-btn-primary kbd-shortcut"
                      data-kbd="C"
                    >
                      {currentHand ? 'Raise' : 'Call'}
                    </button>
                  </div>
                )}
                {canRaise && handSelectorOpen && (
                  <div className="relative flex flex-col items-center">
                    {isLastChanceCaller && (
                      <span className="rt-last-chance-label">last chance</span>
                    )}
                    <button
                      onClick={onHandSubmit}
                      disabled={!pendingValid}
                      className={`btn-gold action-btn-base font-bold action-btn-primary ${pendingValid ? 'hs-call-pulse' : ''}`}
                    >
                      {currentHand ? 'Raise' : 'Call'}
                    </button>
                    <p className={`absolute top-full text-[var(--danger)] mt-1 h-4 transition-opacity action-btn-hint ${pendingHand && !pendingValid ? 'opacity-100' : 'opacity-0'}`}>Must be higher</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Dealing animation overlay — shows deck + flying cards at round start */}
        {showDealing && (
          <RoundtableDealingOverlay
            key={roundNumber}
            myPlayerId={myPlayerId}
            myCards={myCards}
            playerCount={playerCount}
            orderedPlayers={orderedPlayers}
            onCardDealt={handleCardDealt}
          />
        )}

        {/* Opponent seats — skip seat 0 (local player), render from seat 1 onwards */}
        {orderedPlayers.slice(1, playerCount).map((player, i) => {
          const seatIdx = i + 1;
          // During dealing: progressive card reveal; during reveal: hide all card backs
          const visCardCount = suppressSeatCards
            ? (revealInProgress ? 0 : (dealtPerSeat[seatIdx] ?? 0))
            : undefined;
          return (
            <RoundtableSeat
              key={player.id}
              player={player}
              seatIndex={seatIdx}
              playerCount={playerCount}
              isCurrent={player.id === currentPlayerId}
              isMe={false}
              lastAction={lastActions[player.id] ?? null}
              isLatestCaller={player.id === latestCallerId}
              turnDeadline={player.id === currentPlayerId ? turnDeadline : null}
              turnDurationMs={turnDurationMs}
              visibleCardCount={visCardCount}
              spectatorFaceUpCards={spectatorCardsByPlayerId?.get(player.id)}
              onPlayerClick={onPlayerClick}
            />
          );
        })}

        {/* Seat 0: local player — face-up cards + name/info below */}
        {isSpectating && myPlayer ? (
          /* When spectating, render bottom seat like any other seat (same card size & layout) */
          <div
            className={`rt-seat ${myPlayer.id === currentPlayerId ? 'rt-seat--active' : ''} ${myPlayer.isEliminated ? 'rt-seat--eliminated' : ''}`}
            style={{ top: mySeatPos.top, left: mySeatPos.left }}
            data-tooltip="my-cards"
          >
            <div className="rt-seat-card-avatar">
              {!myPlayer.isEliminated && spectatorCardsByPlayerId?.get(myPlayer.id) && (
                <SeatFaceUpCards cards={spectatorCardsByPlayerId.get(myPlayer.id)!} />
              )}
              <div
                className={`rt-avatar ${playerColor(0, myPlayer.avatarBgColor)} rt-avatar--me rt-avatar--overlap ${onPlayerClick ? 'cursor-pointer' : ''}`}
                onClick={onPlayerClick ? (e) => { e.stopPropagation(); onPlayerClick(myPlayer); } : undefined}
                role={onPlayerClick ? 'button' : undefined}
                tabIndex={onPlayerClick ? 0 : undefined}
                onKeyDown={onPlayerClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPlayerClick(myPlayer); } } : undefined}
                aria-label={onPlayerClick ? `View ${myPlayer.name}'s profile` : undefined}
              >
                <PlayerAvatarContent
                  name={myPlayer.name}
                  avatar={myPlayer.avatar}
                  photoUrl={myPlayer.photoUrl}
                  isBot={myPlayer.isBot}
                />
                {myPlayer.id === currentPlayerId && turnDeadline && !myPlayer.isEliminated && (
                  <AvatarTimerRing turnDeadline={turnDeadline} turnDurationMs={turnDurationMs ?? undefined} />
                )}
              </div>
            </div>
            <div className="rt-seat-text rt-seat-text--center">
              <div className="rt-name rt-name--me">{myPlayer.name}</div>
              {myPlayer.isEliminated && (
                <div className="rt-eliminated-badge">OUT</div>
              )}
            </div>
          </div>
        ) : (
          <div
            className={`rt-seat rt-seat--me-cards ${myPlayer?.id === currentPlayerId ? 'rt-seat--active' : ''}`}
            style={{ top: mySeatPos.top, left: mySeatPos.left }}
            data-tooltip="my-cards"
          >
            {/* Quick Draw suggestions — positioned above the cards */}
            {!isEliminated && !isSpectator && quickDrawEnabled && !quickDrawOpen && (
              <div className="rt-quick-draw-above">
                <QuickDrawHint visible={canRaise} />
              </div>
            )}
            {quickDrawOpen && canRaise && quickDrawSuggestions.length > 0 && (
              <div className="rt-quick-draw-above">
                <QuickDrawChips
                  suggestions={quickDrawSuggestions}
                  onSelect={onQuickDrawSelect}
                  onDismiss={onQuickDrawDismiss}
                />
              </div>
            )}
            {!isEliminated && !isSpectator && (
              <HandDisplay
                cards={suppressSeatCards
                  ? (revealInProgress ? [] : myCards.slice(0, dealtPerSeat[0] ?? 0))
                  : myCards}
                large
                onCardTap={canRaise && quickDrawEnabled ? onCardTap : undefined}
              />
            )}
            {myPlayer && (
              <div className="rt-seat-info">
                <div
                  className={`rt-avatar ${playerColor(0, myPlayer.avatarBgColor)} rt-avatar--me ${onPlayerClick ? 'cursor-pointer' : ''}`}
                  onClick={onPlayerClick ? (e) => { e.stopPropagation(); onPlayerClick(myPlayer); } : undefined}
                  role={onPlayerClick ? 'button' : undefined}
                  tabIndex={onPlayerClick ? 0 : undefined}
                  onKeyDown={onPlayerClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPlayerClick(myPlayer); } } : undefined}
                  aria-label={onPlayerClick ? `View ${myPlayer.name}'s profile` : undefined}
                >
                  <PlayerAvatarContent
                    name={myPlayer.name}
                    avatar={myPlayer.avatar}
                    photoUrl={myPlayer.photoUrl}
                    isBot={myPlayer.isBot}
                  />
                </div>
                <div className="rt-seat-text">
                  <div className="rt-name rt-name--me">{myPlayer.name}</div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Call history — compact panel on the left (toggle button is in the header overlay) */}
      {callHistoryVisible && (
        <div className="rt-call-history" data-tooltip="call-history">
          <CallHistory history={turnHistory} cardCounts={cardCounts} forceVisible />
        </div>
      )}

      {/* Disconnect banners */}
      <DisconnectBanner
        players={players}
        disconnectDeadlines={disconnectDeadlines ?? new Map()}
      />

      {/* Player's own turn timer — vertical bar on right edge */}
      {isMyTurn && turnDeadline && !isEliminated && !isSpectator && roundPhase !== RoundPhase.RESOLVING && (
        <LandscapeTurnTimer
          turnDeadline={turnDeadline}
          turnDurationMs={turnDurationMs ?? undefined}
          roundPhase={roundPhase}
          hasCurrentHand={currentHand !== null}
        />
      )}

      {/* Bottom controls strip — hand selector (spectator cards are shown face-up at seats) */}
      <div className="rt-controls">

        {/* Hand selector */}
        {canRaise && handSelectorOpen && (
          <div className="rt-hand-selector" data-tooltip="hand-selector">
            <HandSelector
              currentHand={currentHand}
              onSubmit={onHandSubmit}
              onHandChange={onHandChange}
              showSubmit={false}
            />
          </div>
        )}
      </div>
    </div>
  );
});
