'use client';

// Phase F — /groups. Group-centric scheduling, replacing the old
// Settings → Schedule tab. Default view is the whole-week grid (the user
// thinks in weeks); a Day toggle gives a focused single-day card list.
//
// Top strip: today's revenue + week forecast + today's attendance exceptions.

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { toast } from 'sonner';
import { BarChart3, CalendarDays, LayoutGrid, UserMinus, UserPlus } from 'lucide-react';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { groupColor } from '@/lib/groups/color';
import {
  DAYS,
  fmtLKR,
  fmtTime12,
  todayDayNum,
  type DayNum,
  type HourBand,
} from '@/lib/groups/time-grid';
import { WeekGrid } from '@/components/groups/week-grid';
import { EditGroupDialog } from '@/components/groups/edit-group-dialog';
import { RevenueTab } from '@/components/groups/revenue-tab';

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function GroupsPage() {
  const [view, setView] = useState<'week' | 'day' | 'revenue'>('week');
  const [selectedDay, setSelectedDay] = useState<DayNum>(todayDayNum());
  const [editingGroup, setEditingGroup] = useState<Id<'groups'> | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const today = todayYmd();
  const week = useQuery(api.groups.weekGrid);
  const rooms = useQuery(api.rooms.list);
  // Prefetch the dialog's reference lists at the page level so they're
  // already in the Convex cache when the user opens a group editor.
  // Students are not prefetched here — the dialog now uses a server-filtered
  // candidateStudents query so the full list never needs to ship to the
  // client.
  useQuery(api.teachers.list);
  useQuery(api.centers.list);
  const dayData = useQuery(
    api.groups.dayView,
    view === 'day'
      ? {
          dayOfWeek: selectedDay,
          // Only apply date-keyed overrides when the selected pill is actually
          // today — overrides are keyed to specific dates, so mixing today's
          // date with another weekday's slots would silently drop them.
          date: selectedDay === todayDayNum() ? today : undefined,
        }
      : 'skip',
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

  // Fixed-height page: the only thing allowed to scroll vertically is the
  // active sub-view's overflow region (DayList list, RevenueTab content).
  // The week-grid view scrolls horizontally only — vertical sizing inside
  // it is sized to fit so the user never has to scroll up/down while
  // browsing slots. Calc subtracts the bottom-nav padding (5rem) applied
  // by AuthLayout's <main>.
  return (
    <div className="h-[calc(100svh-5rem)] flex flex-col overflow-hidden max-w-3xl mx-auto px-3 pt-3">
      {/* Today's exceptions — only when present, hidden on Revenue tab. */}
      {view !== 'revenue' && exceptions && exceptions.length > 0 && (
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

      {/* View toggle is the sole header chrome now — tap an empty slot in
          Week view to create a group, so the old "+ New" button is gone. */}
      <div className="shrink-0 flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1 p-1 bg-muted rounded-xl w-fit">
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
            onClick={() => setView('day')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
              view === 'day' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
            )}
          >
            <CalendarDays className="w-3.5 h-3.5" /> Day
          </button>
        </div>
        <button
          onClick={() => setView('revenue')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all border',
            view === 'revenue'
              ? 'bg-primary text-primary-foreground border-primary shadow-sm'
              : 'bg-muted text-muted-foreground border-transparent',
          )}
        >
          <BarChart3 className="w-3.5 h-3.5" /> Revenue
        </button>
      </div>

      {/* Body fills the remaining height; each view manages its own scroll. */}
      <div className="flex-1 min-h-0 flex flex-col">
        {view !== 'revenue' && loading && (
          <div className="animate-pulse space-y-1 flex-1 min-h-0 overflow-hidden">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="grid grid-cols-[44px_repeat(7,1fr)] gap-1">
                <div className="h-9 rounded-md bg-muted/40" />
                {[...Array(7)].map((_, j) => <div key={j} className="h-9 rounded-md bg-muted/30" />)}
              </div>
            ))}
          </div>
        )}

        {view !== 'revenue' && !loading && !hasGroups && (
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
          <div className="flex-1 min-h-0 overflow-y-auto pb-3">
            <DayList
              day={selectedDay}
              setDay={setSelectedDay}
              rows={dayData}
              onOpenGroup={openEditor}
            />
          </div>
        )}

        {view === 'revenue' && (
          <div className="flex-1 min-h-0 overflow-y-auto pb-3">
            <RevenueTab />
          </div>
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

type DayRow = {
  slot: { _id: Id<'scheduleSlots'>; startTime: string; endTime: string };
  group: { _id: Id<'groups'>; name: string };
  members: Array<{ _id: Id<'students'>; name: string }>;
  effectiveCount: number;
  revenue: number;
};

function DayList({
  day,
  setDay,
  rows,
  onOpenGroup,
}: {
  day: DayNum;
  setDay: (d: DayNum) => void;
  rows: DayRow[] | undefined;
  onOpenGroup: (id: Id<'groups'>) => void;
}) {
  const dayTotal = useMemo(
    () => (rows ?? []).reduce((s, r) => s + r.revenue, 0),
    [rows],
  );

  return (
    <div>
      <div className="flex gap-1.5 mb-3 overflow-x-auto">
        {DAYS.map((d) => (
          <button
            key={d.num}
            onClick={() => setDay(d.num)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm font-medium transition-all shrink-0',
              day === d.num ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
            )}
          >
            {d.short}
          </button>
        ))}
      </div>

      {rows && rows.length > 0 && (
        <p className="text-xs text-muted-foreground mb-2">
          {rows.length} session{rows.length !== 1 ? 's' : ''} · {fmtLKR(dayTotal)}
        </p>
      )}

      <div className="space-y-2">
        {rows?.map((r) => {
          const color = groupColor(r.group._id);
          return (
            <button
              key={r.slot._id}
              onClick={() => onOpenGroup(r.group._id)}
              className="w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors hover:bg-muted/40"
              style={{ borderColor: color.border }}
            >
              <span className="w-1.5 h-10 rounded-full shrink-0" style={{ backgroundColor: color.solid }} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{r.group.name}</p>
                <p className="text-xs text-muted-foreground">
                  {fmtTime12(r.slot.startTime)} – {fmtTime12(r.slot.endTime)} · {r.effectiveCount} present
                </p>
              </div>
              <span className="text-xs font-semibold text-foreground shrink-0">{fmtLKR(r.revenue)}</span>
            </button>
          );
        })}
        {rows && rows.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">No sessions this day.</p>
        )}
      </div>
    </div>
  );
}
