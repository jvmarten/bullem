# Bull 'Em

A real-time multiplayer bluffing card game. Players are dealt cards and take turns calling increasingly higher poker hands that they claim exist across **all** players' combined cards. Other players call "bull" (bullshit) or raise. Think Liar's Dice meets Texas Hold'em — played in the browser.

**Live at:** [bullem.fly.dev](https://bullem.fly.dev)

## Quick Start

```bash
npm install          # install all workspace dependencies
npm run dev          # start server (3001) + client (5173) concurrently
```

Open `http://localhost:5173`. The Vite dev server proxies WebSocket traffic to the backend automatically.

## Project Structure

This is an npm workspaces monorepo with three packages:

```
├── shared/          # Types, constants, game engine, hand logic (pure functions)
├── server/          # Express + Socket.io backend
├── client/          # React + Vite frontend (Tailwind CSS)
├── Dockerfile       # Multi-stage production build
├── fly.toml         # Fly.io deployment config
└── CLAUDE.md        # AI assistant & project standards
```

**Boundary rules:** `shared/` is imported by both `client/` and `server/`. Client and server never import from each other.

## Architecture

See [docs/architecture.md](docs/architecture.md) for a detailed breakdown. Key points:

- **Server-authoritative** — all game logic runs on the server. Clients are rendering layers
- **Anti-cheat by design** — each player only receives their own cards, never others'
- **WebSocket-first** — Socket.io for all real-time communication, typed events in `shared/src/events.ts`
- **Pure game engine** — `shared/src/engine/GameEngine.ts` is a state machine: input state + action → output state
- **Thin socket handlers** — server handlers validate input, call the engine, broadcast results

## Game Rules

2–12 players, one standard 52-card deck. Players start with 1 card and gain cards by losing rounds (lose = +1 card). Exceed the max hand size → eliminated. Last player standing wins.

**Custom hand rankings (low → high):**
High Card → Pair → Two Pair → **Flush** → Three of a Kind → **Straight** → Full House → Four of a Kind → Straight Flush → Royal Flush

Note: Flush ranks *below* Three of a Kind, and both rank *below* Straight. This differs from standard poker.

**Turn flow:** Call a hand → next player raises or calls bull → if bull is called, others can also call bull or call true → round resolves by checking all players' combined cards.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start server + client in dev mode (hot reload) |
| `npm run build` | Build shared → server → client (order matters) |
| `npm test` | Run all tests across workspaces (Vitest) |

### Per-workspace

```bash
npm run dev -w server    # server only (tsx watch)
npm run dev -w client    # client only (Vite)
npm run build -w shared  # must build shared first
npm test -w shared       # test shared only
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server listen port |
| `NODE_ENV` | — | Set to `production` to serve built client and restrict CORS |
| `CORS_ORIGINS` | — | Comma-separated allowed origins in production (e.g. `https://bullem.fly.dev,https://bullem.com`). If unset in production, same-origin only |

No `.env` file is required for local development.

## Testing

Tests use [Vitest](https://vitest.dev/) with a workspace configuration (`vitest.workspace.ts`).

```bash
npm test                 # all workspaces
npm test -w shared       # game engine, hand evaluation, bot logic
npm test -w server       # game engine integration, room management
npm test -w client       # component tests (jsdom)
```

Key test areas:
- **Game engine** (`shared/src/hands.test.ts`, `server/src/game/`) — hand evaluation, round resolution, edge cases
- **Bot AI** (`server/src/game/BotPlayer.test.ts`) — decision-making per difficulty level
- **Components** (`client/src/components/*.test.tsx`) — interaction logic

## Deployment

Deployed on [Fly.io](https://fly.io) from a multi-stage Docker build (Node 22 Alpine).

### Deploy manually

```bash
fly deploy
```

### CI/CD

- **Push to `main`** → CI runs (build + tests + Docker build) → deploys to Fly.io
- **Push to feature branch** → CI runs → auto-merges to `develop` if passing
- **PRs to `main`** → manual merge only (maintainer reviews)

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
GET /health → { "status": "ok", "rooms": <count>, "players": <count> }
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, React Router 7, Tailwind CSS 4, Vite 7 |
| Backend | Node.js 22, Express 4, Socket.io 4 |
| Shared | TypeScript 5 (strict mode), Vitest 3 |
| Infra | Fly.io, Docker, GitHub Actions |

## Development Notes

- **TypeScript strict mode** everywhere — no `any`, no `@ts-ignore` without justification
- **Mobile-first** — all UI designed for 320px+ screens, touch-first interactions
- **`// TODO(scale):`** markers flag intentional temporary solutions with migration paths
- Game engine is designed for future Redis externalization (all state is serializable)
- See `CLAUDE.md` for the full engineering philosophy and coding standards
