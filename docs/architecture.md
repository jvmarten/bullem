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
- **`engine/BotPlayer.ts`** — Bot AI with three difficulty levels (normal, hard, impossible), cross-round opponent memory

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
- **`game/GameEngine.ts`** — Re-exports from shared (server uses the same engine)

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

Three difficulty levels in `BotPlayer`:

- **Normal** — basic probability estimation using own cards only
- **Hard** — considers opponent patterns, call history, bluff likelihood
- **Impossible** — sees all human players' cards (but not other bots')

Bots have cross-round opponent memory scoped per room (`OpponentProfile`), with human-like think delays (1.5–7s for calls, 0.4–1.2s for bull/true). Delay varies by: round depth, total cards in play, speed setting (slow/normal/fast multiplier), and random jitter.

`BotManager` handles turn scheduling with generation-based stale detection — if two rapid events both trigger scheduling, the older callback detects it's been superseded and bails out. It also manages human turn timers and auto-actions for disconnected players.

A `BackgroundGameManager` maintains an always-running bot-only game visible on the home page for spectating.

## Authentication (Optional)

When `DATABASE_URL` is set, the server enables user accounts:

- **Registration/Login** — email + password (bcrypt cost 12)
- **JWT tokens** — 7-day expiry, stored in HTTP-only cookies
- **Socket middleware** — extracts JWT from cookie header during handshake, attaches `userId`/`username` to `socket.data`
- **Profile** — win/loss stats aggregated from `game_players` table
- Auth is fully optional — unauthenticated users play as guests

Routes: `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`

## Persistence Layers

### Redis (optional, set `REDIS_URL`)

- **Socket.io adapter** — pub/sub for multi-instance room coordination
- **Session persistence** — room + game state survives server restarts
  - Key design: `room:{code}` → JSON snapshot (24h TTL, refreshed on every write)
  - `room:index` → SET of active codes (for enumeration on restore)
  - Fire-and-forget writes: errors logged, never block game actions
  - Retry with exponential backoff (3 attempts), consecutive failure alerting

### PostgreSQL (optional, set `DATABASE_URL`)

- **Users** — accounts, password hashes, display names
- **Game history** — `game_players` table for per-player stats
- **Migrations** — run automatically on startup (`server/src/db/migrate.ts`)

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
/profile             Player profile + stats
```

Online routes use `GameContext` (socket-based). Local routes use `LocalGameContext` (runs GameEngine directly in the browser, persists to localStorage).

All pages are lazy-loaded except the home page (code splitting via React.lazy).

## Replay System

Games are recorded automatically via round snapshots captured in `GameEngine`:

1. At each round start, player cards are captured (`_roundStartCards`)
2. Turn history accumulates during play
3. At resolution, a `RoundSnapshot` (cards + history + result) is saved
4. On game over, a `GameReplay` is built and emitted to all clients
5. Clients can save replays to localStorage (max 10, LRU eviction)
6. `ReplayEngine` provides pure step-forward/backward/seek navigation

## Key Design Decisions

- **Custom hand ranking**: Flush < Three of a Kind < Straight. This makes the game more interesting because flush requires 5 same-suit cards (rare in small hands), while three-of-a-kind only needs 3 same-rank cards.
- **All flushes are equal**: You can't raise within the flush tier — you must jump to a higher hand type. This simplifies comparison and matches the intuition that suits don't have an inherent ordering.
- **Reconnect token rotation**: On each reconnect, the old token is invalidated and a new one is issued. This limits the window for a stolen token to be reused.
- **Generation-based timer invalidation**: Instead of storing timer IDs and canceling them (which races with callback execution), timers capture a generation number and check if it's still current when they fire.
- **Last Chance mode variants**: "Classic" (default) enters BULL_PHASE after a last-chance raise, allowing immediate true/bull/raise. "Strict" enters CALLING, requiring someone to bull first before true becomes available.
- **Mass elimination prevention**: If all active players would be penalized AND all would exceed maxCards, penalties are skipped entirely to prevent a draw.
