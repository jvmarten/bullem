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

Bots have cross-round opponent memory scoped per room (`OpponentProfile`), with human-like think delays (1.5–7s for calls, 0.4–1.2s for bull/true).

## Scale Considerations

Current architecture uses in-memory state (rooms, game engines, player mappings). Marked with `// TODO(scale):` comments throughout. Migration path for horizontal scaling:

1. **Redis adapter** for Socket.io — enables multi-server pub/sub
2. **Redis session store** — externalize room state, player mappings
3. **Serializable state** — `GameEngine.serialize()`/`restore()` already implemented
4. **Stateless handlers** — socket handlers are thin dispatchers, game engine is pure

## Client Routing

```
/                    Home (join/create room, player count)
/host                Host settings page
/room/:roomCode      Lobby (waiting room, settings, bots)
/game/:roomCode      Active game
/results/:roomCode   Game results + stats
/local               Local game lobby (vs bots)
/local/game          Local game
/local/results       Local game results
/how-to-play         Rules page
```

Online routes use `GameContext` (socket-based). Local routes use `LocalGameContext` (runs GameEngine directly in the browser).
