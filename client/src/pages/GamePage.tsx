import { useNavigate, useParams } from 'react-router-dom';
import { RoundPhase, getDeckSize } from '@bull-em/shared';
import { Layout } from '../components/Layout.js';
import { PlayerList } from '../components/PlayerList.js';
import { HandDisplay } from '../components/HandDisplay.js';
import { HandSelector } from '../components/HandSelector.js';
import { ActionButtons } from '../components/ActionButtons.js';
import { TurnIndicator } from '../components/TurnIndicator.js';
import { CallHistory } from '../components/CallHistory.js';
import { RevealOverlay } from '../components/RevealOverlay.js';
import { SpectatorView } from '../components/SpectatorView.js';
import { ShareButton } from '../components/ShareButton.js';
import { ReconnectOverlay } from '../components/ReconnectOverlay.js';
import { SessionTransferredOverlay } from '../components/SessionTransferredOverlay.js';
import { DisconnectBanner } from '../components/DisconnectBanner.js';
import { EmojiReactionBar } from '../components/EmojiReactionBar.js';
import { ChatPanel } from '../components/ChatPanel.js';
import { GameTooltips } from '../components/GameTooltips.js';

import { BotProfileModal } from '../components/BotProfileModal.js';
import { InGameStats } from '../components/InGameStats.js';

import { useGameContext } from '../context/GameContext.js';
import { useAuth } from '../context/AuthContext.js';
import { useErrorToast } from '../hooks/useErrorToast.js';
import { useSound, useGameSounds } from '../hooks/useSound.js';
import { handToString } from '@bull-em/shared';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { HandCall, Card, Player } from '@bull-em/shared';
import { getMinimumRaise } from '@bull-em/shared';
import { getQuickDrawSuggestions, type QuickDrawSuggestion } from '@bull-em/shared';
import { QuickDrawChips } from '../components/QuickDrawChips.js';
import { QuickDrawHint } from '../components/QuickDrawHint.js';
import { useToast } from '../context/ToastContext.js';
import { useNavigationGuard } from '../hooks/useNavigationGuard.js';
import { useGameKeyboardShortcuts } from '../hooks/useGameKeyboardShortcuts.js';
import { useInGameStats } from '../hooks/useInGameStats.js';
import { useUISettings } from '../components/VolumeControl.js';

function SeriesBanner({ seriesInfo, players, playerId }: {
  seriesInfo: NonNullable<import('@bull-em/shared').SeriesInfo>;
  players: { id: string; name: string }[];
  playerId: string | null;
}) {
  const playerIds = Object.keys(seriesInfo.wins);
  const getLabel = (pid: string) => {
    if (pid === playerId) return 'You';
    return players.find(p => p.id === pid)?.name ?? '?';
  };

  return (
    <div
      className="glass flex items-center justify-center gap-3 py-1 px-3 text-xs"
      style={{ borderBottom: '1px solid rgba(212,168,67,0.15)' }}
    >
      <span className="text-[var(--gold-dim)] uppercase tracking-widest font-semibold text-[10px]">
        Bo{seriesInfo.bestOf}
      </span>
      <span className="text-[var(--gold-dim)]">|</span>
      <span className="text-[var(--gold-dim)]">Set {seriesInfo.currentSet}</span>
      <span className="text-[var(--gold-dim)]">|</span>
      {playerIds.map((pid, i) => (
        <span key={pid} className="text-[var(--gold)]">
          {i > 0 && <span className="text-[var(--gold-dim)] mx-1">-</span>}
          <span className={pid === playerId ? 'font-bold' : ''}>{getLabel(pid)}</span>
          {' '}
          <span className="font-mono font-bold">{seriesInfo.wins[pid] ?? 0}</span>
        </span>
      ))}
    </div>
  );
}

function TransitionOverlay({ deadline }: { deadline: number | null }) {
  const [remaining, setRemaining] = useState(() =>
    deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : 0,
  );

  useEffect(() => {
    if (!deadline) return;
    const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [deadline]);

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50"
         style={{ background: 'var(--overlay)' }}>
      <div className="text-center space-y-3 animate-fade-in">
        <div className="w-8 h-8 border-2 border-[var(--gold)] border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-[var(--gold)] font-display text-lg font-semibold">
          Next round starting&hellip;
        </p>
        {deadline && remaining > 0 && (
          <p className="text-[var(--gold-dim)] text-sm">
            {remaining}s
          </p>
        )}
      </div>
    </div>
  );
}

export function GamePage() {
  const { roomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const {
    gameState, roomState, roundResult, roundTransition, roundTransitionDeadline, winnerId, playerId,
    callHand, callBull, callTrue, lastChanceRaise, lastChancePass,
    clearRoundResult, leaveRoom, joinRoom, error, clearError,
    isConnected, hasConnected, disconnectDeadlines,
    reactions, sendReaction,
    chatMessages, sendChatMessage,
    spectatorInitialStats,
    sessionTransferred,
  } = useGameContext();
  const { user } = useAuth();
  const spectatorCount = roomState?.spectatorCount ?? 0;
  useErrorToast(error, clearError);
  const { play } = useSound();
  // Derived state — safe to compute with null gameState (computed early for useGameSounds)
  const myPlayer = gameState?.players.find(p => p.id === playerId) ?? null;
  const isEliminated = myPlayer?.isEliminated ?? false;
  const isSpectator = gameState ? !myPlayer : false;

  useGameSounds(gameState, roundResult, winnerId, playerId, isSpectator || isEliminated);
  const { chatEnabled, emojiEnabled, quickDrawEnabled } = useUISettings();
  const { addToast } = useToast();
  const inGameStats = useInGameStats(gameState, roundResult, spectatorInitialStats);

  const rejoinAttemptedRef = useRef(false);
  const wasEliminatedRef = useRef(false);
  const lastResultRef = useRef(roundResult);

  // All useState hooks — must be called unconditionally (before any early return)
  const [handSelectorOpen, setHandSelectorOpen] = useState(false);
  const [pendingHand, setPendingHand] = useState<HandCall | null>(null);
  const [pendingValid, setPendingValid] = useState(false);
  const [quickDrawOpen, setQuickDrawOpen] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const isMyTurn = gameState ? gameState.currentPlayerId === playerId && !isEliminated && !isSpectator : false;
  const isAtMaxCards = !isEliminated && !isSpectator && myPlayer && gameState
    ? myPlayer.cardCount >= gameState.maxCards
    : false;
  const isLastChanceCaller = gameState
    ? gameState.roundPhase === RoundPhase.LAST_CHANCE && gameState.lastCallerId === playerId
    : false;
  const canCallHand = isMyTurn && gameState && (
    gameState.roundPhase === RoundPhase.CALLING
    || gameState.roundPhase === RoundPhase.BULL_PHASE
  );
  const canRaise = canCallHand || isLastChanceCaller;

  // Prevent accidental tab close / refresh during an active game
  useNavigationGuard(!!gameState && !winnerId);

  // Unstick "next round starting" overlay after app switch
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (roundTransition && roundTransitionDeadline && Date.now() > roundTransitionDeadline) {
        clearRoundResult();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [roundTransition, roundTransitionDeadline, clearRoundResult]);

  // Defer navigation to results if a round result overlay is still showing
  useEffect(() => {
    if (winnerId && !roundResult) navigate(`/results/${roomCode}`);
  }, [winnerId, roundResult, roomCode, navigate]);

  useEffect(() => {
    if (gameState || !roomCode || rejoinAttemptedRef.current) return;

    // If we already have a playerId set (e.g., from matchmaking auto-join),
    // we're already in the room on the server side. Don't attempt a rejoin
    // that will fail with "Room is full" or "Game already in progress" —
    // just wait for the server to send game:state when the game starts.
    if (playerId) {
      rejoinAttemptedRef.current = true;
      // Safety timeout: if game state never arrives, redirect home
      const timeout = setTimeout(() => navigate('/'), 15000);
      return () => clearTimeout(timeout);
    }

    const storedName = sessionStorage.getItem('bull-em-player-name') || localStorage.getItem('bull-em-player-name');
    if (!storedName) {
      navigate('/');
      return;
    }
    rejoinAttemptedRef.current = true;

    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        navigate('/');
      }
    }, 8000);

    joinRoom(roomCode, storedName, user?.avatar)
      .then(() => { settled = true; clearTimeout(timeout); })
      .catch(() => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          navigate('/');
        }
      });
  }, [gameState, roomCode, joinRoom, navigate, playerId]);

  useEffect(() => {
    if (!gameState && roomState?.gamePhase === 'lobby' && roomCode) {
      navigate(`/room/${roomCode}`);
    }
  }, [gameState, roomState?.gamePhase, roomCode, navigate]);

  // Show a one-time prominent notification when the player gets eliminated
  useEffect(() => {
    if (isEliminated && !wasEliminatedRef.current && !winnerId) {
      addToast("You've been eliminated! You're now spectating.", 'info');
    }
    wasEliminatedRef.current = isEliminated;
  }, [isEliminated, winnerId, addToast]);

  // Show a toast for every player eliminated this round
  useEffect(() => {
    if (roundResult && roundResult !== lastResultRef.current && gameState) {
      for (const eliminatedId of roundResult.eliminatedPlayerIds) {
        if (eliminatedId === playerId) continue;
        const name = gameState.players.find(p => p.id === eliminatedId)?.name ?? 'A player';
        addToast(`${name} has been eliminated!`, 'info');
      }
    }
    lastResultRef.current = roundResult;
  }, [roundResult, playerId, gameState, addToast]);

  const deckSize = getDeckSize(roomState?.settings?.jokerCount ?? 0);
  const cardStats = useMemo(() => {
    if (!gameState) return { total: 0, pct: 0 };
    const total = gameState.players.filter(p => !p.isEliminated).reduce((sum, p) => sum + p.cardCount, 0);
    return { total, pct: Math.round((total / deckSize) * 100) };
  }, [gameState, deckSize]);

  const cardCounts = useMemo(() => {
    if (!gameState) return {};
    const counts: Record<string, number> = {};
    for (const p of gameState.players) counts[p.id] = p.cardCount;
    return counts;
  }, [gameState]);

  const handlePlayerClick = useCallback((player: Player) => {
    // All players (human, bot, guest) → show in-game overlay with stats
    setSelectedPlayer(player);
  }, []);

  const quickDrawSuggestions = useMemo(() => {
    if (!quickDrawOpen || !canRaise || !gameState) return [];
    return getQuickDrawSuggestions(gameState.myCards, gameState.currentHand);
  }, [quickDrawOpen, canRaise, gameState]);

  // Tapping own cards: toggle Quick Draw chips
  const handleCardTap = useCallback((_card: Card) => {
    if (!quickDrawEnabled || !canRaise || !gameState) return;
    play('uiClick');
    const suggestions = getQuickDrawSuggestions(gameState.myCards, gameState.currentHand);
    if (suggestions.length === 0) {
      setHandSelectorOpen(true);
    } else {
      setQuickDrawOpen(prev => !prev);
    }
  }, [quickDrawEnabled, canRaise, play, gameState]);

  const handleQuickDrawSelect = useCallback((suggestion: QuickDrawSuggestion) => {
    // Sound is played by useGameSounds when the turn history updates
    if (isLastChanceCaller) {
      lastChanceRaise(suggestion.hand);
    } else {
      callHand(suggestion.hand);
    }
    setHandSelectorOpen(false);
    setQuickDrawOpen(false);
  }, [isLastChanceCaller, lastChanceRaise, callHand]);

  const handleHandChange = useCallback((hand: HandCall | null, valid: boolean) => {
    setPendingHand(hand);
    setPendingValid(valid);
  }, []);

  const handleHandSubmit = useCallback(() => {
    if (!pendingHand || !pendingValid) return;
    if (isLastChanceCaller) {
      lastChanceRaise(pendingHand);
    } else {
      callHand(pendingHand);
    }
    setHandSelectorOpen(false);
  }, [pendingHand, pendingValid, isLastChanceCaller, lastChanceRaise, callHand]);

  // Quick raise — immediately submit the minimum valid raise
  const handleQuickRaise = useCallback(() => {
    if (!gameState) return;
    const current = gameState.currentHand;
    if (!current) return;
    const minRaise = getMinimumRaise(current);
    if (!minRaise) return;
    if (isLastChanceCaller) {
      lastChanceRaise(minRaise);
    } else {
      callHand(minRaise);
    }
    setHandSelectorOpen(false);
  }, [gameState, isLastChanceCaller, lastChanceRaise, callHand]);

  // Stable callback references so ActionButtons' React.memo isn't broken
  const closeHandSelector = useCallback(() => setHandSelectorOpen(false), []);
  const handleActionExpand = useCallback(() => { setHandSelectorOpen(false); setQuickDrawOpen(false); }, []);

  // Close hand selector on tap outside
  useEffect(() => {
    if (!handSelectorOpen) return;
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-tooltip="hand-selector"]') || target.closest('[data-tooltip="action-area"]') || target.closest('[data-tooltip="my-cards"]') || target.closest('[data-tooltip="call-history"]') || target.closest('[data-tooltip="quick-draw"]')) return;
      setHandSelectorOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [handSelectorOpen]);

  // Close quick draw chips on tap outside
  useEffect(() => {
    if (!quickDrawOpen) return;
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-tooltip="quick-draw"]') || target.closest('[data-tooltip="my-cards"]') || target.closest('[data-tooltip="action-area"]')) return;
      setQuickDrawOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [quickDrawOpen]);

  // Close hand selector and quick draw when turn changes
  const roundPhase = gameState?.roundPhase;
  useEffect(() => {
    setHandSelectorOpen(false);
    setQuickDrawOpen(false);
  }, [isMyTurn, roundPhase]);

  // Keyboard shortcuts (B=bull, T=true, C=raise/call, Esc=close, Enter=submit, P=pass)
  const showBull = isMyTurn && gameState?.currentHand !== null
    && (gameState?.roundPhase === RoundPhase.CALLING || gameState?.roundPhase === RoundPhase.BULL_PHASE);
  const showTrue = isMyTurn && gameState?.roundPhase === RoundPhase.BULL_PHASE;
  const showPass = isMyTurn && isLastChanceCaller;
  const overlayActive = !!roundResult || !!roundTransition;

  useGameKeyboardShortcuts({
    onBull: showBull ? () => { callBull(); } : null,
    onTrue: showTrue ? () => { play('uiClick'); callTrue(); } : null,
    onRaise: canRaise && !handSelectorOpen ? () => { play('uiClick'); setHandSelectorOpen(true); } : null,
    onSubmitHand: canRaise && handSelectorOpen && pendingValid ? handleHandSubmit : null,
    onPass: showPass ? () => { play('uiClick'); lastChancePass(); } : null,
    onEscape: roundResult
      ? clearRoundResult
      : handSelectorOpen
        ? closeHandSelector
        : null,
    overlayActive,
  });

  const handleLeave = () => {
    if (window.confirm('Leave this game? You will lose your spot.')) {
      leaveRoom();
      navigate('/');
    }
  };

  // ── Early return: loading state (all hooks called above) ──────────────
  if (!gameState) {
    return (
      <Layout>
        <div className="flex items-center justify-center pt-16">
          <div className="text-center space-y-3">
            <div className="w-8 h-8 border-2 border-[var(--gold)] border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-[var(--gold-dim)]">Loading game&hellip;</p>
          </div>
        </div>
      </Layout>
    );
  }

  const seriesInfo = gameState.seriesInfo;

  /* Landscape/desktop: merge game info into the Layout header bar */
  const headerLeftExtra = (
    <>
      <span className="text-[var(--gold-dim)] font-semibold uppercase tracking-wider text-xs">
        Round {gameState.roundNumber}
      </span>
      {seriesInfo && seriesInfo.bestOf > 1 && (
        <span className="text-[var(--gold-dim)] font-mono text-xs">
          Bo{seriesInfo.bestOf} Set {seriesInfo.currentSet}
        </span>
      )}
      <span className="text-[var(--gold-dim)] font-mono text-xs" title={`${cardStats.total} of ${deckSize} cards in play`}>
        {cardStats.total}/{deckSize} ({cardStats.pct}%)
      </span>
    </>
  );

  const headerRightExtra = (
    <>
      <span
        className="font-mono tracking-wider text-[var(--gold-dim)] text-xs mr-1 cursor-pointer active:scale-95 transition-transform"
        onClick={() => { if (roomCode) { navigator.clipboard.writeText(roomCode); addToast('Room code copied!', 'info'); } }}
        title="Tap to copy"
      >{roomCode}</span>
      {spectatorCount > 0 && (
        <span className="text-[var(--gold-dim)] text-xs" title={`${spectatorCount} spectator${spectatorCount !== 1 ? 's' : ''} watching`}>
          &#128065; {spectatorCount}
        </span>
      )}
      {roomCode && <ShareButton roomCode={roomCode} variant="compact" />}
      <button
        onClick={handleLeave}
        className="text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors text-xs min-h-[44px] min-w-[44px] flex items-center justify-center"
        title="Leave game"
      >
        Leave
      </button>
      <span className="font-mono tracking-wider text-[var(--gold-dim)] text-xs">ONLINE</span>
    </>
  );

  return (
    <Layout headerLeftExtra={headerLeftExtra} headerRightExtra={headerRightExtra}>
      <div className={`game-layout ${(isEliminated || isSpectator) && !winnerId ? 'spectating' : ''}`}>
        {/* Top bar — portrait only (merged into header in landscape) */}
        <div className="game-top-bar portrait-only flex justify-between items-center text-xs">
          <div className="flex items-center gap-3">
            <span className="text-[var(--gold-dim)] font-semibold uppercase tracking-wider">
              Round {gameState.roundNumber}
            </span>
            <span className="text-[var(--gold-dim)] font-mono" title={`${cardStats.total} of 52 cards in play`}>
              {cardStats.total}/52 ({cardStats.pct}%)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="font-mono tracking-wider text-[var(--gold-dim)] cursor-pointer active:scale-95 transition-transform"
              onClick={() => { if (roomCode) { navigator.clipboard.writeText(roomCode); addToast('Room code copied!', 'info'); } }}
              title="Tap to copy"
            >{roomCode}</span>
            {spectatorCount > 0 && (
              <span className="text-[var(--gold-dim)]" title={`${spectatorCount} spectator${spectatorCount !== 1 ? 's' : ''} watching`}>
                &#128065; {spectatorCount}
              </span>
            )}
            {roomCode && <ShareButton roomCode={roomCode} variant="compact" />}
            <button
              onClick={handleLeave}
              className="text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors text-xs min-h-[44px] min-w-[44px] flex items-center justify-center"
              title="Leave game"
            >
              Leave
            </button>
            <span className="font-mono tracking-wider text-[var(--gold-dim)]">ONLINE</span>
          </div>
        </div>

        {/* Series banner — shows best-of info, set number, and series score */}
        {seriesInfo && seriesInfo.bestOf > 1 && (
          <SeriesBanner seriesInfo={seriesInfo} players={gameState.players} playerId={playerId} />
        )}

        {/* Floating spectator pill — unobtrusive indicator at top of screen.
            Hidden when winnerId is set because the match is over (no active game to spectate). */}
        {(isEliminated || isSpectator) && !winnerId && (
          <div className="spectator-pill animate-fade-in">
            {isEliminated ? 'Eliminated — Spectating' : 'Spectating'}
          </div>
        )}

        <div className="game-content">
          {/* Sidebar — player list + call history (side column in landscape) */}
          <div className="game-sidebar">
            <div data-tooltip="players">
              <PlayerList
                players={gameState.players}
                currentPlayerId={gameState.currentPlayerId}
                myPlayerId={playerId}
                maxCards={gameState.maxCards}
                roundNumber={gameState.roundNumber}
                turnHistory={gameState.turnHistory}
                collapsible
                reactions={reactions}
                onPlayerClick={handlePlayerClick}
                turnDeadline={gameState.turnDeadline}
              />
            </div>
            {/* Call history in sidebar — landscape only */}
            <div className="landscape-only flex-col" data-tooltip="call-history">
              <CallHistory history={gameState.turnHistory} cardCounts={cardCounts} />
            </div>
          </div>

          {/* Main area — cards, actions, hand selector */}
          <div className="game-main">
            <div data-tooltip="turn-indicator">
              <TurnIndicator
                currentPlayerId={gameState.currentPlayerId}
                roundPhase={gameState.roundPhase}
                players={gameState.players}
                myPlayerId={playerId}
                turnDeadline={gameState.turnDeadline}
                hasCurrentHand={gameState.currentHand !== null}
              />
            </div>

            {/* Disconnect countdown banners for other players */}
            <DisconnectBanner
              players={gameState.players}
              disconnectDeadlines={disconnectDeadlines}
            />

            {/* Current call display */}
            {gameState.currentHand && (
              <div className="glass-raised py-1.5 animate-slide-up flex items-baseline" style={{ padding: '0.375rem clamp(0.5rem, 2.9vw, 0.75rem)' }}>
                <div className="w-1/4 min-w-0 shrink-0">
                  <span className="text-[9px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold">
                    Current Call
                  </span>
                </div>
                <div className="flex-1 min-w-0 text-center">
                  <span className="font-display font-bold text-[var(--gold)] current-call-hand">
                    {handToString(gameState.currentHand)}
                  </span>
                </div>
                <div className="w-1/4 min-w-0 shrink-0 text-right">
                  {gameState.lastCallerId && (
                    <span className="text-[9px] text-[var(--gold-dim)] opacity-70 truncate block">
                      {gameState.players.find(p => p.id === gameState.lastCallerId)?.name ?? '?'}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* My cards */}
            {!isEliminated && !isSpectator && <div data-tooltip="my-cards"><HandDisplay cards={gameState.myCards} large onCardTap={canRaise && quickDrawEnabled ? handleCardTap : undefined} /></div>}

            {/* Quick Draw first-use hint */}
            {!isEliminated && !isSpectator && quickDrawEnabled && !quickDrawOpen && (
              <QuickDrawHint visible={canRaise} />
            )}

            {/* Quick Draw suggestion chips */}
            {quickDrawOpen && canRaise && quickDrawSuggestions.length > 0 && (
              <QuickDrawChips
                suggestions={quickDrawSuggestions}
                onSelect={handleQuickDrawSelect}
                onDismiss={() => setQuickDrawOpen(false)}
              />
            )}

            {/* Spectator view — eliminated players and external spectators see all cards */}
            {(isEliminated || isSpectator) && gameState.spectatorCards && (
              <SpectatorView spectatorCards={gameState.spectatorCards} currentPlayerId={gameState.currentPlayerId} />
            )}

            {/* Call history — portrait only (in sidebar for landscape) */}
            <div className="portrait-only" data-tooltip="call-history">
              <CallHistory history={gameState.turnHistory} cardCounts={cardCounts} />
            </div>

            {/* Action row — BULL/TRUE on left, Raise/Call on right */}
            {/* Placed BEFORE the hand selector so buttons never move when picker opens */}
            {!isEliminated && !isSpectator && (
              <div className="flex justify-between items-start relative" data-tooltip="action-area">
                <ActionButtons
                  roundPhase={gameState.roundPhase}
                  isMyTurn={isMyTurn}
                  hasCurrentHand={gameState.currentHand !== null}
                  isLastChanceCaller={isLastChanceCaller}
                  onBull={callBull}
                  onTrue={callTrue}
                  onLastChancePass={lastChancePass}
                  onExpand={handleActionExpand}
                />
                {canRaise && !handSelectorOpen && (
                  <div className="flex justify-end animate-slide-up ml-auto action-btn-gap">
                    <button
                      onClick={() => { play('uiClick'); setHandSelectorOpen(true); }}
                      className="btn-ghost border-[var(--gold-dim)] action-btn-base font-bold animate-pulse-glow action-btn-primary kbd-shortcut"
                      data-kbd="C"
                    >
                      {gameState.currentHand ? 'Raise' : 'Call'}
                    </button>
                  </div>
                )}
                {canRaise && handSelectorOpen && gameState.currentHand && getMinimumRaise(gameState.currentHand) && (
                  <button
                    onClick={handleQuickRaise}
                    className="btn-amber action-btn-base font-bold action-btn-minraise absolute left-1/2 -translate-x-1/2 top-0 z-10"
                    title="Auto-raise to the minimum valid hand"
                  >
                    min<br />raise
                  </button>
                )}
                {canRaise && handSelectorOpen && (
                  <div className="flex flex-col items-center ml-auto">
                    <button
                      onClick={handleHandSubmit}
                      disabled={!pendingValid}
                      className={`btn-gold action-btn-base font-bold action-btn-primary ${pendingValid ? 'hs-call-pulse' : ''}`}
                    >
                      {gameState.currentHand ? 'Raise' : 'Call'}
                    </button>
                    <p className={`text-[var(--danger)] mt-1 h-4 transition-opacity action-btn-hint ${pendingHand && !pendingValid ? 'opacity-100' : 'opacity-0'}`}>Must be higher</p>
                  </div>
                )}
              </div>
            )}

            {/* Hand selector — appears below the action buttons so buttons stay put */}
            {canRaise && handSelectorOpen && (
              <div className="-mt-2" data-tooltip="hand-selector">
                <HandSelector
                  currentHand={gameState.currentHand}
                  onSubmit={handleHandSubmit}
                  onHandChange={handleHandChange}
                  showSubmit={false}
                />
              </div>
            )}
          </div>
        </div>

        {/* First-game contextual tooltips */}
        <GameTooltips gameActive={!roundResult && !roundTransition} />

        {/* Round transition overlay */}
        {roundTransition && !roundResult && (
          <TransitionOverlay deadline={roundTransitionDeadline} />
        )}

        {/* Round result overlay */}
        {roundResult && (
          <RevealOverlay
            result={roundResult}
            players={gameState.players}
            myPlayerId={playerId ?? undefined}
            onDismiss={clearRoundResult}
          />
        )}

        {/* Max cards warning — steady (non-pulsating) edge glow when one loss away from elimination */}
        {isAtMaxCards && (
          <div className="max-cards-warning-glow" aria-hidden="true" />
        )}

        {/* Session transferred overlay — shown on old device/tab (non-dismissable) */}
        {sessionTransferred && <SessionTransferredOverlay />}

        {/* Reconnecting overlay — shown when own connection drops */}
        {!isConnected && hasConnected && !sessionTransferred && <ReconnectOverlay />}
      </div>

      {/* Emoji, stats, and chat rendered OUTSIDE game-layout so they are not affected
          by the .spectating CSS filter which breaks position:fixed children. */}
      {emojiEnabled && (
        <EmojiReactionBar onReaction={sendReaction} />
      )}
      {(isEliminated || isSpectator) && (
        <div className="fixed bottom-4 inset-x-0 z-40 flex justify-center pointer-events-none">
          <div className="pointer-events-auto">
            <InGameStats stats={inGameStats} players={gameState.players} myPlayerId={playerId} label="Match Stats" />
          </div>
        </div>
      )}
      {chatEnabled && (
        <ChatPanel
          messages={chatMessages}
          onSend={sendChatMessage}
          disabled={!isEliminated && !isSpectator && !roundResult && !roundTransition && !winnerId}
          label={isEliminated || isSpectator ? 'Spectator Chat' : 'Chat'}
        />
      )}

      {selectedPlayer && gameState && (
        <BotProfileModal
          player={selectedPlayer}
          playerIndex={gameState.players.findIndex(p => p.id === selectedPlayer.id)}
          stats={inGameStats.playerStats[selectedPlayer.id] ?? null}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </Layout>
  );
}
