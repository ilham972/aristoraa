'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from 'convex/react';
import {
  Radio,
  Video,
  RotateCcw,
  Coffee,
  Check,
  X,
  Flag,
  Clock,
  Sparkles,
  CircleDot,
  CircleCheck,
  Circle,
  AlertTriangle,
  MapPin,
  Pin,
  Activity,
  Layers,
} from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import { useCurrentTeacher } from '@/hooks/useCurrentTeacher';
import { useActiveSlot } from '@/hooks/useActiveSlot';
import { getTodayDateStr, MODULE_COLORS } from '@/lib/types';
import { getModuleById, getModuleForDay } from '@/lib/curriculum-data';
import { toast } from 'sonner';

const IDLE_WARNING_MIN = 20;
const JUST_CORRECTED_MIN = 5;

type AssignType = 'exercise' | 'concept' | 'redo' | 'resting';

type InferredState =
  | 'needs-explanation'
  | 'idle'
  | 'no-activity'
  | 'assigned-idle'
  | 'just-corrected'
  | 'working'
  | 'not-in-slot'
  | 'absent';

export default function LeadDashboardPage() {
  const router = useRouter();
  const { teacher, role, isLoading: teacherLoading } = useCurrentTeacher();
  const today = getTodayDateStr();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Redirect non-lead roles
  useEffect(() => {
    if (teacherLoading) return;
    if (role === 'correction' || role === 'teacher') router.replace('/score-entry');
  }, [role, teacherLoading, router]);

  // Resolve today's active slot for this teacher
  const teacherSlotRows = useQuery(
    api.slotTeachers.listByTeacher,
    teacher ? { teacherId: teacher._id } : 'skip',
  );
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
    slotId ? { slotId, date: today } : { date: today },
  );

  // Three independent drawers — only one open at a time, but each owns its own state.
  const [contextStudentId, setContextStudentId] = useState<Id<'students'> | null>(null);
  const [curriculumStudentId, setCurriculumStudentId] = useState<Id<'students'> | null>(null);
  const [pastMistakesStudentId, setPastMistakesStudentId] = useState<Id<'students'> | null>(null);

  const assignMut = useMutation(api.currentAssignments.assign);
  const clearAssignMut = useMutation(api.currentAssignments.clear);
  const resolveDoubtMut = useMutation(api.doubts.resolve);

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
  }, [roster, now]);

  // Sort: students with pending doubts first, ordered by oldest doubt;
  // then by inferred-state priority; then by name.
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
    const oldestDoubtAge = (sid: string): number => {
      const ds = roster.pendingDoubtsByStudentId[sid] ?? [];
      if (ds.length === 0) return Number.POSITIVE_INFINITY;
      return Math.min(...ds.map((d) => d.raisedAt));
    };
    return [...roster.students].sort((a, b) => {
      const sa = inferredByStudent[a._id] ?? 'no-activity';
      const sb = inferredByStudent[b._id] ?? 'no-activity';
      if (sa === 'needs-explanation' && sb === 'needs-explanation') {
        return oldestDoubtAge(a._id) - oldestDoubtAge(b._id);
      }
      if (order[sa] !== order[sb]) return order[sa] - order[sb];
      return a.name.localeCompare(b.name);
    });
  }, [roster, inferredByStudent]);

  const totalPendingDoubts = useMemo(() => {
    if (!roster) return 0;
    let n = 0;
    for (const s of roster.students) {
      n += (roster.pendingDoubtsByStudentId[s._id] ?? []).length;
    }
    return n;
  }, [roster]);

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

  const contextStudent = contextStudentId
    ? roster.students.find((s) => s._id === contextStudentId) ?? null
    : null;
  const curriculumStudent = curriculumStudentId
    ? roster.students.find((s) => s._id === curriculumStudentId) ?? null
    : null;
  const pastMistakesStudent = pastMistakesStudentId
    ? roster.students.find((s) => s._id === pastMistakesStudentId) ?? null
    : null;

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
        {totalPendingDoubts > 0 && (
          <div className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 px-2.5 py-1">
            <Flag className="w-3 h-3" />
            <span className="text-[11px] font-bold">{totalPendingDoubts}</span>
          </div>
        )}
      </div>

      {/* Roster — students with doubts first, in queue order */}
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
          <div className="space-y-2">
            {sortedStudents.map((s) => {
              const state = inferredByStudent[s._id] ?? 'no-activity';
              const assignment = roster.currentAssignmentByStudentId[s._id];
              const latest = roster.latestEntryByStudentId[s._id];
              const doubts = roster.pendingDoubtsByStudentId[s._id] ?? [];
              return (
                <StudentCardGroup
                  key={s._id}
                  name={s.name}
                  schoolGrade={s.schoolGrade}
                  state={state}
                  latestMinAgo={latest ? Math.floor((now.getTime() - latest._creationTime) / 60_000) : null}
                  assignmentType={assignment?.completedAt ? null : (assignment?.type as AssignType | undefined)}
                  doubts={doubts.map((d) => ({
                    id: d._id,
                    source: d.source,
                    questionKey: d.questionKey,
                    ageMin: Math.max(0, Math.floor((now.getTime() - d.raisedAt) / 60_000)),
                  }))}
                  onCardTap={() => setContextStudentId(s._id)}
                  onCurriculumTap={() => setCurriculumStudentId(s._id)}
                  onPastMistakesTap={() => setPastMistakesStudentId(s._id)}
                  onResolveDoubt={async (doubtId) => {
                    try {
                      await resolveDoubtMut({ id: doubtId, resolvedByTeacherId: teacher?._id });
                      toast.success(`Doubt resolved for ${s.name}`);
                    } catch (e) {
                      toast.error('Could not resolve doubt');
                      console.error(e);
                    }
                  }}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Context drawer — read-only "what's going on with this student today" */}
      <Sheet open={!!contextStudent} onOpenChange={(o) => { if (!o) setContextStudentId(null); }}>
        <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-3xl">
          {contextStudent && (
            <ContextDrawerBody
              studentId={contextStudent._id}
              studentName={contextStudent.name}
              schoolGrade={contextStudent.schoolGrade}
              moduleId={slotModuleId}
              today={today}
              state={inferredByStudent[contextStudent._id] ?? 'no-activity'}
              onClose={() => setContextStudentId(null)}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Curriculum drawer — combined Next-exercise + Concept-video timeline */}
      <Sheet open={!!curriculumStudent} onOpenChange={(o) => { if (!o) setCurriculumStudentId(null); }}>
        <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto rounded-t-3xl">
          {curriculumStudent && (
            <CurriculumDrawerBody
              studentId={curriculumStudent._id}
              studentName={curriculumStudent.name}
              schoolGrade={curriculumStudent.schoolGrade}
              moduleId={slotModuleId}
              today={today}
              slotId={slotId}
              teacherId={teacher?._id ?? null}
              currentAssignment={roster.currentAssignmentByStudentId[curriculumStudent._id] ?? null}
              onAssign={async (payload) => {
                try {
                  await assignMut(payload);
                  toast.success('Assigned');
                } catch (e) {
                  toast.error('Could not assign');
                  console.error(e);
                }
              }}
              onClearAssignment={async () => {
                try {
                  await clearAssignMut({ studentId: curriculumStudent._id, date: today });
                  toast.success('Assignment cleared');
                } catch (e) {
                  toast.error('Could not clear');
                  console.error(e);
                }
              }}
              onClose={() => setCurriculumStudentId(null)}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Past mistakes + Rest drawer */}
      <Sheet open={!!pastMistakesStudent} onOpenChange={(o) => { if (!o) setPastMistakesStudentId(null); }}>
        <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-3xl">
          {pastMistakesStudent && (
            <PastMistakesDrawerBody
              studentId={pastMistakesStudent._id}
              studentName={pastMistakesStudent.name}
              schoolGrade={pastMistakesStudent.schoolGrade}
              moduleId={slotModuleId}
              today={today}
              slotId={slotId}
              teacherId={teacher?._id ?? null}
              currentAssignment={roster.currentAssignmentByStudentId[pastMistakesStudent._id] ?? null}
              onAssign={async (payload) => {
                try {
                  await assignMut(payload);
                  toast.success(payload.type === 'resting' ? 'Marked as resting' : 'Past mistake assigned');
                  setPastMistakesStudentId(null);
                } catch (e) {
                  toast.error('Could not assign');
                  console.error(e);
                }
              }}
              onClose={() => setPastMistakesStudentId(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── Student card + doubt strip ───

function StudentCardGroup({
  name,
  schoolGrade,
  state,
  latestMinAgo,
  assignmentType,
  doubts,
  onCardTap,
  onCurriculumTap,
  onPastMistakesTap,
  onResolveDoubt,
}: {
  name: string;
  schoolGrade: number;
  state: InferredState;
  latestMinAgo: number | null;
  assignmentType: AssignType | null | undefined;
  doubts: Array<{ id: Id<'doubts'>; source: string; questionKey?: string; ageMin: number }>;
  onCardTap: () => void;
  onCurriculumTap: () => void;
  onPastMistakesTap: () => void;
  onResolveDoubt: (id: Id<'doubts'>) => void;
}) {
  const stateStyles = STATE_STYLES[state];
  return (
    <div className={`rounded-2xl border ${stateStyles.ring} ${stateStyles.bg} overflow-hidden`}>
      {/* Card body — tap opens context drawer */}
      <div className="flex items-stretch">
        <button
          onClick={onCardTap}
          className="flex-1 flex items-center gap-3 p-3 text-left active:scale-[0.99] transition-transform min-w-0"
        >
          <div className={`w-9 h-9 rounded-full ${stateStyles.dot} flex items-center justify-center shrink-0`}>
            <span className="text-sm font-bold text-white">{name.charAt(0)}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold text-foreground truncate">{name}</p>
              <span className="text-[10px] text-muted-foreground">G{schoolGrade}</span>
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className={`text-[11px] font-medium ${stateStyles.text} truncate`}>{stateStyles.label}</span>
              {latestMinAgo !== null && state !== 'no-activity' && (
                <span className="text-[10px] text-muted-foreground shrink-0">· {latestMinAgo}m ago</span>
              )}
              {assignmentType && (
                <span className="text-[10px] text-muted-foreground shrink-0">· {assignmentType}</span>
              )}
            </div>
          </div>
        </button>
        {/* Action icons */}
        <div className="flex items-center gap-1 pr-2">
          <IconAction
            label="Curriculum"
            icon={<Layers className="w-4 h-4" />}
            tone="primary"
            onClick={onCurriculumTap}
          />
          <IconAction
            label="Past mistakes"
            icon={<RotateCcw className="w-4 h-4" />}
            tone="muted"
            onClick={onPastMistakesTap}
          />
        </div>
      </div>

      {/* Doubt strip — one row per pending doubt */}
      {doubts.length > 0 && (
        <div className="border-t border-amber-500/30 bg-amber-500/[0.06] divide-y divide-amber-500/15">
          {doubts.map((d) => (
            <DoubtStripRow
              key={d.id}
              source={d.source}
              questionKey={d.questionKey}
              ageMin={d.ageMin}
              onResolve={() => onResolveDoubt(d.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function IconAction({
  icon,
  label,
  tone,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  tone: 'primary' | 'muted';
  onClick: () => void;
}) {
  const toneClass =
    tone === 'primary'
      ? 'bg-primary/10 text-primary hover:bg-primary/15'
      : 'bg-muted/60 text-foreground/70 hover:bg-muted';
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      aria-label={label}
      className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors active:scale-[0.94] ${toneClass}`}
    >
      {icon}
    </button>
  );
}

function DoubtStripRow({
  source,
  questionKey,
  ageMin,
  onResolve,
}: {
  source: string;
  questionKey?: string;
  ageMin: number;
  onResolve: () => void;
}) {
  const sourceLabel =
    source === 'correction' ? 'Correction' : source === 'student-app' ? 'Student' : 'Manual';
  const sourceTone =
    source === 'correction'
      ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
      : source === 'student-app'
        ? 'bg-sky-500/20 text-sky-700 dark:text-sky-300'
        : 'bg-muted text-muted-foreground';
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <Flag className="w-3.5 h-3.5 text-amber-500 shrink-0" />
      <Badge className={`text-[9px] px-1.5 py-0 h-4 rounded-full border-transparent ${sourceTone}`}>
        {sourceLabel}
      </Badge>
      {questionKey && (
        <span className="text-[11px] font-medium text-foreground">Q{questionKey}</span>
      )}
      <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1 ml-auto">
        <Clock className="w-3 h-3" /> {ageMin}m
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-[11px] text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10"
        onClick={onResolve}
      >
        <Check className="w-3.5 h-3.5 mr-0.5" /> Resolve
      </Button>
    </div>
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

// ─── Helpers shared by drawer bodies ───

function StudentDrawerHeader({
  name,
  schoolGrade,
  moduleId,
  subtitle,
}: {
  name: string;
  schoolGrade: number;
  moduleId: string | null;
  subtitle?: string;
}) {
  const moduleColor = moduleId ? MODULE_COLORS[moduleId] : undefined;
  return (
    <SheetHeader>
      <SheetTitle className="flex items-center gap-2">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
          style={moduleColor ? { backgroundColor: `${moduleColor}22`, color: moduleColor } : undefined}
        >
          <span className="text-sm font-bold">{name.charAt(0)}</span>
        </div>
        <div className="min-w-0">
          <p className="text-base font-bold truncate">{name}</p>
          <p className="text-[11px] font-normal text-muted-foreground">
            Grade {schoolGrade} {moduleId ? `· ${moduleId}` : ''}
            {subtitle ? ` · ${subtitle}` : ''}
          </p>
        </div>
      </SheetTitle>
    </SheetHeader>
  );
}

// ─── Context drawer (read-only "what's going on") ───

function ContextDrawerBody({
  studentId,
  studentName,
  schoolGrade,
  moduleId,
  today,
  state,
  onClose,
}: {
  studentId: Id<'students'>;
  studentName: string;
  schoolGrade: number;
  moduleId: string | null;
  today: string;
  state: InferredState;
  onClose: () => void;
}) {
  const allEntries = useQuery(api.entries.getByStudent, { studentId });
  const allDoubts = useQuery(api.doubts.listByStudent, { studentId });
  const currentAssignment = useQuery(api.currentAssignments.getForStudent, { studentId, date: today });
  const allExercises = useQuery(api.exercises.list);

  const exById = useMemo(() => {
    const m: Record<string, { name: string; type: string; questionCount: number }> = {};
    if (allExercises) {
      for (const e of allExercises) {
        m[e._id] = { name: e.name, type: e.type ?? 'exercise', questionCount: e.questionCount };
      }
    }
    return m;
  }, [allExercises]);

  const todaysEntries = useMemo(() => {
    if (!allEntries) return [];
    return allEntries.filter((e) => e.date === today).sort((a, b) => b._creationTime - a._creationTime);
  }, [allEntries, today]);

  const todaysDoubts = useMemo(() => {
    if (!allDoubts) return { pending: [], resolved: [] };
    const pending: typeof allDoubts = [];
    const resolved: typeof allDoubts = [];
    for (const d of allDoubts) {
      if (d.status === 'pending') pending.push(d);
      else if (d.status === 'resolved' && d.resolvedAt && isSameDay(d.resolvedAt, today)) resolved.push(d);
    }
    pending.sort((a, b) => a.raisedAt - b.raisedAt);
    resolved.sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0));
    return { pending, resolved };
  }, [allDoubts, today]);

  const stateStyles = STATE_STYLES[state];
  const loading = !allEntries || !allDoubts || !allExercises;

  return (
    <>
      <StudentDrawerHeader name={studentName} schoolGrade={schoolGrade} moduleId={moduleId} subtitle="Today's context" />

      {/* State badge */}
      <div className={`mt-3 rounded-xl border ${stateStyles.ring} ${stateStyles.bg} px-3 py-2.5 flex items-center gap-2`}>
        <Activity className={`w-4 h-4 ${stateStyles.text}`} />
        <span className={`text-xs font-semibold ${stateStyles.text}`}>{stateStyles.label}</span>
      </div>

      {/* Current assignment */}
      {currentAssignment && (
        <div className="mt-3 rounded-xl border border-sky-500/40 bg-sky-500/5 p-3">
          <p className="text-[10px] uppercase tracking-wide text-sky-600 dark:text-sky-400 font-bold mb-0.5">
            Current assignment
          </p>
          <p className="text-sm font-semibold">
            {currentAssignment.type === 'exercise' && (currentAssignment.exerciseId ? (exById[currentAssignment.exerciseId]?.name ?? 'Next exercise') : 'Next exercise')}
            {currentAssignment.type === 'concept' && (currentAssignment.exerciseId ? (exById[currentAssignment.exerciseId]?.name ?? 'Concept video') : 'Concept video')}
            {currentAssignment.type === 'redo' && `Redo Q${currentAssignment.redoQuestionKey ?? ''}`}
            {currentAssignment.type === 'resting' && 'Resting'}
            {currentAssignment.completedAt && ' · done'}
          </p>
          {currentAssignment.note && (
            <p className="text-[11px] text-muted-foreground truncate">{currentAssignment.note}</p>
          )}
        </div>
      )}

      {/* Today's entries */}
      <Section title="Today's entries" count={todaysEntries.length}>
        {loading ? (
          <SkeletonRow />
        ) : todaysEntries.length === 0 ? (
          <EmptyHint>No entries recorded today.</EmptyHint>
        ) : (
          <div className="space-y-1.5">
            {todaysEntries.map((e) => {
              const ex = exById[e.exerciseId];
              const total = e.totalAttempted || ex?.questionCount || 0;
              const correct = e.correctCount || 0;
              const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
              const tone = pct >= 80 ? 'emerald' : pct >= 50 ? 'amber' : 'red';
              return (
                <div key={e._id} className="rounded-xl border border-border/60 bg-card px-3 py-2 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-foreground truncate">{ex?.name ?? 'Unknown exercise'}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {fmtTime(e._creationTime)} · {e.moduleId}
                    </p>
                  </div>
                  <div className={`text-[11px] font-bold tabular-nums ${
                    tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-400'
                    : tone === 'amber' ? 'text-amber-600 dark:text-amber-400'
                    : 'text-red-600 dark:text-red-400'
                  }`}>
                    {correct}/{total}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* Pending doubts */}
      <Section title="Pending doubts" count={todaysDoubts.pending.length}>
        {loading ? (
          <SkeletonRow />
        ) : todaysDoubts.pending.length === 0 ? (
          <EmptyHint>No pending doubts.</EmptyHint>
        ) : (
          <div className="space-y-1.5">
            {todaysDoubts.pending.map((d) => (
              <div key={d._id} className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-3 py-2 flex items-center gap-2">
                <Flag className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span className="text-xs text-foreground flex-1 truncate">
                  {d.questionKey ? `Q${d.questionKey}` : 'Doubt'} · {sourceShort(d.source)}
                </span>
                <span className="text-[10px] text-muted-foreground shrink-0">{fmtRelative(d.raisedAt)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Resolved today */}
      {todaysDoubts.resolved.length > 0 && (
        <Section title="Resolved today" count={todaysDoubts.resolved.length}>
          <div className="space-y-1.5">
            {todaysDoubts.resolved.map((d) => (
              <div key={d._id} className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span className="text-xs text-foreground flex-1 truncate">
                  {d.questionKey ? `Q${d.questionKey}` : 'Doubt'} · {sourceShort(d.source)}
                </span>
                <span className="text-[10px] text-muted-foreground shrink-0">{d.resolvedAt ? fmtTime(d.resolvedAt) : ''}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <div className="mt-4 flex justify-end">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="w-4 h-4 mr-1" /> Close
        </Button>
      </div>
    </>
  );
}

// ─── Curriculum drawer (combined Next-exercise + Concept-video timeline) ───

type RowStatus =
  | 'not-started'
  | 'in-progress'
  | 'done'
  | 'has-wrong'
  | 'has-doubt'
  | 'assigned'
  | 'here';

function CurriculumDrawerBody({
  studentId,
  studentName,
  schoolGrade,
  moduleId,
  today,
  slotId,
  teacherId,
  currentAssignment,
  onAssign,
  onClearAssignment,
  onClose,
}: {
  studentId: Id<'students'>;
  studentName: string;
  schoolGrade: number;
  moduleId: string | null;
  today: string;
  slotId: Id<'scheduleSlots'> | null;
  teacherId: Id<'teachers'> | null;
  currentAssignment: { _id: Id<'currentAssignments'>; type: string; exerciseId?: Id<'exercises'>; completedAt?: number } | null;
  onAssign: (payload: {
    studentId: Id<'students'>;
    date: string;
    slotId?: Id<'scheduleSlots'>;
    type: AssignType;
    exerciseId?: Id<'exercises'>;
    redoEntryId?: Id<'entries'>;
    redoQuestionKey?: string;
    assignedByTeacherId?: Id<'teachers'>;
  }) => Promise<void>;
  onClearAssignment: () => Promise<void>;
  onClose: () => void;
}) {
  // Compute the unit IDs for the student's grade in this module.
  const moduleData = moduleId ? getModuleById(moduleId) : null;
  const gradeData = moduleData?.grades.find((g) => g.grade === schoolGrade) ?? null;
  const orderedUnits = useMemo(() => {
    if (!gradeData) return [] as { id: string; name: string; term: number }[];
    const rows: { id: string; name: string; term: number }[] = [];
    for (const t of gradeData.terms) {
      for (const u of t.units) rows.push({ id: u.id, name: u.name, term: t.term });
    }
    return rows;
  }, [gradeData]);
  const unitIds = useMemo(() => orderedUnits.map((u) => u.id), [orderedUnits]);

  const ctx = useQuery(
    api.lead.studentContext,
    moduleId
      ? { studentId, moduleId, date: today, unitIds }
      : 'skip',
  );

  // Index entries by exerciseId and pick the latest entry per exercise.
  const entriesByExId = useMemo(() => {
    const m: Record<string, { latest?: { _id: Id<'entries'>; correctCount: number; totalAttempted: number; questions: Record<string, string>; date: string } }> = {};
    if (!ctx) return m;
    for (const e of ctx.allEntries) {
      const cur = m[e.exerciseId];
      const ent = {
        _id: e._id,
        correctCount: e.correctCount,
        totalAttempted: e.totalAttempted,
        questions: (e.questions ?? {}) as Record<string, string>,
        date: e.date,
      };
      if (!cur || !cur.latest) m[e.exerciseId] = { latest: ent };
      else if (e.date > cur.latest.date) m[e.exerciseId] = { latest: ent };
    }
    return m;
  }, [ctx]);

  // Pending doubts grouped by exerciseId.
  const pendingDoubtsByExId = useMemo(() => {
    const m: Record<string, number> = {};
    if (!ctx) return m;
    for (const d of ctx.allDoubts) {
      if (d.status === 'pending' && d.exerciseId) {
        m[d.exerciseId] = (m[d.exerciseId] ?? 0) + 1;
      }
    }
    return m;
  }, [ctx]);

  const assignedExerciseId = currentAssignment && !currentAssignment.completedAt
    ? (currentAssignment.exerciseId as string | undefined)
    : undefined;

  // Build the ordered timeline: for each unit, exercises (and concepts inline by `order`).
  const timelineByUnit = useMemo(() => {
    if (!ctx) return [] as { unit: { id: string; name: string; term: number }; rows: TimelineRow[] }[];
    const groups: { unit: { id: string; name: string; term: number }; rows: TimelineRow[] }[] = [];
    for (const u of orderedUnits) {
      const exs = ctx.exercises
        .filter((e) => e.unitId === u.id)
        .sort((a, b) => a.order - b.order);
      const rows: TimelineRow[] = exs.map((e) => {
        const entry = entriesByExId[e._id]?.latest;
        const doubtCount = pendingDoubtsByExId[e._id] ?? 0;
        const isAssigned = assignedExerciseId === e._id;
        const status = computeRowStatus({
          entry,
          doubtCount,
          isAssigned,
          questionCount: e.questionCount,
        });
        return {
          exerciseId: e._id as Id<'exercises'>,
          name: e.name,
          type: (e.type ?? 'exercise') as 'exercise' | 'concept',
          questionCount: e.questionCount,
          videoUrl: e.videoUrl,
          status,
          doubtCount,
          correct: entry?.correctCount ?? 0,
          totalAttempted: entry?.totalAttempted ?? 0,
          isAssigned,
        };
      });
      groups.push({ unit: u, rows });
    }
    return groups;
  }, [ctx, orderedUnits, entriesByExId, pendingDoubtsByExId, assignedExerciseId]);

  // Find the "you are here" row: first row whose status is 'in-progress' or 'has-doubt' or 'has-wrong';
  // failing that, the first 'not-started' after the last 'done'.
  const hereExerciseId = useMemo(() => {
    let lastDone: Id<'exercises'> | null = null;
    let firstNotStarted: Id<'exercises'> | null = null;
    for (const g of timelineByUnit) {
      for (const r of g.rows) {
        if (r.status === 'in-progress' || r.status === 'has-doubt' || r.status === 'has-wrong') {
          return r.exerciseId;
        }
        if (r.status === 'done') lastDone = r.exerciseId;
        if (!firstNotStarted && r.status === 'not-started') firstNotStarted = r.exerciseId;
      }
    }
    return firstNotStarted ?? lastDone ?? null;
  }, [timelineByUnit]);

  const stats = useMemo(() => {
    let done = 0; let inProgress = 0; let wrong = 0; let doubts = 0; let total = 0;
    for (const g of timelineByUnit) {
      for (const r of g.rows) {
        total++;
        if (r.status === 'done') done++;
        else if (r.status === 'in-progress') inProgress++;
        else if (r.status === 'has-wrong') wrong++;
        if (r.doubtCount > 0) doubts++;
      }
    }
    return { done, inProgress, wrong, doubts, total };
  }, [timelineByUnit]);

  // Auto-scroll to the "here" row when it appears.
  const hereRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hereRef.current) return;
    const t = setTimeout(() => {
      hereRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 200);
    return () => clearTimeout(t);
  }, [hereExerciseId, timelineByUnit.length]);

  const loading = !ctx || !moduleId;

  return (
    <>
      <StudentDrawerHeader
        name={studentName}
        schoolGrade={schoolGrade}
        moduleId={moduleId}
        subtitle={moduleData ? moduleData.name : undefined}
      />

      {/* Current assignment strip */}
      {currentAssignment && (
        <div className="mt-3 rounded-xl border border-sky-500/40 bg-sky-500/5 p-2.5 flex items-center justify-between gap-2">
          <div className="min-w-0 inline-flex items-center gap-2">
            <Pin className="w-3.5 h-3.5 text-sky-500" />
            <span className="text-xs font-semibold truncate">
              Currently assigned: {currentAssignment.type}
              {currentAssignment.completedAt ? ' · done' : ''}
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={onClearAssignment} className="h-7 px-2 text-[11px]">
            Clear
          </Button>
        </div>
      )}

      {/* Sticky "you are here" mini-banner */}
      {!loading && hereExerciseId && (
        <div className="mt-3 sticky top-0 z-10 -mx-1 px-1">
          <div className="rounded-xl border border-teal-500/40 bg-teal-500/10 backdrop-blur px-3 py-2 flex items-center gap-2">
            <MapPin className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
            <span className="text-[11px] font-semibold text-teal-700 dark:text-teal-300">You are here</span>
            <span className="text-[10px] text-muted-foreground ml-auto">
              {stats.done}/{stats.total} done · {stats.doubts > 0 ? `${stats.doubts} flagged` : 'no flags'}
            </span>
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="mt-3">
        {loading ? (
          <div className="space-y-2">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : timelineByUnit.length === 0 ? (
          <EmptyHint>No curriculum loaded for this module.</EmptyHint>
        ) : (
          <div className="space-y-3">
            {timelineByUnit.map((g) => (
              <div key={g.unit.id}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] uppercase tracking-wide font-bold text-muted-foreground">
                    Term {g.unit.term}
                  </span>
                  <span className="text-[11px] font-semibold text-foreground/80 truncate">{g.unit.name}</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">{g.rows.length}</span>
                </div>
                {g.rows.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/50 bg-muted/20 px-3 py-2.5">
                    <p className="text-[11px] text-muted-foreground">No exercises in this unit yet.</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {g.rows.map((r) => (
                      <TimelineRowCard
                        key={r.exerciseId}
                        row={r}
                        isHere={r.exerciseId === hereExerciseId}
                        rowRef={r.exerciseId === hereExerciseId ? hereRef : undefined}
                        onAssign={() =>
                          onAssign({
                            studentId,
                            date: today,
                            slotId: slotId ?? undefined,
                            type: r.type === 'concept' ? 'concept' : 'exercise',
                            exerciseId: r.exerciseId,
                            assignedByTeacherId: teacherId ?? undefined,
                          })
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 flex justify-end">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="w-4 h-4 mr-1" /> Close
        </Button>
      </div>
    </>
  );
}

type TimelineRow = {
  exerciseId: Id<'exercises'>;
  name: string;
  type: 'exercise' | 'concept';
  questionCount: number;
  videoUrl?: string;
  status: RowStatus;
  doubtCount: number;
  correct: number;
  totalAttempted: number;
  isAssigned: boolean;
};

function TimelineRowCard({
  row,
  isHere,
  rowRef,
  onAssign,
}: {
  row: TimelineRow;
  isHere: boolean;
  rowRef?: React.Ref<HTMLDivElement>;
  onAssign: () => void;
}) {
  const conf = STATUS_CONF[row.status];
  const Icon = conf.icon;
  const noVideo = row.type === 'concept' && !row.videoUrl;
  return (
    <div
      ref={rowRef}
      className={`rounded-xl border ${conf.ring} ${conf.bg} ${isHere ? 'ring-2 ring-teal-500/40' : ''} px-3 py-2 flex items-center gap-2.5`}
    >
      <div className={`w-7 h-7 rounded-lg ${conf.iconBg} ${conf.iconColor} flex items-center justify-center shrink-0`}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {row.type === 'concept' && (
            <Badge className="text-[9px] px-1.5 py-0 h-4 rounded-full border-transparent bg-violet-500/20 text-violet-700 dark:text-violet-300">
              <Video className="w-2.5 h-2.5 mr-0.5" /> concept
            </Badge>
          )}
          <p className="text-xs font-semibold text-foreground truncate">{row.name}</p>
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <span className={`text-[10px] font-medium ${conf.text}`}>{conf.label}</span>
          {row.totalAttempted > 0 && (
            <span className="text-[10px] text-muted-foreground">
              · {row.correct}/{row.totalAttempted}
            </span>
          )}
          {row.type === 'exercise' && row.totalAttempted === 0 && (
            <span className="text-[10px] text-muted-foreground">· {row.questionCount} Qs</span>
          )}
          {row.doubtCount > 0 && (
            <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
              · {row.doubtCount} flag{row.doubtCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>
      <Button
        size="sm"
        variant={row.isAssigned ? 'secondary' : 'outline'}
        disabled={noVideo}
        onClick={onAssign}
        className="h-7 px-2.5 text-[11px] shrink-0"
      >
        {row.isAssigned ? (<><Pin className="w-3 h-3 mr-1" /> Assigned</>) : 'Assign'}
      </Button>
    </div>
  );
}

const STATUS_CONF: Record<RowStatus, {
  label: string;
  icon: typeof Circle;
  ring: string;
  bg: string;
  iconBg: string;
  iconColor: string;
  text: string;
}> = {
  'not-started': {
    label: 'Not started',
    icon: Circle,
    ring: 'border-border/60',
    bg: 'bg-card',
    iconBg: 'bg-muted/60',
    iconColor: 'text-muted-foreground',
    text: 'text-muted-foreground',
  },
  'in-progress': {
    label: 'In progress',
    icon: CircleDot,
    ring: 'border-sky-500/40',
    bg: 'bg-sky-500/5',
    iconBg: 'bg-sky-500/15',
    iconColor: 'text-sky-600 dark:text-sky-400',
    text: 'text-sky-600 dark:text-sky-400',
  },
  'done': {
    label: 'Done',
    icon: CircleCheck,
    ring: 'border-emerald-500/40',
    bg: 'bg-emerald-500/5',
    iconBg: 'bg-emerald-500/15',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
  'has-wrong': {
    label: 'Has wrong answers',
    icon: AlertTriangle,
    ring: 'border-red-500/40',
    bg: 'bg-red-500/5',
    iconBg: 'bg-red-500/15',
    iconColor: 'text-red-600 dark:text-red-400',
    text: 'text-red-600 dark:text-red-400',
  },
  'has-doubt': {
    label: 'Open doubt',
    icon: Flag,
    ring: 'border-amber-500/40',
    bg: 'bg-amber-500/5',
    iconBg: 'bg-amber-500/15',
    iconColor: 'text-amber-600 dark:text-amber-400',
    text: 'text-amber-600 dark:text-amber-400',
  },
  'assigned': {
    label: 'Assigned now',
    icon: Pin,
    ring: 'border-sky-500/50',
    bg: 'bg-sky-500/8',
    iconBg: 'bg-sky-500/20',
    iconColor: 'text-sky-600 dark:text-sky-400',
    text: 'text-sky-600 dark:text-sky-400',
  },
  'here': {
    label: 'You are here',
    icon: MapPin,
    ring: 'border-teal-500/50',
    bg: 'bg-teal-500/8',
    iconBg: 'bg-teal-500/20',
    iconColor: 'text-teal-600 dark:text-teal-400',
    text: 'text-teal-600 dark:text-teal-400',
  },
};

function computeRowStatus({
  entry,
  doubtCount,
  isAssigned,
  questionCount,
}: {
  entry?: { correctCount: number; totalAttempted: number; questions: Record<string, string> };
  doubtCount: number;
  isAssigned: boolean;
  questionCount: number;
}): RowStatus {
  if (isAssigned) return 'assigned';
  if (doubtCount > 0) return 'has-doubt';
  if (!entry || entry.totalAttempted === 0) return 'not-started';
  const wrong = Object.values(entry.questions).filter((v) => v === 'wrong').length;
  if (wrong > 0) return 'has-wrong';
  if (entry.correctCount >= questionCount) return 'done';
  return 'in-progress';
}

// ─── Past mistakes drawer (with Mark-as-resting at top) ───

function PastMistakesDrawerBody({
  studentId,
  studentName,
  schoolGrade,
  moduleId,
  today,
  slotId,
  teacherId,
  currentAssignment,
  onAssign,
  onClose,
}: {
  studentId: Id<'students'>;
  studentName: string;
  schoolGrade: number;
  moduleId: string | null;
  today: string;
  slotId: Id<'scheduleSlots'> | null;
  teacherId: Id<'teachers'> | null;
  currentAssignment: { _id: Id<'currentAssignments'>; type: string; completedAt?: number } | null;
  onAssign: (payload: {
    studentId: Id<'students'>;
    date: string;
    slotId?: Id<'scheduleSlots'>;
    type: AssignType;
    exerciseId?: Id<'exercises'>;
    redoEntryId?: Id<'entries'>;
    redoQuestionKey?: string;
    assignedByTeacherId?: Id<'teachers'>;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const pastEntries = useQuery(api.entries.getByStudent, { studentId });
  const allExercises = useQuery(api.exercises.list);

  const exById = useMemo(() => {
    const m: Record<string, { name: string }> = {};
    if (allExercises) {
      for (const e of allExercises) m[e._id] = { name: e.name };
    }
    return m;
  }, [allExercises]);

  const pastMistakes = useMemo(() => {
    if (!pastEntries) return [] as Array<{
      entryId: Id<'entries'>;
      exerciseId: Id<'exercises'>;
      questionKey: string;
      date: string;
      moduleId: string;
      exerciseName: string;
    }>;
    const items: Array<{
      entryId: Id<'entries'>;
      exerciseId: Id<'exercises'>;
      questionKey: string;
      date: string;
      moduleId: string;
      exerciseName: string;
    }> = [];
    for (const e of pastEntries) {
      const qs = (e.questions ?? {}) as Record<string, string>;
      for (const [k, v] of Object.entries(qs)) {
        if (v === 'wrong') {
          items.push({
            entryId: e._id,
            exerciseId: e.exerciseId,
            questionKey: k,
            date: e.date,
            moduleId: e.moduleId,
            exerciseName: exById[e.exerciseId]?.name ?? 'Unknown exercise',
          });
        }
      }
    }
    return items.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50);
  }, [pastEntries, exById]);

  const isResting = currentAssignment?.type === 'resting' && !currentAssignment.completedAt;

  return (
    <>
      <StudentDrawerHeader
        name={studentName}
        schoolGrade={schoolGrade}
        moduleId={moduleId}
        subtitle="Past mistakes & rest"
      />

      {/* Mark as resting pill — at top, single-tap action */}
      <button
        onClick={() =>
          onAssign({
            studentId,
            date: today,
            slotId: slotId ?? undefined,
            type: 'resting',
            assignedByTeacherId: teacherId ?? undefined,
          })
        }
        className={`mt-3 w-full rounded-2xl border ${
          isResting
            ? 'border-amber-500/60 bg-amber-500/10'
            : 'border-border/60 bg-card hover:bg-muted/40'
        } px-3.5 py-3 flex items-center gap-3 text-left active:scale-[0.99] transition-all`}
      >
        <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
          <Coffee className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {isResting ? 'Currently resting' : 'Mark as resting'}
          </p>
          <p className="text-[11px] text-muted-foreground">
            Clears idle warning · short break
          </p>
        </div>
        {isResting && <Check className="w-4 h-4 text-amber-500" />}
      </button>

      {/* Past mistakes list */}
      <Section title="Past mistakes" count={pastMistakes.length}>
        {!pastEntries ? (
          <SkeletonRow />
        ) : pastMistakes.length === 0 ? (
          <EmptyHint>No recorded wrong answers yet.</EmptyHint>
        ) : (
          <div className="space-y-1.5 max-h-[55vh] overflow-y-auto">
            {pastMistakes.map((m) => (
              <button
                key={`${m.entryId}-${m.questionKey}`}
                onClick={() =>
                  onAssign({
                    studentId,
                    date: today,
                    slotId: slotId ?? undefined,
                    type: 'redo',
                    exerciseId: m.exerciseId,
                    redoEntryId: m.entryId,
                    redoQuestionKey: m.questionKey,
                    assignedByTeacherId: teacherId ?? undefined,
                  })
                }
                className="w-full rounded-xl border border-border/60 bg-card px-3 py-2.5 flex items-center justify-between gap-3 text-left transition-all active:scale-[0.99] hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-foreground truncate">{m.exerciseName}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {m.moduleId} · Q{m.questionKey} · {m.date}
                  </p>
                </div>
                <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
              </button>
            ))}
          </div>
        )}
      </Section>

      <div className="mt-4 flex justify-end">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="w-4 h-4 mr-1" /> Close
        </Button>
      </div>
    </>
  );
}

// ─── Tiny shared UI helpers ───

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-1.5">
        <h3 className="text-[10px] uppercase tracking-wide font-bold text-muted-foreground">{title}</h3>
        {typeof count === 'number' && (
          <span className="text-[10px] text-muted-foreground">{count}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 px-3 py-3 text-center">
      <p className="text-[11px] text-muted-foreground">{children}</p>
    </div>
  );
}

function SkeletonRow() {
  return <div className="h-12 rounded-xl bg-muted/40 animate-pulse" />;
}

// ─── Date / source helpers ───

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`;
}

function fmtRelative(ms: number): string {
  const mins = Math.max(0, Math.floor((Date.now() - ms) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function isSameDay(ms: number, dateStr: string): boolean {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}` === dateStr;
}

function sourceShort(source: string): string {
  return source === 'correction' ? 'Correction' : source === 'student-app' ? 'Student' : 'Manual';
}
