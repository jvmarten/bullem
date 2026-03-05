import { useState, useEffect, useRef, useCallback } from 'react';
import { useSound } from '../hooks/useSound.js';
import cardFront from '../assets/images/joker-card-front.svg';
import cardBack from '../assets/images/joker-card-back.svg';

type Phase = 'idle' | 'flying' | 'dismiss';

const TAP_THRESHOLD = 53;
const TAP_TIMEOUT_MS = 2000;
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

      setPhase('flying');
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

/** Lerp helper for smooth interpolation */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Eased t using cubic ease-out */
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

interface Waypoint {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  duration: number;
}

function randomWaypoint(): Waypoint {
  const padding = 40;
  const w = window.innerWidth;
  const h = window.innerHeight;
  return {
    x: padding + Math.random() * (w - 2 * padding) - w / 2,
    y: padding + Math.random() * (h - 2 * padding) - h / 2,
    z: -500 + Math.random() * 700, // -500 to 200
    rx: Math.random() * 720 - 360,
    ry: Math.random() * 720 - 360,
    rz: Math.random() * 720 - 360,
    // Weighted toward faster: 300-1200ms, with bias toward low end
    duration: 300 + Math.pow(Math.random(), 2) * 900,
  };
}

export function JokerOverlay({ phase, setPhase, audioRef }: {
  phase: Phase;
  setPhase: (p: Phase) => void;
  audioRef: React.RefObject<HTMLAudioElement | null>;
}) {
  const { volume, muted } = useSound();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const animRef = useRef<number>(0);
  const currentRef = useRef({ x: 0, y: 0, z: -800, rx: 40, ry: 60, rz: 30 });
  const targetRef = useRef<Waypoint>(randomWaypoint());
  const startTimeRef = useRef(0);
  const startPosRef = useRef({ ...currentRef.current });

  // Sync volume/mute to the audio element whenever they change
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = muted ? 0 : volume;
    }
  }, [volume, muted, audioRef, phase]);

  // Listen for audio ended -> dismiss
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || phase === 'idle' || phase === 'dismiss') return;

    const onEnded = () => setPhase('dismiss');
    audio.addEventListener('ended', onEnded);
    return () => audio.removeEventListener('ended', onEnded);
  }, [phase, setPhase, audioRef]);

  // Screen shake + haptic when flying starts
  useEffect(() => {
    if (phase !== 'flying') return;

    // Haptic feedback
    if (navigator.vibrate) {
      navigator.vibrate([100, 30, 100, 30, 200]);
    }

    // Screen shake
    document.documentElement.classList.add('screen-shake-heavy');
    const onEnd = () => {
      document.documentElement.classList.remove('screen-shake-heavy');
    };
    const timer = setTimeout(onEnd, 500);
    return () => {
      clearTimeout(timer);
      document.documentElement.classList.remove('screen-shake-heavy');
    };
  }, [phase]);

  // Flying animation via requestAnimationFrame
  useEffect(() => {
    if (phase !== 'flying') return;

    // Initialize position off-screen
    currentRef.current = { x: window.innerWidth * 0.4, y: -window.innerHeight * 0.4, z: -800, rx: 40, ry: 60, rz: 30 };
    targetRef.current = randomWaypoint();
    startTimeRef.current = performance.now();
    startPosRef.current = { ...currentRef.current };

    const animate = (now: number) => {
      const elapsed = now - startTimeRef.current;
      const target = targetRef.current;
      const duration = target.duration;
      const rawT = Math.min(elapsed / duration, 1);
      const t = easeOut(rawT);

      const start = startPosRef.current;
      const cur = currentRef.current;
      cur.x = lerp(start.x, target.x, t);
      cur.y = lerp(start.y, target.y, t);
      cur.z = lerp(start.z, target.z, t);
      cur.rx = lerp(start.rx, target.rx, t);
      cur.ry = lerp(start.ry, target.ry, t);
      cur.rz = lerp(start.rz, target.rz, t);

      // Speed-based blur
      const speed = rawT < 1 ? (1 - rawT) : 0;
      const blur = speed > 0.3 ? 0.5 : 0;

      if (cardRef.current) {
        cardRef.current.style.transform =
          `translate3d(${cur.x}px, ${cur.y}px, ${cur.z}px) ` +
          `rotateX(${cur.rx}deg) rotateY(${cur.ry}deg) rotateZ(${cur.rz}deg)`;
        cardRef.current.style.filter = blur > 0 ? `blur(${blur}px)` : 'none';
      }

      // Pick new target when we arrive
      if (rawT >= 1) {
        startPosRef.current = { ...cur };
        targetRef.current = randomWaypoint();
        startTimeRef.current = now;
      }

      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animRef.current);
    };
  }, [phase]);

  // Dismiss animation -> idle + cleanup
  useEffect(() => {
    if (phase !== 'dismiss') return;

    // Stop the flying animation — card will keep its last transform via the dismiss CSS animation
    cancelAnimationFrame(animRef.current);

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
    if (phase === 'flying') {
      setPhase('dismiss');
    }
  }, [phase, setPhase]);

  if (phase === 'idle') return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none"
      style={{ perspective: '1200px' }}
    >
      {/* 3D Card — only the card itself is clickable */}
      <div
        ref={cardRef}
        className={`joker-card-container ${phase === 'dismiss' ? 'joker-dismiss' : ''} pointer-events-auto cursor-pointer`}
        style={{ transformStyle: 'preserve-3d' }}
        onClick={handleDismiss}
      >
        {/* Card Back (default visible face) */}
        <div className="joker-card-face joker-card-back">
          <img
            src={cardBack}
            alt="Card back"
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '12px' }}
            draggable={false}
          />
        </div>

        {/* Card Front — Joker face (rotated 180deg on Y so backface-visibility works) */}
        <div className="joker-card-face joker-card-front">
          <img
            src={cardFront}
            alt="Joker"
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '12px' }}
            draggable={false}
          />
        </div>
      </div>
    </div>
  );
}
