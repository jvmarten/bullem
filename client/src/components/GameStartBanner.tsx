import { useEffect, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useGameContext } from '../context/GameContext.js';
import { GamePhase } from '@bull-em/shared';
import { useSound } from '../hooks/useSound.js';

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

  // Check if the user is already on the game page for this room
  const onGamePage = roomCode
    ? location.pathname === `/game/${roomCode}`
    : false;

  // Check if user is on the lobby page for this room (auto-redirect handled by LobbyPage)
  const onLobbyPage = roomCode
    ? location.pathname === `/room/${roomCode}`
    : false;

  const shouldShow = gameStarted && !isHost && !onGamePage && !onLobbyPage && !dismissed;

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
    const confirmed = window.confirm('Are you sure you want to leave this match? You will be removed from the game.');
    if (!confirmed) return;
    play('uiSoft');
    leaveRoom();
    setDismissed(true);
  }, [leaveRoom, play]);

  if (!shouldShow) return null;

  const progress = countdown / REDIRECT_SECONDS;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] animate-slide-down">
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
