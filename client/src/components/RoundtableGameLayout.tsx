import { memo, useMemo } from 'react';
import { handToString } from '@bull-em/shared';
import type { Player, PlayerId, HandCall, TurnEntry, Card, SpectatorPlayerCards } from '@bull-em/shared';
import type { RoundPhase } from '@bull-em/shared';
import type { DisconnectDeadlines } from '../context/GameContext.js';
import { getSeatPosition } from '../utils/roundtablePositions.js';
import { playerColor } from '../utils/cardUtils.js';
import { PlayerAvatarContent } from './PlayerAvatar.js';
import { HandDisplay } from './HandDisplay.js';
import { HandSelector } from './HandSelector.js';
import { ActionButtons } from './ActionButtons.js';
import { TurnIndicator } from './TurnIndicator.js';
import { CallHistory } from './CallHistory.js';
import { SpectatorView } from './SpectatorView.js';
import { QuickDrawChips } from './QuickDrawChips.js';
import { QuickDrawHint } from './QuickDrawHint.js';
import { DisconnectBanner } from './DisconnectBanner.js';
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

  // Disconnect deadlines
  disconnectDeadlines?: DisconnectDeadlines;

  // Action handlers
  onBull: () => void;
  onTrue: () => void;
  onLastChancePass: () => void;
  onActionExpand: () => void;
  onOpenHandSelector: () => void;
  onHandSubmit: () => void;
  onHandChange: (hand: HandCall | null, valid: boolean) => void;
  onQuickRaise: () => void;
  onCardTap?: (card: Card) => void;
  onQuickDrawSelect: (suggestion: QuickDrawSuggestion) => void;
  onQuickDrawDismiss: () => void;
  onPlayerClick?: (player: Player) => void;
}

/** Player seat around the roundtable — shows avatar, name, card count, and turn highlight. */
const RoundtableSeat = memo(function RoundtableSeat({
  player,
  seatIndex,
  playerCount,
  isCurrent,
  isMe,
  maxCards,
}: {
  player: Player;
  seatIndex: number;
  playerCount: number;
  isCurrent: boolean;
  isMe: boolean;
  maxCards: number;
}) {
  const pos = getSeatPosition(playerCount, seatIndex);
  const colorClass = playerColor(seatIndex);
  const atMax = player.cardCount >= maxCards && !player.isEliminated;

  return (
    <div
      className={`rt-seat ${isCurrent ? 'rt-seat--active' : ''} ${player.isEliminated ? 'rt-seat--eliminated' : ''}`}
      style={{ top: pos.top, left: pos.left }}
    >
      {/* Avatar */}
      <div className={`rt-avatar ${colorClass} ${isMe ? 'rt-avatar--me' : ''}`}>
        <PlayerAvatarContent
          name={player.name}
          avatar={player.avatar}
          photoUrl={player.photoUrl}
          isBot={player.isBot}
        />
      </div>
      {/* Name + card count */}
      <div className={`rt-name ${isMe ? 'rt-name--me' : ''}`}>
        {isMe ? 'You' : player.name}
      </div>
      {!player.isEliminated && (
        <div className={`rt-card-count ${atMax ? 'rt-card-count--max' : ''}`}>
          {player.cardCount}{maxCards > 0 ? `/${maxCards}` : ''}
        </div>
      )}
      {player.isEliminated && (
        <div className="rt-eliminated-badge">OUT</div>
      )}
    </div>
  );
});

/**
 * Roundtable game layout — renders the full game UI as a poker-table view.
 * Used in landscape/desktop mode as an alternative to the vertical portrait layout.
 *
 * Layout:
 * - Oval table background with players positioned around it
 * - Center of table: current call + turn indicator
 * - Bottom strip: my cards, action buttons, hand selector
 * - Call history: compact panel on the left edge
 */
export const RoundtableGameLayout = memo(function RoundtableGameLayout(props: RoundtableGameLayoutProps) {
  const {
    players, currentPlayerId, myPlayerId, maxCards, roundNumber,
    roundPhase, currentHand, lastCallerId, myCards, turnHistory,
    turnDeadline, turnDurationMs, spectatorCards,
    isMyTurn, isEliminated, isSpectator, isLastChanceCaller, canRaise,
    handSelectorOpen, pendingValid, pendingHand,
    quickDrawOpen, quickDrawEnabled, quickDrawSuggestions,
    disconnectDeadlines,
    onBull, onTrue, onLastChancePass, onActionExpand,
    onOpenHandSelector, onHandSubmit, onHandChange, onQuickRaise,
    onCardTap, onQuickDrawSelect, onQuickDrawDismiss,
  } = props;

  // Reorder players so myPlayerId is seat 0 (bottom center)
  const orderedPlayers = useMemo(() => {
    const myIdx = players.findIndex(p => p.id === myPlayerId);
    if (myIdx <= 0) return players;
    return [...players.slice(myIdx), ...players.slice(0, myIdx)];
  }, [players, myPlayerId]);

  const activePlayers = orderedPlayers.filter(p => !p.isEliminated);
  const eliminatedPlayers = orderedPlayers.filter(p => p.isEliminated);
  // Show all players in their seats — eliminated ones get dimmed
  const allForSeating = [...activePlayers, ...eliminatedPlayers];
  // Use total player count for seat positions (keep stable layout)
  const playerCount = Math.min(orderedPlayers.length, 9);

  const cardCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of players) counts[p.id] = p.cardCount;
    return counts;
  }, [players]);

  const callerName = lastCallerId
    ? players.find(p => p.id === lastCallerId)?.name ?? '?'
    : null;

  return (
    <div className="rt-layout">
      {/* Table area with oval and player seats */}
      <div className="rt-table-area">
        {/* Oval table surface */}
        <div className="rt-table">
          {/* Center content: turn indicator + current call */}
          <div className="rt-table-center">
            <div className="rt-turn-indicator" data-tooltip="turn-indicator">
              <TurnIndicator
                currentPlayerId={currentPlayerId}
                roundPhase={roundPhase}
                players={players}
                myPlayerId={myPlayerId}
                turnDeadline={turnDeadline}
                hasCurrentHand={currentHand !== null}
              />
            </div>
            {currentHand && (
              <div className="rt-current-call animate-slide-up">
                <span className="rt-current-call-label">Current Call</span>
                <span className="rt-current-call-hand">
                  {handToString(currentHand)}
                </span>
                {callerName && (
                  <span className="rt-current-call-caller">by {callerName}</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Player seats — positioned absolutely around the table */}
        {orderedPlayers.slice(0, playerCount).map((player, i) => (
          <RoundtableSeat
            key={player.id}
            player={player}
            seatIndex={i}
            playerCount={playerCount}
            isCurrent={player.id === currentPlayerId}
            isMe={player.id === myPlayerId}
            maxCards={maxCards}
          />
        ))}
      </div>

      {/* Call history — compact panel on the left */}
      <div className="rt-call-history" data-tooltip="call-history">
        <CallHistory history={turnHistory} cardCounts={cardCounts} />
      </div>

      {/* Disconnect banners */}
      <DisconnectBanner
        players={players}
        disconnectDeadlines={disconnectDeadlines ?? new Map()}
      />

      {/* Bottom controls strip */}
      <div className="rt-controls">
        {/* My cards */}
        {!isEliminated && !isSpectator && (
          <div className="rt-my-cards" data-tooltip="my-cards">
            <HandDisplay cards={myCards} large onCardTap={canRaise && quickDrawEnabled ? onCardTap : undefined} />
          </div>
        )}

        {/* Quick Draw hint */}
        {!isEliminated && !isSpectator && quickDrawEnabled && !quickDrawOpen && (
          <QuickDrawHint visible={canRaise} />
        )}

        {/* Quick Draw chips */}
        {quickDrawOpen && canRaise && quickDrawSuggestions.length > 0 && (
          <QuickDrawChips
            suggestions={quickDrawSuggestions}
            onSelect={onQuickDrawSelect}
            onDismiss={onQuickDrawDismiss}
          />
        )}

        {/* Spectator view */}
        {(isEliminated || isSpectator) && spectatorCards && (
          <SpectatorView spectatorCards={spectatorCards} currentPlayerId={currentPlayerId} />
        )}

        {/* Action row */}
        {!isEliminated && !isSpectator && (
          <div className="rt-actions" data-tooltip="action-area">
            <ActionButtons
              roundPhase={roundPhase}
              isMyTurn={isMyTurn}
              hasCurrentHand={currentHand !== null}
              isLastChanceCaller={isLastChanceCaller}
              onBull={onBull}
              onTrue={onTrue}
              onLastChancePass={onLastChancePass}
              onExpand={onActionExpand}
            />
            {canRaise && !handSelectorOpen && (
              <div className="flex justify-end animate-slide-up ml-auto action-btn-gap">
                <button
                  onClick={onOpenHandSelector}
                  className="btn-ghost border-[var(--gold-dim)] action-btn-base font-bold animate-pulse-glow action-btn-primary kbd-shortcut"
                  data-kbd="C"
                >
                  {currentHand ? 'Raise' : 'Call'}
                </button>
              </div>
            )}
            {canRaise && handSelectorOpen && currentHand && (
              <button
                onClick={onQuickRaise}
                className="btn-amber action-btn-base font-bold action-btn-minraise"
                title="Auto-raise to the minimum valid hand"
              >
                min<br />raise
              </button>
            )}
            {canRaise && handSelectorOpen && (
              <div className="flex flex-col items-center ml-auto">
                <button
                  onClick={onHandSubmit}
                  disabled={!pendingValid}
                  className={`btn-gold action-btn-base font-bold action-btn-primary ${pendingValid ? 'hs-call-pulse' : ''}`}
                >
                  {currentHand ? 'Raise' : 'Call'}
                </button>
                <p className={`text-[var(--danger)] mt-1 h-4 transition-opacity action-btn-hint ${pendingHand && !pendingValid ? 'opacity-100' : 'opacity-0'}`}>Must be higher</p>
              </div>
            )}
          </div>
        )}

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
