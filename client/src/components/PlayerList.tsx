import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, memo } from 'react';
import { TurnAction, handToString } from '@bull-em/shared';
import type { Player, PlayerId, TurnEntry, EmojiReaction, RankTier } from '@bull-em/shared';
import { playerColor } from '../utils/cardUtils.js';
import { PlayerAvatarContent } from './PlayerAvatar.js';
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
  /** Full intended turn duration in ms — keeps TileMeter countdown speed consistent */
  turnDurationMs?: number | null;
}

/* Full-border timer meter that wraps around the entire player tile.
   Uses an SVG rect with stroke-dasharray to show remaining turn time
   as a shrinking border highlight running clockwise from top-left.
   Updated at 10fps via direct DOM manipulation to avoid React re-renders.
   The SVG viewBox is set dynamically via ResizeObserver so the rect
   always matches the tile size. */
const RECT_RX = 7;

/** Compute the perimeter of a rounded rect mathematically.
 *  More reliable than SVGRectElement.getTotalLength() which can return 0
 *  when the SVG engine hasn't computed geometry yet (e.g. during
 *  useLayoutEffect before first paint in some browsers). */
function roundedRectPerimeter(w: number, h: number, r: number): number {
  const cr = Math.min(r, w / 2, h / 2);
  // 4 straight edges (each shortened by cr at both ends) + 4 quarter-circle arcs
  return 2 * (w - 2 * cr) + 2 * (h - 2 * cr) + 2 * Math.PI * cr;
}

const TileMeter = memo(function TileMeter({ turnDeadline, turnDurationMs }: { turnDeadline: number; turnDurationMs?: number | null }) {
  const rectRef = useRef<SVGRectElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const perimRef = useRef<number>(0);

  /** Measure the SVG element itself and sync viewBox + rect dimensions.
   *  We measure the SVG (not the parent) so the viewBox matches the actual
   *  viewport — the SVG fills the parent's padding box via position:absolute
   *  + inset:0, and getBoundingClientRect on the SVG returns that exact size. */
  const syncSize = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const { width, height } = svg.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const rect = rectRef.current;
    if (rect) {
      const rw = width - 2;
      const rh = height - 2;
      rect.setAttribute('x', '1');
      rect.setAttribute('y', '1');
      rect.setAttribute('width', String(rw));
      rect.setAttribute('height', String(rh));
      perimRef.current = roundedRectPerimeter(rw, rh, RECT_RX);
    }
  }, []);

  // Resize the SVG viewBox to match the tile dimensions.
  // useLayoutEffect ensures dimensions are set before paint so the
  // border is visible on the very first frame.  We observe the parent
  // (the tile div) because the SVG itself won't fire ResizeObserver
  // entries — its size is derived from the parent via CSS.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const parent = svg.parentElement;
    if (!parent) return;

    syncSize();

    // If dimensions aren't available yet (rare — e.g. mid-transition mount),
    // retry on the next animation frame when layout is guaranteed complete.
    if (!perimRef.current) {
      const raf = requestAnimationFrame(syncSize);
      const ro = new ResizeObserver(syncSize);
      ro.observe(parent);
      return () => { cancelAnimationFrame(raf); ro.disconnect(); };
    }

    const ro = new ResizeObserver(syncSize);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [syncSize]);

  useEffect(() => {
    // Use turnDurationMs (the room's turn timer) so the countdown pace is
    // consistent across all turns. Fall back to remaining-to-deadline if
    // turnDurationMs is not available.
    const total = turnDurationMs != null && turnDurationMs > 0
      ? turnDurationMs
      : Math.max(0, turnDeadline - Date.now());

    // Ensure perim is computed (handles mount before layout is ready)
    if (!perimRef.current) syncSize();

    // Reset meter to full immediately
    if (rectRef.current) {
      const perim = perimRef.current;
      if (perim > 0) {
        rectRef.current.style.strokeDasharray = `${perim} ${perim}`;
        rectRef.current.style.strokeDashoffset = '0';
        rectRef.current.style.stroke = 'var(--gold-dim)';
      }
    }

    if (total <= 0) return;

    // Track elapsed time from mount so the animation always starts at 100%
    // and counts down at a consistent pace (1/total per ms), regardless of
    // when the component mounts relative to the deadline.
    const mountTime = Date.now();

    const update = () => {
      // Lazy-init perim if it wasn't available at mount time
      let perim = perimRef.current;
      if (!perim) {
        syncSize();
        perim = perimRef.current;
      }
      if (!perim || !rectRef.current) return;
      const elapsed = Date.now() - mountTime;
      const pct = Math.max(0, 1 - elapsed / total);
      // Diminish clockwise: gap grows from top-left by offsetting the dash start
      const visibleLength = perim * pct;
      const gapLength = perim - visibleLength;
      rectRef.current.style.strokeDasharray = `${visibleLength} ${perim}`;
      rectRef.current.style.strokeDashoffset = String(-gapLength);
      rectRef.current.style.stroke = pct <= 0.3 ? 'var(--danger)' : 'var(--gold-dim)';
    };

    update();
    const interval = setInterval(update, 100);
    return () => clearInterval(interval);
  }, [turnDeadline, turnDurationMs, syncSize]);

  return (
    <svg
      ref={svgRef}
      className="tile-timer-border"
      aria-hidden="true"
    >
      <rect
        ref={rectRef}
        rx={RECT_RX}
        ry={RECT_RX}
        fill="none"
        strokeWidth="2.5"
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

/**
 * Reorder items so that when placed in a 2-column CSS grid (left-right,
 * top-to-bottom flow), reading the grid clockwise yields the original order:
 *   top-left → right across top → down right column →
 *   left across bottom → up left column.
 *
 * Returns an array of { item, originalIndex } to preserve identity/color mapping.
 */
function clockwiseGridOrder<T>(items: T[]): { item: T; originalIndex: number }[] {
  const n = items.length;
  if (n <= 2) return items.map((item, i) => ({ item, originalIndex: i }));

  const cols = 2;
  const rows = Math.ceil(n / cols);

  // Build clockwise sequence of (row, col) grid positions
  const positions: [number, number][] = [];
  // Top row, left to right
  for (let c = 0; c < cols; c++) positions.push([0, c]);
  // Right column, top to bottom (skip first row)
  for (let r = 1; r < rows; r++) positions.push([r, cols - 1]);
  // Bottom row, right to left (skip last column)
  for (let c = cols - 2; c >= 0; c--) positions.push([rows - 1, c]);
  // Left column, bottom to top (skip first and last rows)
  for (let r = rows - 2; r >= 1; r--) positions.push([r, 0]);

  // Deduplicate and filter positions that exist (odd count → last row has 1 cell)
  const seen = new Set<number>();
  const clockwiseSlots: number[] = [];
  for (const [r, c] of positions) {
    const flat = r * cols + c;
    if (flat < n && !seen.has(flat)) {
      seen.add(flat);
      clockwiseSlots.push(flat);
    }
  }

  // Place player i at grid slot clockwiseSlots[i]
  const result = new Array<{ item: T; originalIndex: number }>(n);
  for (let i = 0; i < n; i++) {
    result[clockwiseSlots[i]!] = { item: items[i]!, originalIndex: i };
  }
  return result;
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
const PlayerCard = memo(function PlayerCard({ p, i, isCurrent, isMe, maxCards, roundNumber, lastAction, showRemoveBot, onRemoveBot, showKickPlayer, onKickPlayer, reactions, rankInfo, onPlayerClick, turnDeadline, turnDurationMs }: {
  p: Player; i: number; isCurrent: boolean; isMe: boolean; maxCards: number;
  roundNumber?: number; lastAction: string | null;
  showRemoveBot?: boolean; onRemoveBot?: (botId: string) => void;
  showKickPlayer?: boolean; onKickPlayer?: (playerId: string) => void;
  reactions?: EmojiReaction[];
  rankInfo?: { rating: number; tier: RankTier };
  onPlayerClick?: (player: Player) => void;
  turnDeadline?: number | null;
  turnDurationMs?: number | null;
}) {
  // Show timer meter on the current player's tile when it's not me.
  // The user's own turn timer is shown in the TurnIndicator banner;
  // TileMeter is for watching OTHER players' countdowns.
  // Allow 3s grace period so the meter still shows when the deadline
  // arrives slightly before the next turn starts or the state was
  // deferred behind a round-result overlay.
  const showMeter = isCurrent && !isMe && !p.isEliminated && turnDeadline != null && turnDeadline > Date.now() - 3000;

  return (
    <div
      className={`relative flex items-center justify-between px-2 py-1 rounded-lg text-sm transition-[color,background-color,border-color,opacity] duration-500 ${
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
          aria-label={onPlayerClick ? `View ${p.name}'s profile` : undefined}
          className={`avatar avatar-sm ${playerColor(i, p.avatarBgColor)} ${p.isEliminated ? 'opacity-50' : ''} ${isCurrent && !p.isEliminated ? 'avatar-active-turn' : ''} ${onPlayerClick ? 'cursor-pointer' : ''} overflow-hidden`}
        >
          <PlayerAvatarContent name={p.name} avatar={p.avatar} photoUrl={p.photoUrl} isBot={p.isBot} />
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
            aria-label={`Remove bot ${p.name}`}
          >
            <span aria-hidden="true">✕</span>
          </button>
        )}
        {showKickPlayer && !p.isBot && !p.isHost && onKickPlayer && (
          <button
            onClick={(e) => { e.stopPropagation(); onKickPlayer(p.id); }}
            className="text-[var(--danger)] hover:text-red-400 transition-colors text-xs ml-1"
            title="Kick player"
            aria-label={`Kick player ${p.name}`}
          >
            <span aria-hidden="true">✕</span>
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
      {/* Subtle opponent turn timer meter — key forces fresh mount on every turn */}
      {showMeter && <TileMeter key={turnDeadline} turnDeadline={turnDeadline!} turnDurationMs={turnDurationMs} />}
    </div>
  );
});

// Memoized: during gameplay the parent (GamePage/LocalGamePage) re-renders on
// every game state broadcast (timer ticks, other players' actions), but the
// PlayerList props are often the same. Without memo, buildLastActionMap and
// the collapsed-view player lookup run on every parent render.
export const PlayerList = memo(function PlayerList({ players, currentPlayerId, myPlayerId, maxCards = 5, showRemoveBot, onRemoveBot, showKickPlayer, onKickPlayer, roundNumber, turnHistory, collapsible, reactions, playerRatings, onPlayerClick, turnDeadline, turnDurationMs }: Props) {
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
          aria-expanded={false}
          aria-label={`Expand player list (${activeCount} of ${players.length} active)`}
        >
          <span>Players ({activeCount}/{players.length})</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        <div className="grid grid-cols-2 gap-1">
          {currentPlayer && (
            <PlayerCard
              key={currentPlayer.id}
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
              turnDurationMs={turnDurationMs}
            />
          )}
          {nextPlayer && nextPlayer.id !== currentPlayerId && (
            <PlayerCard
              key={nextPlayer.id}
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
              turnDurationMs={turnDurationMs}
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
          aria-expanded={true}
          aria-label="Collapse player list"
        >
          <span>Players</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className="rotate-180"
            aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      )}
      <div className="grid grid-cols-2 gap-1">
        {clockwiseGridOrder(players).map(({ item: p, originalIndex }) => (
          <PlayerCard
            key={p.id}
            p={p}
            i={originalIndex}
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
            turnDurationMs={p.id === currentPlayerId ? turnDurationMs : undefined}
          />
        ))}
      </div>
    </div>
  );
});
