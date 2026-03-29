# Lessons Learned

## CFR Strategy File Size (2026-03-21)

**Problem:** The CFR strategy JSON file grows with each retraining run (more iterations = more info sets). It grew from 7.6MB → 19MB after a 5M iteration retrain. Large strategy files cause:
1. Server startup blocks the event loop during `readFileSync` + `JSON.parse`, preventing auth/socket requests
2. No compression middleware meant 19MB sent over the wire uncompressed
3. On mobile, downloading and parsing large JSON freezes the app

**Root cause pattern:** Any file that grows with training iterations needs proactive size management. This isn't a one-time fix — it recurs after every CFR retrain.

**Prevention rules:**
- After ANY CFR retrain, check the output file size. If `cfr-strategy.json` exceeds 10MB, the compact format or further compression is needed
- The compact v2 format (dictionary-encoded keys, indexed actions) reduces size by ~60%
- Express `compression` middleware must always be enabled (reduces 7MB → 1.8MB gzipped)
- Server must use `fs.promises.readFile` (never `readFileSync`) for large files to avoid blocking the event loop
- The CFR training pipeline should output the compact v2 format directly, not the verbose v1 format

**What to check after every CFR retrain:**
1. `ls -lh client/public/data/cfr-strategy.json` — should be under 10MB
2. `npm run build` — verify main bundle stays under 500KB
3. `npm test` — verify CFR eval tests still pass
4. If file grew beyond 10MB, the training script or a post-processing step must compress it to v2 format

## CFR Bot Skill Regression — Never Remove Safety Adjustments (2026-03-24)

**Problem:** CFR bots became terrible after commit c8a91d2 removed all post-strategy safety adjustments to "improve 1v1 win rate by ~18pp." In practice, this caused bots to make insane raises (Full House 2s/3s repeatedly, Four of a Kind with 18 total cards), fail to call bull on impossible claims, cascade true calls on nonexistent hands, and always raise during last-chance instead of passing.

**Root cause pattern:** Optimizing for a single metric (1v1 win rate) while ignoring multiplayer play quality. The trained CFR strategy is under-converged for multiplayer (3+ players) — ~26 visits per info set is nowhere near enough. Safety adjustments compensate for this gap.

**The goal is superhuman bots.** Every change must make them stronger, never weaker. Bot quality must never regress.

**Prevention rules:**
- **NEVER remove safety adjustments without proving bots are stronger in ALL game configurations** (2-player, 3-player, 6-player, 12-player). A 1v1 improvement that destroys multiplayer play is a net regression
- **Always replay-test after CFR changes.** Play at least 3 games with 4+ CFR bots and verify: no insane raises, proper bull calls on implausible claims, no true cascades, sensible last-chance behavior
- **Safety adjustments exist because the strategy is incomplete.** They provide card-aware Bayesian reasoning (card knowledge, disproof awareness), common-sense guardrails (plausibility caps, escalation dampening), and social reasoning (sentiment cascade, opponent credibility) that the trained strategy cannot encode
- **MC search weight should stay at 0.30+** — card-aware Monte Carlo correction is critical for complex hand types where the closed-form Bayesian approximation breaks down
- **Action mapper bluffs must be believable.** Full House 2s/3s is an instant tell. Always verify bluff hand generation doesn't produce degenerate patterns
- **After any CFR change, run a simulation or manual test to verify win rates haven't dropped** — don't just rely on unit tests passing

## Bot UUID Format Bug (2026-03-29)

**Problem:** `getBotUserIdByKey()` generated INVALID 37-char UUIDs for all 72 heuristic bots. The template `b0${code}${level}` produced a 5-char 4th UUID segment (e.g., `b0011`) instead of the required 4 chars (`b011`). This caused the entire `game_players` batch INSERT to fail when ANY heuristic bot was present, silently dropping ALL player records — so completed games never showed in profiles or replays.

**Root cause pattern:** UUID format strings are fragile — concatenating segments without validating the total length silently produces invalid UUIDs that only fail at INSERT time. Additionally, migration 018 shifted bot levels without updating UUIDs, creating a drift between code-generated and database UUIDs.

**Prevention rules:**
- **Always validate generated UUIDs are exactly 36 chars** — add assertions or unit tests for deterministic UUID generators
- **Batch INSERTs are all-or-nothing** — one bad row (FK violation, invalid UUID) kills the entire batch. For heterogeneous data (human + bot players), insert individually with per-row error handling
- **When migrations change keys/levels, update ALL references** — including the code that computes deterministic IDs from those keys
- **Fire-and-forget async persistence needs monitoring** — if it fails silently, the only symptom is "data doesn't show up" which is hard to diagnose without structured error logs
