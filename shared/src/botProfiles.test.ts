import { describe, it, expect } from 'vitest';
import {
  BOT_PROFILES,
  BOT_PROFILE_MAP,
  BOT_PROFILE_KEYS,
  DEFAULT_BOT_PROFILE_CONFIG,
  BOT_LEVELS,
  BOT_PERSONALITIES,
  BOT_MATRIX_SIZE,
  LEGACY_PROFILE_KEY_MAP,
  CFR_BOTS,
  HEURISTIC_BOT_PROFILES,
  CFR_BOT_COUNT,
  getBotsForCategory,
  getBotUserIdByKey,
} from './botProfiles.js';
import type { BotProfileConfig } from './botProfiles.js';

describe('botProfiles', () => {
  describe('BOT_PROFILES', () => {
    it('has 81 profiles (72 heuristic + 9 CFR)', () => {
      expect(BOT_PROFILES.length).toBe(BOT_MATRIX_SIZE);
      expect(BOT_PROFILES.length).toBe(81);
      expect(HEURISTIC_BOT_PROFILES.length).toBe(BOT_PERSONALITIES.length * BOT_LEVELS);
      expect(HEURISTIC_BOT_PROFILES.length).toBe(72);
      expect(CFR_BOTS.length).toBe(CFR_BOT_COUNT);
    });

    it('every profile has a unique key', () => {
      const keys = BOT_PROFILES.map(p => p.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('every profile has a unique name', () => {
      const names = BOT_PROFILES.map(p => p.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it('every profile has all required config fields', () => {
      const requiredFields: (keyof BotProfileConfig)[] = [
        'bluffFrequency', 'bullThreshold', 'riskTolerance', 'aggressionBias',
        'lastChanceBluffRate', 'openingBluffRate', 'bullPhaseRaiseRate',
        'trustMultiplier', 'bluffPlausibilityGate', 'noiseBand',
      ];

      for (const profile of BOT_PROFILES) {
        for (const field of requiredFields) {
          expect(typeof profile.config[field]).toBe('number');
        }
      }
    });

    it('every profile has non-empty flavor text arrays', () => {
      for (const profile of BOT_PROFILES) {
        expect(profile.flavorText.callBull.length).toBeGreaterThan(0);
        expect(profile.flavorText.caughtBluffing.length).toBeGreaterThan(0);
        expect(profile.flavorText.winRound.length).toBeGreaterThan(0);
        expect(profile.flavorText.bigRaise.length).toBeGreaterThan(0);
        expect(profile.flavorText.eliminated.length).toBeGreaterThan(0);
      }
    });

    it('config values are within valid ranges', () => {
      for (const profile of BOT_PROFILES) {
        const cfg = profile.config;
        // bluffFrequency can be > 1.0 (it's a multiplier)
        expect(cfg.bluffFrequency).toBeGreaterThanOrEqual(0);
        expect(cfg.bluffFrequency).toBeLessThanOrEqual(3.0);

        expect(cfg.bullThreshold).toBeGreaterThanOrEqual(0);
        expect(cfg.bullThreshold).toBeLessThanOrEqual(1.0);

        expect(cfg.riskTolerance).toBeGreaterThanOrEqual(0);
        expect(cfg.riskTolerance).toBeLessThanOrEqual(1.0);

        expect(cfg.aggressionBias).toBeGreaterThanOrEqual(0);
        expect(cfg.aggressionBias).toBeLessThanOrEqual(1.0);

        expect(cfg.lastChanceBluffRate).toBeGreaterThanOrEqual(0);
        expect(cfg.lastChanceBluffRate).toBeLessThanOrEqual(1.0);

        expect(cfg.openingBluffRate).toBeGreaterThanOrEqual(0);
        expect(cfg.openingBluffRate).toBeLessThanOrEqual(1.0);

        expect(cfg.bullPhaseRaiseRate).toBeGreaterThanOrEqual(0);
        expect(cfg.bullPhaseRaiseRate).toBeLessThanOrEqual(1.0);

        expect(cfg.trustMultiplier).toBeGreaterThanOrEqual(0);
        expect(cfg.trustMultiplier).toBeLessThanOrEqual(2.0);

        expect(cfg.bluffPlausibilityGate).toBeGreaterThanOrEqual(0);
        expect(cfg.bluffPlausibilityGate).toBeLessThanOrEqual(1.0);

        expect(cfg.noiseBand).toBeGreaterThanOrEqual(0);
        expect(cfg.noiseBand).toBeLessThanOrEqual(0.2);
      }
    });
  });

  describe('BOT_PROFILE_MAP', () => {
    it('contains all profiles plus impossible bot', () => {
      // 81 bot profiles + 1 impossible bot = 82
      expect(BOT_PROFILE_MAP.size).toBe(BOT_PROFILES.length + 1);
    });

    it('allows O(1) lookup by key', () => {
      const rock8 = BOT_PROFILE_MAP.get('rock_lvl8');
      expect(rock8).toBeDefined();
      expect(rock8!.name).toBe('Rock lvl8');
    });

    it('includes CFR bots in the map', () => {
      const viper = BOT_PROFILE_MAP.get('cfr_viper');
      expect(viper).toBeDefined();
      expect(viper!.isCFR).toBe(true);
    });

    it('returns undefined for unknown keys', () => {
      expect(BOT_PROFILE_MAP.get('nonexistent')).toBeUndefined();
    });
  });

  describe('BOT_PROFILE_KEYS', () => {
    it('has the right keys', () => {
      expect(BOT_PROFILE_KEYS).toEqual([
        ...BOT_PROFILES.map(p => p.key),
        'oracle_lvl10',
      ]);
    });
  });

  describe('DEFAULT_BOT_PROFILE_CONFIG', () => {
    it('uses exact V2 multi-scenario evolved champion values as baseline', () => {
      // DEFAULT is the V2 multi-scenario evolved champion — all personalities derive from this.
      // Trained across 12 game scenarios: 2P-6P, 0-2 jokers, classic/strict last-chance.
      // After each evolution run, update DEFAULT to the new champion's values.
      expect(DEFAULT_BOT_PROFILE_CONFIG.bluffFrequency).toBe(0.37);
      expect(DEFAULT_BOT_PROFILE_CONFIG.bullThreshold).toBe(0.00);
      expect(DEFAULT_BOT_PROFILE_CONFIG.riskTolerance).toBe(1.00);
      expect(DEFAULT_BOT_PROFILE_CONFIG.aggressionBias).toBe(0.84);
      expect(DEFAULT_BOT_PROFILE_CONFIG.lastChanceBluffRate).toBe(0.78);
      expect(DEFAULT_BOT_PROFILE_CONFIG.openingBluffRate).toBe(0.13);
      expect(DEFAULT_BOT_PROFILE_CONFIG.bullPhaseRaiseRate).toBe(0.77);
      expect(DEFAULT_BOT_PROFILE_CONFIG.trustMultiplier).toBe(1.40);
      expect(DEFAULT_BOT_PROFILE_CONFIG.bluffPlausibilityGate).toBe(0.62);
      expect(DEFAULT_BOT_PROFILE_CONFIG.noiseBand).toBe(0.10);
    });
  });

  describe('LEGACY_PROFILE_KEY_MAP', () => {
    it('maps all 8 old profile keys to new lvl8 keys', () => {
      expect(LEGACY_PROFILE_KEY_MAP.size).toBe(8);
      for (const [_old, newKey] of LEGACY_PROFILE_KEY_MAP) {
        expect(BOT_PROFILE_MAP.has(newKey)).toBe(true);
      }
    });
  });

  describe('level scaling', () => {
    it('lvl8 profiles express personality more strongly than lvl1', () => {
      const rock1 = BOT_PROFILE_MAP.get('rock_lvl1')!;
      const rock8 = BOT_PROFILE_MAP.get('rock_lvl8')!;
      // Rock at lvl8 should have higher bullThreshold (more cautious) than lvl1
      // because lvl1 lerps toward unskilled (0.50 bullThreshold) while rock lvl8 = 0.55
      expect(rock8.config.bullThreshold).toBeGreaterThan(rock1.config.bullThreshold);
    });

    it('all 8 heuristic levels exist for each personality', () => {
      for (const personality of BOT_PERSONALITIES) {
        for (let lvl = 1; lvl <= BOT_LEVELS; lvl++) {
          const key = `${personality.key}_lvl${lvl}`;
          expect(BOT_PROFILE_MAP.has(key)).toBe(true);
        }
      }
    });

    it('lvl9 does not exist for heuristic personalities', () => {
      for (const personality of BOT_PERSONALITIES) {
        const key = `${personality.key}_lvl9`;
        expect(BOT_PROFILE_MAP.has(key)).toBe(false);
      }
    });
  });

  describe('CFR bots', () => {
    it('all 9 CFR bots are in BOT_PROFILES', () => {
      for (const cfr of CFR_BOTS) {
        expect(BOT_PROFILES).toContain(cfr);
      }
    });

    it('CFR bots have isCFR flag', () => {
      for (const cfr of CFR_BOTS) {
        expect(cfr.isCFR).toBe(true);
      }
    });

    it('CFR bots are in the hard category', () => {
      const hardBots = getBotsForCategory('hard');
      for (const cfr of CFR_BOTS) {
        expect(hardBots).toContain(cfr);
      }
    });

    it('CFR bots are in the mixed category', () => {
      const mixedBots = getBotsForCategory('mixed');
      for (const cfr of CFR_BOTS) {
        expect(mixedBots).toContain(cfr);
      }
    });

    it('CFR bot UUIDs do not collide with heuristic bot UUIDs', () => {
      const heuristicUUIDs = new Set<string>();
      for (const profile of HEURISTIC_BOT_PROFILES) {
        const uuid = getBotUserIdByKey(profile.key);
        expect(uuid).not.toBeNull();
        heuristicUUIDs.add(uuid!);
      }

      for (const cfr of CFR_BOTS) {
        const cfrUUID = getBotUserIdByKey(cfr.key);
        expect(cfrUUID).not.toBeNull();
        expect(
          heuristicUUIDs.has(cfrUUID!),
          `CFR bot ${cfr.key} UUID ${cfrUUID} collides with a heuristic bot UUID`,
        ).toBe(false);
      }
    });

    it('all bot UUIDs are unique across the full 81-bot matrix', () => {
      const allUUIDs = new Map<string, string>();
      for (const profile of BOT_PROFILES) {
        const uuid = getBotUserIdByKey(profile.key);
        expect(uuid, `${profile.key} should have a UUID`).not.toBeNull();
        expect(
          allUUIDs.has(uuid!),
          `UUID ${uuid} used by both ${allUUIDs.get(uuid!)} and ${profile.key}`,
        ).toBe(false);
        allUUIDs.set(uuid!, profile.key);
      }
      expect(allUUIDs.size).toBe(81);
    });
  });

  describe('profile differentiation (lvl8 comparisons)', () => {
    it('Rock bluffs much less than Bluffer', () => {
      const rock = BOT_PROFILE_MAP.get('rock_lvl8')!;
      const bluffer = BOT_PROFILE_MAP.get('bluffer_lvl8')!;
      expect(rock.config.bluffFrequency).toBeLessThan(bluffer.config.bluffFrequency);
      expect(rock.config.openingBluffRate).toBeLessThan(bluffer.config.openingBluffRate);
    });

    it('Frost is more conservative than Cannon', () => {
      const frost = BOT_PROFILE_MAP.get('frost_lvl8')!;
      const cannon = BOT_PROFILE_MAP.get('cannon_lvl8')!;
      // Frost's signature is low aggression; Cannon's is high aggression
      expect(frost.config.aggressionBias).toBeLessThan(cannon.config.aggressionBias);
      expect(frost.config.bullPhaseRaiseRate).toBeLessThan(cannon.config.bullPhaseRaiseRate);
    });

    it('Grinder takes minimal risks', () => {
      const grinder = BOT_PROFILE_MAP.get('grinder_lvl8')!;
      expect(grinder.config.riskTolerance).toBeLessThanOrEqual(0.60);
    });

    it('Shark has high trust multiplier for opponent reads', () => {
      const shark = BOT_PROFILE_MAP.get('shark_lvl8')!;
      expect(shark.config.trustMultiplier).toBeGreaterThan(1.3);
    });

    it('Bluffer has high bluffFrequency and low bluffPlausibilityGate', () => {
      const bluffer = BOT_PROFILE_MAP.get('bluffer_lvl8')!;
      expect(bluffer.config.bluffFrequency).toBeGreaterThan(0.4);
      expect(bluffer.config.bluffPlausibilityGate).toBeLessThan(0.3);
    });

    it('Wildcard has the highest noiseBand among heuristic lvl8 bots', () => {
      const wildcard = BOT_PROFILE_MAP.get('wildcard_lvl8')!;
      for (const profile of HEURISTIC_BOT_PROFILES) {
        if (profile.key === 'wildcard_lvl8') continue;
        const level = parseInt(profile.key.split('_lvl')[1]!, 10);
        if (level === 8) {
          expect(wildcard.config.noiseBand).toBeGreaterThanOrEqual(profile.config.noiseBand);
        }
      }
    });

    it('Rock and Frost have high bluffPlausibilityGate (conservative bluffs)', () => {
      const rock = BOT_PROFILE_MAP.get('rock_lvl8')!;
      const frost = BOT_PROFILE_MAP.get('frost_lvl8')!;
      expect(rock.config.bluffPlausibilityGate).toBeGreaterThanOrEqual(0.45);
      expect(frost.config.bluffPlausibilityGate).toBeGreaterThanOrEqual(0.45);
    });

    it('Frost has low noiseBand (precise decisions)', () => {
      const frost = BOT_PROFILE_MAP.get('frost_lvl8')!;
      expect(frost.config.noiseBand).toBeLessThanOrEqual(0.08);
    });

    it('Professor matches evolved baseline', () => {
      const prof = BOT_PROFILE_MAP.get('professor_lvl8')!;
      for (const key of Object.keys(DEFAULT_BOT_PROFILE_CONFIG) as (keyof BotProfileConfig)[]) {
        // Use toBeCloseTo to handle floating point precision from level scaling lerp
        expect(prof.config[key]).toBeCloseTo(DEFAULT_BOT_PROFILE_CONFIG[key], 10);
      }
    });
  });

  describe('level categories', () => {
    it('easy bots are levels 1-3', () => {
      const easy = getBotsForCategory('easy');
      expect(easy.length).toBe(9 * 3); // 9 personalities × 3 levels
      for (const bot of easy) {
        const lvl = parseInt(bot.key.split('_lvl')[1]!, 10);
        expect(lvl).toBeGreaterThanOrEqual(1);
        expect(lvl).toBeLessThanOrEqual(3);
      }
    });

    it('normal bots are levels 4-6', () => {
      const normal = getBotsForCategory('normal');
      expect(normal.length).toBe(9 * 3); // 9 personalities × 3 levels
    });

    it('hard bots include levels 7-8 heuristic + 9 CFR bots', () => {
      const hard = getBotsForCategory('hard');
      // 9 personalities × 2 heuristic levels (7-8) + 9 CFR bots = 27
      expect(hard.length).toBe(9 * 2 + 9);
    });

    it('mixed includes all 81 bots', () => {
      const mixed = getBotsForCategory('mixed');
      expect(mixed.length).toBe(81);
    });
  });
});
