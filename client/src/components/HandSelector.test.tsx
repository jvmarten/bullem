import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { HandSelector } from './HandSelector.js';
import { HandType } from '@bull-em/shared';
import type { HandCall } from '@bull-em/shared';

afterEach(() => {
  cleanup();
});

describe('HandSelector', () => {
  const defaultProps = {
    currentHand: null as HandCall | null,
    onSubmit: vi.fn(),
  };

  function getHandTypePicker(container: HTMLElement) {
    return container.querySelector('[data-testid="hand-type-picker"]')!;
  }

  function clickHandType(container: HTMLElement, handType: HandType) {
    const picker = getHandTypePicker(container);
    const options = picker.querySelectorAll('[role="radio"]');
    fireEvent.click(options[handType]);
  }

  function clickRank(container: HTMLElement, rank: string, testId = 'rank-picker') {
    const picker = container.querySelector(`[data-testid="${testId}"]`)!;
    const cards = picker.querySelectorAll('[role="radio"]');
    for (const card of cards) {
      if (card.textContent?.trim() === rank) {
        fireEvent.click(card);
        return;
      }
    }
    throw new Error(`Rank card "${rank}" not found in ${testId}`);
  }

  function getSubmitButton(container: HTMLElement): HTMLButtonElement {
    const buttons = container.querySelectorAll('button');
    for (const btn of buttons) {
      const text = btn.textContent?.trim();
      if (text === 'Call' || text === 'Raise') return btn as HTMLButtonElement;
    }
    throw new Error('Submit button not found');
  }

  describe('hand type picker', () => {
    it('renders all hand type options', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      const picker = getHandTypePicker(container);
      const options = picker.querySelectorAll('[role="radio"]');
      expect(options.length).toBe(9); // Royal Flush is not selectable (auto-promoted from Straight Flush A-high)
    });

    it('defaults to HIGH_CARD when no current hand', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      const picker = getHandTypePicker(container);
      const options = picker.querySelectorAll('[role="radio"]');
      expect(options[HandType.HIGH_CARD].getAttribute('aria-checked')).toBe('true');
    });

    it('shows rank selector for HIGH_CARD', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      expect(container.textContent).toContain('Rank');
    });

    it('shows suit selector when FLUSH is selected', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      clickHandType(container, HandType.FLUSH);
      expect(container.textContent).toContain('Suit');
    });

    it('shows high card selector when STRAIGHT is selected', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      clickHandType(container, HandType.STRAIGHT);
      expect(container.textContent).toContain('High Card');
    });

    it('shows two rank selectors for TWO_PAIR', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      clickHandType(container, HandType.TWO_PAIR);
      expect(container.textContent).toContain('First Pair');
      expect(container.textContent).toContain('Second Pair');
    });

    it('shows three-of and pair-of labels for FULL_HOUSE', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      clickHandType(container, HandType.FULL_HOUSE);
      expect(container.textContent).toContain('Three of');
      expect(container.textContent).toContain('Pair of');
    });

    it('shows both suit and high card selectors for STRAIGHT_FLUSH', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      clickHandType(container, HandType.STRAIGHT_FLUSH);
      expect(container.textContent).toContain('Suit');
      expect(container.textContent).toContain('High Card');
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
      expect(button.textContent?.trim()).toBe('Call');
    });

    it('shows "Raise" when a current hand exists', () => {
      const currentHand: HandCall = { type: HandType.HIGH_CARD, rank: '2' };
      const { container } = render(
        <HandSelector currentHand={currentHand} onSubmit={vi.fn()} />
      );
      const button = getSubmitButton(container);
      expect(button.textContent?.trim()).toBe('Raise');
    });
  });

  describe('hand preview', () => {
    it('shows hand preview text when hand is valid', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      // Default is HIGH_CARD with rank 2 — should show "2 High"
      expect(container.textContent).toContain('2 High');
    });

    it('shows straight range in preview', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      clickHandType(container, HandType.STRAIGHT);
      // Default rank for straight should be A, showing "Straight, 10 to Ace"
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
      const callButton = getSubmitButton(container);
      expect(callButton.disabled).toBe(true);
    });

    it('shows validation message when hand is not higher', () => {
      const currentHand: HandCall = { type: HandType.PAIR, rank: 'A' };
      const { container } = render(
        <HandSelector currentHand={currentHand} onSubmit={vi.fn()} />
      );
      expect(container.textContent).toContain('Must be higher than current call');
    });

    it('enables submit when new hand is higher than current hand', () => {
      const currentHand: HandCall = { type: HandType.HIGH_CARD, rank: '2' };
      const { container } = render(
        <HandSelector currentHand={currentHand} onSubmit={vi.fn()} />
      );
      // Default rank is '2' which ties with current — select a higher rank
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

      // Default rank = 2, default rank2 = 3
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
