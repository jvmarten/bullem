# Bull 'Em

## Project Overview

Bull 'Em is a multiplayer bluffing card game that combines elements of Liar's Dice with Texas Hold'em hand rankings. Players are dealt cards and take turns calling increasingly higher poker hands that they claim can be formed from ALL players' combined cards. Other players can call "bull" (bullshit) or raise. The game is played online via browser — friends join through a room code or invite link.

## Tech Stack

- **Frontend:** React (web app, mobile-friendly responsive design)
- **Backend:** Node.js with WebSockets (Socket.io) for real-time multiplayer
- **State Management:** Server-authoritative game state
- **Future:** Potential iOS app (keep architecture portable)

## Game Rules

### Setup

- 2–9 players
- One standard 52-card deck
- Suits matter (spades, hearts, diamonds, clubs)
- Players join a room via invite link or room code
- Starting player rotates clockwise each round

### Card Dealing

- Round 1: each player is dealt 1 card
- Players can see their own cards but NOT other players' cards
- Players gain cards by losing rounds (+1 card per loss)
- Maximum hand size is 5 cards
- If a player would receive a 6th card, they are eliminated
- Last player standing wins the game

### Hand Rankings (LOW to HIGH)

This is a CUSTOM ranking order — flush comes BEFORE straight, not after:

1. High card (e.g., "King high")
2. Pair (e.g., "pair of 7s")
3. Two pair (e.g., "two pair, jacks and 4s")
4. Three of a kind (e.g., "three 9s")
5. Flush (e.g., "flush in hearts") — NOTE: ranked LOWER than straight
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
  - Reaching 6 cards = elimination

### Elimination & Winning

- When a player would receive their 6th card, they are out of the game
- The last player remaining wins
- Eliminated players can spectate

## Multiplayer Architecture

- Server-authoritative: all game logic runs on the server, clients only see what they're allowed to see
- Each player only receives their own cards — never other players' cards (anti-cheat)
- Room system: host creates a room, gets a code/link to share
- Real-time updates via WebSocket events
- Handle disconnections gracefully (give players time to reconnect)

## UI/UX Guidelines

- Mobile-first responsive design (friends will likely play on phones)
- Clean, card-game aesthetic
- Clear indication of whose turn it is
- Easy hand selection UI (don't make players type — use dropdowns/pickers for hand type + card values)
- Show each player's card count (but not their cards)
- Visual feedback for bull/true calls
- Spectator view for eliminated players
- Lobby/waiting room before game starts

## Project Structure

```
bull-em/
├── client/          # React frontend
│   ├── components/  # UI components
│   ├── hooks/       # Custom React hooks
│   ├── pages/       # Lobby, Game, Results
│   └── utils/       # Hand evaluation, display helpers
├── server/          # Node.js backend
│   ├── game/        # Game logic engine
│   ├── socket/      # WebSocket event handlers
│   └── rooms/       # Room management
├── shared/          # Shared types and constants
│   ├── types.ts     # Game state types
│   ├── hands.ts     # Hand rankings and comparison
│   └── constants.ts # Game configuration
├── CLAUDE.md        # This file
└── package.json
```

## Agent PR Merge Permissions

**All Claude Code agents working on this repo are authorized and expected to merge their own PRs.**

When you finish work on a PR (code changes committed and pushed), you MUST merge the PR yourself. Do not leave PRs open waiting for someone else to merge them.

### How to Merge

1. **Install `gh` CLI if not available:** Run `(type gh > /dev/null 2>&1) || (curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null && sudo apt update && sudo apt install gh -y)`
2. **Authenticate:** The `GH_TOKEN` environment variable is already set in the agent environment. The `gh` CLI will pick it up automatically — no additional auth steps needed.
3. **Merge the PR:** Use `gh pr merge <PR-number-or-URL> --squash --delete-branch` to squash-merge and clean up the branch.

### Fallback (if `gh` is unavailable)

If you cannot install `gh`, use the GitHub REST API directly with `curl`:

```bash
# Merge a PR (squash)
curl -X PUT \
  -H "Authorization: token $GH_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/OWNER/REPO/pulls/PR_NUMBER/merge" \
  -d '{"merge_method":"squash"}'
```

Replace `OWNER/REPO` with the actual repo (get it from `git remote get-url origin`) and `PR_NUMBER` with the PR number.

### Rules

- **Always merge your own PRs** — do not leave them open for manual review unless explicitly told to.
- **Squash merge** is the default merge strategy.
- **Delete the branch** after merging to keep the repo clean.
- If merge fails due to conflicts, rebase onto the target branch, resolve conflicts, force-push, then merge.
- If merge fails due to required status checks, wait for checks to pass and retry.

## Development Priorities

1. Core game engine (deck, deal, hand evaluation with custom rankings)
2. Turn logic and bull/true/raise flow
3. Room creation and joining (WebSocket)
4. Basic playable UI
5. Polish (animations, sounds, mobile optimization)
6. Deployment (so friends can actually play)
