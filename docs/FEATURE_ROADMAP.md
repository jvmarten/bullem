# Bull 'Em — Feature Roadmap

> Generated 2026-03-23 from a full codebase audit. Replaces all previous roadmaps.
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
| **Accessibility (partial)** | `:focus-visible` outlines, skip-to-main link, `prefers-reduced-motion`, `ScreenReaderAnnouncerProvider`, four-color deck, focus trapping (RevealOverlay, BotProfileModal) |
| **Card animations** | Deal with staggered delays, card flip reveal, reveal sequence, mini-deal, avatar pulse ring |
| **Elimination** | Opacity fade + "OUT" badge, toast notifications, spectator transition |
| **Sound + Haptics** | 25 contextual sounds, MP3 pre-decoding, oscillator UI tones, per-category volume sliders, haptic vibration patterns, iOS recovery |
| **Matchmaking** | Redis-backed queue with rating-based matching, bot backfill, heads-up + multiplayer modes, ranked queue overlay |
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
| **DB resilience** | Exponential backoff with jitter, degraded mode fallback, auto-reconnection, 23+ migrations applied |
| **Observability** | Pino structured logging, Sentry integration, Prometheus metrics (`/metrics`), health checks (`/health`), admin analytics dashboard |
| **E2E tests** | Socket.io integration tests for lobby, game flows, session transfer |
| **CI/CD** | Auto-merge, Docker validation, gated production deploys |
| **Admin panel** | User management, analytics, room/socket management REST endpoints |
| **Bot calibration** | Continuous round-robin calibration pipeline with convergence detection, genetic evolution training |
| **Analytics** | Event pipeline (`track()`), analytics_balance_snapshot table, game persistence, admin dashboard |
| **Background games** | 6 spectatable bot games (3 heads-up, 3 multiplayer) running continuously |
| **Capacitor apps** | iOS and Android shipped — WebView loading from bullem.cards |

---

## 1. Quick Wins (Small effort, noticeable improvement)

### 1a. Bot Personality Flavor Text in Gameplay
**What:** Show bot flavor text alongside their actions in the call history (e.g., Rock: *"I wouldn't bet on that..."* when calling bull). `shared/src/botProfiles.ts` already defines `BotFlavorText` with quips for `callBull`, `caughtBluffing`, `winRound`, `bigRaise`, and `eliminated`. Currently this text only surfaces in `BotProfileModal` — not during actual gameplay.
**Why:** Playing against bots feels mechanical. Personality text makes local and online bot games more entertaining with zero server changes — all data already exists.
**Touches:** `client/src/components/CallHistory.tsx`, `client/src/pages/GamePage.tsx` + `LocalGamePage.tsx`
**Complexity:** Small
**Dependencies:** None
**Tag:** Claude Code

### 1b. Finish Accessibility Quick Wins
**What:** (1) Extend focus trapping to remaining modals — HandSelector, VolumeControl panel, settings panels (RevealOverlay and BotProfileModal already have it via `useFocusTrap`). (2) Verify all CSS animations respect `prefers-reduced-motion` (global media query exists but may miss edge cases in `transition` and `transform` usage). (3) Verify wheel picker keyboard navigation works end-to-end (arrow keys to scroll, Enter to select).
**Why:** The hard parts are shipped. This closes the remaining gap to achieve solid WCAG AA keyboard/motion baseline.
**Touches:** `WheelPicker.tsx`, `HandSelector.tsx`, `VolumeControl.tsx`, `index.css`
**Complexity:** Small
**Dependencies:** None
**Tag:** Claude Code

### 1c. Wire Up Matchmaking Analytics
**What:** The analytics pipeline (`server/src/analytics/track.ts`) defines two untracked events: `matchmaking:queued` and `matchmaking:matched`. The `MatchmakingQueue` is fully operational but doesn't call `track()`. Add 2–3 lines to emit these events with mode, rating, wait time, and rating spread.
**Why:** Without these events, there's no visibility into queue health — can't monitor wait times, match quality, or rating spread distribution.
**Touches:** `server/src/matchmaking/MatchmakingQueue.ts`
**Complexity:** Small
**Dependencies:** None
**Tag:** Claude Code

### 1d. Wire Up `fromMatchmaking` Flag in Game Persistence
**What:** `server/src/socket/persistGame.ts:206` hardcodes `fromMatchmaking: false`. The `MatchmakingQueue` already knows whether a game came from matchmaking — pass that signal through room metadata so analytics can distinguish matchmade games from manual room games.
**Why:** Ranked analytics can't differentiate player-created rooms from matchmade games.
**Touches:** `server/src/socket/persistGame.ts`, `server/src/rooms/Room.ts`
**Complexity:** Small
**Dependencies:** None
**Tag:** Claude Code

### 1e. Room Browser for Public Games
**What:** The server already supports public rooms (`isPublic` setting) and has `RoomManager.getSpectateableGames()`. Add a simple "Browse Games" section to the home page or a dedicated tab that lists public rooms accepting players (not just spectatable games). Show player count, settings, and a "Join" button.
**Why:** Currently players can only join via room code or invite link. A room browser lets strangers discover games, which is critical for growth when friends aren't online.
**Touches:** `client/src/pages/HomePage.tsx` (or new `BrowsePage.tsx`), `server/src/rooms/RoomManager.ts` (add `getJoinableRooms()`), Socket.io event for room list
**Complexity:** Small–Medium
**Dependencies:** None
**Tag:** Claude Code

### 1f. Rematch Flow Improvements
**What:** After a game ends, streamline the rematch flow: (1) "Rematch" button that keeps the same players and settings without returning to lobby. (2) Show who has voted for rematch (like "3/4 players ready"). (3) Auto-start when all remaining players accept. Currently players must navigate back to lobby.
**Why:** Friction between games kills sessions. Every extra tap is a chance for someone to leave. Quick rematch keeps groups playing longer.
**Touches:** `server/src/socket/roundTransition.ts`, `client/src/pages/ResultsPage.tsx` + `LocalResultsPage.tsx`, `server/src/rooms/Room.ts` (reset game state)
**Complexity:** Small–Medium
**Dependencies:** None
**Tag:** Claude Code

---

## 2. Core Features (Meaningful additions that make the product more complete)

### 2a. Seasonal Ranked Play
**What:** Time-limited ranked seasons (e.g., monthly) with soft rating resets, season rewards (cosmetic badges), placement matches (5 games), and end-of-season leaderboard snapshots. Season history viewable on profile. Wire season awareness into the existing `MatchmakingQueue` and leaderboard queries.
**Why:** Without seasons, once you reach a high rank there's no reason to keep playing ranked. Seasonal resets keep the competitive ladder fresh and create recurring engagement peaks.
**Touches:** `server/src/matchmaking/MatchmakingQueue.ts`, new DB migration (seasons + season_ratings tables), `server/src/db/leaderboard.ts`, `client/src/pages/LeaderboardPage.tsx`, `shared/src/types.ts`
**Complexity:** Medium
**Dependencies:** None
**Tag:** Claude Code

### 2b. Achievement System
**What:** Track and display achievements: gameplay milestones (first win, 100 games, royal flush called), challenge-based (win 5 in a row, correctly call bull 10 times), and rare events (win with only high cards, survive 10 rounds at max cards). Display on profile with unlock dates. Toast notifications in-game on unlock.
**Why:** Achievements give casual players goals beyond winning and reward exploration of game mechanics. They're shareable content that drives social engagement.
**Touches:** `shared/src/types.ts`, new DB migration, `server/src/socket/roundTransition.ts` (detection hooks), `client/src/pages/ProfilePage.tsx`, new toast component
**Complexity:** Medium
**Dependencies:** None
**Tag:** Claude Code

### 2c. Spectator "Watch Live" Tab
**What:** Build a "Watch Live" tab showing active games that allow spectators. Click to drop into any game as a spectator with real-time card visibility (if host allows). Show game metadata: player count, round number, time elapsed. The server-side infrastructure already exists — `BackgroundGameManager` runs 6 games continuously and `RoomManager` tracks spectatable rooms.
**Why:** Spectating builds community and lets new players learn by watching. "Watch a random game" already exists as a button — this elevates it to a browsable, always-available feature.
**Touches:** new `client/src/pages/WatchPage.tsx`, `client/src/components/Layout.tsx` (nav link), `server/src/rooms/RoomManager.ts` (may need sorting/filtering params)
**Complexity:** Small–Medium
**Dependencies:** None
**Tag:** Claude Code

### 2d. Custom Player Colors
**What:** Let players pick a color (from a curated palette of 12 options) when joining a room. Display as a colored ring around their avatar in the player list and turn indicator. Persist in localStorage for guests, in account for logged-in users.
**Why:** With 6–12 players, avatar icons alone aren't distinctive enough at a glance. Custom colors help players identify each other instantly, especially on small screens.
**Touches:** `shared/src/types.ts`, `client/src/components/PlayerList.tsx`, lobby pages, `server/src/socket/lobbyHandlers.ts`
**Complexity:** Small–Medium
**Dependencies:** None
**Tag:** Claude Code

### 2e. Tournament Mode
**What:** Structured tournament brackets for 8/16/32 players. Single-elimination format. Auto-created rooms for each match, bracket visualization with real-time updates via Socket.io, and final standings. Tournament lobby with registration, countdown to start, and bracket seeding (random or by rating).
**Why:** Tournaments are the ultimate competitive format. They create scheduled events that players plan around and invite friends to. Best-of series already provides the match infrastructure.
**Touches:** new `server/src/tournament/` module, `shared/src/types.ts`, new client pages (`TournamentPage.tsx`, `TournamentBracketPage.tsx`), new DB migration
**Complexity:** Large
**Dependencies:** None
**Tag:** Claude Code

---

## 3. Polish (UX improvements, animations, edge case handling)

### 3a. Aesthetic UI Overhaul — "Premium Feel"
**What:** Elevate the visual design: (1) Glassmorphism refinement — consistent `backdrop-filter: blur()`, subtle gradient overlays, glow effects on interactive elements. (2) Micro-animations — button press scaling, page transitions (slide/fade between routes), card hover effects. (3) Typography hierarchy — leverage Space Grotesk / Big Shoulders / Inter with more intentional sizing and weight variation. (4) Dark theme refinement — richer backgrounds (subtle noise texture overlay), warmer `--felt` tones, deeper `--surface` layering. (5) Skeleton loading everywhere (leaderboard has the pattern — extend to profile, stats, replays).
**Why:** The current UI is clean and functional but doesn't make players say "wow." Premium visuals drive word-of-mouth sharing and justify competitive play.
**Touches:** `client/src/styles/index.css`, component files (micro-animations), `client/src/components/Layout.tsx` (page transitions)
**Complexity:** Medium
**Dependencies:** None
**Tag:** Claude Code

### 3b. Better Reveal Overlay with Card Table
**What:** Redesign the round-end reveal to show a virtual table view: all players' cards laid out in a circle/arc formation (using existing `roundtablePositions` util), with the called hand highlighted if it exists. Animate cards flipping from face-down to face-up in sequence. Show matching cards with a glow effect. The `RoundtableRevealOverlay` and `RoundtableDealingOverlay` patterns provide the foundation.
**Why:** The reveal is the "moment of truth" — the most dramatic moment in every round. A visual card table layout makes it more exciting and easier to parse.
**Touches:** `client/src/components/RevealOverlay.tsx`, `RoundtableRevealOverlay.tsx`, new CSS
**Complexity:** Medium
**Dependencies:** None
**Tag:** Claude Code

### 3c. Landscape Mode Polish
**What:** Full landscape polish for the existing roundtable layout: (1) Optimize player seat positions and avatar sizing for tablet aspect ratios. (2) Collapsible sidebar for call history/stats so the table gets maximum screen space. (3) Ensure hand selector modal doesn't obscure game state in landscape. (4) Test on actual tablets for touch target sizing.
**Why:** Tablet users are a significant audience for card games. The roundtable layout works but was developed primarily in portrait.
**Touches:** `GamePage.tsx` + `LocalGamePage.tsx`, `RoundtableGameLayout.tsx`, CSS media queries
**Complexity:** Medium
**Dependencies:** None
**Tag:** Claude Code

### 3d. Onboarding Improvements
**What:** Extend the interactive tutorial to cover: (1) All hand types with the custom ranking (flush < three of a kind — the #1 source of confusion). (2) Contextual tooltips during the first real game via existing `GameTooltips` and tutorial components. (3) A "first game" mode that auto-selects easier bots and fewer players. (4) Visual ranking comparison chart accessible from the rules page.
**Why:** New players don't understand the custom hand rankings. Better onboarding reduces churn in the critical first game.
**Touches:** `TutorialPage.tsx`, `GameTooltips.tsx`, `tutorialProgress.ts`
**Complexity:** Medium
**Dependencies:** None
**Tag:** Claude Code

### 3e. Full Accessibility Audit
**What:** Comprehensive a11y pass: (1) ARIA labels on all interactive elements — needs significant expansion across components. (2) Color contrast audit against WCAG AA (4.5:1 for normal text, 3:1 for large text) — verify all design tokens against felt backgrounds. (3) Screen reader announcements for game phase transitions (round start, turn changes, bull/true calls, results). (4) `inert` attribute on background content when modals are open.
**Why:** Required for reaching wider audiences and a prerequisite for Apple App Store VoiceOver review.
**Touches:** All component files (ARIA), `index.css` (contrast), `ScreenReaderAnnouncerProvider.tsx`
**Complexity:** Medium
**Dependencies:** 1b (accessibility quick wins) should ship first
**Tag:** Claude Code

### 3f. Game History & Stats Deep Linking
**What:** Make individual game results, stat breakdowns, and replay moments shareable via URL. Currently replays support deep-linking (`/replay/:gameId?round=3`) but stats and game history don't. Add: (1) Shareable profile stat cards via URL. (2) Individual game result pages. (3) Open Graph meta tags for social preview cards when sharing links.
**Why:** Social sharing is the primary growth channel for casual games. Link previews need to look great in iMessage, Discord, Twitter.
**Touches:** `PublicProfilePage.tsx`, new route for game result view, `index.html` (OG meta tags)
**Complexity:** Medium
**Dependencies:** None
**Tag:** Claude Code

### 3g. Better Sound Effects
**What:** Audit and replace game sounds with more distinctive, premium audio: bull call (buzzer/horn), true call (bell/chime), raise (chip slide), elimination (dramatic thud). Ensure all sounds are short (<1s), compressed (<50KB each), and lazy-loaded.
**Why:** Sound is 50% of game feel. Distinctive audio makes gameplay feel tactile and builds brand identity. Current sounds are functional but not memorable.
**Touches:** `client/src/assets/sounds/`, `client/src/hooks/soundEngine.ts`
**Complexity:** Small–Medium
**Dependencies:** None
**Tag:** Manual Setup (sourcing/licensing audio assets)

---

## 4. Infrastructure (Not user-facing, but unblocks future growth)

### 4a. Multi-Region Deployment & TODO(scale) Fixes
**What:** Expand from single-region ("arn") to multi-region on Fly.io. Resolve all `TODO(scale)` markers that break under multiple instances:

1. **CORS origins** (`server/src/index.ts:56`) — configure `CORS_ORIGINS` env var for multi-domain serving
2. **Rate limiting** (`server/src/rateLimit.ts:205`) — enforce Redis-backed rate limits across instances (**critical** — in-memory fallback breaks per-user limits)
3. **OAuth state store** (`server/src/auth/oauth.ts:23`) — externalize to Redis with 10-min TTL (**critical** — OAuth callback on wrong instance fails silently)
4. **Leaderboard cache** (`server/src/db/leaderboard.ts:14`) — replace in-memory TTL cache with Redis
5. **Online player names** (`server/src/index.ts:1076`) — aggregate via Redis pub/sub or shared store
6. **Socket lookup** (`server/src/socket/friendHandlers.ts:23`) — Redis-backed userId→socketId index instead of `io.fetchSockets()` scan
7. **Separate Redis clients** (`server/src/index.ts:166`) — dedicated clients for rate limiting vs matchmaking
8. **Prometheus metrics** (`server/src/metrics.ts:8`) — document that Prometheus scrapes all instances; no code change needed
9. **Matchmaking flag** (`server/src/socket/persistGame.ts:206`) — wire `fromMatchmaking` through room metadata

**Why:** Players outside Northern Europe experience 100–200ms latency. A US region cuts that to <50ms for North American players. The architecture already supports this — all state is serializable, Socket.io has Redis adapter, read replicas are supported.
**Touches:** `fly.toml`, `server/src/index.ts`, `rateLimit.ts`, `oauth.ts`, `leaderboard.ts`, `metrics.ts`, `friendHandlers.ts`, `persistGame.ts`
**Complexity:** Medium
**Dependencies:** None (architecture already supports it)
**Tag:** Manual Setup (Fly.io region + Redis/Postgres provisioning) + Claude Code (9 code fixes)

### 4b. Lightning Payment Infrastructure
**What:** Build the payment backend needed for money games: LN node connection (LNbits/Voltage/Strike API), invoice generation, payment verification, wallet balance tracking, withdrawal processing, transaction logging with full audit trail. All behind a feature flag (`LIGHTNING_ENABLED=true`). Includes webhook handler for payment confirmations.
**Why:** Prerequisite for money games (5d). Separating the infra from the game integration allows the payment system to be tested and hardened independently.
**Touches:** new `server/src/lightning/` module, new DB migration, `.env`
**Complexity:** Large
**Dependencies:** None
**Tag:** Manual Setup (LN provider account creation, API keys, node setup)

### 4c. E2E Test Coverage Expansion
**What:** Expand integration test suite to cover: (1) Matchmaking queue → room creation → game completion flow. (2) Reconnection during active game (mid-turn, mid-reveal). (3) Series play (Bo3/Bo5) full lifecycle. (4) Spectator join/leave during active game. (5) Concurrent room stress tests. Current tests cover lobby, basic game flow, and session transfer.
**Why:** The game has complex state machines with many edge cases. Automated E2E tests catch regressions that unit tests miss, especially around reconnection and series play.
**Touches:** `server/src/socket/` (new test files), test utilities
**Complexity:** Medium
**Dependencies:** None
**Tag:** Claude Code

---

## 5. Future Vision (Longer-term, high-impact)

### 5a. Daily Challenges & Missions
**What:** Daily rotating challenges (e.g., "Win 3 games today", "Call bull correctly 5 times", "Win a game using only high card calls") that reward achievement progress or future currency. Weekly challenges for bigger rewards. Challenge progress visible on the home page.
**Why:** Daily challenges are the #1 driver of daily active users in mobile games. They give players a reason to open the app every day even when friends aren't online. Works perfectly with the bot system for solo challenge completion.
**Touches:** new `server/src/challenges/` module, new DB migration, `client/src/pages/HomePage.tsx`, `shared/src/types.ts`
**Complexity:** Medium
**Dependencies:** 2b (achievement system) for reward integration, or can ship standalone with stats-based rewards
**Tag:** Claude Code

### 5b. In-App Currency & Cosmetics Shop
**What:** Introduce an in-app currency (earned through play, daily draws, and achievements) redeemable for cosmetic items: card back designs, table felt colors, avatar frames, victory animations. No gameplay advantage — purely cosmetic.
**Why:** Cosmetics create long-term engagement loops. They're a clean free-to-play monetization path that doesn't affect gameplay balance.
**Touches:** new DB migration, new `server/src/shop/` module, new `client/src/pages/ShopPage.tsx`, `shared/src/types.ts`, game rendering components
**Complexity:** Large
**Dependencies:** None (but best after 3a aesthetic overhaul)
**Tag:** Claude Code

### 5c. Clan/Team System
**What:** Let players form clans (2–50 members) with a shared name, tag, and banner. Clan leaderboard aggregates member ratings. Clan chat channel. Clan vs clan challenges.
**Why:** Social bonds are the strongest retention mechanic. Players in clans have 3–5x higher retention than solo players (industry standard). Clans create organic growth as members recruit friends.
**Touches:** new DB migration, new `server/src/clans/` module, new `client/src/pages/ClanPage.tsx`, `LeaderboardPage.tsx` (clan tab)
**Complexity:** Large
**Dependencies:** None (friends system exists as foundation)
**Tag:** Claude Code

### 5d. Bitcoin Lightning Money Games
**What:** Integrate Bitcoin Lightning for real-money wagering. Players deposit sats via Lightning invoice to an in-game wallet, join money tables with fixed buy-ins, and winnings are paid out instantly. Opt-in only. House takes 1–3% rake.
**Why:** Bluffing games are a natural fit for stakes. Lightning enables instant, low-fee, borderless micropayments. This is monetization that aligns incentives with players (rake, not ads).
**Touches:** `server/src/lightning/` module (from 4b), room escrow logic, deposit/withdraw UI, new client pages
**Complexity:** Large
**Dependencies:** 4b (Lightning payment infrastructure)
**Tag:** Manual Setup (legal review for target jurisdictions)

### 5e. Native Mobile App Polish
**What:** Polish the Capacitor native app experience: (1) Bundle assets locally (currently loads from `https://bullem.cards` — `TODO(scale)` in `capacitor.config.ts`). (2) Native push notifications via APNs/FCM (replacing Web Push). (3) Richer haptic engine. (4) App icon badge for turn notifications. (5) App store optimization (screenshots, descriptions).
**Why:** App store presence is the #1 growth channel for mobile games. The native wrapper is shipped but loads remotely — bundling locally enables offline lobby and faster startup.
**Touches:** `client/capacitor.config.ts`, platform-specific code, store assets
**Complexity:** Medium–Large
**Dependencies:** 3a (aesthetic polish for screenshots), 3e (accessibility for Apple VoiceOver review)
**Tag:** Manual Setup (signing certs, store listings)

---

## Existing TODO(scale) Markers in Code

| Location | What | When to Address | Roadmap Item |
|---|---|---|---|
| `server/src/index.ts:56` | CORS origins hardcoded for single domain | Multi-domain / CDN serving | 4a |
| `server/src/index.ts:166` | Single Redis client for adapter + rate limiting + matchmaking | Very high scale (100k+ concurrent) | 4a |
| `server/src/index.ts:1076` | `getOnlinePlayerNames()` returns only this instance's data | Multi-instance deployment | 4a |
| `server/src/db/leaderboard.ts:14` | In-memory leaderboard cache (TTL-based) | Replace with Redis cache at multi-instance | 4a |
| `server/src/rateLimit.ts:205` | In-memory rate limiting fallback (single instance only) | **Critical** — must use REDIS_URL at multi-instance | 4a |
| `server/src/metrics.ts:8` | Per-instance Prometheus metrics (no aggregation) | Prometheus scrapes all instances — low priority | 4a |
| `server/src/socket/friendHandlers.ts:23` | `io.fetchSockets()` scans all sockets via Redis adapter | Redis-backed userId→socketId index at very high scale | 4a |
| `server/src/auth/oauth.ts:23` | OAuth state store in-memory Map (10-min TTL) | **Critical** — OAuth fails cross-instance without Redis | 4a |
| `server/src/socket/persistGame.ts:206` | `fromMatchmaking: false` hardcoded | Wire up when connecting matchmaking to persistence | 1d |
| `server/src/analytics/track.ts:17-18` | `matchmaking:queued` and `matchmaking:matched` not tracked | Wire up `track()` calls in MatchmakingQueue | 1c |
| `client/capacitor.config.ts:8` | Loads app from production URL, not bundled assets | Bundle locally when socket/API URLs are env-aware | 5e |
| `.github/workflows/deploy.yml:33` | flyctl-actions pinned to Node 20 (1.5) | Update when Node 24 version released | — |

---

## Suggested Sequencing

Items within each batch can be run as **parallel Claude Code sessions** without logical conflicts. Each batch depends only on prior batches being complete. Order: analytics fixes → premium feel → engagement → competitive depth → retention loops → scale → monetization → distribution.

### Batch 1 — "Quick Fixes & Analytics"
*Goal: Small, independent improvements that close gaps in analytics, accessibility, and game feel. No shared file conflicts.*

| Session | Item | What | Complexity | Tag | Key Files |
|---|---|---|---|---|---|
| A | **1a** | Bot personality flavor text in gameplay | Small | Claude Code | `CallHistory.tsx`, `GamePage.tsx`, `LocalGamePage.tsx` |
| B | **1b** | Finish accessibility quick wins (focus trapping, motion audit) | Small | Claude Code | `WheelPicker.tsx`, `HandSelector.tsx`, `VolumeControl.tsx`, `index.css` |
| C | **1c** | Wire up matchmaking analytics | Small | Claude Code | `MatchmakingQueue.ts`, `track.ts` |
| D | **1d** | Wire up `fromMatchmaking` flag | Small | Claude Code | `persistGame.ts`, `Room.ts` |

*Sessions are fully independent — A touches client game UI, B touches client accessibility, C and D touch different server files.*

### Batch 2 — "Casino Quality"
*Goal: Visual and audio polish that makes the game feel premium. Sessions touch different component systems.*

| Session | Item | What | Complexity | Tag | Key Files |
|---|---|---|---|---|---|
| A | **3a** | Aesthetic UI overhaul — "premium feel" | Medium | Claude Code | `index.css`, component styles, `Layout.tsx` |
| B | **3b** | Better reveal overlay with card table | Medium | Claude Code | `RevealOverlay.tsx`, `RoundtableRevealOverlay.tsx`, CSS |
| C | **3c** | Landscape mode polish | Medium | Claude Code | Game pages, `RoundtableGameLayout.tsx`, CSS media queries |
| D | **3g** | Better sound effects | Small–Medium | Manual Setup | `assets/sounds/`, `soundEngine.ts` |

*A is global theme, B is reveal-specific, C is layout-specific, D is audio-only. Minimal overlap.*

### Batch 3 — "Engagement & Discovery"
*Goal: Features that reduce churn, increase discoverability, and help new players. Each touches different page/module boundaries.*

| Session | Item | What | Complexity | Tag | Key Files |
|---|---|---|---|---|---|
| A | **1e** | Room browser for public games | Small–Medium | Claude Code | `HomePage.tsx` (or new page), `RoomManager.ts` |
| B | **1f** | Rematch flow improvements | Small–Medium | Claude Code | `ResultsPage.tsx`, `roundTransition.ts`, `Room.ts` |
| C | **3d** | Onboarding improvements | Medium | Claude Code | `TutorialPage.tsx`, `GameTooltips.tsx`, `tutorialProgress.ts` |
| D | **2d** | Custom player colors | Small–Medium | Claude Code | `types.ts`, `PlayerList.tsx`, lobby pages, `lobbyHandlers.ts` |

*A adds a browsing feature, B changes results/transition flow, C touches tutorial system, D adds a cosmetic player field. No conflicts.*

### Batch 4 — "Competitive Depth"
*Goal: Ranked seasons, achievements, and full accessibility — features that turn casual players into regulars.*

| Session | Item | What | Complexity | Tag | Key Files |
|---|---|---|---|---|---|
| A | **2a** | Seasonal ranked play | Medium | Claude Code | `MatchmakingQueue.ts`, new DB migration, `LeaderboardPage.tsx` |
| B | **2b** | Achievement system | Medium | Claude Code | New DB migration, `roundTransition.ts` (hooks), `ProfilePage.tsx` |
| C | **3e** | Full accessibility audit | Medium | Claude Code | All components (ARIA), `index.css` (contrast) |
| D | **3f** | Game history & stats deep linking | Medium | Claude Code | `PublicProfilePage.tsx`, new route, `index.html` (OG tags) |

*A touches matchmaking/leaderboard, B touches game handlers/profile, C touches component ARIA/CSS, D touches profile/routing. No conflicts.*

### Batch 5 — "Live Experience"
*Goal: Features that make the game more social and engaging to watch.*

| Session | Item | What | Complexity | Tag | Key Files |
|---|---|---|---|---|---|
| A | **2c** | Spectator "Watch Live" tab | Small–Medium | Claude Code | New `WatchPage.tsx`, `Layout.tsx` (nav), `RoomManager.ts` |
| B | **4c** | E2E test coverage expansion | Medium | Claude Code | `server/src/socket/` (new test files) |

*Fully independent — A is client feature, B is server tests.*

### Batch 6 — "Retention Loops"
*Goal: Daily reasons to return. Best after Batch 4 for achievement system as reward target.*

| Session | Item | What | Complexity | Tag | Key Files |
|---|---|---|---|---|---|
| A | **5a** | Daily challenges & missions | Medium | Claude Code | New `challenges/` module, `HomePage.tsx`, new DB migration |
| B | **5b** | In-app currency & cosmetics shop | Large | Claude Code | New `shop/` module, new DB tables, new `ShopPage.tsx` |

*Independent systems — 5a can use stats rewards if 5b isn't ready, but ideally ships together.*

### Batch 7 — "Scale & Monetization Infrastructure"
*Goal: Backend infrastructure for growth and monetization. Independent systems.*

| Session | Item | What | Complexity | Tag | Key Files |
|---|---|---|---|---|---|
| A | **4a** | Multi-region deployment + TODO(scale) fixes | Medium | Manual Setup + Claude Code | `fly.toml`, `index.ts`, `rateLimit.ts`, `oauth.ts`, `leaderboard.ts` |
| B | **4b** | Lightning payment infrastructure | Large | Manual Setup | New `lightning/` module, wallet DB tables |
| C | **5c** | Clan/team system | Large | Claude Code | New `clans/` module, new DB tables, new `ClanPage.tsx` |

*A is infra config, B is new payment module, C is new social module. No conflicts.*

### Batch 8 — "Premium Game Modes & Distribution"
*Goal: Money games, tournaments, and native app polish. Depends on Batch 7 for Lightning infra (4b) and multi-region (4a).*

| Session | Item | What | Complexity | Tag | Key Files |
|---|---|---|---|---|---|
| A | **5d** | Bitcoin Lightning money games | Large | Manual Setup | `lightning/` module, room escrow, deposit/withdraw UI |
| B | **2e** | Tournament mode | Large | Claude Code | New `tournament/` module, bracket pages, DB tables |
| C | **5e** | Native mobile app polish | Medium–Large | Manual Setup | `capacitor.config.ts`, platform code, store assets |

*5d depends on 4b. 2e and 5e are independent. All create new modules — no conflicts.*

---

## Summary

| Category | Count | Items |
|---|---|---|
| **Quick Wins** | 6 | 1a–1f |
| **Core Features** | 5 | 2a–2e |
| **Polish** | 7 | 3a–3g |
| **Infrastructure** | 3 | 4a–4c |
| **Future Vision** | 5 | 5a–5e |
| **Total** | **26** | Across 8 batches |

| Tag | Count |
|---|---|
| **Claude Code** | 19 items (fully implementable in sessions) |
| **Manual Setup** | 4 items (require external accounts, credentials, or asset sourcing) |
| **Manual Setup + Claude Code** | 3 items (code changes + external provisioning) |

The sequencing prioritizes **analytics & accessibility foundations** (Batch 1) → **premium visuals** (Batch 2) → **engagement & discovery** (Batch 3) → **competitive depth** (Batch 4) → **live experience** (Batch 5) → **retention loops** (Batch 6) → **scale infrastructure** (Batch 7) → **premium modes & distribution** (Batch 8). Each batch builds on the prior one, and items within a batch are safe to develop in parallel Claude Code sessions without logical conflicts.
