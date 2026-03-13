# Architecture

## Overview

Bull 'Em is a three-package monorepo: `shared/`, `server/`, and `client/`. The server is the single source of truth for all game state. Clients are untrusted rendering layers that send actions and receive state updates over WebSockets.

```
┌─────────────┐     WebSocket (Socket.io)     ┌─────────────┐
│   Client    │ ◄──────────────────────────── │   Server    │
│  (React)    │ ────────────────────────────► │  (Express)  │
│             │   game:call, game:bull, etc.   │             │
└─────────────┘                                └──────┬──────┘
                                                      │
                                               ┌──────┴──────┐
                                               │   Shared    │
                                               │  (Types +   │
                                               │   Engine)   │
                                               └─────────────┘
```

## Package Responsibilities

### `shared/` — Single Source of Truth

Contains everything both sides need:

- **`types.ts`** — All game state types (`Card`, `HandCall`, `Player`, `ClientGameState`, `GameSettings`, etc.)
- **`events.ts`** — Typed Socket.io event interfaces (`ClientToServerEvents`, `ServerToClientEvents`)
- **`constants.ts`** — Game configuration (rank values, player limits, timing constants, bot names)
- **`hands.ts`** — Hand comparison (`isHigherHand`), validation (`validateHandCall`), display formatting (`handToString`), minimum raise calculation
- **`engine/GameEngine.ts`** — Core game state machine (deals cards, handles turns, resolves rounds, tracks stats)
- **`engine/HandChecker.ts`** — Checks if a called hand exists in a set of cards, finds matching/relevant cards for reveal
- **`engine/Deck.ts`** — Standard 52-card deck with Fisher-Yates shuffle
- **`engine/BotPlayer.ts`** — Bot AI: heuristic decision engine (levels 1-8) + CFR dispatch (level 9), cross-round opponent memory
- **`botProfiles.ts`** — 81 bot profile definitions (9 personalities × 9 levels), evolved parameter configs
- **`cfr/`** — CFR-trained strategy data and evaluation for level 9 bots
- **`rating.ts`** — Pure Elo and OpenSkill rating calculation functions
- **`validation.ts`** — Server-side game settings validation against known allowlists
- **`replay.ts`** — `GameReplay` type, `ReplayEngine` (step-through viewer), localStorage persistence

### `server/` — Authoritative Game Server

- **`index.ts`** — Express app + Socket.io server setup, CORS config, health check, graceful shutdown
- **`rooms/Room.ts`** — Room lifecycle: player management, reconnection with token rotation, spectator tracking, disconnect timers, round-continue coordination
- **`rooms/RoomManager.ts`** — Room CRUD, socket↔room mapping, player↔room index, stale room cleanup, room/game listing
- **`socket/registerHandlers.ts`** — Connection handler, rate limiting (15 events/sec + 200ms game action cooldown), wires up lobby and game handlers
- **`socket/lobbyHandlers.ts`** — Room creation/joining, settings, bot management, game start, spectating
- **`socket/gameHandlers.ts`** — Game action handlers (call, bull, true, last chance), delegates to engine
- **`socket/broadcast.ts`** — Per-player state broadcasting (each player gets only their own cards)
- **`socket/roundTransition.ts`** — Round result phase, continue-window management, next round transitions
- **`game/BotManager.ts`** — Bot turn scheduling with human-like delays, turn timers for humans, auto-actions for disconnected players
- **`game/BackgroundGameManager.ts`** — Always-running bot-only game for home page spectating
- **`game/CalibrationManager.ts`** — Round-robin bot calibration pipeline with convergence detection
- **`matchmaking/MatchmakingQueue.ts`** — Ranked matchmaking: Elo-based for 1v1, OpenSkill for multiplayer, bot backfill
- **`push/PushManager.ts`** — Web Push notification delivery via VAPID
- **`admin/routes.ts`** — Admin panel API (user management, analytics, bot management)
- **`auth/oauth.ts`** — Google and Apple OAuth flows (redirect → callback → JWT)

### `client/` — React Frontend

- **`socket.ts`** — Singleton Socket.io client, auto-connects once at module load
- **`context/GameContext.tsx`** — Online game state management, socket event listeners, reconnection logic
- **`context/LocalGameContext.tsx`** — Local (offline) game state using the shared GameEngine directly
- **`pages/`** — Route pages: Home, Host, Lobby, Game, Results (both online and local variants)
- **`components/`** — Reusable UI: HandSelector (wheel picker), ActionButtons, CardDisplay, CallHistory, RevealOverlay, SpectatorView, etc.
- **`hooks/soundEngine.ts`** — Web Audio API sound engine with lazy-loaded audio assets
- **`utils/cardUtils.ts`** — Display helpers for card rendering

## Key Data Flows

### Game Action (e.g., player calls a hand)

```
Client                          Server
  │                               │
  ├── game:call {hand} ──────────►│
  │                               ├── validateHandCall(hand)
  │                               ├── game.handleCall(playerId, hand)
  │                               ├── scheduleBotTurn() (if next is bot)
  │                               ├── broadcastGameState() ──────────►│
  │◄── game:state {per-player} ──┤     (each player gets own cards)
  │                               │
```

### Round Resolution

```
All non-callers respond (bull/true)
  │
  ├── Everyone called bull? ──► Last Chance phase (caller can raise or pass)
  │
  ├── resolveRound()
  │     ├── HandChecker.exists(allCards, calledHand)
  │     ├── Determine penalties (wrong callers get +1 card)
  │     ├── Eliminate players exceeding maxCards
  │     └── Return RoundResult
  │
  ├── game:roundResult ──────► All clients show reveal overlay
  │
  ├── 30s continue window (or all players press Continue)
  │
  └── startNextRound() or game:over
```

### Reconnection

1. Client stores `playerId` + `reconnectToken` from initial join
2. On disconnect, server marks player as disconnected and starts 30s timer
3. Client reconnects via `room:join` with stored credentials
4. Server verifies the secret token (prevents session hijacking), rotates token
5. If 30s expires without reconnect, player is eliminated through the game engine

## Security Model

- **Server-authoritative**: Game engine runs server-side only. Clients send actions, never state
- **Card privacy**: `broadcastGameState()` sends each player only their own cards via `getClientState(playerId)`. Other players' cards are never transmitted (except to eliminated spectators)
- **Reconnect tokens**: UUID tokens (separate from player IDs) prevent session hijacking. Tokens rotate on each reconnect
- **Input validation**: All socket events validated server-side — `validateHandCall()` for hand data, `sanitizeName()`/`sanitizeRoomCode()` for user input
- **Rate limiting**: 15 events/second per socket + 200ms cooldown between game actions, keyed by player ID (survives reconnects)
- **CORS**: Unrestricted in dev, configurable allowlist in production via `CORS_ORIGINS`

## State Machine

### Game Phases (`GamePhase`)

```
LOBBY ──► PLAYING ──► ROUND_RESULT ──► PLAYING (next round)
                  │                          │
                  └──► GAME_OVER ◄───────────┘
```

### Round Phases (`RoundPhase`)

```
CALLING ──► BULL_PHASE ──► LAST_CHANCE ──► RESOLVING
    ▲            │                │
    └────────────┘ (raise resets) └── (raise resets to BULL_PHASE)
```

## Bot System

**81 total bot profiles** organized into two tiers:

### Heuristic Bots (72 profiles — levels 1-8)

9 personalities × 8 levels. Each personality has "signature parameters" that define its play style (e.g., Rock has low riskTolerance, Bluffer has low bullThreshold). Non-signature parameters use evolved baseline values from genetic algorithm training.

- **Easy** (lvl 1-3): beginner-friendly, lerps from unskilled baseline toward personality config
- **Normal** (lvl 4-6): standard difficulty
- **Hard** (lvl 7-8): strong play, personality-specific deviations from evolved champion

Decision logic uses hypergeometric probability estimation, opponent memory (`OpponentProfile`), and situational context (position, card count, escalation patterns). All decisions route through the same code path — difficulty is controlled entirely by `BotProfileConfig` parameter interpolation.

### CFR Bots (9 profiles — level 9)

Trained via Counterfactual Regret Minimization. Bypass the heuristic system entirely and use `decideCFR()` from `shared/src/cfr/cfrEval.ts`. These are the strongest tier, providing game-theory-optimal play.

Profiles: Viper, Ghost, Reaper, Specter, Raptor, Havoc, Phantom, Sentinel, Vanguard.

### Bot Infrastructure

- `BotManager` handles turn scheduling with generation-based stale detection — if two rapid events both trigger scheduling, the older callback detects it's been superseded and bails out. Also manages human turn timers and auto-actions for disconnected players.
- `BackgroundGameManager` maintains an always-running bot-only game visible on the home page for spectating.
- `CalibrationManager` runs round-robin calibration pipelines with convergence detection.
- Human-like think delays: 1.5–7s for calls, 0.4–1.2s for bull/true. Varies by round depth, total cards, speed setting (slow/normal/fast multiplier), and random jitter.

## Authentication (Optional)

When `DATABASE_URL` is set, the server enables user accounts:

- **Registration/Login** — email + password (bcrypt cost 12), or OAuth (Google, Apple)
- **JWT tokens** — 7-day expiry, stored in HTTP-only cookies
- **Socket middleware** — extracts JWT from cookie header during handshake, attaches `userId`/`username` to `socket.data`
- **Profile** — win/loss stats, rating history, hand-type breakdown, rivalries, career trajectory
- **Avatar system** — 11 emoji templates + custom profile photo upload (Tigris S3 object storage)
- Auth is fully optional — unauthenticated users play as guests

Routes: `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `GET /auth/google`, `GET /auth/google/callback`, `GET /auth/apple`, `POST /auth/apple/callback`

## Matchmaking & Ranked Play

Redis-backed matchmaking queue with dual rating system:

- **Heads-up (1v1)** — Elo rating (K=32 provisional, K=16 established). Always Bo3 in ranked.
- **Multiplayer (3-9)** — OpenSkill (Bayesian mu/sigma). Target 4 players, min 3 with bot backfill.
- **Queue mechanics** — 2.5s matching interval, ±150 Elo window (widens after 15s), bot backfill after 30s.
- **Rank tiers** — Bronze (<1000), Silver (1000-1199), Gold (1200-1399), Platinum (1400-1599), Diamond (1600+).
- **Ranked settings locked** — maxCards=5, turnTimer=30s, lastChanceMode=classic. Cannot be overridden.

Leaderboards: paginated, time-filtered (all-time/month/week), per-mode, with rank tier display.

## Friends System

Real-time friend management over WebSocket:

- **Friend requests** — send by username, accept/reject, remove
- **Online status** — tracked via socket connections, broadcast to friends on connect/disconnect
- **Game invites** — invite friends to your current room
- **Room awareness** — see which room a friend is in

Socket events: `friends:request`, `friends:respond`, `friends:remove`, `friends:invite`, `friends:list` (client→server). `friends:requestReceived`, `friends:requestAccepted`, `friends:statusChanged`, `friends:invited`, `friends:roomCreated` (server→client).

## Persistence Layers

### Redis (optional, set `REDIS_URL`)

- **Socket.io adapter** — pub/sub for multi-instance room coordination
- **Session persistence** — room + game state survives server restarts
  - Key design: `room:{code}` → JSON snapshot (24h TTL, refreshed on every write)
  - `room:index` → SET of active codes (for enumeration on restore)
  - Fire-and-forget writes: errors logged, never block game actions
  - Retry with exponential backoff (3 attempts), consecutive failure alerting

### PostgreSQL (optional, set `DATABASE_URL`)

- **Users** — accounts, password hashes, display names, avatars, OAuth linked accounts
- **Game history** — `games` + `game_players` tables for per-player stats, finish positions, rating changes
- **Ratings** — `player_ratings` for Elo (heads-up) and OpenSkill (multiplayer), `ranked_matches` for full match history
- **Friends** — `friendships` table with pending/accepted/blocked states
- **Replays** — `game_rounds` table for server-side replay persistence
- **Push subscriptions** — `push_subscriptions` table for Web Push endpoints
- **Analytics** — `analytics_balance_snapshot` for game balance tracking
- **Migrations** — run automatically on startup (`server/src/db/migrate.ts`), 18+ migrations
- **Read replicas** — `READ_DATABASE_URL` support via `readPool` in `pool.ts`, falls back to primary

Without Redis/PostgreSQL, the server runs fully in-memory. All game state is still serializable for when these are added.

## Scale Considerations

The architecture is designed for horizontal scaling with minimal changes. Migration path:

1. **Set `REDIS_URL`** → Socket.io adapter + session persistence activate automatically
2. **Multiple Fly.io machines** → rooms coordinate via Redis pub/sub
3. **All state is serializable** — `GameEngine.serialize()`/`restore()`, `Room.serialize()`/`restore()` already implemented
4. **Stateless handlers** — socket handlers are thin dispatchers, game engine is pure
5. **`// TODO(scale):`** comments mark every in-memory dependency that needs externalization

Current bottleneck: `RoomManager` holds all rooms in memory on one instance. With Redis, this becomes a distributed cache.

## Client Routing

```
/                    Home (join/create room, browse rooms, player count)
/host                Host settings page (max cards, timer, spectators)
/room/:roomCode      Lobby (waiting room, settings, bots, share link)
/game/:roomCode      Active game (main gameplay UI)
/results/:roomCode   Game results + stats + replay link
/local               Local game lobby (vs bots, difficulty/speed settings)
/local/game          Local game (same UI, runs engine in-browser)
/local/results       Local game results
/how-to-play         Rules page
/tutorial            Interactive tutorial
/replay              Replay viewer (step through recorded games)
/login               Login page
/register            Registration page
/profile             Player profile + stats + advanced analytics
/profile/:userId     Public profile page (other players / bot profiles)
/leaderboard         Ranked leaderboard (heads-up / multiplayer, time filters)
/friends             Friends list, requests, online status
/deck-draw           Deck Draw minigame (5-card draw with wagering)
```

Online routes use `GameContext` (socket-based). Local routes use `LocalGameContext` (runs GameEngine directly in the browser, persists to localStorage).

All pages are lazy-loaded except the home page (code splitting via React.lazy).

## Replay System

Games are recorded automatically via round snapshots captured in `GameEngine`:

1. At each round start, player cards are captured (`_roundStartCards`)
2. Turn history accumulates during play
3. At resolution, a `RoundSnapshot` (cards + history + result) is saved
4. On game over, a `GameReplay` is built and emitted to all clients
5. **Server-side**: replays persisted to PostgreSQL (`game_rounds` table), served via `GET /api/replays/:gameId`
6. **Client-side**: replays also saved to localStorage (max 10, LRU eviction) as offline fallback
7. `ReplayEngine` provides pure step-forward/backward/seek navigation with auto-play and keyboard shortcuts

## Observability

- **Structured logging** — Pino with JSON output in production, pretty-print in dev. Configurable via `LOG_LEVEL`.
- **Error tracking** — Sentry integration (`SENTRY_DSN`). Errors reported automatically with context.
- **Prometheus metrics** — `GET /metrics` endpoint. Room count, active players, round duration, error rates.
- **Health check** — `GET /health` returns `{ status, db, rooms, players }`.
- **Database resilience** — exponential backoff with jitter on connection failures, degraded mode fallback, auto-reconnection.

## Key Design Decisions

- **Custom hand ranking**: Flush < Three of a Kind < Straight. This makes the game more interesting because flush requires 5 same-suit cards (rare in small hands), while three-of-a-kind only needs 3 same-rank cards.
- **All flushes are equal**: You can't raise within the flush tier — you must jump to a higher hand type. This simplifies comparison and matches the intuition that suits don't have an inherent ordering.
- **Reconnect token rotation**: On each reconnect, the old token is invalidated and a new one is issued. This limits the window for a stolen token to be reused.
- **Generation-based timer invalidation**: Instead of storing timer IDs and canceling them (which races with callback execution), timers capture a generation number and check if it's still current when they fire.
- **Last Chance mode variants**: "Classic" (default) enters BULL_PHASE after a last-chance raise, allowing immediate true/bull/raise. "Strict" enters CALLING, requiring someone to bull first before true becomes available.
- **Mass elimination prevention**: If all active players would be penalized AND all would exceed maxCards, penalties are skipped entirely to prevent a draw.
