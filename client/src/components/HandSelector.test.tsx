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

  function getCallButton(container: HTMLElement): HTMLButtonElement {
    const buttons = container.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.textContent?.trim() === 'Call Hand') return btn as HTMLButtonElement;
    }
    throw new Error('Call Hand button not found');
  }

  describe('hand type dropdown', () => {
    it('renders all hand type options', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      const handTypeSelect = getHandTypeSelect(container);
      const options = handTypeSelect.querySelectorAll('option');
      expect(options.length).toBe(10);
    });

    it('defaults to HIGH_CARD when no current hand', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      const handTypeSelect = getHandTypeSelect(container);
      expect(handTypeSelect.value).toBe(String(HandType.HIGH_CARD));
    });

    it('shows rank selector for HIGH_CARD', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      expect(container.textContent).toContain('Rank');
    });

    it('shows suit selector when FLUSH is selected', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      const handTypeSelect = getHandTypeSelect(container);
      fireEvent.change(handTypeSelect, { target: { value: String(HandType.FLUSH) } });
      expect(container.textContent).toContain('Suit');
    });

    it('shows high card selector when STRAIGHT is selected', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      const handTypeSelect = getHandTypeSelect(container);
      fireEvent.change(handTypeSelect, { target: { value: String(HandType.STRAIGHT) } });
      expect(container.textContent).toContain('High Card');
    });

    it('shows two rank selectors for TWO_PAIR', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      const handTypeSelect = getHandTypeSelect(container);
      fireEvent.change(handTypeSelect, { target: { value: String(HandType.TWO_PAIR) } });
      expect(container.textContent).toContain('Rank 1');
      expect(container.textContent).toContain('Rank 2');
    });

    it('shows three-of and pair-of labels for FULL_HOUSE', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      const handTypeSelect = getHandTypeSelect(container);
      fireEvent.change(handTypeSelect, { target: { value: String(HandType.FULL_HOUSE) } });
      expect(container.textContent).toContain('Three of');
      expect(container.textContent).toContain('Pair of');
    });

    it('shows both suit and high card selectors for STRAIGHT_FLUSH', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      const handTypeSelect = getHandTypeSelect(container);
      fireEvent.change(handTypeSelect, { target: { value: String(HandType.STRAIGHT_FLUSH) } });
      expect(container.textContent).toContain('Suit');
      expect(container.textContent).toContain('High Card');
    });

    it('shows suit selector for ROYAL_FLUSH', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      const handTypeSelect = getHandTypeSelect(container);
      fireEvent.change(handTypeSelect, { target: { value: String(HandType.ROYAL_FLUSH) } });
      expect(container.textContent).toContain('Suit');
    });
  });

  describe('validation', () => {
    it('allows calling any hand when no current hand exists', () => {
      const { container } = render(<HandSelector {...defaultProps} />);
      const callButton = getCallButton(container);
      expect(callButton.disabled).toBe(false);
    });

    it('disables submit when new hand is not higher than current hand', () => {
      // currentHand is PAIR of A; component initializes with handType=PAIR, rank=A
      // That's equal, not higher, so button should be disabled
      const currentHand: HandCall = { type: HandType.PAIR, rank: 'A' };
      const { container } = render(
        <HandSelector currentHand={currentHand} onSubmit={vi.fn()} />
      );
      const callButton = getCallButton(container);
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
      const callButton = getCallButton(container);
      expect(callButton.disabled).toBe(false);
    });
  });

  describe('submit', () => {
    it('fires onSubmit with correct HandCall for HIGH_CARD', () => {
      const onSubmit = vi.fn();
      const { container } = render(<HandSelector currentHand={null} onSubmit={onSubmit} />);
      // Default hand type is HIGH_CARD, default rank is A
      fireEvent.click(getCallButton(container));
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onSubmit).toHaveBeenCalledWith({ type: HandType.HIGH_CARD, rank: 'A' });
    });

    it('fires onSubmit with correct HandCall for PAIR', () => {
      const onSubmit = vi.fn();
      const { container } = render(<HandSelector currentHand={null} onSubmit={onSubmit} />);
      const handTypeSelect = getHandTypeSelect(container);
      fireEvent.change(handTypeSelect, { target: { value: String(HandType.PAIR) } });
      // Default rank is A
      fireEvent.click(getCallButton(container));
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onSubmit).toHaveBeenCalledWith({ type: HandType.PAIR, rank: 'A' });
    });

    it('fires onSubmit with correct HandCall for FLUSH', () => {
      const onSubmit = vi.fn();
      const { container } = render(<HandSelector currentHand={null} onSubmit={onSubmit} />);
      const handTypeSelect = getHandTypeSelect(container);
      fireEvent.change(handTypeSelect, { target: { value: String(HandType.FLUSH) } });
      // Default suit is spades
      fireEvent.click(getCallButton(container));
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onSubmit).toHaveBeenCalledWith({ type: HandType.FLUSH, suit: 'spades' });
    });

    it('fires onSubmit with correct HandCall for ROYAL_FLUSH', () => {
      const onSubmit = vi.fn();
      const { container } = render(<HandSelector currentHand={null} onSubmit={onSubmit} />);
      const handTypeSelect = getHandTypeSelect(container);
      fireEvent.change(handTypeSelect, { target: { value: String(HandType.ROYAL_FLUSH) } });
      fireEvent.click(getCallButton(container));
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onSubmit).toHaveBeenCalledWith({ type: HandType.ROYAL_FLUSH, suit: 'spades' });
    });

    it('does not fire onSubmit when button is disabled', () => {
      const onSubmit = vi.fn();
      // PAIR of A is the highest pair; component initializes to handType=PAIR, rank=A
      // which equals the current hand, so it's not higher and button should be disabled
      const currentHand: HandCall = { type: HandType.PAIR, rank: 'A' };
      const { container } = render(<HandSelector currentHand={currentHand} onSubmit={onSubmit} />);
      fireEvent.click(getCallButton(container));
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

      fireEvent.click(getCallButton(container));
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
      fireEvent.click(getCallButton(container));
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onSubmit).toHaveBeenCalledWith({
        type: HandType.FULL_HOUSE,
        threeRank: 'A',
        twoRank: 'K',
      });
    });
  });
});
