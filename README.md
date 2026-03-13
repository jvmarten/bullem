# Bull 'Em

A real-time multiplayer bluffing card game. Players are dealt cards and take turns calling increasingly higher poker hands that they claim exist across **all** players' combined cards. Other players call "bull" (bullshit) or raise. Think Liar's Dice meets Texas Hold'em — played in the browser.

**Live at:** [bullem.fly.dev](https://bullem.fly.dev)

## Quick Start

```bash
npm install          # install all workspace dependencies
npm run dev          # start server (3001) + client (5173) concurrently
```

Open `http://localhost:5173`. The Vite dev server proxies `/socket.io` traffic to the backend automatically.

No `.env` file or external services are required for local development. The server uses in-memory state by default; Redis and PostgreSQL are optional (see [Environment Variables](#environment-variables)).

## Project Structure

npm workspaces monorepo with four packages:

```
├── shared/              # Types, constants, game engine, hand logic (pure functions)
│   ├── src/engine/      # GameEngine, HandChecker, Deck, BotPlayer
│   └── src/cfr/         # CFR-trained bot strategy (level 9 bots)
├── server/              # Express + Socket.io backend
│   ├── src/socket/      # Thin WebSocket handlers (validate → engine → broadcast)
│   ├── src/rooms/       # Room lifecycle, RoomManager, Redis persistence
│   ├── src/game/        # BotManager, BackgroundGameManager, CalibrationManager
│   ├── src/auth/        # JWT auth, bcrypt passwords, Google/Apple OAuth
│   ├── src/matchmaking/  # Ranked matchmaking queue (Elo/OpenSkill-based)
│   ├── src/push/        # Web Push notifications (VAPID)
│   ├── src/admin/       # Admin panel API routes
│   └── src/db/          # PostgreSQL pool, auto-migrations
├── client/              # React 19 + Vite frontend (Tailwind CSS 4)
│   ├── src/pages/       # Route pages (online + local variants)
│   ├── src/components/  # Reusable UI (HandSelector, RevealOverlay, etc.)
│   ├── src/context/     # GameContext (socket), LocalGameContext (offline engine)
│   └── src/hooks/       # Sound engine (Web Audio API), navigation guard
├── training/            # Bot AI training scripts (evolution, CFR, simulation)
├── docs/                # Architecture docs, roadmap
├── Dockerfile           # Multi-stage production build (Node 22 Alpine)
├── fly.toml             # Fly.io deployment config
└── CLAUDE.md            # AI assistant & project standards
```

**Boundary rules:** `shared/` is imported by both `client/` and `server/`. Client and server never import from each other.

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full breakdown. Key points:

- **Server-authoritative** — all game logic runs server-side. Clients are untrusted rendering layers
- **Anti-cheat by design** — each player only receives their own cards via `getClientState(playerId)`
- **WebSocket-first** — Socket.io with typed events (`shared/src/events.ts`) for all real-time communication
- **Pure game engine** — `GameEngine` is a state machine with no I/O, no timers, no side effects
- **Thin socket handlers** — validate input → call engine → broadcast per-player state
- **Serializable state** — `GameEngine.serialize()`/`restore()` enable Redis persistence and local game save/restore
- **Optional Redis** — Socket.io adapter + session persistence for horizontal scaling (set `REDIS_URL`)
- **Optional PostgreSQL** — user accounts, game history, stats (set `DATABASE_URL`)

## Game Rules

2–12 players, one standard 52-card deck. Players start with 1 card and gain cards by losing rounds (+1 card per loss). Exceed the configurable max hand size (1–5, default 5) → eliminated. Last player standing wins.

**Custom hand rankings (low → high):**

```
High Card → Pair → Two Pair → Flush → Three of a Kind → Straight →
Full House → Four of a Kind → Straight Flush → Royal Flush
```

Note: **Flush ranks below Three of a Kind**, and both rank below Straight. This differs from standard poker. Flushes of different suits are considered equal within their tier.

**Turn flow:**
1. Call a hand (e.g., "pair of 7s")
2. Next player clockwise: **raise** (call a higher hand) or **call bull**
3. After a bull call, remaining players choose: bull, true, or raise
4. If everyone calls bull → **Last Chance**: original caller can raise or pass
5. Round resolves by checking all players' combined cards against the called hand

**Resolution:** Players who called incorrectly get +1 card. Exceeding max cards = eliminated.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start server + client concurrently (hot reload) |
| `npm run build` | Build shared → server → client (dependency order) |
| `npm test` | Run all tests across workspaces (Vitest) |

### Per-workspace

```bash
npm run dev -w server    # server only (tsx watch, port 3001)
npm run dev -w client    # client only (Vite, port 5173)
npm run build -w shared  # must build shared first (others depend on it)
npm test -w shared       # game engine, hand evaluation, bot logic
npm test -w server       # room management, socket handlers, input validation
npm test -w client       # component tests (jsdom)
```

### Training workspace

The `training/` workspace contains bot AI training scripts (genetic evolution, CFR training, simulation). These are not part of the main build.

```bash
npm run evolve -w training -- --generations 80 --population 30   # evolve heuristic bot parameters
npm run evaluate-evolved -w training                             # evaluate evolved strategy vs all lvl8 bots
npm run evaluate -w training                                     # evaluate CFR strategy vs heuristic bots
npm run simulate -w training                                     # run game simulations
npm run train -w training                                        # train CFR strategy
```

Training runs can take 20-30+ minutes. Output goes to `training/strategies/` (gitignored). See CLAUDE.md for how to integrate evolved parameters.

## Environment Variables

All variables are optional for local development. The server runs fully in-memory by default.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server listen port |
| `NODE_ENV` | `development` | Set to `production` to serve built client, restrict CORS, use JSON logging |
| `CORS_ORIGINS` | *(same-origin)* | Comma-separated allowed origins in production (e.g. `https://bullem.fly.dev,https://bullem.com`) |
| `REDIS_URL` | *(none)* | Redis connection URL. Enables: Socket.io pub/sub adapter (multi-instance), session persistence (rooms survive restarts), rate limiting |
| `DATABASE_URL` | *(none)* | PostgreSQL connection string. Enables: user accounts, persistent stats, game history, leaderboards |
| `READ_DATABASE_URL` | *(none)* | PostgreSQL read replica connection string. Falls back to `DATABASE_URL` if unset |
| `SESSION_SECRET` | *(required for auth)* | Secret for signing JWT auth tokens. Must be set if `DATABASE_URL` is configured |
| `GOOGLE_CLIENT_ID` | *(none)* | Google OAuth client ID. Enables Google sign-in |
| `GOOGLE_CLIENT_SECRET` | *(none)* | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | *(auto-detected)* | Google OAuth redirect URI. Auto-detected from request if omitted |
| `APPLE_CLIENT_ID` | *(none)* | Apple Services ID (e.g. `com.example.bullem`). Enables Sign in with Apple |
| `APPLE_TEAM_ID` | *(none)* | 10-char Apple Developer Team ID |
| `APPLE_KEY_ID` | *(none)* | Key ID from Apple Developer portal |
| `APPLE_PRIVATE_KEY` | *(none)* | ES256 private key contents (use literal `\n` for newlines) |
| `APPLE_REDIRECT_URI` | *(auto-detected)* | Apple OAuth redirect URI. Auto-detected from request if omitted |
| `VAPID_PUBLIC_KEY` | *(none)* | Web Push VAPID public key. Generate with `npx web-push generate-vapid-keys` |
| `VAPID_PRIVATE_KEY` | *(none)* | Web Push VAPID private key |
| `VAPID_SUBJECT` | *(none)* | VAPID subject (e.g. `mailto:you@example.com`) |
| `SENTRY_DSN` | *(none)* | Sentry error tracking DSN. When set, errors are reported automatically |
| `LOG_LEVEL` | `info` | Pino log level (`trace`, `debug`, `info`, `warn`, `error`, `fatal`) |

See `.env.example` for a minimal template.

## Testing

Tests use [Vitest](https://vitest.dev/). The test suite is organized by package:

```bash
npm test                 # all workspaces
npm test -w shared       # ~100+ tests: hand evaluation, engine state machine, bot AI, replay
npm test -w server       # room lifecycle, input validation, socket round-trips
npm test -w client       # component interaction tests (jsdom)
```

Key test areas:
- **Game engine** — every hand type, resolution path, edge case (mass elimination, last-chance, deck exhaustion)
- **Hand comparison** — `isHigherHand()`, `getMinimumRaise()`, `validateHandCall()` with custom ranking
- **Bot AI** — decision-making per difficulty level (normal, hard, impossible)
- **Room management** — disconnect/reconnect flows, rematch, spectator handling
- **Input validation** — server-side validation of all socket events

Tests are deterministic: RNG is seeded, time is mocked where needed.

## Deployment

Deployed on [Fly.io](https://fly.io) from a multi-stage Docker build (Node 22 Alpine, non-root user).

### Deploy manually

```bash
fly deploy
```

### CI/CD

| Trigger | Action |
|---------|--------|
| Push to `main` | CI (build + tests + Docker build) → deploy to Fly.io |
| Push to feature branch | CI → auto-merge to `develop` if passing |
| PR to `main` | CI only — manual merge by maintainer |

Workflows: `.github/workflows/ci.yml` (build + parallel tests + Docker), `deploy.yml` (Fly.io), `auto-merge-develop.yml` (feature → develop).

### Required secrets (GitHub Actions)

| Secret | How to generate |
|--------|----------------|
| `FLY_API_TOKEN` | `fly tokens create deploy -x 999999h` |

### First-time setup

```bash
fly apps create bullem
fly tokens create deploy -x 999999h  # add as FLY_API_TOKEN in repo secrets
fly deploy
```

### Health check

```
GET /health → { "status": "ok", "db": "ok"|"unavailable", "rooms": <count>, "players": <count> }
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, React Router 7, Tailwind CSS 4, Vite 7 |
| Backend | Node.js 22, Express 4, Socket.io 4, Pino (logging) |
| Auth | JWT (jsonwebtoken), bcrypt |
| Persistence | Redis (ioredis) — optional, PostgreSQL (pg) — optional |
| Shared | TypeScript 5 (strict mode), Vitest 3 |
| Infra | Fly.io, Docker, GitHub Actions, Sentry (optional) |

## Game Modes

| Mode | Description | State Management |
|------|-------------|-----------------|
| **Online** | Multiplayer via room codes/invite links | `GameContext` — Socket.io events, server-authoritative |
| **Local** | Play against bots offline | `LocalGameContext` — runs `GameEngine` in-browser, saves to localStorage |

Both modes share the same UI components and game engine. The local mode is a fully offline experience — no server required.

## Development Notes

- **TypeScript strict mode** everywhere — no `any`, no `@ts-ignore` without justification
- **Mobile-first** — all UI designed for 320px+ screens, touch-first (44px min touch targets)
- **`// TODO(scale):`** markers flag intentional temporary solutions with migration paths
- **Serializable state** — `GameEngine.serialize()`/`restore()` for Redis persistence and local saves
- **Rate limiting** — 15 events/sec per socket + 200ms cooldown between game actions (survives reconnects)
- **Reconnection** — 30s disconnect window with token rotation to prevent session hijacking
- See `CLAUDE.md` for the full engineering philosophy, coding standards, and game rules detail
- See [docs/architecture.md](docs/architecture.md) for system design and data flows
- See [docs/api.md](docs/api.md) for HTTP endpoint and WebSocket event reference
- See [docs/database.md](docs/database.md) for PostgreSQL schema documentation
- See [docs/FEATURE_ROADMAP.md](docs/FEATURE_ROADMAP.md) for planned features and priorities
