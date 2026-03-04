import { useRef, useEffect, useCallback, useState, memo, type ReactNode } from 'react';

interface WheelPickerProps<T> {
  items: T[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  renderItem: (item: T, isSelected: boolean) => ReactNode;
  itemHeight?: number;
  visibleCount?: number;
}

// Memoized to prevent re-renders when parent state changes but picker
// props haven't changed (e.g. hand type change doesn't affect rank picker).
function WheelPickerInner<T>({
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
  const [scrollTop, setScrollTop] = useState(selectedIndex * itemHeight);

  const padCount = Math.floor(visibleCount / 2);
  const viewportHeight = visibleCount * itemHeight;
  const centerOffset = padCount * itemHeight;

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
    setScrollTop(targetTop);
  }, [selectedIndex, itemHeight]);

  // Track which item is visually centered during scroll
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollTop / itemHeight);
    const clamped = Math.max(0, Math.min(items.length - 1, idx));
    setVisualIndex(clamped);
    setScrollTop(el.scrollTop);
  }, [itemHeight, items.length]);

  // Commit selection when scrolling stops (debounce — shorter for less friction)
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
    const onScrollEnd = () => {
      clearTimeout(timer);
      timer = window.setTimeout(commitSelection, 100);
    };
    el.addEventListener('scroll', onScrollEnd, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScrollEnd);
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
    <div className="wheel-picker-mask" style={{ height: viewportHeight, transition: 'height 0.3s ease' }}>
      {/* Center slot highlight indicator */}
      <div className="wheel-picker-center-highlight" style={{ top: centerOffset, height: itemHeight }} />
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="wheel-picker-scroll select-none"
        style={{
          height: viewportHeight,
          overflowY: 'auto',
          scrollSnapType: 'y proximity',
          overscrollBehavior: 'contain',
          perspective: '600px',
        }}
      >
        <div style={{ height: padCount * itemHeight }} />
        {items.map((item, i) => {
          // Fractional distance from center: 0 = centered, 1 = edge
          // Items start at padCount * itemHeight in scroll space; when
          // scrollTop = i * itemHeight, item i is centered in the viewport.
          const pixelDist = i * itemHeight - scrollTop;
          const maxDist = padCount * itemHeight;
          const distance = Math.min(Math.abs(pixelDist) / maxDist, 1);
          const direction = pixelDist < 0 ? -1 : 1; // -1 = above center, 1 = below

          const scale = 1 - distance * 0.2;
          const opacity = 1 - distance * 0.55;
          const rotateX = direction * distance * 12;
          const isSnapped = distance < 0.05;

          return (
            <div
              key={i}
              onClick={() => handleItemClick(i)}
              data-wheel-item={i}
              className={isSnapped ? 'wheel-item-snapped' : ''}
              style={{
                height: itemHeight,
                scrollSnapAlign: 'center',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transform: `perspective(600px) rotateX(${rotateX}deg) scale(${scale})`,
                opacity,
                transition: 'transform 0.1s ease-out, opacity 0.1s ease-out',
                willChange: 'transform, opacity',
              }}
            >
              {renderItem(item, i === visualIndex)}
            </div>
          );
        })}
        <div style={{ height: padCount * itemHeight }} />
      </div>
    </div>
  );
}

export const WheelPicker = memo(WheelPickerInner) as typeof WheelPickerInner;
