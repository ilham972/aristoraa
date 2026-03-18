'use client';

import { useState, useEffect, useMemo } from 'react';
import { parseTimeToMinutes, getMinutesRemaining, isCurrentTimeInRange } from '@/lib/types';

interface SlotInfo {
  _id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  roomId: string;
}

export function useActiveSlot(teacherSlots: SlotInfo[] | undefined) {
  const [now, setNow] = useState(() => new Date());

  // Re-evaluate every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const result = useMemo(() => {
    if (!teacherSlots) {
      return { activeSlot: null, nextSlot: null, minutesRemaining: null, allTodaySlots: [] };
    }

    // getDay(): 0=Sun, need to convert to 1=Mon..6=Sat
    const jsDay = now.getDay();
    const dayOfWeek = jsDay === 0 ? 7 : jsDay; // 7=Sun (no classes), 1=Mon..6=Sat

    const todaySlots = teacherSlots
      .filter((s) => s.dayOfWeek === dayOfWeek)
      .sort((a, b) => parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime));

    const active = todaySlots.find((s) => isCurrentTimeInRange(s.startTime, s.endTime)) ?? null;

    const nowMins = now.getHours() * 60 + now.getMinutes();
    const upcoming = todaySlots.filter((s) => parseTimeToMinutes(s.startTime) > nowMins);
    const nextSlot = upcoming[0] ?? null;

    const minsRemaining = active ? getMinutesRemaining(active.endTime) : null;

    return {
      activeSlot: active,
      nextSlot,
      minutesRemaining: minsRemaining,
      allTodaySlots: todaySlots,
    };
  }, [teacherSlots, now]);

  return result;
}
