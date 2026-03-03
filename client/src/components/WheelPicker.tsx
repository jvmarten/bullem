import { useRef, useEffect, useCallback, useState, type ReactNode } from 'react';

const FRICTION = 0.92;
const MIN_VELOCITY = 0.3;
const SNAP_STIFFNESS = 0.18;

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
  itemHeight = 34,
  visibleCount = 5,
}: WheelPickerProps<T>) {
  const offsetRef = useRef(-selectedIndex * itemHeight);
  const velocityRef = useRef(0);
  const animFrameRef = useRef(0);
  const isDraggingRef = useRef(false);
  const touchStartRef = useRef({ y: 0, time: 0, offset: 0 });
  const lastTouchRef = useRef({ y: 0, time: 0 });
  const [, forceRender] = useState(0);
  const rerender = useCallback(() => forceRender(n => n + 1), []);

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
    offsetRef.current = touchStartRef.current.offset + (y - touchStartRef.current.y);
    const now = Date.now();
    const dt = now - lastTouchRef.current.time;
    if (dt > 0) velocityRef.current = ((y - lastTouchRef.current.y) / dt) * 16;
    lastTouchRef.current = { y, time: now };
    rerender();
  }, [rerender]);

  const handleTouchEnd = useCallback(() => {
    isDraggingRef.current = false;
    startMomentum();
  }, [startMomentum]);

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
      offsetRef.current = touchStartRef.current.offset + (my - touchStartRef.current.y);
      const now = Date.now();
      const dt = now - lastTouchRef.current.time;
      if (dt > 0) velocityRef.current = ((my - lastTouchRef.current.y) / dt) * 16;
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

  const handleItemClick = useCallback(
    (index: number) => {
      if (isDraggingRef.current) return;
      onSelect(index);
      snapToIndex(index);
    },
    [onSelect, snapToIndex],
  );

  useEffect(() => () => cancelAnimationFrame(animFrameRef.current), []);

  const viewportHeight = visibleCount * itemHeight;
  const centerOffset = Math.floor(visibleCount / 2) * itemHeight;
  const currentSelected = getIndexFromOffset(offsetRef.current);

  return (
    <div
      className="relative overflow-hidden select-none"
      style={{ height: viewportHeight, touchAction: 'none' }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onMouseDown={handleMouseDown}
    >
      <div style={{ transform: `translateY(${offsetRef.current + centerOffset}px)` }}>
        {items.map((item, i) => (
          <div
            key={i}
            onClick={() => handleItemClick(i)}
            className="flex items-center justify-center"
            style={{ height: itemHeight, zIndex: i === currentSelected ? 10 : 0 }}
          >
            {renderItem(item, i === currentSelected)}
          </div>
        ))}
      </div>
    </div>
  );
}
