import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout.js';

export function HowToPlayPage() {
  const navigate = useNavigate();
  const [showFull, setShowFull] = useState(false);

  return (
    <Layout>
      <div className="flex flex-col gap-4 pb-8">

        {/* Quick Start */}
        <section className="glass-raised p-4">
          <h2 className="font-display text-lg font-bold text-[var(--gold)] mb-3">Quick Start</h2>
          <ol className="space-y-2 text-sm text-[#e8e0d4] list-decimal list-inside">
            <li>Everyone gets dealt cards. You can only see <strong>your own</strong>.</li>
            <li>On your turn, <strong>call a poker hand</strong> (e.g., "pair of 7s") &mdash; it must be higher than the last call.</li>
            <li>Don't believe it? Call <strong className="text-[var(--danger)]">Bull</strong>. Believe it? Call <strong className="text-[var(--info)]">True</strong>.</li>
            <li>The hand is checked against <strong>ALL players' cards combined</strong>.</li>
            <li>Wrong callers get <strong>+1 card</strong>. Too many cards = <strong>eliminated</strong>.</li>
            <li>Last player standing <strong>wins</strong>!</li>
          </ol>
        </section>

        {/* Expand/Collapse full rules */}
        <button
          onClick={() => setShowFull(!showFull)}
          className="text-sm text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors self-center flex items-center gap-1"
        >
          {showFull ? 'Hide' : 'Show'} full rules
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={`transition-transform ${showFull ? 'rotate-180' : ''}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {showFull && (
          <>
            {/* Card Dealing */}
            <section className="glass p-4 animate-fade-in">
              <h2 className="font-display text-lg font-bold text-[var(--gold)] mb-2">Card Dealing</h2>
              <ul className="space-y-1 text-sm text-[#e8e0d4]">
                <li>2&ndash;12 players, one standard 52-card deck.</li>
                <li>Round 1: each player gets <strong>1 card</strong>.</li>
                <li>You only see <strong>your own cards</strong>.</li>
                <li>Lose a round? You get <strong>+1 card</strong> next round.</li>
                <li>Max cards is configurable (1&ndash;5). Exceeding it = <strong>eliminated</strong>.</li>
              </ul>
            </section>

            {/* Hand Rankings */}
            <section className="glass p-4 animate-fade-in">
              <h2 className="font-display text-lg font-bold text-[var(--gold)] mb-2">Hand Rankings</h2>
              <p className="text-xs text-[var(--gold-dim)] mb-2">Lowest to highest &mdash; note: flush is <em>lower</em> than three of a kind!</p>
              <ol className="space-y-1 text-sm text-[#e8e0d4] list-decimal list-inside">
                <li><strong>High Card</strong> &mdash; e.g., "King high"</li>
                <li><strong>Pair</strong> &mdash; e.g., "pair of 7s"</li>
                <li><strong>Two Pair</strong> &mdash; e.g., "jacks and 4s"</li>
                <li><strong className="text-[var(--gold)]">Flush</strong> &mdash; e.g., "flush in hearts" <span className="text-[var(--gold-dim)] text-xs">(lower than three of a kind!)</span></li>
                <li><strong>Three of a Kind</strong> &mdash; e.g., "three 9s"</li>
                <li><strong>Straight</strong> &mdash; e.g., "5 through 9"</li>
                <li><strong>Full House</strong> &mdash; e.g., "queens over 3s"</li>
                <li><strong>Four of a Kind</strong> &mdash; e.g., "four 2s"</li>
                <li><strong>Straight Flush</strong> &mdash; e.g., "straight flush in spades, 5&ndash;9"</li>
                <li><strong>Royal Flush</strong> &mdash; e.g., "royal flush in diamonds"</li>
              </ol>
            </section>

            {/* Turn Flow */}
            <section className="glass p-4 animate-fade-in">
              <h2 className="font-display text-lg font-bold text-[var(--gold)] mb-2">Turn Flow</h2>
              <ol className="space-y-1.5 text-sm text-[#e8e0d4] list-decimal list-inside">
                <li><strong>First player</strong> calls any poker hand (e.g., "pair of 7s").</li>
                <li><strong>Next player</strong> can <strong>raise</strong> (call a higher hand) or call <strong className="text-[var(--danger)]">bull</strong>.</li>
                <li>Once someone calls bull, everyone else chooses: <strong>raise</strong>, <strong className="text-[var(--danger)]">bull</strong>, or <strong className="text-[var(--info)]">true</strong>.</li>
              </ol>
            </section>

            {/* Key Terms */}
            <section className="glass p-4 animate-fade-in">
              <h2 className="font-display text-lg font-bold text-[var(--gold)] mb-2">Key Terms</h2>
              <dl className="space-y-2 text-sm text-[#e8e0d4]">
                <div>
                  <dt className="font-bold text-[var(--gold)]">Call / Raise</dt>
                  <dd className="text-xs text-[var(--gold-dim)]">Name a poker hand (must be higher than the current call)</dd>
                </div>
                <div>
                  <dt className="font-bold text-[var(--danger)]">Bull</dt>
                  <dd className="text-xs text-[var(--gold-dim)]">"I don't believe that hand exists" &mdash; challenge the caller</dd>
                </div>
                <div>
                  <dt className="font-bold text-[var(--info)]">True</dt>
                  <dd className="text-xs text-[var(--gold-dim)]">"I believe it" &mdash; side with the caller (only available after someone calls bull)</dd>
                </div>
              </dl>
            </section>

            {/* Resolution */}
            <section className="glass p-4 animate-fade-in">
              <h2 className="font-display text-lg font-bold text-[var(--gold)] mb-2">Resolution</h2>
              <ul className="space-y-1 text-sm text-[#e8e0d4]">
                <li>All relevant cards are revealed.</li>
                <li>The called hand is checked against <strong>everyone's combined cards</strong>.</li>
                <li>Players who were <strong>wrong</strong> get +1 card next round.</li>
                <li>Players who were <strong>right</strong> keep their current hand size.</li>
              </ul>
            </section>

            {/* Last Chance */}
            <section className="glass p-4 animate-fade-in">
              <h2 className="font-display text-lg font-bold text-[var(--gold)] mb-2">Last Chance</h2>
              <p className="text-sm text-[#e8e0d4]">
                If <strong>everyone</strong> calls bull, the original caller gets one chance to <strong>raise</strong> their call.
                If they raise, the bull/true cycle restarts on the new call. If they pass, the round resolves.
              </p>
            </section>
          </>
        )}

        {/* Try interactive tutorial */}
        <button
          onClick={() => navigate('/tutorial')}
          className="btn-gold px-10 py-2 text-base mt-2 self-center"
        >
          Try Interactive Tutorial
        </button>

        {/* Back button */}
        <button
          onClick={() => navigate('/')}
          className="btn-ghost px-10 py-2 text-base self-center"
        >
          Back to Home
        </button>
      </div>
    </Layout>
  );
}
