# Bull 'Em — Feature Roadmap

> Updated 2026-03-08 from a full codebase audit. Replaces all previous roadmaps.
>
> Items are prioritized by user impact and grouped by effort level.
> Status: **Done** = shipped, **Partial** = foundation exists but incomplete, **Not started** = new.

---

## What's Already Shipped

The codebase is production-grade across many dimensions. These do **not** need work:

| Area | Details |
|---|---|
| **Game engine** | Pure state machine, 17+ test files, all hand types, edge cases, regressions |
| **Security** | Server-authoritative, cards never leaked, input validated, reconnect tokens rotated |
| **Bot AI** | Three difficulty levels (normal/hard/impossible) with cross-round opponent memory, 9 personalities × 9 levels |
| **Mobile UX** | Wheel pickers, touch targets (44px+), responsive layouts, no hover-only interactions |
| **Sound + Haptics** | Contextual audio with volume control, lazy loading; Vibration API with per-event patterns |
| **Matchmaking** | Redis-backed queue with ELO rating, bot backfill, heads-up + multiplayer modes |
| **Leaderboard** | Paginated, time-filtered (all-time/month/week), per-mode, current-user rank card, rank tiers |
| **Player accounts** | JWT auth, bcrypt hashing, email + Google/Apple OAuth, avatar selection, profile with stats |
| **Advanced stats** | Rating history chart (recharts), hand-type breakdown, per-opponent records, daily session summary |
| **Replays** | Server-side persistence, browsable gallery (ReplaysPage), step-through viewer with auto-play + keyboard |
| **Spectator mode** | Full support with configurable card visibility, chat, and emoji reactions |
| **Chat** | Collapsible panel, rate-limited, sanitized, max 200 chars, unread badge |
| **Emoji reactions** | Floating emoji reactions during gameplay with rate limiting |
| **Quick Play** | One-tap button on home page that launches local game with bots instantly |
| **Quick Draw chips** | Suggested raises above the hand selector for faster gameplay |
| **Win confetti** | Gold-themed canvas-confetti burst on results screen |
| **Elimination toasts** | Toast notifications when players are eliminated mid-game |
| **QR code invites** | QR code generation in lobby for easy room sharing |
| **Recent players** | Tracks and displays recently played-with players on home page |
| **Interactive tutorial** | Scripted walkthrough teaching core game mechanics |
| **Home page deck demo** | Interactive deck with shuffle animation, 5-card draw, hand classification + probability |
| **Best-of series** | 1v1 Bo1/Bo3/Bo5 support, ranked 1v1 always Bo3 |
| **Bot calibration** | Continuous round-robin calibration pipeline with convergence detection |
| **Scale infra** | Redis adapter for Socket.io, Redis session persistence (24h TTL), Redis rate limiting |
| **Observability** | Pino structured logging, Sentry integration, Prometheus metrics, health checks |
| **E2E tests** | Socket.io integration tests for lobby and game flows |
| **CI/CD** | Parallel tests, auto-merge to develop, Docker validation, gated production deploys |
| **Push notifications** | PushManager foundation with Web Push API (subscription management implemented) |
| **Admin panel** | User management, analytics, bot management endpoints |

---

## 1. Quick Wins (Small effort, noticeable improvement)

### 1a. App Shell Viewport Lock — "Feel Like an App"
**What:** Lock the viewport so the app shell never scrolls — only internal content panels scroll. Disable pull-to-refresh, rubber-band scrolling, and address bar hide/show on mobile browsers. Add `position: fixed; overflow: hidden; height: 100dvh` to html/body, use inner scroll containers for content panels.
**Why:** Every time the page bounces or the URL bar appears/disappears during gameplay, it breaks immersion. This is the single cheapest change that most improves perceived quality. The game should feel like an app, not a website — Supercell games own the entire viewport.
**Touches:** `client/src/styles/index.css` (html/body viewport lock), `client/src/components/Layout.tsx` (inner scroll container), `client/src/pages/GamePage.tsx` + `LocalGamePage.tsx` (internal scroll panels), `index.html` (`<meta name="viewport">` with `interactive-widget=resizes-visual`)
**Complexity:** Small
**Dependencies:** None

### 1b. Keyboard Shortcuts in Game
**What:** Add keyboard shortcuts for common actions: `B` for Bull, `T` for True, `R` to open raise/hand selector, `Esc` to close modals. Show shortcut hints on desktop (hover tooltips on action buttons).
**Why:** Desktop players want fast inputs. The replay page already has keyboard controls — extend the pattern to gameplay. Makes the game feel more responsive for power users.
**Touches:** `client/src/pages/GamePage.tsx`, `client/src/pages/LocalGamePage.tsx`, `client/src/components/ActionButtons.tsx`
**Complexity:** Small
**Dependencies:** None

### 1c. Bot Personality Flavor Text
**What:** Give each bot a visible "personality" — show flavor text alongside their actions in the call history (e.g., Bot Brady: *"I wouldn't bet on that..."* when calling bull). Map existing bot names to personality templates with 3–5 phrases each for bull/true/raise/bluff. Bot profiles with `flavor_text` JSONB already exist in the database and `shared/src/botProfiles.ts`.
**Why:** Playing against bots feels mechanical. Personality text makes local games more entertaining and gives the impression of smarter opponents. Zero server changes needed — flavor text data already exists.
**Touches:** `client/src/components/CallHistory.tsx`, `client/src/pages/LocalGamePage.tsx`, `shared/src/botProfiles.ts` (already has flavor text structure)
**Complexity:** Small
**Dependencies:** None

### 1d. Card Deal Animation
**What:** Animate cards being dealt from a central deck to each player at round start. Cards fly out in sequence with a slight arc and land in the player's hand area, using CSS keyframes or FLIP technique.
**Why:** Round transitions currently show a countdown then cards appear. A deal animation adds casino-quality feel and gives players a moment to mentally reset between rounds.
**Touches:** `client/src/pages/GamePage.tsx`, `client/src/pages/LocalGamePage.tsx`, `client/src/components/HandDisplay.tsx`, CSS animations
**Complexity:** Small–Medium
**Dependencies:** None

### 1e. Improved Elimination Experience
**What:** Upgrade the current elimination toast to a brief dramatic overlay — skull icon or "X" animation over the eliminated player's avatar in the player list, with a 1.5s fade. Add an elimination sound effect.
**Why:** The current toast is functional but easy to miss. Eliminations are the most dramatic moments in the game — they deserve more visual weight.
**Touches:** `client/src/pages/GamePage.tsx`, `client/src/pages/LocalGamePage.tsx`, `client/src/components/PlayerList.tsx`, sound assets
**Complexity:** Small
**Dependencies:** None

### 1f. Better Sound Design
**What:** Audit and improve all game sounds: add distinct sounds for card deal, card flip on reveal, bull call (buzzer/horn), true call (bell/chime), raise (chip slide), elimination (dramatic thud), round win (fanfare), game win (victory music). Add ambient table sounds. Ensure all sounds are short (<1s), compressed, and lazy-loaded. Add per-category volume sliders (SFX, music, ambient).
**Why:** Sound is 50% of game feel. Current sounds are functional but not memorable. Distinctive audio feedback for each action makes gameplay feel more tactile and responsive. Premium sounds are what make players associate "that sound" with Bull 'Em.
**Touches:** `client/src/assets/sounds/` (new audio files), `client/src/hooks/useSound.ts` / `soundEngine.ts` (per-category volume), `client/src/components/VolumeControl.tsx` (granular controls)
**Complexity:** Small–Medium
**Dependencies:** None

---

## 2. Core Features (Meaningful additions that make the product more complete)

### 2a. Home Page Deck Draw Minigame
**What:** Expand the existing home page deck demo into a standalone minigame. Players draw 5 cards and bet (with in-game currency or points, not real money) on what hand type they'll get. Payouts scale by hand rarity. Include a daily free draw and track lifetime stats (best hand, total draws, biggest win). The minigame is accessible without an account.
**Why:** The deck draw interaction already exists and players love tapping it. Adding stakes (even play-money) creates a reason to return to the home page between games. It's a viral loop — "I just drew a straight flush!" is inherently shareable.
**Touches:** `client/src/pages/HomePage.tsx` (expand deck section into minigame panel), new `client/src/components/DeckDrawGame.tsx`, `shared/src/types.ts` (minigame types), localStorage for guest stats, `server/src/db/` for account-linked stats
**Complexity:** Medium
**Dependencies:** None (account integration optional but enhances it)

### 2b. In-Game Match Statistics & Data Visualization
**What:** Add a real-time stats panel accessible during gameplay (swipe-up or tab in sidebar) showing: bluff success rate this game, bull/true accuracy by player, hand type distribution of all calls this game, and a round-by-round card count timeline. On the results page, show a full post-game breakdown with animated charts (bar charts for accuracy, donut chart for call distribution, timeline for eliminations).
**Why:** The advanced stats on the profile page are great for long-term trends, but players want in-the-moment data too. "Who's been bluffing the most?" is a question players ask every game. Visual stats make the game feel more strategic and give spectators interesting information.
**Touches:** new `client/src/components/InGameStats.tsx`, `client/src/pages/ResultsPage.tsx` + `LocalResultsPage.tsx` (enhanced post-game charts), `shared/src/types.ts` (in-game stat aggregation types), uses recharts (already a dependency)
**Complexity:** Medium
**Dependencies:** None

### 2c. Configurable Deck Variants
**What:** Allow the host to select deck variants: standard 52-card, no face cards (32-card), or jokers included (54-card, jokers are wild). Display the active deck variant in the lobby and during gameplay.
**Why:** Adds replayability and variety. Different deck sizes change the meta — smaller decks make high hands more common, jokers add chaos. Keeps experienced players engaged.
**Touches:** `shared/src/engine/Deck.ts`, `shared/src/types.ts` (deck variant setting), `shared/src/engine/HandChecker.ts` (joker handling), `server/src/socket/lobbyHandlers.ts`, `client/src/pages/LobbyPage.tsx`, `client/src/pages/LocalLobbyPage.tsx`
**Complexity:** Medium–Large
**Dependencies:** None, but requires extensive testing of hand evaluation with variant decks

### 2d. Custom Player Colors in Game
**What:** Let players pick a color (from a curated palette of 12 options) when joining a room. Display as a colored ring around their avatar in the player list and turn indicator. Persist in localStorage.
**Why:** With 6–12 players, the avatar icons alone aren't distinctive enough at a glance. Custom colors help players identify each other instantly, especially on small screens.
**Touches:** `shared/src/types.ts` (player color field), `client/src/components/PlayerList.tsx`, `client/src/pages/LobbyPage.tsx`, `server/src/socket/lobbyHandlers.ts` (validate)
**Complexity:** Small–Medium
**Dependencies:** None

### 2e. Tournament Mode
**What:** Structured tournament brackets for 8/16/32 players. Single-elimination or Swiss-style. Auto-created rooms for each match, bracket visualization with real-time updates, and final standings with prizes/badges.
**Why:** Tournaments are the ultimate competitive format. They create events that players plan around and invite friends to. Tournament results drive leaderboard engagement and social sharing.
**Touches:** new `server/src/tournament/` module (bracket engine, match scheduling, result tracking), `shared/src/types.ts` (tournament types), new `client/src/pages/TournamentPage.tsx` + `TournamentBracketPage.tsx`, `server/src/db/` (tournament tables)
**Complexity:** Large
**Dependencies:** None (best-of series already shipped)

### 2f. Social Features — Friends List & Invites
**What:** Persistent friends list (add by username), online status indicators, direct invite-to-game, and notification when a friend creates a room. Build on the existing recent players feature.
**Why:** Bull 'Em is a social game — the core loop is playing with friends. Currently, coordination happens outside the app (text messages, Discord). Bringing social features in-app increases retention and session frequency.
**Touches:** `server/src/db/` (friends table, friend requests), `shared/src/types.ts` (friend events), new `client/src/pages/FriendsPage.tsx`, `client/src/components/RecentPlayers.tsx` (upgrade with add-friend button)
**Complexity:** Medium–Large
**Dependencies:** Player accounts (done)

### 2g. Bitcoin Lightning Integration (Money Games)
**What:** Integrate Bitcoin Lightning Network payments to enable real-money wagering. Players deposit sats via Lightning invoice to an in-game wallet, join money tables with fixed buy-ins, and winnings are paid out instantly via Lightning. Requires: custodial wallet service (LNbits, Strike API, or Voltage), deposit/withdrawal UI, buy-in escrow logic, regulatory compliance check by jurisdiction, and opt-in only (never default).
**Why:** Bluffing games are natural fits for stakes — poker wouldn't exist without money. Lightning enables instant, low-fee, borderless micropayments that work for $0.10 or $100 buy-ins. This is the monetization path that aligns incentives with players (house takes a small rake, not ads or loot boxes).
**Touches:** new `server/src/lightning/` (LN provider integration, wallet management, escrow), `shared/src/types.ts` (money game types, buy-in levels), `server/src/rooms/Room.ts` (escrow lifecycle), `client/src/pages/` (deposit/withdraw UI, money table lobby), `server/src/db/` (wallet balances, transaction history)
**Complexity:** Large
**Dependencies:** Player accounts (done), Lightning payment infrastructure (4e), legal review for target jurisdictions

---

## 3. Polish (UX improvements, animations, edge case handling)

### 3a. Aesthetic UI Overhaul
**What:** Elevate the visual design to feel premium and app-like. Key improvements: (1) Glassmorphism refinement — consistent blur intensity, subtle gradient overlays, glow effects on interactive elements. (2) Micro-animations — button press scaling, page transitions (slide/fade), card hover effects. (3) Typography — introduce a display font for headers (e.g., Playfair Display or similar serif) alongside the existing sans-serif body text. (4) Dark theme refinement — richer backgrounds (subtle texture/noise overlay instead of flat black), warm color temperature. (5) Loading states — skeleton screens everywhere (leaderboard already has this, extend to all pages).
**Why:** The current UI is clean and functional but doesn't make players go "wow." Premium visuals drive word-of-mouth sharing ("look at this game") and justify money game stakes. The goal is "this looks like it cost $500K to build."
**Touches:** `client/src/styles/index.css` (global theme refinements), all component files (micro-animations), `client/src/components/Layout.tsx` (page transitions), font assets
**Complexity:** Medium (spread across many files but each change is small)
**Dependencies:** 1a (viewport lock) should ship first to establish the app shell

### 3b. Better Reveal Overlay with Card Table
**What:** Redesign the round-end reveal to show a virtual table view: all players' cards laid out in a circle/arc formation, with the called hand highlighted if it exists. Animate cards flipping from face-down to face-up in sequence.
**Why:** The current reveal overlay is functional but text-heavy. A visual card table makes the "moment of truth" more dramatic and easier to parse at a glance. This is the single most important animation in the game.
**Touches:** `client/src/components/RevealOverlay.tsx`, CSS for card layout + flip animations
**Complexity:** Medium
**Dependencies:** None

### 3c. Landscape Mode & Round Card Table Layout
**What:** Full landscape mode polish: (1) Round card table layout where players sit around a circular/oval virtual table with their cards visible. (2) Collapsible sidebar for call history/stats. (3) Mini-map of player positions. (4) Ensure hand selector modal doesn't obscure game state. (5) Test on actual tablets (iPad, Android tablets). This is the "poker table" view that landscape mode deserves.
**Why:** The landscape layout exists but was developed after the portrait layout and feels like portrait squeezed sideways. Tablet users are a significant audience for card games. A proper round-table layout is the most natural way to present a card game in landscape.
**Touches:** `client/src/pages/GamePage.tsx`, `client/src/pages/LocalGamePage.tsx`, CSS media queries, potentially new `client/src/components/TableLayout.tsx`
**Complexity:** Medium
**Dependencies:** 1a (viewport lock)

### 3d. Onboarding Improvements
**What:** Extend the tutorial to cover all hand types (currently it's a scripted 2-player demo). Add contextual tooltips in the first real game (e.g., "This is the hand selector — pick a hand higher than the current call"). Track whether the user has completed the tutorial in localStorage. Show a "first game" mode with gentler bot difficulty.
**Why:** New players don't understand the custom hand rankings (flush lower than three of a kind is counterintuitive). Better onboarding reduces churn in the critical first game. Every player who bounces during their first game is a lost referral.
**Touches:** `client/src/pages/TutorialPage.tsx`, `client/src/components/TutorialOverlay.tsx`, `client/src/components/GameTooltips.tsx`, localStorage flag
**Complexity:** Medium
**Dependencies:** None

### 3e. Richer Post-Game Results
**What:** Upgrade the results page with: animated player ranking reveal (3rd place → 2nd → 1st with fanfare), "Game MVPs" section (most daring bluff, best detective, longest streak), and a share card (auto-generated image summarizing the game outcome for social sharing).
**Why:** The results page is where players decide "that was fun, let's play again" or "meh." Making it feel like a celebration drives rematch rate. The share card drives organic growth.
**Touches:** `client/src/pages/ResultsPage.tsx`, `client/src/pages/LocalResultsPage.tsx`, `client/src/components/GameStatsDisplay.tsx`, canvas/image generation for share cards
**Complexity:** Medium
**Dependencies:** None

### 3f. Accessibility Audit & Fixes
**What:** Full a11y pass: proper ARIA labels on all interactive elements, focus management for keyboard navigation, color contrast meeting WCAG AA, screen reader announcements for game state changes (turn, bull calls, results), reduced-motion media query for all animations.
**Why:** Accessibility is a quality bar, not a feature. Important for reaching wider audiences and meeting app store / platform requirements for future native apps.
**Touches:** All component files in `client/src/components/`, `client/src/pages/`, CSS color variables
**Complexity:** Medium
**Dependencies:** None

---

## 4. Infrastructure (Not user-facing, but unblocks future growth)

### 4a. Database Connection Resilience
**What:** Add connection retry logic with exponential backoff to the PostgreSQL pool. Handle transient failures gracefully (log + continue without persistence rather than crashing). The health check already reports DB status — this makes the actual pool resilient.
**Why:** On Fly.io, database connections drop during deployments or network blips. The current pool creates a connection but doesn't handle transient failures. The `TODO(scale)` comment about read replicas also lives in `pool.ts`.
**Touches:** `server/src/db/pool.ts`, `server/src/db/index.ts`
**Complexity:** Small–Medium
**Dependencies:** None

### 4b. Read Replicas for Leaderboard Queries
**What:** Add a separate read-only database pool for leaderboard and stats queries. Currently all queries go through the same pool, and leaderboard queries (especially with time filters) can be expensive. The `TODO(scale)` marker is already in `pool.ts:73`.
**Why:** When leaderboards get popular (thousands of page views), the read queries shouldn't compete with game result writes. Fly.io Postgres supports read replicas natively.
**Touches:** `server/src/db/pool.ts` (new read pool), `server/src/db/leaderboard.ts` (use read pool), `server/src/db/advancedStats.ts` (use read pool)
**Complexity:** Small–Medium
**Dependencies:** 4a (connection resilience)

### 4c. Multi-Region Deployment
**What:** Expand from single-region ("arn") to multi-region on Fly.io. Add a second region (e.g., "iad" for US East). Configure Redis as primary/replica and Postgres with read replicas. Socket.io Redis adapter already handles cross-instance communication.
**Why:** Players outside Northern Europe experience 100–200ms latency. A US region cuts that to <50ms for North American players. The architecture is already designed for this — it's mostly infrastructure configuration.
**Touches:** `fly.toml` (add regions), Redis and Postgres provisioning, `server/src/index.ts` (region-aware health check)
**Complexity:** Medium
**Dependencies:** 4a (DB resilience), 4b (read replicas)

### 4d. CI Test Sharding
**What:** Add Vitest's `--shard` flag to split the shared package tests (largest suite at 17+ files) across multiple CI runners. Keep total CI time under 3 minutes as the test suite grows.
**Why:** CI time directly impacts development velocity. When CI takes 5+ minutes, developers context-switch and lose flow.
**Touches:** `.github/workflows/ci.yml`, `shared/vitest.config.ts`
**Complexity:** Small
**Dependencies:** None

### 4e. Lightning Payment Infrastructure
**What:** Build the payment backend needed for money games: LN node connection (LNbits/Voltage), invoice generation, payment verification, wallet balance tracking, withdrawal processing, transaction logging with audit trail. All behind a feature flag.
**Why:** This is the prerequisite for 2g (Bitcoin Lightning money games). Separating the infra from the game integration allows the payment system to be tested and hardened independently.
**Touches:** new `server/src/lightning/` module, `server/src/db/migrations/` (wallet + transaction tables), `.env` (LN provider credentials)
**Complexity:** Large
**Dependencies:** Player accounts (done)

### 4f. Analytics, Telemetry & Game Balance Database
**What:** Build a comprehensive analytics pipeline: (1) Track key gameplay metrics for balance tuning — win rate by starting position, hand type call frequency vs actual occurrence, average game duration by player count, bluff success rate by hand type, bot difficulty win rates. (2) Store in PostgreSQL analytics tables with efficient time-series queries. (3) Expose via admin dashboard with charts. (4) Feed into data visualizations for players (see 2b). The `server/src/analytics/track.ts` already has the event tracking foundation — this extends it with aggregation and querying.
**Why:** As the player base grows, data-driven balance decisions become critical. If starting player always wins 60%, the rotation needs adjustment. If bots on "hard" lose 80%, they need tuning. This also provides the data layer for player-facing statistics features (2b).
**Touches:** `server/src/analytics/track.ts` (expand event tracking), `server/src/db/` (analytics tables), `server/src/index.ts` (admin endpoints, behind auth)
**Complexity:** Medium
**Dependencies:** None

### 4g. Project Email & Communication Setup
**What:** Set up a project email (e.g., hello@bullem.fly.dev or bullem@protonmail.com) for: password reset emails (currently email-based reset exists but needs SMTP), user support, app store contact, and legal notices. Configure SMTP transport in the server.
**Why:** Password reset already generates tokens but needs email delivery. App store submissions require a support email. User feedback needs a channel.
**Touches:** `server/src/auth/routes.ts` (connect email transport to password reset), new `server/src/email/` module, `.env` (SMTP credentials)
**Complexity:** Small–Medium
**Dependencies:** None

### 4h. Push Subscriptions Persistence
**What:** Move push notification subscriptions from in-memory Map to Redis/PostgreSQL. The `TODO(scale)` marker is already in `server/src/push/PushManager.ts:18`. Current design loses subscriptions on restart and doesn't work across instances.
**Why:** Push notifications only work reliably if subscriptions survive server restarts. This is a prerequisite for any notification-driven engagement features (friend invites, tournament reminders, turn notifications).
**Touches:** `server/src/push/PushManager.ts`, `server/src/db/migrations/` (push_subscriptions table)
**Complexity:** Small–Medium
**Dependencies:** None

---

## 5. Future Vision (Longer-term, high-impact)

### 5a. Native Mobile Apps
**What:** Wrap the web app in Capacitor (or React Native Web) for iOS and Android app store distribution. Add native features: push notifications via APNs/FCM, haptic engine (instead of Vibration API), app icon badge for turn notifications, and offline mode for local games.
**Why:** App store presence is the #1 growth channel for mobile games. Web apps have friction (bookmarking, no home screen icon by default, Safari limitations). A native wrapper with the existing codebase is low effort for high distribution gain.
**Touches:** New `mobile/` directory with Capacitor config, `client/` (minor tweaks for native bridges), app store assets
**Complexity:** Medium–Large
**Dependencies:** 1a (viewport lock), 3a (aesthetic polish)

### 5b. Seasonal Ranked Play
**What:** Time-limited ranked seasons (e.g., monthly) with rating resets, season rewards (cosmetic badges/avatars), and end-of-season leaderboard snapshots. Placement matches at the start of each season.
**Why:** Seasonal resets keep the competitive ladder fresh and give players a reason to keep climbing. Without seasons, once you reach a high rank there's no reason to keep playing ranked.
**Touches:** `server/src/matchmaking/` (season logic), `server/src/db/` (season history), `client/src/pages/LeaderboardPage.tsx` (season selector), `client/src/components/RankBadge.tsx` (season badges)
**Complexity:** Medium
**Dependencies:** Matchmaking (done), leaderboard (done)

### 5c. Interesting Match Statistics & Data Visualizations
**What:** Go beyond basic stats into rich, engaging data visualizations: (1) Heat maps of bluff patterns over time (when in a game do players bluff most?). (2) Win probability graphs during a match (like chess evaluation bars). (3) "Rivalry" stats between frequent opponents. (4) Career trajectory charts showing rating, win rate, and play style evolution over time. (5) Shareable stat cards for social media. Use D3.js or recharts (already installed) for interactive charts.
**Why:** Stats pages are where hardcore players spend time between games. Beautiful data visualizations make players feel their progression is meaningful and provide content worth sharing ("Look at my bluff heat map").
**Touches:** `client/src/components/AdvancedStats.tsx` (extend), new `client/src/components/DataViz/` directory, `server/src/db/advancedStats.ts` (new query endpoints)
**Complexity:** Medium–Large
**Dependencies:** 4f (analytics database provides the data)

---

## Existing TODO(scale) Markers in Code

| Location | What | When to Address |
|---|---|---|
| `server/src/index.ts:57` | CORS origins hardcoded for single domain | When serving from multiple domains/CDN |
| `server/src/index.ts:152` | Single Redis client for adapter + rate limiting | At very high scale, separate clients to avoid contention |
| `server/src/index.ts:695` | `getOnlinePlayerNames()` single-instance only | Multi-instance deployment — needs Redis/shared store |
| `server/src/db/pool.ts:73` | No read replicas configured | When leaderboard/stats queries load increases (→ 4b) |
| `server/src/db/leaderboard.ts:14` | In-memory leaderboard cache (TTL-based) | Replace with Redis cache when Redis is primary cache layer |
| `server/src/rateLimit.ts:124` | In-memory rate limiting (single instance) | Multi-instance deployment — must set REDIS_URL |
| `server/src/push/PushManager.ts:18` | Push subscriptions in-memory Map | Move to Redis/PostgreSQL (→ 4h) |
| `server/src/metrics.ts:8` | Single-instance Prometheus metrics | Multi-instance — need aggregation across instances |
| `server/src/analytics/track.ts:16–17` | Matchmaking analytics events stubbed | When matchmaking queue analytics needed (→ 4f) |
| `server/src/auth/routes.ts:418` | Profile photos stored as base64 in DB | Migrate to S3/R2 when photo payload size increases |

---

## Suggested Sequencing

Items within each batch can be run as **parallel Claude Code sessions** without logical conflicts. Each batch depends only on prior batches being complete.

### Batch 1 — "Feel Like an App"
*Goal: Make the existing game feel polished and native-quality. All items are independent — no shared files.*

| Session | Item | What | Complexity | Key Files |
|---|---|---|---|---|
| A | **1a** | Viewport lock / app shell | Small | `index.css`, `Layout.tsx`, game pages (CSS only) |
| B | **1b** | Keyboard shortcuts | Small | `GamePage.tsx`, `LocalGamePage.tsx`, `ActionButtons.tsx` (JS event handlers only) |
| C | **1c** | Bot personality flavor text | Small | `CallHistory.tsx`, `botProfiles.ts` |
| D | **1e** | Better elimination experience | Small | `PlayerList.tsx`, sound assets |
| E | **4a** | DB connection resilience | Small–Medium | `server/src/db/pool.ts`, `server/src/db/index.ts` |
| F | **4g** | Project email setup | Small–Medium | `server/src/auth/routes.ts` (email transport), new `server/src/email/` |
| G | **4h** | Push subscriptions persistence | Small–Medium | `server/src/push/PushManager.ts`, new migration |

### Batch 2 — "Casino Quality"
*Goal: Visual and audio polish that makes the game feel premium. Depends on Batch 1 for viewport lock (1a).*

| Session | Item | What | Complexity | Key Files |
|---|---|---|---|---|
| A | **1d** | Card deal animation | Small–Medium | `HandDisplay.tsx`, game pages (animation logic) |
| B | **1f** | Better sound design | Small–Medium | `assets/sounds/`, `useSound.ts`, `VolumeControl.tsx` |
| C | **3a** | Aesthetic UI overhaul | Medium | `index.css`, component styles, `Layout.tsx` |
| D | **3b** | Better reveal overlay / card table | Medium | `RevealOverlay.tsx`, CSS |
| E | **4d** | CI test sharding | Small | `.github/workflows/ci.yml` |

### Batch 3 — "Worth Coming Back"
*Goal: Features that create daily engagement and competitive depth.*

| Session | Item | What | Complexity | Key Files |
|---|---|---|---|---|
| A | **2a** | Deck draw minigame (home page) | Medium | `HomePage.tsx`, new `DeckDrawGame.tsx` |
| B | **2b** | In-game match statistics | Medium | New `InGameStats.tsx`, `ResultsPage.tsx`, `LocalResultsPage.tsx` |
| C | **2d** | Custom player colors | Small–Medium | `types.ts` (one field), `PlayerList.tsx`, `LobbyPage.tsx` |
| D | **3c** | Landscape mode / round card table | Medium | Game pages (layout), CSS media queries |
| E | **3e** | Richer post-game results | Medium | `ResultsPage.tsx`, `LocalResultsPage.tsx`, `GameStatsDisplay.tsx` |
| F | **4b** | Read replicas for leaderboard | Small–Medium | `server/src/db/pool.ts`, `leaderboard.ts`, `advancedStats.ts` |

### Batch 4 — "Competitive & Social"
*Goal: Social infrastructure and competitive depth. Items touch different systems.*

| Session | Item | What | Complexity | Key Files |
|---|---|---|---|---|
| A | **2c** | Configurable deck variants | Medium–Large | `Deck.ts`, `HandChecker.ts`, `types.ts`, lobby pages |
| B | **2f** | Friends list & invites | Medium–Large | New friends DB table, new `FriendsPage.tsx`, socket events |
| C | **3d** | Onboarding improvements | Medium | `TutorialPage.tsx`, `TutorialOverlay.tsx`, `GameTooltips.tsx` |
| D | **4f** | Analytics & game balance telemetry | Medium | `server/src/analytics/track.ts`, DB tables, admin endpoints |
| E | **3f** | Accessibility audit | Medium | All components (ARIA labels, focus, contrast) |

### Batch 5 — "Money on the Table"
*Goal: Monetization infrastructure and Lightning integration.*

| Session | Item | What | Complexity | Key Files |
|---|---|---|---|---|
| A | **4e** | Lightning payment infrastructure | Large | New `server/src/lightning/`, wallet tables, `.env` |
| B | **5b** | Seasonal ranked play | Medium | `server/src/matchmaking/`, season tables, `LeaderboardPage.tsx` |
| C | **5c** | Rich data visualizations | Medium–Large | `AdvancedStats.tsx`, new `DataViz/` components |

### Batch 6 — "Go Wide"
*Goal: Distribution, money games, and organized play. Depends on Batch 5 for Lightning infra (4e).*

| Session | Item | What | Complexity | Key Files |
|---|---|---|---|---|
| A | **2g** | Bitcoin Lightning money games | Large | `server/src/lightning/`, room escrow, deposit/withdraw UI |
| B | **2e** | Tournament mode | Large | New `server/src/tournament/`, bracket pages |
| C | **4c** | Multi-region deployment | Medium | `fly.toml`, Redis/Postgres provisioning |

### Batch 7 — "App Store"
*Goal: Native distribution. Depends on prior batches for polish (3a) and viewport lock (1a).*

| Session | Item | What | Complexity | Key Files |
|---|---|---|---|---|
| A | **5a** | Native mobile apps (Capacitor) | Medium–Large | New `mobile/` directory, `client/` native bridges |

---

## Summary

| Category | Count | Items |
|---|---|---|
| **Quick Wins** | 6 | 1a–1f |
| **Core Features** | 7 | 2a–2g |
| **Polish** | 6 | 3a–3f |
| **Infrastructure** | 8 | 4a–4h |
| **Future Vision** | 3 | 5a–5c |
| **Total** | **30** | Across 7 batches |

The sequencing prioritizes **perception** (making the game feel premium) before **features** (adding new things to do) before **monetization** (Lightning integration) before **distribution** (app stores). Each batch builds on the prior one, and items within a batch are safe to develop in parallel.
