'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from 'convex/react';
import { Radio, AlertTriangle, Sparkles, BookOpen, Video, RotateCcw, Coffee, Check, X, Flag, Clock, ChevronRight } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import { useCurrentTeacher } from '@/hooks/useCurrentTeacher';
import { useActiveSlot } from '@/hooks/useActiveSlot';
import { getTodayDateStr, MODULE_COLORS } from '@/lib/types';
import { CURRICULUM_MODULES, getModuleById, getModuleForDay } from '@/lib/curriculum-data';
import { toast } from 'sonner';

// Inferred state thresholds (minutes since last entry). Tunable in settings later.
const IDLE_WARNING_MIN = 20;
const JUST_CORRECTED_MIN = 5;

type AssignType = 'exercise' | 'concept' | 'redo' | 'resting';

export default function LeadDashboardPage() {
  const router = useRouter();
  const { teacher, role, isLoading: teacherLoading } = useCurrentTeacher();
  const today = getTodayDateStr();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t); }, []);

  // Redirect Correction Officers away
  useEffect(() => {
    if (teacherLoading) return;
    if (role === 'correction' || role === 'teacher') router.replace('/score-entry');
  }, [role, teacherLoading, router]);

  // Pick today's active slot for this teacher (if any)
  const teacherSlotRows = useQuery(api.slotTeachers.listByTeacher, teacher ? { teacherId: teacher._id } : 'skip');
  const allSlots = useQuery(api.scheduleSlots.list);
  const teacherSlots = useMemo(() => {
    if (!teacherSlotRows || !allSlots) return undefined;
    const ids = new Set(teacherSlotRows.map((r) => r.slotId));
    return allSlots.filter((s) => ids.has(s._id));
  }, [teacherSlotRows, allSlots]);
  const { activeSlot, nextSlot, minutesRemaining } = useActiveSlot(teacherSlots);
  const slotId = (activeSlot?._id ?? null) as Id<'scheduleSlots'> | null;

  const roster = useQuery(
    api.lead.liveRoster,
    slotId ? { slotId, date: today } : { date: today }
  );

  const [selectedStudentId, setSelectedStudentId] = useState<Id<'students'> | null>(null);

  const assignMut = useMutation(api.currentAssignments.assign);
  const clearAssignMut = useMutation(api.currentAssignments.clear);
  const resolveDoubtMut = useMutation(api.doubts.resolve);

  const selectedStudent = useMemo(() => {
    if (!selectedStudentId || !roster) return null;
    return roster.students.find((s) => s._id === selectedStudentId) ?? null;
  }, [selectedStudentId, roster]);

  // Derived "inferred state" per student
  const inferredByStudent = useMemo(() => {
    if (!roster) return {} as Record<string, InferredState>;
    const map: Record<string, InferredState> = {};
    for (const s of roster.students) {
      const att = roster.attendanceByStudentId[s._id];
      const latest = roster.latestEntryByStudentId[s._id];
      const doubts = roster.pendingDoubtsByStudentId[s._id] ?? [];
      const assignment = roster.currentAssignmentByStudentId[s._id];

      if (att && att.status === 'absent') { map[s._id] = 'absent'; continue; }
      if (doubts.length > 0) { map[s._id] = 'needs-explanation'; continue; }

      if (latest) {
        const mins = Math.floor((now.getTime() - latest._creationTime) / 60_000);
        if (mins < JUST_CORRECTED_MIN) { map[s._id] = 'just-corrected'; continue; }
        if (mins < IDLE_WARNING_MIN) { map[s._id] = 'working'; continue; }
        map[s._id] = assignment && !assignment.completedAt ? 'assigned-idle' : 'idle';
        continue;
      }
      map[s._id] = assignment && !assignment.completedAt ? 'assigned-idle' : 'no-activity';
    }
    return map;
  }, [roster, now, slotId]);

  const pendingDoubts = useMemo(() => {
    if (!roster) return [];
    const list: Array<{ studentId: string; studentName: string; doubtId: Id<'doubts'>; questionKey?: string; source: string; raisedAt: number; exerciseId?: Id<'exercises'> }> = [];
    for (const s of roster.students) {
      const doubts = roster.pendingDoubtsByStudentId[s._id] ?? [];
      for (const d of doubts) {
        list.push({
          studentId: s._id,
          studentName: s.name,
          doubtId: d._id,
          questionKey: d.questionKey,
          source: d.source,
          raisedAt: d.raisedAt,
          exerciseId: d.exerciseId,
        });
      }
    }
    return list.sort((a, b) => a.raisedAt - b.raisedAt);
  }, [roster]);

  const sortedStudents = useMemo(() => {
    if (!roster) return [];
    const order: Record<InferredState, number> = {
      'needs-explanation': 0,
      'idle': 1,
      'no-activity': 2,
      'assigned-idle': 3,
      'just-corrected': 4,
      'working': 5,
      'not-in-slot': 6,
      'absent': 7,
    };
    return [...roster.students].sort((a, b) => {
      const sa = inferredByStudent[a._id] ?? 'no-activity';
      const sb = inferredByStudent[b._id] ?? 'no-activity';
      if (order[sa] !== order[sb]) return order[sa] - order[sb];
      return a.name.localeCompare(b.name);
    });
  }, [roster, inferredByStudent]);

  if (teacherLoading || !roster) {
    return (
      <div className="px-4 pt-5 pb-20 max-w-lg mx-auto">
        <div className="animate-pulse space-y-3">
          <div className="h-10 bg-muted rounded-xl" />
          <div className="h-24 bg-muted rounded-2xl" />
          <div className="h-24 bg-muted rounded-2xl" />
          <div className="h-24 bg-muted rounded-2xl" />
        </div>
      </div>
    );
  }

  const nowJsDay = new Date().getDay();
  const nowDay = nowJsDay === 0 ? 7 : nowJsDay;
  const slotModuleId = activeSlot?.moduleId ?? getModuleForDay(nowDay)?.id ?? null;
  const slotModule = slotModuleId ? getModuleById(slotModuleId) : null;

  return (
    <div className="px-4 pt-5 pb-20 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-xl bg-primary/12 flex items-center justify-center">
          <Radio className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-foreground leading-tight">Lead Dashboard</h1>
          <p className="text-[11px] text-muted-foreground">
            {activeSlot
              ? `Live · ${minutesRemaining ?? '?'} min left`
              : nextSlot
                ? `Next slot at ${nextSlot.startTime}`
                : 'No active session'}
            {slotModule ? ` · ${slotModule.id} ${slotModule.name}` : ''}
          </p>
        </div>
      </div>

      {/* Doubt queue */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-bold text-foreground tracking-wide uppercase">Doubt Queue</h2>
          <span className="text-[11px] text-muted-foreground">{pendingDoubts.length} pending</span>
        </div>
        {pendingDoubts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 bg-muted/30 px-4 py-5 text-center">
            <p className="text-xs text-muted-foreground">No pending doubts. All clear.</p>
          </div>
        ) : (
          <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1 snap-x">
            {pendingDoubts.map((d) => (
              <DoubtCard
                key={d.doubtId}
                name={d.studentName}
                source={d.source}
                questionKey={d.questionKey}
                ageMin={Math.max(0, Math.floor((now.getTime() - d.raisedAt) / 60_000))}
                onTap={() => setSelectedStudentId(d.studentId as Id<'students'>)}
                onResolve={async () => {
                  try {
                    await resolveDoubtMut({ id: d.doubtId, resolvedByTeacherId: teacher?._id });
                    toast.success(`Doubt resolved for ${d.studentName}`);
                  } catch (e) {
                    toast.error('Could not resolve doubt');
                    console.error(e);
                  }
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Student grid */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-bold text-foreground tracking-wide uppercase">Students</h2>
          <span className="text-[11px] text-muted-foreground">{sortedStudents.length} in view</span>
        </div>
        {sortedStudents.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 bg-muted/30 px-4 py-6 text-center">
            <p className="text-xs text-muted-foreground">No students in this view.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {sortedStudents.map((s) => {
              const state = inferredByStudent[s._id] ?? 'no-activity';
              const assignment = roster.currentAssignmentByStudentId[s._id];
              const latest = roster.latestEntryByStudentId[s._id];
              return (
                <StudentCard
                  key={s._id}
                  name={s.name}
                  schoolGrade={s.schoolGrade}
                  state={state}
                  latestMinAgo={latest ? Math.floor((now.getTime() - latest._creationTime) / 60_000) : null}
                  assignmentType={assignment?.completedAt ? null : (assignment?.type as AssignType | undefined)}
                  doubtCount={(roster.pendingDoubtsByStudentId[s._id] ?? []).length}
                  onTap={() => setSelectedStudentId(s._id)}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Assign sheet */}
      <Sheet open={!!selectedStudent} onOpenChange={(o) => { if (!o) setSelectedStudentId(null); }}>
        <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-3xl">
          {selectedStudent && (
            <AssignSheetBody
              studentId={selectedStudent._id}
              studentName={selectedStudent.name}
              schoolGrade={selectedStudent.schoolGrade}
              moduleId={slotModuleId}
              today={today}
              slotId={slotId}
              teacherId={teacher?._id ?? null}
              pendingDoubts={(roster.pendingDoubtsByStudentId[selectedStudent._id] ?? []).map(d => ({
                id: d._id,
                questionKey: d.questionKey,
                source: d.source,
                exerciseId: d.exerciseId,
              }))}
              currentAssignment={roster.currentAssignmentByStudentId[selectedStudent._id] ?? null}
              onAssign={async (payload) => {
                try {
                  await assignMut(payload);
                  toast.success(`Assigned: ${payload.type}`);
                  setSelectedStudentId(null);
                } catch (e) {
                  toast.error('Could not assign');
                  console.error(e);
                }
              }}
              onClearAssignment={async () => {
                try {
                  await clearAssignMut({ studentId: selectedStudent._id, date: today });
                  toast.success('Assignment cleared');
                } catch (e) {
                  toast.error('Could not clear');
                  console.error(e);
                }
              }}
              onResolveDoubt={async (doubtId) => {
                try {
                  await resolveDoubtMut({ id: doubtId, resolvedByTeacherId: teacher?._id });
                  toast.success('Doubt resolved');
                } catch (e) {
                  toast.error('Could not resolve');
                  console.error(e);
                }
              }}
              onClose={() => setSelectedStudentId(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── Types ───
type InferredState =
  | 'needs-explanation'
  | 'idle'
  | 'no-activity'
  | 'assigned-idle'
  | 'just-corrected'
  | 'working'
  | 'not-in-slot'
  | 'absent';

// ─── Inline components ───

function DoubtCard({
  name,
  source,
  questionKey,
  ageMin,
  onTap,
  onResolve,
}: {
  name: string;
  source: string;
  questionKey?: string;
  ageMin: number;
  onTap: () => void;
  onResolve: () => void;
}) {
  const sourceLabel =
    source === 'correction' ? 'Correction' : source === 'student-app' ? 'Student' : 'Manual';
  const sourceTone =
    source === 'correction'
      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
      : source === 'student-app'
        ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
        : 'bg-muted text-muted-foreground';
  return (
    <div
      className="snap-start min-w-[200px] rounded-2xl border border-amber-500/40 bg-amber-500/5 p-3 flex flex-col gap-1.5 cursor-pointer active:scale-[0.98] transition-all"
      onClick={onTap}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-foreground leading-tight truncate">{name}</p>
          <div className="flex items-center gap-1 mt-0.5">
            <Badge className={`text-[9px] px-1.5 py-0 h-4 rounded-full border-transparent ${sourceTone}`}>{sourceLabel}</Badge>
            {questionKey && (
              <span className="text-[10px] text-muted-foreground">Q{questionKey}</span>
            )}
          </div>
        </div>
        <Flag className="w-4 h-4 text-amber-500 shrink-0" />
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
          <Clock className="w-3 h-3" /> {ageMin}m
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px] text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10"
          onClick={(e) => { e.stopPropagation(); onResolve(); }}
        >
          <Check className="w-3.5 h-3.5 mr-0.5" /> Resolve
        </Button>
      </div>
    </div>
  );
}

function StudentCard({
  name,
  schoolGrade,
  state,
  latestMinAgo,
  assignmentType,
  doubtCount,
  onTap,
}: {
  name: string;
  schoolGrade: number;
  state: InferredState;
  latestMinAgo: number | null;
  assignmentType: AssignType | null | undefined;
  doubtCount: number;
  onTap: () => void;
}) {
  const stateStyles = STATE_STYLES[state];
  return (
    <button
      onClick={onTap}
      className={`w-full rounded-2xl border ${stateStyles.ring} ${stateStyles.bg} p-3 flex items-center gap-3 text-left active:scale-[0.99] transition-all`}
    >
      <div className={`w-9 h-9 rounded-full ${stateStyles.dot} flex items-center justify-center shrink-0`}>
        <span className="text-sm font-bold text-white">{name.charAt(0)}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold text-foreground truncate">{name}</p>
          <span className="text-[10px] text-muted-foreground">G{schoolGrade}</span>
          {doubtCount > 0 && (
            <Badge className="text-[9px] h-4 px-1.5 bg-amber-500 text-white border-transparent rounded-full">
              {doubtCount}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <span className={`text-[11px] font-medium ${stateStyles.text}`}>{stateStyles.label}</span>
          {latestMinAgo !== null && state !== 'no-activity' && (
            <span className="text-[10px] text-muted-foreground">· {latestMinAgo}m ago</span>
          )}
          {assignmentType && (
            <span className="text-[10px] text-muted-foreground">
              · assigned {assignmentType}
            </span>
          )}
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
    </button>
  );
}

const STATE_STYLES: Record<InferredState, { label: string; bg: string; ring: string; text: string; dot: string }> = {
  'needs-explanation': {
    label: 'Needs explanation',
    bg: 'bg-amber-500/8',
    ring: 'border-amber-500/50',
    text: 'text-amber-600 dark:text-amber-400',
    dot: 'bg-amber-500',
  },
  'idle': {
    label: 'Possibly idle — check',
    bg: 'bg-red-500/8',
    ring: 'border-red-500/50',
    text: 'text-red-600 dark:text-red-400',
    dot: 'bg-red-500',
  },
  'no-activity': {
    label: 'No activity yet',
    bg: 'bg-muted/40',
    ring: 'border-border/60',
    text: 'text-muted-foreground',
    dot: 'bg-muted-foreground',
  },
  'assigned-idle': {
    label: 'Assigned, waiting',
    bg: 'bg-sky-500/8',
    ring: 'border-sky-500/40',
    text: 'text-sky-600 dark:text-sky-400',
    dot: 'bg-sky-500',
  },
  'just-corrected': {
    label: 'Just corrected — choose next',
    bg: 'bg-amber-500/8',
    ring: 'border-amber-500/40',
    text: 'text-amber-600 dark:text-amber-400',
    dot: 'bg-amber-500',
  },
  'working': {
    label: 'Doing exercise',
    bg: 'bg-emerald-500/8',
    ring: 'border-emerald-500/40',
    text: 'text-emerald-600 dark:text-emerald-400',
    dot: 'bg-emerald-500',
  },
  'not-in-slot': {
    label: 'Not in today’s slot',
    bg: 'bg-muted/30',
    ring: 'border-border/40',
    text: 'text-muted-foreground',
    dot: 'bg-muted-foreground/60',
  },
  'absent': {
    label: 'Absent',
    bg: 'bg-muted/20',
    ring: 'border-border/40',
    text: 'text-muted-foreground',
    dot: 'bg-muted-foreground/40',
  },
};

// ─── Assign sheet body ───
function AssignSheetBody({
  studentId,
  studentName,
  schoolGrade,
  moduleId,
  today,
  slotId,
  teacherId,
  pendingDoubts,
  currentAssignment,
  onAssign,
  onClearAssignment,
  onResolveDoubt,
  onClose,
}: {
  studentId: Id<'students'>;
  studentName: string;
  schoolGrade: number;
  moduleId: string | null;
  today: string;
  slotId: Id<'scheduleSlots'> | null;
  teacherId: Id<'teachers'> | null;
  pendingDoubts: Array<{ id: Id<'doubts'>; questionKey?: string; source: string; exerciseId?: Id<'exercises'> }>;
  currentAssignment: { _id: Id<'currentAssignments'>; type: string; exerciseId?: Id<'exercises'>; note?: string; completedAt?: number } | null;
  onAssign: (payload: { studentId: Id<'students'>; date: string; slotId?: Id<'scheduleSlots'>; type: AssignType; exerciseId?: Id<'exercises'>; redoEntryId?: Id<'entries'>; redoQuestionKey?: string; note?: string; assignedByTeacherId?: Id<'teachers'> }) => Promise<void>;
  onClearAssignment: () => Promise<void>;
  onResolveDoubt: (id: Id<'doubts'>) => Promise<void>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'root' | 'exercise' | 'concept' | 'past-mistakes'>('root');

  const allExercises = useQuery(api.exercises.list);
  const pastEntries = useQuery(api.entries.getByStudent, { studentId });

  const moduleExercises = useMemo(() => {
    if (!allExercises || !moduleId) return { exercises: [], concepts: [] };
    const mod = CURRICULUM_MODULES.find((m) => m.id === moduleId);
    if (!mod) return { exercises: [], concepts: [] };
    const unitIds = new Set<string>();
    for (const g of mod.grades) {
      for (const t of g.terms) {
        for (const u of t.units) unitIds.add(u.id);
      }
    }
    const rows = allExercises.filter((e) => unitIds.has(e.unitId));
    return {
      exercises: rows.filter((e) => (e.type ?? 'exercise') === 'exercise').sort((a, b) => a.order - b.order),
      concepts: rows.filter((e) => e.type === 'concept').sort((a, b) => a.order - b.order),
    };
  }, [allExercises, moduleId]);

  const pastMistakes = useMemo(() => {
    if (!pastEntries) return [];
    const items: Array<{ entryId: Id<'entries'>; exerciseId: Id<'exercises'>; questionKey: string; date: string; moduleId: string }> = [];
    for (const e of pastEntries) {
      const qs = (e.questions ?? {}) as Record<string, string>;
      for (const [k, v] of Object.entries(qs)) {
        if (v === 'wrong') {
          items.push({ entryId: e._id, exerciseId: e.exerciseId, questionKey: k, date: e.date, moduleId: e.moduleId });
        }
      }
    }
    return items.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
  }, [pastEntries]);

  const moduleColor = moduleId ? MODULE_COLORS[moduleId] : undefined;

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
            style={moduleColor ? { backgroundColor: `${moduleColor}22`, color: moduleColor } : undefined}
          >
            <span className="text-sm font-bold">{studentName.charAt(0)}</span>
          </div>
          <div className="min-w-0">
            <p className="text-base font-bold truncate">{studentName}</p>
            <p className="text-[11px] font-normal text-muted-foreground">Grade {schoolGrade} {moduleId ? `· ${moduleId}` : ''}</p>
          </div>
        </SheetTitle>
      </SheetHeader>

      {/* Current assignment strip */}
      {currentAssignment && (
        <div className="mt-3 rounded-xl border border-sky-500/40 bg-sky-500/5 p-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-sky-600 dark:text-sky-400 font-bold">Current assignment</p>
            <p className="text-sm font-semibold truncate">
              {currentAssignment.type === 'exercise' && 'Next exercise'}
              {currentAssignment.type === 'concept' && 'Concept video'}
              {currentAssignment.type === 'redo' && 'Redo past mistake'}
              {currentAssignment.type === 'resting' && 'Resting'}
              {currentAssignment.completedAt && ' · done'}
            </p>
            {currentAssignment.note && (
              <p className="text-[11px] text-muted-foreground truncate">{currentAssignment.note}</p>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={onClearAssignment} className="h-8 px-2 text-xs">
            Clear
          </Button>
        </div>
      )}

      {/* Pending doubts for this student */}
      {pendingDoubts.length > 0 && mode === 'root' && (
        <div className="mt-3 space-y-1.5">
          <p className="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400 font-bold">Pending doubts</p>
          {pendingDoubts.map((d) => (
            <div key={d.id} className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-2.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Flag className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span className="text-xs text-foreground truncate">
                  {d.questionKey ? `Q${d.questionKey}` : 'Doubt'} · {d.source === 'correction' ? 'Correction flag' : d.source === 'student-app' ? 'Student asked' : 'Lead note'}
                </span>
              </div>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => onResolveDoubt(d.id)}>
                <Check className="w-3.5 h-3.5 mr-0.5" /> Resolve
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Mode: root — main actions */}
      {mode === 'root' && (
        <div className="mt-4 space-y-2">
          <ActionButton
            icon={<BookOpen className="w-5 h-5" />}
            label="Next exercise"
            sublabel="From curriculum order"
            onClick={() => setMode('exercise')}
          />
          <ActionButton
            icon={<Video className="w-5 h-5" />}
            label="Watch concept video"
            sublabel="Pick a concept from current module"
            onClick={() => setMode('concept')}
          />
          <ActionButton
            icon={<RotateCcw className="w-5 h-5" />}
            label="Redo past mistake"
            sublabel={`${pastMistakes.length} wrong answer${pastMistakes.length === 1 ? '' : 's'} recorded`}
            onClick={() => setMode('past-mistakes')}
          />
          <ActionButton
            icon={<Coffee className="w-5 h-5" />}
            label="Mark as resting"
            sublabel="Clears idle warning"
            onClick={() =>
              onAssign({
                studentId,
                date: today,
                slotId: slotId ?? undefined,
                type: 'resting',
                assignedByTeacherId: teacherId ?? undefined,
              })
            }
          />
        </div>
      )}

      {/* Mode: exercise picker */}
      {mode === 'exercise' && (
        <PickerList
          title="Pick an exercise"
          emptyHint={moduleId ? 'No exercises in this module yet.' : 'No active module — can’t suggest.'}
          items={moduleExercises.exercises.slice(0, 40).map((e) => ({
            key: e._id,
            primary: e.name,
            secondary: `${e.questionCount} Qs`,
            onTap: () =>
              onAssign({
                studentId,
                date: today,
                slotId: slotId ?? undefined,
                type: 'exercise',
                exerciseId: e._id,
                assignedByTeacherId: teacherId ?? undefined,
              }),
          }))}
          onBack={() => setMode('root')}
        />
      )}

      {/* Mode: concept picker */}
      {mode === 'concept' && (
        <PickerList
          title="Pick a concept video"
          emptyHint="No concept videos in this module yet."
          items={moduleExercises.concepts.map((c) => ({
            key: c._id,
            primary: c.name,
            secondary: c.videoUrl ? 'Video ready' : 'No video set',
            disabled: !c.videoUrl,
            onTap: () =>
              onAssign({
                studentId,
                date: today,
                slotId: slotId ?? undefined,
                type: 'concept',
                exerciseId: c._id,
                assignedByTeacherId: teacherId ?? undefined,
              }),
          }))}
          onBack={() => setMode('root')}
        />
      )}

      {/* Mode: past mistakes */}
      {mode === 'past-mistakes' && (
        <PickerList
          title="Pick a past mistake"
          emptyHint="No recorded wrong answers."
          items={pastMistakes.map((m) => ({
            key: `${m.entryId}-${m.questionKey}`,
            primary: `${m.moduleId} · Q${m.questionKey}`,
            secondary: m.date,
            onTap: () =>
              onAssign({
                studentId,
                date: today,
                slotId: slotId ?? undefined,
                type: 'redo',
                exerciseId: m.exerciseId,
                redoEntryId: m.entryId,
                redoQuestionKey: m.questionKey,
                assignedByTeacherId: teacherId ?? undefined,
              }),
          }))}
          onBack={() => setMode('root')}
        />
      )}

      <div className="mt-4 flex justify-end">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="w-4 h-4 mr-1" /> Close
        </Button>
      </div>
    </>
  );
}

function ActionButton({ icon, label, sublabel, onClick }: { icon: React.ReactNode; label: string; sublabel?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-2xl border border-border/60 bg-card p-3.5 flex items-center gap-3 text-left active:scale-[0.99] transition-all hover:bg-muted/30"
    >
      <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        {sublabel && <p className="text-[11px] text-muted-foreground">{sublabel}</p>}
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
    </button>
  );
}

function PickerList({
  title,
  items,
  emptyHint,
  onBack,
}: {
  title: string;
  items: Array<{ key: string; primary: string; secondary?: string; disabled?: boolean; onTap: () => void }>;
  emptyHint: string;
  onBack: () => void;
}) {
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        <Button variant="ghost" size="sm" onClick={onBack} className="h-7 px-2 text-xs">
          Back
        </Button>
      </div>
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 px-3 py-4 text-center">
          <p className="text-xs text-muted-foreground">{emptyHint}</p>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[55vh] overflow-y-auto">
          {items.map((it) => (
            <button
              key={it.key}
              onClick={it.onTap}
              disabled={it.disabled}
              className={`w-full rounded-xl border border-border/60 bg-card px-3 py-2.5 flex items-center justify-between gap-3 text-left transition-all ${
                it.disabled
                  ? 'opacity-50 cursor-not-allowed'
                  : 'active:scale-[0.99] hover:bg-muted/40'
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate">{it.primary}</p>
                {it.secondary && <p className="text-[11px] text-muted-foreground">{it.secondary}</p>}
              </div>
              {!it.disabled && <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
