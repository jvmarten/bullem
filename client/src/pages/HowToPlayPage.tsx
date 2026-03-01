import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout.js';

export function HowToPlayPage() {
  const navigate = useNavigate();

  return (
    <Layout>
      <div className="flex flex-col gap-4 pb-8">

        {/* Overview */}
        <section className="glass p-4">
          <h2 className="font-display text-lg font-bold text-[var(--gold)] mb-2">Overview</h2>
          <ul className="space-y-1 text-sm text-[#e8e0d4]">
            <li>2–9 players, one standard 52-card deck</li>
            <li>A bluffing game — call poker hands, raise, or call bull!</li>
            <li>Hands are checked against ALL players' combined cards</li>
            <li>Last player standing wins</li>
          </ul>
        </section>

        {/* Goal */}
        <section className="glass p-4">
          <h2 className="font-display text-lg font-bold text-[var(--gold)] mb-2">Goal</h2>
          <p className="text-sm text-[#e8e0d4]">
            Be the last player remaining. Players are eliminated when they accumulate too many cards.
          </p>
        </section>

        {/* Card Dealing */}
        <section className="glass p-4">
          <h2 className="font-display text-lg font-bold text-[var(--gold)] mb-2">Card Dealing</h2>
          <ul className="space-y-1 text-sm text-[#e8e0d4]">
            <li>Each player starts with <strong>1 card</strong></li>
            <li>You can see your own cards but NOT other players' cards</li>
            <li>Lose a round? You get <strong>+1 card</strong> next round</li>
            <li>Exceed the max card limit? You're <strong>eliminated</strong></li>
          </ul>
        </section>

        {/* Hand Rankings */}
        <section className="glass p-4">
          <h2 className="font-display text-lg font-bold text-[var(--gold)] mb-2">Hand Rankings</h2>
          <p className="text-xs text-[var(--gold-dim)] mb-2">Lowest to highest — note the custom order!</p>
          <ol className="space-y-1.5 text-sm text-[#e8e0d4] list-decimal list-inside">
            <li><strong>High Card</strong> — e.g., "King high"</li>
            <li><strong>Pair</strong> — e.g., "pair of 7s"</li>
            <li><strong>Two Pair</strong> — e.g., "jacks and 4s"</li>
            <li><strong>Three of a Kind</strong> — e.g., "three 9s"</li>
            <li><strong className="text-[var(--gold)]">Flush</strong> — e.g., "flush in hearts" <span className="text-[var(--gold-dim)] text-xs">(lower than straight!)</span></li>
            <li><strong>Straight</strong> — e.g., "5 through 9"</li>
            <li><strong>Full House</strong> — e.g., "queens over 3s"</li>
            <li><strong>Four of a Kind</strong> — e.g., "four 2s"</li>
            <li><strong>Straight Flush</strong> — e.g., "straight flush in spades, 5–9"</li>
          </ol>
        </section>

        {/* Turn Flow */}
        <section className="glass p-4">
          <h2 className="font-display text-lg font-bold text-[var(--gold)] mb-2">Turn Flow</h2>
          <ol className="space-y-1.5 text-sm text-[#e8e0d4] list-decimal list-inside">
            <li><strong>First player</strong> calls a poker hand (e.g., "pair of 7s")</li>
            <li><strong>Next player</strong> can <strong>raise</strong> (call a higher hand) or <strong>call bull</strong></li>
            <li>After someone calls bull, others choose: <strong>raise</strong>, <strong>bull</strong>, or <strong>true</strong></li>
          </ol>
        </section>

        {/* Key Terms */}
        <section className="glass p-4">
          <h2 className="font-display text-lg font-bold text-[var(--gold)] mb-2">Key Terms</h2>
          <dl className="space-y-2 text-sm text-[#e8e0d4]">
            <div>
              <dt className="font-bold text-[var(--gold)]">Call / Raise</dt>
              <dd className="text-xs text-[var(--gold-dim)]">Name a poker hand (must be higher than the current call)</dd>
            </div>
            <div>
              <dt className="font-bold text-[var(--danger)]">Bull</dt>
              <dd className="text-xs text-[var(--gold-dim)]">"I don't believe that hand exists" — challenge the caller</dd>
            </div>
            <div>
              <dt className="font-bold text-[var(--success)]">True</dt>
              <dd className="text-xs text-[var(--gold-dim)]">"I believe it" — side with the caller (only during bull phase)</dd>
            </div>
          </dl>
        </section>

        {/* Resolution */}
        <section className="glass p-4">
          <h2 className="font-display text-lg font-bold text-[var(--gold)] mb-2">Resolution</h2>
          <ul className="space-y-1 text-sm text-[#e8e0d4]">
            <li>All relevant cards are revealed</li>
            <li>The called hand is checked against everyone's combined cards</li>
            <li>Players who were <strong>wrong</strong> get +1 card next round</li>
            <li>Players who were <strong>right</strong> keep their current hand size</li>
          </ul>
        </section>

        {/* Last Chance */}
        <section className="glass p-4">
          <h2 className="font-display text-lg font-bold text-[var(--gold)] mb-2">Last Chance</h2>
          <p className="text-sm text-[#e8e0d4]">
            If <strong>everyone</strong> calls bull, the original caller gets one chance to <strong>raise</strong> their call. If they raise, the bull/true cycle restarts. If they pass, the round resolves.
          </p>
        </section>

        {/* Back button */}
        <button
          onClick={() => navigate('/')}
          className="btn-gold px-10 py-2 text-base mt-2 self-center"
        >
          Back to Home
        </button>
      </div>
    </Layout>
  );
}
