import { useState, useCallback, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { HandType, handToString } from '@bull-em/shared';
import type { Card, HandCall, Player, TurnEntry } from '@bull-em/shared';
import { RoundPhase, TurnAction } from '@bull-em/shared';
import { Layout } from '../components/Layout.js';
import { HandDisplay } from '../components/HandDisplay.js';
import { CardDisplay } from '../components/CardDisplay.js';
import { TutorialOverlay } from '../components/TutorialOverlay.js';
import { HandSelector } from '../components/HandSelector.js';
import { useSound } from '../hooks/useSound.js';
import { SUIT_SYMBOLS, getSuitHex } from '../utils/cardUtils.js';
import { useUISettings } from '../components/VolumeControl.js';
import { markTutorialCompleted, setTutorialStepReached, clearTutorialStepProgress } from '../utils/tutorialProgress.js';

/* ── Scripted game data ────────────────────────────────── */

/** Fixed cards for the tutorial — deterministic, no RNG needed. */
const MY_CARDS: Card[] = [{ rank: '7', suit: 'hearts' }];
const BOT_CARDS: Card[] = [{ rank: '7', suit: 'spades' }];

const BOT_NAME = 'Dealer Bot';
const MY_NAME = 'You';
const MY_ID = 'tutorial-human';
const BOT_ID = 'tutorial-bot';

const PLAYERS: Player[] = [
  { id: MY_ID, name: MY_NAME, cardCount: 1, isConnected: true, isEliminated: false, isHost: true },
  { id: BOT_ID, name: BOT_NAME, cardCount: 1, isConnected: true, isEliminated: false, isHost: false, isBot: true },
];

/* ── Hand example display for ranking walkthrough ──────── */

function HandExample({ rank, name, cards, desc, highlight }: {
  rank: number;
  name: string;
  cards: Card[];
  desc: string;
  highlight?: boolean;
}) {
  const { fourColorDeckEnabled } = useUISettings();
  return (
    <div className="flex items-center gap-2">
      <span className={`text-[10px] font-mono w-5 text-right shrink-0 ${highlight ? 'text-[var(--gold)]' : 'text-[var(--gold-dim)]'}`}>
        {rank}.
      </span>
      <div className="flex gap-0.5 shrink-0">
        {cards.map((c, i) => {
          const sc = getSuitHex(c.suit, fourColorDeckEnabled);
          return (
            <div key={i} className="w-6 h-8 rounded-[3px] flex flex-col items-center justify-center" style={{ background: 'var(--card-face)', border: highlight ? '1px solid var(--gold)' : '1px solid rgba(255,255,255,0.1)' }}>
              <span className="text-[8px] font-bold leading-none" style={{ color: sc }}>{c.rank}</span>
              <span className="text-[8px] leading-none" style={{ color: sc }}>{SUIT_SYMBOLS[c.suit]}</span>
            </div>
          );
        })}
      </div>
      <div className="min-w-0">
        <span className={`text-xs font-semibold ${highlight ? 'text-[var(--gold)]' : 'text-[#e8e0d4]'}`}>{name}</span>
        <p className="text-[10px] text-[var(--gold-dim)] leading-tight">{desc}</p>
      </div>
    </div>
  );
}

/* ── Tutorial steps ────────────────────────────────────── */

interface TutorialStep {
  id: string;
  /** Title shown in the tooltip */
  title: string;
  /** Body text (JSX) */
  body: React.ReactNode;
  /** CSS selector to highlight (null = centered overlay) */
  highlight?: string | null;
  /** Tooltip position relative to highlight */
  position?: 'top' | 'bottom' | 'left' | 'right';
  /** If true, requires user interaction instead of "Next" button */
  interactive?: boolean;
  /** Which UI section to show in the game mockup */
  visibleSections: ('players' | 'cards' | 'turn' | 'currentCall' | 'actions' | 'handSelector' | 'callHistory' | 'result')[];
  /** Game state to display */
  gameState?: {
    currentPlayerId?: string;
    roundPhase?: RoundPhase;
    currentHand?: HandCall | null;
    turnHistory?: TurnEntry[];
  };
}

/* ── Quick Tutorial (5 steps) — core game loop ────────── */

const QUICK_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Bull \'Em!',
    body: (
      <>
        <p className="text-sm text-[#e8e0d4] mb-2">
          Bull &apos;Em is a bluffing card game — claim poker hands exist across
          <strong className="text-[var(--gold)]"> all players&apos; combined cards</strong>.
          Bluff or call out bluffs!
        </p>
        <div className="glass p-2.5 rounded-lg mb-2" style={{ border: '1px solid var(--danger)' }}>
          <p className="text-[10px] uppercase tracking-widest text-[var(--danger)] font-semibold mb-1.5">Key Rule</p>
          <div className="space-y-2">
            <HandExample rank={4} name="Flush" cards={[{rank:'2',suit:'hearts'},{rank:'5',suit:'hearts'},{rank:'8',suit:'hearts'}]} desc="All same suit — ranked LOWER here!" highlight />
            <div className="text-center text-[var(--danger)] text-xs font-bold">&#9650; is LOWER than &#9660;</div>
            <HandExample rank={5} name="Three of a Kind" cards={[{rank:'9',suit:'spades'},{rank:'9',suit:'hearts'},{rank:'9',suit:'diamonds'}]} desc="Three cards of the same rank — beats Flush!" />
          </div>
        </div>
        <p className="text-xs text-[var(--gold-dim)]">
          This is different from standard poker — don&apos;t forget it!
        </p>
      </>
    ),
    visibleSections: [],
  },
  {
    id: 'deal-and-turn',
    title: 'Your Cards & Turn',
    body: (
      <>
        <p className="text-sm text-[#e8e0d4] mb-2">
          Each player starts with <strong className="text-[var(--gold)]">1 card</strong>. You can only see your own.
          You have the <strong>7 of Hearts</strong> — the bot&apos;s card is hidden.
        </p>
        <p className="text-sm text-[#e8e0d4]">
          It&apos;s your turn — <strong className="text-[var(--gold)]">call a poker hand</strong> you
          claim exists across all players&apos; combined cards. Try selecting any hand and tap <strong>&ldquo;Call&rdquo;</strong>!
        </p>
      </>
    ),
    highlight: '[data-tutorial="hand-selector"]',
    position: 'top',
    interactive: true,
    visibleSections: ['players', 'cards', 'turn', 'handSelector'],
    gameState: { currentPlayerId: MY_ID, roundPhase: RoundPhase.CALLING, currentHand: null, turnHistory: [] },
  },
  {
    id: 'bot-raises',
    title: 'The Bot Raises!',
    body: (
      <>
        <p className="text-sm text-[#e8e0d4] mb-2">
          {BOT_NAME} <strong className="text-[var(--gold)]">raised</strong> — claiming an even higher hand:
          &ldquo;Three 9s&rdquo;. Each call must beat the previous one.
        </p>
        <p className="text-sm text-[#e8e0d4]">
          Three 9s with only 2 cards in play? That&apos;s impossible!
        </p>
      </>
    ),
    highlight: '[data-tutorial="current-call"]',
    position: 'bottom',
    visibleSections: ['players', 'cards', 'turn', 'currentCall', 'callHistory'],
    gameState: {
      currentPlayerId: MY_ID,
      roundPhase: RoundPhase.CALLING,
      currentHand: { type: HandType.THREE_OF_A_KIND, rank: '9' },
      turnHistory: [
        { playerId: BOT_ID, playerName: BOT_NAME, action: TurnAction.CALL, hand: { type: HandType.THREE_OF_A_KIND, rank: '9' }, timestamp: Date.now() },
      ],
    },
  },
  {
    id: 'call-bull',
    title: 'Call BULL!',
    body: (
      <>
        <p className="text-sm text-[#e8e0d4] mb-2">
          You can <strong className="text-[var(--danger)]">call BULL</strong> (you don&apos;t believe the hand exists)
          or <strong className="text-[var(--gold)]">Raise</strong> (call something even higher).
        </p>
        <p className="text-sm text-[#e8e0d4]">
          Tap <strong className="text-[var(--danger)]">BULL!</strong> to challenge the bot&apos;s bluff.
        </p>
      </>
    ),
    highlight: '[data-tutorial="actions"]',
    position: 'top',
    interactive: true,
    visibleSections: ['players', 'cards', 'turn', 'currentCall', 'actions', 'callHistory'],
    gameState: {
      currentPlayerId: MY_ID,
      roundPhase: RoundPhase.CALLING,
      currentHand: { type: HandType.THREE_OF_A_KIND, rank: '9' },
      turnHistory: [
        { playerId: BOT_ID, playerName: BOT_NAME, action: TurnAction.CALL, hand: { type: HandType.THREE_OF_A_KIND, rank: '9' }, timestamp: Date.now() },
      ],
    },
  },
  {
    id: 'reveal-done',
    title: 'You Got \'Em!',
    body: (
      <>
        <p className="text-sm text-[#e8e0d4] mb-2">
          Cards are revealed — <strong className="text-[var(--danger)]">Three 9s</strong> was fake!
          The bot bluffed and gets <strong>+1 card</strong> as penalty.
        </p>
        <p className="text-sm text-[#e8e0d4] mb-2">
          Exceed the max card limit and you&apos;re <strong>eliminated</strong>.
          Last player standing <strong className="text-[var(--gold)]">wins</strong>!
        </p>
        <p className="text-sm text-[#e8e0d4]">
          That&apos;s the core loop: <strong>Call → Raise → Bull → Reveal</strong>.
          Ready to play?
        </p>
      </>
    ),
    visibleSections: ['players', 'cards', 'result'],
  },
];

/* ── Advanced Rules (optional deep-dive) ──────────────── */

const ADVANCED_STEPS: TutorialStep[] = [
  {
    id: 'true-explain',
    title: 'The TRUE Action',
    body: (
      <>
        <p className="text-sm text-[#e8e0d4] mb-2">
          Once someone calls bull, the next player can also call <strong className="text-[var(--info)]">TRUE</strong> — meaning
          they <em>believe</em> the hand exists.
        </p>
        <p className="text-sm text-[#e8e0d4] mb-2">
          <strong>If the hand is real:</strong> bull callers get +1 card, true callers are safe.
        </p>
        <p className="text-sm text-[#e8e0d4]">
          <strong>If the hand is fake:</strong> true callers get +1 card, bull callers are safe.
        </p>
      </>
    ),
    visibleSections: [],
  },
  {
    id: 'rankings-low',
    title: 'Low Hands',
    body: (
      <>
        <div className="space-y-2.5">
          <HandExample rank={1} name="High Card" cards={[{rank:'K',suit:'spades'}]} desc="Just the highest single card." />
          <HandExample rank={2} name="Pair" cards={[{rank:'7',suit:'hearts'},{rank:'7',suit:'spades'}]} desc="Two cards of the same rank." />
          <HandExample rank={3} name="Two Pair" cards={[{rank:'J',suit:'spades'},{rank:'J',suit:'hearts'},{rank:'4',suit:'diamonds'},{rank:'4',suit:'clubs'}]} desc="Two different pairs." />
        </div>
      </>
    ),
    visibleSections: [],
  },
  {
    id: 'rankings-surprise',
    title: 'The Big Surprise!',
    body: (
      <>
        <p className="text-sm text-[#e8e0d4] mb-2">
          In standard poker, a flush beats three of a kind. But in Bull &apos;Em:
        </p>
        <div className="glass p-2.5 rounded-lg mb-2" style={{ border: '1px solid var(--danger)' }}>
          <div className="space-y-2">
            <HandExample rank={4} name="Flush" cards={[{rank:'2',suit:'hearts'},{rank:'5',suit:'hearts'},{rank:'8',suit:'hearts'}]} desc="All same suit — ranked LOWER here!" highlight />
            <div className="text-center text-[var(--danger)] text-xs font-bold">&#9650; is LOWER than &#9660;</div>
            <HandExample rank={5} name="Three of a Kind" cards={[{rank:'9',suit:'spades'},{rank:'9',suit:'hearts'},{rank:'9',suit:'diamonds'}]} desc="Three cards of the same rank." />
          </div>
        </div>
        <p className="text-xs text-[var(--gold-dim)]">
          This is the most common mistake new players make — remember it!
        </p>
      </>
    ),
    visibleSections: [],
  },
  {
    id: 'rankings-high',
    title: 'High Hands',
    body: (
      <>
        <div className="space-y-2.5">
          <HandExample rank={6} name="Straight" cards={[{rank:'5',suit:'clubs'},{rank:'6',suit:'hearts'},{rank:'7',suit:'spades'},{rank:'8',suit:'diamonds'},{rank:'9',suit:'clubs'}]} desc="Five consecutive ranks, any suits." />
          <HandExample rank={7} name="Full House" cards={[{rank:'Q',suit:'spades'},{rank:'Q',suit:'hearts'},{rank:'Q',suit:'diamonds'},{rank:'3',suit:'clubs'},{rank:'3',suit:'hearts'}]} desc="Three of one rank + pair of another." />
          <HandExample rank={8} name="Four of a Kind" cards={[{rank:'2',suit:'spades'},{rank:'2',suit:'hearts'},{rank:'2',suit:'diamonds'},{rank:'2',suit:'clubs'}]} desc="All four suits of one rank." />
        </div>
      </>
    ),
    visibleSections: [],
  },
  {
    id: 'rankings-top',
    title: 'The Best Hands',
    body: (
      <>
        <div className="space-y-2.5">
          <HandExample rank={9} name="Straight Flush" cards={[{rank:'5',suit:'spades'},{rank:'6',suit:'spades'},{rank:'7',suit:'spades'},{rank:'8',suit:'spades'},{rank:'9',suit:'spades'}]} desc="A straight, all in the same suit." />
          <HandExample rank={10} name="Royal Flush" cards={[{rank:'10',suit:'diamonds'},{rank:'J',suit:'diamonds'},{rank:'Q',suit:'diamonds'},{rank:'K',suit:'diamonds'},{rank:'A',suit:'diamonds'}]} desc="10 through Ace, all same suit. Unbeatable!" highlight />
        </div>
        <p className="text-xs text-[var(--gold-dim)] mt-2">
          Remember: you&apos;re claiming these hands exist across <strong>everyone&apos;s</strong> combined cards!
        </p>
      </>
    ),
    visibleSections: [],
  },
  {
    id: 'rankings-quiz',
    title: 'Quick Check!',
    body: (
      <>
        <p className="text-sm text-[#e8e0d4] mb-3">
          Which hand is <strong className="text-[var(--gold)]">higher</strong> in Bull &apos;Em?
        </p>
        <div className="space-y-2" data-tutorial-quiz="rankings">
          {/* Quiz options are rendered dynamically by the component based on quizAnswer state */}
        </div>
      </>
    ),
    interactive: true,
    visibleSections: [],
  },
  {
    id: 'rankings-cheatsheet',
    title: 'Ranking Cheat Sheet',
    body: (
      <>
        <p className="text-[10px] text-[var(--gold-dim)] mb-2 uppercase tracking-widest font-semibold">Low to High</p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
          <span className="text-[var(--gold-dim)]">1. High Card</span>
          <span className="text-[var(--gold-dim)]">6. Straight</span>
          <span className="text-[var(--gold-dim)]">2. Pair</span>
          <span className="text-[var(--gold-dim)]">7. Full House</span>
          <span className="text-[var(--gold-dim)]">3. Two Pair</span>
          <span className="text-[var(--gold-dim)]">8. Four of a Kind</span>
          <span className="text-[var(--danger)] font-semibold">4. Flush</span>
          <span className="text-[var(--gold-dim)]">9. Straight Flush</span>
          <span className="text-[var(--danger)] font-semibold">5. Three of a Kind</span>
          <span className="text-[var(--gold)]">10. Royal Flush</span>
        </div>
        <p className="text-[10px] text-[var(--danger)] mt-2 font-semibold">
          Remember: Flush (#4) is LOWER than Three of a Kind (#5)!
        </p>
      </>
    ),
    visibleSections: [],
  },
  {
    id: 'elimination',
    title: 'Elimination & Winning',
    body: (
      <>
        <p className="text-sm text-[#e8e0d4] mb-2">
          Players who guess wrong get <strong className="text-[var(--danger)]">+1 card</strong> next round.
          When a player exceeds the max card limit, they&apos;re <strong>eliminated</strong>.
        </p>
        <p className="text-sm text-[#e8e0d4]">
          The last player standing <strong className="text-[var(--gold)]">wins</strong>!
        </p>
      </>
    ),
    visibleSections: [],
  },
];

/* ── Component ─────────────────────────────────────────── */

export function TutorialPage() {
  const navigate = useNavigate();
  const { play } = useSound();
  const [section, setSection] = useState<'quick' | 'advanced'>('quick');
  const [stepIndex, setStepIndex] = useState(0);
  const [playerHand, setPlayerHand] = useState<HandCall | null>(null);
  const [playerHandValid, setPlayerHandValid] = useState(false);
  const [quizAnswer, setQuizAnswer] = useState<'flush' | 'three' | null>(null);

  const steps = section === 'quick' ? QUICK_STEPS : ADVANCED_STEPS;
  const step = steps[stepIndex]!;
  const isLastStep = stepIndex === steps.length - 1;
  const isQuickDone = section === 'quick' && isLastStep;

  // Persist step progress
  useEffect(() => {
    // Offset advanced steps so they don't collide with quick step progress
    const globalIndex = section === 'quick' ? stepIndex : QUICK_STEPS.length + stepIndex;
    setTutorialStepReached(globalIndex);
  }, [stepIndex, section]);

  const advance = useCallback(() => {
    if (isLastStep) return;
    play('uiClick');
    setStepIndex(prev => prev + 1);
  }, [isLastStep, play]);

  const enterAdvanced = useCallback(() => {
    play('uiClick');
    setSection('advanced');
    setStepIndex(0);
    setQuizAnswer(null);
  }, [play]);

  const goBack = useCallback(() => {
    if (stepIndex === 0) return;
    play('uiSoft');
    setStepIndex(prev => prev - 1);
    // Reset quiz state when navigating back to allow re-answering
    setQuizAnswer(null);
  }, [stepIndex, play]);

  const handleHandChange = useCallback((hand: HandCall | null, valid: boolean) => {
    setPlayerHand(hand);
    setPlayerHandValid(valid);
  }, []);

  const handleHandSubmit = useCallback((hand: HandCall) => {
    setPlayerHand(hand);
    play('callMade');
    // Advance to bot's response step
    setStepIndex(prev => prev + 1);
  }, [play]);

  const handleBull = useCallback(() => {
    play('bullCalled');
    // Advance to reveal step
    setStepIndex(prev => prev + 1);
  }, [play]);

  const handleQuizAnswer = useCallback((answer: 'flush' | 'three') => {
    setQuizAnswer(answer);
    if (answer === 'three') {
      play('callMade');
    } else {
      play('uiSoft');
    }
  }, [play]);

  // Build turn history for display
  const turnHistory = step.gameState?.turnHistory ?? [];
  // If player has called a hand, add it to history
  const displayHistory = useMemo(() => {
    if (step.id === 'bot-raises' && playerHand) {
      return [
        { playerId: MY_ID, playerName: MY_NAME, action: TurnAction.CALL, hand: playerHand, timestamp: Date.now() - 1000 },
        ...turnHistory,
      ];
    }
    if (step.id === 'call-bull' && playerHand) {
      return [
        { playerId: MY_ID, playerName: MY_NAME, action: TurnAction.CALL, hand: playerHand, timestamp: Date.now() - 2000 },
        ...turnHistory,
      ];
    }
    return turnHistory;
  }, [step.id, playerHand, turnHistory]);

  const show = (section: string) => step.visibleSections.includes(section as typeof step.visibleSections[number]);

  /* ── Reusable pieces ──────────────────────────────── */

  /** Progress bar (shared between portrait & landscape) */
  const progressBar = (
    <div className="flex items-center gap-2 px-1 tutorial-progress">
      <span className="text-[10px] text-[var(--gold-dim)] font-semibold uppercase tracking-wider shrink-0">
        {section === 'quick' ? 'Quick Start' : 'Advanced'}
      </span>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.3)' }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${((stepIndex + 1) / steps.length) * 100}%`,
            background: 'var(--gold)',
          }}
        />
      </div>
      <span className="text-[10px] text-[var(--gold-dim)] font-mono tabular-nums">
        {stepIndex + 1}/{steps.length}
      </span>
    </div>
  );

  /** Game mockup area */
  const gameMockup = (
    <div className="flex flex-col gap-2 tutorial-mockup">
      {/* Players */}
      {show('players') && (
        <div className="animate-fade-in" data-tutorial="players">
          <div className="flex gap-2 justify-center flex-wrap">
            {PLAYERS.map(p => {
              const isCurrent = step.gameState?.currentPlayerId === p.id;
              const isMe = p.id === MY_ID;
              return (
                <div
                  key={p.id}
                  className={`glass px-3 py-2 rounded-lg flex items-center gap-2 text-sm transition-all ${
                    isCurrent ? 'border-[var(--gold)] animate-pulse-glow' : ''
                  } ${isMe ? 'glass-me' : ''}`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                    isMe ? 'bg-sky-700' : 'bg-amber-700'
                  }`}>
                    {p.isBot ? '\u2699' : p.name.charAt(0)}
                  </div>
                  <div>
                    <span className={`font-semibold ${isMe ? 'text-[var(--info)]' : ''}`}>
                      {p.name}
                    </span>
                    <span className="text-[var(--gold-dim)] text-xs ml-1">
                      {p.cardCount} card{p.cardCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Turn indicator */}
      {show('turn') && step.gameState && (
        <div className="animate-fade-in" data-tutorial="turn-indicator">
          <div className="text-center py-1.5 px-3 rounded-lg glass-me animate-pulse-glow-blue border-[var(--info)]">
            <p className="font-display text-base font-bold text-[var(--info)]">
              Your Turn
              <span className="text-xs font-normal ml-2 text-[rgba(74,144,217,0.7)]">
                {step.gameState.currentHand ? 'Bull or Raise' : 'Call a Hand'}
              </span>
            </p>
          </div>
        </div>
      )}

      {/* Current call display */}
      {show('currentCall') && step.gameState?.currentHand && (
        <div className="animate-slide-up" data-tutorial="current-call">
          <div className="glass-raised px-3 py-1.5 flex items-baseline">
            <div className="w-1/4 min-w-0 shrink-0">
              <span className="text-[9px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold">
                Current Call
              </span>
            </div>
            <div className="flex-1 min-w-0 text-center">
              <span className="font-display font-bold text-[var(--gold)] whitespace-nowrap" style={{ fontSize: 'clamp(0.85rem, 3.86vw, 1rem)' }}>
                {handToString(step.gameState.currentHand)}
              </span>
            </div>
            <div className="w-1/4 min-w-0 shrink-0 text-right">
              <span className="text-[9px] text-[var(--gold-dim)] opacity-70">
                {BOT_NAME}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* My cards */}
      {show('cards') && (
        <div className="animate-fade-in" data-tutorial="my-cards">
          <HandDisplay cards={MY_CARDS} large />
        </div>
      )}

      {/* Call history */}
      {show('callHistory') && displayHistory.length > 0 && (
        <div className="animate-fade-in glass p-2 rounded-lg">
          <p className="text-[9px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-1">
            Turn History
          </p>
          <div className="space-y-1">
            {displayHistory.map((entry, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className={`font-semibold ${entry.playerId === MY_ID ? 'text-[var(--info)]' : 'text-[var(--gold)]'}`}>
                  {entry.playerName}
                </span>
                <span className="text-[var(--gold-dim)]">
                  {entry.action === TurnAction.CALL && entry.hand
                    ? `calls ${handToString(entry.hand)}`
                    : entry.action === TurnAction.BULL
                      ? 'calls BULL!'
                      : entry.action}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action buttons (bull/raise) */}
      {show('actions') && (
        <div className="animate-slide-up" data-tutorial="actions">
          <div className="flex justify-between items-start">
            <div className="flex gap-2 justify-start" data-action-buttons>
              <button
                onClick={handleBull}
                className="btn-danger px-4 py-2 text-base font-bold min-w-[7rem]"
              >
                BULL!
              </button>
            </div>
            <button
              className="btn-ghost border-[var(--gold-dim)] px-6 py-2 text-base font-bold animate-pulse-glow min-w-[9rem] opacity-50 cursor-not-allowed"
              title="Raise is disabled in this tutorial step"
            >
              Raise
            </button>
          </div>
        </div>
      )}

      {/* Hand selector */}
      {show('handSelector') && (
        <div className="animate-fade-in" data-tutorial="hand-selector">
          <HandSelector
            currentHand={null}
            onSubmit={handleHandSubmit}
            onHandChange={handleHandChange}
          />
        </div>
      )}

      {/* Reveal / result display */}
      {show('result') && (
        <div className="animate-fade-in glass-raised p-4 rounded-xl">
          <div className="text-center mb-3">
            <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-1">
              Called Hand
            </p>
            <p className="font-display text-lg font-bold text-[var(--gold)]">
              Three 9s
            </p>
          </div>

          <div className="text-center mb-3">
            <p className="text-[10px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-2">
              All Cards
            </p>
            <div className="flex justify-center gap-2">
              <div className="text-center">
                <p className="text-[10px] text-[var(--info)] mb-1">{MY_NAME}</p>
                <CardDisplay card={MY_CARDS[0]!} />
              </div>
              <div className="text-center">
                <p className="text-[10px] text-[var(--gold)] mb-1">{BOT_NAME}</p>
                <CardDisplay card={BOT_CARDS[0]!} />
              </div>
            </div>
          </div>

          <div className="text-center">
            <p className="font-display text-base font-bold text-[var(--danger)]">
              Hand is FAKE!
            </p>
            <p className="text-xs text-[var(--gold-dim)] mt-1">
              No 9s in play. {BOT_NAME} bluffed and gets +1 card.
            </p>
          </div>
        </div>
      )}
    </div>
  );

  /** Tutorial text panel (instructions, quiz, navigation) */
  const tutorialText = (
    <div className="tutorial-text-panel flex flex-col gap-3">
      {/* Tutorial overlay (for non-interactive steps with highlights) */}
      {!step.interactive && step.highlight && (
        <TutorialOverlay
          targetSelector={step.highlight}
          position={step.position}
          visible
          onBackdropTap={advance}
        >
          <h3 className="font-display text-base font-bold text-[var(--gold)] mb-2">
            {step.title}
          </h3>
          {step.body}
          <div className="flex justify-between items-center mt-3">
            {stepIndex > 0 && (
              <button onClick={goBack} className="text-xs text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors">
                Back
              </button>
            )}
            <button onClick={advance} className="btn-gold px-4 py-1.5 text-sm font-semibold ml-auto">
              {isLastStep ? 'Finish' : 'Next'}
            </button>
          </div>
        </TutorialOverlay>
      )}

      {/* Inline tooltip for interactive steps or steps without highlights */}
      {(step.interactive || !step.highlight) && (
        <div className="glass-raised p-4 rounded-xl animate-fade-in" style={{ border: '1px solid var(--gold-dim)' }}>
          <h3 className="font-display text-base font-bold text-[var(--gold)] mb-2">
            {step.title}
          </h3>
          {step.id === 'rankings-quiz' ? (
            /* ── Ranking quiz ─────────────────────────────── */
            <>
              <p className="text-sm text-[#e8e0d4] mb-3">
                Which hand is <strong className="text-[var(--gold)]">higher</strong> in Bull &apos;Em?
              </p>
              <div className="space-y-2">
                <button
                  onClick={() => handleQuizAnswer('flush')}
                  disabled={quizAnswer !== null}
                  className={`w-full text-left glass px-3 py-2 rounded-lg transition-all text-sm ${
                    quizAnswer === 'flush'
                      ? 'border-[var(--danger)] bg-[rgba(220,38,38,0.15)]'
                      : quizAnswer === 'three'
                        ? 'opacity-50'
                        : 'hover:border-[var(--gold)]'
                  }`}
                  style={{ border: quizAnswer === 'flush' ? '1px solid var(--danger)' : '1px solid transparent' }}
                >
                  <span className="font-semibold text-[#e8e0d4]">Flush</span>
                  <span className="text-[var(--gold-dim)] text-xs ml-2">(all same suit)</span>
                  {quizAnswer === 'flush' && (
                    <span className="text-[var(--danger)] text-xs ml-2 font-semibold">Not quite!</span>
                  )}
                </button>
                <button
                  onClick={() => handleQuizAnswer('three')}
                  disabled={quizAnswer !== null}
                  className={`w-full text-left glass px-3 py-2 rounded-lg transition-all text-sm ${
                    quizAnswer === 'three'
                      ? 'border-[var(--gold)] bg-[rgba(212,168,67,0.15)]'
                      : quizAnswer === 'flush'
                        ? 'opacity-50'
                        : 'hover:border-[var(--gold)]'
                  }`}
                  style={{ border: quizAnswer === 'three' ? '1px solid var(--gold)' : '1px solid transparent' }}
                >
                  <span className="font-semibold text-[#e8e0d4]">Three of a Kind</span>
                  <span className="text-[var(--gold-dim)] text-xs ml-2">(three same rank)</span>
                  {quizAnswer === 'three' && (
                    <span className="text-[var(--gold)] text-xs ml-2 font-semibold">Correct!</span>
                  )}
                </button>
              </div>
              {quizAnswer && (
                <div className="mt-3 animate-fade-in">
                  {quizAnswer === 'three' ? (
                    <p className="text-xs text-[var(--gold)]">
                      That&apos;s right! In Bull &apos;Em, Three of a Kind (#5) beats Flush (#4).
                      This is different from standard poker!
                    </p>
                  ) : (
                    <p className="text-xs text-[var(--danger)]">
                      In standard poker, yes — but in Bull &apos;Em, Flush (#4) is LOWER than
                      Three of a Kind (#5). This is the #1 mistake new players make!
                    </p>
                  )}
                  <div className="flex justify-between items-center mt-3">
                    {stepIndex > 0 && (
                      <button onClick={goBack} className="text-xs text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors">
                        Back
                      </button>
                    )}
                    <button onClick={() => { setQuizAnswer(null); advance(); }} className="btn-gold px-4 py-1.5 text-sm font-semibold ml-auto">
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* ── Standard step body ──────────────────────── */
            <>
              {step.body}
              {!step.interactive && (
                <div className="flex justify-between items-center mt-3">
                  {stepIndex > 0 && (
                    <button onClick={goBack} className="text-xs text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors">
                      Back
                    </button>
                  )}
                  {isQuickDone || (section === 'advanced' && isLastStep) ? (
                    <div className="flex flex-col gap-2 ml-auto w-full">
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => { markTutorialCompleted(); clearTutorialStepProgress(); play('uiSoft'); navigate('/local'); }}
                          className="btn-ghost px-4 py-1.5 text-sm font-semibold"
                        >
                          Play Offline
                        </button>
                        <button
                          onClick={() => { markTutorialCompleted(); clearTutorialStepProgress(); play('uiSoft'); navigate('/', { state: { mode: 'online' } }); }}
                          className="btn-gold px-4 py-1.5 text-sm font-semibold"
                        >
                          Play Online
                        </button>
                      </div>
                      {isQuickDone && (
                        <button
                          onClick={enterAdvanced}
                          className="text-xs text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors text-right"
                        >
                          Learn Advanced Rules →
                        </button>
                      )}
                    </div>
                  ) : (
                    <button onClick={advance} className="btn-gold px-4 py-1.5 text-sm font-semibold ml-auto">
                      Next
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Skip / Back to home */}
      <div className="flex justify-center gap-4">
        {!(isQuickDone || (section === 'advanced' && isLastStep)) && (
          <button
            onClick={() => { clearTutorialStepProgress(); navigate('/'); }}
            className="text-xs text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors"
          >
            Skip Tutorial
          </button>
        )}
        {(isQuickDone || (section === 'advanced' && isLastStep)) && (
          <button
            onClick={() => { markTutorialCompleted(); clearTutorialStepProgress(); navigate('/'); }}
            className="text-xs text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors"
          >
            Back to Home
          </button>
        )}
      </div>
    </div>
  );

  const hasGameMockup = step.visibleSections.length > 0;

  return (
    <Layout>
      <div className="tutorial-content pb-8 relative">
        {progressBar}

        {/* Portrait layout: vertical stack (default) */}
        <div className="tutorial-portrait flex flex-col gap-3">
          {gameMockup}
          {tutorialText}
        </div>

        {/* Landscape layout: two-panel side by side */}
        <div className={`tutorial-landscape ${hasGameMockup ? 'tutorial-landscape-split' : 'tutorial-landscape-centered'}`}>
          {hasGameMockup && (
            <div className="tutorial-landscape-left">
              {gameMockup}
            </div>
          )}
          <div className="tutorial-landscape-right">
            {tutorialText}
          </div>
        </div>
      </div>
    </Layout>
  );
}
