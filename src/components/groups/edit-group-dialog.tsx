'use client';

// Edit-Group full-screen dialog (Phase F.5). One surface to: rename, set mentor /
// grade / centre / default room, manage members, and paint the group's
// weekly sessions. Auto-name regenerates from members unless the user has
// typed a custom name. Conflicts surface as grid overlays + inline warnings.
//
// Performance: the dialog renders its chrome (header / selects / empty grid /
// footer) on the first paint using a `seed` from the parent's weekGrid list,
// then progressively fills in as each Convex query resolves. The cross-group
// conflict scan is non-blocking — the grid paints without rings first.

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { toast } from 'sonner';
import { Plus, Search, Trash2, X, Archive, ArchiveRestore, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, type Id } from '@/lib/convex';
import { groupColor } from '@/lib/groups/color';
import { generateAutoName } from '@/lib/groups/naming';
import { fmtLKR, type DayNum, type HourBand } from '@/lib/groups/time-grid';
import { WeeklySessionGrid, type SessionCell } from './weekly-session-grid';

const nativeSelectClass =
  'mt-0.5 h-8 w-full text-xs bg-transparent border border-input rounded-lg px-2 ' +
  'focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:opacity-50 ' +
  'dark:bg-input/30 appearance-none cursor-pointer ' +
  "bg-[url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><polyline points='6 9 12 15 18 9'/></svg>\")] " +
  'bg-no-repeat bg-[right_8px_center] pr-7';

export type EditGroupSeed = {
  _id: Id<'groups'>;
  name: string;
  grade?: number;
  memberCount: number;
  sessionCount: number;
};

export function EditGroupDialog({
  groupId,
  seed,
  open,
  onClose,
}: {
  groupId: Id<'groups'> | null;
  seed?: EditGroupSeed;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className="fixed inset-0 z-50 bg-background/40 duration-75 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        />
        <DialogPrimitive.Popup
          className="fixed inset-0 z-50 bg-background outline-none duration-75 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        >
          <DialogPrimitive.Title className="sr-only">Edit group</DialogPrimitive.Title>
          {groupId && <EditGroupBody groupId={groupId} seed={seed} onClose={onClose} />}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function EditGroupBody({
  groupId,
  seed,
  onClose,
}: {
  groupId: Id<'groups'>;
  seed?: EditGroupSeed;
  onClose: () => void;
}) {
  const group = useQuery(api.groups.get, { id: groupId });
  const members = useQuery(api.groups.members, { groupId });
  const sessions = useQuery(api.groups.sessions, { groupId });
  // Conflicts run cross-group and are the slowest query in this set.
  // Treat as decoration: grid paints without rings, then they fill in.
  const conflicts = useQuery(api.groups.sessionConflicts, { groupId });
  const allStudents = useQuery(api.students.list);
  const teachers = useQuery(api.teachers.list);
  const rooms = useQuery(api.rooms.list);
  const centers = useQuery(api.centers.list);
  const groupRevenue = useQuery(api.groups.revenue, { groupId });

  const update = useMutation(api.groups.update);
  const archive = useMutation(api.groups.archive);
  const remove = useMutation(api.groups.remove);
  const addMember = useMutation(api.groups.addMember);
  const removeMember = useMutation(api.groups.removeMember);
  const toggleSession = useMutation(api.groups.toggleSession);

  const [nameInput, setNameInput] = useState(seed?.name ?? '');
  const [nameSeededFor, setNameSeededFor] = useState<Id<'groups'> | null>(null);
  const [studentSearch, setStudentSearch] = useState('');
  const [addingStudent, setAddingStudent] = useState(false);

  // Seed the editable name field once per group (render-time reset pattern).
  // We prefer the authoritative group.name once it loads; before that, the
  // seed.name from the parent's weekGrid is already in nameInput.
  if (group && nameSeededFor !== group._id) {
    setNameInput(group.name);
    setNameSeededFor(group._id);
  }

  const color = useMemo(
    () => groupColor(groupId, group?.archived),
    [groupId, group?.archived],
  );

  const selectedCells: SessionCell[] = useMemo(
    () =>
      (sessions ?? []).map((s) => ({
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
      })),
    [sessions],
  );

  // Memoize candidate-filtering so typing in the search box doesn't re-walk
  // the full student list on every keystroke (cheap now, scales later).
  const memberIds = useMemo(
    () => new Set((members ?? []).map((m) => m._id)),
    [members],
  );
  const candidates = useMemo(() => {
    if (!allStudents) return [];
    const q = studentSearch.toLowerCase();
    return allStudents
      .filter((s) => !memberIds.has(s._id))
      .filter((s) => s.name.toLowerCase().includes(q));
  }, [allStudents, memberIds, studentSearch]);

  const offCentreMembers = group?.centerId
    ? (members ?? []).filter((m) => m.centerId && m.centerId !== group.centerId)
    : [];
  const offGradeMembers = group?.grade != null
    ? (members ?? []).filter((m) => m.schoolGrade !== group.grade)
    : [];

  const commitName = async () => {
    if (!group) return;
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === group.name) return;
    await update({ id: group._id, name: trimmed, autoName: false });
    toast.success('Renamed');
  };

  const regenName = async () => {
    if (!group || !members) return;
    const auto = generateAutoName(members.map((m) => m.name));
    setNameInput(auto);
    await update({ id: group._id, name: auto, autoName: true });
    toast.success('Name reset to auto');
  };

  const handleAddMember = async (studentId: Id<'students'>) => {
    if (!group || !members || !allStudents) return;
    await addMember({ groupId: group._id, studentId });
    if (group.autoName) {
      const names = [...members.map((m) => m.name), allStudents.find((s) => s._id === studentId)?.name ?? ''];
      const auto = generateAutoName(names);
      await update({ id: group._id, name: auto });
      setNameInput(auto);
    }
    setStudentSearch('');
    setAddingStudent(false);
  };

  const handleRemoveMember = async (studentId: Id<'students'>) => {
    if (!group || !members) return;
    await removeMember({ groupId: group._id, studentId });
    if (group.autoName) {
      const names = members.filter((m) => m._id !== studentId).map((m) => m.name);
      const auto = generateAutoName(names);
      await update({ id: group._id, name: auto });
      setNameInput(auto);
    }
  };

  const handleToggleCell = async (day: DayNum, band: HourBand) => {
    if (!group) return;
    if (!group.defaultRoomId) {
      toast.error('Set a default room first');
      return;
    }
    try {
      const res = await toggleSession({
        groupId: group._id,
        dayOfWeek: day,
        startTime: band.start,
        endTime: band.end,
      });
      if (res.action === 'added') toast.success(`Added ${band.label}`);
      else if (res.action === 'removed') toast(`Removed ${band.label}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not toggle session');
    }
  };

  // Effective values: prefer authoritative `group` once loaded, else seed.
  const displayName = group?.name ?? seed?.name ?? '';
  const memberCount = members?.length ?? seed?.memberCount ?? 0;
  const sessionCount = sessions?.length ?? seed?.sessionCount ?? 0;
  const groupReady = !!group;
  const refsReady = !!(teachers && rooms && centers && allStudents);

  return (
    // h-dvh ties the layout to the dynamic viewport so mobile chrome (URL
    // bar) doesn't push parts off-screen. Inner column never scrolls — the
    // only overflow region is the members chip strip in the middle.
    <div className="h-dvh max-w-lg mx-auto px-3 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 pt-3 pb-2 shrink-0">
        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color.solid }} />
        <Input
          value={groupReady ? nameInput : displayName}
          onChange={(e) => setNameInput(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          disabled={!groupReady}
          className="font-semibold text-base border-0 px-0 h-auto focus-visible:ring-0 bg-transparent disabled:opacity-100"
        />
        {group && !group.autoName && (
          <button onClick={regenName} className="text-[10px] text-muted-foreground hover:text-foreground shrink-0 underline">
            auto
          </button>
        )}
        <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground shrink-0" aria-label="Close">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Stats line */}
      <div className="flex items-center gap-2 mb-2 text-[11px] text-muted-foreground shrink-0">
        <span>{memberCount} member{memberCount !== 1 ? 's' : ''}</span>
        <span>·</span>
        <span>{sessionCount}/wk</span>
        {groupRevenue != null && (
          <>
            <span>·</span>
            <span className="font-semibold text-foreground">{fmtLKR(groupRevenue)}/wk</span>
          </>
        )}
      </div>

      {/* 4 selects in one row. Disabled until refs + group are ready so we
          don't flash a spurious "None / Any / Any / Pick" state. */}
      <div className="grid grid-cols-4 gap-1.5 mb-2 shrink-0">
        <div>
          <Label className="text-[10px] text-muted-foreground">Mentor</Label>
          <select
            className={nativeSelectClass}
            disabled={!groupReady || !refsReady}
            value={group?.mentorId ?? ''}
            onChange={(e) => group && update({ id: group._id, mentorId: (e.target.value || undefined) as Id<'teachers'> | undefined })}
          >
            <option value="">None</option>
            {(teachers ?? []).map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Grade</Label>
          <select
            className={nativeSelectClass}
            disabled={!groupReady}
            value={group?.grade != null ? String(group.grade) : ''}
            onChange={(e) => group && update({ id: group._id, grade: e.target.value ? Number(e.target.value) : undefined })}
          >
            <option value="">Any</option>
            {[6, 7, 8, 9, 10, 11].map((g) => <option key={g} value={String(g)}>G{g}</option>)}
          </select>
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Centre</Label>
          <select
            className={nativeSelectClass}
            disabled={!groupReady || !refsReady}
            value={group?.centerId ?? ''}
            onChange={(e) => group && update({ id: group._id, centerId: (e.target.value || undefined) as Id<'centers'> | undefined })}
          >
            <option value="">Any</option>
            {(centers ?? []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Room</Label>
          <select
            className={nativeSelectClass}
            disabled={!groupReady || !refsReady}
            value={group?.defaultRoomId ?? ''}
            onChange={(e) => group && update({ id: group._id, defaultRoomId: (e.target.value || undefined) as Id<'rooms'> | undefined })}
          >
            <option value="">Pick</option>
            {(rooms ?? []).map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}
          </select>
        </div>
      </div>

      {group && !group.defaultRoomId && (
        <p className="text-[10px] text-amber-600 mb-1.5 flex items-center gap-1 shrink-0">
          <AlertTriangle className="w-3 h-3" /> Set a default room to add sessions.
        </p>
      )}

      {/* Members — the one region allowed to overflow, so the rest of the
          layout stays fixed regardless of roster size. */}
      <div className="flex items-center justify-between mb-1 shrink-0">
        <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Members ({memberCount})
        </Label>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs gap-1"
          disabled={!groupReady}
          onClick={() => setAddingStudent((v) => !v)}
        >
          <Plus className="w-3 h-3" /> Add
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto mb-2">
        <div className="flex flex-wrap gap-1.5">
          {(members ?? []).map((m) => {
            const offCentre = group?.centerId && m.centerId && m.centerId !== group.centerId;
            const offGrade = group?.grade != null && m.schoolGrade !== group.grade;
            return (
              <span
                key={m._id}
                className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-[11px]"
                style={{ backgroundColor: color.soft, color: color.text, border: `1px solid ${color.border}` }}
              >
                {m.name}
                {(offCentre || offGrade) && (
                  <AlertTriangle className="w-3 h-3 text-amber-500" />
                )}
                <button onClick={() => handleRemoveMember(m._id)} className="hover:text-destructive">
                  <X className="w-3 h-3" />
                </button>
              </span>
            );
          })}
          {members && members.length === 0 && (
            <span className="text-xs text-muted-foreground">No members yet</span>
          )}
        </div>

        {(offCentreMembers.length > 0 || offGradeMembers.length > 0) && (
          <div className="text-[10px] text-amber-600 space-y-0.5 mt-1">
            {offCentreMembers.length > 0 && (
              <p className="flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {offCentreMembers.map((m) => m.name).join(', ')} from another centre.
              </p>
            )}
            {offGradeMembers.length > 0 && group && (
              <p className="flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {offGradeMembers.map((m) => m.name).join(', ')} not Grade {group.grade}.
              </p>
            )}
          </div>
        )}

        {addingStudent && (
          <div className="rounded-lg border border-border/60 p-2 mt-1.5">
            <div className="relative mb-1.5">
              <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                placeholder="Search students…"
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                className="h-8 text-xs pl-7"
              />
            </div>
            <div className="max-h-40 overflow-y-auto space-y-0.5">
              {candidates.slice(0, 30).map((s) => (
                <button
                  key={s._id}
                  onClick={() => handleAddMember(s._id)}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-muted text-left text-xs"
                >
                  <span>{s.name}</span>
                  <span className="text-muted-foreground">G{s.schoolGrade}</span>
                </button>
              ))}
              {candidates.length === 0 && <p className="text-xs text-muted-foreground px-2 py-1">No matches</p>}
            </div>
          </div>
        )}
      </div>

      {/* Weekly sessions — pinned above the footer */}
      <div className="shrink-0 mb-2">
        <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
          Weekly sessions
        </Label>
        <WeeklySessionGrid
          selected={selectedCells}
          color={color}
          mentorBusy={conflicts?.mentorBusy ?? []}
          studentBusy={conflicts?.studentBusy ?? []}
          onToggle={handleToggleCell}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 pt-2 pb-2 border-t border-border/50 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="text-xs gap-1"
          disabled={!groupReady}
          onClick={async () => {
            if (!group) return;
            await archive({ id: group._id, archived: !group.archived });
            toast.success(group.archived ? 'Unarchived' : 'Archived');
            if (!group.archived) onClose();
          }}
        >
          {group?.archived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
          {group?.archived ? 'Unarchive' : 'Archive'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs gap-1 text-destructive hover:text-destructive ml-auto"
          disabled={!groupReady}
          onClick={async () => {
            if (!group) return;
            if (confirm(`Delete "${group.name}"? Sessions become unassigned; history is kept.`)) {
              await remove({ id: group._id });
              toast.success('Deleted');
              onClose();
            }
          }}
        >
          <Trash2 className="w-3.5 h-3.5" /> Delete
        </Button>
      </div>
    </div>
  );
}
