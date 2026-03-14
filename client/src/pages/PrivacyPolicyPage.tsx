import { useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout.js';

export function PrivacyPolicyPage() {
  const navigate = useNavigate();

  return (
    <Layout>
      <div className="flex flex-col gap-4 pb-8">
        <section className="glass-raised p-4">
          <h1 className="font-display text-xl font-bold text-[var(--gold)] mb-1">Privacy Policy</h1>
          <p className="text-xs text-[var(--gold-dim)]">Effective date: March 14, 2026</p>
        </section>

        <section className="glass p-4">
          <h2 className="font-display text-lg font-bold text-[var(--gold)] mb-2">Overview</h2>
          <p className="text-sm text-[#e8e0d4]">
            Bull &rsquo;Em (&ldquo;the App&rdquo;) is a multiplayer card game. This policy explains what data
            we collect, how we use it, and your choices. We are committed to protecting your privacy and
            only collect what is necessary to provide the game experience.
          </p>
        </section>

        <section className="glass p-4">
          <h2 className="font-display text-lg font-bold text-[var(--gold)] mb-2">Data We Collect</h2>

          <h3 className="text-sm font-semibold text-[var(--gold-dim)] mt-3 mb-1">Account Information</h3>
          <ul className="space-y-1 text-sm text-[#e8e0d4] list-disc list-inside">
            <li>Username and display name you choose</li>
            <li>Email address (if you sign up with email)</li>
            <li>Password (stored as a secure hash &mdash; we never store or see your actual password)</li>
            <li>OAuth identifier (if you sign in with Google or Apple &mdash; we do not receive your password from these providers)</li>
            <li>Profile avatar selection and optional profile photo</li>
          </ul>

          <h3 className="text-sm font-semibold text-[var(--gold-dim)] mt-3 mb-1">Game Data</h3>
          <ul className="space-y-1 text-sm text-[#e8e0d4] list-disc list-inside">
            <li>Game history: results, scores, rankings, and round data for replay functionality</li>
            <li>Ranked play ratings and match history</li>
            <li>In-game statistics (e.g., bulls called, successful bluffs)</li>
          </ul>

          <h3 className="text-sm font-semibold text-[var(--gold-dim)] mt-3 mb-1">Technical Data</h3>
          <ul className="space-y-1 text-sm text-[#e8e0d4] list-disc list-inside">
            <li>Push notification subscription data (if you opt in to notifications)</li>
            <li>Aggregate analytics events (e.g., games started, games completed) to improve the game</li>
            <li>Error reports via Sentry (no personally identifiable information is included)</li>
          </ul>

          <h3 className="text-sm font-semibold text-[var(--gold-dim)] mt-3 mb-1">Local Browser Storage</h3>
          <ul className="space-y-1 text-sm text-[#e8e0d4] list-disc list-inside">
            <li>Tutorial progress and UI preference flags (stored locally on your device, not sent to our servers)</li>
            <li>Recently played opponents list (stored locally for convenience)</li>
          </ul>
        </section>

        <section className="glass p-4">
          <h2 className="font-display text-lg font-bold text-[var(--gold)] mb-2">How We Use Your Data</h2>
          <ul className="space-y-1 text-sm text-[#e8e0d4] list-disc list-inside">
            <li>To provide and operate the multiplayer game experience</li>
            <li>To authenticate your account and maintain your session</li>
            <li>To track game history, replays, rankings, and leaderboards</li>
            <li>To send push notifications you have opted into (e.g., game invites)</li>
            <li>To send transactional emails (e.g., password reset requests via Resend)</li>
            <li>To monitor and fix errors and improve game stability</li>
          </ul>
        </section>

        <section className="glass p-4">
          <h2 className="font-display text-lg font-bold text-[var(--gold)] mb-2">Data Sharing</h2>
          <p className="text-sm text-[#e8e0d4]">
            We do not sell your personal data. We share data only with the following service providers
            as necessary to operate the App:
          </p>
          <ul className="space-y-1 text-sm text-[#e8e0d4] list-disc list-inside mt-2">
            <li><strong>Google &amp; Apple</strong> &mdash; OAuth sign-in (only if you choose these sign-in methods)</li>
            <li><strong>Sentry</strong> &mdash; error monitoring (no PII collected)</li>
            <li><strong>Resend</strong> &mdash; transactional email delivery (password resets only)</li>
            <li><strong>Tigris</strong> &mdash; profile photo storage</li>
            <li><strong>Fly.io</strong> &mdash; application hosting</li>
          </ul>
        </section>

        <section className="glass p-4">
          <h2 className="font-display text-lg font-bold text-[var(--gold)] mb-2">Data Retention</h2>
          <p className="text-sm text-[#e8e0d4]">
            We retain your account and game data for as long as your account is active. If you wish to
            delete your account and associated data, please contact us at the email below. Password reset
            tokens expire after 1 hour and are automatically deleted.
          </p>
        </section>

        <section className="glass p-4">
          <h2 className="font-display text-lg font-bold text-[var(--gold)] mb-2">Security</h2>
          <p className="text-sm text-[#e8e0d4]">
            We take reasonable measures to protect your data, including: passwords are hashed with bcrypt,
            all connections use HTTPS, game logic is server-authoritative to prevent cheating, and we
            validate all user input server-side. No system is 100% secure, but we take data protection
            seriously.
          </p>
        </section>

        <section className="glass p-4">
          <h2 className="font-display text-lg font-bold text-[var(--gold)] mb-2">Your Choices</h2>
          <ul className="space-y-1 text-sm text-[#e8e0d4] list-disc list-inside">
            <li>You can play as a guest without creating an account</li>
            <li>Push notifications are opt-in &mdash; you can revoke them in your browser settings</li>
            <li>You can request deletion of your account and data by contacting us</li>
          </ul>
        </section>

        <section className="glass p-4">
          <h2 className="font-display text-lg font-bold text-[var(--gold)] mb-2">Children&rsquo;s Privacy</h2>
          <p className="text-sm text-[#e8e0d4]">
            The App is not directed at children under 13. We do not knowingly collect personal information
            from children under 13. If you believe a child has provided us with personal data, please
            contact us so we can delete it.
          </p>
        </section>

        <section className="glass p-4">
          <h2 className="font-display text-lg font-bold text-[var(--gold)] mb-2">Changes to This Policy</h2>
          <p className="text-sm text-[#e8e0d4]">
            We may update this policy from time to time. Changes will be posted on this page with an
            updated effective date. Continued use of the App after changes constitutes acceptance of the
            updated policy.
          </p>
        </section>

        <section className="glass p-4">
          <h2 className="font-display text-lg font-bold text-[var(--gold)] mb-2">Contact</h2>
          <p className="text-sm text-[#e8e0d4]">
            If you have questions about this privacy policy or want to request data deletion, please
            contact us at <a href="mailto:privacy@bullem.app" className="text-[var(--gold)] underline">privacy@bullem.app</a>.
          </p>
        </section>

        <button
          onClick={() => navigate(-1)}
          className="btn-primary self-center mt-2"
        >
          Go Back
        </button>
      </div>
    </Layout>
  );
}
