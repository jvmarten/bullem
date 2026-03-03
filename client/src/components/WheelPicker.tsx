import { useRef, useEffect, useCallback, useState, type ReactNode } from 'react';

const ITEM_HEIGHT = 48;
const VISIBLE_COUNT = 5;
const FRICTION = 0.92;
const MIN_VELOCITY = 0.3;
const SNAP_STIFFNESS = 0.18;

interface WheelPickerProps<T> {
  items: T[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  renderItem: (item: T, isSelected: boolean) => ReactNode;
  itemHeight?: number;
}

export function WheelPicker<T>({
  items,
  selectedIndex,
  onSelect,
  renderItem,
  itemHeight = ITEM_HEIGHT,
}: WheelPickerProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(-selectedIndex * itemHeight);
  const velocityRef = useRef(0);
  const animFrameRef = useRef(0);
  const isDraggingRef = useRef(false);
  const touchStartRef = useRef({ y: 0, time: 0, offset: 0 });
  const lastTouchRef = useRef({ y: 0, time: 0 });
  const [, forceRender] = useState(0);
  const rerender = useCallback(() => forceRender(n => n + 1), []);

  // Sync offset when selectedIndex changes externally
  useEffect(() => {
    if (!isDraggingRef.current) {
      offsetRef.current = -selectedIndex * itemHeight;
      rerender();
    }
  }, [selectedIndex, itemHeight, rerender]);

  const clampIndex = useCallback(
    (idx: number) => Math.max(0, Math.min(items.length - 1, idx)),
    [items.length],
  );

  const getIndexFromOffset = useCallback(
    (offset: number) => clampIndex(Math.round(-offset / itemHeight)),
    [clampIndex, itemHeight],
  );

  const snapToIndex = useCallback(
    (idx: number) => {
      const target = -idx * itemHeight;
      const animate = () => {
        const diff = target - offsetRef.current;
        if (Math.abs(diff) < 0.5) {
          offsetRef.current = target;
          rerender();
          return;
        }
        offsetRef.current += diff * SNAP_STIFFNESS;
        rerender();
        animFrameRef.current = requestAnimationFrame(animate);
      };
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = requestAnimationFrame(animate);
    },
    [itemHeight, rerender],
  );

  const startMomentum = useCallback(() => {
    const animate = () => {
      velocityRef.current *= FRICTION;
      if (Math.abs(velocityRef.current) < MIN_VELOCITY) {
        const idx = getIndexFromOffset(offsetRef.current);
        onSelect(idx);
        snapToIndex(idx);
        return;
      }
      offsetRef.current += velocityRef.current;
      // Clamp to bounds with rubber-band feel
      const minOffset = -(items.length - 1) * itemHeight;
      if (offsetRef.current > 0) {
        offsetRef.current = 0;
        velocityRef.current = 0;
        onSelect(0);
        snapToIndex(0);
        return;
      }
      if (offsetRef.current < minOffset) {
        offsetRef.current = minOffset;
        velocityRef.current = 0;
        onSelect(items.length - 1);
        snapToIndex(items.length - 1);
        return;
      }
      rerender();
      animFrameRef.current = requestAnimationFrame(animate);
    };
    cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = requestAnimationFrame(animate);
  }, [items.length, itemHeight, getIndexFromOffset, onSelect, snapToIndex, rerender]);

  // Touch handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    cancelAnimationFrame(animFrameRef.current);
    velocityRef.current = 0;
    isDraggingRef.current = true;
    const y = e.touches[0].clientY;
    touchStartRef.current = { y, time: Date.now(), offset: offsetRef.current };
    lastTouchRef.current = { y, time: Date.now() };
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDraggingRef.current) return;
    e.preventDefault();
    const y = e.touches[0].clientY;
    const dy = y - touchStartRef.current.y;
    offsetRef.current = touchStartRef.current.offset + dy;

    const now = Date.now();
    const dt = now - lastTouchRef.current.time;
    if (dt > 0) {
      velocityRef.current = ((y - lastTouchRef.current.y) / dt) * 16;
    }
    lastTouchRef.current = { y, time: now };
    rerender();
  }, [rerender]);

  const handleTouchEnd = useCallback(() => {
    isDraggingRef.current = false;
    startMomentum();
  }, [startMomentum]);

  // Mouse drag handlers (for desktop)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    cancelAnimationFrame(animFrameRef.current);
    velocityRef.current = 0;
    isDraggingRef.current = true;
    const y = e.clientY;
    touchStartRef.current = { y, time: Date.now(), offset: offsetRef.current };
    lastTouchRef.current = { y, time: Date.now() };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current) return;
      ev.preventDefault();
      const my = ev.clientY;
      const dy = my - touchStartRef.current.y;
      offsetRef.current = touchStartRef.current.offset + dy;
      const now = Date.now();
      const dt = now - lastTouchRef.current.time;
      if (dt > 0) {
        velocityRef.current = ((my - lastTouchRef.current.y) / dt) * 16;
      }
      lastTouchRef.current = { y: my, time: now };
      rerender();
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      startMomentum();
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [startMomentum, rerender]);

  // Click to select item
  const handleItemClick = useCallback(
    (index: number) => {
      if (isDraggingRef.current) return;
      onSelect(index);
      snapToIndex(index);
    },
    [onSelect, snapToIndex],
  );

  // Cleanup
  useEffect(() => {
    return () => cancelAnimationFrame(animFrameRef.current);
  }, []);

  const viewportHeight = VISIBLE_COUNT * itemHeight;
  const centerOffset = Math.floor(VISIBLE_COUNT / 2) * itemHeight;

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden select-none cursor-grab active:cursor-grabbing"
      style={{ height: viewportHeight, touchAction: 'none' }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onMouseDown={handleMouseDown}
    >
      <div
        style={{
          transform: `translateY(${offsetRef.current + centerOffset}px)`,
        }}
      >
        {items.map((item, i) => {
          const distancePx = offsetRef.current + i * itemHeight;
          const distance = Math.abs(distancePx) / itemHeight;
          const opacity = Math.max(0.15, 1 - distance * 0.3);
          const scale = Math.max(0.75, 1 - distance * 0.08);
          const isSelected = i === getIndexFromOffset(offsetRef.current);

          return (
            <div
              key={i}
              onClick={() => handleItemClick(i)}
              style={{
                height: itemHeight,
                opacity,
                transform: `scale(${scale})`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: isDraggingRef.current ? 'none' : 'opacity 0.1s ease',
              }}
            >
              {renderItem(item, isSelected)}
            </div>
          );
        })}
      </div>
      {/* Center highlight */}
      <div
        className="absolute left-0 right-0 pointer-events-none"
        style={{
          top: centerOffset,
          height: itemHeight,
          borderTop: '1px solid var(--gold-dim)',
          borderBottom: '1px solid var(--gold-dim)',
          background: 'rgba(212, 168, 67, 0.06)',
        }}
      />
      {/* Fade edges */}
      <div className="absolute inset-x-0 top-0 h-12 pointer-events-none" style={{ background: 'linear-gradient(to bottom, var(--felt-dark), transparent)' }} />
      <div className="absolute inset-x-0 bottom-0 h-12 pointer-events-none" style={{ background: 'linear-gradient(to top, var(--felt-dark), transparent)' }} />
    </div>
  );
}
