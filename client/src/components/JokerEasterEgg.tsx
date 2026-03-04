import { useState, useEffect, useRef, useCallback } from 'react';
import stubbinUrl from '../assets/sounds/stubbin-full.mp3';
import { useSound } from '../hooks/useSound.js';

type Phase = 'idle' | 'fly-in' | 'flip' | 'levitate' | 'dismiss';

const TAP_THRESHOLD = 53;
const TAP_TIMEOUT_MS = 2000;

export function useJokerEasterEgg() {
  const [phase, setPhase] = useState<Phase>('idle');
  const countRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleLogoClick = useCallback(() => {
    if (phase !== 'idle') return;

    clearTimeout(timerRef.current);
    countRef.current += 1;

    if (countRef.current >= TAP_THRESHOLD) {
      countRef.current = 0;
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

  return { phase, setPhase, handleLogoClick };
}

export function JokerOverlay({ phase, setPhase }: {
  phase: Phase;
  setPhase: (p: Phase) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { volume, muted } = useSound();

  // Advance phases on animation timers
  useEffect(() => {
    if (phase === 'fly-in') {
      const t = setTimeout(() => setPhase('flip'), 1000);
      return () => clearTimeout(t);
    }
    if (phase === 'flip') {
      const t = setTimeout(() => setPhase('levitate'), 600);
      return () => clearTimeout(t);
    }
  }, [phase, setPhase]);

  // Start audio when flipping
  useEffect(() => {
    if (phase !== 'flip') return;
    const audio = new Audio(stubbinUrl);
    audio.volume = muted ? 0 : volume;
    audio.play().catch(() => {});
    audioRef.current = audio;

    audio.addEventListener('ended', () => {
      setPhase('dismiss');
    });

    return () => {
      audio.removeEventListener('ended', () => {});
    };
  }, [phase, volume, muted, setPhase]);

  // Dismiss animation → idle
  useEffect(() => {
    if (phase !== 'dismiss') return;
    const t = setTimeout(() => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setPhase('idle');
    }, 600);
    return () => clearTimeout(t);
  }, [phase, setPhase]);

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
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ perspective: '1200px' }}
      onClick={handleDismiss}
    >
      {/* Dark overlay */}
      <div className={`absolute inset-0 bg-black transition-opacity duration-500 ${
        phase === 'dismiss' ? 'opacity-0' : 'opacity-60'
      }`} />

      {/* 3D Card */}
      <div
        className={`joker-card-container ${cardAnimClass}`}
        style={{ transformStyle: 'preserve-3d' }}
      >
        {/* Card Back */}
        <div className="joker-card-face joker-card-back">
          <div className="joker-card-back-inner" />
        </div>

        {/* Card Front — Joker */}
        <div className="joker-card-face joker-card-front">
          <div className="joker-front-content">
            <span className="joker-star">&#9733;</span>
            <span className="joker-label">JOKER</span>
            <span className="joker-hat">&#9812;</span>
            <span className="joker-label">JOKER</span>
            <span className="joker-star joker-star-flip">&#9733;</span>
          </div>
        </div>
      </div>
    </div>
  );
}
