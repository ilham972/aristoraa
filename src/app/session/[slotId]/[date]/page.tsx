'use client';

// /session/[slotId]/[date] — the per-session workspace. Replaces the
// fullscreen attendance dialog that used to open when a Day-view card was
// tapped. Four tabs scope every workflow to this exact session:
//
//   Score      — score entry for this session's students (Phase 4)
//   Lead       — Lead dashboard filtered to this session's roster (Phase 5)
//   Sheets     — practice sheets for this session's roster (Phase 3)
//   Attendance — the old dialog body, now a tab (Phase 2, this file)
//
// Default tab is Attendance: the previous behaviour on tap-session was to
// open the attendance surface immediately, so we preserve that muscle
// memory while keeping the other three tabs one tap away.

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from 'convex/react';
import {
  Calendar,
  ChevronLeft,
  ClipboardCheck,
  ClipboardPen,
  Clock,
  FileSpreadsheet,
  Loader2,
  Radio,
} from 'lucide-react';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { groupColor } from '@/lib/groups/color';
import { fmtTime12 } from '@/lib/groups/time-grid';
import { AttendanceTab } from '@/components/session/attendance-tab';
import { SheetsTab } from '@/components/session/sheets-tab';
import { ScoreEntryWorkspace } from '@/app/score-entry/page';
import { LeadWorkspace } from '@/app/lead/page';

type Tab = 'score' | 'lead' | 'sheets' | 'attendance';

const TABS: Array<{ id: Tab; label: string; icon: typeof ClipboardPen }> = [
  { id: 'score', label: 'Score', icon: ClipboardPen },
  { id: 'lead', label: 'Lead', icon: Radio },
  { id: 'sheets', label: 'Sheets', icon: FileSpreadsheet },
  { id: 'attendance', label: 'Attendance', icon: ClipboardCheck },
];

function fmtDateLong(ymd: string): string {
  const d = new Date(ymd + 'T00:00:00');
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export default function SessionPage() {
  const params = useParams<{ slotId: string; date: string }>();
  const slotId = params.slotId as Id<'scheduleSlots'>;
  const date = params.date;

  const [tab, setTab] = useState<Tab>('attendance');

  const detail = useQuery(api.sessionRecords.sessionDetail, { slotId, date });
  const color = useMemo(() => (detail ? groupColor(detail.groupId) : null), [detail]);

  return (
    <div className="h-[calc(100svh-5rem)] flex flex-col overflow-hidden max-w-3xl mx-auto px-3 pt-3">
      {/* Page header: back, group name, date, time. */}
      <div className="shrink-0 mb-2">
        <div className="flex items-start gap-2">
          <Link
            href="/groups"
            className="shrink-0 -ml-1 p-1.5 rounded-md hover:bg-muted text-muted-foreground"
            aria-label="Back to groups"
          >
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {color && (
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: color.solid }}
                />
              )}
              <h1 className="text-base font-bold text-foreground truncate">
                {detail ? detail.groupName : <span className="opacity-50">Loading…</span>}
              </h1>
            </div>
            {detail && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                <span className="inline-flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> {fmtDateLong(detail.date)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {fmtTime12(detail.startTime)} – {fmtTime12(detail.endTime)}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tab strip. Underline-style so it fits below the page header without
          feeling like a second navigation bar. */}
      <div className="shrink-0 border-b border-border/60 mb-3">
        <div className="flex items-center gap-1 -mb-px overflow-x-auto">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors',
                  active
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <t.icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active tab body. Each tab manages its own internal scroll. */}
      <div className="flex-1 min-h-0">
        {!detail ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : tab === 'attendance' ? (
          <AttendanceTab slotId={slotId} date={date} />
        ) : tab === 'sheets' ? (
          <SheetsTab slotId={slotId} sessionDate={date} />
        ) : tab === 'score' ? (
          <ScoreEntryWorkspace lockedSlotId={slotId} lockedDate={date} />
        ) : tab === 'lead' ? (
          <LeadWorkspace lockedSlotId={slotId} lockedDate={date} />
        ) : null}
      </div>
    </div>
  );
}
