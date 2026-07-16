'use client';

// RevisionTimetable — the /groups "Revision" view (2026-07-17). A day-only
// board: no times, just weekday sections, each holding the groups (and
// groupless individual students) who come in for revision that day. The
// planner Sheets tab reads these days per group (groupSlotDays) so planned
// sheets can be assigned onto them.

import { useMemo, useState } from 'react';
import { useMutation } from 'convex/react';
import { Plus, Search, User, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { useCachedQuery } from '@/hooks/use-cached-query';

const DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

export function RevisionTimetable() {
  const board = useCachedQuery(api.revisionTimetable.list, {});
  const add = useMutation(api.revisionTimetable.add);
  const remove = useMutation(api.revisionTimetable.remove);

  const [pickerDay, setPickerDay] = useState<number | null>(null);

  const onRemove = async (id: string) => {
    try {
      await remove({ id: id as unknown as Id<'revisionClasses'> });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to remove');
    }
  };

  if (board === undefined) {
    return (
      <div className="space-y-2 animate-pulse">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-16 bg-muted rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2 pb-4">
      <div className="text-[11px] text-muted-foreground">
        Who comes in for revision on each day — whole groups or individual
        students. No times: a revision class is a day, not a slot. The
        planner&rsquo;s Sheets tab can assign sheets onto these days.
      </div>
      {(board?.days ?? []).map((d) => (
        <div
          key={d.dayOfWeek}
          className="rounded-xl border border-border bg-card px-3 py-2.5"
        >
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[12px] font-bold text-foreground">
              {DAY_NAMES[d.dayOfWeek - 1]}
            </span>
            <span className="h-px flex-1 bg-border" />
            <button
              onClick={() => setPickerDay(d.dayOfWeek)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-border text-[10.5px] font-semibold text-muted-foreground"
            >
              <Plus className="w-3 h-3" />
              Add
            </button>
          </div>
          {d.entries.length === 0 ? (
            <div className="text-[10.5px] text-muted-foreground italic">
              No revision class this day.
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {d.entries.map((e) => (
                <span
                  key={e.id}
                  className={cn(
                    'inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg border text-[10.5px]',
                    e.kind === 'group'
                      ? 'border-amber-500/50 bg-amber-500/10 text-foreground'
                      : 'border-border bg-card text-foreground',
                  )}
                >
                  {e.kind === 'group' ? (
                    <Users className="w-3 h-3 text-amber-500" />
                  ) : (
                    <User className="w-3 h-3 text-muted-foreground" />
                  )}
                  <span className="font-semibold">{e.name}</span>
                  {e.grade !== null && (
                    <span className="text-muted-foreground">G{e.grade}</span>
                  )}
                  <button
                    onClick={() => onRemove(e.id)}
                    aria-label={`Remove ${e.name}`}
                    className="p-0.5 rounded hover:bg-muted text-muted-foreground"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      ))}

      {pickerDay !== null && (
        <AddEntryDialog
          dayOfWeek={pickerDay}
          existing={
            board?.days.find((d) => d.dayOfWeek === pickerDay)?.entries ?? []
          }
          onAdd={async (sel) => {
            try {
              await add({
                dayOfWeek: pickerDay,
                ...(sel.kind === 'group'
                  ? { groupId: sel.id as unknown as Id<'groups'> }
                  : { studentId: sel.id as unknown as Id<'students'> }),
              });
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Failed to add');
            }
          }}
          onClose={() => setPickerDay(null)}
        />
      )}
    </div>
  );
}

function AddEntryDialog({
  dayOfWeek,
  existing,
  onAdd,
  onClose,
}: {
  dayOfWeek: number;
  existing: Array<{ id: string; kind: 'group' | 'student'; name: string }>;
  onAdd: (sel: { kind: 'group' | 'student'; id: string }) => Promise<void>;
  onClose: () => void;
}) {
  const groups = useCachedQuery(api.groups.list, {});
  const students = useCachedQuery(api.students.list, {});
  const [tab, setTab] = useState<'group' | 'student'>('group');
  const [q, setQ] = useState('');

  const existingNames = useMemo(
    () => new Set(existing.map((e) => `${e.kind}:${e.name}`)),
    [existing],
  );

  const groupRows = useMemo(
    () =>
      (groups ?? [])
        .slice()
        .sort(
          (a, b) =>
            (a.grade ?? 0) - (b.grade ?? 0) || a.name.localeCompare(b.name),
        ),
    [groups],
  );
  const studentRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (students ?? [])
      .filter((s) => needle === '' || s.name.toLowerCase().includes(needle))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 30);
  }, [students, q]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">
            Add to {DAY_NAMES[dayOfWeek - 1]} revision
          </DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-1 p-1 bg-muted rounded-xl w-fit">
          {(['group', 'student'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium',
                tab === t
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground',
              )}
            >
              {t === 'group' ? 'Groups' : 'Students'}
            </button>
          ))}
        </div>
        {tab === 'student' && (
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search students…"
              className="w-full pl-8 pr-3 py-2 rounded-lg border border-border bg-card text-sm text-foreground"
            />
          </div>
        )}
        <div className="max-h-[45vh] overflow-y-auto space-y-1">
          {tab === 'group' &&
            groupRows.map((g) => {
              const dup = existingNames.has(`group:${g.name}`);
              return (
                <button
                  key={g._id as unknown as string}
                  onClick={() =>
                    onAdd({ kind: 'group', id: g._id as unknown as string })
                  }
                  disabled={dup}
                  className={cn(
                    'w-full flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left text-xs',
                    dup
                      ? 'border-border/50 text-muted-foreground/50'
                      : 'border-border text-foreground hover:bg-muted',
                  )}
                >
                  <Users className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span className="font-semibold flex-1 truncate">
                    {g.name}
                  </span>
                  {g.grade !== undefined && g.grade !== null && (
                    <span className="text-muted-foreground">G{g.grade}</span>
                  )}
                  {dup && <span className="text-[9px]">added</span>}
                </button>
              );
            })}
          {tab === 'student' &&
            studentRows.map((s) => {
              const dup = existingNames.has(`student:${s.name}`);
              return (
                <button
                  key={s._id as unknown as string}
                  onClick={() =>
                    onAdd({ kind: 'student', id: s._id as unknown as string })
                  }
                  disabled={dup}
                  className={cn(
                    'w-full flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left text-xs',
                    dup
                      ? 'border-border/50 text-muted-foreground/50'
                      : 'border-border text-foreground hover:bg-muted',
                  )}
                >
                  <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="font-semibold flex-1 truncate">
                    {s.name}
                  </span>
                  <span className="text-muted-foreground">
                    G{s.schoolGrade}
                  </span>
                  {dup && <span className="text-[9px]">added</span>}
                </button>
              );
            })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
