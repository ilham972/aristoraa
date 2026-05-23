'use client';

// Edit-Group bottom sheet (Phase F.5). One surface to: rename, set mentor /
// grade / centre / default room, manage members, and paint the group's
// weekly sessions. Auto-name regenerates from members unless the user has
// typed a custom name. Conflicts surface as grid overlays + inline warnings.

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { toast } from 'sonner';
import { Plus, Search, Trash2, X, Archive, ArchiveRestore, AlertTriangle } from 'lucide-react';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, type Id } from '@/lib/convex';
import { groupColor } from '@/lib/groups/color';
import { generateAutoName } from '@/lib/groups/naming';
import { fmtLKR, type DayNum, type HourBand } from '@/lib/groups/time-grid';
import { WeeklySessionGrid, type SessionCell } from './weekly-session-grid';

export function EditGroupDrawer({
  groupId,
  open,
  onClose,
}: {
  groupId: Id<'groups'> | null;
  open: boolean;
  onClose: () => void;
}) {
  const group = useQuery(api.groups.get, groupId ? { id: groupId } : 'skip');
  const members = useQuery(api.groups.members, groupId ? { groupId } : 'skip');
  const sessions = useQuery(api.groups.sessions, groupId ? { groupId } : 'skip');
  const conflicts = useQuery(api.groups.sessionConflicts, groupId ? { groupId } : 'skip');
  const allStudents = useQuery(api.students.list);
  const teachers = useQuery(api.teachers.list);
  const rooms = useQuery(api.rooms.list);
  const centers = useQuery(api.centers.list);
  const groupRevenue = useQuery(api.groups.revenue, groupId ? { groupId } : 'skip');

  const update = useMutation(api.groups.update);
  const archive = useMutation(api.groups.archive);
  const remove = useMutation(api.groups.remove);
  const addMember = useMutation(api.groups.addMember);
  const removeMember = useMutation(api.groups.removeMember);
  const toggleSession = useMutation(api.groups.toggleSession);

  const [nameInput, setNameInput] = useState('');
  const [nameSeededFor, setNameSeededFor] = useState<Id<'groups'> | null>(null);
  const [studentSearch, setStudentSearch] = useState('');
  const [addingStudent, setAddingStudent] = useState(false);

  // Seed the editable name field once per group (render-time reset pattern —
  // the documented alternative to a setState-in-effect). Local edits and our
  // own rename handlers keep nameInput in sync after seeding.
  if (group && nameSeededFor !== group._id) {
    setNameInput(group.name);
    setNameSeededFor(group._id);
  }

  const color = useMemo(
    () => groupColor(groupId ?? 'x', group?.archived),
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

  if (!group || !members || !allStudents || !teachers || !rooms || !centers) {
    return (
      <Drawer open={open} onOpenChange={(o) => !o && onClose()} modal={false}>
        <DrawerContent className="max-w-lg mx-auto">
          <div className="p-6 animate-pulse space-y-3">
            <div className="h-6 bg-muted rounded w-1/2" />
            <div className="h-20 bg-muted rounded" />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  const memberIds = new Set(members.map((m) => m._id));
  const candidates = allStudents
    .filter((s) => !memberIds.has(s._id))
    .filter((s) => s.name.toLowerCase().includes(studentSearch.toLowerCase()));

  // Cross-centre members (warning, not block).
  const offCentreMembers = group.centerId
    ? members.filter((m) => m.centerId && m.centerId !== group.centerId)
    : [];
  // Off-grade members.
  const offGradeMembers = group.grade != null
    ? members.filter((m) => m.schoolGrade !== group.grade)
    : [];

  const commitName = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === group.name) return;
    await update({ id: group._id, name: trimmed, autoName: false });
    toast.success('Renamed');
  };

  const regenName = async () => {
    const auto = generateAutoName(members.map((m) => m.name));
    setNameInput(auto);
    await update({ id: group._id, name: auto, autoName: true });
    toast.success('Name reset to auto');
  };

  const handleAddMember = async (studentId: Id<'students'>) => {
    await addMember({ groupId: group._id, studentId });
    // Re-derive auto name if the group is on auto-name.
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
    await removeMember({ groupId: group._id, studentId });
    if (group.autoName) {
      const names = members.filter((m) => m._id !== studentId).map((m) => m.name);
      const auto = generateAutoName(names);
      await update({ id: group._id, name: auto });
      setNameInput(auto);
    }
  };

  const handleToggleCell = async (day: DayNum, band: HourBand) => {
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

  const teacherRooms = rooms;
  const sessionCount = sessions?.length ?? 0;

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()} modal={false}>
      <DrawerContent className="max-w-lg mx-auto max-h-[88vh]">
        <div className="overflow-y-auto px-4 pb-6 pt-2">
          {/* Header: color dot + name + revenue */}
          <div className="flex items-center gap-2.5 mb-4">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color.solid }} />
            <Input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              className="font-semibold text-base border-0 px-0 h-auto focus-visible:ring-0 bg-transparent"
            />
            {!group.autoName && (
              <button onClick={regenName} className="text-[10px] text-muted-foreground hover:text-foreground shrink-0 underline">
                auto
              </button>
            )}
            <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground shrink-0">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center gap-3 mb-4 text-xs text-muted-foreground">
            <span>{members.length} member{members.length !== 1 ? 's' : ''}</span>
            <span>·</span>
            <span>{sessionCount} session{sessionCount !== 1 ? 's' : ''}/wk</span>
            {groupRevenue != null && (
              <>
                <span>·</span>
                <span className="font-semibold text-foreground">{fmtLKR(groupRevenue)}/wk</span>
              </>
            )}
          </div>

          {/* Group settings */}
          <div className="grid grid-cols-2 gap-2 mb-4">
            <div>
              <Label className="text-[11px] text-muted-foreground">Mentor</Label>
              <Select
                value={group.mentorId ?? ''}
                onValueChange={(v) => update({ id: group._id, mentorId: (v || undefined) as Id<'teachers'> | undefined })}
              >
                <SelectTrigger className="mt-0.5 h-8 text-xs"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  {teachers.map((t) => <SelectItem key={t._id} value={t._id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Grade</Label>
              <Select
                value={group.grade != null ? String(group.grade) : ''}
                onValueChange={(v) => update({ id: group._id, grade: v ? Number(v) : undefined })}
              >
                <SelectTrigger className="mt-0.5 h-8 text-xs"><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent>
                  {[6, 7, 8, 9, 10, 11].map((g) => <SelectItem key={g} value={String(g)}>Grade {g}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Centre</Label>
              <Select
                value={group.centerId ?? ''}
                onValueChange={(v) => update({ id: group._id, centerId: (v || undefined) as Id<'centers'> | undefined })}
              >
                <SelectTrigger className="mt-0.5 h-8 text-xs"><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent>
                  {centers.map((c) => <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Default room</Label>
              <Select
                value={group.defaultRoomId ?? ''}
                onValueChange={(v) => update({ id: group._id, defaultRoomId: (v || undefined) as Id<'rooms'> | undefined })}
              >
                <SelectTrigger className="mt-0.5 h-8 text-xs"><SelectValue placeholder="Pick room" /></SelectTrigger>
                <SelectContent>
                  {teacherRooms.map((r) => <SelectItem key={r._id} value={r._id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {!group.defaultRoomId && (
            <p className="text-[11px] text-amber-600 mb-3 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Set a default room to add sessions.
            </p>
          )}

          {/* Members */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Members ({members.length})
              </Label>
              <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => setAddingStudent((v) => !v)}>
                <Plus className="w-3 h-3" /> Add
              </Button>
            </div>

            <div className="flex flex-wrap gap-1.5 mb-2">
              {members.map((m) => {
                const offCentre = group.centerId && m.centerId && m.centerId !== group.centerId;
                const offGrade = group.grade != null && m.schoolGrade !== group.grade;
                return (
                  <span
                    key={m._id}
                    className="inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-full text-xs"
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
              {members.length === 0 && <span className="text-xs text-muted-foreground">No members yet</span>}
            </div>

            {(offCentreMembers.length > 0 || offGradeMembers.length > 0) && (
              <div className="text-[11px] text-amber-600 space-y-0.5 mb-2">
                {offCentreMembers.length > 0 && (
                  <p className="flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {offCentreMembers.map((m) => m.name).join(', ')} from another centre.
                  </p>
                )}
                {offGradeMembers.length > 0 && (
                  <p className="flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {offGradeMembers.map((m) => m.name).join(', ')} not Grade {group.grade}.
                  </p>
                )}
              </div>
            )}

            {addingStudent && (
              <div className="rounded-lg border border-border/60 p-2">
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

          {/* Weekly sessions */}
          <div className="mb-4">
            <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
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

          {/* Footer actions */}
          <div className="flex items-center gap-2 pt-2 border-t border-border/50">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs gap-1"
              onClick={async () => {
                await archive({ id: group._id, archived: !group.archived });
                toast.success(group.archived ? 'Unarchived' : 'Archived');
                if (!group.archived) onClose();
              }}
            >
              {group.archived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
              {group.archived ? 'Unarchive' : 'Archive'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs gap-1 text-destructive hover:text-destructive ml-auto"
              onClick={async () => {
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
      </DrawerContent>
    </Drawer>
  );
}
