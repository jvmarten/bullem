import { useState, useRef, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { useSound } from '../hooks/useSound.js';
import { HandType, handToString } from '@bull-em/shared';
import type { Suit, Rank, HandCall } from '@bull-em/shared';

const SUIT_NAMES: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
const SUIT_SYMBOLS: Record<Suit, string> = { spades: '\u2660', hearts: '\u2665', diamonds: '\u2666', clubs: '\u2663' };
const RANK_ORDER: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const RANK_VAL: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};

interface DealCard { rank: Rank; suit: Suit }

function dealFiveCards(): DealCard[] {
  const deck: DealCard[] = [];
  for (const suit of SUIT_NAMES) {
    for (const rank of RANK_ORDER) {
      deck.push({ rank, suit });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck.slice(0, 5);
}

function classifyHand(cards: DealCard[]): HandCall {
  const rankCounts = new Map<Rank, number>();
  for (const c of cards) {
    rankCounts.set(c.rank, (rankCounts.get(c.rank) ?? 0) + 1);
  }

  const isFlush = cards.every(c => c.suit === cards[0].suit);
  const values = cards.map(c => RANK_VAL[c.rank]).sort((a, b) => a - b);
  const isSequential = values.every((v, i) => i === 0 || v === values[i - 1] + 1);
  const isWheel = values[0] === 2 && values[1] === 3 && values[2] === 4 && values[3] === 5 && values[4] === 14;
  const isStraight = isSequential || isWheel;
  const highVal = isWheel ? 5 : values[4];
  const highRank = RANK_ORDER[highVal - 2];

  const groups = [...rankCounts.entries()]
    .sort((a, b) => b[1] - a[1] || RANK_VAL[b[0]] - RANK_VAL[a[0]]);

  if (isFlush && isStraight && values[4] === 14 && values[0] === 10) {
    return { type: HandType.ROYAL_FLUSH, suit: cards[0].suit };
  }
  if (isFlush && isStraight) {
    return { type: HandType.STRAIGHT_FLUSH, suit: cards[0].suit, highRank };
  }
  if (groups[0][1] === 4) {
    return { type: HandType.FOUR_OF_A_KIND, rank: groups[0][0] };
  }
  if (groups[0][1] === 3 && groups[1][1] === 2) {
    return { type: HandType.FULL_HOUSE, threeRank: groups[0][0], twoRank: groups[1][0] };
  }
  if (isStraight) {
    return { type: HandType.STRAIGHT, highRank };
  }
  if (groups[0][1] === 3) {
    return { type: HandType.THREE_OF_A_KIND, rank: groups[0][0] };
  }
  if (isFlush) {
    return { type: HandType.FLUSH, suit: cards[0].suit };
  }
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const [a, b] = [groups[0][0], groups[1][0]];
    const [highPair, lowPair] = RANK_VAL[a] > RANK_VAL[b] ? [a, b] : [b, a];
    return { type: HandType.TWO_PAIR, highRank: highPair, lowRank: lowPair };
  }
  if (groups[0][1] === 2) {
    return { type: HandType.PAIR, rank: groups[0][0] };
  }
  return { type: HandType.HIGH_CARD, rank: groups[0][0] };
}

function getSuitColor(suit: Suit): string {
  return suit === 'hearts' || suit === 'diamonds' ? '#c0392b' : '#1a1a1a';
}

const CARD_COUNT = 5;

export function HomePage() {
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'menu' | 'local' | 'host' | 'join'>('menu');
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');
  const [isHovered, setIsHovered] = useState(false);
  const [dealtCards, setDealtCards] = useState<DealCard[] | null>(null);
  const [handCall, setHandCall] = useState<HandCall | null>(null);
  const [isDealing, setIsDealing] = useState(false);
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
    if (!isHovered && !isDealing) {
      setIsHovered(true);
      play('deckShuffle');
    }
  }, [isHovered, isDealing, play]);

  const handleDeckLeave = useCallback(() => {
    if (!isDealing) {
      setIsHovered(false);
    }
  }, [isDealing]);

  const handleDeckClick = useCallback(() => {
    if (isDealing) return;

    const cards = dealFiveCards();
    const hand = classifyHand(cards);

    setIsDealing(true);
    setIsHovered(true);
    setDealtCards(cards);
    setHandCall(hand);
    play('cardReveal');

    if (hand.type === HandType.ROYAL_FLUSH) {
      setTimeout(() => play('fanfare'), 600);
    }

    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    revealTimerRef.current = setTimeout(() => {
      setDealtCards(null);
      setHandCall(null);
      setIsDealing(false);
      setIsHovered(false);
    }, hand.type === HandType.ROYAL_FLUSH ? 4000 : 3000);
  }, [isDealing, play]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (mode === 'local') handlePlayLocal();
      else if (mode === 'host') handleHost();
      else if (mode === 'join') handleJoin();
    }
  };

  const isFanned = isHovered || isDealing;
  const isDealt = dealtCards !== null;
  const isRoyal = handCall?.type === HandType.ROYAL_FLUSH;

  return (
    <Layout>
      <div className="flex flex-col items-center gap-8 pt-8">
        {/* Interactive deck */}
        <div className="relative flex flex-col items-center mb-2">
          <div
            className="relative flex justify-center items-center cursor-pointer select-none"
            style={{ height: '100px', width: '220px' }}
            onMouseEnter={handleDeckHover}
            onMouseLeave={handleDeckLeave}
            onTouchStart={handleDeckHover}
            onClick={handleDeckClick}
          >
            {Array.from({ length: CARD_COUNT }, (_, i) => {
              const card = dealtCards?.[i];
              const centered = i - (CARD_COUNT - 1) / 2;

              const fanX = centered * 18;
              const fanY = -Math.abs(centered) * 3;
              const fanAngle = centered * 5;

              const stackX = i * 0.5;
              const stackY = -i * 1.2;
              const stackAngle = centered * 1.5;

              const x = isFanned ? fanX : stackX;
              const y = isFanned ? fanY : stackY;
              const angle = isFanned ? fanAngle : stackAngle;

              return (
                <div
                  key={i}
                  className="absolute"
                  style={{
                    transform: `translate(${x}px, ${y}px) rotate(${angle}deg)`,
                    transition: 'transform 0.45s cubic-bezier(0.34, 1.2, 0.64, 1)',
                    zIndex: i,
                    perspective: '600px',
                  }}
                >
                  <div
                    style={{
                      transformStyle: 'preserve-3d',
                      transform: `rotateY(${isDealt ? 180 : 0}deg)`,
                      transition: 'transform 0.55s ease-out',
                      transitionDelay: isDealt ? `${i * 0.1}s` : '0s',
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
                    {/* Card face */}
                    <div
                      className={isDealt && isRoyal ? 'deck-joker-glow' : ''}
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
                      {card && (
                        <>
                          <span style={{
                            fontSize: '11px', fontWeight: 700,
                            color: getSuitColor(card.suit),
                            position: 'absolute', top: '3px', left: '4px', lineHeight: 1,
                          }}>
                            {card.rank}
                          </span>
                          <span style={{ fontSize: '20px', color: getSuitColor(card.suit), lineHeight: 1 }}>
                            {SUIT_SYMBOLS[card.suit]}
                          </span>
                          <span style={{
                            fontSize: '11px', fontWeight: 700,
                            color: getSuitColor(card.suit),
                            position: 'absolute', bottom: '3px', right: '4px', lineHeight: 1,
                            transform: 'rotate(180deg)',
                          }}>
                            {card.rank}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Hand name */}
          <div style={{ height: '24px', marginTop: '4px' }}>
            {handCall && (
              <span
                className={`text-sm font-semibold animate-fade-in ${isRoyal ? 'text-[var(--gold)]' : 'text-[var(--gold-dim)]'}`}
                style={{ animationDelay: '0.5s', animationFillMode: 'both' }}
              >
                {handToString(handCall)}
              </span>
            )}
          </div>
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
