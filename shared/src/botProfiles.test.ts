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
} from './botProfiles.js';
import type { BotProfileConfig } from './botProfiles.js';

describe('botProfiles', () => {
  describe('BOT_PROFILES', () => {
    it('has 81 profiles (9 personalities × 9 levels)', () => {
      expect(BOT_PROFILES.length).toBe(BOT_MATRIX_SIZE);
      expect(BOT_PROFILES.length).toBe(BOT_PERSONALITIES.length * BOT_LEVELS);
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
        'trustMultiplier', 'cardCountSensitivity', 'headsUpAggression',
        'survivalPressure', 'bluffTargetSelection', 'positionAwareness', 'trueCallConfidence',
        'counterBluffRate', 'bullPhaseBluffRate', 'openingHandTypePreference',
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

        expect(cfg.cardCountSensitivity).toBeGreaterThanOrEqual(0);
        expect(cfg.cardCountSensitivity).toBeLessThanOrEqual(2.0);

        expect(cfg.headsUpAggression).toBeGreaterThanOrEqual(0);
        expect(cfg.headsUpAggression).toBeLessThanOrEqual(1.0);

        expect(cfg.survivalPressure).toBeGreaterThanOrEqual(0);
        expect(cfg.survivalPressure).toBeLessThanOrEqual(1.0);

        expect(cfg.bluffTargetSelection).toBeGreaterThanOrEqual(0);
        expect(cfg.bluffTargetSelection).toBeLessThanOrEqual(1.0);

        expect(cfg.positionAwareness).toBeGreaterThanOrEqual(0);
        expect(cfg.positionAwareness).toBeLessThanOrEqual(1.0);

        expect(cfg.trueCallConfidence).toBeGreaterThanOrEqual(0);
        expect(cfg.trueCallConfidence).toBeLessThanOrEqual(1.0);

        expect(cfg.counterBluffRate).toBeGreaterThanOrEqual(0);
        expect(cfg.counterBluffRate).toBeLessThanOrEqual(1.0);

        expect(cfg.bullPhaseBluffRate).toBeGreaterThanOrEqual(0);
        expect(cfg.bullPhaseBluffRate).toBeLessThanOrEqual(1.0);

        expect(cfg.openingHandTypePreference).toBeGreaterThanOrEqual(0);
        expect(cfg.openingHandTypePreference).toBeLessThanOrEqual(1.0);
      }
    });
  });

  describe('BOT_PROFILE_MAP', () => {
    it('contains all profiles plus impossible bot', () => {
      // 81 personality bots + 1 impossible bot = 82
      expect(BOT_PROFILE_MAP.size).toBe(BOT_PROFILES.length + 1);
    });

    it('allows O(1) lookup by key', () => {
      const rock9 = BOT_PROFILE_MAP.get('rock_lvl9');
      expect(rock9).toBeDefined();
      expect(rock9!.name).toBe('Rock lvl9');
    });

    it('returns undefined for unknown keys', () => {
      expect(BOT_PROFILE_MAP.get('nonexistent')).toBeUndefined();
    });
  });

  describe('BOT_PROFILE_KEYS', () => {
    it('has the right keys', () => {
      expect(BOT_PROFILE_KEYS).toEqual([...BOT_PROFILES.map(p => p.key), 'oracle_lvl10']);
    });
  });

  describe('DEFAULT_BOT_PROFILE_CONFIG', () => {
    it('uses exact evolved champion values as baseline', () => {
      // DEFAULT is the evolved champion — all personalities derive from this.
      // After each evolution run, update DEFAULT and the Evolved personality config.
      expect(DEFAULT_BOT_PROFILE_CONFIG.bluffFrequency).toBe(0.0);
      expect(DEFAULT_BOT_PROFILE_CONFIG.bullThreshold).toBe(0.56);
      expect(DEFAULT_BOT_PROFILE_CONFIG.riskTolerance).toBe(0.99);
      expect(DEFAULT_BOT_PROFILE_CONFIG.aggressionBias).toBe(0.30);
      expect(DEFAULT_BOT_PROFILE_CONFIG.openingBluffRate).toBe(0.57);
      expect(DEFAULT_BOT_PROFILE_CONFIG.bullPhaseRaiseRate).toBe(0.21);
      expect(DEFAULT_BOT_PROFILE_CONFIG.trustMultiplier).toBe(1.21);
      expect(DEFAULT_BOT_PROFILE_CONFIG.cardCountSensitivity).toBe(0.05);
      expect(DEFAULT_BOT_PROFILE_CONFIG.headsUpAggression).toBe(0.68);
      expect(DEFAULT_BOT_PROFILE_CONFIG.survivalPressure).toBe(0.40);
      expect(DEFAULT_BOT_PROFILE_CONFIG.trueCallConfidence).toBe(1.0);
      expect(DEFAULT_BOT_PROFILE_CONFIG.counterBluffRate).toBe(0.62);
      expect(DEFAULT_BOT_PROFILE_CONFIG.bullPhaseBluffRate).toBe(0.75);
      expect(DEFAULT_BOT_PROFILE_CONFIG.openingHandTypePreference).toBe(0.26);
    });
  });

  describe('LEGACY_PROFILE_KEY_MAP', () => {
    it('maps all 8 old profile keys to new lvl9 keys', () => {
      expect(LEGACY_PROFILE_KEY_MAP.size).toBe(8);
      for (const [_old, newKey] of LEGACY_PROFILE_KEY_MAP) {
        expect(BOT_PROFILE_MAP.has(newKey)).toBe(true);
      }
    });
  });

  describe('level scaling', () => {
    it('lvl9 profiles express personality more strongly than lvl1', () => {
      const rock1 = BOT_PROFILE_MAP.get('rock_lvl1')!;
      const rock9 = BOT_PROFILE_MAP.get('rock_lvl9')!;
      // Rock at lvl9 should have lower bluffFrequency (more conservative) than lvl1
      // because lvl1 lerps toward unskilled (0.55 bluffFreq) while rock lvl9 = 0.0
      expect(rock9.config.bluffFrequency).toBeLessThan(rock1.config.bluffFrequency);
    });

    it('all 9 levels exist for each personality', () => {
      for (const personality of BOT_PERSONALITIES) {
        for (let lvl = 1; lvl <= BOT_LEVELS; lvl++) {
          const key = `${personality.key}_lvl${lvl}`;
          expect(BOT_PROFILE_MAP.has(key)).toBe(true);
        }
      }
    });
  });

  describe('profile differentiation (lvl9 comparisons)', () => {
    it('Rock bluffs much less than Bluffer', () => {
      const rock = BOT_PROFILE_MAP.get('rock_lvl9')!;
      const bluffer = BOT_PROFILE_MAP.get('bluffer_lvl9')!;
      // Both evolved to bluffFrequency 0.0 — compare actual bluffing via opening/bull-phase rates
      expect(rock.config.openingBluffRate).toBeLessThan(bluffer.config.openingBluffRate);
      expect(rock.config.bullPhaseBluffRate).toBeLessThan(bluffer.config.bullPhaseBluffRate);
      expect(rock.config.counterBluffRate).toBeLessThan(bluffer.config.counterBluffRate);
    });

    it('Frost is more conservative than Cannon', () => {
      const frost = BOT_PROFILE_MAP.get('frost_lvl9')!;
      const cannon = BOT_PROFILE_MAP.get('cannon_lvl9')!;
      expect(frost.config.riskTolerance).toBeLessThan(cannon.config.riskTolerance);
      expect(frost.config.aggressionBias).toBeLessThan(cannon.config.aggressionBias);
    });

    it('Grinder takes moderate risks (evolved-informed but still cautious)', () => {
      const grinder = BOT_PROFILE_MAP.get('grinder_lvl9')!;
      expect(grinder.config.riskTolerance).toBeLessThanOrEqual(0.55);
    });

    it('Shark has high trust multiplier for opponent reads', () => {
      const shark = BOT_PROFILE_MAP.get('shark_lvl9')!;
      expect(shark.config.trustMultiplier).toBeGreaterThan(1.0);
    });

    it('Bluffer has high counterBluffRate and bullPhaseBluffRate', () => {
      const bluffer = BOT_PROFILE_MAP.get('bluffer_lvl9')!;
      expect(bluffer.config.counterBluffRate).toBeGreaterThan(0.3);
      expect(bluffer.config.bullPhaseBluffRate).toBeGreaterThan(0.1);
    });

    it('Bluffer has high headsUpAggression and low survivalPressure', () => {
      const bluffer = BOT_PROFILE_MAP.get('bluffer_lvl9')!;
      expect(bluffer.config.headsUpAggression).toBeGreaterThan(0.7);
      expect(bluffer.config.survivalPressure).toBeLessThan(0.3);
    });

    it('Rock has low cardCountSensitivity and high survivalPressure', () => {
      const rock = BOT_PROFILE_MAP.get('rock_lvl9')!;
      expect(rock.config.cardCountSensitivity).toBeLessThanOrEqual(0.1);
      expect(rock.config.survivalPressure).toBeGreaterThanOrEqual(0.55);
    });

    it('Cannon has high bluffTargetSelection (ambitious bluffs)', () => {
      const cannon = BOT_PROFILE_MAP.get('cannon_lvl9')!;
      // Evolved insight: slightly less reckless jumps (0.65 vs old 0.9)
      expect(cannon.config.bluffTargetSelection).toBeGreaterThan(0.5);
    });

    it('Shark has among the highest positionAwareness', () => {
      const shark = BOT_PROFILE_MAP.get('shark_lvl9')!;
      // Evolved insight: position awareness matters less than before (evolved: 0.42)
      // Shark still has high position awareness relative to most bots
      expect(shark.config.positionAwareness).toBeGreaterThanOrEqual(0.5);
    });

    it('Frost has high trueCallConfidence', () => {
      const frost = BOT_PROFILE_MAP.get('frost_lvl9')!;
      expect(frost.config.trueCallConfidence).toBeGreaterThan(0.7);
    });

    it('Frost has low openingHandTypePreference (evolved: hide info)', () => {
      const frost = BOT_PROFILE_MAP.get('frost_lvl9')!;
      // Evolved insight: hiding info at opening is strong
      expect(frost.config.openingHandTypePreference).toBeLessThanOrEqual(0.35);
    });

    it('Rock and Frost have counter-bluffs and bull-phase bluffs below evolved but significant', () => {
      const rock = BOT_PROFILE_MAP.get('rock_lvl9')!;
      const frost = BOT_PROFILE_MAP.get('frost_lvl9')!;
      // Evolved insight: even conservative bots benefit from counter-bluffing
      // and bull-phase bluffing — raised significantly from old values
      expect(rock.config.counterBluffRate).toBeGreaterThanOrEqual(0.30);
      expect(rock.config.counterBluffRate).toBeLessThan(DEFAULT_BOT_PROFILE_CONFIG.counterBluffRate);
      expect(rock.config.bullPhaseBluffRate).toBeGreaterThanOrEqual(0.35);
      expect(frost.config.counterBluffRate).toBeGreaterThanOrEqual(0.35);
      expect(frost.config.counterBluffRate).toBeLessThan(DEFAULT_BOT_PROFILE_CONFIG.counterBluffRate);
      expect(frost.config.bullPhaseBluffRate).toBeGreaterThanOrEqual(0.40);
    });
  });
});
