'use client';

// /session/[slotId]/[date] — the per-session workspace. Four tabs scope
// every workflow to this exact session:
//
//   Score      — score entry for this session's students
//   Lead       — Lead dashboard filtered to this session's roster
//   Sheets     — practice sheets for this session's roster
//   Attendance — cancel-session, attendance toggles, payment entries
//
// URL query state:
//   ?tab=<id>           — preserves active tab across stepper navigation.
//                         Default 'attendance' on first visit, mirroring
//                         the old tap-session behaviour.
//   ?origin=<slot>|<ymd> — the session originally entered from /groups.
//                         Lets the Reset button jump back even after the
//                         user has stepped to other group sessions.
//
// Session stepper (header, right side): visible only when the active tab
// is Score or Sheets. Prev / Next navigate to the prev / next session of
// the SAME GROUP across all of its slots (e.g. group meeting Mon + Wed →
// next from Monday's session jumps to Wednesday). Reset returns to the
// origin session if the user has stepped away from it.

import { Suspense, useCallback, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from 'convex/react';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import { api, type Id } from '@/lib/convex';
import { groupColor } from '@/lib/groups/color';
import { fmtTime12 } from '@/lib/groups/time-grid';
import {
  SessionWorkspace,
  isSessionTab,
  type SessionTab,
} from '@/components/session/session-workspace';

const DEFAULT_TAB: SessionTab = 'attendance';
const STEPPER_TABS: SessionTab[] = ['score', 'sheets'];

function fmtDateLong(ymd: string): string {
  const d = new Date(ymd + 'T00:00:00');
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// App-wide day-of-week convention is 1=Mon..7=Sun. JS Date.getDay() is
// 0=Sun..6=Sat; shift to match.
function appDow(d: Date): number {
  const js = d.getDay();
  return js === 0 ? 7 : js;
}

type SlotLite = {
  _id: Id<'scheduleSlots'>;
  groupId?: Id<'groups'>;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
};

// Walk forward (dir=+1) or backward (dir=-1) up to ~3 weeks looking for
// another session of the same group. Same-date later/earlier slots count
// (a group can meet twice in one day), so we check the current date too.
function findAdjacentSession(
  current: { slotId: Id<'scheduleSlots'>; date: string; startTime: string; dayOfWeek: number },
  groupSlots: SlotLite[],
  dir: 1 | -1,
): { slotId: Id<'scheduleSlots'>; date: string } | null {
  // 1) Same-day, later (or earlier) slot.
  const sameDay = groupSlots
    .filter((s) => s.dayOfWeek === current.dayOfWeek && s._id !== current.slotId)
    .filter((s) =>
      dir === 1 ? s.startTime > current.startTime : s.startTime < current.startTime,
    )
    .sort((a, b) =>
      dir === 1
        ? a.startTime.localeCompare(b.startTime)
        : b.startTime.localeCompare(a.startTime),
    );
  if (sameDay.length > 0) {
    return { slotId: sameDay[0]._id, date: current.date };
  }

  // 2) Walk day-by-day in the requested direction.
  const base = new Date(current.date + 'T00:00:00');
  for (let n = 1; n <= 21; n++) {
    const probe = new Date(base);
    probe.setDate(probe.getDate() + dir * n);
    const dow = appDow(probe);
    const matches = groupSlots
      .filter((s) => s.dayOfWeek === dow)
      .sort((a, b) =>
        dir === 1
          ? a.startTime.localeCompare(b.startTime)
          : b.startTime.localeCompare(a.startTime),
      );
    if (matches.length > 0) {
      return { slotId: matches[0]._id, date: ymdLocal(probe) };
    }
  }
  return null;
}

export default function SessionPage() {
  return (
    <Suspense
      fallback={
        <div className="h-[calc(100svh-5rem)] flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <SessionPageInner />
    </Suspense>
  );
}

function SessionPageInner() {
  const params = useParams<{ slotId: string; date: string }>();
  const slotId = params.slotId as Id<'scheduleSlots'>;
  const date = params.date;

  const router = useRouter();
  const searchParams = useSearchParams();

  const tabParam = searchParams.get('tab');
  const tab: SessionTab = isSessionTab(tabParam) ? tabParam : DEFAULT_TAB;
  const originParam = searchParams.get('origin');

  // First-visit seed: stamp the URL with the entry session as origin so the
  // Reset button works after the user steps to other sessions.
  useEffect(() => {
    if (originParam) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('origin', `${slotId}|${date}`);
    if (!searchParams.get('tab')) params.set('tab', DEFAULT_TAB);
    router.replace(`?${params.toString()}`, { scroll: false });
    // We only want this on mount-with-missing-origin; deps purposefully
    // exclude `searchParams` so we don't loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originParam, slotId, date]);

  const origin = useMemo(() => {
    const src = originParam ?? `${slotId}|${date}`;
    const [oSlot, oDate] = src.split('|');
    return { slotId: oSlot as Id<'scheduleSlots'>, date: oDate };
  }, [originParam, slotId, date]);

  const offOrigin = origin.slotId !== slotId || origin.date !== date;

  const detail = useQuery(api.sessionRecords.sessionDetail, { slotId, date });
  // All slots, filtered client-side to this group's slots. Cached site-
  // wide so other pages (groups, analytics) benefit from the same query.
  const allSlots = useQuery(api.scheduleSlots.list);
  const groupSlots = useMemo<SlotLite[]>(() => {
    if (!detail || !allSlots) return [];
    return allSlots
      .filter((s): s is typeof s & { groupId: Id<'groups'> } =>
        s.groupId === detail.groupId,
      )
      .map((s) => ({
        _id: s._id as Id<'scheduleSlots'>,
        groupId: s.groupId,
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
      }));
  }, [detail, allSlots]);

  const color = useMemo(() => (detail ? groupColor(detail.groupId) : null), [detail]);

  const setTab = useCallback(
    (next: SessionTab) => {
      const p = new URLSearchParams(searchParams.toString());
      p.set('tab', next);
      router.replace(`?${p.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const navigateTo = useCallback(
    (next: { slotId: Id<'scheduleSlots'>; date: string }) => {
      // Preserve tab + origin so the user lands on the same tab and the
      // Reset button can find its way back.
      const p = new URLSearchParams();
      p.set('tab', tab);
      p.set('origin', `${origin.slotId}|${origin.date}`);
      router.push(`/session/${next.slotId}/${next.date}?${p.toString()}`);
    },
    [router, tab, origin.slotId, origin.date],
  );

  const stepperVisible = STEPPER_TABS.includes(tab);
  const currentDow = useMemo(() => appDow(new Date(date + 'T00:00:00')), [date]);
  const prev = useMemo(() => {
    if (!detail || groupSlots.length === 0) return null;
    return findAdjacentSession(
      { slotId, date, startTime: detail.startTime, dayOfWeek: currentDow },
      groupSlots,
      -1,
    );
  }, [detail, groupSlots, slotId, date, currentDow]);
  const next = useMemo(() => {
    if (!detail || groupSlots.length === 0) return null;
    return findAdjacentSession(
      { slotId, date, startTime: detail.startTime, dayOfWeek: currentDow },
      groupSlots,
      +1,
    );
  }, [detail, groupSlots, slotId, date, currentDow]);

  return (
    <div className="h-[calc(100svh-5rem)] flex flex-col overflow-hidden max-w-3xl mx-auto px-3 pt-3">
      {/* Page header: back arrow, group name + date/time, session stepper. */}
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
          {stepperVisible && (
            <SessionStepper
              prev={prev}
              next={next}
              offOrigin={offOrigin}
              onPrev={() => prev && navigateTo(prev)}
              onNext={() => next && navigateTo(next)}
              onReset={() => navigateTo({ slotId: origin.slotId, date: origin.date })}
            />
          )}
        </div>
      </div>

      {/* Shared 4-tab workspace. The bodies own their own loading states,
          so we no longer gate them on `detail` — the header above shows the
          loading placeholder for the group name. */}
      <SessionWorkspace slotId={slotId} date={date} tab={tab} onTabChange={setTab} />
    </div>
  );
}

function SessionStepper({
  prev,
  next,
  offOrigin,
  onPrev,
  onNext,
  onReset,
}: {
  prev: { slotId: Id<'scheduleSlots'>; date: string } | null;
  next: { slotId: Id<'scheduleSlots'>; date: string } | null;
  offOrigin: boolean;
  onPrev: () => void;
  onNext: () => void;
  onReset: () => void;
}) {
  return (
    <div className="shrink-0 flex items-center gap-0.5">
      <button
        onClick={onPrev}
        disabled={!prev}
        className="p-1.5 rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent"
        aria-label="Previous group session"
        title="Previous group session"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <button
        onClick={onNext}
        disabled={!next}
        className="p-1.5 rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent"
        aria-label="Next group session"
        title="Next group session"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
      {offOrigin && (
        <button
          onClick={onReset}
          className="ml-0.5 inline-flex items-center gap-1 px-1.5 py-1 rounded-md text-[10px] font-semibold text-primary hover:bg-primary/10"
          aria-label="Reset to original session"
          title="Reset to original session"
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
