import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { ActionButtons } from './ActionButtons.js';
import { RoundPhase } from '@bull-em/shared';

vi.mock('../hooks/useSound.js', () => ({
  useSound: () => ({ play: vi.fn(), muted: false, toggleMute: vi.fn(), volume: 1, setVolume: vi.fn() }),
}));

afterEach(() => {
  cleanup();
});

describe('ActionButtons', () => {
  const defaultProps = {
    roundPhase: RoundPhase.CALLING,
    isMyTurn: true,
    hasCurrentHand: true,
    isLastChanceCaller: false,
    onBull: vi.fn(),
    onTrue: vi.fn(),
    onLastChancePass: vi.fn(),
  };

  function getButtonByText(container: HTMLElement, text: string): HTMLButtonElement | null {
    const buttons = container.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.textContent?.trim() === text) return btn as HTMLButtonElement;
    }
    return null;
  }

  describe('when it is not the player turn', () => {
    it('renders nothing', () => {
      const { container } = render(
        <ActionButtons {...defaultProps} isMyTurn={false} />
      );
      expect(container.innerHTML).toBe('');
    });
  });

  describe('CALLING phase', () => {
    it('shows BULL button when there is a current hand', () => {
      const { container } = render(
        <ActionButtons {...defaultProps} roundPhase={RoundPhase.CALLING} hasCurrentHand={true} />
      );
      expect(getButtonByText(container, 'BULL!')).not.toBeNull();
    });

    it('does not show TRUE button', () => {
      const { container } = render(
        <ActionButtons {...defaultProps} roundPhase={RoundPhase.CALLING} hasCurrentHand={true} />
      );
      expect(getButtonByText(container, 'TRUE')).toBeNull();
    });

    it('renders nothing when no current hand exists', () => {
      const { container } = render(
        <ActionButtons {...defaultProps} roundPhase={RoundPhase.CALLING} hasCurrentHand={false} />
      );
      expect(container.innerHTML).toBe('');
    });

    it('fires onBull when BULL button is clicked', () => {
      const onBull = vi.fn();
      const { container } = render(
        <ActionButtons {...defaultProps} roundPhase={RoundPhase.CALLING} onBull={onBull} />
      );
      const bullBtn = getButtonByText(container, 'BULL!');
      expect(bullBtn).not.toBeNull();
      fireEvent.click(bullBtn!);
      expect(onBull).toHaveBeenCalledOnce();
    });
  });

  describe('BULL_PHASE', () => {
    it('shows both BULL and TRUE buttons when there is a current hand', () => {
      const { container } = render(
        <ActionButtons {...defaultProps} roundPhase={RoundPhase.BULL_PHASE} hasCurrentHand={true} />
      );
      expect(getButtonByText(container, 'BULL!')).not.toBeNull();
      expect(getButtonByText(container, 'TRUE')).not.toBeNull();
    });

    it('shows only TRUE button when no current hand', () => {
      const { container } = render(
        <ActionButtons {...defaultProps} roundPhase={RoundPhase.BULL_PHASE} hasCurrentHand={false} />
      );
      expect(getButtonByText(container, 'BULL!')).toBeNull();
      expect(getButtonByText(container, 'TRUE')).not.toBeNull();
    });

    it('fires onBull when BULL button is clicked', () => {
      const onBull = vi.fn();
      const { container } = render(
        <ActionButtons {...defaultProps} roundPhase={RoundPhase.BULL_PHASE} onBull={onBull} />
      );
      const bullBtn = getButtonByText(container, 'BULL!');
      expect(bullBtn).not.toBeNull();
      fireEvent.click(bullBtn!);
      expect(onBull).toHaveBeenCalledOnce();
    });

    it('fires onTrue when TRUE button is clicked', () => {
      const onTrue = vi.fn();
      const { container } = render(
        <ActionButtons {...defaultProps} roundPhase={RoundPhase.BULL_PHASE} onTrue={onTrue} />
      );
      const trueBtn = getButtonByText(container, 'TRUE');
      expect(trueBtn).not.toBeNull();
      fireEvent.click(trueBtn!);
      expect(onTrue).toHaveBeenCalledOnce();
    });
  });

  describe('LAST_CHANCE phase', () => {
    it('shows Pass button when player is the last chance caller', () => {
      const { container } = render(
        <ActionButtons
          {...defaultProps}
          roundPhase={RoundPhase.LAST_CHANCE}
          isLastChanceCaller={true}
        />
      );
      expect(getButtonByText(container, 'Pass')).not.toBeNull();
    });

    it('does not show BULL or TRUE buttons for the last chance caller', () => {
      const { container } = render(
        <ActionButtons
          {...defaultProps}
          roundPhase={RoundPhase.LAST_CHANCE}
          isLastChanceCaller={true}
        />
      );
      expect(getButtonByText(container, 'BULL!')).toBeNull();
      expect(getButtonByText(container, 'TRUE')).toBeNull();
    });

    it('fires onLastChancePass when Pass button is clicked', () => {
      const onLastChancePass = vi.fn();
      const { container } = render(
        <ActionButtons
          {...defaultProps}
          roundPhase={RoundPhase.LAST_CHANCE}
          isLastChanceCaller={true}
          onLastChancePass={onLastChancePass}
        />
      );
      const passBtn = getButtonByText(container, 'Pass');
      expect(passBtn).not.toBeNull();
      fireEvent.click(passBtn!);
      expect(onLastChancePass).toHaveBeenCalledOnce();
    });

    it('renders nothing when player is not the last chance caller and no hand/bull conditions met', () => {
      const { container } = render(
        <ActionButtons
          {...defaultProps}
          roundPhase={RoundPhase.LAST_CHANCE}
          isLastChanceCaller={false}
          hasCurrentHand={false}
        />
      );
      expect(container.innerHTML).toBe('');
    });
  });

  describe('RESOLVING phase', () => {
    it('renders nothing during resolving', () => {
      const { container } = render(
        <ActionButtons
          {...defaultProps}
          roundPhase={RoundPhase.RESOLVING}
        />
      );
      expect(container.innerHTML).toBe('');
    });
  });
});
