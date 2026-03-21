import { describe, it, expect } from 'vitest';
import {
  createSeededRng, seededShuffle, generateRoundSeed,
  hashSeed, generateSeedPair, verifyFairness,
} from './provablyFair.js';

describe('createSeededRng', () => {
  it('produces deterministic output for the same seed', () => {
    const rng1 = createSeededRng('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6');
    const rng2 = createSeededRng('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6');
    const values1 = Array.from({ length: 100 }, () => rng1());
    const values2 = Array.from({ length: 100 }, () => rng2());
    expect(values1).toEqual(values2);
  });

  it('produces different output for different seeds', () => {
    const rng1 = createSeededRng('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6');
    const rng2 = createSeededRng('ffffffffffffffffffffffffffffffff');
    const v1 = rng1();
    const v2 = rng2();
    expect(v1).not.toBe(v2);
  });

  it('produces values in [0, 1)', () => {
    const rng = createSeededRng('deadbeefcafebabe1234567890abcdef');
    for (let i = 0; i < 10_000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('handles all-zero seed gracefully (guard state)', () => {
    const rng = createSeededRng('00000000000000000000000000000000');
    // Should not produce NaN or throw
    const v = rng();
    expect(Number.isFinite(v)).toBe(true);
  });
});

describe('seededShuffle', () => {
  it('is deterministic for the same seed', () => {
    const arr1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const arr2 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const seed = 'abcdef1234567890abcdef1234567890';
    seededShuffle(arr1, seed);
    seededShuffle(arr2, seed);
    expect(arr1).toEqual(arr2);
  });

  it('produces different orders for different seeds', () => {
    const arr1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const arr2 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    seededShuffle(arr1, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1');
    seededShuffle(arr2, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2');
    expect(arr1).not.toEqual(arr2);
  });

  it('preserves all elements (no duplicates, no losses)', () => {
    const original = Array.from({ length: 52 }, (_, i) => i);
    const shuffled = [...original];
    seededShuffle(shuffled, 'deadbeefcafebabe1234567890abcdef');
    expect(shuffled.sort((a, b) => a - b)).toEqual(original);
  });

  it('actually shuffles (not identity)', () => {
    const arr = Array.from({ length: 52 }, (_, i) => i);
    const original = [...arr];
    seededShuffle(arr, 'f0f0f0f0e0e0e0e0d0d0d0d0c0c0c0c0');
    expect(arr).not.toEqual(original);
  });
});

describe('generateRoundSeed', () => {
  it('returns a 64-character hex string (32 bytes)', () => {
    const seed = generateRoundSeed();
    expect(seed).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates unique seeds', () => {
    const seeds = new Set(Array.from({ length: 100 }, () => generateRoundSeed()));
    expect(seeds.size).toBe(100);
  });
});

describe('hashSeed', () => {
  it('returns a 64-character hex string (SHA-256)', async () => {
    const hash = await hashSeed('test-seed');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', async () => {
    const h1 = await hashSeed('same-input');
    const h2 = await hashSeed('same-input');
    expect(h1).toBe(h2);
  });

  it('produces different hashes for different inputs', async () => {
    const h1 = await hashSeed('input-a');
    const h2 = await hashSeed('input-b');
    expect(h1).not.toBe(h2);
  });
});

describe('generateSeedPair', () => {
  it('returns a seed and its SHA-256 hash', async () => {
    const { seed, hash } = await generateSeedPair();
    expect(seed).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // Verify the hash is correct
    const verified = await verifyFairness(seed, hash);
    expect(verified).toBe(true);
  });
});

describe('verifyFairness', () => {
  it('returns true for a valid seed-hash pair', async () => {
    const { seed, hash } = await generateSeedPair();
    expect(await verifyFairness(seed, hash)).toBe(true);
  });

  it('returns false for a tampered seed', async () => {
    const { hash } = await generateSeedPair();
    expect(await verifyFairness('tampered-seed', hash)).toBe(false);
  });

  it('returns false for a tampered hash', async () => {
    const { seed } = await generateSeedPair();
    expect(await verifyFairness(seed, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false);
  });
});

describe('end-to-end provably fair flow', () => {
  it('commit-reveal-verify roundtrip works', async () => {
    // 1. Server generates seed pair
    const { seed, hash } = await generateSeedPair();

    // 2. Client receives hash (commitment) — cannot determine seed from it

    // 3. Server uses seed to shuffle a deck
    const deck = Array.from({ length: 52 }, (_, i) => i);
    const shuffled = [...deck];
    seededShuffle(shuffled, seed);

    // 4. After round, server reveals seed

    // 5. Client verifies: SHA-256(seed) === hash
    expect(await verifyFairness(seed, hash)).toBe(true);

    // 6. Client re-shuffles with the same seed and gets the same deck
    const clientDeck = Array.from({ length: 52 }, (_, i) => i);
    seededShuffle(clientDeck, seed);
    expect(clientDeck).toEqual(shuffled);
  });
});
