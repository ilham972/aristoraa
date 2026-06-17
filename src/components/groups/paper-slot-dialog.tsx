'use client';

// PaperSlotDialog — the full-screen "room step" for one Library hour slot.
// Opened by tapping an occupied slot on the grid. Shows every room SIDE BY
// SIDE (horizontal scroll) plus an "Unassigned" column. Distribute students
// the same tap-and-drop way as the grid: tap a student (it glows) → tap a
// room to drop them there. Each room takes an OPTIONAL supervising teacher;
// capacity is a soft amber warning, never a block. Removing a student here
// takes them out of the slot entirely.
//
// Attendance does NOT live here — it's the daily Library roll-call on the
// Session view.

import { useMemo, useState } from 'react';
import { useMutation } from 'convex/react';
import { useCachedQuery as useQuery } from '@/hooks/use-cached-query';
import { toast } from 'sonner';
import { DoorOpen, GraduationCap, Plus, Search, Users, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { DAYS, fmtTime12 } from '@/lib/groups/time-grid';

type Slot = { dayOfWeek: number; startTime: string };

export function PaperSlotDialog({
  slot,
  open,
  onClose,
}: {
  slot: Slot | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!open || !slot) return null;
  return <SlotBody slot={slot} onClose={onClose} />;
}

function SlotBody({ slot, onClose }: { slot: Slot; onClose: () => void }) {
  const detail = useQuery(api.paperClasses.slot, { dayOfWeek: slot.dayOfWeek, startTime: slot.startTime });
  const teachers = useQuery(api.teachers.list);
  const rail = useQuery(api.paperClasses.rail);

  const setRoom = useMutation(api.paperClasses.setRoom);
  const setSlotTeacher = useMutation(api.paperClasses.setSlotTeacher);
  const unassign = useMutation(api.paperClasses.unassign);
  const assign = useMutation(api.paperClasses.assign);

  // A student currently in the slot, "picked up" to move into a room.
  const [picked, setPicked] = useState<Id<'students'> | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const dayLabel = DAYS.find((d) => d.num === slot.dayOfWeek)?.full ?? '';

  const drop = async (roomId: Id<'rooms'> | null) => {
    if (!picked) return;
    try {
      await setRoom({ studentId: picked, dayOfWeek: slot.dayOfWeek, startTime: slot.startTime, roomId });
      setPicked(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not move student');
    }
  };

  const remove = async (studentId: Id<'students'>) => {
    try {
      await unassign({ studentId, dayOfWeek: slot.dayOfWeek, startTime: slot.startTime });
      if (picked === studentId) setPicked(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove');
    }
  };

  const changeTeacher = async (roomId: Id<'rooms'>, teacherId: string) => {
    try {
      await setSlotTeacher({
        dayOfWeek: slot.dayOfWeek,
        startTime: slot.startTime,
        roomId,
        teacherId: teacherId === '__none__' ? null : (teacherId as Id<'teachers'>),
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not set teacher');
    }
  };

  const addToSlot = async (studentId: Id<'students'>) => {
    if (!detail) return;
    try {
      await assign({
        studentId,
        dayOfWeek: slot.dayOfWeek,
        startTime: slot.startTime,
        endTime: detail.endTime,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-border/50">
        <DoorOpen className="w-4 h-4 text-primary shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground truncate">
            {dayLabel} · {fmtTime12(slot.startTime)}
            {detail ? `–${fmtTime12(detail.endTime)}` : ''}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {detail ? `${detail.total} student${detail.total === 1 ? '' : 's'} in this hour` : 'Loading…'}
          </p>
        </div>
        <button
          onClick={() => setAddOpen((v) => !v)}
          className="shrink-0 inline-flex items-center gap-1 px-2 h-8 rounded-lg bg-primary/10 text-primary text-xs font-semibold"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
        <button onClick={onClose} className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-muted text-muted-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      {picked && (
        <div className="shrink-0 px-4 py-1.5 bg-primary/10 text-primary text-[11px] font-medium border-b border-primary/20">
          Moving a student — tap a room to drop them, or tap “Unassigned”.
        </div>
      )}

      {addOpen && detail && (
        <AddToSlot
          rail={rail}
          inSlot={new Set([
            ...detail.unassigned.map((s) => String(s.studentId)),
            ...detail.rooms.flatMap((r) => r.students.map((s) => String(s.studentId))),
          ])}
          onAdd={addToSlot}
        />
      )}

      {/* Rooms side by side */}
      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden">
        {detail === undefined ? (
          <div className="p-4 text-sm text-muted-foreground">Loading…</div>
        ) : detail === null ? (
          <div className="p-4 text-sm text-muted-foreground">Slot not found.</div>
        ) : (
          <div className="h-full flex gap-2 p-3" style={{ minWidth: 'min-content' }}>
            {/* Unassigned bucket first */}
            <Column
              title="Unassigned"
              icon={<Users className="w-3.5 h-3.5" />}
              students={detail.unassigned}
              picked={picked}
              onPick={setPicked}
              onDrop={() => drop(null)}
              onRemove={remove}
              droppable={picked !== null}
            />
            {detail.rooms.map((r) => {
              const over = r.capacity != null && r.students.length > r.capacity;
              return (
                <Column
                  key={r.roomId}
                  title={r.name}
                  icon={<DoorOpen className="w-3.5 h-3.5" />}
                  badge={
                    <span className={cn('tabular-nums', over && 'text-amber-600 font-semibold')}>
                      {r.students.length}
                      {r.capacity != null ? `/${r.capacity}` : ''}
                    </span>
                  }
                  warn={over ? `Over capacity (${r.capacity})` : undefined}
                  teacherSlot={
                    <Select
                      value={r.teacherId ? String(r.teacherId) : '__none__'}
                      onValueChange={(val) => changeTeacher(r.roomId, val ?? '__none__')}
                    >
                      <SelectTrigger className="h-7 text-[11px]">
                        <GraduationCap className="w-3 h-3 mr-1 text-muted-foreground" />
                        <SelectValue placeholder="Teacher" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">No teacher</SelectItem>
                        {(teachers ?? []).map((t: { _id: string; name: string }) => (
                          <SelectItem key={t._id} value={t._id}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  }
                  students={r.students}
                  picked={picked}
                  onPick={setPicked}
                  onDrop={() => drop(r.roomId)}
                  onRemove={remove}
                  droppable={picked !== null}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Column({
  title,
  icon,
  badge,
  warn,
  teacherSlot,
  students,
  picked,
  onPick,
  onDrop,
  onRemove,
  droppable,
}: {
  title: string;
  icon: React.ReactNode;
  badge?: React.ReactNode;
  warn?: string;
  teacherSlot?: React.ReactNode;
  students: Array<{ studentId: Id<'students'>; name: string; schoolGrade: number }>;
  picked: Id<'students'> | null;
  onPick: (id: Id<'students'> | null) => void;
  onDrop: () => void;
  onRemove: (id: Id<'students'>) => void;
  droppable: boolean;
}) {
  return (
    <div
      className={cn(
        'w-[180px] shrink-0 h-full flex flex-col rounded-xl border bg-card',
        droppable ? 'border-primary/50 border-dashed' : 'border-border/50',
      )}
    >
      <button
        onClick={droppable ? onDrop : undefined}
        className={cn(
          'shrink-0 px-2.5 py-2 border-b border-border/40 text-left',
          droppable && 'hover:bg-primary/10',
        )}
      >
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          {icon}
          <span className="truncate flex-1">{title}</span>
          {badge}
        </div>
        {warn && <p className="text-[10px] text-amber-600 mt-0.5">{warn}</p>}
        {droppable && <p className="text-[10px] text-primary mt-0.5">Tap to drop here</p>}
      </button>

      {teacherSlot && <div className="shrink-0 px-2 py-1.5 border-b border-border/40">{teacherSlot}</div>}

      <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1">
        {students.length === 0 ? (
          <p className="text-[11px] text-muted-foreground text-center py-3">Empty</p>
        ) : (
          students.map((s) => {
            const isPicked = picked === s.studentId;
            return (
              <div
                key={s.studentId}
                className={cn(
                  'flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-left',
                  isPicked
                    ? 'border-primary bg-primary/10 ring-1 ring-primary'
                    : 'border-border/40 bg-muted/30',
                )}
              >
                <button
                  onClick={() => onPick(isPicked ? null : s.studentId)}
                  className="flex-1 min-w-0 text-left"
                  title="Tap to move"
                >
                  <span className="text-xs text-foreground truncate block">{s.name}</span>
                  <span className="text-[9px] text-muted-foreground">G{s.schoolGrade}</span>
                </button>
                <button
                  onClick={() => onRemove(s.studentId)}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  title="Remove from this hour"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function AddToSlot({
  rail,
  inSlot,
  onAdd,
}: {
  rail: Array<{ studentId: Id<'students'>; name: string; schoolGrade: number }> | undefined;
  inSlot: Set<string>;
  onAdd: (id: Id<'students'>) => void;
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const list = (rail ?? []).filter((s) => !inSlot.has(String(s.studentId)));
    const needle = q.trim().toLowerCase();
    return needle ? list.filter((s) => s.name.toLowerCase().includes(needle)) : list;
  }, [rail, inSlot, q]);

  return (
    <div className="shrink-0 border-b border-border/50 px-3 py-2">
      <div className="relative mb-1.5">
        <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a student to this hour…" className="h-8 pl-7 text-xs" />
      </div>
      <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="text-[11px] text-muted-foreground py-1">No students to add.</p>
        ) : (
          filtered.slice(0, 40).map((s) => (
            <button
              key={s.studentId}
              onClick={() => onAdd(s.studentId)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-border/50 bg-muted/40 text-[11px] hover:border-primary/50"
            >
              <Plus className="w-3 h-3 text-primary" />
              <span className="truncate max-w-[7rem]">{s.name}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
