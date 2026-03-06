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

  /** Stop audio and reset state — call when navigating away from the home page. */
  const stopEasterEgg = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    countRef.current = 0;
    clearTimeout(timerRef.current);
    setPhase('idle');
  }, []);

  return { phase, setPhase, handleLogoClick, audioRef, stopEasterEgg };
}

/** Catmull-Rom spline interpolation for continuous, smooth curves through waypoints */
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
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
  const padding = 60;
  const w = window.innerWidth;
  const h = window.innerHeight;
  return {
    x: padding + Math.random() * (w - 2 * padding) - w / 2,
    y: padding + Math.random() * (h - 2 * padding) - h / 2,
    z: -300 + Math.random() * 400, // -300 to 100 (less extreme depth)
    rx: Math.random() * 720 - 360,  // full rotation range so both faces show
    ry: Math.random() * 720 - 360,  // freely rotates to show front and back
    rz: Math.random() * 360 - 180,
    // Much slower: 3000-8000ms, with varied pacing
    duration: 3000 + Math.random() * 5000,
  };
}

export function JokerOverlay({ phase, setPhase, audioRef }: {
  phase: Phase;
  setPhase: (p: Phase) => void;
  audioRef: React.RefObject<HTMLAudioElement | null>;
}) {
  const { volume, muted, hapticsEnabled } = useSound();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const animRef = useRef<number>(0);
  // Sliding window of 4 waypoints for Catmull-Rom spline interpolation.
  // The card always travels along the curve between waypoints[1] and waypoints[2],
  // using waypoints[0] and waypoints[3] as tangent guides.
  const waypointsRef = useRef<Waypoint[]>([]);
  const segmentStartRef = useRef(0);
  const segmentDurationRef = useRef(0);
  // Spin state: when the card is clicked, it does a quick random spin before resuming flight
  const spinRef = useRef<{ active: boolean; startTime: number; duration: number; rx: number; ry: number; rz: number; baseRx: number; baseRy: number; baseRz: number }>({
    active: false, startTime: 0, duration: 0, rx: 0, ry: 0, rz: 0, baseRx: 0, baseRy: 0, baseRz: 0,
  });

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

    // Haptic feedback (respects user's haptics setting)
    if (hapticsEnabled && navigator.vibrate) {
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
  }, [phase, hapticsEnabled]);

  // Flying animation via requestAnimationFrame with Catmull-Rom spline
  useEffect(() => {
    if (phase !== 'flying') return;

    // Seed 4 waypoints: the first is the off-screen entry point
    const entry: Waypoint = {
      x: window.innerWidth * 0.4,
      y: -window.innerHeight * 0.4,
      z: -400,
      rx: 20, ry: 180, rz: 15, // Start with front face visible (180° shows front due to backface-visibility)
      duration: 4000,
    };
    const wp1 = randomWaypoint();
    const wp2 = randomWaypoint();
    const wp3 = randomWaypoint();
    waypointsRef.current = [entry, wp1, wp2, wp3];
    // The card travels from waypoints[1] to waypoints[2] using the segment duration
    segmentDurationRef.current = wp2.duration;
    segmentStartRef.current = performance.now();

    const animate = (now: number) => {
      const elapsed = now - segmentStartRef.current;
      const duration = segmentDurationRef.current;
      const t = Math.min(elapsed / duration, 1);

      const wps = waypointsRef.current;
      const p0 = wps[0];
      const p1 = wps[1];
      const p2 = wps[2];
      const p3 = wps[3];
      if (!p0 || !p1 || !p2 || !p3) return;

      const x = catmullRom(p0.x, p1.x, p2.x, p3.x, t);
      const y = catmullRom(p0.y, p1.y, p2.y, p3.y, t);
      const z = catmullRom(p0.z, p1.z, p2.z, p3.z, t);
      const rx = catmullRom(p0.rx, p1.rx, p2.rx, p3.rx, t);
      const ry = catmullRom(p0.ry, p1.ry, p2.ry, p3.ry, t);
      const rz = catmullRom(p0.rz, p1.rz, p2.rz, p3.rz, t);

      // Apply spin overlay if active (triggered by clicking the card)
      let finalRx = rx;
      let finalRy = ry;
      let finalRz = rz;
      const spin = spinRef.current;
      if (spin.active) {
        const spinElapsed = now - spin.startTime;
        const spinT = Math.min(spinElapsed / spin.duration, 1);
        // Ease-out cubic for a natural deceleration
        const eased = 1 - Math.pow(1 - spinT, 3);
        finalRx += spin.rx * eased;
        finalRy += spin.ry * eased;
        finalRz += spin.rz * eased;
        if (spinT >= 1) {
          spin.active = false;
        }
      }

      if (cardRef.current) {
        cardRef.current.style.transform =
          `translate3d(${x}px, ${y}px, ${z}px) ` +
          `rotateX(${finalRx}deg) rotateY(${finalRy}deg) rotateZ(${finalRz}deg)`;
      }

      // Advance to next segment when current one completes
      if (t >= 1) {
        waypointsRef.current = [p1, p2, p3, randomWaypoint()];
        segmentDurationRef.current = p3.duration;
        segmentStartRef.current = now;
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

  const handleCardClick = useCallback(() => {
    if (phase === 'flying') {
      // Spin the card in a random direction instead of dismissing
      const directions = [
        { rx: 720, ry: 0, rz: 0 },
        { rx: -720, ry: 0, rz: 0 },
        { rx: 0, ry: 720, rz: 0 },
        { rx: 0, ry: -720, rz: 0 },
        { rx: 0, ry: 0, rz: 720 },
        { rx: 0, ry: 0, rz: -720 },
        { rx: 360, ry: 360, rz: 0 },
        { rx: -360, ry: 0, rz: 360 },
      ];
      const dir = directions[Math.floor(Math.random() * directions.length)]!;
      spinRef.current = {
        active: true,
        startTime: performance.now(),
        duration: 800 + Math.random() * 400,
        rx: dir.rx,
        ry: dir.ry,
        rz: dir.rz,
        baseRx: 0,
        baseRy: 0,
        baseRz: 0,
      };
    }
  }, [phase]);

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
        onClick={handleCardClick}
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
