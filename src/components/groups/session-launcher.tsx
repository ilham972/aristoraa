'use client';

// SessionLauncher — the embedded "Session" tab on /groups. A quick shortcut
// straight into the per-session workspace, with no card-tap drill-down and
// no back button (the Day / Week / Session top tabs stay visible above it,
// so switching context is one tap).
//
//   • Targets one day, controlled by the `day` prop (Yesterday / Today /
//     Tomorrow). The selector lives in the page header next to the
//     Day/Week/Session toggle; Today is the default.
//   • Today is TIME-AWARE: it auto-opens the *current* session — live now →
//     else the next upcoming → else the last session of the day (so you can
//     still finish entry after the last class). Yesterday / Tomorrow open
//     their first session.
//   • A pressable pill strip (see SessionPills) lets you jump between the
//     day's sessions; the chosen workspace tab is preserved across jumps.
//   • Default workspace tab is Sheets.
//
// All state is local — selecting a pill just swaps which slot/date the
// SessionWorkspace renders. The standalone /session page (reached from the
// Day view) is untouched and keeps its own back arrow + group stepper.

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from 'convex/react';
import { CalendarOff } from 'lucide-react';
import { api, type Id } from '@/lib/convex';
import { groupColor } from '@/lib/groups/color';
import { fmtTime12 } from '@/lib/groups/time-grid';
import { isLive, isPast } from '@/lib/groups/session-time';
import { SessionWorkspace, type SessionTab } from '@/components/session/session-workspace';
import { SessionPills, type PillSession } from '@/components/session/session-pills';

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function todayYmd(): string {
  return ymd(new Date());
}
function addDays(dateYmd: string, n: number): string {
  const d = new Date(dateYmd + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return ymd(d);
}
// Monday of the week containing dateYmd (1=Mon..7=Sun convention).
function mondayOf(dateYmd: string): string {
  const d = new Date(dateYmd + 'T00:00:00');
  const js = d.getDay();
  const offset = js === 0 ? -6 : 1 - js;
  d.setDate(d.getDate() + offset);
  return ymd(d);
}

type DaySession = PillSession & { groupId: Id<'groups'> };

// Time-aware pick for Today: live → next upcoming → last. Pre-tracking
// sessions are skipped unless they're all that's available.
function pickCurrent(sessions: DaySession[], now: Date): DaySession | null {
  if (sessions.length === 0) return null;
  const pool = sessions.filter((s) => s.logStatus !== 'pre-tracking');
  const base = pool.length > 0 ? pool : sessions; // base is start-time sorted
  const live = base.find((s) => isLive(s.date, s.startTime, s.endTime, now));
  if (live) return live;
  const upcoming = base.filter((s) => !isPast(s.date, s.startTime, now));
  if (upcoming.length > 0) return upcoming[0];
  return base[base.length - 1];
}

export function SessionLauncher({
  day,
}: {
  day: 'yesterday' | 'today' | 'tomorrow';
}) {
  // Manual pill override; cleared when the day changes so each day re-runs its
  // auto-selection.
  const [override, setOverride] = useState<{ slotId: Id<'scheduleSlots'>; date: string } | null>(null);
  useEffect(() => {
    setOverride(null);
  }, [day]);
  // Default to the merged Sheets/scoring tab (id 'score').
  const [workspaceTab, setWorkspaceTab] = useState<SessionTab>('score');

  // Tick every minute so pill live/past state stays fresh while the tab is
  // open. (Selection is intentionally NOT recomputed on tick — see below.)
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(iv);
  }, []);

  const today = todayYmd();
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  const activeDate = day === 'today' ? today : day === 'yesterday' ? yesterday : tomorrow;

  // Adjacent days can fall in different weeks (Sun↔Mon); query each. Convex
  // caches identical args, so when they share a week it collapses to one query.
  const weekYesterday = useQuery(api.sessionRecords.weekSessions, { weekStartDate: mondayOf(yesterday) });
  const weekToday = useQuery(api.sessionRecords.weekSessions, { weekStartDate: mondayOf(today) });
  const weekTomorrow = useQuery(api.sessionRecords.weekSessions, { weekStartDate: mondayOf(tomorrow) });
  const activeWeek = day === 'today' ? weekToday : day === 'yesterday' ? weekYesterday : weekTomorrow;

  const daySessions = useMemo<DaySession[]>(() => {
    return (activeWeek?.sessions ?? [])
      .filter((s) => s.date === activeDate)
      .slice()
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .map((s) => ({
        slotId: s.slotId,
        date: s.date,
        groupId: s.groupId,
        groupName: s.groupName,
        startTime: s.startTime,
        endTime: s.endTime,
        logStatus: s.logStatus,
      }));
  }, [activeWeek, activeDate]);

  // Auto-selection is computed when the data or day changes — NOT on the
  // minute tick — so a passing clock edge never yanks the open session out
  // from under the user. The pills below still reflect live time via `now`.
  const autoSelected = useMemo(
    () => (day === 'today' ? pickCurrent(daySessions, new Date()) : (daySessions[0] ?? null)),
    [daySessions, day],
  );

  const selected = useMemo(() => {
    if (override && daySessions.some((s) => s.slotId === override.slotId && s.date === override.date)) {
      return override;
    }
    return autoSelected ? { slotId: autoSelected.slotId, date: autoSelected.date } : null;
  }, [override, autoSelected, daySessions]);

  const selectedSession = useMemo(
    () => daySessions.find((s) => selected && s.slotId === selected.slotId && s.date === selected.date) ?? null,
    [daySessions, selected],
  );

  const loading = activeWeek === undefined;
  const color = selectedSession ? groupColor(selectedSession.groupId) : null;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {loading ? (
        <div className="flex-1 min-h-0 animate-pulse space-y-3">
          <div className="h-8 w-48 rounded-lg bg-muted/40" />
          <div className="h-16 rounded-xl bg-muted/30" />
        </div>
      ) : daySessions.length === 0 ? (
        <EmptyDay day={day} />
      ) : (
        <>
          {/* Pill strip — pressable, grouped by time band. */}
          <div className="shrink-0 mb-2">
            <SessionPills sessions={daySessions} selected={selected} onSelect={setOverride} now={now} />
          </div>

          {/* Which session is open right now. */}
          {selectedSession && (
            <div className="shrink-0 flex items-center gap-2 mb-2 px-0.5 min-w-0">
              {color && (
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color.solid }} />
              )}
              <span className="text-sm font-bold text-foreground truncate">{selectedSession.groupName}</span>
              <span className="text-xs text-muted-foreground shrink-0">
                {fmtTime12(selectedSession.startTime)} – {fmtTime12(selectedSession.endTime)}
              </span>
            </div>
          )}

          {/* The 4-tab workspace. Keyed by slot|date so switching sessions
              remounts the bodies with fresh per-session state. */}
          {selected && (
            <SessionWorkspace
              key={`${selected.slotId}|${selected.date}`}
              slotId={selected.slotId}
              date={selected.date}
              tab={workspaceTab}
              onTabChange={setWorkspaceTab}
            />
          )}
        </>
      )}
    </div>
  );
}

function EmptyDay({ day }: { day: 'yesterday' | 'today' | 'tomorrow' }) {
  const title =
    day === 'today'
      ? 'No sessions today'
      : day === 'yesterday'
        ? 'No sessions yesterday'
        : 'No classes tomorrow';
  const sub =
    day === 'today'
      ? 'Nothing scheduled for today.'
      : day === 'yesterday'
        ? 'Nothing was scheduled yesterday.'
        : 'Enjoy the day off.';
  return (
    <div className="flex-1 min-h-0 flex items-center justify-center">
      <div className="rounded-xl border border-dashed border-border/60 px-6 py-8 text-center max-w-xs">
        <CalendarOff className="w-6 h-6 text-muted-foreground/50 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground mb-1">{title}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}
