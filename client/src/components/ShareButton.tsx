import { useCallback } from 'react';
import { useToast } from '../context/ToastContext.js';

interface ShareButtonProps {
  /** The room code to share */
  roomCode: string;
  /** Visual variant — "prominent" for lobby, "compact" for in-game top bar */
  variant?: 'prominent' | 'compact';
}

/**
 * Share / copy-to-clipboard button for room invite links.
 * Uses the Web Share API when available (most mobile browsers),
 * falls back to clipboard copy otherwise.
 */
export function ShareButton({ roomCode, variant = 'prominent' }: ShareButtonProps) {
  const { addToast } = useToast();

  const inviteUrl = `${window.location.origin}/room/${roomCode}`;

  const handleShare = useCallback(async () => {
    // Try native share first (mobile browsers, PWA)
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Join my Bull \'Em game!',
          text: `Join my Bull 'Em game with code ${roomCode}`,
          url: inviteUrl,
        });
        return;
      } catch (err: unknown) {
        // User cancelled or share failed — fall through to clipboard
        if (err instanceof Error && err.name === 'AbortError') return;
      }
    }

    // Clipboard fallback
    try {
      await navigator.clipboard.writeText(inviteUrl);
    } catch {
      // Fallback for older browsers / non-HTTPS contexts
      const textarea = document.createElement('textarea');
      textarea.value = inviteUrl;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    addToast('Invite link copied!', 'success');
  }, [roomCode, inviteUrl, addToast]);

  if (variant === 'compact') {
    return (
      <button
        onClick={handleShare}
        className="text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors text-xs min-h-[44px] min-w-[44px] flex items-center justify-center"
        title="Share invite link"
      >
        Share
      </button>
    );
  }

  return (
    <button
      onClick={handleShare}
      className="w-full glass px-4 py-3 text-sm font-semibold text-[var(--gold)] hover:text-[var(--gold-light)] transition-colors flex items-center justify-center gap-2 min-h-[44px]"
    >
      <ShareIcon />
      <span>Share Invite Link</span>
    </button>
  );
}

/** Minimal share icon (arrow out of box) — inline SVG to avoid asset dependencies */
function ShareIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 10V2" />
      <path d="M5 4l3-3 3 3" />
      <path d="M13 8v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8" />
    </svg>
  );
}
