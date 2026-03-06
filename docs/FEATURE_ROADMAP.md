# Bull 'Em — Feature Roadmap

> Updated 2026-03-06 from a full codebase audit. Replaces all previous roadmaps.
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
| **Bot AI** | Three difficulty levels (normal/hard/impossible) with cross-round opponent memory |
| **Mobile UX** | Wheel pickers, touch targets (44px+), responsive layouts, no hover-only interactions |
| **Sound + Haptics** | Contextual audio with volume control, lazy loading; Vibration API with per-event patterns |
| **Matchmaking** | Redis-backed queue with ELO rating, bot backfill, heads-up + multiplayer modes |
| **Leaderboard** | Paginated, time-filtered (all-time/month/week), per-mode, current-user rank card |
| **Player accounts** | JWT auth, bcrypt hashing, registration/login, avatar selection, profile with stats |
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
| **Scale infra** | Redis adapter for Socket.io, Redis session persistence (24h TTL), Redis rate limiting |
| **Observability** | Pino structured logging, Sentry integration, Prometheus metrics, health checks |
| **E2E tests** | Socket.io integration tests for lobby and game flows (`e2e-game.test.ts`, `e2e-lobby.test.ts`) |
| **CI/CD** | Parallel tests, auto-merge to develop, Docker validation, gated production deploys |
| **Push notifications** | PushManager foundation with Web Push API (subscription management implemented) |

---

## 1. Quick Wins (Small effort, noticeable improvement)

### 1a. App Shell Viewport Lock
**What:** Make the game feel like a native app, not a website. Lock the viewport so the app shell (header, nav) never scrolls — only internal content panels scroll. Disable pull-to-refresh, rubber-band scrolling, and address bar hide/show on mobile browsers.
**Why:** Every time the page bounces or the URL bar appears/disappears during gameplay, it breaks immersion. Supercell-quality games feel like apps because they own the entire viewport. This is the single cheapest change that most improves perceived quality.
**Touches:** `client/src/styles/index.css` (html/body `position: fixed; overflow: hidden; height: 100dvh`), `client/src/components/Layout.tsx` (inner scroll container), `client/src/pages/GamePage.tsx` + `LocalGamePage.tsx` (ensure game panels use internal scroll), `index.html` (`<meta name="viewport">` with `interactive-widget=resizes-visual`)
**Complexity:** Small
**Dependencies:** None

### 1b. Keyboard Shortcuts in Game
**What:** Add keyboard shortcuts for common actions: `B` for Bull, `T` for True, `R` to open raise/hand selector, `Esc` to close modals. Show shortcut hints on desktop (hover tooltips on action buttons).
**Why:** Desktop players want fast inputs. The replay page already has keyboard controls — extend the pattern to gameplay. Makes the game feel more responsive for power users.
**Touches:** `client/src/pages/GamePage.tsx`, `client/src/pages/LocalGamePage.tsx`, `client/src/components/ActionButtons.tsx`
**Complexity:** Small
**Dependencies:** None

### 1c. Bot Personality Flavor Text
**What:** Give each bot a visible "personality" — show flavor text alongside their actions in the call history (e.g., Bot Brady: *"I wouldn't bet on that..."* when calling bull). Map existing bot names to personality templates with 3-5 phrases each for bull/true/raise/bluff.
**Why:** Playing against bots feels mechanical. Personality text makes local games more entertaining and gives the impression of smarter opponents. Zero server changes needed.
**Touches:** `client/src/components/CallHistory.tsx`, new `client/src/data/botPersonalities.ts` data file, `client/src/pages/LocalGamePage.tsx`
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

---

## 2. Core Features (Meaningful additions that make the product more complete)

### 2a. Best-of-N Series for 1v1 Matches
**What:** When two players are in a 1v1 match (ranked or casual), offer the option to play a best-of-3 or best-of-5 series. Track set wins, display a series scoreboard between rounds, and declare a series winner at the end. In ranked mode, rating changes are calculated on the full series result (not individual games).
**Why:** Single-game 1v1s feel abrupt — one lucky round can decide the match. A series format adds drama, allows comeback narratives, and produces fairer rating outcomes. This is standard in competitive 1v1 games (fighting games, Rocket League, etc.).
**Touches:** `shared/src/types.ts` (new `SeriesSettings`, `SeriesState` types), `shared/src/engine/GameEngine.ts` (series lifecycle hooks), `server/src/rooms/Room.ts` (series tracking), `server/src/matchmaking/MatchmakingQueue.ts` (ranked series option), `client/src/pages/GamePage.tsx` + `LocalGamePage.tsx` (series scoreboard UI), `client/src/pages/ResultsPage.tsx` (series results view)
**Complexity:** Medium–Large
**Dependencies:** None (builds on existing matchmaking)

### 2b. Home Page Gambling Minigame (Deck Draw)
**What:** Expand the existing home page deck demo into a standalone minigame. Players draw 5 cards and bet (with in-game currency or points, not real money) on what hand type they'll get. Payouts scale by hand rarity. Include a daily free draw and track lifetime stats (best hand, total draws, biggest win). The minigame is accessible without an account.
**Why:** The deck draw interaction already exists and players love tapping it. Adding stakes (even play-money) creates a reason to return to the home page between games. It's a viral loop — "I just drew a straight flush!" is inherently shareable.
**Touches:** `client/src/pages/HomePage.tsx` (expand deck section into minigame panel), `client/src/components/DeckDrawGame.tsx` (new component), `shared/src/types.ts` (minigame types), localStorage for guest stats, `server/src/db/` for account-linked stats
**Complexity:** Medium
**Dependencies:** None (account integration optional but enhances it)

### 2c. In-Game Match Statistics & Data Visualization
**What:** Add a real-time stats panel accessible during gameplay (swipe-up or tab in sidebar) showing: bluff success rate this game, bull/true accuracy by player, hand type distribution of all calls this game, and a round-by-round card count timeline. On the results page, show a full post-game breakdown with animated charts (bar charts for accuracy, donut chart for call distribution, timeline for eliminations).
**Why:** The advanced stats on the profile page are great for long-term trends, but players want in-the-moment data too. "Who's been bluffing the most?" and "What's the most common call?" are questions players ask every game. Visual stats make the game feel more strategic and give spectators interesting information.
**Touches:** `client/src/components/InGameStats.tsx` (new), `client/src/pages/ResultsPage.tsx` + `LocalResultsPage.tsx` (enhanced post-game charts), `shared/src/types.ts` (in-game stat aggregation types), uses recharts (already a dependency)
**Complexity:** Medium
**Dependencies:** None

### 2d. Bitcoin Lightning Integration (Money Games)
**What:** Integrate Bitcoin Lightning Network payments to enable real-money wagering. Players deposit sats via Lightning invoice to an in-game wallet, join money tables with fixed buy-ins, and winnings are paid out instantly via Lightning. Requires: custodial wallet service (LNbits, Strike API, or Voltage), deposit/withdrawal UI, buy-in escrow logic, regulatory compliance check by jurisdiction, and opt-in only (never default).
**Why:** Bluffing games are natural fits for stakes — poker wouldn't exist without money. Lightning enables instant, low-fee, borderless micropayments that work for $0.10 or $100 buy-ins. This is the monetization path that aligns incentives with players (house takes a small rake, not ads or loot boxes).
**Touches:** `server/src/lightning/` (new: LN provider integration, wallet management, escrow), `shared/src/types.ts` (money game types, buy-in levels), `server/src/rooms/Room.ts` (escrow lifecycle), `client/src/pages/` (deposit/withdraw UI, money table lobby), `server/src/db/` (wallet balances, transaction history)
**Complexity:** Large
**Dependencies:** Player accounts (done), legal review for target jurisdictions

### 2e. Configurable Deck Variants
**What:** Allow the host to select deck variants: standard 52-card, no face cards (32-card), or jokers included (54-card, jokers are wild). Display the active deck variant in the lobby and during gameplay.
**Why:** Adds replayability and variety. Different deck sizes change the meta — smaller decks make high hands more common, jokers add chaos. Keeps experienced players engaged.
**Touches:** `shared/src/engine/Deck.ts`, `shared/src/types.ts` (deck variant setting), `shared/src/engine/HandChecker.ts` (joker handling), `server/src/socket/lobbyHandlers.ts`, `client/src/pages/LobbyPage.tsx`
**Complexity:** Medium–Large
**Dependencies:** None, but requires extensive testing of hand evaluation with variant decks

### 2f. Custom Player Colors in Game
**What:** Let players pick a color (from a curated palette of 12 options) when joining a room. Display as a colored ring around their avatar in the player list and turn indicator. Persist in localStorage. Avatars already exist on profiles — this adds in-game visual identity.
**Why:** With 6-12 players, the avatar icons alone aren't distinctive enough at a glance. Custom colors help players identify each other instantly, especially on small screens.
**Touches:** `shared/src/types.ts` (player color field), `client/src/components/PlayerList.tsx`, `client/src/pages/LobbyPage.tsx` (color picker), `server/src/socket/lobbyHandlers.ts` (validate)
**Complexity:** Small–Medium
**Dependencies:** None

---

## 3. Polish (UX improvements, animations, edge case handling)

### 3a. Aesthetic UI Overhaul
**What:** Elevate the visual design to feel premium and app-like. Key improvements: (1) Glassmorphism refinement — consistent blur intensity, subtle gradient overlays, glow effects on interactive elements. (2) Micro-animations — button press scaling, page transitions (slide/fade), card hover effects. (3) Typography — introduce a display font for headers (e.g., Playfair Display or similar serif) alongside the existing sans-serif body text. (4) Dark theme refinement — richer backgrounds (subtle texture/noise overlay instead of flat black), warm color temperature. (5) Loading states — skeleton screens everywhere (leaderboard already has this, extend to all pages).
**Why:** The current UI is clean and functional but doesn't make players go "wow." Premium visuals drive word-of-mouth sharing and justify money game stakes. The goal is "this looks like it cost $500K to build."
**Touches:** `client/src/styles/index.css` (global theme refinements), all component files (micro-animations), `client/src/components/Layout.tsx` (page transitions), font assets
**Complexity:** Medium (spread across many files but each change is small)
**Dependencies:** 1a (viewport lock) should ship first to establish the app shell

### 3b. Better Reveal Overlay with Card Table
**What:** Redesign the round-end reveal to show a virtual table view: all players' cards laid out in a circle/arc formation, with the called hand highlighted if it exists. Animate cards flipping from face-down to face-up in sequence.
**Why:** The current reveal overlay is functional but text-heavy. A visual card table makes the "moment of truth" more dramatic and easier to parse at a glance. This is the single most important animation in the game.
**Touches:** `client/src/components/RevealOverlay.tsx`, CSS for card layout + flip animations
**Complexity:** Medium
**Dependencies:** None

### 3c. Onboarding Improvements
**What:** Extend the tutorial to cover all hand types (currently it's a scripted 2-player demo). Add contextual tooltips in the first real game (e.g., "This is the hand selector — pick a hand higher than the current call"). Track whether the user has completed the tutorial in localStorage. Show a "first game" mode with gentler bot difficulty.
**Why:** New players don't understand the custom hand rankings (flush lower than three of a kind is counterintuitive). Better onboarding reduces churn in the critical first game. Every player who bounces during their first game is a lost referral.
**Touches:** `client/src/pages/TutorialPage.tsx`, `client/src/components/TutorialOverlay.tsx`, `client/src/components/GameTooltips.tsx`, localStorage flag
**Complexity:** Medium
**Dependencies:** None

### 3d. Landscape Game Layout Polish
**What:** Refine the two-panel landscape layout: make the sidebar collapsible, add a mini-map of player positions, ensure the hand selector modal doesn't obscure the game state. Test on actual tablets (iPad, Android tablets).
**Why:** The landscape layout exists but was developed after the portrait layout. Tablet users are a significant audience for card games (casual play at home).
**Touches:** `client/src/pages/GamePage.tsx`, `client/src/pages/LocalGamePage.tsx`, CSS media queries
**Complexity:** Small–Medium
**Dependencies:** 1a (viewport lock)

### 3e. Accessibility Audit & Fixes
**What:** Full a11y pass: proper ARIA labels on all interactive elements, focus management for keyboard navigation, color contrast meeting WCAG AA, screen reader announcements for game state changes (turn, bull calls, results), reduced-motion media query for all animations.
**Why:** Accessibility is a quality bar, not a feature. Important for reaching wider audiences and meeting app store / platform requirements for future native apps.
**Touches:** All component files in `client/src/components/`, `client/src/pages/`, CSS color variables
**Complexity:** Medium
**Dependencies:** None

### 3f. Richer Post-Game Results
**What:** Upgrade the results page with: animated player ranking reveal (3rd place → 2nd → 1st with fanfare), "Game MVPs" section (most daring bluff, best detective, longest streak), and a share card (auto-generated image summarizing the game outcome for social sharing).
**Why:** The results page is where players decide "that was fun, let's play again" or "meh." Making it feel like a celebration drives rematch rate. The share card drives organic growth.
**Touches:** `client/src/pages/ResultsPage.tsx`, `client/src/pages/LocalResultsPage.tsx`, `client/src/components/GameStatsDisplay.tsx`, canvas/image generation for share cards
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
**Why:** Players outside Northern Europe experience 100-200ms latency. A US region cuts that to <50ms for North American players. The architecture is already designed for this — it's mostly infrastructure configuration.
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
**Why:** This is the prerequisite for 2d (Bitcoin Lightning money games). Separating the infra from the game integration allows the payment system to be tested and hardened independently.
**Touches:** `server/src/lightning/` (new module), `server/src/db/migrations/` (wallet + transaction tables), `.env` (LN provider credentials)
**Complexity:** Large
**Dependencies:** Player accounts (done)

### 4f. Analytics & Game Balance Telemetry
**What:** Track key gameplay metrics for balance tuning: win rate by starting position, hand type call frequency vs actual occurrence, average game duration by player count, bluff success rate by hand type, and bot difficulty win rates. Store in PostgreSQL and expose via admin dashboard.
**Why:** As the player base grows, data-driven balance decisions become critical. If starting player always wins 60% of games, the rotation needs adjustment. If bots on "hard" lose 80% of the time, they need tuning.
**Touches:** `server/src/analytics/track.ts` (expand event tracking), `server/src/db/` (analytics tables), `server/src/index.ts` (admin endpoints, behind auth)
**Complexity:** Medium
**Dependencies:** None

---

## 5. Future Vision (Longer-term, high-impact)

### 5a. Native Mobile Apps
**What:** Wrap the web app in Capacitor (or React Native Web) for iOS and Android app store distribution. Add native features: push notifications via APNs/FCM, haptic engine (instead of Vibration API), app icon badge for turn notifications, and offline mode for local games.
**Why:** App store presence is the #1 growth channel for mobile games. Web apps have friction (bookmarking, no home screen icon by default, Safari limitations). A native wrapper with the existing codebase is low effort for high distribution gain.
**Touches:** New `mobile/` directory with Capacitor config, `client/` (minor tweaks for native bridges), app store assets
**Complexity:** Medium–Large
**Dependencies:** 1a (viewport lock), 3a (aesthetic polish)

### 5b. Tournament Mode
**What:** Structured tournament brackets for 8/16/32 players. Single-elimination or Swiss-style. Auto-created rooms for each match, bracket visualization, and final standings.
**Why:** Tournaments are the ultimate competitive format. They create events that players plan around and invite friends to. Tournament results drive leaderboard engagement.
**Touches:** `server/src/tournament/` (new module), `shared/src/types.ts`, `client/src/pages/TournamentPage.tsx`, `client/src/pages/TournamentBracketPage.tsx`
**Complexity:** Large
**Dependencies:** 2a (best-of-N for match format)

### 5c. Social Features (Friends List, Invites)
**What:** Persistent friends list (add by username), online status indicators, direct invite-to-game, and notification when a friend creates a room. Build on the existing recent players feature.
**Why:** Bull 'Em is a social game — the core loop is playing with friends. Currently, coordination happens outside the app (text messages, Discord). Bringing social features in-app increases retention and session frequency.
**Touches:** `server/src/db/` (friends table), `shared/src/events.ts` (friend events), `client/src/pages/FriendsPage.tsx`, `client/src/components/RecentPlayers.tsx` (upgrade)
**Complexity:** Medium–Large
**Dependencies:** Player accounts (done)

### 5d. Seasonal Ranked Play
**What:** Time-limited ranked seasons (e.g., monthly) with rating resets, season rewards (cosmetic badges/avatars), and end-of-season leaderboard snapshots. Placement matches at the start of each season.
**Why:** Seasonal resets keep the competitive ladder fresh and give players a reason to keep climbing. Without seasons, once you reach a high rank there's no reason to keep playing ranked.
**Touches:** `server/src/matchmaking/` (season logic), `server/src/db/` (season history), `client/src/pages/LeaderboardPage.tsx` (season selector), `client/src/components/RankBadge.tsx` (season badges)
**Complexity:** Medium
**Dependencies:** Matchmaking (done), leaderboard (done)

---

## Suggested Sequencing

### Phase 1 — "Feel Like an App" (next 1-2 weeks)
Focus: Make the existing game feel polished and native-quality.

| Item | What | Why first |
|---|---|---|
| **1a** | Viewport lock / app shell | Foundation for all UI work; biggest bang for smallest effort |
| **1b** | Keyboard shortcuts | Quick win for desktop power users |
| **1c** | Bot personality text | Makes solo play more fun with zero risk |
| **1e** | Better elimination experience | Dramatic moments deserve dramatic visuals |
| **3a** | Aesthetic UI overhaul (start) | Begin the visual quality uplift |

### Phase 2 — "Worth Coming Back" (2-4 weeks)
Focus: Features that create reasons to return and play again.

| Item | What | Why now |
|---|---|---|
| **2a** | Best-of-N series (1v1) | Deepens competitive play, fairer ranking |
| **2b** | Deck draw gambling minigame | Daily engagement hook on home page |
| **2c** | In-game match statistics | Makes every game feel more strategic |
| **1d** | Card deal animation | Casino-quality feel |
| **3b** | Better reveal overlay | The most important moment in every round |
| **4a** | DB connection resilience | Production reliability |

### Phase 3 — "Money on the Table" (1-2 months)
Focus: Monetization and competitive infrastructure.

| Item | What | Why now |
|---|---|---|
| **4e** | Lightning payment infra | Backend prerequisite for money games |
| **2d** | Bitcoin Lightning money games | Revenue model that aligns with players |
| **2f** | Custom player colors | Identity matters when stakes are real |
| **3f** | Richer post-game results | Celebration drives rematches |
| **4b** | Read replicas | Handle leaderboard load at scale |

### Phase 4 — "Go Wide" (2-4 months)
Focus: Distribution, social, and competitive depth.

| Item | What | Why now |
|---|---|---|
| **5a** | Native mobile apps | App store distribution |
| **5c** | Friends list & invites | Social retention loop |
| **2e** | Deck variants | Replayability for experienced players |
| **5d** | Seasonal ranked play | Competitive retention loop |
| **4c** | Multi-region deployment | Latency for non-EU players |

### Phase 5 — "Esports Ready" (4-6 months)
Focus: Organized competitive play.

| Item | What | Why now |
|---|---|---|
| **5b** | Tournament mode | Community events and organized play |
| **3c** | Onboarding improvements | Retain the influx of new players from growth |
| **3e** | Accessibility audit | Quality bar for app store requirements |
| **4f** | Analytics & game balance | Data-driven tuning at scale |

---

## Existing TODO(scale) Markers in Code

| Location | What | When to Address |
|---|---|---|
| `server/src/index.ts:45` | CORS origins hardcoded for single domain | When serving from multiple domains/CDN |
| `server/src/index.ts:139` | Single Redis client for adapter | At very high scale, separate clients |
| `server/src/index.ts:433` | Admin endpoints unauthenticated | Before exposing to production |
| `server/src/index.ts:537` | `getOnlinePlayerNames()` single-instance only | Multi-instance deployment |
| `server/src/db/pool.ts:73` | No read replicas | When leaderboard/stats queries load increases |
| `server/src/db/leaderboard.ts:13` | In-memory leaderboard cache | Replace with Redis cache |
| `server/src/rateLimit.ts:124` | In-memory rate limiting (single instance) | Multi-instance deployment |
| `server/src/push/PushManager.ts:18` | Push subscriptions in-memory | Move to Redis/PostgreSQL |
| `server/src/metrics.ts:8` | Single-instance Prometheus metrics | Aggregation across instances |
| `server/src/analytics/track.ts:16-17` | Matchmaking analytics events stubbed | When matchmaking queue analytics needed |
