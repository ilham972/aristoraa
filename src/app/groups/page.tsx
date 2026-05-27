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
  LayoutGrid,
  UserMinus,
  UserPlus,
  XCircle,
} from 'lucide-react';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { groupColor } from '@/lib/groups/color';
import {
  DAYS,
  fmtLKR,
  fmtTime12,
  type HourBand,
} from '@/lib/groups/time-grid';
import { WeekGrid } from '@/components/groups/week-grid';
import { EditGroupDialog } from '@/components/groups/edit-group-dialog';

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
  const [view, setView] = useState<'week' | 'day'>('day');
  const [editingGroup, setEditingGroup] = useState<Id<'groups'> | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

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
        </div>
      </div>

      {/* Body fills the remaining height; each view manages its own scroll. */}
      <div className="flex-1 min-h-0 flex flex-col">
        {loading && (
          <div className="animate-pulse space-y-1 flex-1 min-h-0 overflow-hidden">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="grid grid-cols-[44px_repeat(7,1fr)] gap-1">
                <div className="h-9 rounded-md bg-muted/40" />
                {[...Array(7)].map((_, j) => <div key={j} className="h-9 rounded-md bg-muted/30" />)}
              </div>
            ))}
          </div>
        )}

        {!loading && !hasGroups && (
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
    </div>
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
  logStatus: 'unlogged' | 'held' | 'cancelled';
  rosterCount: number;
  presentCount: number;
  absentCount: number;
  expected: number;
  collected: number;
  credit: number;
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

  // Does any day in the visible week have a past-time unlogged session?
  // Used to red-ring the day pill itself.
  const dayHasMissing = useMemo(() => {
    const set = new Set<string>();
    for (const s of data?.sessions ?? []) {
      if (s.logStatus === 'unlogged' && isSessionPast(s.date, s.startTime, now)) {
        set.add(s.date);
      }
    }
    return set;
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
        <button
          onClick={() => shiftWeek(7)}
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
          aria-label="Next week"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Date pills */}
      <div className="shrink-0 flex gap-1 mb-3 overflow-x-auto">
        {weekDates.map(({ date, label, dayNum }) => {
          const isSelected = date === selectedDate;
          const isToday = date === todayStr;
          const missing = dayHasMissing.has(date);
          return (
            <button
              key={date}
              onClick={() => setSelectedDate(date)}
              className={cn(
                'shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium transition-all flex flex-col items-center gap-0 leading-tight border-2',
                isSelected
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted text-muted-foreground border-transparent',
                missing && !isSelected && 'border-destructive/60',
                isToday && !isSelected && !missing && 'border-primary/40',
              )}
            >
              <span className="text-[10px] opacity-80">{label}</span>
              <span className="text-sm font-bold tabular-nums">{dayNum}</span>
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
        ) : todaysSessions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No sessions this day.</p>
        ) : (
          <div className="space-y-2">
            {todaysSessions.map((s) => (
              <SessionCard
                key={s.slotId}
                session={s}
                isPastNow={isSessionPast(s.date, s.startTime, now)}
                onOpen={() => onOpenSession(s.slotId, s.date)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SessionCard({
  session,
  isPastNow,
  onOpen,
}: {
  session: SessionEntry;
  isPastNow: boolean;
  onOpen: () => void;
}) {
  const color = groupColor(session.groupId);

  // Ring state: cancelled = grey, held = green, unlogged + past = red,
  // unlogged + future = none (no urgency yet).
  let ringClass = '';
  let badge: { label: string; tone: 'green' | 'red' | 'grey' | 'none' } = { label: '', tone: 'none' };
  if (session.logStatus === 'cancelled') {
    ringClass = 'ring-2 ring-muted-foreground/30';
    badge = { label: 'Cancelled', tone: 'grey' };
  } else if (session.logStatus === 'held') {
    ringClass = 'ring-2 ring-emerald-500/60';
    badge = { label: 'Logged', tone: 'green' };
  } else if (isPastNow) {
    ringClass = 'ring-2 ring-destructive/70';
    badge = { label: 'Needs entry', tone: 'red' };
  }

  const isCancelled = session.logStatus === 'cancelled';

  return (
    <button
      onClick={onOpen}
      className={cn(
        'w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-transform active:scale-[0.99] hover:bg-muted/30',
        ringClass,
        isCancelled && 'opacity-70',
      )}
      style={{ borderColor: color.border }}
    >
      <span
        className="w-1.5 h-10 rounded-full shrink-0"
        style={{ backgroundColor: color.solid }}
      />
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
