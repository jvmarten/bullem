import { useState, useRef, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { useSound } from '../hooks/useSound.js';

export function HomePage() {
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'menu' | 'local' | 'host' | 'join'>('menu');
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');
  const [isHovered, setIsHovered] = useState(false);
  const [bullCharging, setBullCharging] = useState(false);
  const [cardsScattered, setCardsScattered] = useState(false);
  const scatterSeedRef = useRef<{ x: number; y: number; r: number }[]>([]);
  const navigate = useNavigate();
  const { play } = useSound();

  const handlePlayLocal = () => {
    if (!name.trim()) return setError('Enter your name');
    sessionStorage.setItem('bull-em-local-name', name.trim());
    navigate('/local');
  };

  const handleHost = () => {
    if (!name.trim()) return setError('Enter your name');
    sessionStorage.setItem('bull-em-player-name', name.trim());
    navigate('/host');
  };

  const handleJoin = () => {
    if (!name.trim()) return setError('Enter your name');
    if (!roomCode.trim()) return setError('Enter a room code');
    sessionStorage.setItem('bull-em-player-name', name.trim());
    navigate(`/room/${roomCode.trim().toUpperCase()}`);
  };

  const handleDeckHover = useCallback(() => {
    if (!isHovered && !bullCharging && !cardsScattered) {
      setIsHovered(true);
      play('deckShuffle');
    }
  }, [isHovered, bullCharging, cardsScattered, play]);

  const handleDeckLeave = useCallback(() => {
    if (!bullCharging && !cardsScattered) {
      setIsHovered(false);
    }
  }, [bullCharging, cardsScattered]);

  const handleDeckClick = useCallback(() => {
    if (bullCharging || cardsScattered) return;
    // Generate random scatter positions for each card
    scatterSeedRef.current = Array.from({ length: 8 }, () => ({
      x: (Math.random() - 0.5) * 300,
      y: (Math.random() - 0.5) * 200 - 60,
      r: (Math.random() - 0.5) * 720,
    }));
    setBullCharging(true);
    setIsHovered(false);
    play('bullCharge');
    // After bull hits the deck, scatter cards
    setTimeout(() => {
      setBullCharging(false);
      setCardsScattered(true);
      play('cardScatter');
      // Reset after animation completes
      setTimeout(() => {
        setCardsScattered(false);
      }, 2000);
    }, 500);
  }, [bullCharging, cardsScattered, play]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (mode === 'local') handlePlayLocal();
      else if (mode === 'host') handleHost();
      else if (mode === 'join') handleJoin();
    }
  };

  return (
    <Layout>
      <div className="flex flex-col items-center gap-8 pt-8">
        {/* Hero tagline */}
        <p className="text-[var(--gold-dim)] text-center text-sm tracking-wide">
          A multiplayer bluffing card game
        </p>

        {/* Interactive deck */}
        <div
          className="relative flex justify-center items-center mb-2 cursor-pointer select-none"
          style={{ height: '100px', width: '200px' }}
          onMouseEnter={handleDeckHover}
          onMouseLeave={handleDeckLeave}
          onTouchStart={handleDeckHover}
          onClick={handleDeckClick}
        >
          {/* Stacked deck of card backs */}
          {!cardsScattered && Array.from({ length: 8 }, (_, i) => (
            <div
              key={i}
              className="deck-card-back absolute"
              style={{
                transform: `translate(${i * 0.5}px, ${-i * 1.2}px) rotate(${(i - 3.5) * 2}deg)`,
                zIndex: i,
                opacity: bullCharging ? 0 : 1,
                transition: 'opacity 0.15s ease',
              }}
            />
          ))}

          {/* Scattered cards */}
          {cardsScattered && scatterSeedRef.current.map((seed, i) => (
            <div
              key={`scatter-${i}`}
              className="deck-card-back absolute deck-scatter"
              style={{
                '--scatter-x': `${seed.x}px`,
                '--scatter-y': `${seed.y}px`,
                '--scatter-r': `${seed.r}deg`,
                zIndex: 20 + i,
              } as React.CSSProperties}
            />
          ))}

          {/* Muleta (red cape) — appears on hover, waves continuously */}
          {isHovered && !bullCharging && !cardsScattered && (
            <div className="absolute muleta-cape" style={{ zIndex: 15 }}>
              <svg width="60" height="50" viewBox="0 0 60 50" className="muleta-wave">
                <defs>
                  <linearGradient id="muletaGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#dc3545" />
                    <stop offset="50%" stopColor="#c0392b" />
                    <stop offset="100%" stopColor="#8b1a1a" />
                  </linearGradient>
                </defs>
                <path
                  d="M5 5 Q15 0 30 8 Q45 16 55 10 L55 40 Q45 48 30 42 Q15 36 5 45 Z"
                  fill="url(#muletaGrad)"
                  stroke="#8b1a1a"
                  strokeWidth="1"
                />
                {/* Stick */}
                <line x1="5" y1="5" x2="5" y2="45" stroke="#8b6914" strokeWidth="3" strokeLinecap="round" />
              </svg>
            </div>
          )}

          {/* Bull — charges from left on click */}
          {bullCharging && (
            <div className="absolute bull-charge" style={{ zIndex: 20 }}>
              <svg width="70" height="50" viewBox="0 0 70 50">
                {/* Body */}
                <ellipse cx="35" cy="28" rx="22" ry="14" fill="#2d1810" />
                {/* Head */}
                <circle cx="55" cy="22" r="10" fill="#3d2418" />
                {/* Horns */}
                <path d="M58 14 Q62 6 66 8" stroke="#d4a843" strokeWidth="2.5" fill="none" strokeLinecap="round" />
                <path d="M58 14 Q60 4 56 4" stroke="#d4a843" strokeWidth="2.5" fill="none" strokeLinecap="round" />
                {/* Eye */}
                <circle cx="58" cy="20" r="2" fill="#dc3545" />
                {/* Nostril steam */}
                <circle cx="63" cy="25" r="1.5" fill="#c0392b" opacity="0.6" />
                {/* Legs */}
                <line x1="22" y1="38" x2="18" y2="48" stroke="#2d1810" strokeWidth="3" strokeLinecap="round" />
                <line x1="30" y1="38" x2="28" y2="48" stroke="#2d1810" strokeWidth="3" strokeLinecap="round" />
                <line x1="40" y1="38" x2="42" y2="48" stroke="#2d1810" strokeWidth="3" strokeLinecap="round" />
                <line x1="48" y1="36" x2="52" y2="46" stroke="#2d1810" strokeWidth="3" strokeLinecap="round" />
                {/* Tail */}
                <path d="M13 24 Q6 18 8 12" stroke="#2d1810" strokeWidth="2" fill="none" strokeLinecap="round" />
              </svg>
            </div>
          )}
        </div>

        {error && (
          <div className="w-full glass px-4 py-2.5 text-sm text-[var(--danger)] border-[var(--danger)] animate-shake">
            {error}
          </div>
        )}

        {mode === 'menu' && (
          <div className="flex flex-col gap-3 w-full animate-fade-in">
            <button onClick={() => setMode('local')} className="w-full btn-gold py-4 text-lg">
              Play vs Bots
            </button>
            <button onClick={() => setMode('host')} className="w-full btn-gold py-4 text-lg">
              Host Online Game
            </button>
            <button onClick={() => setMode('join')} className="w-full btn-ghost py-4 text-lg">
              Join Online Room
            </button>
            <Link
              to="/how-to-play"
              className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-sm transition-colors text-center"
            >
              How to Play
            </Link>
          </div>
        )}

        {mode === 'local' && (
          <div className="flex flex-col gap-3 w-full animate-fade-in" onKeyDown={handleKeyDown}>
            <input
              type="text"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              autoFocus
              className="w-full input-felt"
            />
            <button
              onClick={handlePlayLocal}
              className="w-full btn-gold py-3 text-lg"
            >
              Start Game
            </button>
            <button
              onClick={() => { setMode('menu'); setError(''); }}
              className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-sm transition-colors text-center"
            >
              Back
            </button>
          </div>
        )}

        {mode === 'host' && (
          <div className="flex flex-col gap-3 w-full animate-fade-in" onKeyDown={handleKeyDown}>
            <input
              type="text"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              autoFocus
              className="w-full input-felt"
            />
            <button
              onClick={handleHost}
              className="w-full btn-gold py-3 text-lg"
            >
              Create Room
            </button>
            <button
              onClick={() => { setMode('menu'); setError(''); }}
              className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-sm transition-colors text-center"
            >
              Back
            </button>
          </div>
        )}

        {mode === 'join' && (
          <div className="flex flex-col gap-3 w-full animate-fade-in" onKeyDown={handleKeyDown}>
            <input
              type="text"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              autoFocus
              className="w-full input-felt"
            />
            <input
              type="text"
              placeholder="Room code"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              maxLength={4}
              className="w-full input-felt uppercase tracking-[0.3em] text-center text-xl font-bold"
            />
            <button
              onClick={handleJoin}
              className="w-full btn-gold py-3 text-lg"
            >
              Join
            </button>
            <button
              onClick={() => { setMode('menu'); setError(''); }}
              className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-sm transition-colors text-center"
            >
              Back
            </button>
          </div>
        )}
      </div>
    </Layout>
  );
}
