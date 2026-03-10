# Bull 'Em — Feature Roadmap

> Generated 2026-03-10 from a full codebase audit. Replaces all previous roadmaps.
>
> Items are prioritized by user impact and grouped by effort level.
> Each item is tagged: **Claude Code** (can be fully implemented in a session) or **Manual Setup** (requires external service config, credentials, or similar).

---

## What's Already Shipped

The codebase is production-grade and feature-rich. These do **not** need work:

| Area | Details |
|---|---|
| **Game engine** | Pure state machine in `shared/`, 17+ test files, all hand types, joker support, edge cases, regressions |
| **Security** | Server-authoritative, cards never leaked, input validated, reconnect tokens rotated, rate limiting |
| **Bot AI** | 81 bot profiles: 72 heuristic (9 personalities × 8 levels) + 9 CFR bots (level 9), cross-round memory, evolved parameters |
| **Mobile UX** | Wheel pickers, touch targets (44px+), responsive layouts, no hover-only interactions, landscape mode |
| **App shell** | `100dvh`, `overscroll-behavior: none`, inner scroll containers — feels like an app, not a website |
| **Keyboard shortcuts** | B/T/R/P/Esc/Enter in game via `useGameKeyboardShortcuts.ts` |
| **Card deal animation** | CSS keyframe with staggered delays per card |
| **Elimination** | Opacity fade + "OUT" badge, toast notifications, spectator transition |
| **Sound + Haptics** | 25 contextual sounds, MP3 pre-decoding, oscillator UI tones, haptic vibration patterns, iOS recovery |
| **Matchmaking** | Redis-backed queue with ELO rating, bot backfill, heads-up + multiplayer modes |
| **Leaderboard** | Paginated, time-filtered (all-time/month/week), per-mode, current-user rank card, rank tiers |
| **Player accounts** | JWT auth, bcrypt, Google OAuth, avatar selection, profile photo upload (Tigris S3) |
| **Advanced stats** | Rating history chart, hand-type breakdown, bluff heat map, win probability, career trajectory, rivalry stats, shareable stat cards |
| **In-game stats** | Live win probability, bluff detection, hand strength indicators during gameplay |
| **Replays** | Server-side persistence, browsable gallery, step-through viewer with auto-play + keyboard |
| **Spectator mode** | Full support with configurable card visibility, chat, and emoji reactions |
| **Chat + Emoji** | Collapsible chat panel, floating emoji reactions, rate-limited, sanitized |
| **Quick Play** | One-tap button for instant local game with bots |
| **Quick Draw chips** | Suggested raises above hand selector |
| **Deck Draw minigame** | 5-card draw with wagering (play-money), daily free draw, lifetime stats, server-synced |
| **Win confetti** | Gold-themed canvas-confetti burst on results screen |
| **QR code invites** | QR code generation in lobby |
| **Recent players** | Tracks and displays recently played-with players |
| **Interactive tutorial** | Scripted walkthrough teaching core mechanics |
| **Best-of series** | 1v1 Bo1/Bo3/Bo5 support, ranked 1v1 always Bo3 |
| **Friends system** | Friends list, friend requests, online status, invite-to-game, FriendsPage |
| **Push notifications** | Web Push with PostgreSQL-persisted subscriptions, VAPID config |
| **Post-game results** | Player ranking reveal animation, game stats display, share card |
| **Data visualizations** | BluffHeatMap, CareerTrajectory, WinProbabilityGraph, RivalryStats, ShareableStatCard |
| **Profile photos** | Upload to Tigris S3 object storage with CDN, replaces old base64 approach |
| **Scale infra** | Redis adapter for Socket.io, Redis session persistence (24h TTL), Redis rate limiting |
| **DB resilience** | Exponential backoff with jitter, degraded mode fallback, auto-reconnection |
| **Observability** | Pino structured logging, Sentry integration, Prometheus metrics, health checks |
| **E2E tests** | Socket.io integration tests for lobby and game flows |
| **CI/CD** | Parallel tests, auto-merge to develop, Docker validation, gated production deploys |
| **Admin panel** | User management, analytics, bot management endpoints |
| **Project email** | Resend API integration for password reset emails with HTML/plaintext templates |
| **Bot calibration** | Continuous round-robin calibration pipeline with convergence detection |
| **Deck variants** | Configurable deck variants with joker support in `Deck.ts`, `HandChecker.ts`, lobby settings |
| **Analytics & balance DB** | `analytics_balance_snapshot` table (migration 014), `server/src/db/analytics.ts`, admin dashboard endpoints |
| **Read replicas** | `readPool` in `pool.ts` with `READ_DATABASE_URL` support, fallback to primary pool |
| **Apple OAuth** | Full Sign in with Apple flow in `oauth.ts` — redirect URI, ES256 client secret, callback handler |

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

### 1c. `prefers-reduced-motion` Support
**What:** Add a `@media (prefers-reduced-motion: reduce)` block to `index.css` that disables or simplifies all CSS animations (card deals, avatar pulses, slide-ups, fade-ins). Also gate confetti and haptics behind this preference in JS.
**Why:** Accessibility baseline — users with motion sensitivity or vestibular disorders currently have no way to disable animations. Required for WCAG compliance and future app store review.
**Touches:** `client/src/styles/index.css` (media query block), `client/src/hooks/useWinConfetti.ts` (check preference), `client/src/hooks/soundEngine.ts` (gate haptics)
**Complexity:** Small
**Dependencies:** None
**Tag:** Claude Code

### 1d. Keyboard Focus Indicators & Skip Navigation
**What:** Add visible `:focus-visible` outlines on all interactive elements (currently suppressed by default browser reset). Add a skip-to-main-content link. Ensure hand selector wheel picker is fully keyboard-navigable.
**Why:** Keyboard-only users can't currently see where focus is. This is the lowest-effort, highest-impact accessibility fix.
**Touches:** `client/src/styles/index.css` (`:focus-visible` styles), `client/src/components/Layout.tsx` (skip link), `client/src/components/WheelPicker.tsx` (keyboard nav audit)
**Complexity:** Small
**Dependencies:** None
**Tag:** Claude Code

### 1e. Better Sound Effects
**What:** Audit and replace game sounds with more distinctive, premium audio: bull call (buzzer/horn), true call (bell/chime), raise (chip slide), elimination (dramatic thud). Ensure all sounds are short (<1s), compressed (<50KB each), and lazy-loaded.
**Why:** Sound is 50% of game feel. Distinctive audio makes gameplay feel tactile and builds brand identity. Current sounds are functional but not memorable.
**Touches:** `client/src/assets/sounds/` (new/replacement audio files), `client/src/hooks/soundEngine.ts` (new sound entries)
**Complexity:** Small–Medium
**Dependencies:** 1b (per-category volume) ideally ships first so new sounds respect category controls
**Tag:** Manual Setup (sourcing/licensing audio assets)

---

## 2. Core Features (Meaningful additions that make the product more complete)

### 2a. Seasonal Ranked Play
**What:** Time-limited ranked seasons (e.g., monthly) with soft rating resets, season rewards (cosmetic badges), placement matches (5 games), and end-of-season leaderboard snapshots. Season history viewable on profile.
**Why:** Without seasons, once you reach a high rank there's no reason to keep playing ranked. Seasonal resets keep the competitive ladder fresh and create recurring engagement peaks.
**Touches:** `server/src/matchmaking/MatchmakingQueue.ts` (season logic, placement handling), new DB migration (season history table), `server/src/db/leaderboard.ts` (season selector), `client/src/pages/LeaderboardPage.tsx` (season tabs), `client/src/components/RankBadge.tsx` (season badges), `shared/src/types.ts` (season types)
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

### 2d. Bitcoin Lightning Integration (Money Games)
**What:** Integrate Bitcoin Lightning Network payments for real-money wagering. Players deposit sats via Lightning invoice to an in-game wallet, join money tables with fixed buy-ins, and winnings are paid out instantly. Requires: custodial wallet service (LNbits, Strike API, or Voltage), deposit/withdrawal UI, buy-in escrow logic, regulatory compliance check by jurisdiction. Opt-in only (never default). House takes a small rake (1–3%).
**Why:** Bluffing games are a natural fit for stakes. Lightning enables instant, low-fee, borderless micropayments that work for $0.10 or $100 buy-ins. This is a monetization path that aligns incentives with players (rake, not ads or loot boxes).
**Touches:** new `server/src/lightning/` module (LN provider integration, wallet management, escrow), `shared/src/types.ts` (money game types, buy-in levels), `server/src/rooms/Room.ts` (escrow lifecycle), new client pages (deposit/withdraw UI, money table lobby), new DB migration (wallet balances, transaction history)
**Complexity:** Large
**Dependencies:** 4a (Lightning payment infrastructure must be built first), legal review for target jurisdictions
**Tag:** Manual Setup (LN provider account, legal review, payment credentials)

### 2e. Custom Player Colors
**What:** Let players pick a color (from a curated palette of 12 options) when joining a room. Display as a colored ring around their avatar in the player list and turn indicator. Persist in localStorage for guests, in account for logged-in users.
**Why:** With 6–12 players, avatar icons alone aren't distinctive enough at a glance. Custom colors help players identify each other instantly, especially on small screens.
**Touches:** `shared/src/types.ts` (player color field), `client/src/components/PlayerList.tsx`, `client/src/pages/LobbyPage.tsx` + `LocalLobbyPage.tsx`, `server/src/socket/lobbyHandlers.ts` (validate)
**Complexity:** Small–Medium
**Dependencies:** None
**Tag:** Claude Code

---

## 3. Polish (UX improvements, animations, edge case handling)

### 3a. Aesthetic UI Overhaul — "Premium Feel"
**What:** Elevate the visual design to feel premium and app-like. Key improvements: (1) Glassmorphism refinement — consistent blur intensity, subtle gradient overlays, glow effects on interactive elements. (2) Micro-animations — button press scaling, page transitions (slide/fade between routes using CSS or a lightweight library), card hover effects. (3) Typography — introduce a display/serif font for headers alongside the existing sans-serif body text. (4) Dark theme refinement — richer backgrounds (subtle texture/noise overlay), warm color temperature. (5) Skeleton loading screens on all pages (leaderboard already has this pattern — extend everywhere).
**Why:** The current UI is clean and functional but doesn't make players say "wow." Premium visuals drive word-of-mouth sharing ("look at this game") and justify real-money stakes. The goal is "this looks like it cost $500K to build."
**Touches:** `client/src/styles/index.css` (global theme refinements, new animations), all component files (micro-animations), `client/src/components/Layout.tsx` (page transitions), font assets
**Complexity:** Medium (spread across many files but each change is individually small)
**Dependencies:** None
**Tag:** Claude Code

### 3b. Better Reveal Overlay with Card Table
**What:** Redesign the round-end reveal to show a virtual table view: all players' cards laid out in a circle/arc formation, with the called hand highlighted if it exists. Animate cards flipping from face-down to face-up in sequence. Show matching cards with a glow effect.
**Why:** The reveal is the "moment of truth" — the most dramatic moment in every round. A visual card table layout makes it more exciting and easier to parse at a glance than the current text-heavy approach.
**Touches:** `client/src/components/RevealOverlay.tsx` (redesign), new CSS for card layout + flip animations
**Complexity:** Medium
**Dependencies:** None
**Tag:** Claude Code

### 3c. Landscape Mode — Round Card Table Layout
**What:** Full landscape polish: (1) Round card table layout where players sit around a circular/oval virtual table — the classic poker table view. (2) Collapsible sidebar for call history/stats. (3) Ensure hand selector modal doesn't obscure game state in landscape. (4) Test on actual tablets for touch target sizing. This is the "poker table" view that landscape mode deserves.
**Why:** The landscape layout exists but was developed after portrait. Tablet users are a significant audience for card games. A proper round-table layout is the most natural way to present a card game in landscape.
**Touches:** `client/src/pages/GamePage.tsx` + `LocalGamePage.tsx` (landscape table layout), CSS media queries, potentially new `client/src/components/TableLayout.tsx`
**Complexity:** Medium
**Dependencies:** None
**Tag:** Claude Code

### 3d. Onboarding Improvements
**What:** Extend the tutorial to cover all hand types with the custom ranking (flush < three of a kind). Add contextual tooltips in the first real game (e.g., "This is the hand selector — pick a hand higher than the current call"). Show a "first game" mode with gentler bot difficulty. Emphasize the custom hand ranking since it's the #1 source of confusion for poker players.
**Why:** New players don't understand the custom hand rankings. Better onboarding reduces churn in the critical first game. Every player who bounces is a lost referral.
**Touches:** `client/src/pages/TutorialPage.tsx`, `client/src/components/TutorialOverlay.tsx`, `client/src/components/GameTooltips.tsx`, `client/src/utils/tutorialProgress.ts`
**Complexity:** Medium
**Dependencies:** None
**Tag:** Claude Code

### 3e. Full Accessibility Audit
**What:** Comprehensive a11y pass: proper ARIA labels on all interactive elements (currently ~29 instances across 19 files — needs significant expansion), focus management for modal dialogs (hand selector, reveal overlay, settings), color contrast audit against WCAG AA, screen reader announcements for game state changes (turn, bull calls, results), and a skip-to-content link.
**Why:** Accessibility is a quality bar, not a feature. Important for reaching wider audiences and a requirement for future app store review (Apple requires VoiceOver support).
**Touches:** All component files in `client/src/components/`, `client/src/pages/`, CSS color variables in `client/src/styles/index.css`
**Complexity:** Medium
**Dependencies:** 1c (`prefers-reduced-motion`), 1d (focus indicators) — those are the quick-win subset of this broader audit
**Tag:** Claude Code

### 3f. Offline/PWA Support
**What:** Add a service worker and web app manifest to make Bull 'Em installable as a PWA. Cache the app shell and static assets for offline use. Local bot games should work fully offline. Show an offline banner when network drops and queue reconnection for online games.
**Why:** Mobile users expect app-like behavior — install to home screen, open instantly, no white screen on flaky connections. PWA is the bridge between "website" and "native app" and requires no app store review.
**Touches:** new `client/public/manifest.json`, new service worker (Vite PWA plugin or custom), `client/src/components/Layout.tsx` (offline banner), `client/vite.config.ts` (PWA plugin config)
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

### 4b. Multi-Region Deployment
**What:** Expand from single-region ("arn") to multi-region on Fly.io. Add a second region (e.g., "iad" for US East). Configure Redis as primary/replica and Postgres with read replicas. Resolve `TODO(scale)` markers: `getOnlinePlayerNames()` (`index.ts:933`), rate limiting (`rateLimit.ts:136`), Prometheus metrics (`metrics.ts:8`), and `io.fetchSockets()` in friend handlers (`friendHandlers.ts:22`).
**Why:** Players outside Northern Europe experience 100–200ms latency. A US region cuts that to <50ms for North American players. The architecture is already designed for this — it's mostly config plus fixing the handful of single-instance assumptions.
**Touches:** `fly.toml` (add regions), Redis and Postgres provisioning, `server/src/index.ts`, `server/src/rateLimit.ts`, `server/src/metrics.ts`, `server/src/socket/friendHandlers.ts`
**Complexity:** Medium
**Dependencies:** None (read replicas already shipped)
**Tag:** Manual Setup (infrastructure provisioning) + Claude Code (code fixes)

---

## 5. Future Vision (Longer-term, high-impact)

### 5a. Native Mobile Apps (Capacitor)
**What:** Wrap the web app in Capacitor for iOS and Android app store distribution. Add native features: push notifications via APNs/FCM (replacing Web Push), haptic engine (richer than Vibration API), app icon badge for turn notifications, and offline mode for local games.
**Why:** App store presence is the #1 growth channel for mobile games. Web apps have friction (no home screen icon by default, Safari limitations). A native wrapper with the existing codebase is low effort for high distribution gain.
**Touches:** new `mobile/` directory with Capacitor config, `client/` (minor tweaks for native bridges), app store assets (icons, screenshots, descriptions)
**Complexity:** Medium–Large
**Dependencies:** 3a (aesthetic polish for screenshots), 3e (accessibility for Apple review)
**Tag:** Manual Setup (Apple Developer account $99/yr, Google Play Console $25, app signing, store listings)

### 5b. Spectator Streaming & "Watch Live" Tab
**What:** Build a "Watch Live" tab showing active games that allow spectators. Click to drop into any game as a spectator with real-time card visibility (if host allows). Show game metadata: player count, round number, time elapsed. Prioritize high-rated or money games.
**Why:** Spectating builds community and lets new players learn by watching. "Watch a random game" already exists as a button — this elevates it to a browsable, always-available feature.
**Touches:** `server/src/rooms/RoomManager.ts` (already has `getSpectateableGames`), new `client/src/pages/WatchPage.tsx`, `client/src/components/Layout.tsx` (nav link)
**Complexity:** Small–Medium
**Dependencies:** None
**Tag:** Claude Code

### 5c. In-App Currency & Cosmetics Shop
**What:** Introduce an in-app currency (earned through play, daily draws, and achievements) redeemable for cosmetic items: card back designs, table felt colors, avatar frames, victory animations. No gameplay advantage — purely cosmetic.
**Why:** Cosmetics create long-term engagement loops ("I want to unlock the gold card back"). They're also a clean free-to-play monetization path that doesn't affect gameplay balance. Works alongside Lightning money games without conflict.
**Touches:** new DB migration (currency balances, inventory, shop catalog), new `server/src/shop/` module, new `client/src/pages/ShopPage.tsx`, `shared/src/types.ts` (cosmetic types)
**Complexity:** Large
**Dependencies:** None (but best after 3a aesthetic overhaul for visual consistency)
**Tag:** Claude Code

### 5d. Achievement System
**What:** Track and display achievements: gameplay milestones (first win, 100 games played, royal flush called), challenge-based (win 5 games in a row, correctly call bull 10 times in one game), and rare events (win with only high cards, survive 10 rounds with max cards). Display on profile with unlock dates.
**Why:** Achievements give casual players goals beyond winning and reward exploration of game mechanics. They're also shareable content that drives social engagement.
**Touches:** `shared/src/types.ts` (achievement definitions), new DB migration (achievement tracking), `server/src/socket/gameHandlers.ts` (achievement detection hooks), `client/src/pages/ProfilePage.tsx` (achievement display)
**Complexity:** Medium
**Dependencies:** None
**Tag:** Claude Code

---

## Existing TODO(scale) Markers in Code

| Location | What | When to Address | Roadmap Item |
|---|---|---|---|
| `server/src/index.ts:57` | CORS origins hardcoded for single domain | When serving from multiple domains/CDN | 4b |
| `server/src/index.ts:161` | Single Redis client for adapter + rate limiting | At very high scale, separate clients | 4b |
| `server/src/index.ts:933` | `getOnlinePlayerNames()` single-instance only | Multi-instance deployment | 4b |
| `server/src/db/leaderboard.ts:14` | In-memory leaderboard cache (TTL-based) | Replace with Redis cache | 4b |
| `server/src/rateLimit.ts:136` | In-memory rate limiting fallback (single instance) | Multi-instance — must use REDIS_URL | 4b |
| `server/src/metrics.ts:8` | Single-instance Prometheus metrics | Multi-instance aggregation | 4b |
| `server/src/socket/friendHandlers.ts:22` | `io.fetchSockets()` queries all instances | Multi-instance correctness | 4b |

---

## Suggested Sequencing

Items within each batch can be run as **parallel Claude Code sessions** without logical conflicts. Each batch depends only on prior batches being complete. Order: accessibility/polish foundations → premium feel → competitive depth → monetization → distribution.

### Batch 1 — "Quick Foundations"
*Goal: Small, independent improvements with no shared file conflicts. Establishes accessibility baseline and quality-of-life upgrades.*

| Session | Item | What | Complexity | Tag | Key Files |
|---|---|---|---|---|---|
| A | **1a** | Bot personality flavor text in gameplay | Small | Claude Code | `CallHistory.tsx`, `GamePage.tsx`, `LocalGamePage.tsx` |
| B | **1b** | Per-category volume sliders | Small | Claude Code | `soundEngine.ts`, `VolumeControl.tsx`, `useSound.ts` |
| C | **1c** | `prefers-reduced-motion` support | Small | Claude Code | `index.css`, `useWinConfetti.ts`, `soundEngine.ts` (haptics only) |
| D | **1d** | Keyboard focus indicators & skip nav | Small | Claude Code | `index.css` (`:focus-visible`), `Layout.tsx`, `WheelPicker.tsx` |

### Batch 2 — "Casino Quality"
*Goal: Visual and audio polish that makes the game feel premium. Sessions touch different systems.*

| Session | Item | What | Complexity | Tag | Key Files |
|---|---|---|---|---|---|
| A | **1e** | Better sound effects | Small–Medium | Manual Setup | `assets/sounds/`, `soundEngine.ts` |
| B | **3a** | Aesthetic UI overhaul | Medium | Claude Code | `index.css`, component styles, `Layout.tsx`, fonts |
| C | **3b** | Better reveal overlay / card table | Medium | Claude Code | `RevealOverlay.tsx`, CSS animations |
| D | **3c** | Landscape mode / round card table | Medium | Claude Code | Game pages (layout), CSS media queries, new `TableLayout.tsx` |

### Batch 3 — "Engagement & Onboarding"
*Goal: Features that create daily engagement loops and reduce new-player churn.*

| Session | Item | What | Complexity | Tag | Key Files |
|---|---|---|---|---|---|
| A | **3d** | Onboarding improvements | Medium | Claude Code | `TutorialPage.tsx`, `TutorialOverlay.tsx`, `GameTooltips.tsx` |
| B | **2e** | Custom player colors | Small–Medium | Claude Code | `types.ts`, `PlayerList.tsx`, lobby pages |
| C | **3f** | Offline/PWA support | Medium | Claude Code | `manifest.json`, service worker, `vite.config.ts` |
| D | **5b** | Spectator "Watch Live" tab | Small–Medium | Claude Code | `RoomManager.ts` (existing), new `WatchPage.tsx` |

### Batch 4 — "Competitive Depth"
*Goal: Ranked seasons and tournaments — the features that turn casual players into regulars.*

| Session | Item | What | Complexity | Tag | Key Files |
|---|---|---|---|---|---|
| A | **2a** | Seasonal ranked play | Medium | Claude Code | `MatchmakingQueue.ts`, new DB migration, `LeaderboardPage.tsx` |
| B | **3e** | Full accessibility audit | Medium | Claude Code | All components (ARIA, focus, contrast) |
| C | **5d** | Achievement system | Medium | Claude Code | `types.ts`, new DB migration, game handlers, `ProfilePage.tsx` |

### Batch 5 — "Scale & Money Infrastructure"
*Goal: Backend infrastructure for growth and monetization. Independent systems — no file conflicts.*

| Session | Item | What | Complexity | Tag | Key Files |
|---|---|---|---|---|---|
| A | **4a** | Lightning payment infrastructure | Large | Manual Setup | New `lightning/` module, wallet DB tables, LN credentials |
| B | **5c** | In-app currency & cosmetics shop | Large | Claude Code | New `shop/` module, DB tables, `ShopPage.tsx` |

### Batch 6 — "Money Games & Distribution"
*Goal: Live money games, tournaments, and multi-region. Depends on Batch 5 for Lightning infra (4a).*

| Session | Item | What | Complexity | Tag | Key Files |
|---|---|---|---|---|---|
| A | **2d** | Bitcoin Lightning money games | Large | Manual Setup | `lightning/`, room escrow, deposit/withdraw UI |
| B | **2b** | Tournament mode | Large | Claude Code | New `tournament/` module, bracket pages, DB tables |
| C | **4b** | Multi-region deployment | Medium | Manual Setup + Claude Code | `fly.toml`, Redis/Postgres provisioning, TODO(scale) fixes |

### Batch 7 — "Native Apps"
*Goal: App store distribution. Depends on Batch 4 (accessibility). Apple OAuth already shipped.*

| Session | Item | What | Complexity | Tag | Key Files |
|---|---|---|---|---|---|
| A | **5a** | Native mobile apps (Capacitor) | Medium–Large | Manual Setup | New `mobile/` directory, Capacitor config, store listings |

---

## Summary

| Category | Count | Items |
|---|---|---|
| **Quick Wins** | 5 | 1a–1e |
| **Core Features** | 4 | 2a–2b, 2d–2e (2c shipped) |
| **Polish** | 6 | 3a–3f |
| **Infrastructure** | 2 | 4a–4b (4c, 4e shipped) |
| **Future Vision** | 4 | 5a–5d |
| **Total** | **21** | Across 7 batches |

| Tag | Count |
|---|---|
| **Claude Code** | 14 items (fully implementable in sessions) |
| **Manual Setup** | 4 items (require external accounts, credentials, or asset sourcing) |
| **Manual Setup + Claude Code** | 3 items (code changes + external provisioning) |

The sequencing prioritizes **accessibility foundations** (reduced motion, focus) → **premium visuals** (overhaul, animations) → **engagement** (onboarding, PWA, spectating) → **competition** (seasons, tournaments, achievements) → **monetization** (Lightning) → **distribution** (native apps). Each batch builds on the prior one, and items within a batch are safe to develop in parallel.
