# Bull 'Em — Feature & Improvement Roadmap

> Generated 2026-03-04 after full codebase review.
> Nothing here is implemented — this is a prioritized plan only.

---

## Current State Summary

The game is **live and playable** at `https://bullem.fly.dev`. Core gameplay, online multiplayer, local bot play, reconnection handling, sound design, animations, and mobile-first UI are all production-grade. The codebase has 140+ critical tests, strict TypeScript, server-authoritative architecture, and automated CI/CD.

**Completed milestones:** Core engine, turn logic, rooms, playable UI, polish, deployment.
**Next on the CLAUDE.md roadmap:** Scale infrastructure, native mobile, matchmaking, analytics/replays.

---

## (1) Quick Wins — Small Effort, Noticeable Improvement

### 1A. Invite Link / Share Button
**What:** Add a native share button (Web Share API) or copy-to-clipboard for the room invite link, prominently placed in the lobby and in-game.
**Why:** Currently players must manually share the room code. A one-tap share flow removes the biggest friction point for getting friends into a game.
**Touches:** `client/src/pages/LobbyPage.tsx`, `client/src/pages/GamePage.tsx`
**Complexity:** Small
**Dependencies:** None

### 1B. Rematch / Play Again Flow
**What:** After a game ends, let the host start a new game with the same players without everyone leaving and re-joining a new room. Reset the `GameEngine`, keep the room and players intact.
**Why:** Right now finishing a game is a dead end — players have to manually navigate back and re-create a room. A seamless rematch loop keeps groups playing longer.
**Touches:** `server/src/rooms/Room.ts` (add `resetForRematch()`), `shared/src/engine/GameEngine.ts` (reset method), `server/src/socket/lobbyHandlers.ts` (new `game:rematch` event), `client/src/pages/ResultsPage.tsx` (rematch button), `shared/src/events.ts`
**Complexity:** Small–Medium
**Dependencies:** None

### 1C. Player Kick (Host)
**What:** Let the host kick a player from the lobby before the game starts.
**Why:** Useful for removing AFK players or strangers who joined via browse. Currently the host has no control over who stays.
**Touches:** `server/src/socket/lobbyHandlers.ts` (new `room:kick` handler), `server/src/rooms/Room.ts`, `client/src/pages/LobbyPage.tsx` (kick button on player list), `shared/src/events.ts`
**Complexity:** Small
**Dependencies:** None

### 1D. Toast / Notification System
**What:** Replace inline error strings with a lightweight toast notification system (e.g., player joined, player disconnected, error messages, "link copied").
**Why:** Current errors appear as text in-place and auto-clear after 5 seconds. Toasts are more visible, stack properly, and feel more polished.
**Touches:** New `client/src/components/Toast.tsx`, `client/src/context/GameContext.tsx` (replace `error` state), all pages that display errors
**Complexity:** Small
**Dependencies:** None

### 1E. Emoji Reactions During Game
**What:** Let players send quick emoji reactions (e.g., 😂 🤔 😤 👏) that appear briefly above their avatar during gameplay.
**Why:** Adds social presence and fun without requiring a full chat system. Low effort, high engagement.
**Touches:** New `client/src/components/EmojiReaction.tsx`, `server/src/socket/gameHandlers.ts` (new `game:react` event with rate limiting), `shared/src/events.ts`, `client/src/pages/GamePage.tsx`
**Complexity:** Small
**Dependencies:** None

### 1F. Haptic Feedback on Mobile
**What:** Add `navigator.vibrate()` calls on key game events (your turn, bull called, round result).
**Why:** Subtle but impactful on mobile — makes the game feel more alive. Trivial to implement, gracefully degrades.
**Touches:** `client/src/hooks/useSound.ts` (add vibrate alongside sound plays)
**Complexity:** Small
**Dependencies:** None

---

## (2) Core Features — Meaningful Additions

### 2A. Chat System (In-Game + Lobby)
**What:** Simple text chat visible to all players in a room. Collapsible panel, with optional preset quick-chat messages.
**Why:** Communication is essential in a social bluffing game. Without chat, players need a separate app (Discord, iMessage) open, which breaks immersion and adds friction.
**Touches:** New `client/src/components/ChatPanel.tsx`, `server/src/socket/` (new `chat:message` handler), `shared/src/events.ts`, `client/src/pages/GamePage.tsx` + `LobbyPage.tsx`, input validation/sanitization, rate limiting
**Complexity:** Medium
**Dependencies:** 1D (Toast system for "new message" indicator)

### 2B. Player Accounts & Persistent Stats
**What:** Optional account creation (email/password or OAuth) so stats persist across sessions. Track lifetime wins, bull accuracy, bluff success rate, games played.
**Why:** Progression and stats give players a reason to come back. Currently all data is ephemeral — once you close the tab, everything is gone. This is the foundation for ranked play and leaderboards.
**Touches:** New `server/src/auth/` module, database schema (PostgreSQL), `shared/src/types.ts` (user types), `client/src/pages/ProfilePage.tsx`, `client/src/context/AuthContext.tsx`, session management
**Complexity:** Large
**Dependencies:** Database infrastructure (PostgreSQL)

### 2C. Spectator Improvements
**What:** (a) Let spectators see cards in real-time (if room setting allows). (b) Spectator count visible to players. (c) Spectators can send emoji reactions. (d) "Watch random game" button on home page.
**Why:** Spectating is already partially implemented (eliminated players can spectate), but live spectating for friends who arrive late or want to watch before joining is a natural extension.
**Touches:** `server/src/socket/lobbyHandlers.ts`, `client/src/components/SpectatorView.tsx`, `client/src/pages/HomePage.tsx`, `server/src/rooms/Room.ts` (spectator tracking)
**Complexity:** Medium
**Dependencies:** None (builds on existing spectator infrastructure)

### 2D. Game Replay System
**What:** Record every game action (turn history is already tracked) and allow replaying completed games step-by-step, with all cards visible.
**Why:** Players love reviewing close games, sharing highlights, and learning from mistakes. The `GameEngineSnapshot` serialization and `turnHistory` already capture everything needed.
**Touches:** New `shared/src/replay.ts` (replay engine — step through snapshots), `server/src/rooms/Room.ts` (persist snapshots per round), `client/src/pages/ReplayPage.tsx`, storage backend (initially localStorage for local games, later PostgreSQL)
**Complexity:** Medium–Large
**Dependencies:** 2B (for persistent storage of replays across sessions)

### 2E. Custom Game Modes / House Rules
**What:** Configurable rule variants the host can toggle: (a) No flushes. (b) Wild cards. (c) Speed mode (5-second turns). (d) Sudden death (start at max cards - 1). (e) Team mode (2v2, 3v3).
**Why:** Variety keeps the game fresh after many sessions. The `GameSettings` type already supports extensibility, and the pure-function game engine makes rule variants straightforward to add.
**Touches:** `shared/src/types.ts` (extend `GameSettings`), `shared/src/engine/GameEngine.ts` (conditional logic per rule), `client/src/pages/HostPage.tsx` (settings UI), `server/src/socket/lobbyHandlers.ts` (validation)
**Complexity:** Medium per variant (start with one, add more iteratively)
**Dependencies:** None

### 2F. Tutorial / Interactive Onboarding
**What:** A guided first-game experience where a bot walks new players through the rules interactively — deal a hand, explain the UI, simulate a round with prompts.
**Why:** The "How to Play" page exists but is passive text. Bluffing card games have nuanced rules (especially the custom hand ranking and bull/true/last-chance flow). An interactive tutorial converts confused visitors into players.
**Touches:** New `client/src/pages/TutorialPage.tsx`, potentially a scripted bot sequence using `LocalGameContext`, `client/src/components/TutorialOverlay.tsx` (tooltips/highlights)
**Complexity:** Medium
**Dependencies:** None

---

## (3) Polish — UX Improvements, Animations, Edge Cases

### 3A. Card Deal & Reveal Animations Upgrade
**What:** Enhance card animations: (a) Cards fly from a deck to each player. (b) Reveal phase shows cards flipping from back to front with 3D perspective. (c) Winning/losing cards get highlighted vs. dimmed.
**Why:** The current deal animation uses CSS stagger delays which work but feel flat. Physics-based or path-based animations (cards arcing to positions) would feel premium — matching the Supercell-quality vision.
**Touches:** `client/src/components/HandDisplay.tsx`, `client/src/components/RevealOverlay.tsx`, `client/src/styles/index.css` (new keyframes)
**Complexity:** Medium
**Dependencies:** None

### 3B. Sound Design Pass
**What:** Replace synthesized oscillator sounds with higher-quality audio. Add contextual sounds: card slide for browsing hand selector, crowd gasp/cheer for bull/true calls, suspenseful music during last-chance phase.
**Why:** The current Web Audio synthesis is functional but thin. Richer audio dramatically increases perceived polish. The `soundEngine.ts` already supports file-based audio with lazy loading, so the infrastructure is ready.
**Touches:** `client/src/hooks/soundEngine.ts` (new sound definitions), new audio files in `client/src/assets/sounds/`, `client/src/hooks/useSound.ts`
**Complexity:** Medium (mostly asset creation/sourcing)
**Dependencies:** None

### 3C. Landscape Mode Support
**What:** Optimize layout for landscape orientation on phones and tablets. Cards displayed in a wider fan, player list on the side instead of top, action buttons repositioned.
**Why:** Many players hold their phone sideways for games. The current portrait-first layout works but wastes space in landscape. Tablets especially benefit.
**Touches:** `client/src/styles/index.css` (media queries for landscape), `client/src/pages/GamePage.tsx` + `LocalGamePage.tsx` (conditional layout), `client/src/components/HandDisplay.tsx`
**Complexity:** Medium
**Dependencies:** None

### 3D. Disconnect/Reconnect UX
**What:** (a) Show a visible "Reconnecting..." overlay with progress when connection drops. (b) Show countdown timer for disconnected players ("Player X has 25s to reconnect"). (c) Animate player dimming/brightening on disconnect/reconnect.
**Why:** Disconnections happen often on mobile. Currently the UI doesn't clearly communicate what's happening — players don't know if their opponent left or is reconnecting.
**Touches:** `client/src/context/GameContext.tsx` (connection state tracking), `client/src/components/PlayerList.tsx` (disconnect timer display), new `client/src/components/ReconnectOverlay.tsx`
**Complexity:** Small–Medium
**Dependencies:** None

### 3E. Hand Selector UX Improvements
**What:** (a) Show which hands are possible given your cards (highlight/dim). (b) "Quick raise" button that auto-selects the minimum raise. (c) Remember last selected hand type across turns. (d) Swipe gestures to cycle through hand types.
**Why:** The hand selector is functional but requires multiple taps to build a call. Reducing friction makes turns faster and the game more fluid — critical for mobile one-handed play.
**Touches:** `client/src/components/HandSelector.tsx`, `client/src/components/WheelPicker.tsx`
**Complexity:** Medium
**Dependencies:** None

### 3F. Turn Timer Visual Polish
**What:** (a) Screen edge glow that intensifies as timer runs low. (b) Heartbeat sound effect in final 5 seconds. (c) Pulsing player avatar when it's their turn.
**Why:** Turn urgency creates tension — the core emotion of a bluffing game. The timer meter exists but could create more dramatic pressure.
**Touches:** `client/src/components/TurnIndicator.tsx`, `client/src/styles/index.css`, `client/src/hooks/soundEngine.ts`
**Complexity:** Small
**Dependencies:** None

### 3G. Accessibility Improvements
**What:** (a) ARIA labels on all interactive elements. (b) Keyboard navigation support for hand selector. (c) High-contrast mode toggle. (d) Screen reader announcements for game events. (e) Color-blind safe suit indicators (shapes/patterns in addition to color).
**Why:** Accessibility expands the player base and is the right thing to do. Card games especially need color-blind support since red/black suits are a core visual.
**Touches:** All components (ARIA), `client/src/styles/index.css` (high contrast), `client/src/components/CardDisplay.tsx` (suit patterns), `client/src/components/HandSelector.tsx` (keyboard nav)
**Complexity:** Medium
**Dependencies:** None

---

## (4) Infrastructure — Not User-Facing, Unblocks Future Growth

### 4A. Redis Adapter for Socket.io
**What:** Add Redis as the Socket.io adapter so multiple server instances share socket state. This is the single most important infrastructure change for horizontal scaling.
**Why:** Currently the app runs on a single Fly.io machine. With Redis adapter, rooms and socket connections are shared across instances, enabling auto-scaling to handle thousands of concurrent players. The architecture is already designed for this (serializable state, no in-memory-only data).
**Touches:** `server/src/index.ts` (add `@socket.io/redis-adapter`), new Redis connection config, `fly.toml` (add Redis service), `package.json` (new dependency)
**Complexity:** Medium
**Dependencies:** Redis instance (Fly.io Upstash or managed Redis)

### 4B. Session Persistence (Redis)
**What:** Store room state and game snapshots in Redis so games survive server restarts and deployments. Use `GameEngine.serialize()` / `GameEngine.restore()` which already exist.
**Why:** Currently a server deploy kills all active games. With Redis persistence, games resume transparently after zero-downtime deploys.
**Touches:** `server/src/rooms/RoomManager.ts` (serialize/restore rooms to Redis), `server/src/rooms/Room.ts` (serialize player state), Redis key design
**Complexity:** Medium
**Dependencies:** 4A (Redis adapter — same Redis instance)

### 4C. Database (PostgreSQL)
**What:** Add PostgreSQL for persistent data: player accounts, game history, stats, replays. Design schema for users, games, rounds, and stats tables.
**Why:** Required foundation for accounts (2B), replays (2D), leaderboards, and analytics. Without a database, the product can't grow beyond ephemeral sessions.
**Touches:** New `server/src/db/` module, schema migrations, Fly.io Postgres setup, `server/package.json` (add pg driver)
**Complexity:** Large
**Dependencies:** None (but enables 2B, 2D, and future matchmaking)

### 4D. Enable `noUncheckedIndexedAccess`
**What:** Enable the TypeScript `noUncheckedIndexedAccess` flag in `tsconfig.base.json` and fix all resulting type errors in `BotPlayer.ts`, `GameEngine.ts`, and `Deck.ts`.
**Why:** This is the only intentional type-safety gap called out in the codebase (`// TODO(scale)` in tsconfig.base.json). Fixing it prevents potential undefined-access bugs as the codebase grows.
**Touches:** `tsconfig.base.json`, `shared/src/engine/BotPlayer.ts`, `shared/src/engine/GameEngine.ts`, `shared/src/engine/Deck.ts`
**Complexity:** Small–Medium (mechanical fixes, but many files)
**Dependencies:** None

### 4E. Structured Logging & Error Tracking
**What:** Replace `console.log` with structured JSON logging (e.g., pino) with correlation IDs per room/player. Add Sentry or similar for error tracking.
**Why:** Currently debugging production issues requires searching raw console output. Structured logs enable filtering by room code, player ID, or event type. Error tracking catches crashes before users report them.
**Touches:** All `server/src/` files (replace console.log), new logging config, Sentry SDK integration, `fly.toml` (env vars for Sentry DSN)
**Complexity:** Medium
**Dependencies:** None

### 4F. Load Testing & Performance Benchmarks
**What:** Create a load testing suite that simulates N concurrent rooms with bot players, measuring: room creation throughput, event latency (p50/p95/p99), memory per room, and max concurrent rooms per instance.
**Why:** Before scaling to multi-instance (4A), establish baselines. Know the limits of a single machine so scaling decisions are data-driven, not guesses.
**Touches:** New `tests/load/` directory, Artillery or k6 config, Socket.io client automation scripts
**Complexity:** Medium
**Dependencies:** None (but results inform 4A decisions)

### 4G. Multi-Region Deployment
**What:** Deploy to multiple Fly.io regions (currently `iad` only). Configure Redis with regional replicas. Route players to nearest region.
**Why:** Players outside the US East Coast experience higher latency. For a real-time game, 50ms vs 200ms round-trip is the difference between "snappy" and "laggy."
**Touches:** `fly.toml` (add regions), Redis cluster config, possibly `server/src/index.ts` (region-aware room creation)
**Complexity:** Large
**Dependencies:** 4A (Redis adapter), 4B (session persistence)

### 4H. CI Performance: Parallel Test Execution
**What:** Split the Vitest workspace into parallel CI jobs (shared, server, client) instead of running sequentially. Add build caching.
**Why:** As the test suite grows (already 140+ critical tests), CI time increases. Parallel jobs keep the feedback loop fast.
**Touches:** `.github/workflows/ci.yml`, possibly `vitest.workspace.ts`
**Complexity:** Small
**Dependencies:** None

---

## Priority Matrix

| # | Item | Impact | Effort | Priority |
|---|------|--------|--------|----------|
| 1A | Share/Invite Button | High | Small | **Do first** |
| 1B | Rematch Flow | High | Small–Med | **Do first** |
| 1D | Toast Notifications | Medium | Small | **Do first** |
| 3D | Disconnect/Reconnect UX | High | Small–Med | **Do first** |
| 1C | Player Kick | Medium | Small | **Do soon** |
| 3E | Hand Selector UX | Medium | Medium | **Do soon** |
| 3F | Turn Timer Polish | Medium | Small | **Do soon** |
| 1E | Emoji Reactions | Medium | Small | **Do soon** |
| 1F | Haptic Feedback | Low–Med | Small | **Do soon** |
| 2F | Tutorial | High | Medium | **Plan next** |
| 2A | Chat System | High | Medium | **Plan next** |
| 2C | Spectator Improvements | Medium | Medium | **Plan next** |
| 3A | Animation Upgrade | Medium | Medium | **Plan next** |
| 3B | Sound Design Pass | Medium | Medium | **Plan next** |
| 3G | Accessibility | Medium | Medium | **Plan next** |
| 3C | Landscape Mode | Low–Med | Medium | **Later** |
| 2E | Custom Game Modes | Medium | Med/variant | **Later** |
| 4D | noUncheckedIndexedAccess | Low | Small–Med | **Do soon** |
| 4E | Structured Logging | Medium | Medium | **Plan next** |
| 4H | CI Parallelism | Low | Small | **Do soon** |
| 4A | Redis Adapter | High | Medium | **When scaling** |
| 4B | Session Persistence | High | Medium | **When scaling** |
| 4F | Load Testing | Medium | Medium | **Before scaling** |
| 4C | PostgreSQL | High | Large | **When needed** |
| 4G | Multi-Region | High | Large | **When scaling** |
| 2B | Player Accounts | High | Large | **When DB ready** |
| 2D | Replay System | Medium | Med–Large | **When DB ready** |

---

## Suggested Execution Order

**Sprint 1 — Retention & Social (Quick Wins):**
1A (Share Button) → 1B (Rematch) → 1D (Toasts) → 1C (Kick) → 1E (Emoji Reactions)

**Sprint 2 — Game Feel:**
3D (Disconnect UX) → 3E (Hand Selector) → 3F (Timer Polish) → 1F (Haptics) → 3B (Sound Pass)

**Sprint 3 — Growth:**
2F (Tutorial) → 2A (Chat) → 2C (Spectator) → 3G (Accessibility)

**Sprint 4 — Scale Foundation:**
4D (TypeScript strict) → 4E (Logging) → 4F (Load Testing) → 4A (Redis) → 4B (Session Persistence)

**Sprint 5 — Persistence & Accounts:**
4C (PostgreSQL) → 2B (Accounts) → 2D (Replays)

**Later:**
2E (Custom Modes) → 3A (Animations) → 3C (Landscape) → 4G (Multi-Region)
