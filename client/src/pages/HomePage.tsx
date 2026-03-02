import { useState, useRef, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { useSound } from '../hooks/useSound.js';

const SUITS = ['\u2660', '\u2665', '\u2666', '\u2663'] as const;
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;

interface RevealedCard {
  rank: string;
  suit: string;
  isJoker: boolean;
  cardIndex: number;
}

function getRandomCard(cardIndex: number): RevealedCard {
  const roll = Math.floor(Math.random() * 53);
  if (roll === 52) return { rank: '\u2605', suit: '', isJoker: true, cardIndex };
  const suit = SUITS[Math.floor(roll / 13)];
  const rank = RANKS[roll % 13];
  return { rank, suit, isJoker: false, cardIndex };
}

function getSuitColor(suit: string): string {
  return suit === '\u2665' || suit === '\u2666' ? '#c0392b' : '#1a1a1a';
}

const CARD_COUNT = 8;

export function HomePage() {
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'menu' | 'local' | 'host' | 'join'>('menu');
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');
  const [isHovered, setIsHovered] = useState(false);
  const [revealedCard, setRevealedCard] = useState<RevealedCard | null>(null);
  const [isRevealing, setIsRevealing] = useState(false);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    if (!isHovered && !isRevealing) {
      setIsHovered(true);
      play('deckShuffle');
    }
  }, [isHovered, isRevealing, play]);

  const handleDeckLeave = useCallback(() => {
    if (!isRevealing) {
      setIsHovered(false);
    }
  }, [isRevealing]);

  const handleDeckClick = useCallback(() => {
    if (isRevealing) return;

    const cardIndex = Math.floor(Math.random() * CARD_COUNT);
    const card = getRandomCard(cardIndex);

    setIsRevealing(true);
    setIsHovered(true);
    setRevealedCard(card);
    play('cardReveal');

    if (card.isJoker) {
      setTimeout(() => play('jokerFanfare'), 400);
    }

    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    revealTimerRef.current = setTimeout(() => {
      setRevealedCard(null);
      setIsRevealing(false);
      setIsHovered(false);
    }, card.isJoker ? 3500 : 2500);
  }, [isRevealing, play]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (mode === 'local') handlePlayLocal();
      else if (mode === 'host') handleHost();
      else if (mode === 'join') handleJoin();
    }
  };

  const isFanned = isHovered || isRevealing;

  return (
    <Layout>
      <div className="flex flex-col items-center gap-8 pt-8">
        {/* Interactive deck */}
        <div
          className="relative flex justify-center items-center mb-2 cursor-pointer select-none"
          style={{ height: '120px', width: '240px' }}
          onMouseEnter={handleDeckHover}
          onMouseLeave={handleDeckLeave}
          onTouchStart={handleDeckHover}
          onClick={handleDeckClick}
        >
          {Array.from({ length: CARD_COUNT }, (_, i) => {
            const isThisRevealed = revealedCard?.cardIndex === i;
            const centered = i - (CARD_COUNT - 1) / 2;

            // Fan positions
            const fanX = centered * 16;
            const fanY = -Math.abs(centered) * 3;
            const fanAngle = centered * 5;

            // Stack positions
            const stackX = i * 0.5;
            const stackY = -i * 1.2;
            const stackAngle = centered * 2;

            const x = isFanned ? fanX : stackX;
            const y = isFanned ? fanY : stackY;
            const angle = isThisRevealed ? 0 : (isFanned ? fanAngle : stackAngle);
            const liftY = isThisRevealed ? -65 : 0;

            return (
              <div
                key={i}
                className="absolute"
                style={{
                  transform: `translate(${x}px, ${y + liftY}px) rotate(${angle}deg)`,
                  transition: 'transform 0.45s cubic-bezier(0.34, 1.2, 0.64, 1)',
                  zIndex: isThisRevealed ? 20 : i,
                  perspective: '600px',
                }}
              >
                <div
                  style={{
                    transformStyle: 'preserve-3d',
                    transform: `rotateY(${isThisRevealed ? 180 : 0}deg)`,
                    transition: 'transform 0.55s ease-out',
                    width: '42px',
                    height: '58px',
                    position: 'relative',
                  }}
                >
                  {/* Card back */}
                  <div
                    className="deck-card-back"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      backfaceVisibility: 'hidden',
                    }}
                  />
                  {/* Card face (shown after 3D flip) */}
                  <div
                    className={`${isThisRevealed && revealedCard?.isJoker ? 'deck-joker-glow' : ''}`}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '42px',
                      height: '58px',
                      backfaceVisibility: 'hidden',
                      transform: 'rotateY(180deg)',
                      background: '#f5f0e8',
                      border: '1.5px solid #d9d0c0',
                      borderRadius: '5px',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {revealedCard && isThisRevealed && (
                      revealedCard.isJoker ? (
                        <>
                          <span style={{ fontSize: '22px', color: '#d4a843', lineHeight: 1 }}>{'\u2605'}</span>
                          <span style={{ fontSize: '7px', fontWeight: 700, color: '#d4a843', letterSpacing: '1px' }}>JOKER</span>
                        </>
                      ) : (
                        <>
                          <span style={{
                            fontSize: '11px', fontWeight: 700, color: getSuitColor(revealedCard.suit),
                            position: 'absolute', top: '3px', left: '4px', lineHeight: 1,
                          }}>
                            {revealedCard.rank}
                          </span>
                          <span style={{ fontSize: '20px', color: getSuitColor(revealedCard.suit), lineHeight: 1 }}>
                            {revealedCard.suit}
                          </span>
                          <span style={{
                            fontSize: '11px', fontWeight: 700, color: getSuitColor(revealedCard.suit),
                            position: 'absolute', bottom: '3px', right: '4px', lineHeight: 1,
                            transform: 'rotate(180deg)',
                          }}>
                            {revealedCard.rank}
                          </span>
                        </>
                      )
                    )}
                  </div>
                </div>
              </div>
            );
          })}
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
