import { useRef, useEffect, useCallback, useState, type ReactNode } from 'react';

interface WheelPickerProps<T> {
  items: T[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  renderItem: (item: T, isSelected: boolean) => ReactNode;
  itemHeight?: number;
  visibleCount?: number;
}

export function WheelPicker<T>({
  items,
  selectedIndex,
  onSelect,
  renderItem,
  itemHeight = 48,
  visibleCount = 5,
}: WheelPickerProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastReportedRef = useRef(selectedIndex);
  const [visualIndex, setVisualIndex] = useState(selectedIndex);

  const padCount = Math.floor(visibleCount / 2);
  const viewportHeight = visibleCount * itemHeight;

  // Sync scroll position when selectedIndex changes (including mount)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const targetTop = selectedIndex * itemHeight;
    if (Math.abs(el.scrollTop - targetTop) > 1) {
      el.scrollTop = targetTop;
    }
    lastReportedRef.current = selectedIndex;
    setVisualIndex(selectedIndex);
  }, [selectedIndex, itemHeight]);

  // Track which item is visually centered during scroll
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollTop / itemHeight);
    const clamped = Math.max(0, Math.min(items.length - 1, idx));
    setVisualIndex(clamped);
  }, [itemHeight, items.length]);

  // Commit selection when scrolling stops (debounce)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let timer: number;
    const commitSelection = () => {
      const idx = Math.round(el.scrollTop / itemHeight);
      const clamped = Math.max(0, Math.min(items.length - 1, idx));
      if (clamped !== lastReportedRef.current) {
        lastReportedRef.current = clamped;
        onSelect(clamped);
      }
    };
    const onScroll = () => {
      clearTimeout(timer);
      timer = window.setTimeout(commitSelection, 100);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      clearTimeout(timer);
    };
  }, [itemHeight, items.length, onSelect]);

  const handleItemClick = useCallback((index: number) => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTo) {
      el.scrollTo({ top: index * itemHeight, behavior: 'smooth' });
    } else {
      el.scrollTop = index * itemHeight;
    }
    // Select immediately on tap — don't wait for scroll-end debounce
    lastReportedRef.current = index;
    setVisualIndex(index);
    onSelect(index);
  }, [itemHeight, onSelect]);

  return (
    <div className="relative overflow-hidden" style={{ height: viewportHeight }}>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="wheel-picker-scroll select-none"
        style={{
          height: viewportHeight,
          overflowY: 'auto',
          scrollSnapType: 'y mandatory',
          overscrollBehavior: 'contain',
        }}
      >
        <div style={{ height: padCount * itemHeight }} />
        {items.map((item, i) => (
          <div
            key={i}
            onClick={() => handleItemClick(i)}
            data-wheel-item={i}
            style={{
              height: itemHeight,
              scrollSnapAlign: 'center',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            {renderItem(item, i === visualIndex)}
          </div>
        ))}
        <div style={{ height: padCount * itemHeight }} />
      </div>
      {/* Center highlight */}
      <div
        className="absolute left-0 right-0 pointer-events-none"
        style={{
          top: padCount * itemHeight,
          height: itemHeight,
          borderTop: '1px solid var(--gold-dim)',
          borderBottom: '1px solid var(--gold-dim)',
          background: 'rgba(212, 168, 67, 0.06)',
        }}
      />
      {/* Fade edges */}
      <div className="absolute inset-x-0 top-0 pointer-events-none"
        style={{ height: itemHeight * 1.5, background: 'linear-gradient(to bottom, var(--felt-dark), transparent)' }} />
      <div className="absolute inset-x-0 bottom-0 pointer-events-none"
        style={{ height: itemHeight * 1.5, background: 'linear-gradient(to top, var(--felt-dark), transparent)' }} />
    </div>
  );
}
