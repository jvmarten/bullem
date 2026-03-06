import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { RankBadge, RankBadgeLarge } from './RankBadge.js';
import { RankTier, getRankTier } from '@bull-em/shared';

afterEach(() => {
  cleanup();
});

describe('getRankTier', () => {
  it('returns Bronze for ratings below 1000', () => {
    expect(getRankTier(0)).toBe(RankTier.BRONZE);
    expect(getRankTier(500)).toBe(RankTier.BRONZE);
    expect(getRankTier(999)).toBe(RankTier.BRONZE);
  });

  it('returns Silver at exactly 1000', () => {
    expect(getRankTier(1000)).toBe(RankTier.SILVER);
  });

  it('returns Silver for 1000-1199', () => {
    expect(getRankTier(1100)).toBe(RankTier.SILVER);
    expect(getRankTier(1199)).toBe(RankTier.SILVER);
  });

  it('returns Gold at exactly 1200', () => {
    expect(getRankTier(1200)).toBe(RankTier.GOLD);
  });

  it('returns Gold for 1200-1399', () => {
    expect(getRankTier(1300)).toBe(RankTier.GOLD);
    expect(getRankTier(1399)).toBe(RankTier.GOLD);
  });

  it('returns Platinum at exactly 1400', () => {
    expect(getRankTier(1400)).toBe(RankTier.PLATINUM);
  });

  it('returns Platinum for 1400-1599', () => {
    expect(getRankTier(1500)).toBe(RankTier.PLATINUM);
    expect(getRankTier(1599)).toBe(RankTier.PLATINUM);
  });

  it('returns Diamond at exactly 1600', () => {
    expect(getRankTier(1600)).toBe(RankTier.DIAMOND);
  });

  it('returns Diamond for ratings above 1600', () => {
    expect(getRankTier(1800)).toBe(RankTier.DIAMOND);
    expect(getRankTier(2500)).toBe(RankTier.DIAMOND);
  });
});

describe('RankBadge', () => {
  it('renders without crashing', () => {
    const { container } = render(<RankBadge rating={1200} />);
    expect(container.querySelector('span')).toBeTruthy();
  });

  it('shows rating when showRating is true', () => {
    const { container } = render(<RankBadge rating={1200} showRating />);
    expect(container.textContent).toContain('1200');
  });

  it('does not show rating by default', () => {
    const { container } = render(<RankBadge rating={1200} />);
    expect(container.textContent).not.toContain('1200');
  });

  it('respects tier override', () => {
    const { container } = render(<RankBadge rating={500} tier={RankTier.DIAMOND} />);
    // Should have Diamond styling despite low rating
    expect(container.querySelector('span')?.getAttribute('title')).toContain('Diamond');
  });

  it('uses correct tier based on rating', () => {
    const { container } = render(<RankBadge rating={999} />);
    expect(container.querySelector('span')?.getAttribute('title')).toContain('Bronze');
  });
});

describe('RankBadgeLarge', () => {
  it('renders tier label and rating', () => {
    const { container } = render(<RankBadgeLarge rating={1500} />);
    expect(container.textContent).toContain('Platinum');
    expect(container.textContent).toContain('1500');
  });
});
