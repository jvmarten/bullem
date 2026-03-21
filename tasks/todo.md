# Provably Fair RNG Implementation

## Summary
Replace `Math.random()` with cryptographic RNG for game-critical operations (deck shuffle, seating order) and add a commit-reveal scheme so players can independently verify that the server didn't manipulate the shuffle.

## Design

### Crypto RNG (simple swap)
- Replace `Math.random()` in `Deck.shuffle()` with `crypto.randomInt()` (Node.js built-in)
- Replace `Math.random()` in seating shuffle (`Room.ts`, `LocalGameContext.tsx`) with crypto RNG
- The `Deck` class accepts an optional RNG function for testability (defaults to crypto)

### Provably Fair Commit-Reveal Scheme
Each round:
1. **Before dealing:** Server generates a random seed (`crypto.randomBytes(32).toString('hex')`)
2. **Seed → shuffle:** Use the seed to deterministically drive Fisher-Yates via a seeded PRNG (HMAC-based)
3. **Commit:** Server hashes the seed with SHA-256 and sends the hash to clients BEFORE cards are dealt (included in `game:newRound` / `game:state` events)
4. **Reveal:** After the round resolves, server reveals the seed in the `RoundResult` event
5. **Verify:** Client can verify: `SHA-256(seed) === committedHash` AND re-run the deterministic shuffle with the seed to confirm card distribution matches

### What changes where

**`shared/src/provablyFair.ts` (NEW)**
- `generateRoundSeed(): string` — `crypto.randomBytes(32).toString('hex')`
- `hashSeed(seed: string): string` — SHA-256 hex digest
- `seededShuffle<T>(array: T[], seed: string): T[]` — deterministic Fisher-Yates using HMAC-DRBG derived from seed
- `verifyFairness(seed: string, hash: string): boolean` — hash check

**`shared/src/engine/Deck.ts`**
- `shuffle()` → `shuffle(rng?: () => number)` — accept optional RNG, default to `crypto.randomInt`
- `reset(rng?)` passes RNG through to shuffle
- Add `shuffleWithSeed(seed: string)` method that uses the seeded PRNG

**`shared/src/engine/GameEngine.ts`**
- `startRound()` and `startNextRound()` generate a seed, store it, and use `deck.shuffleWithSeed(seed)`
- Expose `roundSeedHash` (the commitment) on client state
- Expose `roundSeed` (the reveal) on round result
- Store seed in `_roundStartCards` snapshot for replay verification

**`shared/src/types.ts`**
- Add `roundSeedHash?: string` to `ClientGameState`
- Add `roundSeed?: string` to `RoundResult`
- Add `roundSeedHash?: string` and `roundSeed?: string` to `RoundSnapshot`
- Add `roundSeed?: string` to `GameEngineSnapshot` (for persistence)

**`server/src/rooms/Room.ts`**
- Seating shuffle uses `crypto.randomInt()` instead of `Math.random()`

**`client/src/context/LocalGameContext.tsx`**
- Seating shuffle uses crypto RNG (or `Math.random` fallback for browser — local games don't need provable fairness but should still use better RNG)

**Client UI (minimal)**
- Small "Provably Fair" info icon/link in the round result overlay
- Clicking it shows: seed, hash, and a "Verified ✓" badge if `SHA-256(seed) === hash`
- No complex verification UI needed — the data is there for anyone who wants to verify

## Tasks

- [ ] Create `shared/src/provablyFair.ts` with seed generation, hashing, seeded shuffle, and verification
- [ ] Update `Deck.ts` to support seeded shuffle via `shuffleWithSeed(seed)`
- [ ] Update `GameEngine.ts` to generate seeds, commit hashes, and reveal seeds
- [ ] Add provably fair fields to types (`ClientGameState`, `RoundResult`, `RoundSnapshot`, `GameEngineSnapshot`)
- [ ] Update `Room.ts` seating shuffle to use `crypto.randomInt()`
- [ ] Update `LocalGameContext.tsx` seating shuffle
- [ ] Add provably fair verification UI to round result overlay
- [ ] Update existing tests to work with seeded shuffle (deterministic)
- [ ] Add unit tests for provably fair functions
- [ ] Build and verify everything compiles
