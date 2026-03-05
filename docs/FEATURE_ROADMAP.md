# Bull 'Em — Feature Roadmap

> Generated 2026-03-05 from a full codebase audit. Items are prioritized by user impact and grouped by effort level.

---

## 1. Quick Wins (Small effort, noticeable improvement)

### 1a. Saved Replays Gallery
**What:** Add a "My Replays" page listing all saved replays from localStorage with metadata (date, winner, player count, round count). Currently replays are saved but there's no browsable list — users can only access a replay immediately after a game or via direct URL with `?id=`.
**Why:** Players already generate replay data but have no way to find old games. Surfacing saved replays makes the existing system feel complete.
**Touches:** `client/src/pages/` (new page or extend ReplayPage), `shared/src/replay.ts` (`listReplays()` already exists), `client/src/App.tsx` (route)
**Complexity:** Small
**Dependencies:** None

### 1b. Emoji Reactions During Game
**What:** Let players send quick emoji reactions (e.g. 😂🔥😤👏) during rounds. Show them as floating bubbles near the sender's avatar that fade out after 2 seconds.
**Why:** Bluffing games thrive on social interaction. Reactions add personality without disrupting flow. Cheap to implement — single socket event + CSS animation.
**Touches:** `shared/src/events.ts` (new event), `server/src/socket/gameHandlers.ts` (relay + rate limit), `client/src/components/PlayerList.tsx` (render), CSS for float/fade animation
**Complexity:** Small
**Dependencies:** None

### 1c. "Quick Play" Button
**What:** One-tap button on the home page that creates a room with default settings + 3 bots and immediately starts the game. Skips lobby entirely.
**Why:** Reduces friction for solo players who just want to practice. Currently requires: Host → configure → add bots → start. This is 4 screens collapsed to 1 tap.
**Touches:** `client/src/pages/HomePage.tsx`, `client/src/context/LocalGameContext.tsx` (or online GameContext), routing logic
**Complexity:** Small
**Dependencies:** None

### 1d. Confetti / Win Celebration Animation
**What:** Trigger a confetti particle burst on the results screen when you win. Use a lightweight canvas-based confetti library or pure CSS.
**Why:** Winning feels flat — the trophy emoji and text don't deliver dopamine. A 2-second burst of confetti makes victories memorable and shareworthy.
**Touches:** `client/src/pages/ResultsPage.tsx`, `client/src/pages/LocalResultsPage.tsx`, small utility or library
**Complexity:** Small
**Dependencies:** None

### 1e. Player Elimination Toast
**What:** Show a prominent toast notification or brief overlay when a player is eliminated mid-game (not just a card count change in the player list).
**Why:** Eliminations are dramatic moments that currently pass without fanfare. Making them visible adds tension and helps spectators track the game.
**Touches:** `client/src/pages/GamePage.tsx`, `client/src/pages/LocalGamePage.tsx`, `client/src/components/ToastContainer.tsx`
**Complexity:** Small
**Dependencies:** None

### 1f. Keyboard Shortcuts in Game
**What:** Add keyboard shortcuts for common actions: `B` for Bull, `T` for True, `R` to open raise/hand selector, `Esc` to close modals. Show shortcut hints on desktop.
**Why:** Desktop players (especially repeat players) want fast inputs. The replay page already has keyboard controls — extend the pattern to gameplay.
**Touches:** `client/src/pages/GamePage.tsx`, `client/src/pages/LocalGamePage.tsx`, `client/src/components/ActionButtons.tsx`
**Complexity:** Small
**Dependencies:** None

---

## 2. Core Features (Meaningful additions for a more complete product)

### 2a. Game History & Stats Persistence
**What:** After each game ends, persist the game record (winner, players, stats, duration) to PostgreSQL using the existing `games` and `game_players` tables. Show recent game history on the profile page and optionally on the home page.
**Why:** Games currently vanish when the room closes. Persistence gives players a reason to come back — they can track their win rate, see improvement, and compare with friends. The DB schema (`001_initial_schema.sql`) and pool (`server/src/db/pool.ts`) already exist.
**Touches:** `server/src/rooms/Room.ts` (persist on game_over), `server/src/db/` (query functions), `server/src/socket/gameHandlers.ts`, `client/src/pages/ProfilePage.tsx` (display), new API endpoint for history
**Complexity:** Medium
**Dependencies:** Working PostgreSQL connection (already optional via `DATABASE_URL`)

### 2b. Friends / Recent Players List
**What:** Track players you've played with recently (stored client-side by player name + last room code, or server-side per account). Show a "Recent Players" section on the home page with an option to invite them (generates a room link).
**Why:** Bull 'Em is a social game — repeat play with the same friends is the core loop. Currently there's no way to reconnect with someone you played with yesterday.
**Touches:** `client/src/pages/HomePage.tsx`, localStorage or `server/src/db/` (if accounts), new component for recent players list
**Complexity:** Medium
**Dependencies:** Better with 2a (game history) but works standalone with localStorage

### 2c. Spectator Chat
**What:** Add a simple text chat for spectators (and optionally all players between rounds). Messages appear in a collapsible panel. Rate-limited, sanitized, max 200 chars.
**Why:** Spectators currently watch silently. Chat lets eliminated players stay engaged and adds social atmosphere. Critical for the "party game" feel when 6+ players are in a room.
**Touches:** `shared/src/events.ts` (chat events), `server/src/socket/` (handler + rate limit), `client/src/components/` (ChatPanel component), `client/src/pages/GamePage.tsx`
**Complexity:** Medium
**Dependencies:** None

### 2d. Custom Avatars / Player Colors
**What:** Let players pick a color and/or avatar icon (from a preset list) when joining a room. Display in the player list and turn indicator. Persist choice in localStorage.
**Why:** With 6-12 players, the single-letter initials in circles aren't distinctive enough. Custom colors and icons help players identify each other instantly.
**Touches:** `shared/src/types.ts` (player avatar fields), `client/src/components/PlayerList.tsx`, `client/src/pages/LobbyPage.tsx` (picker), `server/src/socket/lobbyHandlers.ts` (validate)
**Complexity:** Medium
**Dependencies:** None

### 2e. Room Link Deep-Linking / QR Code
**What:** Generate a QR code for the room invite link, displayable in the lobby. On mobile, sharing the QR code image is often easier than sharing a link (especially in person).
**Why:** The primary social scenario is "let's play right now" — someone holds up their phone with a QR code, everyone scans. Removes the friction of typing a room code.
**Touches:** `client/src/pages/LobbyPage.tsx`, small QR library (e.g. `qrcode` or canvas-based), `client/src/components/ShareButton.tsx`
**Complexity:** Small–Medium
**Dependencies:** None

### 2f. Configurable Deck Variants
**What:** Allow the host to select deck variants: standard 52-card, no face cards (32-card), or jokers included (54-card, jokers are wild). This changes hand probabilities and strategy.
**Why:** Adds replayability and variety. Different deck sizes change the meta — smaller decks make high hands more common, jokers add chaos. Configurable in room settings.
**Touches:** `shared/src/engine/Deck.ts`, `shared/src/types.ts` (deck variant setting), `shared/src/engine/HandChecker.ts` (joker handling), `server/src/socket/lobbyHandlers.ts`, `client/src/pages/LobbyPage.tsx`
**Complexity:** Medium–Large
**Dependencies:** None, but requires careful testing of hand evaluation with variant decks

### 2g. Push Notifications for Turn
**What:** Use the Web Push API to notify players when it's their turn (if they've tabbed away or locked their phone). Request permission in the lobby.
**Why:** Multiplayer games with turn timers need this. Players tab away, miss their turn, and get auto-penalized. Push notifications solve the "I didn't know it was my turn" problem.
**Touches:** `client/src/` (service worker registration, push subscription), `server/src/` (web-push library, store subscriptions), `shared/src/events.ts`
**Complexity:** Medium–Large
**Dependencies:** None

---

## 3. Polish (UX improvements, animations, edge case handling)

### 3a. Hand Selector Presets / Quick Raise
**What:** Add preset buttons for the most common raises from the current hand (e.g., "same type, next rank up" or "jump to three of a kind"). Show 2-3 suggested raises above the full hand selector.
**Why:** The hand selector is powerful but slow for experienced players. Quick-raise buttons let skilled players move instantly while the full selector remains for precise calls.
**Touches:** `client/src/components/HandSelector.tsx`, `shared/src/hands.ts` (`getMinimumRaise()` already exists — extend to generate 2-3 suggestions)
**Complexity:** Medium
**Dependencies:** None

### 3b. Card Deal Animation
**What:** Animate cards being dealt from a central deck to each player at round start. Cards fly out in sequence with a slight arc and land in the player's hand area.
**Why:** The round transition currently shows a countdown then cards appear. A deal animation adds casino-quality feel and gives players a moment to mentally reset.
**Touches:** `client/src/pages/GamePage.tsx`, `client/src/pages/LocalGamePage.tsx`, CSS/JS animation (keyframes or FLIP technique), `client/src/components/HandDisplay.tsx`
**Complexity:** Medium
**Dependencies:** None

### 3c. Better Reveal Overlay with Card Table
**What:** Redesign the round-end reveal to show a virtual table view: all players' cards laid out in a circle/arc formation, with the called hand highlighted if it exists. Animate cards flipping from face-down to face-up in sequence.
**Why:** The current reveal overlay is functional but text-heavy. A visual card table makes the "moment of truth" more dramatic and easier to parse at a glance.
**Touches:** `client/src/components/RevealOverlay.tsx`, CSS for card layout + flip animations
**Complexity:** Medium
**Dependencies:** None

### 3d. Haptic Feedback on Mobile
**What:** Use the Vibration API to provide tactile feedback on key actions: short pulse on Bull/True call, double pulse on turn start, long pulse on elimination.
**Why:** Mobile games feel more immersive with haptics. It's a single API call per event and degrades gracefully (no-op on desktop or unsupported devices).
**Touches:** `client/src/pages/GamePage.tsx`, `client/src/pages/LocalGamePage.tsx`, small utility wrapper for `navigator.vibrate()`
**Complexity:** Small
**Dependencies:** None

### 3e. Improved Bot Personality
**What:** Give each bot a visible "personality" — show flavor text with their actions (e.g., Bot Brady: "I wouldn't bet on that..." when calling bull). Use the existing bot names to map to personality templates.
**Why:** Playing against bots feels mechanical. Personality text makes local games more entertaining and gives the impression of smarter opponents.
**Touches:** `client/src/pages/LocalGamePage.tsx`, `client/src/components/CallHistory.tsx`, new bot personality data file
**Complexity:** Small–Medium
**Dependencies:** None

### 3f. Accessibility Audit & Fixes
**What:** Full a11y pass: ensure all interactive elements have proper ARIA labels, focus management works with keyboard navigation, color contrast meets WCAG AA, screen reader announces game state changes (turn, bull calls, results).
**Why:** Accessibility is a quality bar, not a feature. Current code has some ARIA labels but no systematic approach. Important for reaching wider audiences and meeting platform requirements.
**Touches:** All component files in `client/src/components/`, `client/src/pages/`, CSS color variables
**Complexity:** Medium
**Dependencies:** None

### 3g. Onboarding Improvements
**What:** Extend the tutorial to cover all hand types (currently it's a scripted 2-player demo). Add contextual tooltips in the first real game (e.g., "This is the hand selector — pick a hand higher than the current call"). Track whether the user has completed the tutorial.
**Why:** New players don't understand the custom hand rankings (flush lower than three of a kind is counterintuitive). Better onboarding reduces churn in the critical first game.
**Touches:** `client/src/pages/TutorialPage.tsx`, `client/src/components/TutorialOverlay.tsx`, localStorage flag for tutorial completion
**Complexity:** Medium
**Dependencies:** None

### 3h. Landscape Game Layout Polish
**What:** Refine the two-panel landscape layout: make the sidebar collapsible, add a mini-map of player positions, ensure the hand selector modal doesn't obscure the game state. Test on actual tablets.
**Why:** The landscape layout exists but was developed after the portrait layout. Real tablet testing often reveals spacing issues, overflow problems, and interaction conflicts.
**Touches:** `client/src/pages/GamePage.tsx`, `client/src/pages/LocalGamePage.tsx`, CSS media queries
**Complexity:** Small–Medium
**Dependencies:** None

---

## 4. Infrastructure (Not user-facing, but unblocks future growth)

### 4a. Redis Adapter for Socket.io (Multi-Instance)
**What:** Enable the Socket.io Redis adapter in production. The adapter dependency (`@socket.io/redis-adapter`) is already installed and there's code in `server/src/index.ts` that initializes it when `REDIS_URL` is set. Validate it works: deploy 2+ instances behind Fly.io's load balancer, confirm room state syncs across instances.
**Why:** Currently limited to a single server instance. If Bull 'Em goes viral, one instance caps out at ~1,000-5,000 concurrent WebSocket connections. Redis adapter enables horizontal scaling by syncing socket events across instances. This is the #1 infrastructure blocker.
**Touches:** `server/src/index.ts` (already partially implemented), `fly.toml` (scale count), Redis provisioning on Fly.io
**Complexity:** Medium (code exists, needs operational validation)
**Dependencies:** Redis instance provisioned

### 4b. Server-Side Replay Persistence
**What:** Save game replays to the `rounds` table in PostgreSQL (schema exists in `001_initial_schema.sql`). Serve replays via an HTTP endpoint (`GET /api/replays/:gameId`). Migrate client from localStorage to API-backed storage.
**Why:** localStorage limits: 10 replays, single device, lost on clear. Server-side persistence enables sharing replay links, cross-device access, and community highlights. The `TODO(scale)` at `shared/src/replay.ts:202` explicitly calls this out.
**Touches:** `server/src/rooms/Room.ts` (save on game_over), `server/src/` (new HTTP route), `shared/src/replay.ts` (API client), `client/src/pages/ReplayPage.tsx`
**Complexity:** Medium
**Dependencies:** 2a (game history persistence) — should be done together

### 4c. Structured Logging & Observability
**What:** The server uses `pino` for structured logging and has Sentry integration points. Add correlation IDs to socket events (trace a player action from client → server → broadcast). Add metrics collection for: active rooms, concurrent players, average round duration, error rates. Expose a `/metrics` endpoint for Prometheus/Grafana.
**Why:** When things go wrong in production with 100+ rooms, structured logging is the difference between "something broke" and "room ABCD crashed at turn 7 because player X sent invalid hand data." Also enables data-driven decisions about game balance.
**Touches:** `server/src/index.ts`, `server/src/socket/` (add correlation IDs), new metrics middleware
**Complexity:** Medium
**Dependencies:** None

### 4d. End-to-End Integration Tests
**What:** Add integration tests that spin up a real server, connect multiple Socket.io clients, and play through full game scenarios (create room → join → play rounds → resolution → rematch). Currently tests are unit-level (game engine) and don't test the full socket pipeline.
**Why:** The socket handlers are "thin dispatchers" by design, but the glue between validation, engine calls, broadcasting, and room lifecycle is where bugs hide. E2E tests catch issues that unit tests structurally cannot.
**Touches:** `server/src/` (test files), test utilities for socket client setup/teardown
**Complexity:** Medium–Large
**Dependencies:** None

### 4e. Rate Limiting Hardening
**What:** Current rate limiting (15 events/sec per socket, 200ms per-player cooldown) is in-memory. At multi-instance scale, a player could reconnect to a different instance and bypass cooldowns. Move rate limiting state to Redis. Also add HTTP rate limiting on auth endpoints (`/auth/login`, `/auth/register`) to prevent brute force.
**Why:** Security hardening for scale. In-memory rate limiting works for single-instance but breaks the "what happens with 10 server instances?" test from CLAUDE.md.
**Touches:** `server/src/socket/registerHandlers.ts`, `server/src/auth/routes.ts`, Redis integration
**Complexity:** Medium
**Dependencies:** 4a (Redis adapter) — use the same Redis instance

### 4f. Database Connection Resilience
**What:** Add connection retry logic with exponential backoff to the PostgreSQL pool. Handle transient failures gracefully (log + continue without persistence rather than crashing). Add a health check that reports DB status.
**Why:** The current pool (`server/src/db/pool.ts`) creates a connection but doesn't handle transient failures. In production on Fly.io, database connections can drop during deployments or network blips. The `TODO(scale)` comment about read replicas also lives here.
**Touches:** `server/src/db/pool.ts`, `server/src/index.ts` (health check already reports `db` status)
**Complexity:** Small–Medium
**Dependencies:** None

### 4g. CI Performance: Parallel Test Sharding
**What:** The CI workflow runs three parallel test jobs (shared, server, client) which is good. As the test suite grows, add Vitest's `--shard` flag to split the shared package tests (currently the largest suite at 17 files) across multiple runners.
**Why:** CI time directly impacts development velocity. Keeping the full CI under 3 minutes means developers don't context-switch while waiting.
**Touches:** `.github/workflows/ci.yml`, `shared/vitest.config.ts`
**Complexity:** Small
**Dependencies:** None

---

## Suggested Sequencing

**Phase 1 — Immediate (next 1-2 sprints):**
- 1a (Saved Replays Gallery) — unlock existing hidden value
- 1d (Win Celebration) — emotional impact, trivial effort
- 1e (Elimination Toast) — game feel improvement
- 3d (Haptic Feedback) — quick mobile polish
- 4d (E2E Integration Tests) — safety net before adding features

**Phase 2 — Short-term:**
- 2a (Game History Persistence) — gives the game "memory"
- 4b (Server-Side Replays) — build alongside 2a, same DB work
- 1b (Emoji Reactions) — social layer
- 2e (QR Code Room Links) — frictionless invites
- 3a (Hand Selector Presets) — speed up gameplay

**Phase 3 — Medium-term:**
- 4a (Redis Adapter Validation) — unblock scaling
- 2c (Spectator Chat) — social completeness
- 2d (Custom Avatars) — identity and personalization
- 3b (Card Deal Animation) — production polish
- 3c (Better Reveal) — dramatic moments
- 4c (Observability) — operational readiness

**Phase 4 — Longer-term:**
- 2f (Deck Variants) — replayability
- 2g (Push Notifications) — retention
- 2b (Friends List) — social graph
- 3f (Accessibility Audit) — quality bar
- 3g (Onboarding Improvements) — new player retention
- 4e (Rate Limiting Hardening) — security at scale
- 4f (DB Resilience) — production reliability

---

## Existing TODO(scale) Markers

These are intentional temporary solutions already documented in the codebase:

| Location | Marker | Migration Trigger |
|---|---|---|
| `shared/src/replay.ts:202` | localStorage → PostgreSQL for replay storage | When user accounts are implemented |
| `server/src/index.ts:37` | CORS origins hardcoded for single domain | When serving from multiple domains/CDN |
| `server/src/db/pool.ts:14` | No read replicas | When adding read replicas for leaderboard/history queries |

---

## What's Already Solid

The codebase is production-grade in several areas that do **not** need immediate work:
- **Game engine**: Pure, well-tested state machine with 17+ test files covering critical paths, edge cases, and regressions
- **Security model**: Server-authoritative, cards never leaked, input validated at every boundary, reconnect tokens rotated
- **Bot AI**: Three difficulty levels with cross-round memory and opponent profiling
- **Mobile UX**: Wheel pickers, touch targets, responsive layouts, no hover-only interactions
- **Sound design**: Contextual audio with volume control and lazy loading
- **CI/CD**: Parallel tests, auto-merge to develop, Docker validation, gated production deploys
- **Reconnection**: Token rotation, 30s window, state restoration from Redis
- **Replay engine**: Full step-through navigation with auto-play, keyboard controls, localStorage persistence
