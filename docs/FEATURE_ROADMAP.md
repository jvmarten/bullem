# Bull 'Em — Feature Roadmap

> Generated 2026-03-14 from a full codebase audit. Replaces all previous roadmaps.
>
> Items are prioritized by user impact and grouped by effort level.
> Each item is tagged: **Claude Code** (can be fully implemented in a session) or **Manual Setup** (requires external service config, credentials, or similar).

---

## What's Already Shipped

The codebase is production-grade and feature-rich. These do **not** need work:

| Area | Details |
|---|---|
| **Game engine** | Pure state machine in `shared/`, 17+ test files, all hand types, joker support, deck variants, edge cases, regressions |
| **Security** | Server-authoritative, cards never leaked, input validated, reconnect tokens rotated, rate limiting (sliding window + cooldown) |
| **Bot AI** | 81 bot profiles: 72 heuristic (9 personalities × 8 levels) + 9 CFR bots (level 9), cross-round memory, evolved parameters |
| **Mobile UX** | Wheel pickers, touch targets (44px+), responsive portrait/landscape layouts, no hover-only interactions, safe area insets |
| **App shell** | `100dvh`, `overscroll-behavior: none`, inner scroll containers, `touch-action: manipulation` — feels native |
| **PWA** | Service worker via vite-plugin-pwa, web manifest, precached assets, auto-update on deploy, installable to home screen |
| **Keyboard shortcuts** | B/T/R/P/Esc/Enter in game via `useGameKeyboardShortcuts.ts` |
| **Accessibility (partial)** | `:focus-visible` outlines, skip-to-main link, `prefers-reduced-motion` media query, `ScreenReaderAnnouncerProvider`, four-color deck option |
| **Card animations** | Deal with staggered delays, card flip reveal, reveal sequence, mini-deal, avatar pulse ring |
| **Elimination** | Opacity fade + "OUT" badge, toast notifications, spectator transition |
| **Sound + Haptics** | 25 contextual sounds, MP3 pre-decoding, oscillator UI tones, haptic vibration patterns, iOS recovery |
| **Matchmaking** | Redis-backed queue with Glicko-2 rating, bot backfill, heads-up + multiplayer modes, ranked queue overlay |
| **Leaderboard** | Paginated, time-filtered (all-time/month/week), per-mode, current-user rank card, rank tiers with badges |
| **Player accounts** | JWT auth, bcrypt, Google OAuth, Apple OAuth, avatar selection, profile photo upload (Tigris S3), username changes |
| **Advanced stats** | Rating history chart, hand-type breakdown, bluff heat map, win probability, career trajectory, rivalry stats, shareable stat cards |
| **In-game stats** | Live win probability, bluff detection, hand strength indicators during gameplay |
| **Replays** | Server-side persistence, browsable gallery, step-through viewer with auto-play + keyboard, deep-linking to rounds |
| **Spectator mode** | Full support with configurable card visibility, chat, emoji reactions, spectator pill badge |
| **Chat + Emoji** | Collapsible chat panel, floating emoji reactions, rate-limited, sanitized, toggleable per-user |
| **Quick Play** | One-tap button for instant local game with bots |
| **Quick Draw chips** | Suggested raises above hand selector with contextual hints |
| **Deck Draw minigame** | 5-card draw + Five Draw variant with wagering (play-money), daily free draw, lifetime stats, server-synced |
| **Win confetti** | Gold-themed canvas-confetti burst on results screen (respects reduced motion) |
| **QR code invites** | QR code generation in lobby for easy room sharing |
| **Recent players** | Tracks and displays recently played-with players on home page |
| **Interactive tutorial** | Scripted walkthrough teaching core mechanics with mock game |
| **Best-of series** | 1v1 Bo1/Bo3/Bo5 support, ranked 1v1 always Bo3 |
| **Friends system** | Friends list, friend requests, online status, invite-to-game, dedicated FriendsPage |
| **Push notifications** | Web Push with PostgreSQL-persisted subscriptions, VAPID config |
| **Post-game results** | Player ranking reveal animation, game stats display, share card, rematch queue |
| **Data visualizations** | BluffHeatMap, CareerTrajectory, WinProbabilityGraph, RivalryStats, ShareableStatCard (lazy-loaded with recharts) |
| **Profile photos** | Upload to Tigris S3 object storage with CDN |
| **Scale infra** | Redis adapter for Socket.io, Redis session persistence (24h TTL), Redis rate limiting, read replicas |
| **DB resilience** | Exponential backoff with jitter, degraded mode fallback, auto-reconnection, 23 migrations applied |
| **Observability** | Pino structured logging, Sentry integration, Prometheus metrics (`/metrics`), health checks (`/health`), admin analytics dashboard |
| **E2E tests** | Socket.io integration tests for lobby and game flows |
| **CI/CD** | Parallel tests, auto-merge to develop, Docker validation, gated production deploys |
| **Admin panel** | User management, analytics, bot management REST endpoints |
| **Project email** | Resend API integration for password reset emails with HTML/plaintext templates |
| **Bot calibration** | Continuous round-robin calibration pipeline with convergence detection, genetic evolution training |
| **Analytics** | Event pipeline (`track()`), analytics_balance_snapshot table, game persistence, admin dashboard |

---

## 1. Quick Wins (Small effort, noticeable improvement)

### 1a. Bot Personality Flavor Text in Gameplay
**What:** Show bot flavor text alongside their actions in the call history during gameplay (e.g., Bot Brady: *"I wouldn't bet on that..."* when calling bull). `shared/src/botProfiles.ts` already defines `BotFlavorText` with quips for `callBull`, `caughtBluffing`, `winRound`, `bigRaise`, and `eliminated`. Currently this text only surfaces in `BotProfileModal` and `PublicProfilePage` — not during actual gameplay.
**Why:** Playing against bots feels mechanical. Personality text makes local games more entertaining with zero server changes — all data already exists.
**Touches:** `client/src/components/CallHistory.tsx` (render flavor text for bot players), `client/src/pages/GamePage.tsx` + `LocalGamePage.tsx` (pass bot profile data to CallHistory)
**Complexity:** Small
**Dependencies:** None
**Tag:** Claude Code

### 1b. Per-Category Volume Sliders
**What:** Add separate volume controls for SFX and UI sounds. Currently `soundEngine.ts` has a single master volume. Add category-aware volume multipliers so players can mute game sounds but keep UI clicks, or vice versa. Update `VolumeControl.tsx` with a multi-slider UI.
**Why:** Sound is critical to game feel, but a single volume slider forces all-or-nothing. Per-category control is standard in quality games and takes little effort given the existing sound infrastructure.
**Touches:** `client/src/hooks/soundEngine.ts` (add category volumes), `client/src/components/VolumeControl.tsx` (multi-slider UI), `client/src/hooks/useSound.ts` (pass category to play calls)
**Complexity:** Small
**Dependencies:** None
**Tag:** Claude Code

### 1c. Finish Accessibility Quick Wins
**What:** The accessibility foundation is ~85% complete. Remaining work: (1) Add focus trapping to modals — hand selector, reveal overlay, settings panel, bot profile modal — so keyboard Tab cycles within the modal and Escape closes + restores focus. (2) Verify all 20+ CSS animations respect `prefers-reduced-motion` (global media query exists but may miss edge cases in `transition` and `transform` usage). (3) Verify wheel picker keyboard navigation works end-to-end (arrow keys to scroll, Enter to select).
**Why:** The hard parts (`:focus-visible`, skip link, `prefers-reduced-motion` media query, `ScreenReaderAnnouncerProvider`) are already shipped. This closes the remaining 15% to achieve a solid WCAG AA keyboard/motion baseline.
**Touches:** `client/src/components/WheelPicker.tsx` (keyboard nav audit), modal components (`HandSelector`, `RevealOverlay`, `VolumeControl`, `BotProfileModal`) for focus trapping, `client/src/styles/index.css` (audit animation edge cases)
**Complexity:** Small
**Dependencies:** None
**Tag:** Claude Code

### 1d. Wire Up Matchmaking Analytics
**What:** The analytics pipeline (`server/src/analytics/track.ts`) defines two untracked events: `matchmaking:queued` and `matchmaking:matched`. The `MatchmakingQueue` is fully operational but doesn't call `track()`. Add 2-3 lines to emit these events with mode, rating, wait time, and rating spread.
**Why:** Without these events, there's no visibility into queue health — can't monitor wait times, match quality, or rating spread distribution. The code paths exist; just needs the `track()` calls.
**Touches:** `server/src/matchmaking/MatchmakingQueue.ts` (add `track()` calls at queue join and match found)
**Complexity:** Small
**Dependencies:** None
**Tag:** Claude Code

### 1e. Wire Up `fromMatchmaking` Flag in Game Persistence
**What:** `server/src/socket/persistGame.ts:206` hardcodes `fromMatchmaking: false` when persisting ranked matches. The `MatchmakingQueue` already knows whether a game came from matchmaking — pass that signal through room metadata so analytics can distinguish matchmade games from manual room games.
**Why:** Ranked analytics can't differentiate player-created rooms from matchmade games. Critical for understanding whether matchmaking is creating balanced, engaging games.
**Touches:** `server/src/socket/persistGame.ts` (read flag from room), `server/src/rooms/Room.ts` or room metadata (store matchmaking origin)
**Complexity:** Small
**Dependencies:** None
**Tag:** Claude Code

### 1f. Better Sound Effects
**What:** Audit and replace game sounds with more distinctive, premium audio: bull call (buzzer/horn), true call (bell/chime), raise (chip slide), elimination (dramatic thud). Ensure all sounds are short (<1s), compressed (<50KB each), and lazy-loaded.
**Why:** Sound is 50% of game feel. Distinctive audio makes gameplay feel tactile and builds brand identity. Current sounds are functional but not memorable.
**Touches:** `client/src/assets/sounds/` (new/replacement audio files), `client/src/hooks/soundEngine.ts` (new sound entries)
**Complexity:** Small–Medium
**Dependencies:** 1b (per-category volume) ideally ships first so new sounds respect category controls
**Tag:** Manual Setup (sourcing/licensing audio assets)

---

## 2. Core Features (Meaningful additions that make the product more complete)

### 2a. Seasonal Ranked Play
**What:** Time-limited ranked seasons (e.g., monthly) with soft rating resets, season rewards (cosmetic badges), placement matches (5 games), and end-of-season leaderboard snapshots. Season history viewable on profile. Wire season awareness into the existing `MatchmakingQueue` and leaderboard queries.
**Why:** Without seasons, once you reach a high rank there's no reason to keep playing ranked. Seasonal resets keep the competitive ladder fresh and create recurring engagement peaks.
**Touches:** `server/src/matchmaking/MatchmakingQueue.ts` (season logic, placement handling), new DB migration (seasons + season_ratings tables), `server/src/db/leaderboard.ts` (season filter), `client/src/pages/LeaderboardPage.tsx` (season tabs/selector), `client/src/components/RankBadge.tsx` (season badge display), `shared/src/types.ts` (season types)
**Complexity:** Medium
**Dependencies:** None (matchmaking and leaderboard already shipped)
**Tag:** Claude Code

### 2b. Tournament Mode
**What:** Structured tournament brackets for 8/16/32 players. Single-elimination format. Auto-created rooms for each match, bracket visualization with real-time updates via Socket.io, and final standings. Tournament lobby with registration, countdown to start, and bracket seeding (random or by rating).
**Why:** Tournaments are the ultimate competitive format. They create scheduled events that players plan around and invite friends to. Tournament results drive leaderboard engagement and social sharing.
**Touches:** new `server/src/tournament/` module (bracket engine, match scheduling, result tracking), `shared/src/types.ts` (tournament types), new `client/src/pages/TournamentPage.tsx` + `TournamentBracketPage.tsx`, new DB migration (tournament tables)
**Complexity:** Large
**Dependencies:** None (best-of series already shipped)
**Tag:** Claude Code

### 2c. Custom Player Colors
**What:** Let players pick a color (from a curated palette of 12 options) when joining a room. Display as a colored ring around their avatar in the player list and turn indicator. Persist in localStorage for guests, in account for logged-in users.
**Why:** With 6–12 players, avatar icons alone aren't distinctive enough at a glance. Custom colors help players identify each other instantly, especially on small screens.
**Touches:** `shared/src/types.ts` (player color field), `client/src/components/PlayerList.tsx` (colored ring), `client/src/pages/LobbyPage.tsx` + `LocalLobbyPage.tsx` (color picker), `server/src/socket/lobbyHandlers.ts` (validate color)
**Complexity:** Small–Medium
**Dependencies:** None
**Tag:** Claude Code

### 2d. Bitcoin Lightning Integration (Money Games)
**What:** Integrate Bitcoin Lightning Network payments for real-money wagering. Players deposit sats via Lightning invoice to an in-game wallet, join money tables with fixed buy-ins, and winnings are paid out instantly. Requires: custodial wallet service (LNbits, Strike API, or Voltage), deposit/withdrawal UI, buy-in escrow logic, regulatory compliance check by jurisdiction. Opt-in only (never default). House takes a small rake (1–3%).
**Why:** Bluffing games are a natural fit for stakes. Lightning enables instant, low-fee, borderless micropayments that work for $0.10 or $100 buy-ins. This is a monetization path that aligns incentives with players (rake, not ads or loot boxes).
**Touches:** new `server/src/lightning/` module (LN provider integration, wallet management, escrow), `shared/src/types.ts` (money game types, buy-in levels), `server/src/rooms/Room.ts` (escrow lifecycle), new client pages (deposit/withdraw UI, money table lobby), new DB migration (wallet balances, transaction history)
**Complexity:** Large
**Dependencies:** 4a (Lightning payment infrastructure must be built first), legal review for target jurisdictions
**Tag:** Manual Setup (LN provider account, legal review, payment credentials)

### 2e. Spectator "Watch Live" Tab
**What:** Build a "Watch Live" tab showing active games that allow spectators. Click to drop into any game as a spectator with real-time card visibility (if host allows). Show game metadata: player count, round number, time elapsed. Prioritize high-rated or money games. The server-side infrastructure already exists — `RoomManager.getSpectateableGames()` returns the data.
**Why:** Spectating builds community and lets new players learn by watching. "Watch a random game" already exists as a button — this elevates it to a browsable, always-available feature that keeps eliminated or waiting players engaged.
**Touches:** new `client/src/pages/WatchPage.tsx` (game browser with filters), `client/src/components/Layout.tsx` (nav link), `server/src/rooms/RoomManager.ts` (already has `getSpectateableGames` — may need sorting/filtering params)
**Complexity:** Small–Medium
**Dependencies:** None
**Tag:** Claude Code

---

## 3. Polish (UX improvements, animations, edge case handling)

### 3a. Aesthetic UI Overhaul — "Premium Feel"
**What:** Elevate the visual design to feel premium and app-like: (1) Glassmorphism refinement — consistent `backdrop-filter: blur()` intensity, subtle gradient overlays, glow effects on interactive elements. (2) Micro-animations — button press scaling (`transform: scale(0.97)`), page transitions (slide/fade between routes via CSS), card hover effects. (3) Typography hierarchy — leverage the existing Space Grotesk / Big Shoulders / Inter font stack with more intentional sizing and weight variation. (4) Dark theme refinement — richer backgrounds (subtle noise texture overlay), warmer `--felt` tones, deeper `--surface` layering. (5) Skeleton loading screens everywhere (leaderboard already has the pattern — extend to profile, stats, replays).
**Why:** The current UI is clean and functional but doesn't make players say "wow." Premium visuals drive word-of-mouth sharing ("look at this game") and justify real-money stakes. The goal is "this looks like it cost $500K to build."
**Touches:** `client/src/styles/index.css` (global theme refinements, new animations, design tokens), component files (micro-animations), `client/src/components/Layout.tsx` (page transitions)
**Complexity:** Medium (spread across many files but each change is individually small)
**Dependencies:** None
**Tag:** Claude Code

### 3b. Better Reveal Overlay with Card Table
**What:** Redesign the round-end reveal to show a virtual table view: all players' cards laid out in a circle/arc formation (using the existing `roundtablePositions` util), with the called hand highlighted if it exists. Animate cards flipping from face-down to face-up in sequence. Show matching cards with a glow effect. Leverage the existing `RoundtableRevealOverlay` and `RoundtableDealingOverlay` patterns.
**Why:** The reveal is the "moment of truth" — the most dramatic moment in every round. A visual card table layout makes it more exciting and easier to parse at a glance than the current approach.
**Touches:** `client/src/components/RevealOverlay.tsx` + `RoundtableRevealOverlay.tsx` (redesign), new CSS for card layout + flip animations
**Complexity:** Medium
**Dependencies:** None
**Tag:** Claude Code

### 3c. Landscape Mode — Round Card Table Polish
**What:** Full landscape polish for the existing roundtable layout: (1) Optimize player seat positions and avatar sizing for tablet aspect ratios. (2) Collapsible sidebar for call history/stats so the table gets maximum screen space. (3) Ensure hand selector modal doesn't obscure game state in landscape. (4) Test on actual tablets for touch target sizing. The roundtable layout exists (`RoundtableGameLayout.tsx`) — this is about refining it.
**Why:** Tablet users are a significant audience for card games. The roundtable layout works but was developed primarily in portrait. Polish here makes landscape feel intentional rather than incidental.
**Touches:** `client/src/pages/GamePage.tsx` + `LocalGamePage.tsx` (landscape layout refinements), `client/src/components/RoundtableGameLayout.tsx` (seat optimization), CSS media queries
**Complexity:** Medium
**Dependencies:** None
**Tag:** Claude Code

### 3d. Onboarding Improvements
**What:** Extend the interactive tutorial to cover: (1) All hand types with the custom ranking (flush < three of a kind — the #1 source of confusion). (2) Contextual tooltips during the first real game (e.g., "This is the hand selector — pick a hand higher than the current call") via the existing `GameTooltips` and `TutorialOverlay` components. (3) A "first game" mode that auto-selects easier bots and fewer players. (4) Visual ranking comparison chart that stays accessible from the rules page.
**Why:** New players don't understand the custom hand rankings. Better onboarding reduces churn in the critical first game. Every player who bounces is a lost referral.
**Touches:** `client/src/pages/TutorialPage.tsx` (expanded hand coverage), `client/src/components/TutorialOverlay.tsx` (contextual tips), `client/src/components/GameTooltips.tsx` (first-game tooltips), `client/src/utils/tutorialProgress.ts` (track first game)
**Complexity:** Medium
**Dependencies:** None
**Tag:** Claude Code

### 3e. Full Accessibility Audit
**What:** Comprehensive a11y pass beyond the quick wins in 1c: (1) ARIA labels on all interactive elements — currently ~29 instances across 19 files, needs significant expansion (buttons, form fields, game state announcements). (2) Color contrast audit against WCAG AA (4.5:1 for normal text, 3:1 for large text) — verify all design tokens (`--gold`, `--danger`, `--info`, `--safe` against `--felt` backgrounds). (3) Screen reader announcements for game phase transitions (round start, turn changes, bull/true calls, results). (4) `inert` attribute on background content when modals are open.
**Why:** Accessibility is a quality bar, not a feature. Required for reaching wider audiences and a prerequisite for Apple App Store review (VoiceOver support required).
**Touches:** All component files in `client/src/components/` (ARIA attributes), `client/src/pages/` (announcements), `client/src/styles/index.css` (color contrast fixes), `client/src/context/ScreenReaderAnnouncerProvider.tsx` (more announcements)
**Complexity:** Medium
**Dependencies:** 1c (accessibility quick wins) should ship first as the foundation
**Tag:** Claude Code

### 3f. Game History & Stats Deep Linking
**What:** Make individual game results, stat breakdowns, and replay moments shareable via URL. Currently replays support deep-linking (`/replay/:gameId?round=3`) but stats and game history don't. Add: (1) Shareable profile stat cards via URL (`/u/:username/stats`). (2) Individual game result pages (`/game/:gameId/results`). (3) Open Graph meta tags for social preview cards when sharing links.
**Why:** Social sharing is the primary growth channel for casual games. When a player shares a wild replay moment or an impressive stat card, the link preview needs to look great in iMessage, Discord, Twitter, etc.
**Touches:** `client/src/pages/PublicProfilePage.tsx` (stat deep links), new route for game result view, `client/index.html` (OG meta tags), server-side rendering for OG previews (or static generation)
**Complexity:** Medium
**Dependencies:** None
**Tag:** Claude Code

---

## 4. Infrastructure (Not user-facing, but unblocks future growth)

### 4a. Lightning Payment Infrastructure
**What:** Build the payment backend needed for money games (2d): LN node connection (LNbits/Voltage/Strike API), invoice generation, payment verification, wallet balance tracking, withdrawal processing, transaction logging with full audit trail. All behind a feature flag (`LIGHTNING_ENABLED=true`). Includes webhook handler for payment confirmations.
**Why:** Prerequisite for 2d (Bitcoin Lightning money games). Separating the infra from the game integration allows the payment system to be tested and hardened independently.
**Touches:** new `server/src/lightning/` module, new DB migration (wallet + transaction tables), `.env` (LN provider credentials)
**Complexity:** Large
**Dependencies:** None
**Tag:** Manual Setup (LN provider account creation, API keys, node setup)

### 4b. Multi-Region Deployment & TODO(scale) Fixes
**What:** Expand from single-region ("arn") to multi-region on Fly.io. Resolve all `TODO(scale)` markers that break under multiple instances. This includes:

1. **CORS origins** (`server/src/index.ts:56`) — configure `CORS_ORIGINS` env var for multi-domain serving
2. **Rate limiting** (`server/src/rateLimit.ts:205`) — enforce Redis-backed rate limits across instances (critical — in-memory fallback breaks per-user limits)
3. **OAuth state store** (`server/src/auth/oauth.ts:23`) — externalize to Redis with 10-min TTL (critical — OAuth callback on wrong instance fails silently)
4. **Leaderboard cache** (`server/src/db/leaderboard.ts:14`) — replace in-memory TTL cache with Redis (doubles DB load per instance without it)
5. **Online player names** (`server/src/index.ts:1076`) — aggregate via Redis pub/sub or shared store
6. **Socket lookup** (`server/src/socket/friendHandlers.ts:23`) — consider Redis-backed userId→socketId index instead of `io.fetchSockets()` scan
7. **Separate Redis clients** (`server/src/index.ts:166`) — dedicated clients for rate limiting vs matchmaking
8. **Prometheus metrics** (`server/src/metrics.ts:8`) — document that Prometheus scrapes all instances; no code change needed
9. **Matchmaking flag** (`server/src/socket/persistGame.ts:206`) — wire `fromMatchmaking` through room metadata

Infrastructure provisioning: add Fly.io region (e.g., "iad"), configure Redis primary/replica, Postgres read replicas (already supported via `readPool`).

**Why:** Players outside Northern Europe experience 100–200ms latency. A US region cuts that to <50ms for North American players. The architecture is already designed for this — all game state is serializable, Socket.io has Redis adapter, read replicas are supported.
**Touches:** `fly.toml`, `server/src/index.ts`, `server/src/rateLimit.ts`, `server/src/auth/oauth.ts`, `server/src/db/leaderboard.ts`, `server/src/metrics.ts`, `server/src/socket/friendHandlers.ts`, `server/src/socket/persistGame.ts`
**Complexity:** Medium
**Dependencies:** None (architecture already supports it)
**Tag:** Manual Setup (Fly.io region + Redis/Postgres provisioning) + Claude Code (9 code fixes)

---

## 5. Future Vision (Longer-term, high-impact)

### 5a. Native Mobile Apps (Capacitor)
**What:** Wrap the web app in Capacitor for iOS and Android app store distribution. Capacitor config already exists (`capacitor.config.ts`) pointing at the production URL. Remaining work: (1) Bundle assets locally (currently loads from `https://bullem.cards` — requires environment-aware socket/API URLs). (2) Native push notifications via APNs/FCM (replacing Web Push). (3) Richer haptic engine (beyond Vibration API). (4) App icon badge for turn notifications. (5) App store assets (icons, screenshots, descriptions). (6) iOS signing certificates and Android key store.
**Why:** App store presence is the #1 growth channel for mobile games. Web apps have friction (no home screen icon by default, Safari limitations). The web app already works great on mobile — the native wrapper adds distribution and native APIs.
**Touches:** `client/capacitor.config.ts` (switch to bundled assets), new platform-specific code for push/haptics, app store assets
**Complexity:** Medium–Large
**Dependencies:** 3a (aesthetic polish for screenshots), 3e (accessibility for Apple VoiceOver review)
**Tag:** Manual Setup (Apple Developer account $99/yr, Google Play Console $25, signing certs, store listings)

### 5b. In-App Currency & Cosmetics Shop
**What:** Introduce an in-app currency (earned through play, daily draws, and achievements) redeemable for cosmetic items: card back designs, table felt colors, avatar frames, victory animations. No gameplay advantage — purely cosmetic. Includes: currency balance tracking, shop catalog with pricing, inventory system, equip/unequip flow, and visual preview.
**Why:** Cosmetics create long-term engagement loops ("I want to unlock the gold card back"). They're also a clean free-to-play monetization path that doesn't affect gameplay balance. Works alongside Lightning money games without conflict.
**Touches:** new DB migration (currency_balances, inventory, shop_catalog tables), new `server/src/shop/` module (catalog, purchase, inventory APIs), new `client/src/pages/ShopPage.tsx`, `shared/src/types.ts` (cosmetic types, currency types), game rendering components (apply equipped cosmetics)
**Complexity:** Large
**Dependencies:** None (but best after 3a aesthetic overhaul for visual consistency)
**Tag:** Claude Code

### 5c. Achievement System
**What:** Track and display achievements: gameplay milestones (first win, 100 games played, royal flush called), challenge-based (win 5 games in a row, correctly call bull 10 times in one game), and rare events (win with only high cards, survive 10 rounds with max cards). Display on profile with unlock dates. Achievement toast notifications in-game.
**Why:** Achievements give casual players goals beyond winning and reward exploration of game mechanics. They're also shareable content that drives social engagement.
**Touches:** `shared/src/types.ts` (achievement definitions), new DB migration (achievements + player_achievements tables), `server/src/socket/gameHandlers.ts` (detection hooks at round/game end), `client/src/pages/ProfilePage.tsx` (achievement showcase), `client/src/components/` (toast for unlocks)
**Complexity:** Medium
**Dependencies:** None
**Tag:** Claude Code

### 5d. Daily Challenges & Missions
**What:** Daily rotating challenges (e.g., "Win 3 games today", "Call bull correctly 5 times", "Win a game using only high card calls") that reward in-app currency or achievement progress. Weekly challenges for bigger rewards. Challenge progress visible on the home page.
**Why:** Daily challenges are the #1 driver of daily active users in mobile games. They give players a reason to open the app every day even when friends aren't online. Works perfectly with the bot system for solo challenge completion.
**Touches:** new `server/src/challenges/` module (challenge definitions, rotation, progress tracking), new DB migration (daily_challenges, challenge_progress tables), `client/src/pages/HomePage.tsx` (challenge display), `shared/src/types.ts` (challenge types)
**Complexity:** Medium
**Dependencies:** 5b (in-app currency) for rewards, or can ship standalone with XP/stats rewards
**Tag:** Claude Code

### 5e. Clan/Team System
**What:** Let players form clans (2–50 members) with a shared name, tag, and banner. Clan leaderboard aggregates member ratings. Clan chat channel. Clan vs clan challenges (aggregate wins). Clan recruitment page.
**Why:** Social bonds are the strongest retention mechanic. Players who are part of a clan have 3–5x higher retention than solo players (industry standard). Clans also create organic growth as members recruit friends.
**Touches:** new DB migration (clans, clan_members, clan_invites tables), new `server/src/clans/` module, new `client/src/pages/ClanPage.tsx`, `client/src/pages/LeaderboardPage.tsx` (clan tab), Socket.io events for clan chat
**Complexity:** Large
**Dependencies:** None (friends system already exists as foundation)
**Tag:** Claude Code

---

## Existing TODO(scale) Markers in Code

| Location | What | When to Address | Roadmap Item |
|---|---|---|---|
| `server/src/index.ts:56` | CORS origins hardcoded for single domain | Multi-domain / CDN serving | 4b |
| `server/src/index.ts:166` | Single Redis client for adapter + rate limiting + matchmaking | Very high scale (100k+ concurrent) | 4b |
| `server/src/index.ts:1076` | `getOnlinePlayerNames()` returns only this instance's data | Multi-instance deployment | 4b |
| `server/src/db/leaderboard.ts:14` | In-memory leaderboard cache (TTL-based) | Replace with Redis cache at multi-instance | 4b |
| `server/src/rateLimit.ts:205` | In-memory rate limiting fallback (single instance only) | **Critical** — must use REDIS_URL at multi-instance | 4b |
| `server/src/metrics.ts:8` | Per-instance Prometheus metrics (no aggregation) | Prometheus scrapes all instances — low priority | 4b |
| `server/src/socket/friendHandlers.ts:23` | `io.fetchSockets()` scans all sockets via Redis adapter | Redis-backed userId→socketId index at very high scale | 4b |
| `server/src/auth/oauth.ts:23` | OAuth state store in-memory Map (10-min TTL) | **Critical** — OAuth fails cross-instance without Redis | 4b |
| `server/src/socket/persistGame.ts:206` | `fromMatchmaking: false` hardcoded | Wire up when connecting matchmaking to persistence | 1e |
| `server/src/analytics/track.ts:17-18` | `matchmaking:queued` and `matchmaking:matched` not tracked | Wire up `track()` calls in MatchmakingQueue | 1d |
| `client/capacitor.config.ts:8` | Loads app from production URL, not bundled assets | Bundle locally when socket/API URLs are env-aware | 5a |
| `.github/workflows/deploy.yml:33` | flyctl-actions pinned to Node 20 (1.5) | Update when Node 24 version released | — |

---

## Suggested Sequencing

Items within each batch can be run as **parallel Claude Code sessions** without logical conflicts. Each batch depends only on prior batches being complete. Order: quick wins → premium feel → engagement features → competitive depth → monetization infrastructure → distribution.

### Batch 1 — "Quick Wins"
*Goal: Small, independent improvements with no shared file conflicts. Closes gaps in analytics, accessibility, and game feel.*

| Session | Item | What | Complexity | Tag | Key Files |
|---|---|---|---|---|---|
| A | **1a** | Bot personality flavor text in gameplay | Small | Claude Code | `CallHistory.tsx`, `GamePage.tsx`, `LocalGamePage.tsx` |
| B | **1b** | Per-category volume sliders | Small | Claude Code | `soundEngine.ts`, `VolumeControl.tsx`, `useSound.ts` |
| C | **1c** | Finish accessibility quick wins (focus trapping, motion audit) | Small | Claude Code | `WheelPicker.tsx`, modal components, `index.css` |
| D | **1d** | Wire up matchmaking analytics | Small | Claude Code | `MatchmakingQueue.ts`, `track.ts` |
| E | **1e** | Wire up `fromMatchmaking` flag | Small | Claude Code | `persistGame.ts`, `Room.ts` |

*Note: Sessions C and B both touch `soundEngine.ts` minimally (C audits haptics, B adds categories) — safe to parallelize as they touch different functions. Sessions D and E are fully independent server-side changes.*

### Batch 2 — "Casino Quality"
*Goal: Visual and audio polish that makes the game feel premium. Sessions touch different component systems.*

| Session | Item | What | Complexity | Tag | Key Files |
|---|---|---|---|---|---|
| A | **1f** | Better sound effects | Small–Medium | Manual Setup | `assets/sounds/`, `soundEngine.ts` |
| B | **3a** | Aesthetic UI overhaul — "premium feel" | Medium | Claude Code | `index.css`, component styles, `Layout.tsx` |
| C | **3b** | Better reveal overlay with card table | Medium | Claude Code | `RevealOverlay.tsx`, `RoundtableRevealOverlay.tsx`, CSS |
| D | **3c** | Landscape mode / round card table polish | Medium | Claude Code | Game pages, `RoundtableGameLayout.tsx`, CSS media queries |

*Note: B and C have minimal overlap (B is global theme, C is reveal-specific). D only touches game page layout, not global styles.*

### Batch 3 — "Engagement & Discovery"
*Goal: Features that reduce churn, increase daily usage, and help new players. All touch different page/module boundaries.*

| Session | Item | What | Complexity | Tag | Key Files |
|---|---|---|---|---|---|
| A | **3d** | Onboarding improvements | Medium | Claude Code | `TutorialPage.tsx`, `TutorialOverlay.tsx`, `GameTooltips.tsx` |
| B | **2c** | Custom player colors | Small–Medium | Claude Code | `types.ts` (player color field), `PlayerList.tsx`, lobby pages |
| C | **2e** | Spectator "Watch Live" tab | Small–Medium | Claude Code | New `WatchPage.tsx`, `Layout.tsx` (nav link), `RoomManager.ts` |
| D | **3f** | Game history & stats deep linking | Medium | Claude Code | `PublicProfilePage.tsx`, new route, OG meta tags |

*Note: B touches `types.ts` (adds a field) — no conflict with other sessions. C adds a new page and nav link.*

### Batch 4 — "Competitive Depth"
*Goal: Ranked seasons, achievements, and full accessibility — the features that turn casual players into regulars.*

| Session | Item | What | Complexity | Tag | Key Files |
|---|---|---|---|---|---|
| A | **2a** | Seasonal ranked play | Medium | Claude Code | `MatchmakingQueue.ts`, new DB migration, `LeaderboardPage.tsx`, `RankBadge.tsx` |
| B | **3e** | Full accessibility audit | Medium | Claude Code | All components (ARIA), `index.css` (contrast), `ScreenReaderAnnouncerProvider.tsx` |
| C | **5c** | Achievement system | Medium | Claude Code | New DB migration, `gameHandlers.ts` (hooks), `ProfilePage.tsx` (display) |

*Note: A touches matchmaking/leaderboard, B touches component ARIA/CSS, C touches game handlers/profile — no conflicts.*

### Batch 5 — "Engagement Loops"
*Goal: Daily reasons to return. Depends on Batch 4 for achievement system (5c) as reward target.*

| Session | Item | What | Complexity | Tag | Key Files |
|---|---|---|---|---|---|
| A | **5d** | Daily challenges & missions | Medium | Claude Code | New `challenges/` module, `HomePage.tsx`, new DB migration |
| B | **5b** | In-app currency & cosmetics shop | Large | Claude Code | New `shop/` module, new DB tables, new `ShopPage.tsx` |

*Note: These are independent systems. 5d can use XP/stats rewards initially if 5b isn't ready, but ideally ships together for currency rewards.*

### Batch 6 — "Scale & Money Infrastructure"
*Goal: Backend infrastructure for growth and monetization. Independent systems — no file conflicts.*

| Session | Item | What | Complexity | Tag | Key Files |
|---|---|---|---|---|---|
| A | **4a** | Lightning payment infrastructure | Large | Manual Setup | New `lightning/` module, wallet DB tables, LN credentials |
| B | **4b** | Multi-region deployment + TODO(scale) fixes | Medium | Manual Setup + Claude Code | `fly.toml`, `index.ts`, `rateLimit.ts`, `oauth.ts`, `leaderboard.ts` |
| C | **5e** | Clan/team system | Large | Claude Code | New `clans/` module, new DB tables, new `ClanPage.tsx` |

*Note: A and B are both infrastructure but touch different files. C is a social feature with its own module.*

### Batch 7 — "Money Games & Tournaments"
*Goal: Premium game modes. Depends on Batch 6 for Lightning infra (4a) and multi-region (4b).*

| Session | Item | What | Complexity | Tag | Key Files |
|---|---|---|---|---|---|
| A | **2d** | Bitcoin Lightning money games | Large | Manual Setup | `lightning/` module, room escrow, deposit/withdraw UI |
| B | **2b** | Tournament mode | Large | Claude Code | New `tournament/` module, bracket pages, DB tables |

*Note: 2d depends on 4a (Lightning infra). 2b is independent but placed here for competitive feature cohesion. Both create new modules — no file conflicts.*

### Batch 8 — "Native Apps"
*Goal: App store distribution. Depends on Batch 4 (3e accessibility for Apple review) and Batch 2 (3a aesthetic polish for screenshots).*

| Session | Item | What | Complexity | Tag | Key Files |
|---|---|---|---|---|---|
| A | **5a** | Native mobile apps (Capacitor) | Medium–Large | Manual Setup | `capacitor.config.ts`, platform-specific code, store assets |

---

## Summary

| Category | Count | Items |
|---|---|---|
| **Quick Wins** | 6 | 1a–1f |
| **Core Features** | 5 | 2a–2e |
| **Polish** | 6 | 3a–3f |
| **Infrastructure** | 2 | 4a–4b |
| **Future Vision** | 5 | 5a–5e |
| **Total** | **24** | Across 8 batches |

| Tag | Count |
|---|---|
| **Claude Code** | 17 items (fully implementable in sessions) |
| **Manual Setup** | 4 items (require external accounts, credentials, or asset sourcing) |
| **Manual Setup + Claude Code** | 3 items (code changes + external provisioning) |

The sequencing prioritizes **analytics & accessibility foundations** (Batch 1) → **premium visuals** (Batch 2) → **engagement & discovery** (Batch 3) → **competitive depth** (Batch 4) → **engagement loops** (Batch 5) → **scale infrastructure** (Batch 6) → **monetization** (Batch 7) → **distribution** (Batch 8). Each batch builds on the prior one, and items within a batch are safe to develop in parallel Claude Code sessions without logical conflicts.
