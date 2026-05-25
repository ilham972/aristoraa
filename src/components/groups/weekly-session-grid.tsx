'use client';

// The tap-to-toggle weekly session picker shown inside the Edit-Group
// drawer. 7 day columns × hourly rows. Rows are the union of weekend bands
// (8–12 + 3–10); on weekday columns the morning rows are disabled. A cell is
// "on" when this group owns a session at that (day, band). Conflict overlays:
//   red ring   → mentor already teaching another group then
//   amber ring → a member already booked in another group then

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  DAYS,
  WEEKEND_BANDS,
  type DayNum,
  type HourBand,
} from '@/lib/groups/time-grid';
import type { GroupColor } from '@/lib/groups/color';

type Conflict = { dayOfWeek: number; startTime: string; endTime: string };

export type SessionCell = { dayOfWeek: number; startTime: string; endTime: string };

function overlaps(a: Conflict, day: number, b: HourBand): boolean {
  return a.dayOfWeek === day && a.startTime < b.end && a.endTime > b.start;
}

export function WeeklySessionGrid({
  selected,
  color,
  mentorBusy,
  studentBusy,
  onToggle,
}: {
  selected: SessionCell[];
  color: GroupColor;
  mentorBusy: Conflict[];
  studentBusy: Conflict[];
  onToggle: (day: DayNum, band: HourBand) => void;
}) {
  // Union of rows = weekend bands (superset). Insert a visual gap marker
  // between the morning block (ends 12:00) and the afternoon block.
  const rows = WEEKEND_BANDS;
  // Overlap-aware: a multi-hour session marks every band it covers as "on".
  const selectedByDay = useMemo(() => {
    const m = new Map<number, SessionCell[]>();
    for (const s of selected) {
      const arr = m.get(s.dayOfWeek) ?? [];
      arr.push(s);
      m.set(s.dayOfWeek, arr);
    }
    return m;
  }, [selected]);
  const isOn = (day: number, b: HourBand): boolean =>
    (selectedByDay.get(day) ?? []).some((s) => s.startTime < b.end && s.endTime > b.start);

  // Row label = band.label minus the AM/PM suffix; the dialog's tight grid
  // doesn't have room for it and the column already implies the day.
  const shortLabel = (label: string) => label.replace(/[AP]$/, '');

  return (
    <div className="w-full">
      <table className="w-full border-separate border-spacing-[2px] table-fixed">
        <colgroup>
          <col className="w-7" />
          {DAYS.map((d) => <col key={d.num} />)}
        </colgroup>
        <thead>
          <tr>
            <th />
            {DAYS.map((d) => (
              <th
                key={d.num}
                className="text-[10px] font-semibold text-muted-foreground pb-1"
              >
                {d.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((band, ri) => {
            const prev = rows[ri - 1];
            const isAfterGap = prev && prev.end === '12:00' && band.start === '15:00';
            return (
              <tr key={band.start} className={cn(isAfterGap && '[&>td]:pt-1.5 [&>th]:pt-1.5')}>
                <th className="text-[9px] font-medium text-muted-foreground/70 text-right pr-1 whitespace-nowrap">
                  {shortLabel(band.label)}
                </th>
                {DAYS.map((d) => {
                  const isWeekend = d.weekend;
                  const isMorning = band.start < '12:00';
                  const disabled = !isWeekend && isMorning;
                  const on = isOn(d.num, band);
                  const mentorHit = mentorBusy.some((c) => overlaps(c, d.num, band));
                  const studentHit = studentBusy.some((c) => overlaps(c, d.num, band));

                  return (
                    <td key={d.num}>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onToggle(d.num, band)}
                        className={cn(
                          'w-full h-6 rounded text-[9px] font-medium flex items-center justify-center',
                          disabled && 'opacity-20 cursor-not-allowed bg-muted',
                          !disabled && !on && 'bg-muted/50 hover:bg-muted text-muted-foreground',
                          !disabled && (mentorHit || studentHit) && !on &&
                            (mentorHit
                              ? 'ring-1 ring-inset ring-destructive/60'
                              : 'ring-1 ring-inset ring-amber-500/60'),
                        )}
                        style={on ? { backgroundColor: color.solid, color: color.onSolid } : undefined}
                        title={
                          mentorHit
                            ? 'Mentor busy'
                            : studentHit
                              ? 'A member is booked elsewhere'
                              : undefined
                        }
                      >
                        {on ? '●' : ''}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
