import { useState, useEffect, useRef, useCallback } from 'react';
import { useSound } from '../hooks/useSound.js';

type Phase = 'idle' | 'fly-in' | 'flip' | 'levitate' | 'dismiss';

const TAP_THRESHOLD = 53;
const TAP_TIMEOUT_MS = 2000;
const FLY_IN_MS = 5500;
const FLIP_MS = 700;
const DISMISS_MS = 600;

export function useJokerEasterEgg() {
  const [phase, setPhase] = useState<Phase>('idle');
  const countRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleLogoClick = useCallback(() => {
    if (phase !== 'idle') return;

    clearTimeout(timerRef.current);
    countRef.current += 1;

    if (countRef.current >= TAP_THRESHOLD) {
      countRef.current = 0;

      // Lazy-load the 1.1MB audio file only when the easter egg triggers.
      // This keeps it out of the initial bundle for the 99.9% of users who
      // never tap the logo 53 times.
      import('../assets/sounds/stubbin-full.mp3').then(({ default: url }) => {
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.play().catch(() => {});
      }).catch(() => {});

      setPhase('fly-in');
    } else {
      timerRef.current = setTimeout(() => {
        countRef.current = 0;
      }, TAP_TIMEOUT_MS);
    }
  }, [phase]);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  return { phase, setPhase, handleLogoClick, audioRef };
}

export function JokerOverlay({ phase, setPhase, audioRef }: {
  phase: Phase;
  setPhase: (p: Phase) => void;
  audioRef: React.RefObject<HTMLAudioElement | null>;
}) {
  const { volume, muted } = useSound();

  // Sync volume/mute to the audio element whenever they change
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = muted ? 0 : volume;
    }
  }, [volume, muted, audioRef, phase]);

  // Listen for audio ended → dismiss
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || phase === 'idle' || phase === 'dismiss') return;

    const onEnded = () => setPhase('dismiss');
    audio.addEventListener('ended', onEnded);
    return () => audio.removeEventListener('ended', onEnded);
  }, [phase, setPhase, audioRef]);

  // Advance phases on animation timers
  useEffect(() => {
    if (phase === 'fly-in') {
      const t = setTimeout(() => setPhase('flip'), FLY_IN_MS);
      return () => clearTimeout(t);
    }
    if (phase === 'flip') {
      const t = setTimeout(() => setPhase('levitate'), FLIP_MS);
      return () => clearTimeout(t);
    }
  }, [phase, setPhase]);

  // Dismiss animation → idle + cleanup
  useEffect(() => {
    if (phase !== 'dismiss') return;
    const t = setTimeout(() => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setPhase('idle');
    }, DISMISS_MS);
    return () => clearTimeout(t);
  }, [phase, setPhase, audioRef]);

  const handleDismiss = useCallback(() => {
    if (phase === 'levitate' || phase === 'flip') {
      setPhase('dismiss');
    }
  }, [phase, setPhase]);

  if (phase === 'idle') return null;

  const cardAnimClass =
    phase === 'fly-in' ? 'joker-fly-in' :
    phase === 'flip' ? 'joker-flip' :
    phase === 'levitate' ? 'joker-levitate' :
    phase === 'dismiss' ? 'joker-dismiss' : '';

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none"
      style={{ perspective: '1200px' }}
    >
      {/* 3D Card — only the card itself is clickable */}
      <div
        className={`joker-card-container ${cardAnimClass} pointer-events-auto cursor-pointer`}
        style={{ transformStyle: 'preserve-3d' }}
        onClick={handleDismiss}
      >
        {/* Card Back */}
        <div className="joker-card-face joker-card-back">
          <div className="joker-card-back-inner" />
        </div>

        {/* Card Front — Joker face */}
        <div className="joker-card-face joker-card-front">
          <div className="joker-front-content">
            <span className="joker-corner joker-corner-top">J<span className="joker-corner-suit">&#9830;</span></span>
            <div className="joker-face">
              <div className="joker-face-hat">
                <span className="joker-bell">&#9752;</span>
                <span className="joker-hat-tip" />
                <span className="joker-bell">&#9752;</span>
              </div>
              <div className="joker-face-head">
                <div className="joker-face-eyes">
                  <span className="joker-eye">&#9679;</span>
                  <span className="joker-eye">&#9679;</span>
                </div>
                <div className="joker-face-mouth" />
              </div>
              <div className="joker-face-collar">
                <span className="joker-collar-point" />
                <span className="joker-collar-point" />
                <span className="joker-collar-point" />
              </div>
            </div>
            <span className="joker-label">JOKER</span>
            <span className="joker-corner joker-corner-bottom">J<span className="joker-corner-suit">&#9830;</span></span>
          </div>
        </div>
      </div>
    </div>
  );
}
