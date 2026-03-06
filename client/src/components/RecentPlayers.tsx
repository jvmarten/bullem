import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameContext } from '../context/GameContext.js';
import { useToast } from '../context/ToastContext.js';
import { useSound } from '../hooks/useSound.js';
import { getRecentPlayers, clearRecentPlayers, type RecentPlayer } from '../utils/recentPlayers.js';

/** How long ago a timestamp was, in human-readable form. */
function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

interface RecentPlayersProps {
  /** Called after a room is created, with the room code to navigate to. */
  onCreateRoom?: (roomCode: string) => void;
}

/**
 * Shows a collapsible list of players you've recently played with.
 * Each entry has an "Invite" button that creates a new room and copies
 * the invite link to the clipboard.
 */
export function RecentPlayers({ onCreateRoom }: RecentPlayersProps) {
  const [players, setPlayers] = useState<RecentPlayer[]>(() => getRecentPlayers());
  const [isExpanded, setIsExpanded] = useState(false);
  const [invitingPlayer, setInvitingPlayer] = useState<string | null>(null);
  const { isConnected, createRoom } = useGameContext();
  const { addToast } = useToast();
  const { play } = useSound();
  const navigate = useNavigate();

  const handleInvite = useCallback(async (player: RecentPlayer) => {
    if (!isConnected) {
      addToast('Not connected to server — please wait and try again');
      return;
    }
    if (invitingPlayer) return;

    setInvitingPlayer(player.name);
    try {
      const playerName = localStorage.getItem('bull-em-player-name') ?? 'Player';
      sessionStorage.setItem('bull-em-player-name', playerName);
      const roomCode = await createRoom(playerName);
      const inviteUrl = `${window.location.origin}/room/${roomCode}`;

      // Copy invite link to clipboard
      try {
        await navigator.clipboard.writeText(inviteUrl);
        addToast(`Room created! Invite link copied — share it with ${player.name}`, 'success');
      } catch {
        addToast(`Room ${roomCode} created — share the code with ${player.name}`, 'success');
      }

      if (onCreateRoom) {
        onCreateRoom(roomCode);
      } else {
        navigate(`/room/${roomCode}`);
      }
    } catch {
      addToast('Failed to create room — check your connection');
    } finally {
      setInvitingPlayer(null);
    }
  }, [isConnected, invitingPlayer, createRoom, addToast, navigate, onCreateRoom]);

  const handleClear = useCallback(() => {
    clearRecentPlayers();
    setPlayers([]);
    addToast('Recent players cleared');
  }, [addToast]);

  if (players.length === 0) return null;

  const displayPlayers = isExpanded ? players : players.slice(0, 3);

  return (
    <div className="w-full animate-fade-in">
      <div className="flex items-center justify-between px-1 mb-2">
        <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold">
          Recent Players
        </p>
        <button
          onClick={() => { play('uiSoft'); handleClear(); }}
          className="text-[10px] text-[var(--gold-dim)] hover:text-[var(--danger)] transition-colors"
        >
          Clear
        </button>
      </div>

      <div className="space-y-1.5">
        {displayPlayers.map((player) => (
          <div
            key={player.name}
            className="glass px-3 py-2.5 flex items-center justify-between gap-2"
          >
            <div className="flex-1 min-w-0">
              <span className="text-sm text-[var(--gold)] font-medium truncate block">
                {player.name}
              </span>
              <span className="text-[10px] text-[var(--gold-dim)] opacity-70">
                {timeAgo(player.lastPlayedAt)} &middot; {player.lastRoomCode}
              </span>
            </div>
            <button
              onClick={() => { play('uiSoft'); handleInvite(player); }}
              disabled={invitingPlayer !== null}
              className="btn-gold px-3 py-1.5 text-xs min-h-[36px] whitespace-nowrap"
            >
              {invitingPlayer === player.name ? 'Creating...' : 'Invite'}
            </button>
          </div>
        ))}
      </div>

      {players.length > 3 && (
        <button
          onClick={() => { play('uiSoft'); setIsExpanded(!isExpanded); }}
          className="w-full text-center text-[11px] text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors mt-2 py-1"
        >
          {isExpanded ? 'Show less' : `Show all (${players.length})`}
        </button>
      )}
    </div>
  );
}
