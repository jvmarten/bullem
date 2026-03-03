import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { HandSelector } from './HandSelector.js';
import { HandType } from '@bull-em/shared';
import type { HandCall } from '@bull-em/shared';

afterEach(() => {
  cleanup();
});

/** ALL_HAND_TYPES order matching HandSelector's internal list */
const ALL_HAND_TYPES: HandType[] = Object.values(HandType)
  .filter((v): v is HandType => typeof v === 'number' && v !== HandType.ROYAL_FLUSH);

describe('HandSelector', () => {
  const defaultProps = {
    currentHand: null as HandCall | null,
    onSubmit: vi.fn(),
  };

  /** Click on a hand type by its index in ALL_HAND_TYPES (first wheel) */
  function clickHandType(container: HTMLElement, handType: HandType) {
    const idx = ALL_HAND_TYPES.indexOf(handType);
    const wheels = container.querySelectorAll('.wheel-picker-scroll');
    const handWheel = wheels[0];
    if (!handWheel) throw new Error('Hand type wheel not found');
    const item = handWheel.querySelector(`[data-wheel-item="${idx}"]`) as HTMLElement | null;
    if (!item) throw new Error(`Hand type index ${idx} not found`);
    fireEvent.click(item);
  }

  /** Click on a rank card in a rank wheel */
  function clickRank(container: HTMLElement, rank: string) {
    const cards = container.querySelectorAll('.hs-rank-card');
    for (const card of cards) {
      if (card.textContent?.trim() === rank) {
        const item = card.closest('[data-wheel-item]') as HTMLElement;
        if (item) { fireEvent.click(item); return; }
      }
    }
    throw new Error(`Rank "${rank}" not found`);
  }

  function getSubmitButton(container: HTMLElement): HTMLButtonElement {
    const buttons = container.querySelectorAll('button');
    for (const btn of buttons) {
      const text = btn.textContent?.trim() ?? '';
      if (text.startsWith('Call') || text.startsWith('Raise')) return btn as HTMLButtonElement;
    }
    throw new Error('Submit button not found');
  }

  describe('hand type picker', () => {
    it('renders all hand type items as wheel entries', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      const wheels = container.querySelectorAll('.wheel-picker-scroll');
      expect(wheels.length).toBeGreaterThanOrEqual(2);
      const handWheel = wheels[0];
      const items = handWheel.querySelectorAll('[data-wheel-item]');
      expect(items.length).toBe(ALL_HAND_TYPES.length);
    });

    it('shows rank cards for HIGH_CARD by default', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      expect(container.querySelectorAll('.hs-rank-card').length).toBeGreaterThan(0);
    });

    it('shows rank cards when FLUSH is selected (suit cards)', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      clickHandType(container, HandType.FLUSH);
      expect(container.querySelectorAll('[data-suit-card]').length).toBeGreaterThan(0);
    });

    it('shows rank cards when STRAIGHT is selected', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      clickHandType(container, HandType.STRAIGHT);
      expect(container.querySelectorAll('.hs-rank-card').length).toBeGreaterThan(0);
    });

    it('shows rank cards for TWO_PAIR', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      clickHandType(container, HandType.TWO_PAIR);
      expect(container.querySelectorAll('.hs-rank-card').length).toBeGreaterThan(0);
    });

    it('shows rank cards for FULL_HOUSE', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      clickHandType(container, HandType.FULL_HOUSE);
      expect(container.querySelectorAll('.hs-rank-card').length).toBeGreaterThan(0);
    });

    it('shows both suit and rank pickers for STRAIGHT_FLUSH', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      clickHandType(container, HandType.STRAIGHT_FLUSH);
      expect(container.querySelectorAll('[data-suit-card]').length).toBeGreaterThan(0);
      expect(container.querySelectorAll('.hs-rank-card').length).toBeGreaterThan(0);
    });

    it('auto-promotes Straight Flush with Ace high to Royal Flush', () => {
      const onSubmit = vi.fn();
      const { container } = render(<HandSelector currentHand={null} onSubmit={onSubmit} />);
      clickHandType(container, HandType.STRAIGHT_FLUSH);
      clickRank(container, 'A');
      fireEvent.click(getSubmitButton(container));
      expect(onSubmit).toHaveBeenCalledWith({ type: HandType.ROYAL_FLUSH, suit: 'spades' });
    });
  });

  describe('button text', () => {
    it('shows "Call" when no current hand exists', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      const button = getSubmitButton(container);
      expect(button.textContent).toContain('Call');
    });

    it('shows "Raise" when a current hand exists', () => {
      const currentHand: HandCall = { type: HandType.HIGH_CARD, rank: '2' };
      const { container } = render(
        <HandSelector currentHand={currentHand} onSubmit={vi.fn()} />
      );
      const button = getSubmitButton(container);
      expect(button.textContent).toContain('Raise');
    });
  });

  describe('hand preview', () => {
    it('shows hand name when hand is valid', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      expect(container.textContent).toContain('2 High');
    });

    it('shows straight text when straight is selected', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      clickHandType(container, HandType.STRAIGHT);
      expect(container.textContent).toContain('Straight');
    });
  });

  describe('validation', () => {
    it('allows calling any hand when no current hand exists', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      const callButton = getSubmitButton(container);
      expect(callButton.disabled).toBe(false);
    });

    it('disables submit when new hand is not higher than current hand', () => {
      const currentHand: HandCall = { type: HandType.PAIR, rank: 'A' };
      const { container } = render(
        <HandSelector currentHand={currentHand} onSubmit={vi.fn()} />
      );
      clickHandType(container, HandType.HIGH_CARD);
      const callButton = getSubmitButton(container);
      expect(callButton.disabled).toBe(true);
    });

    it('"Must be higher" is shown by parent, not HandSelector', () => {
      const currentHand: HandCall = { type: HandType.PAIR, rank: 'A' };
      const { container } = render(
        <HandSelector currentHand={currentHand} onSubmit={vi.fn()} />
      );
      clickHandType(container, HandType.HIGH_CARD);
      // Validation message moved to parent pages (GamePage / LocalGamePage)
      expect(container.textContent).not.toContain('Must be higher');
    });

    it('enables submit when new hand is higher than current hand', () => {
      const currentHand: HandCall = { type: HandType.HIGH_CARD, rank: '2' };
      const { container } = render(
        <HandSelector currentHand={currentHand} onSubmit={vi.fn()} />
      );
      clickRank(container, 'A');
      const callButton = getSubmitButton(container);
      expect(callButton.disabled).toBe(false);
    });
  });

  describe('submit', () => {
    it('fires onSubmit with correct HandCall for HIGH_CARD', () => {
      const onSubmit = vi.fn();
      const { container } = render(<HandSelector currentHand={null} onSubmit={onSubmit} />);
      fireEvent.click(getSubmitButton(container));
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onSubmit).toHaveBeenCalledWith({ type: HandType.HIGH_CARD, rank: '2' });
    });

    it('fires onSubmit with correct HandCall for PAIR', () => {
      const onSubmit = vi.fn();
      const { container } = render(<HandSelector currentHand={null} onSubmit={onSubmit} />);
      clickHandType(container, HandType.PAIR);
      fireEvent.click(getSubmitButton(container));
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onSubmit).toHaveBeenCalledWith({ type: HandType.PAIR, rank: '2' });
    });

    it('fires onSubmit with correct HandCall for FLUSH', () => {
      const onSubmit = vi.fn();
      const { container } = render(<HandSelector currentHand={null} onSubmit={onSubmit} />);
      clickHandType(container, HandType.FLUSH);
      fireEvent.click(getSubmitButton(container));
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onSubmit).toHaveBeenCalledWith({ type: HandType.FLUSH, suit: 'spades' });
    });

    it('fires onSubmit with STRAIGHT_FLUSH when high card is not Ace', () => {
      const onSubmit = vi.fn();
      const { container } = render(<HandSelector currentHand={null} onSubmit={onSubmit} />);
      clickHandType(container, HandType.STRAIGHT_FLUSH);
      clickRank(container, 'K');
      fireEvent.click(getSubmitButton(container));
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onSubmit).toHaveBeenCalledWith({ type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: 'K' });
    });

    it('does not fire onSubmit when button is disabled', () => {
      const onSubmit = vi.fn();
      const currentHand: HandCall = { type: HandType.PAIR, rank: 'A' };
      const { container } = render(<HandSelector currentHand={currentHand} onSubmit={onSubmit} />);
      clickHandType(container, HandType.HIGH_CARD);
      fireEvent.click(getSubmitButton(container));
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('fires onSubmit with correct HandCall for STRAIGHT with changed rank', () => {
      const onSubmit = vi.fn();
      const { container } = render(<HandSelector currentHand={null} onSubmit={onSubmit} />);
      clickHandType(container, HandType.STRAIGHT);
      clickRank(container, '9');
      fireEvent.click(getSubmitButton(container));
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onSubmit).toHaveBeenCalledWith({ type: HandType.STRAIGHT, highRank: '9' });
    });

    it('fires onSubmit with correct HandCall for FULL_HOUSE', () => {
      const onSubmit = vi.fn();
      const { container } = render(<HandSelector currentHand={null} onSubmit={onSubmit} />);
      clickHandType(container, HandType.FULL_HOUSE);
      fireEvent.click(getSubmitButton(container));
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onSubmit).toHaveBeenCalledWith({
        type: HandType.FULL_HOUSE,
        threeRank: '2',
        twoRank: '3',
      });
    });
  });
});
