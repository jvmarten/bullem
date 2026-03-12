# Bull 'Em

## Vision

Bull 'Em is a global-scale real-time multiplayer card game — built to handle millions of concurrent players across web and mobile. Think Supercell building Clash Royale: buttery smooth, rock solid, ready for viral growth. Every line of code is building that foundation.

## Project Overview

A multiplayer bluffing card game that combines elements of Liar's Dice with Texas Hold'em hand rankings. Players are dealt cards and take turns calling increasingly higher poker hands that they claim can be formed from ALL players' combined cards. Other players can call "bull" (bullshit) or raise. The game is played online via browser — friends join through a room code or invite link.

## Tech Stack

- **Frontend:** React (web app, mobile-first responsive design, future native wrapper via Capacitor/React Native)
- **Backend:** Node.js with WebSockets (Socket.io) for real-time multiplayer
- **State Management:** Server-authoritative game state — clients are untrusted rendering layers
- **Infrastructure:** Fly.io (single region today, multi-region when needed)
- **Future:** Native iOS/Android apps, Redis for session store + Socket.io adapter, PostgreSQL for persistence

## Engineering Philosophy

**Production-grade from day one.** No "we'll fix it later" shortcuts. If a temporary solution is justified at the current stage, it MUST include a `// TODO(scale):` comment explaining what needs to change and when. Every PR either moves toward production quality or explicitly documents the gap.

### Core Principles

1. **Code Quality**
   - Strict TypeScript everywhere — `strict: true`, no `any`, no `@ts-ignore` without justification
   - Proper error handling at every boundary — network, user input, state transitions
   - Input validation on every server endpoint — clients are untrusted
   - Comments explain *why*, not *what* — the code should explain what
   - `// TODO(scale):` markers for intentional temporary solutions with migration path

2. **Architecture for Horizontal Scale**
   - No in-memory state that can't be externalized to Redis/database
   - Socket.io designed for Redis adapter from the start — room state must be serializable
   - Stateless request handling where possible — any server instance should handle any request
   - Game engine is a pure function machine: input state + action → output state (no side effects)
   - When adding state: ask "what happens with 10 server instances?" If the answer is "it breaks," redesign

3. **Mobile-First Always**
   - Every UI decision must work on 320px-wide screens, touch-first, with variable network conditions
   - No hover-only interactions — everything must work with tap/swipe
   - Touch targets minimum 44px, generous spacing for fat fingers
   - Assume high-latency, lossy connections — optimistic UI with server reconciliation
   - CSS: `touch-action`, `overscroll-behavior`, no accidental horizontal scroll
   - Test on actual phones, not just DevTools responsive mode
   - Compatible with future native wrappers (Capacitor/React Native Web)

4. **Security Is Not Optional**
   - Server-authoritative: ALL game logic runs server-side, clients only render
   - Never send other players' cards to the client — anti-cheat by architecture
   - Validate every socket event server-side — type check, bounds check, turn ownership
   - Rate limiting on all endpoints (socket events and HTTP)
   - Restrictive CORS — only allow known origins
   - No secrets, tokens, or API keys in client code — ever
   - Sanitize all user-provided strings (player names, room codes)

5. **Clean Monorepo Boundaries**
   - `shared/` is the single source of truth for types, constants, and pure game logic
   - Server NEVER imports from client, client NEVER imports from server
   - Both import from `shared/` only
   - Game engine logic lives in pure, testable functions — no I/O, no timers, no randomness injection
   - Socket handlers are thin dispatchers: validate → call engine → broadcast result

6. **Test What Matters**
   - Comprehensive unit tests on game engine logic — every hand type, edge case, resolution scenario
   - Integration tests on socket event handlers — full round-trip from emit to state change
   - Regression test for every bug fix — if it broke once, prove it can't break again
   - Test game state transitions, not UI rendering (unless testing interaction logic)
   - Tests must be deterministic — seed randomness, mock time

7. **Performance as a Feature**
   - Minimize WebSocket payload sizes — send diffs, not full state, when practical
   - Debounce/throttle client events — no spamming the server
   - Code split the client — lobby code shouldn't load game code
   - Lazy load assets (sounds, animations) — don't block initial render
   - Server: O(1) lookups for rooms/players, avoid scanning all rooms for any operation

8. **Observability**
   - Health check endpoint: `GET /health` with meaningful status
   - Structured logging for monitoring — JSON logs with correlation IDs when possible
   - Game state snapshots for debugging and future replay features
   - Error tracking integration points — ready for Sentry/similar
   - Metrics for room count, active players, round duration, error rates

9. **Document Decisions**
   - Comments explain *why* a non-obvious approach was chosen
   - `// TODO(scale):` for any intentional temporary solution — include what changes and at what scale
   - Architecture Decision Records (ADRs) for significant choices (in `docs/adr/` when needed)
   - This file (CLAUDE.md) is the canonical source of project standards

### When Presenting Solutions

Always lead with the production-grade approach. If a simpler interim approach is justified for the current stage, present it as a clearly labeled alternative with:
- Why the shortcut is acceptable now
- What trigger (user count, feature, timeline) requires upgrading
- A `// TODO(scale):` comment in the code

**Never silently take a shortcut.**

## Game Rules

### Setup

- 2–12 players (configurable max cards determines player limit: `floor(52 / maxCards)`)
- One standard 52-card deck
- Suits matter (spades, hearts, diamonds, clubs)
- Players join a room via invite link or room code
- Starting player rotates clockwise each round

### Card Dealing

- Round 1: each player is dealt 1 card
- Players can see their own cards but NOT other players' cards
- Players gain cards by losing rounds (+1 card per loss)
- Maximum hand size is configurable (1–5, default 5)
- If a player would exceed max cards, they are eliminated
- Last player standing wins the game

### Hand Rankings (LOW to HIGH)

This is a CUSTOM ranking order — flush is LOWER than three of a kind, and both are lower than straight:

1. High card (e.g., "King high")
2. Pair (e.g., "pair of 7s")
3. Two pair (e.g., "two pair, jacks and 4s")
4. Flush (e.g., "flush in hearts") — NOTE: ranked LOWER than three of a kind
5. Three of a kind (e.g., "three 9s")
6. Straight (e.g., "straight, 5 through 9")
7. Full house (e.g., "full house, queens over 3s")
8. Four of a kind (e.g., "four 2s")
9. Straight flush (e.g., "straight flush in spades, 5 through 9")
10. Royal flush (e.g., "royal flush in diamonds")

Within the same hand category, standard poker value ordering applies (2 is lowest, Ace is highest).

### Turn Flow

1. **First player** calls a poker hand (e.g., "pair of 7s")
2. **Next player (clockwise)** has two options:
   - **Raise:** Call a higher hand (can jump to ANY higher hand — no need to stay in same category)
   - **Call bull:** Declare they don't believe the called hand exists across all players' combined cards
3. **After someone calls bull**, the next player has THREE options:
   - **Raise:** Call an even higher hand
   - **Call bull:** Also declare disbelief
   - **Call true:** Declare they believe the hand DOES exist

### Resolution

- If ALL players call bull on the last hand:
  - The last hand caller gets ONE chance to raise their call
  - If they raise, the bull/true cycle restarts on the new call
  - If they don't raise (or everyone calls bull again), the round resolves
- **Reveal:** When the round ends, players reveal ONLY the cards relevant to the called hand
- **Checking the hand:** The called hand is checked against ALL players' combined cards
- **Scoring:**
  - Players who called correctly (bull on a fake hand, or true on a real hand) keep the same number of cards next round
  - Players who called incorrectly get +1 card next round
  - Exceeding max cards = elimination

### Elimination & Winning

- When a player would exceed their max card count, they are out of the game
- The last player remaining wins
- Eliminated players can spectate

## Multiplayer Architecture

- **Server-authoritative:** All game logic runs on the server. Clients are rendering layers only
- **Anti-cheat by design:** Each player only receives their own cards — never other players' cards
- **Room system:** Host creates a room, gets a code/link to share
- **Real-time:** WebSocket events via Socket.io (designed for Redis adapter at scale)
- **Reconnection:** Graceful disconnection handling with reconnect window
- **State serialization:** All game state must be serializable (JSON-safe) — no class instances, functions, or circular refs in state

## UI/UX Guidelines

- **Mobile-first:** Design for phones first, then scale up — most players will be on mobile
- **Touch-first interactions:** Swipe/tap pickers, not dropdowns — designed for one-handed play
- **Clear game state:** Always obvious whose turn it is, what phase the round is in
- **Accessible controls:** Hand selection via visual pickers (card fans, type strips), not text input
- **Visual feedback:** Animations for bull/true calls, card deals, eliminations
- **Spectator mode:** Eliminated players can watch with full card visibility
- **Lobby:** Waiting room with player management, settings, bot configuration
- **Sound design:** Audio feedback for game events, with volume control and mute
- **Online/Local parity:** All visual and layout changes must be applied to BOTH `GamePage.tsx` (online) and `LocalGamePage.tsx` (local) unless the context clearly requires mode-specific behavior. The in-game UI should look and feel identical regardless of game mode
- **Patch notes:** Version patch notes displayed in the home page modal must always contain a **maximum of three items**. Keep entries concise and highlight only the most impactful changes per release

## Project Structure

```
bull-em/
├── client/              # React frontend (Vite)
│   ├── src/
│   │   ├── components/  # Reusable UI components
│   │   ├── context/     # React context providers (GameContext, LocalGameContext)
│   │   ├── hooks/       # Custom React hooks (useSound, soundEngine)
│   │   ├── pages/       # Route pages (Lobby, Game, Results — online & local)
│   │   ├── styles/      # Global CSS
│   │   ├── assets/      # Static assets (sounds, images)
│   │   └── utils/       # Display helpers, card utilities
│   └── vitest.config.ts
├── server/              # Node.js backend (Express + Socket.io)
│   ├── src/
│   │   ├── game/        # Game engine, bot AI, deck management
│   │   ├── socket/      # WebSocket event handlers (thin dispatchers)
│   │   └── rooms/       # Room lifecycle management
│   └── vitest.config.ts
├── shared/              # Single source of truth for types & logic
│   ├── src/
│   │   ├── types.ts     # All game state types
│   │   ├── hands.ts     # Hand rankings and comparison (pure functions)
│   │   └── constants.ts # Game configuration constants
│   └── vitest.config.ts
├── .github/workflows/   # CI/CD (ci.yml + deploy.yml)
├── Dockerfile           # Multi-stage production build
├── fly.toml             # Fly.io deployment config
├── CLAUDE.md            # This file — canonical project standards
└── package.json         # Workspace root
```

### Boundary Rules

- `shared/` → imported by both `client/` and `server/`
- `client/` → imports from `shared/` only. NEVER from `server/`
- `server/` → imports from `shared/` only. NEVER from `client/`
- Game logic (hand evaluation, turn resolution, scoring) lives in `shared/` as pure functions
- Socket handlers in `server/` are thin: validate input → call engine → emit result

## Development Workflow

### Running Locally

```bash
npm install          # Install all workspace dependencies
npm run dev          # Start server + client concurrently
npm run build        # Build shared → server → client
npm test             # Run all tests across workspaces
```

### TypeScript Standards

- `strict: true` is non-negotiable — configured in `tsconfig.base.json`
- No `any` types — use `unknown` and narrow, or define proper types in `shared/`
- No `@ts-ignore` or `@ts-expect-error` without a comment explaining why
- All public APIs have explicit return types
- Exhaustive switch statements with `never` default for discriminated unions

### Testing Standards

- Game engine: test every hand type, every resolution path, every edge case
- Bot AI: test decision-making for each difficulty level
- Socket handlers: integration tests for full event round-trips
- Bug fixes: every fix includes a regression test proving the bug is gone
- Deterministic: seed RNG, mock `Date.now()`, no flaky tests

## Deployment

Bull 'Em is deployed on [Fly.io](https://fly.io).

- **App URL:** `https://bullem.fly.dev`
- **Config:** `fly.toml` at repo root
- **Health check:** `GET /health` returns `{ "status": "ok" }`
- **Docker:** Multi-stage build — build all workspaces, copy only production artifacts

### Manual Deploy

```bash
fly deploy
```

### CI/CD

Pushes to `main` trigger `.github/workflows/deploy.yml`, which:
1. Runs CI (build + tests) via `.github/workflows/ci.yml`
2. Deploys to Fly.io using the Dockerfile

### Required Secrets

Add these to the GitHub repo settings (`Settings > Secrets > Actions`):
- `FLY_API_TOKEN` — generate with `fly tokens create deploy -x 999999h`

### First-Time Setup

```bash
fly apps create bullem
fly tokens create deploy -x 999999h  # add output as FLY_API_TOKEN secret
fly deploy
```

## Bot Architecture

The bot system has **81 total bot profiles** organized into two tiers:

- **72 heuristic bots**: 9 personalities × 8 levels (1-8), using tunable decision parameters
- **9 CFR bots**: trained via Counterfactual Regret Minimization, all at level 9

### Level Categories

- **Easy** (lvl 1-3): 27 heuristic bots — beginner-friendly
- **Normal** (lvl 4-6): 27 heuristic bots — standard difficulty
- **Hard** (lvl 7-9): 18 heuristic bots (lvl 7-8) + 9 CFR bots (lvl 9) = 27 bots
- **Mixed** (lvl 1-9): all 81 bots

### Heuristic Bot Evolution Strategy

The heuristic bot system uses **evolved parameters as the universal baseline**. Every heuristic bot derives from the evolved champion's parameters.

#### How It Works

1. **`DEFAULT_BOT_PROFILE_CONFIG`** = exact evolved champion values (currently gen80, 61.3% win rate vs all lvl8 profiles)
2. **Professor lvl8** gets the exact default values — it's the "textbook optimal" heuristic bot
3. **Other personalities** deviate from the default only on 2-4 **signature parameters** that define their identity (e.g., Rock's low riskTolerance, Bluffer's low bullThreshold)
4. **Non-signature parameters** use the evolved baseline directly
5. **`UNSKILLED_CONFIG`** (level 1 baseline) is raised ~40% toward evolved — even easy bots play competently
6. **Level scaling** lerps between `UNSKILLED_CONFIG` (lvl1) and personality's lvl8 config

#### After Each Evolution Run

When a new evolution training finishes with better parameters:

1. Update `DEFAULT_BOT_PROFILE_CONFIG` in `shared/src/botProfiles.ts` to the new champion's values
2. Review each personality's non-signature parameters and update them to the new baseline
3. Signature parameters stay divergent — they define personality identity, not strength
4. Optionally raise `UNSKILLED_CONFIG` if the new baseline shifts significantly
5. The best evolved parameters go to the lvl8 bots (strongest heuristic level)

### CFR Bots (Level 9)

The 9 CFR bots (Viper, Ghost, Reaper, Specter, Raptor, Havoc, Phantom, Sentinel, Vanguard) use trained game-theory strategy instead of heuristic decision logic. They:

- Bypass the `BotProfileConfig` system entirely
- Use `decideCFR()` from `shared/src/cfr/cfrEval.ts`
- Are all level 9 — the strongest tier
- Appear in the **hard** and **mixed** bot pools
- Work in both online and offline/local games
- Have database accounts for ranked play (seeded via migration 018)

### Why Two Tiers?

Heuristic bots provide **playstyle variety** — each personality feels different to play against. CFR bots provide **game-theoretic strength** — they play near-optimal strategy. Having both gives players variety at lower levels and a true challenge at the top.

### Avoiding Homogeneity

Heuristic personalities won't converge because each one keeps its **signature parameters** intentionally divergent from evolved. The non-signature parameters (which evolution showed don't differentiate playstyles much) get the optimal values. The result: all bots are strong, but they feel different to play against.

### Running Training

The assistant can and should run training directly. The training scripts live in the `training` workspace:

```bash
# Run heuristic evolution training (genetic algorithm)
npm run evolve -w training -- --generations 80 --population 30 --games-per-matchup 60 --players-per-game 2 --max-cards 5

# Evaluate an evolved strategy against all lvl8 profiles and HoF
npm run evaluate-evolved -w training

# Evaluate CFR strategy against lvl8 heuristic bots
npm run evaluate -w training

# Run simulations
npm run simulate -w training
```

The evolution script outputs a JSON file to `training/strategies/` with the champion's config, evaluation results, and metadata. After a successful run with improved results, integrate the new champion values into `DEFAULT_BOT_PROFILE_CONFIG` following the "After Each Evolution Run" steps above.

Training runs can take 20-30+ minutes depending on population size and generations. Use `run_in_background` for long runs.

## Development Priorities

1. ~~Core game engine (deck, deal, hand evaluation with custom rankings)~~ ✓
2. ~~Turn logic and bull/true/raise flow~~ ✓
3. ~~Room creation and joining (WebSocket)~~ ✓
4. ~~Basic playable UI~~ ✓
5. ~~Polish (animations, sounds, mobile optimization)~~ ✓
6. ~~Deployment (so friends can actually play)~~ ✓
7. ~~Scale infrastructure (Redis adapter, session persistence)~~ ✓ (multi-region architecture ready, single-region deployed)
8. ~~Player accounts, auth, and game history persistence~~ ✓
9. ~~Replay system and spectator mode~~ ✓
10. ~~Observability (structured logging, Sentry, Prometheus metrics)~~ ✓
11. Matchmaking, ranked play, leaderboards
12. Native mobile apps (Capacitor or React Native wrapper)

## Agent PR Policy

### Branching Strategy

- **`develop`** — integration branch. Feature branches are **automatically merged** into `develop` after CI passes (via `.github/workflows/auto-merge-develop.yml`).
- **`main`** — production branch. Merges to `main` are **always manual** — the maintainer reviews, tests locally, and merges when ready.

### Auto-merge to `develop`

When you push code to a feature branch (e.g., `claude/*`), the `auto-merge-develop.yml` workflow will:
1. Run full CI (build + tests + Docker build)
2. If CI passes, automatically merge the branch into `develop` with a merge commit
3. No manual intervention required

This ensures `develop` always has the latest passing code integrated.

### Merges to `main`

**Do NOT merge PRs to `main` automatically.** Leave PRs targeting `main` open for manual review and local testing before merging.

When you finish work on a PR targeting `main` (code changes committed and pushed), create the PR and share the URL — do not merge it. The maintainer will review, test locally, and merge when ready.

### Creating PRs

Use the GitHub REST API with `curl` (since `gh` CLI may not be available):

```bash
# Create a PR targeting develop (auto-merged by CI)
# Not usually needed — feature branches auto-merge to develop after CI passes

# Create a PR targeting main (manual merge only)
curl -s -X POST \
  -H "Authorization: token $GH_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/OWNER/REPO/pulls" \
  -d '{"title":"...","body":"...","head":"branch-name","base":"main"}'
```

Replace `OWNER/REPO` with the actual repo (get it from `git remote get-url origin`).

### Rules

- **Auto-merge to `develop`** — feature branches merge automatically after CI passes.
- **Never auto-merge to `main`** — leave PRs open for the maintainer to review and test locally.
- **Squash merge** is the preferred merge strategy for `main` (when the maintainer merges).
- Always include a clear summary and test plan in PR descriptions targeting `main`.

### GitHub Actions Constraints

**Do NOT add new GitHub Actions workflows or expand existing ones.** This project runs on GitHub's free tier with limited Actions minutes. The current workflow setup (`auto-merge.yml` + `deploy.yml`) is intentionally minimal and must stay that way.

- **No new workflow files** — do not create additional `.yml` files in `.github/workflows/`
- **No new CI jobs** — do not add linting, formatting, code coverage, security scanning, or any other automated jobs as GitHub Actions
- **No scheduled workflows** — no cron-based Actions (dependency updates, stale issue bots, etc.)
- **No third-party Actions** — do not introduce new marketplace Actions or reusable workflows
- **Keep existing workflows lean** — do not add steps, matrix builds, or additional triggers to `auto-merge.yml` or `deploy.yml`

If a new feature needs automated checks, implement it as a local script (e.g., `npm run lint`, `npm run check`) that developers run manually or that existing workflows already cover. The bar for adding any GitHub Actions usage is extremely high — discuss with the maintainer first.

### GitHub Repository Size Limits

GitHub enforces a **hard 2GB limit** on repository size. Keep the repo well under this limit:

- **Never commit large binary files** — no audio/video assets, compiled binaries, dataset files, or model weights directly in git
- **Never commit `node_modules/`** or build output (`dist/`, `build/`)
- **Training output files** (strategies, logs, checkpoints) should be `.gitignore`d — only commit the final integrated values in source code
- **Use `.gitignore` aggressively** for generated files, logs, and temporary data
- **If large assets are needed**, use external storage (CDN, S3, Git LFS) instead of committing to the repo
- **Watch for git history bloat** — if a large file is accidentally committed, it stays in git history even after deletion. Use `git rev-list --objects --all | git cat-file --batch-check | sort -k3nr | head -20` to audit large objects
