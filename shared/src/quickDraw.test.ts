import { describe, it, expect } from 'vitest';
import { getQuickDrawSuggestions, type QuickDrawSuggestion } from './quickDraw.js';
import { isHigherHand } from './hands.js';
import type { Card, HandCall } from './types.js';
import { HandType } from './types.js';

function card(rank: Card['rank'], suit: Card['suit'] = 'hearts'): Card {
  return { rank, suit };
}

describe('getQuickDrawSuggestions', () => {
  it('returns empty array for empty cards', () => {
    expect(getQuickDrawSuggestions([], null)).toEqual([]);
  });

  it('returns suggestions when currentHand is null (first call of round)', () => {
    const cards = [card('J', 'hearts'), card('J', 'spades')];
    const suggestions = getQuickDrawSuggestions(cards, null);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.length).toBeLessThanOrEqual(3);
  });

  it('every suggestion passes isHigherHand against currentHand', () => {
    const cards = [card('7', 'hearts'), card('7', 'clubs'), card('K', 'spades')];
    const currentHand: HandCall = { type: HandType.PAIR, rank: '5' };
    const suggestions = getQuickDrawSuggestions(cards, currentHand);

    for (const s of suggestions) {
      expect(isHigherHand(s.hand, currentHand)).toBe(true);
    }
  });

  it('returns at most 3 suggestions', () => {
    const cards = [card('A', 'hearts'), card('A', 'spades'), card('K', 'hearts'), card('K', 'diamonds'), card('Q', 'clubs')];
    const suggestions = getQuickDrawSuggestions(cards, null);
    expect(suggestions.length).toBeLessThanOrEqual(3);
  });

  it('safe suggestion matches actual holdings (pair)', () => {
    const cards = [card('J', 'hearts'), card('J', 'spades')];
    const suggestions = getQuickDrawSuggestions(cards, null);
    const safe = suggestions.find(s => s.tier === 'safe');
    expect(safe).toBeDefined();
    // With two Jacks, safe should be Pair of Jacks (or higher held hand)
    expect(safe!.hand.type).toBeGreaterThanOrEqual(HandType.PAIR);
  });

  it('filters out suggestions that do not beat a high current hand', () => {
    const cards = [card('3', 'hearts'), card('5', 'clubs')];
    const currentHand: HandCall = { type: HandType.FOUR_OF_A_KIND, rank: 'K' };
    const suggestions = getQuickDrawSuggestions(cards, currentHand);

    // With such a high current hand and weak cards, very few or no suggestions
    for (const s of suggestions) {
      expect(isHigherHand(s.hand, currentHand)).toBe(true);
    }
  });

  it('returns 0 suggestions when nothing can beat a royal flush', () => {
    const cards = [card('2', 'hearts'), card('3', 'clubs')];
    const currentHand: HandCall = { type: HandType.ROYAL_FLUSH, suit: 'spades' };
    const suggestions = getQuickDrawSuggestions(cards, currentHand);
    expect(suggestions).toEqual([]);
  });

  it('generates three-of-a-kind as ambitious when holding a pair', () => {
    const cards = [card('9', 'hearts'), card('9', 'clubs')];
    const suggestions = getQuickDrawSuggestions(cards, null);
    const ambitious = suggestions.find(s => s.tier === 'ambitious');
    expect(ambitious).toBeDefined();
    // Should suggest three 9s (bump from pair)
    if (ambitious && ambitious.hand.type === HandType.THREE_OF_A_KIND) {
      expect((ambitious.hand as { rank: string }).rank).toBe('9');
    }
  });

  it('no duplicate labels across suggestions', () => {
    const cards = [card('A', 'spades'), card('K', 'spades'), card('Q', 'spades')];
    const suggestions = getQuickDrawSuggestions(cards, null);
    const labels = suggestions.map(s => s.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('handles single card', () => {
    const cards = [card('A', 'hearts')];
    const suggestions = getQuickDrawSuggestions(cards, null);
    expect(suggestions.length).toBeGreaterThan(0);
    // Safe should be high card Ace or pair of Aces
    for (const s of suggestions) {
      expect(isHigherHand(s.hand, { type: HandType.HIGH_CARD, rank: '2' })).toBe(true);
    }
  });

  it('handles trips in hand', () => {
    const cards = [card('Q', 'hearts'), card('Q', 'spades'), card('Q', 'diamonds')];
    const suggestions = getQuickDrawSuggestions(cards, null);
    const safe = suggestions.find(s => s.tier === 'safe');
    expect(safe).toBeDefined();
    expect(safe!.hand.type).toBe(HandType.THREE_OF_A_KIND);
  });

  it('suggests flush when holding suited cards', () => {
    const cards = [card('2', 'spades'), card('7', 'spades'), card('K', 'spades')];
    const suggestions = getQuickDrawSuggestions(cards, null);
    const flushSuggestion = suggestions.find(s =>
      s.hand.type === HandType.FLUSH && (s.hand as { suit: string }).suit === 'spades'
    );
    expect(flushSuggestion).toBeDefined();
  });

  it('all suggestions are valid when currentHand is high', () => {
    const cards = [card('A', 'hearts'), card('K', 'hearts'), card('Q', 'hearts')];
    const currentHand: HandCall = { type: HandType.STRAIGHT, highRank: '9' };
    const suggestions = getQuickDrawSuggestions(cards, currentHand);

    for (const s of suggestions) {
      expect(isHigherHand(s.hand, currentHand)).toBe(true);
    }
  });

  it('tiers are ordered: safe, ambitious, bold', () => {
    const cards = [card('8', 'hearts'), card('8', 'clubs'), card('5', 'diamonds')];
    const suggestions = getQuickDrawSuggestions(cards, null);
    const tierOrder = { safe: 0, ambitious: 1, bold: 2 };
    for (let i = 1; i < suggestions.length; i++) {
      expect(tierOrder[suggestions[i]!.tier]).toBeGreaterThan(tierOrder[suggestions[i - 1]!.tier]);
    }
  });
});
