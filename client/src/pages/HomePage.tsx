import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { Layout } from '../components/Layout.js';
import { useSound } from '../hooks/useSound.js';
import { useGameContext } from '../context/GameContext.js';
import { useToast } from '../context/ToastContext.js';
import { useAuth } from '../context/AuthContext.js';
import { loadMatchSettings } from '../components/VolumeControl.js';
import { RecentPlayers } from '../components/RecentPlayers.js';
import { isTutorialCompleted, isFirstGame } from '../utils/tutorialProgress.js';
import { HandType, handToString, MATCHMAKING_BOT_BACKFILL_SECONDS, DEFAULT_ONLINE_GAME_SETTINGS } from '@bull-em/shared';
import type { GameSettings } from '@bull-em/shared';
import { RankBadgeLarge } from '../components/RankBadge.js';
import type { Suit, Rank, HandCall, RoomListing, LiveGameListing, RankedMode } from '@bull-em/shared';

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
    const temp = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = temp;
  }
  return deck.slice(0, 5);
}

function classifyHand(cards: DealCard[]): HandCall {
  const rankCounts = new Map<Rank, number>();
  for (const c of cards) {
    rankCounts.set(c.rank, (rankCounts.get(c.rank) ?? 0) + 1);
  }

  const isFlush = cards.every(c => c.suit === cards[0]!.suit);
  const values = cards.map(c => RANK_VAL[c.rank]).sort((a, b) => a - b);
  const isSequential = values.every((v, i) => i === 0 || v === values[i - 1]! + 1);
  const isWheel = values[0] === 2 && values[1] === 3 && values[2] === 4 && values[3] === 5 && values[4] === 14;
  const isStraight = isSequential || isWheel;
  const highVal = isWheel ? 5 : values[4]!;
  const highRank = RANK_ORDER[highVal - 2]!;

  const groups = [...rankCounts.entries()]
    .sort((a, b) => b[1] - a[1] || RANK_VAL[b[0]] - RANK_VAL[a[0]]);

  if (isFlush && isStraight && values[4] === 14 && values[0] === 10) {
    return { type: HandType.ROYAL_FLUSH, suit: cards[0]!.suit };
  }
  if (isFlush && isStraight) {
    return { type: HandType.STRAIGHT_FLUSH, suit: cards[0]!.suit, highRank };
  }
  if (groups[0]![1] === 4) {
    return { type: HandType.FOUR_OF_A_KIND, rank: groups[0]![0] };
  }
  if (groups[0]![1] === 3 && groups[1]![1] === 2) {
    return { type: HandType.FULL_HOUSE, threeRank: groups[0]![0], twoRank: groups[1]![0] };
  }
  if (isStraight) {
    return { type: HandType.STRAIGHT, highRank };
  }
  if (groups[0]![1] === 3) {
    return { type: HandType.THREE_OF_A_KIND, rank: groups[0]![0] };
  }
  if (isFlush) {
    return { type: HandType.FLUSH, suit: cards[0]!.suit };
  }
  if (groups[0]![1] === 2 && groups[1]![1] === 2) {
    const [a, b] = [groups[0]![0], groups[1]![0]];
    const [highPair, lowPair] = RANK_VAL[a] > RANK_VAL[b] ? [a, b] : [b, a];
    return { type: HandType.TWO_PAIR, highRank: highPair, lowRank: lowPair };
  }
  if (groups[0]![1] === 2) {
    return { type: HandType.PAIR, rank: groups[0]![0] };
  }
  return { type: HandType.HIGH_CARD, rank: groups[0]![0] };
}

function getSuitColor(suit: Suit): string {
  return suit === 'hearts' || suit === 'diamonds' ? '#c0392b' : '#1a1a1a';
}

/** Approximate probability of being dealt this hand type from 5 random cards. */
function getHandProbability(type: HandType): string {
  // Standard 5-card poker probabilities (rounded)
  switch (type) {
    case HandType.ROYAL_FLUSH:      return '1 in 649,740';
    case HandType.STRAIGHT_FLUSH:   return '1 in 72,193';
    case HandType.FOUR_OF_A_KIND:   return '1 in 4,165';
    case HandType.FULL_HOUSE:       return '1 in 694';
    case HandType.FLUSH:            return '1 in 509';
    case HandType.STRAIGHT:         return '1 in 255';
    case HandType.THREE_OF_A_KIND:  return '1 in 47';
    case HandType.TWO_PAIR:         return '1 in 21';
    case HandType.PAIR:             return '1 in 2.4';
    case HandType.HIGH_CARD:        return '1 in 2';
  }
}

/** Returns indices of cards that form the identified hand */
function getRelevantIndices(cards: DealCard[], hand: HandCall): Set<number> {
  const indices = new Set<number>();

  switch (hand.type) {
    case HandType.ROYAL_FLUSH:
    case HandType.STRAIGHT_FLUSH:
    case HandType.STRAIGHT:
    case HandType.FLUSH:
    case HandType.FULL_HOUSE:
      for (let i = 0; i < cards.length; i++) indices.add(i);
      break;
    case HandType.FOUR_OF_A_KIND:
      for (let i = 0; i < cards.length; i++) {
        if (cards[i]!.rank === hand.rank) indices.add(i);
      }
      break;
    case HandType.THREE_OF_A_KIND:
      for (let i = 0; i < cards.length; i++) {
        if (cards[i]!.rank === hand.rank) indices.add(i);
      }
      break;
    case HandType.TWO_PAIR:
      for (let i = 0; i < cards.length; i++) {
        if (cards[i]!.rank === hand.highRank || cards[i]!.rank === hand.lowRank) {
          indices.add(i);
        }
      }
      break;
    case HandType.PAIR:
      for (let i = 0; i < cards.length; i++) {
        if (cards[i]!.rank === hand.rank) indices.add(i);
      }
      break;
    case HandType.HIGH_CARD:
      for (let i = 0; i < cards.length; i++) {
        if (cards[i]!.rank === hand.rank) { indices.add(i); break; }
      }
      break;
  }

  return indices;
}

/** Fisher-Yates shuffle of an array (returns new array) */
function shuffleArray<T>(arr: T[]): T[] {
  const next = [...arr];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = next[i]!;
    next[i] = next[j]!;
    next[j] = temp;
  }
  return next;
}

const CARD_COUNT = 5;
const INITIAL_ORDER = [0, 1, 2, 3, 4];

const PLAYER_NAME_STORAGE_KEY = 'bull-em-player-name';

function generatePlayerName(): string {
  return `guest${Math.floor(1000 + Math.random() * 9000)}`;
}

function getOrCreatePlayerName(): string {
  const stored = localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
  if (stored) return stored;
  const name = generatePlayerName();
  localStorage.setItem(PLAYER_NAME_STORAGE_KEY, name);
  return name;
}

// Hue offsets for the "coming soon" wallpaper background on each press

function MatchmakingQueue({ status, onCancel }: { status: { mode: RankedMode; position: number; estimatedWaitSeconds: number }; onCancel: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(interval);
  }, []);

  const modeLabel = status.mode === 'heads_up' ? 'Finding 1v1 opponent' : 'Finding multiplayer match';
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const elapsedStr = mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `0:${secs.toString().padStart(2, '0')}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'var(--overlay)' }}>
      <div className="glass p-8 rounded-xl max-w-xs text-center space-y-4 animate-scale-in">
        <p className="text-lg font-semibold text-[var(--gold)]">{modeLabel}...</p>
        {/* Pulsing dots indicator */}
        <div className="flex justify-center gap-1.5">
          {[0, 1, 2].map(i => (
            <span
              key={i}
              className="w-2.5 h-2.5 rounded-full bg-[var(--gold)]"
              style={{
                animation: 'matchmaking-pulse 1.2s ease-in-out infinite',
                animationDelay: `${i * 0.2}s`,
              }}
            />
          ))}
        </div>
        <p className="text-sm text-[var(--gold-dim)] font-mono">{elapsedStr}</p>
        {status.position > 0 && (
          <p className="text-xs text-[var(--gold-dim)]">Position: #{status.position}</p>
        )}
        {elapsed < MATCHMAKING_BOT_BACKFILL_SECONDS && (
          <p className="text-xs text-[var(--gold-dim)]">
            Max wait: {MATCHMAKING_BOT_BACKFILL_SECONDS - elapsed}s
          </p>
        )}
        <button
          onClick={onCancel}
          className="btn-ghost px-6 py-2 text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function MatchFoundScreen({ match, onNavigate }: { match: { roomCode: string; opponents: { name: string; rating: number; tier: import('@bull-em/shared').RankTier }[] }; onNavigate: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onNavigate, 2500);
    return () => clearTimeout(timer);
  }, [onNavigate]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'var(--overlay)' }}>
      <div className="glass p-8 rounded-xl max-w-xs text-center space-y-4 animate-scale-in">
        <p className="text-2xl font-bold text-[var(--gold)] font-display">Match Found!</p>
        <div className="space-y-2">
          {match.opponents.map((opp, i) => (
            <div key={i} className="flex items-center justify-center gap-2">
              <span className="text-sm text-[var(--gold)]">{opp.name}</span>
              <RankBadgeLarge rating={opp.rating} tier={opp.tier} />
            </div>
          ))}
        </div>
        <div className="w-6 h-6 border-2 border-[var(--gold)] border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    </div>
  );
}

export function HomePage() {
  const { user } = useAuth();
  const [name, setName] = useState(() => {
    // Prefer the signed-in user's display name over the random Player1234
    if (user?.displayName) return user.displayName;
    return getOrCreatePlayerName();
  });
  const location = useLocation();
  const [mode, setMode] = useState<'menu' | 'online' | 'join' | 'browse'>(
    () => (location.state as { mode?: string } | null)?.mode === 'online' ? 'online' : 'menu',
  );
  const [roomCode, setRoomCode] = useState('');
  const { addToast } = useToast();
  const [isHovered, setIsHovered] = useState(false);
  const [dealtCards, setDealtCards] = useState<DealCard[] | null>(null);
  const [handCall, setHandCall] = useState<HandCall | null>(null);
  const [isDealing, setIsDealing] = useState(false);
  const [showHighlight, setShowHighlight] = useState(false);
  const [shuffleOrder, setShuffleOrder] = useState(INITIAL_ORDER);
  const [rooms, setRooms] = useState<RoomListing[]>([]);
  const [liveGames, setLiveGames] = useState<LiveGameListing[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shuffleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const navigate = useNavigate();
  const { play, startLoop, stopLoop, stopAllLoops } = useSound();
  const { isConnected, listRooms, listLiveGames, spectateGame, watchRandomGame, roomState, createRoom, deleteRoom, updateSettings, matchmakingStatus, matchmakingFound, joinMatchmaking, leaveMatchmaking, clearMatchmakingFound } = useGameContext();

  // Dev mode badge state — only checked in dev builds
  const [devStatus, setDevStatus] = useState<{ devAuth: boolean } | null>(null);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    fetch('/api/dev-status', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setDevStatus(data as { devAuth: boolean }); })
      .catch(() => { /* server not running yet — ignore */ });
  }, []);

  // Sync player name with auth state — when user signs in, use their display name;
  // when user signs out, generate a fresh guest name
  useEffect(() => {
    if (user?.displayName) {
      setName(user.displayName);
      localStorage.setItem(PLAYER_NAME_STORAGE_KEY, user.displayName);
    } else if (!user) {
      const guestName = generatePlayerName();
      setName(guestName);
      localStorage.setItem(PLAYER_NAME_STORAGE_KEY, guestName);
    }
  }, [user]);

  // Auto-redirect to an active game when the user returns after browser close.
  // The GameContext connect handler rejoins from localStorage, which sets
  // roomState and gameState. If we detect an active in-progress game, navigate
  // directly to the game page instead of showing the home menu.
  useEffect(() => {
    if (roomState && roomState.gamePhase !== 'lobby') {
      navigate(`/game/${roomState.roomCode}`);
    }
  }, [roomState, navigate]);

  // Shuffle card positions on interval while hovering (not when cards are dealt and showing)
  const isShuffling = isHovered && !isDealing && !dealtCards;
  useEffect(() => {
    if (!isShuffling) {
      setShuffleOrder(INITIAL_ORDER);
      if (shuffleIntervalRef.current) {
        clearInterval(shuffleIntervalRef.current);
        shuffleIntervalRef.current = null;
      }
      return;
    }
    // Immediately shuffle once, then on interval
    setShuffleOrder(prev => shuffleArray(prev));
    shuffleIntervalRef.current = setInterval(() => {
      setShuffleOrder(prev => shuffleArray(prev));
    }, 700);
    return () => {
      if (shuffleIntervalRef.current) clearInterval(shuffleIntervalRef.current);
    };
  }, [isShuffling]);

  // Play looping shuffle sound while the deck is shuffling
  useEffect(() => {
    if (isShuffling) {
      startLoop('deckShuffleLoop');
    } else {
      stopLoop('deckShuffleLoop');
    }
    return () => {
      stopLoop('deckShuffleLoop');
    };
  }, [isShuffling, startLoop, stopLoop]);

  // Stop all looping sounds on unmount (e.g. navigating to another page)
  useEffect(() => {
    return () => {
      stopAllLoops();
    };
  }, [stopAllLoops]);

  const getPlayerName = (): string => {
    const current = name.trim() || getOrCreatePlayerName();
    localStorage.setItem(PLAYER_NAME_STORAGE_KEY, current);
    return current;
  };


  const getOnlinePlayerName = (): string => {
    const playerName = getPlayerName();
    sessionStorage.setItem('bull-em-player-name', playerName);
    return playerName;
  };

  const handlePlayLocal = () => {
    const playerName = getPlayerName();
    sessionStorage.setItem('bull-em-local-name', playerName);
    navigate('/local');
  };

  const handleQuickPlay = () => {
    const playerName = getPlayerName();
    sessionStorage.setItem('bull-em-local-name', playerName);
    navigate('/local', { state: { quickPlay: true } });
  };


  const [creatingRoom, setCreatingRoom] = useState(false);
  const [showVersion, setShowVersion] = useState(false);
  const [showRecentPlayers, setShowRecentPlayers] = useState(false);
  const [showWelcome, setShowWelcome] = useState(() => {
    // Show welcome modal for first-time visitors who haven't completed the tutorial
    // and haven't played a game yet, and haven't previously dismissed the modal
    if (localStorage.getItem('bull-em-welcome-dismissed') === 'true') return false;
    return !isTutorialCompleted() && isFirstGame();
  });
  const [rankedExpanded, setRankedExpanded] = useState(false);
  const [joiningRanked, setJoiningRanked] = useState<'heads_up' | 'multiplayer' | null>(null);

  // Sync joining state with matchmaking status — keep the queue mode visible
  // so the 1v1/multiplayer buttons maintain their in-queue appearance
  useEffect(() => {
    if (matchmakingStatus) {
      setJoiningRanked(matchmakingStatus.mode === 'heads_up' ? 'heads_up' : 'multiplayer');
      setRankedExpanded(true);
    } else if (!matchmakingFound) {
      setJoiningRanked(null);
    }
  }, [matchmakingStatus, matchmakingFound]);
  const handleQuickStart = async () => {
    if (!isConnected) return addToast('Not connected to server — please wait and try again');
    if (creatingRoom) return;
    setCreatingRoom(true);
    try {
      const roomCode = await createRoom(getOnlinePlayerName(), user?.avatar);
      // Apply saved match settings so the room remembers previous preferences
      const saved = loadMatchSettings('online');
      if (saved) {
        const restored: GameSettings = {
          ...DEFAULT_ONLINE_GAME_SETTINGS,
          ...(saved.maxCards != null && { maxCards: saved.maxCards }),
          ...(saved.turnTimer != null && { turnTimer: saved.turnTimer }),
          ...(saved.maxPlayers != null && { maxPlayers: saved.maxPlayers }),
          ...(saved.botSpeed && { botSpeed: saved.botSpeed }),
          ...(saved.lastChanceMode && { lastChanceMode: saved.lastChanceMode }),
          ...(saved.botLevelCategory && { botLevelCategory: saved.botLevelCategory }),
          ...(saved.allowSpectators != null && { allowSpectators: saved.allowSpectators }),
          ...(saved.spectatorsCanSeeCards != null && { spectatorsCanSeeCards: saved.spectatorsCanSeeCards }),
          ...(saved.bestOf != null && { bestOf: saved.bestOf }),
        } as GameSettings;
        updateSettings(restored);
      }
      navigate(`/room/${roomCode}`);
    } catch {
      addToast('Failed to quick start — check your connection');
    } finally {
      setCreatingRoom(false);
    }
  };

  const handleHost = () => {
    if (!isConnected) return addToast('Not connected to server — please wait and try again');
    getOnlinePlayerName();
    navigate('/host');
  };

  const handleJoin = () => {
    if (!roomCode.trim()) return addToast('Enter a room code');
    if (!isConnected) return addToast('Not connected to server — please wait and try again');
    getOnlinePlayerName();
    navigate(`/room/${roomCode.trim().toUpperCase()}`);
  };

  const handleBrowse = async () => {
    if (!isConnected) return addToast('Not connected to server — please wait and try again');
    setLoadingRooms(true);
    try {
      const [roomResult, liveResult] = await Promise.all([listRooms(), listLiveGames()]);
      setRooms(roomResult);
      setLiveGames(liveResult);
    } catch {
      addToast('Failed to load rooms — check your connection');
    } finally {
      setLoadingRooms(false);
    }
    setMode('browse');
  };

  const handleJoinFromBrowse = (code: string) => {
    getOnlinePlayerName();
    navigate(`/room/${code}`);
  };

  const handleSpectate = async (code: string) => {
    try {
      await spectateGame(code);
      navigate(`/game/${code}`);
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to spectate');
    }
  };

  const handleWatchRandom = async () => {
    if (!isConnected) return addToast('Not connected to server — please wait and try again');
    try {
      const code = await watchRandomGame();
      navigate(`/game/${code}`);
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'No live games to watch');
    }
  };

  const handleDeckHover = useCallback(() => {
    if (!isHovered && !isDealing && !dealtCards) {
      setIsHovered(true);
    }
  }, [isHovered, isDealing, dealtCards]);

  const handleDeckLeave = useCallback(() => {
    if (!isDealing && !dealtCards) {
      setIsHovered(false);
    }
  }, [isDealing, dealtCards]);

  const handleDeckClick = useCallback(() => {
    // If cards are already dealt and showing, reset back to deck
    if (dealtCards && !isDealing) {
      setDealtCards(null);
      setHandCall(null);
      setIsHovered(false);
      setShowHighlight(false);
      return;
    }

    if (isDealing) return;

    const cards = dealFiveCards();
    const hand = classifyHand(cards);

    setIsDealing(true);
    setIsHovered(true);
    setShowHighlight(false);
    setDealtCards(cards);
    setHandCall(hand);
    play('cardReveal');

    if (hand.type === HandType.ROYAL_FLUSH) {
      setTimeout(() => play('fanfare'), 600);
    }

    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setShowHighlight(true), 900);

    // Mark dealing as complete after flip animation finishes, but keep cards shown
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    revealTimerRef.current = setTimeout(() => {
      setIsDealing(false);
    }, 800);
  }, [isDealing, dealtCards, play]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (mode === 'join') handleJoin();
    }
  };

  const isDealt = dealtCards !== null;
  const isRoyal = handCall?.type === HandType.ROYAL_FLUSH;
  const relevantIndices = dealtCards && handCall
    ? getRelevantIndices(dealtCards, handCall)
    : new Set<number>();

  return (
    <Layout largeTitle={mode === 'menu'}>
      <div className="home-content flex flex-col items-center gap-8 pt-8">
        {/* Tagline — orients first-time visitors */}
        {mode === 'menu' && (
          <p className="text-sm text-[var(--gold-dim)] text-center animate-fade-in -mb-4" style={{ maxWidth: '320px' }}>
            A multiplayer bluffing card game — call it or call bull.
          </p>
        )}

        {/* Left panel in landscape: deck demo — only on main menu */}
        {mode === 'menu' && <div className="home-left">
        {/* Interactive deck */}
        <div className="relative flex flex-col items-center mb-2">
          <div
            className="relative flex justify-center items-center cursor-pointer select-none"
            style={{ height: '100px', width: '280px' }}
            onMouseEnter={handleDeckHover}
            onMouseLeave={handleDeckLeave}
            onTouchStart={handleDeckHover}
            onClick={handleDeckClick}
          >
            {Array.from({ length: CARD_COUNT }, (_, i) => {
              const card = dealtCards?.[i];
              const centered = i - (CARD_COUNT - 1) / 2;

              const dealX = centered * 46;
              const dealY = 0;
              const dealAngle = 0;

              // Use shuffleOrder to determine stack position during shuffle
              const pos = shuffleOrder[i]!;
              const stackX = pos * 0.5;
              const stackY = -pos * 1.2;
              const stackAngle = (pos - (CARD_COUNT - 1) / 2) * 1.5;

              const isHighlighted = showHighlight && relevantIndices.has(i);
              const popY = isHighlighted ? -16 : 0;

              const x = isDealt ? dealX : stackX;
              const y = (isDealt ? dealY : stackY) + popY;
              const angle = isDealt ? dealAngle : stackAngle;

              const riffleDir = i % 2 === 0 ? -1 : 1;

              return (
                <div
                  key={i}
                  className="absolute"
                  style={{
                    transform: `translate(${x}px, ${y}px) rotate(${angle}deg)`,
                    transition: 'transform 0.45s cubic-bezier(0.34, 1.2, 0.64, 1)',
                    zIndex: isHighlighted ? 10 + i : pos,
                    perspective: '600px',
                  }}
                >
                  <div
                    className={isShuffling ? 'deck-shuffle-anim' : ''}
                    style={{
                      '--shuffle-dir': riffleDir,
                      animationDelay: `${i * 0.08}s`,
                    } as React.CSSProperties}
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
                      <div
                        className="deck-card-back"
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          backfaceVisibility: 'hidden',
                        }}
                      />
                      <div
                        className={isDealt && isRoyal ? 'deck-royal-glow' : ''}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '42px',
                          height: '58px',
                          backfaceVisibility: 'hidden',
                          transform: 'rotateY(180deg)',
                          background: '#f5f0e8',
                          border: isHighlighted ? '1.5px solid var(--gold)' : '1.5px solid #d9d0c0',
                          borderRadius: '5px',
                          boxShadow: isHighlighted
                            ? '0 4px 12px rgba(212, 168, 67, 0.5), 0 0 8px rgba(212, 168, 67, 0.3)'
                            : '0 2px 6px rgba(0,0,0,0.3)',
                          opacity: showHighlight && !isHighlighted ? 0.45 : 1,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'border 0.3s, box-shadow 0.3s, opacity 0.4s',
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
                </div>
              );
            })}
          </div>

          {/* Hand name + probability */}
          <div style={{ minHeight: '36px', marginTop: '-2px' }} className="text-center">
            {handCall && (
              <>
                <span
                  className={`text-sm font-semibold animate-fade-in block ${isRoyal ? 'text-[var(--gold)]' : 'text-[var(--gold-dim)]'}`}
                  style={{ animationDelay: '0.5s', animationFillMode: 'both' }}
                >
                  {handToString(handCall)}
                </span>
                {handCall.type >= HandType.PAIR && (
                  <span
                    className="text-[10px] text-[var(--gold-dim)] opacity-60 animate-fade-in block"
                    style={{ animationDelay: '0.8s', animationFillMode: 'both' }}
                  >
                    {getHandProbability(handCall.type)}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        </div>}{/* end home-left */}

        {/* Right panel in landscape: name + menu buttons */}
        <div className="home-right">
        {/* Player name / auth display — centered */}
        {(mode === 'menu' || mode === 'online') && (
          <div className="flex items-center justify-center gap-2 animate-fade-in">
            {user ? (
              /* Signed-in: show user icon + username linking to profile */
              <Link
                to="/profile"
                className="text-base text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors flex items-center gap-2 min-h-[44px]"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                <span>{name}</span>
              </Link>
            ) : (
              /* Not signed in: show GuestXXXX as a button that navigates to sign-in */
              <Link
                to="/login"
                className="text-base text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors flex items-center gap-2 min-h-[44px]"
              >
                <span>{name}</span>
                <span className="text-xs opacity-60">(sign in)</span>
              </Link>
            )}
          </div>
        )}

        {mode === 'menu' && (
          <div className="flex flex-col gap-3 w-full animate-fade-in">
            <button onClick={() => { play('uiSoft'); handleQuickPlay(); }} className="w-full btn-gold py-4 text-lg">
              Quick Play
            </button>
            <button onClick={() => { play('uiSoft'); setMode('online'); }} className="w-full btn-gold py-4 text-lg">
              Play Online
            </button>
            <button onClick={() => { play('uiSoft'); handlePlayLocal(); }} className="w-full btn-gold py-4 text-lg">
              Play Offline
            </button>
            <Link
              to="/tutorial"
              className="w-full btn-info py-4 text-lg text-center block"
            >
              Interactive Tutorial
            </Link>
            <button
              onClick={() => { play('uiSoft'); handleWatchRandom(); }}
              className="w-full btn-ghost py-4 text-lg"
            >
              Watch a Game
            </button>
            <Link
              to="/leaderboard"
              className="w-full btn-ghost py-4 text-lg text-center block"
            >
              Leaderboard
            </Link>
            <Link
              to="/draw"
              className="w-full btn-purple py-4 text-lg text-center block"
            >
              Deck Draw
            </Link>
            <Link
              to="/how-to-play"
              className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-sm transition-colors text-center block"
            >
              Rules
            </Link>
          </div>
        )}

        {mode === 'menu' && (
          <div className="w-full">
            <button
              onClick={() => { play('uiSoft'); setShowRecentPlayers(prev => !prev); }}
              className="w-full flex items-center justify-center gap-1.5 text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold py-2"
            >
              <span>{showRecentPlayers ? 'Hide' : 'Show'} Recent Players</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className={`transition-transform ${showRecentPlayers ? 'rotate-180' : ''}`}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {showRecentPlayers && <RecentPlayers />}
          </div>
        )}

        {mode === 'online' && (
          <div className="flex flex-col gap-3 w-full animate-fade-in">
            {roomState ? (
              <>
                <button
                  onClick={() => navigate(`/room/${roomState.roomCode}`)}
                  className="w-full btn-gold py-4 text-lg flex items-center justify-center relative"
                >
                  <span>Return to Room ({roomState.roomCode})</span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      const ok = window.confirm('Close this room? All players will be disconnected.');
                      if (!ok) return;
                      play('uiSoft');
                      deleteRoom();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation();
                        e.preventDefault();
                        const ok = window.confirm('Close this room? All players will be disconnected.');
                        if (!ok) return;
                        play('uiSoft');
                        deleteRoom();
                      }
                    }}
                    className="absolute right-3 text-red-500 hover:text-red-400 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center drop-shadow-[0_0_4px_rgba(239,68,68,0.5)]"
                    title="Close room"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </span>
                </button>
                <button onClick={() => { play('uiSoft'); handleBrowse(); }} className="w-full btn-ghost py-4 text-lg">
                  Lobby
                </button>
                <button onClick={() => { play('uiSoft'); setMode('join'); }} className="w-full btn-ghost py-4 text-lg">
                  Join with Code
                </button>
              </>
            ) : (
              <>
                <button onClick={() => { play('uiSoft'); handleQuickStart(); }} className="w-full btn-gold py-4 text-lg">
                  Quick Start
                </button>
                <button onClick={() => { play('uiSoft'); handleHost(); }} className="w-full btn-gold py-4 text-lg">
                  Host Game
                </button>
                <button onClick={() => { play('uiSoft'); handleBrowse(); }} className="w-full btn-ghost py-4 text-lg">
                  Lobby
                </button>
                <button onClick={() => { play('uiSoft'); setMode('join'); }} className="w-full btn-ghost py-4 text-lg">
                  Join with Code
                </button>
              </>
            )}
            {/* Ranked Play — expandable with 1v1 / Multiplayer sub-options */}
            <button
              onClick={() => {
                play('uiSoft');
                if (!user) { addToast('Sign in to play ranked'); return; }
                setRankedExpanded(prev => !prev);
              }}
              className={`w-full btn-orange py-4 text-lg ${!user ? 'opacity-60' : ''}`}
            >
              Ranked Play
            </button>
            {rankedExpanded && user && (
              <div className="flex flex-col gap-2 w-full animate-fade-in -mt-1">
                <div className="flex gap-2 w-full">
                  <button
                    onClick={() => {
                      if (joiningRanked) return;
                      play('uiSoft');
                      getOnlinePlayerName();
                      setJoiningRanked('heads_up');
                      joinMatchmaking('heads_up').catch(e => { setJoiningRanked(null); addToast(e instanceof Error ? e.message : 'Failed to join queue'); });
                    }}
                    disabled={joiningRanked !== null && joiningRanked !== 'heads_up'}
                    className={`flex-1 py-3 text-sm ${joiningRanked === 'heads_up' ? 'btn-safe animate-pulse' : joiningRanked === 'multiplayer' ? 'btn-ghost opacity-40 cursor-not-allowed' : 'btn-danger'}`}
                  >
                    {joiningRanked === 'heads_up' ? 'In Queue...' : '1v1'}
                  </button>
                  <button
                    onClick={() => {
                      if (joiningRanked) return;
                      play('uiSoft');
                      getOnlinePlayerName();
                      setJoiningRanked('multiplayer');
                      joinMatchmaking('multiplayer').catch(e => { setJoiningRanked(null); addToast(e instanceof Error ? e.message : 'Failed to join queue'); });
                    }}
                    disabled={joiningRanked !== null && joiningRanked !== 'multiplayer'}
                    className={`flex-1 py-3 text-sm ${joiningRanked === 'multiplayer' ? 'btn-safe animate-pulse' : joiningRanked === 'heads_up' ? 'btn-ghost opacity-40 cursor-not-allowed' : 'btn-danger'}`}
                  >
                    {joiningRanked === 'multiplayer' ? 'In Queue...' : 'Multiplayer'}
                  </button>
                </div>
                {joiningRanked && (
                  <button
                    onClick={() => { play('uiBack'); setJoiningRanked(null); leaveMatchmaking().catch(() => {}); }}
                    className="btn-ghost text-sm py-2"
                  >
                    Cancel
                  </button>
                )}
              </div>
            )}
            <button
              onClick={() => { play('uiBack'); setMode('menu'); }}
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
              placeholder="Room code"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              maxLength={4}
              autoFocus
              className="w-full input-felt uppercase tracking-[0.3em] text-center text-xl font-bold"
            />
            <button
              onClick={handleJoin}
              className="w-full btn-gold py-3 text-lg"
            >
              Join
            </button>
            <button
              onClick={() => { play('uiBack'); setMode('online');}}
              className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-sm transition-colors text-center"
            >
              Back
            </button>
          </div>
        )}

        {mode === 'browse' && (
          <div className="flex flex-col gap-3 w-full animate-fade-in">
            {loadingRooms ? (
              <div className="text-center py-4">
                <div className="w-6 h-6 border-2 border-[var(--gold)] border-t-transparent rounded-full animate-spin mx-auto" />
              </div>
            ) : (
              <>
                {/* Open Rooms */}
                <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold px-1">
                  Open Rooms
                </p>
                {rooms.length === 0 ? (
                  <div className="glass px-4 py-4 text-center">
                    <p className="text-[var(--gold-dim)] text-xs">No open rooms</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {rooms.map(room => (
                      <button
                        key={room.roomCode}
                        onClick={() => handleJoinFromBrowse(room.roomCode)}
                        className="w-full glass px-4 py-3 flex justify-between items-center hover:border-[var(--gold)] transition-colors"
                      >
                        <div className="text-left">
                          <span className="font-mono text-[var(--gold)] font-bold tracking-wider">{room.roomCode}</span>
                          <span className="text-[var(--gold-dim)] text-xs ml-2">hosted by {room.hostName}</span>
                        </div>
                        <div className="text-right text-xs text-[var(--gold-dim)]">
                          <span>{room.playerCount}/{room.maxPlayers}</span>
                          {room.settings.turnTimer > 0 && (
                            <span className="ml-2">{room.settings.turnTimer}s</span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Live Games */}
                <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold px-1 mt-2">
                  Live Games
                </p>
                {liveGames.length === 0 ? (
                  <div className="glass px-4 py-4 text-center">
                    <p className="text-[var(--gold-dim)] text-xs">No live games to spectate</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {liveGames.map(game => (
                      <button
                        key={game.roomCode}
                        onClick={() => handleSpectate(game.roomCode)}
                        className="w-full glass px-4 py-3 flex justify-between items-center hover:border-[var(--gold)] transition-colors"
                      >
                        <div className="text-left">
                          <span className="font-mono text-[var(--gold)] font-bold tracking-wider">{game.roomCode}</span>
                          <span className="text-[var(--gold-dim)] text-xs ml-2">hosted by {game.hostName}</span>
                        </div>
                        <div className="text-right text-xs text-[var(--gold-dim)]">
                          <span>{game.playerCount} players</span>
                          <span className="ml-2">Rd {game.roundNumber}</span>
                          {game.spectatorCount > 0 && (
                            <span className="ml-2">{game.spectatorCount} watching</span>
                          )}
                          {game.spectatorsCanSeeCards && (
                            <span className="ml-1 text-[var(--gold)]" title="Cards visible">&#128065;</span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            <button
              onClick={() => { play('uiSoft'); handleBrowse(); }}
              className="w-full glass px-4 py-2 text-sm text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors"
            >
              Refresh
            </button>
            <button
              onClick={() => { play('uiBack'); setMode('online');}}
              className="text-[var(--gold-dim)] hover:text-[var(--gold)] text-sm transition-colors text-center"
            >
              Back
            </button>
          </div>
        )}
        </div>{/* end home-right */}
      </div>
      {/* Matchmaking Queue Overlay */}
      {matchmakingStatus && (
        <MatchmakingQueue
          status={matchmakingStatus}
          onCancel={() => { play('uiBack'); leaveMatchmaking().catch(() => {}); }}
        />
      )}

      {/* Match Found Overlay */}
      {matchmakingFound && (
        <MatchFoundScreen
          match={matchmakingFound}
          onNavigate={() => {
            clearMatchmakingFound();
            navigate(`/game/${matchmakingFound.roomCode}`);
          }}
        />
      )}

      {/* First-visit welcome modal — prompts new players to try the tutorial */}
      {showWelcome && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'var(--overlay)' }}
          onClick={() => {
            localStorage.setItem('bull-em-welcome-dismissed', 'true');
            setShowWelcome(false);
          }}
        >
          <div
            className="glass p-8 rounded-xl max-w-xs text-center space-y-5 animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold text-[var(--gold)] font-display">Welcome to Bull &apos;Em!</h3>
            <p className="text-sm text-[var(--gold-dim)] leading-relaxed">
              New here? Learn the ropes with our interactive tutorial — it only takes a couple of minutes.
            </p>
            <div className="flex flex-col gap-3">
              <Link
                to="/tutorial"
                onClick={() => {
                  play('uiSoft');
                  localStorage.setItem('bull-em-welcome-dismissed', 'true');
                }}
                className="w-full btn-gold py-3 text-lg text-center block"
              >
                Start Tutorial
              </Link>
              <button
                onClick={() => {
                  play('uiSoft');
                  localStorage.setItem('bull-em-welcome-dismissed', 'true');
                  setShowWelcome(false);
                }}
                className="btn-ghost px-6 py-2 text-sm"
              >
                Skip — I know how to play
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Version — bottom right, scrolls with page content */}
      <div className="flex justify-end mt-4 pb-4 pr-2">
        <button
          onClick={() => { play('uiSoft'); setShowVersion(true); }}
          className="text-[10px] text-[var(--gold-dim)] opacity-60 hover:opacity-100 transition-opacity cursor-pointer bg-transparent border-none p-2 min-w-[44px] min-h-[44px] flex items-center justify-center"
        >
          v1.3.6
        </button>
      </div>

      {/* Version info modal */}
      {showVersion && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setShowVersion(false)}
        >
          <div
            className="glass p-6 rounded-xl max-w-xs text-center space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-[var(--gold)]">Bull &apos;Em v1.3.6</h3>
            <p className="text-sm text-[var(--gold-dim)]">Released March 8, 2026</p>
            <ul className="text-xs text-left text-[var(--gold-dim)] space-y-1 mt-2 list-disc list-inside">
              <li>Player avatar now opens quick-view overlay</li>
              <li>Bot avatars show lifetime stats</li>
              <li>Removed deck draw card sound effect</li>
            </ul>
          </div>
        </div>
      )}
      {/* Dev mode badge — only shown in Vite dev builds */}
      {import.meta.env.DEV && devStatus && (
        <div
          style={{
            position: 'fixed',
            bottom: 8,
            left: 8,
            padding: '2px 8px',
            fontSize: '10px',
            fontWeight: 600,
            letterSpacing: '0.5px',
            borderRadius: 9999,
            background: 'rgba(255, 200, 0, 0.15)',
            color: 'rgba(255, 200, 0, 0.7)',
            border: '1px solid rgba(255, 200, 0, 0.25)',
            zIndex: 9999,
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          DEV MODE{devStatus.devAuth ? ' · simulated login' : ''}
        </div>
      )}
    </Layout>
  );
}
