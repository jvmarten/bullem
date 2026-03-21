import { useEffect, useState, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useGameContext } from '../context/GameContext.js';
import { GamePhase } from '@bull-em/shared';
import { useSound } from '../hooks/useSound.js';

// localStorage keys — must match GameContext definitions
const LS_ACTIVE_ROOM = 'bull-em-active-room';
const LS_ACTIVE_PLAYER_ID = 'bull-em-active-player-id';
const LS_ACTIVE_PLAYER_NAME = 'bull-em-active-player-name';
const LS_ACTIVE_RECONNECT_TOKEN = 'bull-em-active-reconnect-token';

/**
 * Invisible component that auto-navigates to an active game after the player
 * reopens the browser (localStorage recovery). When the GameContext connect
 * handler successfully rejoins via localStorage data, it sets pendingRejoinRoom.
 * This component consumes that signal and navigates to `/game/:roomCode`.
 */
export function ActiveGameRedirect() {
  const { pendingRejoinRoom, clearPendingRejoinRoom, roomState } = useGameContext();
  const navigate = useNavigate();
  const location = useLocation();
  const didRedirect = useRef(false);

  useEffect(() => {
    if (!pendingRejoinRoom || didRedirect.current) return;

    // Already on the game page for this room — just clear the flag
    if (location.pathname === `/game/${pendingRejoinRoom}`) {
      clearPendingRejoinRoom();
      return;
    }

    // Wait until we receive room state (confirms server acknowledged us) before navigating.
    // This prevents a flash of the game page with no state.
    if (!roomState) return;

    didRedirect.current = true;
    clearPendingRejoinRoom();

    // If the game is still in lobby, go to the lobby page instead
    if (roomState.gamePhase === GamePhase.LOBBY) {
      navigate(`/room/${pendingRejoinRoom}`, { replace: true });
    } else {
      navigate(`/game/${pendingRejoinRoom}`, { replace: true });
    }
  }, [pendingRejoinRoom, roomState, location.pathname, navigate, clearPendingRejoinRoom]);

  return null;
}

const REDIRECT_SECONDS = 5;

/**
 * Fixed-top banner shown when the host starts a game while a non-host player
 * is navigating on a different page. Provides a countdown timer with options
 * to join immediately or leave the match.
 */
export function GameStartBanner() {
  const { roomState, gameState, playerId, leaveRoom } = useGameContext();
  const location = useLocation();
  const navigate = useNavigate();
  const { play } = useSound();
  const [countdown, setCountdown] = useState(REDIRECT_SECONDS);
  const [dismissed, setDismissed] = useState(false);
  // Track the roomCode that triggered the banner so we can dismiss on room change
  const [activeRoomCode, setActiveRoomCode] = useState<string | null>(null);

  const isHost = playerId === roomState?.hostId;
  const gameStarted = roomState?.gamePhase === GamePhase.PLAYING && gameState !== null;
  const roomCode = roomState?.roomCode;
  // Only show for actual players — spectators (no playerId or not in the player list) should never see this
  const isPlayer = playerId !== null && gameState ? gameState.players.some(p => p.id === playerId) : false;

  // Check if the user is already on the game page for this room
  const onGamePage = roomCode
    ? location.pathname === `/game/${roomCode}`
    : false;

  // Check if user is on the lobby page for this room (auto-redirect handled by LobbyPage)
  const onLobbyPage = roomCode
    ? location.pathname === `/room/${roomCode}`
    : false;

  const shouldShow = gameStarted && isPlayer && !isHost && !onGamePage && !onLobbyPage && !dismissed;

  // Reset dismissed state and countdown when the game start condition changes
  useEffect(() => {
    if (gameStarted && roomCode && roomCode !== activeRoomCode) {
      setDismissed(false);
      setCountdown(REDIRECT_SECONDS);
      setActiveRoomCode(roomCode);
      play('uiSoft');
    }
    if (!gameStarted) {
      setActiveRoomCode(null);
    }
  }, [gameStarted, roomCode, activeRoomCode, play]);

  // Countdown timer
  useEffect(() => {
    if (!shouldShow) return;
    if (countdown <= 0) {
      navigate(`/game/${roomCode}`);
      setDismissed(true);
      return;
    }
    const timer = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [shouldShow, countdown, roomCode, navigate]);

  const handleJoinNow = useCallback(() => {
    play('uiSoft');
    navigate(`/game/${roomCode}`);
    setDismissed(true);
  }, [roomCode, navigate, play]);

  const handleLeaveMatch = useCallback(() => {
    const confirmed = window.confirm('Forfeit this match? You will be eliminated and cannot rejoin.');
    if (!confirmed) return;
    play('uiSoft');
    leaveRoom();
    setDismissed(true);
  }, [leaveRoom, play]);

  if (!shouldShow) return null;

  const progress = countdown / REDIRECT_SECONDS;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] animate-slide-down pt-[var(--safe-top)] bg-[rgba(0,0,0,0.85)]">
      {/* Progress bar */}
      <div className="h-1 bg-[rgba(255,255,255,0.1)]">
        <div
          className="h-full bg-[var(--gold)] transition-all duration-1000 ease-linear"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <div className="bg-[rgba(0,0,0,0.85)] backdrop-blur-sm border-b border-[var(--gold)] px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          {/* Message */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--gold)]">
              Game is starting!
            </p>
            <p className="text-xs text-[var(--gold-dim)]">
              Redirecting in {countdown}s&hellip;
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={handleJoinNow}
              className="px-4 py-2 text-sm font-semibold rounded bg-[var(--gold)] text-[var(--felt-dark)] hover:brightness-110 transition-all min-h-[44px]"
            >
              Join Now
            </button>
            <button
              onClick={handleLeaveMatch}
              className="px-3 py-2 text-sm rounded border border-[var(--danger)] text-[var(--danger)] hover:bg-[var(--danger)] hover:text-white transition-all min-h-[44px]"
            >
              Leave
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Banner shown when the player has an active match they can resume.
 * Covers two scenarios:
 *   1. Browser closed and reopened — localStorage has session data, reconnect
 *      is in progress or has succeeded, but the user hasn't navigated to the
 *      game page yet.
 *   2. Player navigated away from an active game — roomState exists but they're
 *      on a different page.
 * Shows "Reconnecting..." while the server reconnect is pending, then "Resume"
 * once room state is received. Briefly shows "Match ended" if reconnect fails.
 */
export function ResumeMatchBanner(): React.ReactElement | null {
  const { roomState, pendingRejoinRoom, leaveRoom, playerId, gameState } = useGameContext();
  const location = useLocation();
  const navigate = useNavigate();
  const { play } = useSound();

  // Read localStorage for active match data (survives browser close)
  const [activeRoom, setActiveRoom] = useState<string | null>(() =>
    localStorage.getItem(LS_ACTIVE_ROOM),
  );
  const [showEnded, setShowEnded] = useState(false);
  const endedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // React immediately when roomState transitions to null (player left/was kicked)
  // and localStorage has been cleared. This prevents the stale banner from
  // showing for up to 500ms between leaveRoom() clearing storage and the poll
  // detecting it.
  const prevRoomStateRef = useRef(roomState);
  useEffect(() => {
    if (prevRoomStateRef.current && !roomState && activeRoom) {
      if (!localStorage.getItem(LS_ACTIVE_ROOM)) {
        setActiveRoom(null);
      }
    }
    prevRoomStateRef.current = roomState;
  }, [roomState, activeRoom]);

  // Poll localStorage to detect when it's cleared (reconnect failure / game over)
  useEffect(() => {
    if (!activeRoom) return;
    const interval = setInterval(() => {
      const current = localStorage.getItem(LS_ACTIVE_ROOM);
      if (!current) {
        setActiveRoom(null);
        setShowEnded(true);
        endedTimerRef.current = setTimeout(() => setShowEnded(false), 3000);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [activeRoom]);

  // Sync activeRoom if localStorage is updated with a new room (e.g. new game created).
  // Only poll when there's no active room — once we have one, the first interval handles
  // changes. Without this guard, the interval runs on every page (even homepage/login)
  // wasting CPU on 500ms localStorage reads.
  useEffect(() => {
    if (activeRoom) return; // Already tracked by the interval above
    const interval = setInterval(() => {
      const current = localStorage.getItem(LS_ACTIVE_ROOM);
      if (current) {
        setActiveRoom(current);
        setShowEnded(false);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [activeRoom]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (endedTimerRef.current) clearTimeout(endedTimerRef.current);
    };
  }, []);

  // Determine the room code: prefer roomState (confirmed), fall back to localStorage
  const roomCode = roomState?.roomCode ?? activeRoom;
  const reconnected = roomState !== null;

  // Check if user is already on the game/lobby/results/replay page for this room
  const isOnRoomPage = roomCode != null && (
    location.pathname === `/game/${roomCode}` ||
    location.pathname === `/room/${roomCode}` ||
    location.pathname === `/results/${roomCode}` ||
    location.pathname.startsWith('/replay') ||
    location.pathname.startsWith('/local/replay')
  );

  // Check if the user is an active player (not a spectator)
  const isPlayer = playerId !== null && gameState
    ? gameState.players.some(p => p.id === playerId)
    : false;

  // If we're connected and know the room is still in lobby, there's no active
  // match to resume — suppress the banner even if localStorage has session data.
  const inLobby = reconnected && roomState.gamePhase === GamePhase.LOBBY;

  // Determine visibility: show when there's an active match and user is not on that page
  const hasActiveMatch = !inLobby && (
    // Scenario A: localStorage has data (reconnecting or just reconnected)
    activeRoom != null ||
    // Scenario B: connected to a room with an active game, navigated away
    (reconnected && isPlayer)
  );

  const shouldShow = hasActiveMatch && !isOnRoomPage && !pendingRejoinRoom;

  const handleResume = useCallback(() => {
    play('uiSoft');
    const code = roomCode;
    if (!code) return;
    if (roomState && roomState.gamePhase === GamePhase.LOBBY) {
      navigate(`/room/${code}`);
    } else {
      navigate(`/game/${code}`);
    }
  }, [roomCode, roomState, navigate, play]);

  const handleLeave = useCallback(() => {
    const confirmed = window.confirm(
      'Forfeit this match? You will be eliminated and cannot rejoin.',
    );
    if (!confirmed) return;
    play('uiSoft');
    if (reconnected) {
      leaveRoom();
    } else {
      // Not yet reconnected — clear storage so we stop trying
      localStorage.removeItem(LS_ACTIVE_ROOM);
      localStorage.removeItem(LS_ACTIVE_PLAYER_ID);
      localStorage.removeItem(LS_ACTIVE_PLAYER_NAME);
      localStorage.removeItem(LS_ACTIVE_RECONNECT_TOKEN);
      sessionStorage.removeItem('bull-em-room-code');
      sessionStorage.removeItem('bull-em-player-id');
      sessionStorage.removeItem('bull-em-player-name');
      sessionStorage.removeItem('bull-em-reconnect-token');
    }
    setActiveRoom(null);
  }, [reconnected, leaveRoom, play]);

  // Brief "match ended" notification
  if (showEnded) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[99] animate-slide-down pt-[var(--safe-top)] bg-[rgba(0,0,0,0.85)]">
        <div className="bg-[rgba(0,0,0,0.85)] backdrop-blur-sm border-b border-[var(--gold-dim)] px-4 py-3">
          <div className="max-w-lg mx-auto text-center">
            <p className="text-sm text-[var(--gold-dim)]">Your match has ended</p>
          </div>
        </div>
      </div>
    );
  }

  if (!shouldShow) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[99] animate-slide-down pt-[var(--safe-top)] bg-[rgba(0,0,0,0.85)]">
      <div className="bg-[rgba(0,0,0,0.85)] backdrop-blur-sm border-b border-[var(--gold)] px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          {/* Pulsing dot — green when reconnected, amber when reconnecting */}
          <div
            className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
              reconnected
                ? 'bg-[var(--safe)]'
                : 'bg-[var(--gold)] animate-pulse'
            }`}
          />

          {/* Message */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--gold)]">
              {reconnected ? 'You have an active match' : 'Reconnecting to match\u2026'}
            </p>
            <p className="text-xs text-[var(--gold-dim)]">
              Room {roomCode}
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={handleResume}
              className="px-4 py-2 text-sm font-semibold rounded bg-[var(--gold)] text-[var(--felt-dark)] hover:brightness-110 transition-all min-h-[44px]"
            >
              Resume
            </button>
            <button
              onClick={handleLeave}
              className="px-3 py-2 text-sm rounded border border-[var(--danger)] text-[var(--danger)] hover:bg-[var(--danger)] hover:text-white transition-all min-h-[44px]"
            >
              Leave
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
