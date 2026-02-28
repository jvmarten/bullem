import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { CardDisplay } from './CardDisplay.js';
import type { Card } from '@bull-em/shared';

afterEach(() => {
  cleanup();
});

describe('CardDisplay', () => {
  const heartCard: Card = { rank: 'K', suit: 'hearts' };
  const diamondCard: Card = { rank: 'A', suit: 'diamonds' };
  const spadeCard: Card = { rank: '10', suit: 'spades' };
  const clubCard: Card = { rank: '2', suit: 'clubs' };

  describe('suit symbols', () => {
    it('renders heart symbol for hearts', () => {
      const { container } = render(<CardDisplay card={heartCard} />);
      expect(container.textContent).toContain('\u2665');
    });

    it('renders diamond symbol for diamonds', () => {
      const { container } = render(<CardDisplay card={diamondCard} />);
      expect(container.textContent).toContain('\u2666');
    });

    it('renders spade symbol for spades', () => {
      const { container } = render(<CardDisplay card={spadeCard} />);
      expect(container.textContent).toContain('\u2660');
    });

    it('renders club symbol for clubs', () => {
      const { container } = render(<CardDisplay card={clubCard} />);
      expect(container.textContent).toContain('\u2663');
    });
  });

  describe('suit colors', () => {
    it('renders hearts in red', () => {
      const { container } = render(<CardDisplay card={heartCard} />);
      const suitSpans = container.querySelectorAll('.suit-red');
      expect(suitSpans.length).toBeGreaterThan(0);
    });

    it('renders diamonds in red', () => {
      const { container } = render(<CardDisplay card={diamondCard} />);
      const suitSpans = container.querySelectorAll('.suit-red');
      expect(suitSpans.length).toBeGreaterThan(0);
    });

    it('renders spades in black', () => {
      const { container } = render(<CardDisplay card={spadeCard} />);
      const suitSpans = container.querySelectorAll('.suit-black');
      expect(suitSpans.length).toBeGreaterThan(0);
    });

    it('renders clubs in black', () => {
      const { container } = render(<CardDisplay card={clubCard} />);
      const suitSpans = container.querySelectorAll('.suit-black');
      expect(suitSpans.length).toBeGreaterThan(0);
    });
  });

  describe('rank display', () => {
    it('renders number ranks correctly', () => {
      const { container } = render(<CardDisplay card={spadeCard} />);
      expect(container.textContent).toContain('10');
    });

    it('renders face card ranks correctly', () => {
      const { container } = render(<CardDisplay card={heartCard} />);
      expect(container.textContent).toContain('K');
    });

    it('renders ace correctly', () => {
      const { container } = render(<CardDisplay card={diamondCard} />);
      expect(container.textContent).toContain('A');
    });

    it('renders low rank correctly', () => {
      const { container } = render(<CardDisplay card={clubCard} />);
      expect(container.textContent).toContain('2');
    });
  });

  describe('size variants', () => {
    it('renders default (large) variant with playing-card class', () => {
      const { container } = render(<CardDisplay card={heartCard} />);
      expect(container.querySelector('.playing-card')).not.toBeNull();
      expect(container.querySelector('.playing-card-small')).toBeNull();
    });

    it('renders small variant with playing-card-small class', () => {
      const { container } = render(<CardDisplay card={heartCard} small />);
      expect(container.querySelector('.playing-card-small')).not.toBeNull();
      expect(container.querySelector('.playing-card')).toBeNull();
    });

    it('small variant renders rank and suit', () => {
      const { container } = render(<CardDisplay card={heartCard} small />);
      expect(container.textContent).toContain('K');
      expect(container.textContent).toContain('\u2665');
    });

    it('small variant uses correct suit color', () => {
      const { container } = render(<CardDisplay card={heartCard} small />);
      const redSpans = container.querySelectorAll('.suit-red');
      expect(redSpans.length).toBeGreaterThan(0);
    });
  });

  describe('custom className', () => {
    it('applies custom className to default variant', () => {
      const { container } = render(<CardDisplay card={heartCard} className="my-custom-class" />);
      expect(container.querySelector('.my-custom-class')).not.toBeNull();
    });

    it('applies custom className to small variant', () => {
      const { container } = render(<CardDisplay card={heartCard} small className="my-custom-class" />);
      expect(container.querySelector('.my-custom-class')).not.toBeNull();
    });
  });
});
