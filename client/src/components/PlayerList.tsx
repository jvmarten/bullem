import { useState, useEffect, useRef, useMemo, memo } from 'react';
import { TurnAction, handToString, BOT_AVATAR_MAP } from '@bull-em/shared';
import type { Player, PlayerId, TurnEntry, EmojiReaction, RankTier } from '@bull-em/shared';
import { playerInitial, playerColor } from '../utils/cardUtils.js';
import { avatarDisplay } from '../pages/ProfilePage.js';
import { RankBadge } from './RankBadge.js';

interface Props {
  players: Player[];
  currentPlayerId?: PlayerId;
  myPlayerId?: string | null;
  maxCards?: number;
  showRemoveBot?: boolean;
  onRemoveBot?: (botId: string) => void;
  showKickPlayer?: boolean;
  onKickPlayer?: (playerId: string) => void;
  roundNumber?: number;
  turnHistory?: TurnEntry[];
  /** Enable collapse/expand toggle. Default shown (expanded). */
  collapsible?: boolean;
  /** Active emoji reactions to display as floating bubbles. */
  reactions?: EmojiReaction[];
  /** Player ratings for ranked games — maps playerId to { rating, tier }. */
  playerRatings?: ReadonlyMap<PlayerId, { rating: number; tier: RankTier }>;
  /** Called when a player tile is tapped/clicked. */
  onPlayerClick?: (player: Player) => void;
  /** Turn deadline timestamp — used to show subtle timer on current player's tile */
  turnDeadline?: number | null;
}

/* Full-border timer meter that wraps around the entire player tile.
   Uses an SVG rect with stroke-dasharray to show remaining turn time
   as a shrinking border highlight running clockwise from top-left.
   Updated at 10fps via direct DOM manipulation to avoid React re-renders.
   The SVG viewBox is set dynamically via ResizeObserver so the rect
   always matches the tile size. */
const TileMeter = memo(function TileMeter({ turnDeadline }: { turnDeadline: number }) {
  const rectRef = useRef<SVGRectElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const totalRef = useRef<number>(0);
  const perimRef = useRef<number>(0);

  // Resize the SVG viewBox to match the parent tile dimensions
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const parent = svg.parentElement;
    if (!parent) return;

    const syncSize = () => {
      const { width, height } = parent.getBoundingClientRect();
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      const rect = rectRef.current;
      if (rect) {
        rect.setAttribute('x', '1');
        rect.setAttribute('y', '1');
        rect.setAttribute('width', String(width - 2));
        rect.setAttribute('height', String(height - 2));
        perimRef.current = rect.getTotalLength();
      }
    };

    syncSize();
    const ro = new ResizeObserver(syncSize);
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const now = Date.now();
    const total = turnDeadline - now;
    totalRef.current = total;

    // Reset meter to full immediately
    if (rectRef.current) {
      const perim = perimRef.current || rectRef.current.getTotalLength();
      perimRef.current = perim;
      // Clockwise from top-left: visible dash = full perimeter, no gap
      rectRef.current.style.strokeDasharray = `${perim} ${perim}`;
      rectRef.current.style.strokeDashoffset = '0';
      rectRef.current.style.stroke = 'var(--gold-dim)';
    }

    if (total <= 0) return;

    const update = () => {
      const remaining = Math.max(0, turnDeadline - Date.now());
      const t = totalRef.current;
      const perim = perimRef.current;
      if (t <= 0 || !perim || !rectRef.current) return;
      const pct = remaining / t;
      // Clockwise from top-left: visible dash shrinks as time runs out
      const visibleLength = perim * pct;
      rectRef.current.style.strokeDasharray = `${visibleLength} ${perim}`;
      rectRef.current.style.strokeDashoffset = '0';
      rectRef.current.style.stroke = pct <= 0.3 ? 'var(--danger)' : 'var(--gold-dim)';
    };

    update();
    const interval = setInterval(update, 100);
    return () => clearInterval(interval);
  }, [turnDeadline]);

  return (
    <svg
      ref={svgRef}
      className="tile-timer-border"
      aria-hidden="true"
    >
      <rect
        ref={rectRef}
        rx="7"
        ry="7"
        fill="none"
        strokeWidth="2"
        stroke="var(--gold-dim)"
      />
    </svg>
  );
});

/* Mini card-back fan: shows card backs matching the player's card count */
function CardBackFan({ count, roundNumber, playerIndex }: { count: number; roundNumber?: number; playerIndex: number }) {
  if (count <= 0) return null;
  // Use roundNumber as key suffix so animation re-triggers each round
  const animate = roundNumber !== undefined;
  const cards = Array.from({ length: count }, (_, i) => {
    const angle = count === 1 ? 0 : (i - (count - 1) / 2) * 6;
    const baseDelay = playerIndex * 80;
    const cardDelay = baseDelay + i * 60;
    return (
      <div
        key={`${roundNumber ?? 0}-${i}`}
        className={`card-back-mini${animate ? ' animate-mini-deal' : ''}`}
        style={{
          transform: `rotate(${angle}deg)`,
          marginLeft: i > 0 ? '-4px' : undefined,
          animationDelay: animate ? `${cardDelay}ms` : undefined,
        }}
      />
    );
  });
  return <div className="flex items-center">{cards}</div>;
}

function formatAction(e: TurnEntry): string {
  switch (e.action) {
    case TurnAction.CALL:
      return e.hand ? handToString(e.hand) : 'calls';
    case TurnAction.BULL:
      return 'BULL!';
    case TurnAction.TRUE:
      return 'TRUE';
    case TurnAction.LAST_CHANCE_RAISE:
      return e.hand ? handToString(e.hand) : 'raises';
    case TurnAction.LAST_CHANCE_PASS:
      return 'pass';
  }
}

/** Build a map of playerId → last action string in a single reverse pass.
 *  O(history.length) instead of O(players * history.length). */
function buildLastActionMap(history?: TurnEntry[]): Map<PlayerId, string> {
  const map = new Map<PlayerId, string>();
  if (!history) return map;
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i]!;
    if (!map.has(e.playerId)) {
      map.set(e.playerId, formatAction(e));
    }
  }
  return map;
}

// Memoized to skip re-renders when only other players' state changed.
// Receives `lastAction` as a primitive string instead of the full turnHistory
// array, so memo comparison works effectively.
const PlayerCard = memo(function PlayerCard({ p, i, isCurrent, isMe, maxCards, roundNumber, lastAction, showRemoveBot, onRemoveBot, showKickPlayer, onKickPlayer, reactions, rankInfo, onPlayerClick, turnDeadline }: {
  p: Player; i: number; isCurrent: boolean; isMe: boolean; maxCards: number;
  roundNumber?: number; lastAction: string | null;
  showRemoveBot?: boolean; onRemoveBot?: (botId: string) => void;
  showKickPlayer?: boolean; onKickPlayer?: (playerId: string) => void;
  reactions?: EmojiReaction[];
  rankInfo?: { rating: number; tier: RankTier };
  onPlayerClick?: (player: Player) => void;
  turnDeadline?: number | null;
}) {
  // Show timer meter on the current player's tile when it's not me.
  // Allow 1s grace period so the meter still shows when the deadline
  // arrives slightly before the next turn starts.
  const showMeter = isCurrent && !isMe && !p.isEliminated && turnDeadline != null && turnDeadline > Date.now() - 1000;

  return (
    <div
      className={`relative flex items-center justify-between px-2 py-1 rounded-lg text-sm transition-all duration-500 ${
        p.isEliminated
          ? 'glass opacity-40'
          : isMe
            ? isCurrent
              ? 'glass-me border border-[var(--danger)] ring-1 ring-[var(--gold)] animate-pulse-glow'
              : 'glass-me'
            : isCurrent
              ? 'glass-raised border border-[var(--danger)] ring-1 ring-[var(--gold)] animate-pulse-glow'
              : 'glass'
      } ${!p.isEliminated && !p.isConnected ? 'player-disconnected' : ''}`}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <div
          onClick={onPlayerClick ? (e) => { e.stopPropagation(); onPlayerClick(p); } : undefined}
          role={onPlayerClick ? 'button' : undefined}
          tabIndex={onPlayerClick ? 0 : undefined}
          onKeyDown={onPlayerClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPlayerClick(p); } } : undefined}
          className={`avatar avatar-sm ${playerColor(i)} ${p.isEliminated ? 'opacity-50' : ''} ${isCurrent && !p.isEliminated ? 'avatar-active-turn' : ''} ${onPlayerClick ? 'cursor-pointer' : ''}`}
        >
          {p.isBot ? (BOT_AVATAR_MAP.get(p.name) ?? '\u2699') : avatarDisplay(p.avatar, p.name)}
        </div>
        <div className="flex flex-col min-w-0">
          <span className="font-medium truncate text-xs">
            {p.name}
            {p.isAdmin && <span className="text-[var(--gold)] ml-0.5 text-[10px]" title="Admin">{'\u2B50'}</span>}
            {rankInfo && <RankBadge rating={rankInfo.rating} tier={rankInfo.tier} />}
            {isMe && <span className="text-[var(--gold)] ml-1 text-[10px]">(you)</span>}
            {p.isBot && <span className="text-[var(--gold-dim)] ml-1 text-[10px]">[BOT]</span>}
            {p.isHost && <span className="text-[var(--gold-dim)] ml-1 text-[10px]">host</span>}
          </span>
          <div className="flex items-center gap-1">
            <span className={p.isEliminated ? 'hidden' : p.isConnected ? 'dot-connected' : 'dot-disconnected'} />
            {(() => {
              if (!lastAction || p.isEliminated) return null;
              const isBull = lastAction === 'BULL!';
              const isTrue = lastAction === 'TRUE';
              return (
                <span className={`text-[9px] truncate max-w-[100px] ${
                  isBull ? 'text-[var(--danger)] font-bold' :
                  isTrue ? 'text-[var(--info)] font-bold' :
                  'text-[var(--gold-dim)]'
                }`}>
                  {lastAction}
                </span>
              );
            })()}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-xs flex-shrink-0">
        {p.isEliminated ? (
          <span className="text-[var(--danger)] font-bold tracking-wide text-[10px]">OUT</span>
        ) : (
          <div className="flex flex-col items-center gap-0.5">
            <span className={`font-bold text-xs ${
              p.cardCount >= maxCards ? 'text-[var(--danger)]' : 'text-[var(--gold-dim)]'
            }`}>
              {p.cardCount}/{maxCards}
            </span>
            <CardBackFan
              count={p.cardCount}
              roundNumber={roundNumber}
              playerIndex={i}
            />
          </div>
        )}
        {showRemoveBot && p.isBot && onRemoveBot && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemoveBot(p.id); }}
            className="text-[var(--danger)] hover:text-red-400 transition-colors text-xs ml-1"
            title="Remove bot"
          >
            ✕
          </button>
        )}
        {showKickPlayer && !p.isBot && !p.isHost && onKickPlayer && (
          <button
            onClick={(e) => { e.stopPropagation(); onKickPlayer(p.id); }}
            className="text-[var(--danger)] hover:text-red-400 transition-colors text-xs ml-1"
            title="Kick player"
          >
            ✕
          </button>
        )}
      </div>
      {/* Floating emoji reactions */}
      {reactions && reactions.length > 0 && (
        <div className="emoji-bubble-container">
          {reactions.map((r) => (
            <span key={`${r.playerId}-${r.timestamp}`} className="emoji-bubble">
              {r.emoji}
            </span>
          ))}
        </div>
      )}
      {/* Subtle opponent turn timer meter */}
      {showMeter && <TileMeter turnDeadline={turnDeadline!} />}
    </div>
  );
});

// Memoized: during gameplay the parent (GamePage/LocalGamePage) re-renders on
// every game state broadcast (timer ticks, other players' actions), but the
// PlayerList props are often the same. Without memo, buildLastActionMap and
// the collapsed-view player lookup run on every parent render.
export const PlayerList = memo(function PlayerList({ players, currentPlayerId, myPlayerId, maxCards = 5, showRemoveBot, onRemoveBot, showKickPlayer, onKickPlayer, roundNumber, turnHistory, collapsible, reactions, playerRatings, onPlayerClick, turnDeadline }: Props) {
  const [collapsed, setCollapsed] = useState(!!collapsible);
  // Build the last-action map once per render instead of scanning history
  // per-player. Memoized on history length since a new entry = new length.
  const lastActionMap = useMemo(() => buildLastActionMap(turnHistory), [turnHistory?.length]);
  // Group reactions by player ID for efficient per-card lookup
  const reactionsMap = useMemo(() => {
    const map = new Map<PlayerId, EmojiReaction[]>();
    if (!reactions) return map;
    for (const r of reactions) {
      const list = map.get(r.playerId);
      if (list) list.push(r);
      else map.set(r.playerId, [r]);
    }
    return map;
  }, [reactions]);

  if (collapsible && collapsed) {
    const currentPlayer = players.find(p => p.id === currentPlayerId);
    const currentIndex = players.findIndex(p => p.id === currentPlayerId);
    const activeCount = players.filter(p => !p.isEliminated).length;

    // Find the next active (non-eliminated) player after the current player in turn order
    const activePlayers = players.filter(p => !p.isEliminated);
    const currentActiveIdx = activePlayers.findIndex(p => p.id === currentPlayerId);
    const nextActiveIdx = currentActiveIdx >= 0 ? (currentActiveIdx + 1) % activePlayers.length : -1;
    const nextPlayer = nextActiveIdx >= 0 ? activePlayers[nextActiveIdx] : undefined;
    const nextPlayerGlobalIndex = nextPlayer ? players.findIndex(p => p.id === nextPlayer.id) : -1;

    return (
      <div>
        <button
          onClick={() => setCollapsed(false)}
          className="w-full flex items-center justify-between text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-1 px-1"
        >
          <span>Players ({activeCount}/{players.length})</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        <div className="grid grid-cols-2 gap-1">
          {currentPlayer && (
            <PlayerCard
              p={currentPlayer}
              i={currentIndex >= 0 ? currentIndex : 0}
              isCurrent
              isMe={currentPlayer.id === myPlayerId}
              maxCards={maxCards}
              roundNumber={roundNumber}
              lastAction={lastActionMap.get(currentPlayer.id) ?? null}
              reactions={reactionsMap.get(currentPlayer.id)}
              rankInfo={playerRatings?.get(currentPlayer.id)}
              onPlayerClick={onPlayerClick}
              turnDeadline={turnDeadline}
            />
          )}
          {nextPlayer && nextPlayer.id !== currentPlayerId && (
            <PlayerCard
              p={nextPlayer}
              i={nextPlayerGlobalIndex >= 0 ? nextPlayerGlobalIndex : 0}
              isCurrent={false}
              isMe={nextPlayer.id === myPlayerId}
              maxCards={maxCards}
              roundNumber={roundNumber}
              lastAction={lastActionMap.get(nextPlayer.id) ?? null}
              reactions={reactionsMap.get(nextPlayer.id)}
              rankInfo={playerRatings?.get(nextPlayer.id)}
              onPlayerClick={onPlayerClick}
              turnDeadline={turnDeadline}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      {collapsible && (
        <button
          onClick={() => setCollapsed(true)}
          className="w-full flex items-center justify-between text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-1 px-1"
        >
          <span>Players</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className="rotate-180">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      )}
      <div className="grid grid-cols-2 gap-1">
        {players.map((p, i) => (
          <PlayerCard
            key={p.id}
            p={p}
            i={i}
            isCurrent={p.id === currentPlayerId}
            isMe={p.id === myPlayerId}
            maxCards={maxCards}
            roundNumber={roundNumber}
            lastAction={lastActionMap.get(p.id) ?? null}
            showRemoveBot={showRemoveBot}
            onRemoveBot={onRemoveBot}
            showKickPlayer={showKickPlayer}
            onKickPlayer={onKickPlayer}
            reactions={reactionsMap.get(p.id)}
            rankInfo={playerRatings?.get(p.id)}
            onPlayerClick={onPlayerClick}
            turnDeadline={p.id === currentPlayerId ? turnDeadline : undefined}
          />
        ))}
      </div>
    </div>
  );
});
