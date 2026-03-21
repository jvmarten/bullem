/**
 * Provably fair RNG utilities for verifiable card shuffling.
 *
 * Flow:
 * 1. Caller generates a seed + hash pair via {@link generateSeedPair} (async)
 * 2. The hash is sent to clients BEFORE dealing cards (commitment)
 * 3. {@link seededShuffle} deterministically shuffles the deck using the seed
 * 4. After the round, the seed is revealed in the round result
 * 5. Clients verify via {@link verifyFairness} (async, works in browsers)
 *
 * The seeded PRNG uses xoshiro128** — a fast, high-quality generator that produces
 * deterministic output from a 128-bit state derived from the seed hex string.
 */

// ── Seeded PRNG (xoshiro128**) ───────────────────────────────────────────

/** Parse first 128 bits of a hex seed string into four 32-bit integers. */
function stateFromHex(hex: string): [number, number, number, number] {
  const s0 = parseInt(hex.slice(0, 8), 16) | 0;
  const s1 = parseInt(hex.slice(8, 16), 16) | 0;
  const s2 = parseInt(hex.slice(16, 24), 16) | 0;
  const s3 = parseInt(hex.slice(24, 32), 16) | 0;

  // Guard against all-zero state (invalid for xoshiro)
  if (s0 === 0 && s1 === 0 && s2 === 0 && s3 === 0) {
    return [1, 0, 0, 0];
  }
  return [s0, s1, s2, s3];
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

/**
 * Create a seeded PRNG using xoshiro128**.
 * Returns a function that produces uniform floats in [0, 1).
 */
export function createSeededRng(seed: string): () => number {
  const state = stateFromHex(seed);

  return (): number => {
    const result = Math.imul(rotl(Math.imul(state[1]!, 5), 7), 9) >>> 0;

    const t = state[1]! << 9;
    state[2]! ^= state[0]!;
    state[3]! ^= state[1]!;
    state[1]! ^= state[2]!;
    state[0]! ^= state[3]!;
    state[2]! ^= t;
    state[3] = rotl(state[3]!, 11);

    return result / 4294967296; // 2^32
  };
}

// ── Seeded Shuffle ───────────────────────────────────────────────────────

/**
 * Fisher-Yates shuffle driven by a deterministic PRNG seeded from a hex string.
 * Given the same seed and input array, always produces the same output.
 * Mutates the array in-place and returns it.
 */
export function seededShuffle<T>(array: T[], seed: string): T[] {
  const rng = createSeededRng(seed);
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = array[i]!;
    array[i] = array[j]!;
    array[j] = temp;
  }
  return array;
}

// ── Seed Generation & Hashing ───────────────────────────────────────────

/** Convert an ArrayBuffer to a hex string. */
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a cryptographically secure 32-byte hex seed.
 * Uses `globalThis.crypto.getRandomValues` — works in both Node 18+ and browsers.
 */
export function generateRoundSeed(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return bufferToHex(bytes.buffer);
}

/**
 * Hash a seed using SHA-256 via the Web Crypto API.
 * Returns a hex digest. Works in both Node 18+ and browsers.
 */
export async function hashSeed(seed: string): Promise<string> {
  const data = new TextEncoder().encode(seed);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
  return bufferToHex(hashBuffer);
}

/**
 * Generate a seed + hash pair for provably fair shuffling.
 * Convenience function that generates a seed and its SHA-256 hash together.
 */
export async function generateSeedPair(): Promise<{ seed: string; hash: string }> {
  const seed = generateRoundSeed();
  const hash = await hashSeed(seed);
  return { seed, hash };
}

// ── Verification ────────────────────────────────────────────────────────

/**
 * Verify that a revealed seed matches the committed hash.
 * Returns `true` if `SHA-256(seed) === expectedHash`.
 * Works in both browsers and Node 18+.
 */
export async function verifyFairness(seed: string, expectedHash: string): Promise<boolean> {
  const hash = await hashSeed(seed);
  return hash === expectedHash;
}
