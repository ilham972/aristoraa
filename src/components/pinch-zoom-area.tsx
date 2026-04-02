'use client';

import { useState, useRef, useEffect } from 'react';

export function PinchZoomArea({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const lastDistRef = useRef(0);
  const wasPinching = useRef(false);
  const lastTapRef = useRef(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const getDist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        wasPinching.current = true;
        lastDistRef.current = getDist(e.touches);
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dist = getDist(e.touches);
        if (lastDistRef.current > 0) {
          zoomRef.current = Math.min(3, Math.max(1, zoomRef.current * (dist / lastDistRef.current)));
          setZoom(zoomRef.current);
        }
        lastDistRef.current = dist;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      lastDistRef.current = 0;

      if (e.touches.length === 0) {
        if (wasPinching.current) {
          wasPinching.current = false;
          if (zoomRef.current < 1.1) {
            zoomRef.current = 1;
            setZoom(1);
          }
          return;
        }

        // Double-tap to reset zoom
        if (zoomRef.current > 1) {
          const now = Date.now();
          if (now - lastTapRef.current < 300) {
            zoomRef.current = 1;
            setZoom(1);
          }
          lastTapRef.current = now;
        }
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  return (
    <div ref={containerRef} className={className}>
      <div style={{ zoom }}>{children}</div>
    </div>
  );
}
