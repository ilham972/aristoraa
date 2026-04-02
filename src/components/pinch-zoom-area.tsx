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
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);
  const lastDistRef = useRef(0);
  const wasPinching = useRef(false);
  const lastTapRef = useRef(0);
  const originRef = useRef({ x: 50, y: 50 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const getDist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    const getMidpoint = (t: TouchList) => {
      const rect = el.getBoundingClientRect();
      const midX = (t[0].clientX + t[1].clientX) / 2;
      const midY = (t[0].clientY + t[1].clientY) / 2;
      // Convert to percentage relative to the content (accounting for scroll)
      const contentW = el.scrollWidth;
      const contentH = el.scrollHeight;
      const x = ((midX - rect.left + el.scrollLeft) / contentW) * 100;
      const y = ((midY - rect.top + el.scrollTop) / contentH) * 100;
      return { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        wasPinching.current = true;
        lastDistRef.current = getDist(e.touches);
        // Set transform origin to pinch midpoint
        originRef.current = getMidpoint(e.touches);
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dist = getDist(e.touches);
        if (lastDistRef.current > 0) {
          const prevScale = scaleRef.current;
          scaleRef.current = Math.min(3, Math.max(1, scaleRef.current * (dist / lastDistRef.current)));
          setScale(scaleRef.current);

          // Adjust scroll to keep pinch point centered
          if (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight) {
            const ratio = scaleRef.current / prevScale;
            const rect = el.getBoundingClientRect();
            const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
            const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
            el.scrollLeft = (el.scrollLeft + midX) * ratio - midX;
            el.scrollTop = (el.scrollTop + midY) * ratio - midY;
          }
        }
        lastDistRef.current = dist;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      lastDistRef.current = 0;

      if (e.touches.length === 0) {
        if (wasPinching.current) {
          wasPinching.current = false;
          if (scaleRef.current < 1.1) {
            scaleRef.current = 1;
            setScale(1);
            originRef.current = { x: 50, y: 50 };
          }
          return;
        }

        // Double-tap to reset zoom
        if (scaleRef.current > 1) {
          const now = Date.now();
          if (now - lastTapRef.current < 300) {
            scaleRef.current = 1;
            setScale(1);
            originRef.current = { x: 50, y: 50 };
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
    <div
      ref={containerRef}
      className={className}
      style={scale > 1 ? { overflow: 'auto' } : undefined}
    >
      <div
        ref={contentRef}
        style={{
          transformOrigin: `${originRef.current.x}% ${originRef.current.y}%`,
          transform: scale > 1 ? `scale(${scale})` : undefined,
          width: scale > 1 ? `${scale * 100}%` : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}
