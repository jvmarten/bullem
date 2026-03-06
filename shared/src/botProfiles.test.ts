import { describe, it, expect } from 'vitest';
import {
  BOT_PROFILES,
  BOT_PROFILE_MAP,
  BOT_PROFILE_KEYS,
  DEFAULT_BOT_PROFILE_CONFIG,
} from './botProfiles.js';
import type { BotProfileConfig, BotProfileDefinition } from './botProfiles.js';

describe('botProfiles', () => {
  describe('BOT_PROFILES', () => {
    it('has 8 profiles', () => {
      expect(BOT_PROFILES.length).toBe(8);
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
    it('contains all profiles', () => {
      expect(BOT_PROFILE_MAP.size).toBe(BOT_PROFILES.length);
    });

    it('allows O(1) lookup by key', () => {
      const rock = BOT_PROFILE_MAP.get('the_rock');
      expect(rock).toBeDefined();
      expect(rock!.name).toBe('The Rock');
    });

    it('returns undefined for unknown keys', () => {
      expect(BOT_PROFILE_MAP.get('nonexistent')).toBeUndefined();
    });
  });

  describe('BOT_PROFILE_KEYS', () => {
    it('has the right keys', () => {
      expect(BOT_PROFILE_KEYS).toEqual(BOT_PROFILES.map(p => p.key));
    });
  });

  describe('DEFAULT_BOT_PROFILE_CONFIG', () => {
    it('has standard values that match original hard-mode behavior', () => {
      expect(DEFAULT_BOT_PROFILE_CONFIG.bluffFrequency).toBe(1.0);
      expect(DEFAULT_BOT_PROFILE_CONFIG.bullThreshold).toBe(0.5);
      expect(DEFAULT_BOT_PROFILE_CONFIG.openingBluffRate).toBe(0.08);
      expect(DEFAULT_BOT_PROFILE_CONFIG.bullPhaseRaiseRate).toBe(0.15);
      expect(DEFAULT_BOT_PROFILE_CONFIG.noiseBand).toBe(0.05);
    });
  });

  describe('profile differentiation', () => {
    it('The Rock bluffs much less than Maverick', () => {
      const rock = BOT_PROFILE_MAP.get('the_rock')!;
      const maverick = BOT_PROFILE_MAP.get('maverick')!;
      expect(rock.config.bluffFrequency).toBeLessThan(maverick.config.bluffFrequency);
      expect(rock.config.openingBluffRate).toBeLessThan(maverick.config.openingBluffRate);
    });

    it('Ice Queen is more conservative than Loose Cannon', () => {
      const iceQueen = BOT_PROFILE_MAP.get('ice_queen')!;
      const looseCannon = BOT_PROFILE_MAP.get('loose_cannon')!;
      expect(iceQueen.config.riskTolerance).toBeLessThan(looseCannon.config.riskTolerance);
      expect(iceQueen.config.aggressionBias).toBeLessThan(looseCannon.config.aggressionBias);
    });

    it('The Grinder takes minimal risks', () => {
      const grinder = BOT_PROFILE_MAP.get('the_grinder')!;
      expect(grinder.config.riskTolerance).toBeLessThanOrEqual(0.15);
    });

    it('Shark has high trust multiplier for opponent reads', () => {
      const shark = BOT_PROFILE_MAP.get('shark')!;
      expect(shark.config.trustMultiplier).toBeGreaterThan(1.0);
    });

    it('Wildcard has wide noise band for unpredictability', () => {
      const wildcard = BOT_PROFILE_MAP.get('wildcard')!;
      expect(wildcard.config.noiseBand).toBeGreaterThan(DEFAULT_BOT_PROFILE_CONFIG.noiseBand);
    });
  });
});
