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

  function getHandTypeSelect(container: HTMLElement): HTMLSelectElement {
    const selects = container.querySelectorAll('select');
    return selects[0] as HTMLSelectElement;
  }

  function getSubmitButton(container: HTMLElement): HTMLButtonElement {
    const buttons = container.querySelectorAll('button');
    for (const btn of buttons) {
      const text = btn.textContent?.trim();
      if (text === 'Call' || text === 'Raise') return btn as HTMLButtonElement;
    }
    throw new Error('Submit button not found');
  }

  describe('hand type dropdown', () => {
    it('renders all hand type options (excluding Royal Flush)', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      const handTypeSelect = getHandTypeSelect(container);
      const options = handTypeSelect.querySelectorAll('option');
      expect(options.length).toBe(9);
    });

    it('defaults to HIGH_CARD when no current hand', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      const handTypeSelect = getHandTypeSelect(container);
      expect(handTypeSelect.value).toBe(String(HandType.HIGH_CARD));
    });

    it('shows rank selector for HIGH_CARD', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      // Second select should be the rank dropdown
      const selects = container.querySelectorAll('select');
      expect(selects.length).toBeGreaterThanOrEqual(2);
    });

    it('shows suit selector when FLUSH is selected', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      const handTypeSelect = getHandTypeSelect(container);
      fireEvent.change(handTypeSelect, { target: { value: String(HandType.FLUSH) } });
      // Should have a suit select with suit options
      const selects = container.querySelectorAll('select');
      expect(selects.length).toBeGreaterThanOrEqual(2);
      expect(container.textContent).toContain('Spades');
    });

    it('shows high card selector when STRAIGHT is selected', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      const handTypeSelect = getHandTypeSelect(container);
      fireEvent.change(handTypeSelect, { target: { value: String(HandType.STRAIGHT) } });
      const selects = container.querySelectorAll('select');
      expect(selects.length).toBeGreaterThanOrEqual(2);
    });

    it('shows two rank selectors for TWO_PAIR', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      const handTypeSelect = getHandTypeSelect(container);
      fireEvent.change(handTypeSelect, { target: { value: String(HandType.TWO_PAIR) } });
      // Should have 3 selects: hand type + 2 rank selects
      const selects = container.querySelectorAll('select');
      expect(selects.length).toBe(3);
    });

    it('shows two rank selectors for FULL_HOUSE', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      const handTypeSelect = getHandTypeSelect(container);
      fireEvent.change(handTypeSelect, { target: { value: String(HandType.FULL_HOUSE) } });
      const selects = container.querySelectorAll('select');
      expect(selects.length).toBe(3);
    });

    it('shows both suit and high card selectors for STRAIGHT_FLUSH', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      const handTypeSelect = getHandTypeSelect(container);
      fireEvent.change(handTypeSelect, { target: { value: String(HandType.STRAIGHT_FLUSH) } });
      // Should have 3 selects: hand type + high card + suit
      const selects = container.querySelectorAll('select');
      expect(selects.length).toBe(3);
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
      // Default is HIGH_CARD with rank A — should show "Ace High"
      expect(container.textContent).toContain('Ace High');
    });

    it('shows straight range in preview', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      const handTypeSelect = getHandTypeSelect(container);
      fireEvent.change(handTypeSelect, { target: { value: String(HandType.STRAIGHT) } });
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
      // currentHand is PAIR of A; component initializes with handType=PAIR, rank=A
      // That's equal, not higher, so button should be disabled
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
      // Default is HIGH_CARD with rank A which is higher than HIGH_CARD 2
      const callButton = getSubmitButton(container);
      expect(callButton.disabled).toBe(false);
    });
  });

  describe('submit', () => {
    it('fires onSubmit with correct HandCall for HIGH_CARD', () => {
      const onSubmit = vi.fn();
      const { container } = render(<HandSelector currentHand={null} onSubmit={onSubmit} />);
      // Default hand type is HIGH_CARD, default rank is A
      fireEvent.click(getSubmitButton(container));
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onSubmit).toHaveBeenCalledWith({ type: HandType.HIGH_CARD, rank: 'A' });
    });

    it('fires onSubmit with correct HandCall for PAIR', () => {
      const onSubmit = vi.fn();
      const { container } = render(<HandSelector currentHand={null} onSubmit={onSubmit} />);
      const handTypeSelect = getHandTypeSelect(container);
      fireEvent.change(handTypeSelect, { target: { value: String(HandType.PAIR) } });
      // Default rank is A
      fireEvent.click(getSubmitButton(container));
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onSubmit).toHaveBeenCalledWith({ type: HandType.PAIR, rank: 'A' });
    });

    it('fires onSubmit with correct HandCall for FLUSH', () => {
      const onSubmit = vi.fn();
      const { container } = render(<HandSelector currentHand={null} onSubmit={onSubmit} />);
      const handTypeSelect = getHandTypeSelect(container);
      fireEvent.change(handTypeSelect, { target: { value: String(HandType.FLUSH) } });
      // Default suit is spades
      fireEvent.click(getSubmitButton(container));
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onSubmit).toHaveBeenCalledWith({ type: HandType.FLUSH, suit: 'spades' });
    });

    it('does not fire onSubmit when button is disabled', () => {
      const onSubmit = vi.fn();
      // PAIR of A is the highest pair; component initializes to handType=PAIR, rank=A
      // which equals the current hand, so it's not higher and button should be disabled
      const currentHand: HandCall = { type: HandType.PAIR, rank: 'A' };
      const { container } = render(<HandSelector currentHand={currentHand} onSubmit={onSubmit} />);
      fireEvent.click(getSubmitButton(container));
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('fires onSubmit with correct HandCall for STRAIGHT with changed rank', () => {
      const onSubmit = vi.fn();
      const { container } = render(<HandSelector currentHand={null} onSubmit={onSubmit} />);
      const handTypeSelect = getHandTypeSelect(container);
      fireEvent.change(handTypeSelect, { target: { value: String(HandType.STRAIGHT) } });

      // Find the High Card select (should be the second select)
      const selects = container.querySelectorAll('select');
      const highCardSelect = selects[1] as HTMLSelectElement;
      fireEvent.change(highCardSelect, { target: { value: '9' } });

      fireEvent.click(getSubmitButton(container));
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onSubmit).toHaveBeenCalledWith({ type: HandType.STRAIGHT, highRank: '9' });
    });

    it('fires onSubmit with correct HandCall for FULL_HOUSE', () => {
      const onSubmit = vi.fn();
      const { container } = render(<HandSelector currentHand={null} onSubmit={onSubmit} />);
      const handTypeSelect = getHandTypeSelect(container);
      fireEvent.change(handTypeSelect, { target: { value: String(HandType.FULL_HOUSE) } });

      // Full house has two rank selects: Three of + Pair of
      // Default rank = A, default rank2 = K
      fireEvent.click(getSubmitButton(container));
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onSubmit).toHaveBeenCalledWith({
        type: HandType.FULL_HOUSE,
        threeRank: 'A',
        twoRank: 'K',
      });
    });
  });
});
