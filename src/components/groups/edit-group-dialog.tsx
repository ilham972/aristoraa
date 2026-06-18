'use client';

// Edit-Group full-screen dialog (Phase F.5+).
//
// Surfaces in one screen: name, mentor / grade (multi) / centre / room,
// members, weekly sessions.
//
// Decisions baked into this surface:
//   - Mentor defaults to the current authenticated teacher on create (server
//     side, in groups.create) — no manual pick needed every time.
//   - Grade is a *set*: one primary + up to 2 extras. Member adds are
//     server-enforced to belong to that set (no more soft warning).
//   - Add-member picker uses groups.candidateStudents — server-filtered by
//     accepted grades, with same-other-group students hidden by default and
//     a "show all" toggle to reveal them.
//   - Mentor / Centre / Room use shadcn Select; Grade uses a Base UI Popover
//     because its multi-axis (primary radio + extras checkboxes) doesn't fit
//     a single Select. Native <select> was retired now that we're in a Base
//     UI Dialog (vaul→Dialog removed the pointer-capture portal conflict).

import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { toast } from 'sonner';
import { Plus, Search, Trash2, X, AlertTriangle, Eye, EyeOff, ChevronDown, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { groupColor } from '@/lib/groups/color';
import { generateAutoName } from '@/lib/groups/naming';
import { fmtLKR, type DayNum, type HourBand } from '@/lib/groups/time-grid';
import { WeeklySessionGrid, type SessionCell } from './weekly-session-grid';

// Sentinel used as the Select value for "no selection" — Base UI Select
// doesn't reliably accept "" as a real option value, so we map None ↔ "__".
const NONE = '__';

const GRADE_OPTIONS = [6, 7, 8, 9, 10, 11] as const;

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
  branch = 'live',
}: {
  // In planning mode `groupId` is a draftGroups id; the dialog reads/writes the
  // draft tables instead of live (see branch handling in EditGroupBody).
  groupId: Id<'groups'> | null;
  seed?: EditGroupSeed;
  open: boolean;
  onClose: () => void;
  branch?: 'live' | 'draft';
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
          {groupId && <EditGroupBody groupId={groupId} seed={seed} onClose={onClose} branch={branch} />}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function EditGroupBody({
  groupId,
  seed,
  onClose,
  branch,
}: {
  groupId: Id<'groups'>;
  seed?: EditGroupSeed;
  onClose: () => void;
  branch: 'live' | 'draft';
}) {
  // Planning mode points every query/mutation at the draft twin. Only these
  // initialisers branch — all downstream call sites use the same locals, so
  // the live path stays byte-identical. Each conditional ref is cast to its
  // LIVE twin's type: the twins share field shapes, so results stay fully
  // typed while the draft function runs at runtime (the id is a draftGroups id
  // but structurally identical). `conflicts`/`revenue` have no draft twin
  // (display-only), so they're skipped in draft mode.
  const draft = branch === 'draft';
  const E = api.timetableDraftEdit;

  const group = useQuery((draft ? E.getGroupDraft : api.groups.get) as typeof api.groups.get, { id: groupId });
  const members = useQuery((draft ? E.membersDraft : api.groups.members) as typeof api.groups.members, { groupId });
  const sessions = useQuery((draft ? E.sessionsDraft : api.groups.sessions) as typeof api.groups.sessions, { groupId });
  const conflicts = useQuery(
    (draft ? E.sessionConflictsDraft : api.groups.sessionConflicts) as typeof api.groups.sessionConflicts,
    { groupId },
  );
  const teachers = useQuery(api.teachers.list);
  const rooms = useQuery(api.rooms.list);
  const centers = useQuery(api.centers.list);
  const groupRevenue = useQuery(api.groups.revenue, draft ? 'skip' : { groupId });

  const [studentSearch, setStudentSearch] = useState('');
  const [addingStudent, setAddingStudent] = useState(false);
  const [includeInOtherGroups, setIncludeInOtherGroups] = useState(false);

  // Candidate list runs server-side, only when the picker is open.
  const candidates = useQuery(
    (draft ? E.candidateStudentsDraft : api.groups.candidateStudents) as typeof api.groups.candidateStudents,
    addingStudent ? { groupId, includeInOtherGroups } : 'skip',
  );

  const update = useMutation((draft ? E.updateGroupDraft : api.groups.update) as typeof api.groups.update);
  const remove = useMutation((draft ? E.removeGroupDraft : api.groups.remove) as typeof api.groups.remove);
  const addMember = useMutation((draft ? E.addMemberDraft : api.groups.addMember) as typeof api.groups.addMember);
  const removeMember = useMutation((draft ? E.removeMemberDraft : api.groups.removeMember) as typeof api.groups.removeMember);
  const setMemberFee = useMutation((draft ? E.setMemberFeeDraft : api.groups.setMemberFee) as typeof api.groups.setMemberFee);
  const toggleSession = useMutation((draft ? E.toggleSessionDraft : api.groups.toggleSession) as typeof api.groups.toggleSession);

  const [nameInput, setNameInput] = useState(seed?.name ?? '');
  const [nameSeededFor, setNameSeededFor] = useState<Id<'groups'> | null>(null);

  if (group && nameSeededFor !== group._id) {
    setNameInput(group.name);
    setNameSeededFor(group._id);
  }

  const color = useMemo(() => groupColor(groupId), [groupId]);

  const selectedCells: SessionCell[] = useMemo(
    () =>
      (sessions ?? []).map((s) => ({
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
      })),
    [sessions],
  );

  const offCentreMembers = group?.centerId
    ? (members ?? []).filter((m) => m.centerId && m.centerId !== group.centerId)
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

  const handleAddMember = async (studentId: Id<'students'>, studentName: string) => {
    if (!group || !members) return;
    try {
      await addMember({ groupId: group._id, studentId });
      if (group.autoName) {
        const names = [...members.map((m) => m.name), studentName];
        const auto = generateAutoName(names);
        await update({ id: group._id, name: auto });
        setNameInput(auto);
      }
      setStudentSearch('');
      setAddingStudent(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add student');
    }
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

  // Effective values.
  const displayName = group?.name ?? seed?.name ?? '';
  const memberCount = members?.length ?? seed?.memberCount ?? 0;
  const sessionCount = sessions?.length ?? seed?.sessionCount ?? 0;
  const groupReady = !!group;
  const refsReady = !!(teachers && rooms && centers);

  const acceptedGrades: number[] = group
    ? [
        ...(group.grade != null ? [group.grade] : []),
        ...(group.additionalGrades ?? []),
      ]
    : [];

  // Local filter applied to the server-filtered list (cheap; the heavy work
  // — grade match + cross-group exclusion — already happened server-side).
  const filteredCandidates = useMemo(() => {
    if (!candidates) return [];
    const q = studentSearch.toLowerCase();
    return q ? candidates.filter((s) => s.name.toLowerCase().includes(q)) : candidates;
  }, [candidates, studentSearch]);

  // Rooms are filtered to the selected centre. With no centre set the user
  // sees an empty list + a hint — picking a centre is required before a room
  // can be chosen.
  const filteredRooms = useMemo(() => {
    if (!rooms) return [];
    if (!group?.centerId) return [];
    return rooms.filter((r) => r.centerId === group.centerId);
  }, [rooms, group?.centerId]);

  // items-prop maps for the Select triggers. Base UI Select reads these to
  // render the selected value's label on the trigger — without them, the
  // trigger falls back to showing the raw id while the popup is closed
  // (which is what produced the "mentor id" leak the user saw).
  const mentorItems = useMemo(() => {
    const m: Record<string, ReactNode> = { [NONE]: 'None' };
    for (const t of teachers ?? []) m[t._id] = t.name;
    return m;
  }, [teachers]);
  const centerItems = useMemo(() => {
    const m: Record<string, ReactNode> = { [NONE]: 'Any' };
    for (const c of centers ?? []) m[c._id] = c.name;
    return m;
  }, [centers]);
  const roomItems = useMemo(() => {
    const m: Record<string, ReactNode> = { [NONE]: 'Pick' };
    for (const r of filteredRooms) m[r._id] = r.name;
    return m;
  }, [filteredRooms]);

  const triggerClass = 'w-full h-8 px-2 text-xs';

  return (
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

      {/* 4 controls in one row */}
      <div className="grid grid-cols-4 gap-1.5 mb-2 shrink-0">
        {/* Mentor */}
        <div className="min-w-0">
          <Label className="text-[10px] text-muted-foreground">Mentor</Label>
          <Select
            items={mentorItems}
            value={group?.mentorId ?? NONE}
            onValueChange={(v) =>
              group && update({
                id: group._id,
                mentorId: (v && v !== NONE ? (v as Id<'teachers'>) : undefined),
              })
            }
            disabled={!groupReady || !refsReady}
          >
            <SelectTrigger className={triggerClass} size="sm">
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None</SelectItem>
              {(teachers ?? []).map((t) => (
                <SelectItem key={t._id} value={t._id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Grade — popover with primary radio + extras checkboxes */}
        <div className="min-w-0">
          <Label className="text-[10px] text-muted-foreground">Grade</Label>
          <GradePopover
            disabled={!groupReady}
            primary={group?.grade}
            extras={group?.additionalGrades ?? []}
            onChange={(primary, extras) => {
              if (!group) return;
              update({
                id: group._id,
                grade: primary,
                additionalGrades: extras.length > 0 ? extras : undefined,
              });
            }}
          />
        </div>

        {/* Centre */}
        <div className="min-w-0">
          <Label className="text-[10px] text-muted-foreground">Centre</Label>
          <Select
            items={centerItems}
            value={group?.centerId ?? NONE}
            onValueChange={(v) => {
              if (!group) return;
              const nextCenter = v && v !== NONE ? (v as Id<'centers'>) : undefined;
              // If the room belongs to a different centre, fall back to the
              // new centre's defaultRoomId (or clear). Avoids the user seeing
              // a room from another centre after switching.
              let nextRoom = group.defaultRoomId;
              if (nextRoom) {
                const currentRoom = (rooms ?? []).find((r) => r._id === nextRoom);
                if (!currentRoom || currentRoom.centerId !== nextCenter) {
                  const newCenter = (centers ?? []).find((c) => c._id === nextCenter);
                  nextRoom = newCenter?.defaultRoomId ?? undefined;
                }
              } else if (nextCenter) {
                const newCenter = (centers ?? []).find((c) => c._id === nextCenter);
                if (newCenter?.defaultRoomId) nextRoom = newCenter.defaultRoomId;
              }
              update({
                id: group._id,
                centerId: nextCenter,
                defaultRoomId: nextRoom,
              });
            }}
            disabled={!groupReady || !refsReady}
          >
            <SelectTrigger className={triggerClass} size="sm">
              <SelectValue placeholder="Any" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Any</SelectItem>
              {(centers ?? []).map((c) => (
                <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Room — filtered to the selected centre. Disabled when no centre
            picked yet, since a free-floating "all rooms" list mixes rooms
            from every centre and is rarely what the user wants. */}
        <div className="min-w-0">
          <Label className="text-[10px] text-muted-foreground">Room</Label>
          <Select
            items={roomItems}
            value={group?.defaultRoomId ?? NONE}
            onValueChange={(v) =>
              group && update({
                id: group._id,
                defaultRoomId: (v && v !== NONE ? (v as Id<'rooms'>) : undefined),
              })
            }
            disabled={!groupReady || !refsReady || !group?.centerId}
          >
            <SelectTrigger className={triggerClass} size="sm">
              <SelectValue placeholder={group?.centerId ? 'Pick' : 'Set centre'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Pick</SelectItem>
              {filteredRooms.map((r) => (
                <SelectItem key={r._id} value={r._id}>{r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {group && !group.defaultRoomId && (
        <p className="text-[10px] text-amber-600 mb-1.5 flex items-center gap-1 shrink-0">
          <AlertTriangle className="w-3 h-3" /> Set a default room to add sessions.
        </p>
      )}

      {/* Members header */}
      <div className="flex items-center justify-between mb-1 shrink-0">
        <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Members ({memberCount})
          {acceptedGrades.length > 0 && (
            <span className="ml-1 normal-case text-muted-foreground/70">
              · accepts {acceptedGrades.map((g) => `G${g}`).join(', ')}
            </span>
          )}
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
            return (
              <span
                key={m._id}
                className="inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded-full text-[11px]"
                style={{ backgroundColor: color.soft, color: color.text, border: `1px solid ${color.border}` }}
              >
                <FeeDot
                  effectiveRate={m.effectiveRate}
                  hasOverride={m.memberRate !== undefined}
                  onSet={(rate) =>
                    setMemberFee({ groupId, studentId: m._id, hourlyRate: rate })
                  }
                />
                {m.name}
                {offCentre && <AlertTriangle className="w-3 h-3 text-amber-500" />}
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

        {offCentreMembers.length > 0 && (
          <p className="text-[10px] text-amber-600 mt-1 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            {offCentreMembers.map((m) => m.name).join(', ')} from another centre.
          </p>
        )}

        {addingStudent && (
          <div className="rounded-lg border border-border/60 p-2 mt-1.5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                {/* No autoFocus: on mobile, popping the keyboard the moment
                    the picker opens is laggy and unwanted. User taps the
                    input themselves when they're ready to type. */}
                <Input
                  placeholder={
                    acceptedGrades.length > 0
                      ? `Search G${acceptedGrades.join('/')} students…`
                      : 'Search students…'
                  }
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  className="h-8 text-xs pl-7"
                />
              </div>
              <button
                type="button"
                onClick={() => setIncludeInOtherGroups((v) => !v)}
                className={cn(
                  'h-8 px-2 rounded-md border border-input flex items-center gap-1 text-[10px] shrink-0',
                  includeInOtherGroups
                    ? 'bg-primary/10 text-primary border-primary/40'
                    : 'text-muted-foreground hover:bg-muted',
                )}
                title={
                  includeInOtherGroups
                    ? 'Hiding students from other groups'
                    : 'Showing all matching students (including ones in other groups)'
                }
              >
                {includeInOtherGroups ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                {includeInOtherGroups ? 'All' : 'Free'}
              </button>
            </div>

            <div className="max-h-40 overflow-y-auto space-y-0.5">
              {candidates === undefined && (
                <p className="text-xs text-muted-foreground px-2 py-1">Loading…</p>
              )}
              {candidates !== undefined && filteredCandidates.slice(0, 30).map((s) => (
                <button
                  key={s._id}
                  onClick={() => handleAddMember(s._id, s.name)}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-muted text-left text-xs"
                >
                  <span>{s.name}</span>
                  <span className="text-muted-foreground">G{s.schoolGrade}</span>
                </button>
              ))}
              {candidates !== undefined && filteredCandidates.length === 0 && (
                <p className="text-xs text-muted-foreground px-2 py-1">
                  {acceptedGrades.length === 0
                    ? 'No matches.'
                    : includeInOtherGroups
                      ? 'No matches in selected grade(s).'
                      : 'No free students in selected grade(s). Tap "All" to include ones already in other groups.'}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Weekly sessions */}
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

// Multi-grade picker: one primary (radio) + up to 2 extras (checkboxes).
// Renders as a button-styled trigger whose label collapses the state into
// "Any" / "G10" / "G10 +G9" / "G10 +2".
function GradePopover({
  disabled,
  primary,
  extras,
  onChange,
}: {
  disabled?: boolean;
  primary?: number;
  extras: number[];
  onChange: (primary: number | undefined, extras: number[]) => void;
}) {
  const [open, setOpen] = useState(false);

  const label = (() => {
    if (primary == null) return 'Any';
    if (extras.length === 0) return `G${primary}`;
    if (extras.length === 1) return `G${primary} +G${extras[0]}`;
    return `G${primary} +${extras.length}`;
  })();

  const handlePrimary = (g: number | undefined) => {
    if (g == null) {
      onChange(undefined, []);
      return;
    }
    // If new primary collides with an existing extra, drop it from extras.
    const cleanedExtras = extras.filter((e) => e !== g);
    onChange(g, cleanedExtras);
  };

  const toggleExtra = (g: number) => {
    if (g === primary) return; // primary can't also be an extra
    if (extras.includes(g)) {
      onChange(primary, extras.filter((e) => e !== g));
    } else {
      if (extras.length >= 2) {
        toast('Max 2 extra grades');
        return;
      }
      onChange(primary, [...extras, g]);
    }
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger
        disabled={disabled}
        className={cn(
          'mt-0.5 h-8 w-full text-xs bg-transparent border border-input rounded-lg px-2 flex items-center justify-between gap-1',
          'focus:outline-none focus:ring-2 focus:ring-ring/50',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'dark:bg-input/30',
          primary == null && 'text-muted-foreground',
        )}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground" />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner sideOffset={4} className="z-[60]">
          <PopoverPrimitive.Popup className="rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 p-2 w-52 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Primary grade
            </div>
            <div className="grid grid-cols-4 gap-1 mb-2">
              <button
                type="button"
                onClick={() => handlePrimary(undefined)}
                className={cn(
                  'h-7 rounded text-[11px] border',
                  primary == null
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-input hover:bg-muted',
                )}
              >
                Any
              </button>
              {GRADE_OPTIONS.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => handlePrimary(g)}
                  className={cn(
                    'h-7 rounded text-[11px] border',
                    primary === g
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-input hover:bg-muted',
                  )}
                >
                  G{g}
                </button>
              ))}
            </div>

            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Also accepts (max 2)
            </div>
            <div className="grid grid-cols-4 gap-1">
              {GRADE_OPTIONS.map((g) => {
                const isPrimary = g === primary;
                const isExtra = extras.includes(g);
                return (
                  <button
                    key={g}
                    type="button"
                    disabled={isPrimary || primary == null}
                    onClick={() => toggleExtra(g)}
                    className={cn(
                      'h-7 rounded text-[11px] border flex items-center justify-center gap-0.5',
                      isExtra
                        ? 'bg-primary/15 text-primary border-primary/40'
                        : 'border-input hover:bg-muted',
                      (isPrimary || primary == null) && 'opacity-30 cursor-not-allowed hover:bg-transparent',
                    )}
                  >
                    {isExtra && <Check className="w-2.5 h-2.5" />}
                    G{g}
                  </button>
                );
              })}
            </div>
            {primary == null && (
              <p className="text-[10px] text-muted-foreground mt-1.5">
                Pick a primary grade first.
              </p>
            )}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

// ── FeeDot ────────────────────────────────────────────────────────────────
// Tiny coloured pill on each member chip surfacing the per-group fee at a
// glance and letting the tutor adjust it with a tap.
//   • grey  → standard fee (RATE_DEFAULT_LKR = 250)
//   • green → free seat (rate = 0)
//   • amber → discounted (any other rate; covers both the common 100/150/200
//             cases and any custom value)
// "Has-override" is rendered with a thin ring so the tutor can tell a group
// override from a student-level rate that happened to match the default.

const FEE_DEFAULT = 250;
const FEE_PRESETS = [0, 100, 150, 200, 250] as const;

function FeeDot({
  effectiveRate,
  hasOverride,
  onSet,
}: {
  effectiveRate: number;
  hasOverride: boolean;
  onSet: (rate: number | undefined) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [customStr, setCustomStr] = useState('');
  const [saving, setSaving] = useState(false);

  const isFree = effectiveRate === 0;
  const isDiscounted = effectiveRate > 0 && effectiveRate < FEE_DEFAULT;
  const isCustomHigh = effectiveRate > FEE_DEFAULT;
  const dotClass = isFree
    ? 'bg-emerald-500'
    : isDiscounted
      ? 'bg-amber-500'
      : isCustomHigh
        ? 'bg-sky-500'
        : 'bg-muted-foreground/40';

  const commit = async (rate: number | undefined) => {
    setSaving(true);
    try {
      await onSet(rate);
      toast.success(
        rate === undefined
          ? 'Fee cleared (uses student default)'
          : rate === 0
            ? 'Marked as free'
            : `Fee set to Rs ${rate}`,
      );
      setOpen(false);
      setCustomStr('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save fee');
    } finally {
      setSaving(false);
    }
  };

  const commitCustom = async () => {
    const n = Number(customStr);
    if (!Number.isFinite(n) || n < 0) {
      toast.error('Enter a valid amount');
      return;
    }
    await commit(n);
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger
        onClick={(e) => e.stopPropagation()}
        title={`Fee: Rs ${effectiveRate}/hr${hasOverride ? ' (group override)' : ''}`}
        className={cn(
          'w-2.5 h-2.5 rounded-full transition-transform hover:scale-125',
          dotClass,
          hasOverride && 'ring-1 ring-offset-1 ring-offset-transparent ring-current/40',
        )}
      />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner sideOffset={6} className="z-[70]">
          <PopoverPrimitive.Popup
            onClick={(e) => e.stopPropagation()}
            className="rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 p-2 w-56 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0"
          >
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
              Hourly fee in this group
            </div>
            <div className="grid grid-cols-5 gap-1 mb-2">
              {FEE_PRESETS.map((p) => {
                const active = effectiveRate === p;
                return (
                  <button
                    key={p}
                    type="button"
                    disabled={saving}
                    onClick={() => commit(p)}
                    className={cn(
                      'h-7 rounded text-[10px] border tabular-nums',
                      active
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-input hover:bg-muted',
                      saving && 'opacity-50 cursor-wait',
                    )}
                  >
                    {p === 0 ? 'Free' : p}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-[10px] text-muted-foreground shrink-0">Rs</span>
              <Input
                inputMode="numeric"
                placeholder="custom"
                value={customStr}
                onChange={(e) => setCustomStr(e.target.value.replace(/[^0-9]/g, ''))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void commitCustom();
                  }
                }}
                className="h-7 text-xs"
                disabled={saving}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[10px] px-2"
                disabled={saving || customStr === ''}
                onClick={commitCustom}
              >
                Set
              </Button>
            </div>
            {hasOverride && (
              <button
                type="button"
                disabled={saving}
                onClick={() => commit(undefined)}
                className="w-full text-[10px] text-muted-foreground hover:text-foreground border border-dashed border-border/60 rounded h-6"
              >
                Clear override (use student default)
              </button>
            )}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
