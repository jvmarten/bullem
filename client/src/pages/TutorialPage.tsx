import { useState, useCallback, useMemo } from 'react';
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

const STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Bull \'Em!',
    body: (
      <>
        <p className="text-sm text-[#e8e0d4] mb-2">
          Bull &apos;Em is a bluffing card game where you claim poker hands exist across
          <strong className="text-[var(--gold)]"> all players&apos; combined cards</strong>.
        </p>
        <p className="text-sm text-[#e8e0d4]">
          Let&apos;s play through a quick round so you can see how it works.
        </p>
      </>
    ),
    visibleSections: [],
  },
  {
    id: 'deal',
    title: 'Cards Are Dealt',
    body: (
      <>
        <p className="text-sm text-[#e8e0d4] mb-2">
          Each player starts with <strong className="text-[var(--gold)]">1 card</strong> in Round 1.
          You can only see your own card.
        </p>
        <p className="text-sm text-[#e8e0d4]">
          You have the <strong>7 of Hearts</strong>. The bot has a card too, but you can&apos;t see it.
        </p>
      </>
    ),
    highlight: '[data-tutorial="my-cards"]',
    position: 'top',
    visibleSections: ['players', 'cards'],
  },
  {
    id: 'players',
    title: 'Player List',
    body: (
      <p className="text-sm text-[#e8e0d4]">
        The player list shows everyone in the game, how many cards they have,
        and who&apos;s currently taking their turn (gold highlight).
      </p>
    ),
    highlight: '[data-tutorial="players"]',
    position: 'bottom',
    visibleSections: ['players', 'cards'],
  },
  {
    id: 'your-turn',
    title: 'Your Turn — Call a Hand',
    body: (
      <>
        <p className="text-sm text-[#e8e0d4] mb-2">
          It&apos;s your turn! You need to <strong className="text-[var(--gold)]">call a poker hand</strong> that
          you claim exists across all players&apos; combined cards.
        </p>
        <p className="text-sm text-[#e8e0d4]">
          You have a 7, so claiming &ldquo;Pair of 7s&rdquo; is a reasonable bluff — maybe the bot has a 7 too!
        </p>
      </>
    ),
    highlight: '[data-tutorial="turn-indicator"]',
    position: 'bottom',
    visibleSections: ['players', 'cards', 'turn'],
    gameState: { currentPlayerId: MY_ID, roundPhase: RoundPhase.CALLING, currentHand: null, turnHistory: [] },
  },
  {
    id: 'call-hand',
    title: 'Select Your Hand',
    body: (
      <>
        <p className="text-sm text-[#e8e0d4] mb-2">
          Use the <strong className="text-[var(--gold)]">hand selector</strong> to pick your call.
          The left wheel selects the hand type, the right wheel selects the rank.
        </p>
        <p className="text-sm text-[#e8e0d4]">
          Try selecting any hand and tap <strong>&ldquo;Call&rdquo;</strong> to submit it!
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
          {BOT_NAME} decided to <strong className="text-[var(--gold)]">raise</strong> — calling an even higher hand.
        </p>
        <p className="text-sm text-[#e8e0d4]">
          Each call must be <strong>higher</strong> than the previous one. The bot claimed
          &ldquo;Three 9s&rdquo; — that sounds suspicious with only 2 cards in play!
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
    id: 'bull-or-raise',
    title: 'Bull or Raise?',
    body: (
      <>
        <p className="text-sm text-[#e8e0d4] mb-2">
          Now you can <strong className="text-[var(--danger)]">call BULL</strong> (you don&apos;t believe the hand exists)
          or <strong className="text-[var(--gold)]">Raise</strong> (call an even higher hand).
        </p>
        <p className="text-sm text-[#e8e0d4]">
          Three 9s with only 2 cards? That&apos;s impossible! Tap <strong className="text-[var(--danger)]">BULL!</strong> to challenge.
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
    id: 'reveal',
    title: 'Cards Revealed!',
    body: (
      <>
        <p className="text-sm text-[#e8e0d4] mb-2">
          When bull is called, the relevant cards are <strong className="text-[var(--gold)]">revealed</strong>.
          The game checks if the called hand really exists across all players&apos; combined cards.
        </p>
        <p className="text-sm text-[#e8e0d4] mb-2">
          <strong className="text-[var(--danger)]">Three 9s</strong> — the combined cards are 7♥ and 7♠. No nines at all!
          The hand was <strong>fake</strong>.
        </p>
        <p className="text-sm text-[#e8e0d4]">
          Since you correctly called bull, the <strong>bot gets +1 card</strong> next round as a penalty.
        </p>
      </>
    ),
    visibleSections: ['players', 'cards', 'result'],
  },
  {
    id: 'true-explain',
    title: 'What About TRUE?',
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
    id: 'rankings',
    title: 'Hand Rankings',
    body: (
      <>
        <p className="text-sm text-[#e8e0d4] mb-1">
          Bull &apos;Em uses <strong className="text-[var(--gold)]">custom rankings</strong> — note that
          flush is <em>lower</em> than three of a kind!
        </p>
        <ol className="text-xs text-[#e8e0d4] space-y-0.5 list-decimal list-inside mt-2">
          <li>High Card</li>
          <li>Pair</li>
          <li>Two Pair</li>
          <li><strong className="text-[var(--gold)]">Flush</strong> <span className="text-[var(--gold-dim)]">(lower than 3-of-a-kind!)</span></li>
          <li>Three of a Kind</li>
          <li>Straight</li>
          <li>Full House</li>
          <li>Four of a Kind</li>
          <li>Straight Flush</li>
          <li>Royal Flush</li>
        </ol>
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
  {
    id: 'done',
    title: 'You\'re Ready!',
    body: (
      <p className="text-sm text-[#e8e0d4]">
        That&apos;s the core of Bull &apos;Em. Start a local game with bots to practice,
        or jump online and bluff your friends!
      </p>
    ),
    visibleSections: [],
  },
];

/* ── Component ─────────────────────────────────────────── */

export function TutorialPage() {
  const navigate = useNavigate();
  const { play } = useSound();
  const [stepIndex, setStepIndex] = useState(0);
  const [playerHand, setPlayerHand] = useState<HandCall | null>(null);
  const [playerHandValid, setPlayerHandValid] = useState(false);

  const step = STEPS[stepIndex]!;
  const isLastStep = stepIndex === STEPS.length - 1;

  const advance = useCallback(() => {
    if (isLastStep) return;
    play('uiClick');
    setStepIndex(prev => prev + 1);
  }, [isLastStep, play]);

  const goBack = useCallback(() => {
    if (stepIndex === 0) return;
    play('uiSoft');
    setStepIndex(prev => prev - 1);
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
    if (step.id === 'bull-or-raise' && playerHand) {
      return [
        { playerId: MY_ID, playerName: MY_NAME, action: TurnAction.CALL, hand: playerHand, timestamp: Date.now() - 2000 },
        ...turnHistory,
      ];
    }
    return turnHistory;
  }, [step.id, playerHand, turnHistory]);

  const show = (section: string) => step.visibleSections.includes(section as typeof step.visibleSections[number]);

  return (
    <Layout>
      <div className="flex flex-col gap-3 pb-8 relative">
        {/* Progress bar */}
        <div className="flex items-center gap-2 px-1">
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(0,0,0,0.3)' }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${((stepIndex + 1) / STEPS.length) * 100}%`,
                background: 'var(--gold)',
              }}
            />
          </div>
          <span className="text-[10px] text-[var(--gold-dim)] font-mono tabular-nums">
            {stepIndex + 1}/{STEPS.length}
          </span>
        </div>

        {/* Game mockup area */}
        <div className="flex flex-col gap-2 min-h-[280px]">
          {/* Players */}
          {show('players') && (
            <div className="animate-fade-in" data-tutorial="players">
              <div className="flex gap-2 justify-center">
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
                  <span className="font-display text-base font-bold text-[var(--gold)] break-words">
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
            {step.body}
            {!step.interactive && (
              <div className="flex justify-between items-center mt-3">
                {stepIndex > 0 && (
                  <button onClick={goBack} className="text-xs text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors">
                    Back
                  </button>
                )}
                {isLastStep ? (
                  <div className="flex gap-2 ml-auto">
                    <button
                      onClick={() => { play('uiSoft'); navigate('/local'); }}
                      className="btn-ghost px-4 py-1.5 text-sm font-semibold"
                    >
                      Play Offline
                    </button>
                    <button
                      onClick={() => { play('uiSoft'); navigate('/', { state: { mode: 'online' } }); }}
                      className="btn-gold px-4 py-1.5 text-sm font-semibold"
                    >
                      Play Online
                    </button>
                  </div>
                ) : (
                  <button onClick={advance} className="btn-gold px-4 py-1.5 text-sm font-semibold ml-auto">
                    Next
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Skip / Back to home */}
        <div className="flex justify-center gap-4">
          {!isLastStep && (
            <button
              onClick={() => navigate('/')}
              className="text-xs text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors"
            >
              Skip Tutorial
            </button>
          )}
          {isLastStep && (
            <button
              onClick={() => navigate('/')}
              className="text-xs text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors"
            >
              Back to Home
            </button>
          )}
        </div>
      </div>
    </Layout>
  );
}
