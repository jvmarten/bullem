import { useRef, useEffect, useCallback, useState, memo, type ReactNode } from 'react';

interface WheelPickerProps<T> {
  items: T[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  renderItem: (item: T, isSelected: boolean) => ReactNode;
  itemHeight?: number;
  visibleCount?: number;
  highlightHeight?: number;
  /** Minimum selectable index — scroll/click/wheel are clamped to this floor. */
  minIndex?: number;
  onTickSound?: () => void;
  onSelectSound?: () => void;
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
  highlightHeight,
  minIndex = 0,
  onTickSound,
  onSelectSound,
}: WheelPickerProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastReportedRef = useRef(selectedIndex);
  const lastTickIndexRef = useRef(selectedIndex);
  const lastTickTimeRef = useRef(0);
  const isProgrammaticRef = useRef(false);
  const mountedRef = useRef(false);
  const [visualIndex, setVisualIndex] = useState(selectedIndex);
  // Store scrollTop in a ref instead of React state — the 3D transforms for
  // each item are applied via direct DOM manipulation in updateItemTransforms(),
  // avoiding a full React re-render on every scroll pixel. Previously, storing
  // scrollTop as state caused 60fps React reconciliation of all items (9+ hand
  // types or 13 ranks) during touch scrolling, which was the biggest source of
  // jank in the HandSelector.
  const scrollTopRef = useRef(selectedIndex * itemHeight);
  /** Refs to each item wrapper for direct DOM transform updates. */
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  const padCount = Math.floor(visibleCount / 2);
  const viewportHeight = visibleCount * itemHeight;
  const centerOffset = padCount * itemHeight;

  /** Apply 3D perspective transforms to all items based on current scroll position.
   *  Uses direct DOM manipulation — no React state, no re-renders. */
  const updateItemTransforms = useCallback(() => {
    const currentScrollTop = scrollTopRef.current;
    const maxDist = padCount * itemHeight;
    for (let i = 0; i < itemRefs.current.length; i++) {
      const el = itemRefs.current[i];
      if (!el) continue;
      const pixelDist = i * itemHeight - currentScrollTop;
      const distance = Math.min(Math.abs(pixelDist) / maxDist, 1);
      const direction = pixelDist < 0 ? -1 : 1;

      const scale = 1 - distance * 0.2;
      const opacity = 1 - distance * 0.55;
      const rotateX = direction * distance * 12;

      el.style.transform = `perspective(600px) rotateX(${rotateX}deg) scale(${scale})`;
      el.style.opacity = String(opacity);

      const isSnapped = distance < 0.05;
      if (isSnapped) {
        el.classList.add('wheel-item-snapped');
      } else {
        el.classList.remove('wheel-item-snapped');
      }
    }
  }, [padCount, itemHeight]);

  // Sync scroll position when selectedIndex changes (including mount).
  // Flag as programmatic so scroll-triggered sounds are suppressed.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const targetTop = selectedIndex * itemHeight;
    isProgrammaticRef.current = true;
    if (Math.abs(el.scrollTop - targetTop) > 1) {
      // Smooth-scroll on programmatic repositions; instant on first mount
      if (mountedRef.current && el.scrollTo) {
        el.scrollTo({ top: targetTop, behavior: 'smooth' });
      } else {
        el.scrollTop = targetTop;
      }
    }
    mountedRef.current = true;
    lastReportedRef.current = selectedIndex;
    lastTickIndexRef.current = selectedIndex;
    setVisualIndex(selectedIndex);
    scrollTopRef.current = targetTop;
    updateItemTransforms();
    // Keep programmatic flag set long enough to cover smooth-scroll duration
    // (~300ms). Using requestAnimationFrame alone (~16ms) cleared too early,
    // causing scroll events from the ongoing animation to play tick sounds.
    const timer = window.setTimeout(() => { isProgrammaticRef.current = false; }, 400);
    return () => clearTimeout(timer);
  }, [selectedIndex, itemHeight, updateItemTransforms]);

  // Apply transforms after mount and whenever items change
  useEffect(() => {
    updateItemTransforms();
  }, [items.length, updateItemTransforms]);

  // Track which item is visually centered during scroll
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollTop / itemHeight);
    const clamped = Math.max(minIndex, Math.min(items.length - 1, idx));

    // Bounce back if user scrolled past the minimum selectable item
    if (clamped !== idx && !isProgrammaticRef.current) {
      el.scrollTo({ top: clamped * itemHeight, behavior: 'smooth' });
    }

    // Play tick when a new item crosses the center, throttled to ~60ms.
    // Skip if scroll was triggered programmatically (e.g. selectedIndex prop change).
    if (clamped !== lastTickIndexRef.current && onTickSound && !isProgrammaticRef.current) {
      const now = performance.now();
      if (now - lastTickTimeRef.current >= 60) {
        lastTickTimeRef.current = now;
        onTickSound();
      }
    }
    lastTickIndexRef.current = clamped;
    setVisualIndex(clamped);
    // Update scrollTop ref and apply transforms directly — no React state update
    scrollTopRef.current = el.scrollTop;
    updateItemTransforms();
  }, [itemHeight, items.length, minIndex, onTickSound, updateItemTransforms]);

  // Commit selection when scrolling stops (debounce — shorter for less friction)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let timer: number;
    const commitSelection = () => {
      if (isProgrammaticRef.current) return;
      const idx = Math.round(el.scrollTop / itemHeight);
      const clamped = Math.max(minIndex, Math.min(items.length - 1, idx));
      if (clamped !== lastReportedRef.current) {
        lastReportedRef.current = clamped;
        onSelect(clamped);
        onSelectSound?.();
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
  }, [itemHeight, items.length, minIndex, onSelect, onSelectSound]);

  // Normalize mouse wheel to scroll exactly one item per tick on desktop.
  // Without this, a single wheel notch scrolls more than itemHeight, skipping items.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const direction = e.deltaY > 0 ? 1 : -1;
      const currentIdx = Math.round(el.scrollTop / itemHeight);
      const targetIdx = Math.max(minIndex, Math.min(items.length - 1, currentIdx + direction));
      el.scrollTo({ top: targetIdx * itemHeight, behavior: 'smooth' });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [itemHeight, items.length, minIndex]);

  const handleItemClick = useCallback((index: number) => {
    // Ignore taps on items below the minimum selectable index
    if (index < minIndex) return;
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
    onSelectSound?.();
  }, [itemHeight, minIndex, onSelect, onSelectSound]);

  return (
    <div className="wheel-picker-mask" style={{ height: viewportHeight, transition: 'height 0.3s ease' }}>
      {/* Center slot highlight indicator */}
      <div className="wheel-picker-center-highlight" style={{
        height: highlightHeight ?? itemHeight,
        top: centerOffset + (itemHeight - (highlightHeight ?? itemHeight)) / 2,
      }} />
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
        {items.map((item, i) => (
          <div
            key={i}
            ref={el => { itemRefs.current[i] = el; }}
            onClick={() => handleItemClick(i)}
            data-wheel-item={i}
            style={{
              height: itemHeight,
              scrollSnapAlign: 'center',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'transform 0.1s ease-out, opacity 0.1s ease-out',
              willChange: 'transform, opacity',
            }}
          >
            {renderItem(item, i === visualIndex)}
          </div>
        ))}
        <div style={{ height: padCount * itemHeight }} />
      </div>
    </div>
  );
}

export const WheelPicker = memo(WheelPickerInner) as typeof WheelPickerInner;
