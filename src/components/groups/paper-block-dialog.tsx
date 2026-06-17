'use client';

// Create / manage one paper (Library) block. Three jobs in one sheet:
//   1. Block setup — room (capacity shown), day, time, supervising teacher.
//   2. Roster — availability-aware "add student" + "drop a whole group in",
//      with a live x / capacity headcount.
//   3. Attendance — per-date roll-call (everyone present unless toggled
//      absent) that drives the flat 100 LKR / student / day billing.
//
// When `blockId` is null the dialog opens in create mode; on save it creates
// the block then flips to manage mode for the new block id.

import { useMemo, useState } from 'react';
import { useMutation } from 'convex/react';
import { useCachedQuery as useQuery } from '@/hooks/use-cached-query';
import { toast } from 'sonner';
import {
  CalendarClock, DoorOpen, GraduationCap, Plus, Search, Trash2, UserMinus,
  Users, X,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { DAYS, fmtTime12, fmtLKR } from '@/lib/groups/time-grid';

const PAPER_RATE = 100;

// Whole-hour options 08:00–22:00 for the start/end pickers.
const HOUR_OPTIONS = Array.from({ length: 15 }, (_, i) => {
  const h = 8 + i;
  return `${String(h).padStart(2, '0')}:00`;
});

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type Seed = { dayOfWeek: number; startTime: string; endTime: string };

export function PaperBlockDialog({
  blockId,
  seed,
  open,
  onClose,
}: {
  blockId: Id<'paperBlocks'> | null;
  seed?: Seed;
  open: boolean;
  onClose: () => void;
}) {
  // The block we're managing: either the prop (existing) or one we just made.
  // Reset to the prop whenever the dialog (re)opens or targets a different
  // block — done during render (not an effect) per the React "you might not
  // need an effect" pattern, so a freshly-created block id survives until close.
  const [localId, setLocalId] = useState<Id<'paperBlocks'> | null>(blockId);
  const [seen, setSeen] = useState<{ blockId: Id<'paperBlocks'> | null; open: boolean }>({ blockId, open });
  if (seen.blockId !== blockId || seen.open !== open) {
    setSeen({ blockId, open });
    setLocalId(blockId);
  }

  const isCreating = localId === null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2 border-b border-border/40">
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            <DoorOpen className="w-4 h-4 text-primary" />
            {isCreating ? 'New paper block' : 'Paper block'}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[78vh] overflow-y-auto">
          {isCreating ? (
            <CreateForm seed={seed} onCreated={(id) => setLocalId(id)} />
          ) : (
            <ManageBlock blockId={localId!} onDeleted={onClose} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Create ──────────────────────────────────────────────────────────────────

function CreateForm({
  seed,
  onCreated,
}: {
  seed?: Seed;
  onCreated: (id: Id<'paperBlocks'>) => void;
}) {
  const rooms = useQuery(api.rooms.list);
  const teachers = useQuery(api.teachers.list);
  const createBlock = useMutation(api.paperClasses.createBlock);

  const [roomId, setRoomId] = useState<string>('');
  const [teacherId, setTeacherId] = useState<string>('');
  const [day, setDay] = useState<number>(seed?.dayOfWeek ?? 1);
  const [start, setStart] = useState<string>(seed?.startTime ?? '15:00');
  const [end, setEnd] = useState<string>(seed?.endTime ?? '17:00');
  const [saving, setSaving] = useState(false);

  const selectedRoom = rooms?.find((r: { _id: string }) => r._id === roomId) as
    | { _id: string; name: string; capacity?: number }
    | undefined;

  // Non-blocking heads-up: is this room also running a personal class then?
  const personalClash = useQuery(
    api.paperClasses.personalClashAt,
    roomId && end > start
      ? { roomId: roomId as Id<'rooms'>, dayOfWeek: day, startTime: start, endTime: end }
      : 'skip',
  );

  const save = async () => {
    if (!roomId) return toast.error('Pick a room');
    if (!teacherId) return toast.error('Pick a supervising teacher');
    if (end <= start) return toast.error('End time must be after start');
    setSaving(true);
    try {
      const id = await createBlock({
        dayOfWeek: day,
        startTime: start,
        endTime: end,
        roomId: roomId as Id<'rooms'>,
        teacherId: teacherId as Id<'teachers'>,
      });
      toast.success('Paper block created');
      onCreated(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create block');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-4 py-3 space-y-3">
      <div>
        <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Room</label>
        <Select value={roomId} onValueChange={(v) => setRoomId(v ?? '')}>
          <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Select room" /></SelectTrigger>
          <SelectContent>
            {rooms?.map((r: { _id: string; name: string; capacity?: number }) => (
              <SelectItem key={r._id} value={r._id}>
                {r.name}{r.capacity != null ? ` · cap ${r.capacity}` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedRoom && selectedRoom.capacity == null && (
          <p className="text-[10px] text-amber-600 mt-1">
            This room has no capacity set — add one in Settings → Centers.
          </p>
        )}
      </div>

      <div>
        <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Supervising teacher</label>
        <Select value={teacherId} onValueChange={(v) => setTeacherId(v ?? '')}>
          <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Select teacher" /></SelectTrigger>
          <SelectContent>
            {teachers?.map((t: { _id: string; name: string }) => (
              <SelectItem key={t._id} value={t._id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Day</label>
          <Select value={String(day)} onValueChange={(v) => setDay(Number(v))}>
            <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DAYS.map((d) => (
                <SelectItem key={d.num} value={String(d.num)}>{d.short}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Start</label>
          <Select value={start} onValueChange={(v) => setStart(v ?? '15:00')}>
            <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {HOUR_OPTIONS.map((t) => <SelectItem key={t} value={t}>{fmtTime12(t)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">End</label>
          <Select value={end} onValueChange={(v) => setEnd(v ?? '17:00')}>
            <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {HOUR_OPTIONS.map((t) => <SelectItem key={t} value={t}>{fmtTime12(t)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {personalClash && personalClash.length > 0 && (
        <p className="text-[11px] text-amber-600 bg-amber-500/10 rounded-lg px-2 py-1.5">
          Heads up: {selectedRoom?.name ?? 'this room'} also runs a personal class then
          ({personalClash.join(', ')}). You can still create it — just make sure the
          room is actually free or pick another.
        </p>
      )}

      <Button onClick={save} disabled={saving} className="w-full rounded-xl">
        {saving ? 'Creating…' : 'Create block'}
      </Button>
    </div>
  );
}

// ── Manage ──────────────────────────────────────────────────────────────────

function ManageBlock({
  blockId,
  onDeleted,
}: {
  blockId: Id<'paperBlocks'>;
  onDeleted: () => void;
}) {
  const block = useQuery(api.paperClasses.block, { blockId });
  const removeBlock = useMutation(api.paperClasses.removeBlock);

  const dayLabel = useMemo(
    () => DAYS.find((d) => d.num === block?.dayOfWeek)?.full ?? '',
    [block?.dayOfWeek],
  );

  if (block === undefined) {
    return <div className="px-4 py-8 animate-pulse text-center text-xs text-muted-foreground">Loading…</div>;
  }
  if (block === null) {
    return <div className="px-4 py-8 text-center text-xs text-muted-foreground">Block not found.</div>;
  }

  const full = block.capacity != null && block.roster.length >= block.capacity;

  const handleDelete = async () => {
    if (!confirm('Delete this paper block and its attendance history?')) return;
    try {
      await removeBlock({ blockId });
      toast.success('Block deleted');
      onDeleted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete');
    }
  };

  return (
    <div className="divide-y divide-border/40">
      {/* Summary */}
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <DoorOpen className="w-3.5 h-3.5 text-muted-foreground" />
              {block.roomName}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="w-3 h-3" />
                {dayLabel} · {fmtTime12(block.startTime)}–{fmtTime12(block.endTime)}
              </span>
              <span className="inline-flex items-center gap-1">
                <GraduationCap className="w-3 h-3" />
                {block.teacherName}
              </span>
            </p>
          </div>
          <button
            onClick={handleDelete}
            className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            title="Delete block"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="mt-2 flex items-center gap-2 text-[11px]">
          <span className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium tabular-nums',
            full ? 'bg-amber-500/15 text-amber-600' : 'bg-muted text-muted-foreground',
          )}>
            <Users className="w-3 h-3" />
            {block.roster.length}{block.capacity != null ? ` / ${block.capacity}` : ''}
            {full && ' · full'}
          </span>
        </div>
      </div>

      <RosterSection blockId={blockId} roster={block.roster} full={full} />
      <AttendanceSection blockId={blockId} roster={block.roster} />
    </div>
  );
}

// ── Roster ──────────────────────────────────────────────────────────────────

function RosterSection({
  blockId,
  roster,
  full,
}: {
  blockId: Id<'paperBlocks'>;
  roster: Array<{ studentId: Id<'students'>; name: string; schoolGrade: number }>;
  full: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [groupPicker, setGroupPicker] = useState(false);
  const removeStudent = useMutation(api.paperClasses.removeStudent);

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Roster</p>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-7 rounded-lg gap-1 text-xs" onClick={() => setGroupPicker((v) => !v)}>
            <Users className="w-3.5 h-3.5" /> Add group
          </Button>
          <Button variant="outline" size="sm" className="h-7 rounded-lg gap-1 text-xs" onClick={() => setAdding((v) => !v)}>
            <Plus className="w-3.5 h-3.5" /> Add
          </Button>
        </div>
      </div>

      {roster.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">No students yet. Add some or drop a group in.</p>
      ) : (
        <ul className="space-y-1">
          {roster.map((s) => (
            <li key={s.studentId} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/40">
              <span className="text-xs text-foreground flex-1 truncate">{s.name}</span>
              <span className="text-[10px] text-muted-foreground">G{s.schoolGrade}</span>
              <button
                onClick={() => removeStudent({ blockId, studentId: s.studentId })}
                className="text-muted-foreground hover:text-destructive"
                title="Remove from block"
              >
                <UserMinus className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {groupPicker && <GroupDropIn blockId={blockId} onDone={() => setGroupPicker(false)} />}
      {adding && <AddStudent blockId={blockId} full={full} />}
    </div>
  );
}

function AddStudent({ blockId, full }: { blockId: Id<'paperBlocks'>; full: boolean }) {
  const candidates = useQuery(api.paperClasses.candidateStudents, { blockId });
  const addStudent = useMutation(api.paperClasses.addStudent);
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const list = candidates ?? [];
    if (!q.trim()) return list;
    const needle = q.trim().toLowerCase();
    return list.filter((c) => c.name.toLowerCase().includes(needle));
  }, [candidates, q]);

  const add = async (studentId: Id<'students'>, free: boolean, reason?: string) => {
    if (!free && !confirm(`This student is busy (${reason ?? 'conflict'}). Add anyway?`)) return;
    try {
      await addStudent({ blockId, studentId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add');
    }
  };

  return (
    <div className="mt-2 rounded-lg border border-border/50 p-2">
      {full && (
        <p className="text-[10px] text-amber-600 mb-1">Room is full — adding more will be blocked.</p>
      )}
      <div className="relative mb-1.5">
        <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search students…" className="h-8 pl-7 text-xs" />
      </div>
      <div className="max-h-44 overflow-y-auto space-y-0.5">
        {candidates === undefined ? (
          <p className="text-[11px] text-muted-foreground py-2 text-center">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-[11px] text-muted-foreground py-2 text-center">No matching students.</p>
        ) : (
          filtered.map((c) => (
            <button
              key={c._id}
              onClick={() => add(c._id, c.free, c.reason)}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-muted/60 transition-colors',
                !c.free && 'opacity-60',
              )}
            >
              <span className="text-xs flex-1 truncate text-foreground">{c.name}</span>
              <span className="text-[10px] text-muted-foreground">G{c.schoolGrade}</span>
              {c.free ? (
                <Plus className="w-3.5 h-3.5 text-primary" />
              ) : (
                <span className="text-[9px] text-amber-600 truncate max-w-[6rem]" title={c.reason}>
                  {c.reason ?? 'busy'}
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function GroupDropIn({ blockId, onDone }: { blockId: Id<'paperBlocks'>; onDone: () => void }) {
  const groups = useQuery(api.groups.list);
  const addGroup = useMutation(api.paperClasses.addGroup);
  const [busy, setBusy] = useState<string | null>(null);

  const drop = async (groupId: Id<'groups'>) => {
    setBusy(groupId);
    try {
      const res = await addGroup({ blockId, groupId });
      const parts = [`Added ${res.added}`];
      if (res.skippedBusy.length) parts.push(`${res.skippedBusy.length} busy skipped`);
      if (res.skippedCapacity) parts.push(`${res.skippedCapacity} over capacity`);
      toast.success(parts.join(' · '));
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add group');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-2 rounded-lg border border-border/50 p-2">
      <p className="text-[10px] text-muted-foreground mb-1.5">
        Drops every free member in. Busy members and anyone over capacity are skipped.
      </p>
      <div className="max-h-44 overflow-y-auto space-y-0.5">
        {groups === undefined ? (
          <p className="text-[11px] text-muted-foreground py-2 text-center">Loading…</p>
        ) : groups.length === 0 ? (
          <p className="text-[11px] text-muted-foreground py-2 text-center">No groups yet.</p>
        ) : (
          groups.map((g: { _id: string; name: string }) => (
            <button
              key={g._id}
              onClick={() => drop(g._id as Id<'groups'>)}
              disabled={busy !== null}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-muted/60 transition-colors disabled:opacity-50"
            >
              <Users className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs flex-1 truncate text-foreground">{g.name}</span>
              {busy === g._id && <span className="text-[10px] text-muted-foreground">…</span>}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ── Attendance ──────────────────────────────────────────────────────────────

function AttendanceSection({
  blockId,
  roster,
}: {
  blockId: Id<'paperBlocks'>;
  roster: Array<{ studentId: Id<'students'>; name: string; schoolGrade: number }>;
}) {
  const [date, setDate] = useState<string>(todayYmd());
  const existing = useQuery(api.paperClasses.attendanceForDate, { blockId, date });
  const submit = useMutation(api.paperClasses.submitAttendance);

  // Everyone present unless toggled absent. Seed the absent set from saved
  // records once per (block, date) when the query has loaded — done during
  // render rather than in an effect so it doesn't clobber the user's toggles
  // on every query refresh.
  const [absent, setAbsent] = useState<Set<string>>(new Set());
  const [seededKey, setSeededKey] = useState<string | null>(null);
  const seedKey = `${blockId}|${date}`;
  if (existing !== undefined && seededKey !== seedKey) {
    setSeededKey(seedKey);
    const a = new Set<string>();
    for (const r of existing) if (r.status === 'absent') a.add(String(r.studentId));
    setAbsent(a);
  }

  const presentCount = roster.filter((s) => !absent.has(String(s.studentId))).length;
  const revenue = presentCount * PAPER_RATE;

  const toggle = (id: Id<'students'>) => {
    setAbsent((prev) => {
      const next = new Set(prev);
      const k = String(id);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const save = async () => {
    const presentStudentIds = roster
      .filter((s) => !absent.has(String(s.studentId)))
      .map((s) => s.studentId);
    try {
      await submit({ blockId, date, presentStudentIds });
      toast.success(`Attendance saved · ${fmtLKR(revenue)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    }
  };

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between mb-2 gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Attendance</p>
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-7 w-[140px] text-xs"
        />
      </div>

      {roster.length === 0 ? (
        <p className="text-xs text-muted-foreground py-1">Add students to take attendance.</p>
      ) : (
        <>
          <ul className="space-y-1 mb-2">
            {roster.map((s) => {
              const isAbsent = absent.has(String(s.studentId));
              return (
                <li key={s.studentId} className="flex items-center gap-2">
                  <button
                    onClick={() => toggle(s.studentId)}
                    className={cn(
                      'flex-1 flex items-center gap-2 px-2 py-1.5 rounded-md border text-left transition-colors',
                      isAbsent
                        ? 'border-border/40 bg-muted/20 text-muted-foreground'
                        : 'border-emerald-500/40 bg-emerald-500/10 text-foreground',
                    )}
                  >
                    <span className={cn(
                      'w-4 h-4 rounded-full flex items-center justify-center shrink-0',
                      isAbsent ? 'bg-muted-foreground/20' : 'bg-emerald-500 text-white',
                    )}>
                      {isAbsent ? <X className="w-2.5 h-2.5" /> : <span className="text-[9px] font-bold">✓</span>}
                    </span>
                    <span className="text-xs flex-1 truncate">{s.name}</span>
                    <span className="text-[10px]">{isAbsent ? 'Absent' : 'Present'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {presentCount}/{roster.length} present · <span className="text-foreground font-semibold">{fmtLKR(revenue)}</span>
            </span>
            <Button onClick={save} size="sm" className="h-8 rounded-lg">
              Save attendance
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
