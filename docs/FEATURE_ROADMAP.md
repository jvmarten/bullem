# Bull 'Em — Feature Roadmap

> Updated 2026-03-08 from a full codebase audit. Replaces all previous roadmaps.
>
> Items are prioritized by user impact and grouped by effort level.
> Each item is tagged: **Claude Code** (can be fully implemented in a session) or **Manual Setup** (requires external service config, credentials, or similar).

---

## What's Already Shipped

The codebase is production-grade across many dimensions. These do **not** need work:

| Area | Details |
|---|---|
| **Game engine** | Pure state machine, 17+ test files, all hand types, edge cases, regressions |
| **Security** | Server-authoritative, cards never leaked, input validated, reconnect tokens rotated |
| **Bot AI** | Three difficulty levels (normal/hard/impossible) with cross-round opponent memory, 9 personalities × 9 levels |
| **Mobile UX** | Wheel pickers, touch targets (44px+), responsive layouts, no hover-only interactions |
| **App shell viewport lock** | `100dvh`, `overscroll-behavior: none`, inner scroll containers — feels like an app, not a website |
| **Keyboard shortcuts** | B/T/R/P/Esc/Enter in game via `useGameKeyboardShortcuts.ts`, suppressed when typing |
| **Card deal animation** | CSS keyframe animation with staggered delays per card via `HandDisplay.tsx` |
| **Elimination experience** | Opacity fade + "OUT" badge on player list, toast notifications, spectator transition |
| **Sound + Haptics** | Contextual audio with master volume control, lazy loading; Vibration API with per-event patterns |
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
| **QR code invites** | QR code generation in lobby for easy room sharing |
| **Recent players** | Tracks and displays recently played-with players on home page |
| **Interactive tutorial** | Scripted walkthrough teaching core game mechanics |
| **Home page deck demo** | Interactive deck with shuffle animation, 5-card draw, hand classification + probability |
| **Best-of series** | 1v1 Bo1/Bo3/Bo5 support, ranked 1v1 always Bo3 |
| **Bot calibration** | Continuous round-robin calibration pipeline with convergence detection |
| **Scale infra** | Redis adapter for Socket.io, Redis session persistence (24h TTL), Redis rate limiting |
| **DB connection resilience** | Exponential backoff with jitter, degraded mode fallback, auto-reconnection |
| **Observability** | Pino structured logging, Sentry integration, Prometheus metrics, health checks |
| **E2E tests** | Socket.io integration tests for lobby and game flows |
| **CI/CD** | Parallel tests, auto-merge to develop, Docker validation, gated production deploys |
| **Push notifications** | PushManager foundation with Web Push API (subscription management implemented) |
| **Admin panel** | User management, analytics, bot management endpoints |
| **Project email** | Resend API integration for password reset emails with HTML/plaintext templates |
| **Landscape mode** | Dual portrait/landscape layouts with responsive breakpoints, sidebar call history |

---

## 1. Quick Wins (Small effort, noticeable improvement)

### 1a. Bot Personality Flavor Text in Gameplay
**What:** Show bot flavor text alongside their actions in the call history during gameplay (e.g., Bot Brady: *"I wouldn't bet on that..."* when calling bull). The `shared/src/botProfiles.ts` already defines `BotFlavorText` with quips for `callBull`, `caughtBluffing`, `winRound`, `bigRaise`, and `eliminated`. Currently this text only appears in the `BotProfileModal` and `PublicProfilePage` — it needs to surface during actual gameplay.
**Why:** Playing against bots feels mechanical. Personality text makes local games more entertaining and gives the impression of smarter opponents. Zero server changes needed — all flavor text data already exists.
**Touches:** `client/src/components/CallHistory.tsx` (render flavor text for bot players), `client/src/pages/GamePage.tsx` + `LocalGamePage.tsx` (pass bot profile data to CallHistory)
**Complexity:** Small
**Dependencies:** None
**Tag:** Claude Code

### 1b. Per-Category Volume Sliders
**What:** Add separate volume controls for SFX, music, and ambient sounds. Currently `soundEngine.ts` has a single master volume (`volume` + `setVolume()`). Add category-aware volume multipliers so players can mute game sounds but keep music, or vice versa. Update `VolumeControl.tsx` with a multi-slider UI.
**Why:** Sound is critical to game feel, but players have different preferences. Someone playing at work wants card sounds but no victory fanfare. Per-category control is standard in every quality game.
**Touches:** `client/src/hooks/soundEngine.ts` (add category volumes), `client/src/components/VolumeControl.tsx` (multi-slider UI), `client/src/hooks/useSound.ts` (pass category to play calls)
**Complexity:** Small
**Dependencies:** None
**Tag:** Claude Code

### 1c. Better Sound Effects
**What:** Audit and replace game sounds with more distinctive, premium audio: bull call (buzzer/horn), true call (bell/chime), raise (chip slide), elimination (dramatic thud), round win (fanfare), game win (short victory music). Ensure all sounds are short (<1s), compressed (opus/mp3, <50KB each), and lazy-loaded. Add ambient table sound loop option.
**Why:** Sound is 50% of game feel. Current sounds are functional but not memorable. Distinctive audio makes gameplay feel tactile and builds brand identity — players should associate "that sound" with Bull 'Em.
**Touches:** `client/src/assets/sounds/` (new/replacement audio files), `client/src/hooks/soundEngine.ts` (new sound entries), possibly `client/src/hooks/useSound.ts`
**Complexity:** Small–Medium
**Dependencies:** 1b (per-category volume) should ship first so new sounds respect category controls
**Tag:** Manual Setup (sourcing/licensing audio assets)

### 1d. Push Subscriptions Persistence
**What:** Move push notification subscriptions from in-memory Map to PostgreSQL. The `TODO(scale)` marker is already in `server/src/push/PushManager.ts:18`. Current design loses subscriptions on restart and doesn't work across instances.
**Why:** Push notifications only work reliably if subscriptions survive server restarts. Prerequisite for any notification-driven engagement features (friend invites, tournament reminders, turn notifications).
**Touches:** `server/src/push/PushManager.ts` (replace in-memory Map with DB queries), new `server/src/db/migrations/` (push_subscriptions table)
**Complexity:** Small–Medium
**Dependencies:** None
**Tag:** Claude Code

---

## 2. Core Features (Meaningful additions that make the product more complete)

### 2a. Home Page Deck Draw Minigame
**What:** Expand the existing home page deck demo into a standalone minigame. Players draw 5 cards and bet (with in-game points, not real money) on what hand type they'll get. Payouts scale by hand rarity. Include a daily free draw and track lifetime stats (best hand, total draws, biggest win). Accessible without an account via localStorage; syncs to account when logged in.
**Why:** The deck draw interaction already exists and players love tapping it. Adding stakes (even play-money) creates a reason to return to the home page between games. It's a viral loop — "I just drew a straight flush!" is inherently shareable.
**Touches:** `client/src/pages/HomePage.tsx` (expand deck section into minigame panel), new `client/src/components/DeckDrawGame.tsx`, `shared/src/types.ts` (minigame types), localStorage for guest stats, `server/src/db/` for account-linked stats
**Complexity:** Medium
**Dependencies:** None
**Tag:** Claude Code

### 2b. In-Game Match Statistics & Data Visualization
**What:** Add a real-time stats panel accessible during gameplay (swipe-up or tab in sidebar) showing: bluff success rate this game, bull/true accuracy by player, hand type distribution of all calls this game, and a round-by-round card count timeline. On the results page, show a full post-game breakdown with animated charts (bar charts for accuracy, donut chart for call distribution, timeline for eliminations).
**Why:** Players want in-the-moment data. "Who's been bluffing the most?" is a question asked every game. Visual stats make the game feel more strategic and give spectators interesting information.
**Touches:** new `client/src/components/InGameStats.tsx`, `client/src/pages/ResultsPage.tsx` + `LocalResultsPage.tsx` (enhanced post-game charts), `shared/src/types.ts` (in-game stat aggregation types), uses recharts (already a dependency)
**Complexity:** Medium
**Dependencies:** None
**Tag:** Claude Code

### 2c. Tournament Mode
**What:** Structured tournament brackets for 8/16/32 players. Single-elimination or Swiss-style. Auto-created rooms for each match, bracket visualization with real-time updates via Socket.io, and final standings with badges. Tournament lobby with registration, countdown to start, and bracket seeding (random or by rating).
**Why:** Tournaments are the ultimate competitive format. They create events that players plan around and invite friends to. Tournament results drive leaderboard engagement and social sharing.
**Touches:** new `server/src/tournament/` module (bracket engine, match scheduling, result tracking), `shared/src/types.ts` (tournament types), new `client/src/pages/TournamentPage.tsx` + `TournamentBracketPage.tsx`, `server/src/db/` (tournament tables + migrations)
**Complexity:** Large
**Dependencies:** None (best-of series already shipped)
**Tag:** Claude Code

### 2d. Social Features — Friends List & Invites
**What:** Persistent friends list (add by username), online status indicators, direct invite-to-game, and notification when a friend creates a room. Build on the existing recent players feature by adding "Add Friend" buttons.
**Why:** Bull 'Em is a social game — the core loop is playing with friends. Currently, coordination happens outside the app (text messages, Discord). Bringing social features in-app increases retention and session frequency.
**Touches:** `server/src/db/` (friends table, friend requests, new migration), `shared/src/types.ts` (friend events), `shared/src/events.ts` (friend socket events), new `client/src/pages/FriendsPage.tsx`, `client/src/components/RecentPlayers.tsx` (add-friend button)
**Complexity:** Medium–Large
**Dependencies:** 1d (push persistence) for friend notifications
**Tag:** Claude Code

### 2e. Configurable Deck Variants
**What:** Allow the host to select deck variants: standard 52-card, no face cards (32-card), or jokers included (54-card, jokers are wild). Display the active deck variant in the lobby and during gameplay. Wild jokers can substitute for any card when checking hand existence.
**Why:** Adds replayability and variety. Different deck sizes change the meta — smaller decks make high hands more common, jokers add chaos. Keeps experienced players engaged.
**Touches:** `shared/src/engine/Deck.ts` (variant decks), `shared/src/types.ts` (deck variant setting), `shared/src/engine/HandChecker.ts` (joker/wild handling), `server/src/socket/lobbyHandlers.ts` (validate variant), `client/src/pages/LobbyPage.tsx` + `LocalLobbyPage.tsx` (variant picker)
**Complexity:** Medium–Large
**Dependencies:** None, but requires extensive testing of hand evaluation with variant decks
**Tag:** Claude Code

### 2f. Bitcoin Lightning Integration (Money Games)
**What:** Integrate Bitcoin Lightning Network payments to enable real-money wagering. Players deposit sats via Lightning invoice to an in-game wallet, join money tables with fixed buy-ins, and winnings are paid out instantly via Lightning. Requires: custodial wallet service (LNbits, Strike API, or Voltage), deposit/withdrawal UI, buy-in escrow logic, regulatory compliance check by jurisdiction, and opt-in only (never default). House takes a small rake (1–3%).
**Why:** Bluffing games are natural fits for stakes — poker wouldn't exist without money. Lightning enables instant, low-fee, borderless micropayments that work for $0.10 or $100 buy-ins. This is the monetization path that aligns incentives with players (rake, not ads or loot boxes).
**Touches:** new `server/src/lightning/` (LN provider integration, wallet management, escrow), `shared/src/types.ts` (money game types, buy-in levels), `server/src/rooms/Room.ts` (escrow lifecycle), `client/src/pages/` (deposit/withdraw UI, money table lobby), `server/src/db/` (wallet balances, transaction history)
**Complexity:** Large
**Dependencies:** 4b (Lightning payment infrastructure), legal review for target jurisdictions
**Tag:** Manual Setup (LN provider account, legal review, payment credentials)

---

## 3. Polish (UX improvements, animations, edge case handling)

### 3a. Aesthetic UI Overhaul — "Premium Feel"
**What:** Elevate the visual design to feel premium and app-like. Key improvements: (1) Glassmorphism refinement — consistent blur intensity, subtle gradient overlays, glow effects on interactive elements. (2) Micro-animations — button press scaling, page transitions (slide/fade between routes), card hover effects. (3) Typography — introduce a display font for headers (e.g., Playfair Display or similar serif) alongside the existing sans-serif body text. (4) Dark theme refinement — richer backgrounds (subtle texture/noise overlay instead of flat black), warm color temperature. (5) Loading states — skeleton screens everywhere (leaderboard already has this, extend to all pages).
**Why:** The current UI is clean and functional but doesn't make players go "wow." Premium visuals drive word-of-mouth sharing ("look at this game") and justify money game stakes. The goal is "this looks like it cost $500K to build."
**Touches:** `client/src/styles/index.css` (global theme refinements), all component files (micro-animations), `client/src/components/Layout.tsx` (page transitions), font assets
**Complexity:** Medium (spread across many files but each change is small)
**Dependencies:** None
**Tag:** Claude Code

### 3b. Better Reveal Overlay with Card Table
**What:** Redesign the round-end reveal to show a virtual table view: all players' cards laid out in a circle/arc formation, with the called hand highlighted if it exists. Animate cards flipping from face-down to face-up in sequence. Show matching cards with a glow effect.
**Why:** The current reveal overlay is functional but text-heavy. A visual card table makes the "moment of truth" more dramatic and easier to parse at a glance. This is the single most important animation in the game.
**Touches:** `client/src/components/RevealOverlay.tsx` (complete redesign), CSS for card layout + flip animations
**Complexity:** Medium
**Dependencies:** None
**Tag:** Claude Code

### 3c. Landscape Mode — Round Card Table Polish
**What:** Full landscape mode polish beyond the current dual-layout: (1) Round card table layout where players sit around a circular/oval virtual table with their cards visible — the classic poker table view. (2) Collapsible sidebar for call history/stats. (3) Mini-map of player positions for 6+ player games. (4) Ensure hand selector modal doesn't obscure game state in landscape. (5) Test on actual tablets (iPad, Android tablets) for touch target sizing. This is the "poker table" view that landscape mode deserves.
**Why:** The landscape layout exists but was developed after portrait and feels like portrait squeezed sideways. Tablet users are a significant audience for card games. A proper round-table layout is the most natural way to present a card game in landscape.
**Touches:** `client/src/pages/GamePage.tsx` + `LocalGamePage.tsx` (landscape table layout), CSS media queries, potentially new `client/src/components/TableLayout.tsx`
**Complexity:** Medium
**Dependencies:** None
**Tag:** Claude Code

### 3d. Onboarding Improvements
**What:** Extend the tutorial to cover all hand types (currently a scripted 2-player demo). Add contextual tooltips in the first real game (e.g., "This is the hand selector — pick a hand higher than the current call"). Track tutorial completion in localStorage. Show a "first game" mode with gentler bot difficulty. Emphasize the custom hand ranking (flush < three of a kind) since it's the #1 source of confusion.
**Why:** New players don't understand the custom hand rankings. Better onboarding reduces churn in the critical first game. Every player who bounces during their first game is a lost referral.
**Touches:** `client/src/pages/TutorialPage.tsx`, `client/src/components/TutorialOverlay.tsx`, `client/src/components/GameTooltips.tsx`, `client/src/utils/tutorialProgress.ts`
**Complexity:** Medium
**Dependencies:** None
**Tag:** Claude Code

### 3e. Richer Post-Game Results
**What:** Upgrade the results page with: (1) Animated player ranking reveal (3rd place → 2nd → 1st with fanfare). (2) "Game MVPs" section (most daring bluff, best detective, longest survival streak). (3) Share card — auto-generated image summarizing the game outcome for social sharing (canvas-based, downloadable). (4) "Play Again" one-tap rematch with same players.
**Why:** The results page is where players decide "that was fun, let's play again" or "meh." Making it feel like a celebration drives rematch rate. The share card drives organic growth.
**Touches:** `client/src/pages/ResultsPage.tsx` + `LocalResultsPage.tsx`, `client/src/components/GameStatsDisplay.tsx`, canvas/image generation for share cards
**Complexity:** Medium
**Dependencies:** None
**Tag:** Claude Code

### 3f. Accessibility Audit & Fixes
**What:** Full a11y pass: proper ARIA labels on all interactive elements, focus management for keyboard navigation, color contrast meeting WCAG AA, screen reader announcements for game state changes (turn, bull calls, results), `prefers-reduced-motion` media query for all animations, skip-to-content link.
**Why:** Accessibility is a quality bar, not a feature. Important for reaching wider audiences and meeting app store requirements for future native apps.
**Touches:** All component files in `client/src/components/`, `client/src/pages/`, CSS color variables in `client/src/styles/index.css`
**Complexity:** Medium
**Dependencies:** None
**Tag:** Claude Code

---

## 4. Infrastructure (Not user-facing, but unblocks future growth)

### 4a. Analytics, Telemetry & Game Balance Database
**What:** Build a comprehensive analytics pipeline: (1) Track key gameplay metrics for balance tuning — win rate by starting position, hand type call frequency vs actual occurrence, average game duration by player count, bluff success rate by hand type, bot difficulty win rates. (2) Store in PostgreSQL analytics tables with efficient time-series queries. (3) Expose via admin dashboard with charts. (4) Feed into data visualizations for players (see 2b). The `server/src/analytics/track.ts` already has the event tracking foundation and two `TODO(scale)` matchmaking stubs — this extends it with aggregation and querying.
**Why:** Data-driven balance decisions become critical as the player base grows. If starting player always wins 60%, the rotation needs adjustment. If bots on "hard" lose 80%, they need tuning. This also provides the data layer for player-facing statistics features.
**Touches:** `server/src/analytics/track.ts` (expand event tracking, implement matchmaking stubs), `server/src/db/` (analytics tables + migrations), `server/src/admin/routes.ts` (analytics dashboard endpoints)
**Complexity:** Medium
**Dependencies:** None
**Tag:** Claude Code

### 4b. Lightning Payment Infrastructure
**What:** Build the payment backend needed for money games: LN node connection (LNbits/Voltage/Strike API), invoice generation, payment verification, wallet balance tracking, withdrawal processing, transaction logging with full audit trail. All behind a feature flag (`LIGHTNING_ENABLED=true`). Includes webhook handler for payment confirmations and dead-letter queue for failed payouts.
**Why:** This is the prerequisite for 2f (Bitcoin Lightning money games). Separating the infra from the game integration allows the payment system to be tested and hardened independently.
**Touches:** new `server/src/lightning/` module, `server/src/db/migrations/` (wallet + transaction tables), `.env` (LN provider credentials)
**Complexity:** Large
**Dependencies:** None
**Tag:** Manual Setup (LN provider account creation, API keys, node setup)

### 4c. Read Replicas for Leaderboard Queries
**What:** Add a separate read-only database pool for leaderboard and stats queries. Currently all queries go through the same pool, and leaderboard queries (especially with time filters and ranking calculations) can be expensive. The `TODO(scale)` marker is already in `pool.ts:73`.
**Why:** When leaderboards get popular (thousands of page views), read queries shouldn't compete with game result writes. Fly.io Postgres supports read replicas natively.
**Touches:** `server/src/db/pool.ts` (new read pool), `server/src/db/leaderboard.ts` (use read pool), `server/src/db/advancedStats.ts` (use read pool)
**Complexity:** Small–Medium
**Dependencies:** None
**Tag:** Manual Setup (Fly.io read replica provisioning) + Claude Code (code changes)

### 4d. Multi-Region Deployment
**What:** Expand from single-region ("arn") to multi-region on Fly.io. Add a second region (e.g., "iad" for US East). Configure Redis as primary/replica and Postgres with read replicas. Socket.io Redis adapter already handles cross-instance communication. Resolve `TODO(scale)` markers for `getOnlinePlayerNames()` (index.ts:695), rate limiting (rateLimit.ts:124), and Prometheus metrics (metrics.ts:8) for multi-instance correctness.
**Why:** Players outside Northern Europe experience 100–200ms latency. A US region cuts that to <50ms for North American players. The architecture is already designed for this — it's mostly infrastructure configuration plus fixing the handful of single-instance assumptions.
**Touches:** `fly.toml` (add regions), Redis and Postgres provisioning, `server/src/index.ts` (region-aware health check, fix getOnlinePlayerNames), `server/src/rateLimit.ts` (ensure Redis-backed), `server/src/metrics.ts` (multi-instance aggregation)
**Complexity:** Medium
**Dependencies:** 4c (read replicas)
**Tag:** Manual Setup (infrastructure provisioning) + Claude Code (code fixes)

### 4e. Profile Photo Object Storage
**What:** Migrate profile photos from base64 in PostgreSQL to S3-compatible object storage (Cloudflare R2 or Tigris on Fly.io). The `TODO(scale)` marker is already in `server/src/auth/routes.ts:418`. Add upload endpoint with image resizing (sharp is already a root dependency), serve via CDN.
**Why:** Base64 photos bloat the database and increase query payload sizes. Object storage is cheaper, faster, and supports CDN caching. Required before the user base grows significantly.
**Touches:** `server/src/auth/routes.ts` (upload endpoint refactor), new `server/src/storage/` module, `server/src/db/migrations/` (photo_url migration already exists — just need to populate), `.env` (S3/R2 credentials)
**Complexity:** Small–Medium
**Dependencies:** None
**Tag:** Manual Setup (R2/S3 bucket creation, credentials) + Claude Code (code changes)

---

## 5. Future Vision (Longer-term, high-impact)

### 5a. Rich Data Visualizations & Match Analytics
**What:** Go beyond basic stats into rich, engaging data visualizations: (1) Heat maps of bluff patterns over time (when in a game do players bluff most?). (2) Win probability graphs during a match (like chess evaluation bars). (3) "Rivalry" stats between frequent opponents. (4) Career trajectory charts showing rating, win rate, and play style evolution over time. (5) Shareable stat cards for social media (canvas-generated images). Use recharts (already installed) for interactive charts.
**Why:** Stats pages are where hardcore players spend time between games. Beautiful data visualizations make progression feel meaningful and provide content worth sharing ("Look at my bluff heat map").
**Touches:** `client/src/components/AdvancedStats.tsx` (extend), new `client/src/components/DataViz/` directory, `server/src/db/advancedStats.ts` (new query endpoints)
**Complexity:** Medium–Large
**Dependencies:** 4a (analytics database provides the underlying data)
**Tag:** Claude Code

### 5b. Seasonal Ranked Play
**What:** Time-limited ranked seasons (e.g., monthly) with soft rating resets, season rewards (cosmetic badges/avatars), and end-of-season leaderboard snapshots. Placement matches at the start of each season (5 games). Season history viewable on profile.
**Why:** Seasonal resets keep the competitive ladder fresh and give players a reason to keep climbing. Without seasons, once you reach a high rank there's no reason to keep playing ranked.
**Touches:** `server/src/matchmaking/` (season logic, placement handling), `server/src/db/` (season history tables), `client/src/pages/LeaderboardPage.tsx` (season selector), `client/src/components/RankBadge.tsx` (season badges)
**Complexity:** Medium
**Dependencies:** None (matchmaking and leaderboard already shipped)
**Tag:** Claude Code

### 5c. Native Mobile Apps
**What:** Wrap the web app in Capacitor for iOS and Android app store distribution. Add native features: push notifications via APNs/FCM (replacing Web Push), haptic engine (richer than Vibration API), app icon badge for turn notifications, and offline mode for local games. App store listing with screenshots, descriptions, and ratings.
**Why:** App store presence is the #1 growth channel for mobile games. Web apps have friction (bookmarking, no home screen icon by default, Safari limitations). A native wrapper with the existing codebase is low effort for high distribution gain.
**Touches:** New `mobile/` directory with Capacitor config, `client/` (minor tweaks for native bridges), app store assets (icons, screenshots, descriptions)
**Complexity:** Medium–Large
**Dependencies:** 3a (aesthetic polish), 3f (accessibility for app store review)
**Tag:** Manual Setup (Apple Developer account, Google Play Console, app signing, store listings)

### 5d. Custom Player Colors in Game
**What:** Let players pick a color (from a curated palette of 12 options) when joining a room. Display as a colored ring around their avatar in the player list and turn indicator. Persist in localStorage for guests, in account for logged-in users.
**Why:** With 6–12 players, avatar icons alone aren't distinctive enough at a glance. Custom colors help players identify each other instantly, especially on small screens.
**Touches:** `shared/src/types.ts` (player color field), `client/src/components/PlayerList.tsx`, `client/src/pages/LobbyPage.tsx` + `LocalLobbyPage.tsx`, `server/src/socket/lobbyHandlers.ts` (validate)
**Complexity:** Small–Medium
**Dependencies:** None
**Tag:** Claude Code

---

## Existing TODO(scale) Markers in Code

| Location | What | When to Address | Roadmap Item |
|---|---|---|---|
| `server/src/index.ts:57` | CORS origins hardcoded for single domain | When serving from multiple domains/CDN | 4d |
| `server/src/index.ts:152` | Single Redis client for adapter + rate limiting | At very high scale, separate clients | 4d |
| `server/src/index.ts:695` | `getOnlinePlayerNames()` single-instance only | Multi-instance deployment | 4d |
| `server/src/db/pool.ts:73` | No read replicas configured | When leaderboard query load increases | 4c |
| `server/src/db/leaderboard.ts:14` | In-memory leaderboard cache (TTL-based) | Replace with Redis cache | 4d |
| `server/src/rateLimit.ts:124` | In-memory rate limiting (single instance) | Multi-instance — must use REDIS_URL | 4d |
| `server/src/push/PushManager.ts:18` | Push subscriptions in-memory Map | Move to PostgreSQL | 1d |
| `server/src/metrics.ts:8` | Single-instance Prometheus metrics | Multi-instance aggregation | 4d |
| `server/src/analytics/track.ts:16–17` | Matchmaking analytics events stubbed | Implement matchmaking telemetry | 4a |
| `server/src/auth/routes.ts:418` | Profile photos stored as base64 in DB | Migrate to S3/R2 | 4e |

---

## Suggested Sequencing

Items within each batch can be run as **parallel Claude Code sessions** without logical conflicts. Each batch depends only on prior batches being complete. Order: perception → engagement → competitive depth → monetization → distribution.

### Batch 1 — "Polish the Foundation"
*Goal: Small, independent improvements that make the shipped product feel more complete. No shared files between sessions.*

| Session | Item | What | Complexity | Tag | Key Files |
|---|---|---|---|---|---|
| A | **1a** | Bot personality flavor text in gameplay | Small | Claude Code | `CallHistory.tsx`, `botProfiles.ts` |
| B | **1b** | Per-category volume sliders | Small | Claude Code | `soundEngine.ts`, `VolumeControl.tsx`, `useSound.ts` |
| C | **1d** | Push subscriptions persistence | Small–Medium | Claude Code | `PushManager.ts`, new DB migration |
| D | **4a** | Analytics & game balance database | Medium | Claude Code | `analytics/track.ts`, DB tables, admin endpoints |

### Batch 2 — "Casino Quality"
*Goal: Visual and audio polish that makes the game feel premium. Sessions touch different systems.*

| Session | Item | What | Complexity | Tag | Key Files |
|---|---|---|---|---|---|
| A | **1c** | Better sound effects | Small–Medium | Manual Setup | `assets/sounds/`, `soundEngine.ts` |
| B | **3a** | Aesthetic UI overhaul | Medium | Claude Code | `index.css`, component styles, `Layout.tsx`, fonts |
| C | **3b** | Better reveal overlay / card table | Medium | Claude Code | `RevealOverlay.tsx`, CSS animations |
| D | **3c** | Landscape mode / round card table | Medium | Claude Code | Game pages (layout), CSS media queries, `TableLayout.tsx` |

### Batch 3 — "Worth Coming Back"
*Goal: Features that create daily engagement loops and in-game depth.*

| Session | Item | What | Complexity | Tag | Key Files |
|---|---|---|---|---|---|
| A | **2a** | Deck draw minigame (home page) | Medium | Claude Code | `HomePage.tsx`, new `DeckDrawGame.tsx`, localStorage |
| B | **2b** | In-game match statistics | Medium | Claude Code | New `InGameStats.tsx`, results pages, `types.ts` |
| C | **3e** | Richer post-game results | Medium | Claude Code | `ResultsPage.tsx`, `LocalResultsPage.tsx`, canvas share card |
| D | **3d** | Onboarding improvements | Medium | Claude Code | `TutorialPage.tsx`, `TutorialOverlay.tsx`, `GameTooltips.tsx` |

### Batch 4 — "Competitive & Social"
*Goal: Social infrastructure and competitive depth. Items touch different systems — no file conflicts.*

| Session | Item | What | Complexity | Tag | Key Files |
|---|---|---|---|---|---|
| A | **2d** | Friends list & invites | Medium–Large | Claude Code | New friends DB table, `FriendsPage.tsx`, socket events |
| B | **2e** | Configurable deck variants | Medium–Large | Claude Code | `Deck.ts`, `HandChecker.ts`, `types.ts`, lobby pages |
| C | **3f** | Accessibility audit & fixes | Medium | Claude Code | All components (ARIA labels, focus, contrast) |
| D | **5b** | Seasonal ranked play | Medium | Claude Code | `matchmaking/`, season DB tables, `LeaderboardPage.tsx` |
| E | **4e** | Profile photo object storage | Small–Medium | Manual Setup | `auth/routes.ts`, new `storage/` module, R2 config |

### Batch 5 — "Data & Scale"
*Goal: Analytics, data visualizations, and infrastructure for growth.*

| Session | Item | What | Complexity | Tag | Key Files |
|---|---|---|---|---|---|
| A | **5a** | Rich data visualizations | Medium–Large | Claude Code | `AdvancedStats.tsx`, new `DataViz/` components |
| B | **4c** | Read replicas for leaderboard | Small–Medium | Manual Setup | `pool.ts`, `leaderboard.ts`, `advancedStats.ts` |
| C | **5d** | Custom player colors | Small–Medium | Claude Code | `types.ts`, `PlayerList.tsx`, lobby pages |

### Batch 6 — "Organized Play & Money"
*Goal: Tournaments, Lightning infrastructure, and multi-region. Independent systems.*

| Session | Item | What | Complexity | Tag | Key Files |
|---|---|---|---|---|---|
| A | **2c** | Tournament mode | Large | Claude Code | New `tournament/` module, bracket pages, DB tables |
| B | **4b** | Lightning payment infrastructure | Large | Manual Setup | New `lightning/` module, wallet tables, LN credentials |
| C | **4d** | Multi-region deployment | Medium | Manual Setup | `fly.toml`, Redis/Postgres provisioning, TODO(scale) fixes |

### Batch 7 — "Money Games & Distribution"
*Goal: Live money games and app store distribution. Depends on Batch 6 for Lightning infra (4b) and polish (3a).*

| Session | Item | What | Complexity | Tag | Key Files |
|---|---|---|---|---|---|
| A | **2f** | Bitcoin Lightning money games | Large | Manual Setup | `lightning/`, room escrow, deposit/withdraw UI |
| B | **5c** | Native mobile apps (Capacitor) | Medium–Large | Manual Setup | New `mobile/` directory, Capacitor config, store listings |

---

## Summary

| Category | Count | Items |
|---|---|---|
| **Quick Wins** | 4 | 1a–1d |
| **Core Features** | 6 | 2a–2f |
| **Polish** | 6 | 3a–3f |
| **Infrastructure** | 5 | 4a–4e |
| **Future Vision** | 4 | 5a–5d |
| **Total** | **25** | Across 7 batches |

| Tag | Count |
|---|---|
| **Claude Code** | 18 items (fully implementable in sessions) |
| **Manual Setup** | 7 items (require external accounts, credentials, or asset sourcing) |

The sequencing prioritizes **perception** (making the game feel premium) → **engagement** (reasons to come back daily) → **competition** (social + ranked depth) → **monetization** (Lightning integration) → **distribution** (app stores). Each batch builds on the prior one, and items within a batch are safe to develop in parallel.
