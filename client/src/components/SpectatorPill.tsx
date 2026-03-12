import { useRef, useCallback, useEffect, useState } from 'react';

interface SpectatorPillProps {
  isEliminated: boolean;
}

/**
 * Floating spectator/eliminated pill that can be dragged vertically
 * so it doesn't overlap game info.
 */
export function SpectatorPill({ isEliminated }: SpectatorPillProps) {
  const pillRef = useRef<HTMLDivElement>(null);
  const [offsetY, setOffsetY] = useState(0);
  const dragState = useRef<{ startY: number; startOffset: number } | null>(null);

  const clampY = useCallback((y: number): number => {
    const pill = pillRef.current;
    if (!pill) return y;
    const maxY = window.innerHeight - pill.offsetHeight - 4;
    return Math.max(0, Math.min(y, maxY));
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const pill = pillRef.current;
    if (!pill) return;
    pill.setPointerCapture(e.pointerId);
    dragState.current = { startY: e.clientY, startOffset: offsetY };
  }, [offsetY]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current) return;
    const dy = e.clientY - dragState.current.startY;
    setOffsetY(clampY(dragState.current.startOffset + dy));
  }, [clampY]);

  const onPointerUp = useCallback(() => {
    dragState.current = null;
  }, []);

  // Re-clamp on window resize
  useEffect(() => {
    const handler = () => setOffsetY(prev => clampY(prev));
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [clampY]);

  return (
    <div
      ref={pillRef}
      className="spectator-pill animate-fade-in"
      style={offsetY ? { top: `${4 + offsetY}px` } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {isEliminated ? 'Eliminated — Spectating' : 'Spectating'}
    </div>
  );
}
