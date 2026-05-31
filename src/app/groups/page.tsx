'use client';

// /groups — the app home. Day view is the primary surface (tap a session
// to enter the per-session page), with a Week toggle for timetable layout.
// Revenue and Attendance analytics moved to /analytics in Phase 1 of the
// session-page refactor.

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from 'convex/react';
import { toast } from 'sonner';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  LayoutGrid,
  MoreVertical,
  UserMinus,
  UserPlus,
  UserRoundX,
  Users,
  XCircle,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import {
  DAYS,
  fmtLKR,
  fmtTime12,
  type HourBand,
} from '@/lib/groups/time-grid';
import { WeekGrid } from '@/components/groups/week-grid';
import { EditGroupDialog } from '@/components/groups/edit-group-dialog';
import { CancelDaySheet } from '@/components/groups/cancel-day-sheet';
import { SessionLauncher } from '@/components/groups/session-launcher';

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayYmd(): string {
  return ymd(new Date());
}

// Monday of the week containing `dateYmd`. dayOfWeek uses 1=Mon..7=Sun
// throughout this app, so we shift JS getDay()=0..6 accordingly.
function mondayOf(dateYmd: string): string {
  const d = new Date(dateYmd + 'T00:00:00');
  const js = d.getDay();
  const offset = js === 0 ? -6 : 1 - js; // Sun → −6, Mon → 0, Tue → −1 …
  d.setDate(d.getDate() + offset);
  return ymd(d);
}

function addDays(dateYmd: string, n: number): string {
  const d = new Date(dateYmd + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export default function GroupsPage() {
  const router = useRouter();
  const [view, setView] = useState<'week' | 'day' | 'session'>('day');
  const [editingGroup, setEditingGroup] = useState<Id<'groups'> | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [unassignedOpen, setUnassignedOpen] = useState(false);

  // Day view is date-aware (the only date-aware surface in /groups). The
  // Week-grid view stays purely a standard timetable as the user asked.
  // selectedDate defaults to today; weekStartYmd is always the Monday of
  // the selectedDate's week so the pill row scrolls with it.
  const today = todayYmd();
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const weekStartYmd = mondayOf(selectedDate);

  const week = useQuery(api.groups.weekGrid);
  const rooms = useQuery(api.rooms.list);
  // Prefetch the dialog's reference lists at the page level so they're
  // already in the Convex cache when the user opens a group editor.
  // Students are not prefetched here — the dialog now uses a server-filtered
  // candidateStudents query so the full list never needs to ship to the
  // client.
  useQuery(api.teachers.list);
  useQuery(api.centers.list);
  const weekSessions = useQuery(
    api.sessionRecords.weekSessions,
    view === 'day' ? { weekStartDate: weekStartYmd } : 'skip',
  );
  const exceptions = useQuery(api.groups.overridesForDate, { date: today });
  // Only fetched when the Week view is up — Day view doesn't surface the pill.
  const assignmentSummary = useQuery(
    api.groups.studentAssignmentSummary,
    view === 'week' ? {} : 'skip',
  );
  const unassigned = assignmentSummary?.unassigned ?? [];

  const createGroup = useMutation(api.groups.create);
  const toggleSession = useMutation(api.groups.toggleSession);

  const openEditor = (groupId: Id<'groups'>) => {
    setEditingGroup(groupId);
    setDrawerOpen(true);
  };

  // Create a group; if exactly one room exists, set it as default + drop the
  // first session immediately so an empty-cell tap is one action.
  const handleCreate = async (seed?: { dayOfWeek: number; band: HourBand }) => {
    const onlyRoom = rooms && rooms.length === 1 ? rooms[0]._id : undefined;
    const id = await createGroup({ name: 'new_group', autoName: true, defaultRoomId: onlyRoom });
    if (seed && onlyRoom) {
      try {
        await toggleSession({
          groupId: id,
          dayOfWeek: seed.dayOfWeek,
          startTime: seed.band.start,
          endTime: seed.band.end,
        });
      } catch {
        /* room collision — user resolves in the editor */
      }
    }
    openEditor(id);
    if (!onlyRoom) toast('Pick a default room, then add sessions');
  };

  // Page-level loading mirrors the week-grid availability; the Revenue tab
  // owns its own loading via api.groups.revenueInsights so the toggle stays
  // responsive when the user lands on Revenue first.
  const loading = week === undefined;
  const hasGroups = (week?.groups.length ?? 0) > 0;

  // Fixed-height page: only the active sub-view's overflow region scrolls
  // vertically (the DayList session list). Week-grid scrolls horizontally
  // only — vertical sizing fits the viewport so the user never has to
  // scroll up/down while browsing slots. Calc subtracts the bottom-nav
  // padding (5rem) applied by AuthLayout's <main>.
  return (
    <div className="h-[calc(100svh-5rem)] flex flex-col overflow-hidden max-w-3xl mx-auto px-3 pt-3">
      {/* Today's exceptions — shown when present. */}
      {exceptions && exceptions.length > 0 && (
        <div className="shrink-0 rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-1.5 mb-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] text-amber-600 uppercase tracking-wider font-semibold">
              Today
            </span>
            {exceptions.map((o) => (
              <span
                key={o._id}
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-card border border-border/60"
              >
                {o.action === 'remove' ? (
                  <UserMinus className="w-3 h-3 text-destructive" />
                ) : (
                  <UserPlus className="w-3 h-3 text-primary" />
                )}
                <ExceptionStudent studentId={o.studentId} />
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Day/Week toggle — Day is the primary view, listed first. Revenue &
          Attendance live on /analytics, not here. Tap an empty Week-grid cell
          to create a group, so no "+ New" button. */}
      <div className="shrink-0 flex items-center gap-2 mb-2">
        <div className="flex items-center gap-1 p-1 bg-muted rounded-xl w-fit">
          <button
            onClick={() => setView('day')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
              view === 'day' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
            )}
          >
            <CalendarDays className="w-3.5 h-3.5" /> Day
          </button>
          <button
            onClick={() => setView('week')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
              view === 'week' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
            )}
          >
            <LayoutGrid className="w-3.5 h-3.5" /> Week
          </button>
          <button
            onClick={() => setView('session')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
              view === 'session' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
            )}
          >
            <Clock className="w-3.5 h-3.5" /> Session
          </button>
        </div>

        {/* Right-side roster strip — Week view only.
              • "in groups" pill is always shown so the Lead has a constant
                read on coverage (X of Y students placed).
              • Amber alert appears next to it when ≥ 1 student is in no
                group; tap to see who. */}
        {view === 'week' && assignmentSummary && (
          <div className="ml-auto flex items-center gap-1.5">
            <span
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-muted text-muted-foreground text-[10px] font-medium tabular-nums"
              title="Unique students in at least one group"
            >
              <Users className="w-3 h-3" />
              <span>
                <span className="text-foreground">{assignmentSummary.assignedCount}</span>
                <span className="opacity-60"> / {assignmentSummary.totalCount}</span>
              </span>
              <span className="hidden sm:inline">in groups</span>
            </span>
            {assignmentSummary.unassigned.length > 0 && (
              <button
                onClick={() => setUnassignedOpen(true)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-600 text-[10px] font-medium hover:bg-amber-500/15 transition-colors"
                title="Students not in any group"
              >
                <UserRoundX className="w-3 h-3" />
                <span className="tabular-nums">{assignmentSummary.unassigned.length}</span>
                <span className="hidden sm:inline">unassigned</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Body fills the remaining height; each view manages its own scroll. */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Session view owns its own loading + empty states (its own
            time-aware queries), so it sits outside the week/day gating. */}
        {view === 'session' && <SessionLauncher />}

        {view !== 'session' && loading && (
          <div className="animate-pulse space-y-1 flex-1 min-h-0 overflow-hidden">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="grid grid-cols-[44px_repeat(7,1fr)] gap-1">
                <div className="h-9 rounded-md bg-muted/40" />
                {[...Array(7)].map((_, j) => <div key={j} className="h-9 rounded-md bg-muted/30" />)}
              </div>
            ))}
          </div>
        )}

        {view !== 'session' && !loading && !hasGroups && (
          <div className="flex-1 min-h-0 flex items-center justify-center">
            <div className="rounded-xl border border-dashed border-border/60 px-6 py-8 text-center max-w-xs">
              <p className="text-sm text-muted-foreground mb-1">No groups yet.</p>
              <p className="text-xs text-muted-foreground">Tap any empty slot below to create one.</p>
            </div>
          </div>
        )}

        {!loading && hasGroups && view === 'week' && week && (
          <WeekGrid
            cells={week.cells}
            onOpenGroup={openEditor}
            onCreateAt={(dayOfWeek, band) => handleCreate({ dayOfWeek, band })}
          />
        )}

        {!loading && hasGroups && view === 'day' && (
          <DayList
            weekStartYmd={weekStartYmd}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            shiftWeek={(deltaDays) => setSelectedDate((d) => addDays(d, deltaDays))}
            data={weekSessions}
            onOpenSession={(slotId, date) => router.push(`/session/${slotId}/${date}`)}
          />
        )}
      </div>

      <EditGroupDialog
        groupId={editingGroup}
        seed={
          editingGroup
            ? week?.groups.find((g) => g._id === editingGroup)
            : undefined
        }
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />

      <UnassignedStudentsDialog
        open={unassignedOpen}
        onClose={() => setUnassignedOpen(false)}
        students={unassigned ?? []}
      />
    </div>
  );
}

// Lists students who aren't a member of any active group, so the user can
// spot anyone they've onboarded but forgotten to slot into a class. Grouped
// by schoolGrade because that's what the user reads first when deciding
// where to drop a student.
function UnassignedStudentsDialog({
  open,
  onClose,
  students,
}: {
  open: boolean;
  onClose: () => void;
  students: Array<{
    _id: Id<'students'>;
    name: string;
    schoolGrade: number;
  }>;
}) {
  const byGrade = useMemo(() => {
    const m = new Map<number, typeof students>();
    for (const s of students) {
      const arr = m.get(s.schoolGrade) ?? [];
      arr.push(s);
      m.set(s.schoolGrade, arr);
    }
    return Array.from(m.entries()).sort((a, b) => a[0] - b[0]);
  }, [students]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            <UserRoundX className="w-4 h-4 text-amber-500" />
            Unassigned students
            <span className="text-xs font-normal text-muted-foreground">
              ({students.length})
            </span>
          </DialogTitle>
          <p className="text-[11px] text-muted-foreground">
            Not yet placed in any active group.
          </p>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto px-4 pb-4">
          {students.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">
              Every student is in a group.
            </p>
          ) : (
            <div className="space-y-3">
              {byGrade.map(([grade, group]) => (
                <div key={grade}>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                    Grade {grade}
                  </p>
                  <ul className="space-y-0.5">
                    {group.map((s) => (
                      <li
                        key={s._id}
                        className="text-xs px-2 py-1.5 rounded-md bg-muted/40 text-foreground"
                      >
                        {s.name}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ExceptionStudent({ studentId }: { studentId: Id<'students'> }) {
  const s = useQuery(api.students.get, { id: studentId });
  return <>{s?.name ?? '…'}</>;
}

// ── DayList ───────────────────────────────────────────────────────────────
// Date-aware Day view. The pill row shows the seven dates of the current
// week and the body shows the session cards for `selectedDate`. Ring
// colours signal "needs entry" vs "logged" vs "tutor cancelled" — derived
// from the sessionLogs table plus the current wall clock.
//
// Week navigation: prev/next arrows shift by 7 days, the same day-of-week
// stays selected so the tutor can flip between weeks comparing the same
// slot. A "Today" jump-back appears when the user has navigated away.

type SessionEntry = {
  slotId: Id<'scheduleSlots'>;
  groupId: Id<'groups'>;
  groupName: string;
  date: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  hours: number;
  logStatus: 'unlogged' | 'held' | 'cancelled' | 'pre-tracking';
  cancelReason?: string;
  rosterCount: number;
  presentCount: number;
  absentCount: number;
  expected: number;
  collected: number;
  credit: number;
};

// Human-readable label for the cancel-reason enum stored on sessionLogs.
const CANCEL_REASON_LABELS: Record<string, string> = {
  sick: 'Sick',
  poya: 'Poya',
  festival: 'Festival',
  students_unavailable: 'Students away',
  personal: 'Personal',
  other: 'Other',
};

function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Has the session's start time already passed for that date in local time?
// Drives the red ring on cards: a future session is allowed to be unlogged.
function isSessionPast(date: string, startTime: string, now: Date): boolean {
  const [h, m] = startTime.split(':').map(Number);
  const sessionStart = new Date(date + 'T00:00:00');
  sessionStart.setHours(h, m, 0, 0);
  return now > sessionStart;
}

// Hours elapsed since the session started. Negative for future sessions.
// Used to add a subtle pulse to cards left unlogged for more than 24h.
function hoursSinceStart(date: string, startTime: string, now: Date): number {
  const [h, m] = startTime.split(':').map(Number);
  const sessionStart = new Date(date + 'T00:00:00');
  sessionStart.setHours(h, m, 0, 0);
  return (now.getTime() - sessionStart.getTime()) / 3_600_000;
}

function DayList({
  weekStartYmd,
  selectedDate,
  setSelectedDate,
  shiftWeek,
  data,
  onOpenSession,
}: {
  weekStartYmd: string;
  selectedDate: string;
  setSelectedDate: (d: string) => void;
  shiftWeek: (deltaDays: number) => void;
  data: { sessions: SessionEntry[]; perStudentWeek: Array<{ studentId: Id<'students'>; name: string; expected: number; collected: number; credit: number }> } | undefined;
  onOpenSession: (slotId: Id<'scheduleSlots'>, date: string) => void;
}) {
  const now = new Date();
  const todayStr = ymdLocal(now);
  const [cancelSheetOpen, setCancelSheetOpen] = useState(false);

  // Seven dates of the visible week — Mon..Sun, paired with their dow label.
  const weekDates = useMemo(() => {
    const out: Array<{ date: string; dow: number; label: string; dayNum: number }> = [];
    const start = new Date(weekStartYmd + 'T00:00:00');
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const js = d.getDay();
      const appDow = js === 0 ? 7 : js;
      const label = DAYS.find((x) => x.num === appDow)?.short ?? '';
      out.push({ date: ymdLocal(d), dow: appDow, label, dayNum: d.getDate() });
    }
    return out;
  }, [weekStartYmd]);

  // Sessions for the selected date, sorted by start time.
  const todaysSessions = useMemo(() => {
    const list = (data?.sessions ?? []).filter((s) => s.date === selectedDate);
    return list.sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [data, selectedDate]);

  // Per-date status counts powering the date-pill status dots. logged =
  // green, needsEntry (past + unlogged) = red, cancelled = grey. Upcoming
  // sessions (future + unlogged) deliberately don't get a dot — that would
  // be visual noise; future days are evident from the date itself.
  const dayCounts = useMemo(() => {
    const map = new Map<
      string,
      { logged: number; needsEntry: number; cancelled: number; upcoming: number; preTracking: number }
    >();
    for (const s of data?.sessions ?? []) {
      const cur =
        map.get(s.date) ?? {
          logged: 0,
          needsEntry: 0,
          cancelled: 0,
          upcoming: 0,
          preTracking: 0,
        };
      if (s.logStatus === 'pre-tracking') cur.preTracking += 1;
      else if (s.logStatus === 'cancelled') cur.cancelled += 1;
      else if (s.logStatus === 'held') cur.logged += 1;
      else if (isSessionPast(s.date, s.startTime, now)) cur.needsEntry += 1;
      else cur.upcoming += 1;
      map.set(s.date, cur);
    }
    return map;
    // now is recreated every render — that's fine, we don't need millisecond
    // precision on the ring state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const dayTotalExpected = todaysSessions.reduce((s, r) => s + r.expected, 0);
  const dayTotalCollected = todaysSessions.reduce((s, r) => s + r.collected, 0);
  const dayTotalCredit = todaysSessions.reduce((s, r) => s + r.credit, 0);

  const weekRangeLabel = useMemo(() => {
    const start = new Date(weekStartYmd + 'T00:00:00');
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const sameMonth = start.getMonth() === end.getMonth();
    const startStr = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const endStr = end.toLocaleDateString(undefined, sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' });
    return `${startStr} – ${endStr}`;
  }, [weekStartYmd]);

  const offToday = selectedDate !== todayStr;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Week navigation */}
      <div className="shrink-0 flex items-center justify-between gap-2 mb-2">
        <button
          onClick={() => shiftWeek(-7)}
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
          aria-label="Previous week"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground tabular-nums">
            {weekRangeLabel}
          </span>
          {offToday && (
            <button
              onClick={() => setSelectedDate(todayStr)}
              className="text-[10px] font-semibold text-primary hover:underline"
            >
              Today
            </button>
          )}
        </div>
        <div className="flex items-center">
          <button
            onClick={() => shiftWeek(7)}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
            aria-label="Next week"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          {/* Bulk-cancel entry. Opens a bottom sheet scoped to selectedDate;
              the sheet can switch to a date range or filter to specific
              groups before submitting. */}
          <button
            onClick={() => setCancelSheetOpen(true)}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
            aria-label="Cancel day"
            title="Cancel day"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Date pills — each shows weekday label, day number, and a row of
          status dots so the user can scan the week at a glance. The pill
          border still flags red/primary on today vs missing-entry days. */}
      <div className="shrink-0 flex gap-1 mb-3 overflow-x-auto">
        {weekDates.map(({ date, label, dayNum }) => {
          const isSelected = date === selectedDate;
          const isToday = date === todayStr;
          const counts = dayCounts.get(date) ?? {
            logged: 0,
            needsEntry: 0,
            cancelled: 0,
            upcoming: 0,
            preTracking: 0,
          };
          const missing = counts.needsEntry > 0;
          return (
            <button
              key={date}
              onClick={() => setSelectedDate(date)}
              className={cn(
                'shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium transition-all flex flex-col items-center gap-0.5 leading-tight border-2',
                isSelected
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted text-muted-foreground border-transparent',
                missing && !isSelected && 'border-destructive/60',
                isToday && !isSelected && !missing && 'border-primary/40',
              )}
            >
              <span className="text-[10px] opacity-80">{label}</span>
              <span className="text-sm font-bold tabular-nums">{dayNum}</span>
              <DayStatusDots counts={counts} selected={isSelected} />
            </button>
          );
        })}
      </div>

      {/* Day totals */}
      {todaysSessions.length > 0 && (
        <div className="shrink-0 grid grid-cols-3 gap-1.5 mb-2 text-[10px]">
          <div className="rounded-md bg-muted px-2 py-1">
            <p className="text-muted-foreground uppercase tracking-wider">Expected</p>
            <p className="font-bold text-foreground tabular-nums">{fmtLKR(dayTotalExpected)}</p>
          </div>
          <div className="rounded-md bg-muted px-2 py-1">
            <p className="text-muted-foreground uppercase tracking-wider">Collected</p>
            <p className="font-bold text-foreground tabular-nums">{fmtLKR(dayTotalCollected)}</p>
          </div>
          <div
            className={cn(
              'rounded-md px-2 py-1',
              dayTotalCredit > 0 ? 'bg-amber-500/10' : 'bg-muted',
            )}
          >
            <p className={cn(
              'uppercase tracking-wider',
              dayTotalCredit > 0 ? 'text-amber-600' : 'text-muted-foreground',
            )}>Credit</p>
            <p className={cn(
              'font-bold tabular-nums',
              dayTotalCredit > 0 ? 'text-amber-600' : 'text-foreground',
            )}>{fmtLKR(dayTotalCredit)}</p>
          </div>
        </div>
      )}

      {/* Session cards (scrollable within the day-list region) */}
      <div className="flex-1 min-h-0 overflow-y-auto pb-2">
        {data === undefined ? (
          <div className="space-y-2 animate-pulse">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-muted/30" />
            ))}
          </div>
        ) : (
          <DaySessionsBody
            sessions={todaysSessions}
            now={now}
            onOpenSession={onOpenSession}
            selectedDate={selectedDate}
            todayStr={todayStr}
          />
        )}
      </div>

      <CancelDaySheet
        open={cancelSheetOpen}
        onClose={() => setCancelSheetOpen(false)}
        date={selectedDate}
      />
    </div>
  );
}

// Decides the empty / full-cancelled / grouped-sections layout for the
// session list on the selected date.
//
//  • full-cancelled — every non-pre-tracking session is cancelled. Shows
//    one hero banner with the reason chip (when consistent across cards)
//    so the day reads as "Day off — Poya" at a glance instead of as a
//    wall of identical cancelled cards.
//  • empty — no sessions at all. Friendly off-day messaging.
//  • grouped — the default. Sections (Needs entry → Coming up → Done →
//    Cancelled → Before tracking) so urgency clusters at the top.
function DaySessionsBody({
  sessions,
  now,
  onOpenSession,
  selectedDate,
  todayStr,
}: {
  sessions: SessionEntry[];
  now: Date;
  onOpenSession: (slotId: Id<'scheduleSlots'>, date: string) => void;
  selectedDate: string;
  todayStr: string;
}) {
  // Empty-day path. We split "off-day" (Sunday or holiday) from "no groups
  // run today" so the message lines up with the user's mental model.
  if (sessions.length === 0) {
    const d = new Date(selectedDate + 'T00:00:00');
    const isSunday = d.getDay() === 0;
    return (
      <div className="rounded-xl border border-dashed border-border/40 bg-muted/10 py-8 text-center">
        <p className="text-sm text-muted-foreground mb-1">
          {isSunday ? 'Sunday off' : 'No sessions this day'}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {isSunday
            ? 'No classes scheduled on Sundays.'
            : selectedDate === todayStr
              ? 'Quiet day. Plan something on the Week view.'
              : 'Nothing scheduled here.'}
        </p>
      </div>
    );
  }

  // Partition by status. Pre-tracking is shown last so it never competes
  // with live items.
  const live = sessions.filter((s) => s.logStatus !== 'pre-tracking');
  const preTracking = sessions.filter((s) => s.logStatus === 'pre-tracking');

  // Full-day cancellation banner — only when EVERY live session is
  // cancelled (and there's at least one). Picks the dominant reason for
  // the headline.
  const allCancelled = live.length > 0 && live.every((s) => s.logStatus === 'cancelled');
  if (allCancelled) {
    const reasonCount = new Map<string, number>();
    for (const s of live) {
      const k = s.cancelReason ?? 'other';
      reasonCount.set(k, (reasonCount.get(k) ?? 0) + 1);
    }
    let dominantReason: string | null = null;
    let max = 0;
    for (const [k, v] of Array.from(reasonCount.entries())) {
      if (v > max) {
        max = v;
        dominantReason = k;
      }
    }
    const reasonLabel = dominantReason
      ? (CANCEL_REASON_LABELS[dominantReason] ?? dominantReason)
      : null;

    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-muted-foreground/30 bg-muted/30 px-4 py-5 text-center">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
            Day off
          </p>
          <p className="text-lg font-bold text-foreground mb-1">
            {reasonLabel ?? 'Cancelled'}
          </p>
          <p className="text-xs text-muted-foreground">
            {live.length} session{live.length === 1 ? '' : 's'} cancelled
          </p>
        </div>
        {preTracking.length > 0 && (
          <Section title="Before tracking" count={preTracking.length}>
            {preTracking.map((s) => (
              <SessionCard
                key={s.slotId}
                session={s}
                isPastNow={false}
                isStale={false}
                onOpen={() => {
                  /* pre-tracking is read-only */
                }}
              />
            ))}
          </Section>
        )}
      </div>
    );
  }

  // Status-grouped sections. Order by urgency: needs-entry first, then
  // upcoming (so the next class is easy to spot on today), done, cancelled,
  // pre-tracking last.
  const needsEntry: SessionEntry[] = [];
  const upcoming: SessionEntry[] = [];
  const done: SessionEntry[] = [];
  const cancelled: SessionEntry[] = [];
  for (const s of live) {
    if (s.logStatus === 'held') done.push(s);
    else if (s.logStatus === 'cancelled') cancelled.push(s);
    else if (isSessionPast(s.date, s.startTime, now)) needsEntry.push(s);
    else upcoming.push(s);
  }

  const renderCard = (s: SessionEntry) => (
    <SessionCard
      key={s.slotId}
      session={s}
      isPastNow={isSessionPast(s.date, s.startTime, now)}
      isStale={
        s.logStatus === 'unlogged' &&
        hoursSinceStart(s.date, s.startTime, now) > 24
      }
      onOpen={
        s.logStatus === 'pre-tracking'
          ? () => {
              /* pre-tracking cards are read-only */
            }
          : () => onOpenSession(s.slotId, s.date)
      }
    />
  );

  return (
    <div className="space-y-4">
      {needsEntry.length > 0 && (
        <Section title="Needs entry" count={needsEntry.length} tone="destructive">
          {needsEntry.map(renderCard)}
        </Section>
      )}
      {upcoming.length > 0 && (
        <Section title="Coming up" count={upcoming.length} tone="primary">
          {upcoming.map(renderCard)}
        </Section>
      )}
      {done.length > 0 && (
        <Section title="Done" count={done.length} tone="emerald">
          {done.map(renderCard)}
        </Section>
      )}
      {cancelled.length > 0 && (
        <Section title="Cancelled" count={cancelled.length} tone="muted">
          {cancelled.map(renderCard)}
        </Section>
      )}
      {preTracking.length > 0 && (
        <Section title="Before tracking" count={preTracking.length} tone="muted">
          {preTracking.map(renderCard)}
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  count,
  tone = 'muted',
  children,
}: {
  title: string;
  count: number;
  tone?: 'destructive' | 'primary' | 'emerald' | 'muted';
  children: React.ReactNode;
}) {
  const dot =
    tone === 'destructive'
      ? 'bg-destructive'
      : tone === 'primary'
        ? 'bg-primary'
        : tone === 'emerald'
          ? 'bg-emerald-500'
          : 'bg-muted-foreground/40';
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 px-1">
        <span className={cn('w-1.5 h-1.5 rounded-full', dot)} />
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h4>
        <span className="text-[10px] font-medium text-muted-foreground tabular-nums">
          {count}
        </span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

// Three small dots under the date number summarising the day's session
// states: emerald = logged, destructive = needs entry (past + unlogged),
// muted = cancelled. We omit "upcoming" deliberately — future sessions
// shouldn't pull attention the way overdue ones should. When the pill is
// selected (primary fill) the dots become high-contrast so they remain
// visible against the dark background.
function DayStatusDots({
  counts,
  selected,
}: {
  counts: { logged: number; needsEntry: number; cancelled: number; upcoming: number; preTracking: number };
  selected: boolean;
}) {
  const dots: Array<{ key: string; cls: string }> = [];
  if (counts.logged > 0)
    dots.push({
      key: 'logged',
      cls: selected ? 'bg-emerald-300' : 'bg-emerald-500',
    });
  if (counts.needsEntry > 0)
    dots.push({
      key: 'needs',
      cls: selected ? 'bg-red-300' : 'bg-destructive',
    });
  if (counts.cancelled > 0)
    dots.push({
      key: 'cancelled',
      cls: selected ? 'bg-white/60' : 'bg-muted-foreground/60',
    });
  if (dots.length === 0) {
    // Render a placeholder so the pill heights stay aligned across the week.
    return <span className="h-1" />;
  }
  return (
    <span className="flex items-center gap-0.5 mt-0.5">
      {dots.map((d) => (
        <span key={d.key} className={cn('w-1 h-1 rounded-full', d.cls)} />
      ))}
    </span>
  );
}

function SessionCard({
  session,
  isPastNow,
  isStale,
  onOpen,
}: {
  session: SessionEntry;
  isPastNow: boolean;
  isStale: boolean;
  onOpen: () => void;
}) {
  // Day view is single-day so per-group colour adds noise — every card sits
  // on the same date. The accent stripe is now status-driven (cancelled =
  // muted, held = emerald, unlogged-past = destructive, future = subtle).
  // Per-group colour is retained in Week view because it helps the eye link
  // a group's many sessions across the timetable.

  // Pre-tracking: the group existed before this app started logging. Show
  // it muted with no urgency, so the user understands the slot existed but
  // doesn't feel pulled to log it.
  if (session.logStatus === 'pre-tracking') {
    return (
      <div className="w-full flex items-center gap-3 p-3 rounded-xl border border-dashed border-border/40 bg-muted/20 opacity-70 cursor-not-allowed">
        <span className="w-1.5 h-10 rounded-full shrink-0 bg-muted-foreground/20" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold text-muted-foreground truncate">
              {session.groupName}
            </p>
            <span className="shrink-0 inline-flex items-center px-1.5 py-px rounded text-[9px] font-bold uppercase tracking-wide bg-muted-foreground/10 text-muted-foreground">
              Before tracking
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {fmtTime12(session.startTime)} – {fmtTime12(session.endTime)}
          </p>
        </div>
      </div>
    );
  }

  let ringClass = '';
  let accentClass = 'bg-muted-foreground/20';
  let badge: { label: string; tone: 'green' | 'red' | 'grey' | 'none' } = { label: '', tone: 'none' };
  if (session.logStatus === 'cancelled') {
    ringClass = 'ring-2 ring-muted-foreground/30';
    accentClass = 'bg-muted-foreground/40';
    badge = { label: 'Cancelled', tone: 'grey' };
  } else if (session.logStatus === 'held') {
    ringClass = 'ring-2 ring-emerald-500/60';
    accentClass = 'bg-emerald-500';
    badge = { label: 'Logged', tone: 'green' };
  } else if (isPastNow) {
    ringClass = 'ring-2 ring-destructive/70';
    accentClass = 'bg-destructive';
    badge = { label: 'Needs entry', tone: 'red' };
  } else {
    // Future, unlogged — subtle primary accent so it still feels "live".
    accentClass = 'bg-primary/40';
  }

  const isCancelled = session.logStatus === 'cancelled';

  return (
    <button
      onClick={onOpen}
      className={cn(
        'w-full flex items-center gap-3 p-3 rounded-xl border border-border/60 text-left transition-transform active:scale-[0.99] hover:bg-muted/30',
        ringClass,
        isCancelled && 'opacity-70',
        // Stale = past + unlogged for >24h. Pulse gently to flag chronic
        // missing entries without nagging on day-of urgency.
        isStale && 'animate-pulse',
      )}
    >
      <span className={cn('w-1.5 h-10 rounded-full shrink-0', accentClass)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p
            className={cn(
              'text-sm font-semibold text-foreground truncate',
              isCancelled && 'line-through',
            )}
          >
            {session.groupName}
          </p>
          {badge.tone !== 'none' && (
            <span
              className={cn(
                'shrink-0 inline-flex items-center gap-0.5 px-1.5 py-px rounded text-[9px] font-bold uppercase tracking-wide',
                badge.tone === 'green' && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
                badge.tone === 'red' && 'bg-destructive/15 text-destructive',
                badge.tone === 'grey' && 'bg-muted-foreground/15 text-muted-foreground',
              )}
            >
              {badge.tone === 'grey' && <XCircle className="w-2.5 h-2.5" />}
              {badge.label}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {fmtTime12(session.startTime)} – {fmtTime12(session.endTime)}
          {session.logStatus === 'held' && (
            <>
              {' · '}
              {session.presentCount}/{session.rosterCount} present
            </>
          )}
          {session.logStatus === 'unlogged' && (
            <>
              {' · '}
              {session.rosterCount} expected
            </>
          )}
        </p>
      </div>
      <div className="text-right shrink-0">
        {session.logStatus === 'cancelled' ? (
          <span className="text-[10px] text-muted-foreground">—</span>
        ) : session.logStatus === 'held' ? (
          <>
            <p className="text-xs font-bold text-foreground tabular-nums">
              {fmtLKR(session.collected)}
            </p>
            {session.credit > 0 && (
              <p className="text-[10px] text-amber-600 tabular-nums">
                + {fmtLKR(session.credit)} credit
              </p>
            )}
          </>
        ) : (
          <p className="text-xs font-semibold text-muted-foreground tabular-nums">
            {fmtLKR(session.expected)}
          </p>
        )}
      </div>
    </button>
  );
}
