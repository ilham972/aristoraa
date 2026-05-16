'use client';

// Phase D.3 verification surface — sheet planner inspector.
// Phase D.4 — prereq alerts panel.
// Phase D.5 — exam-backstop urgency-override badge.
// Phase D.6 — save draft / mark printed / mark completed + bulk class
//             generate by slot.
//
// Lead picks a student + date → sees the planSheet result split into the
// three slots (warm-up / main / exam-prep). The view exposes the inputs the
// planner used (phase-of-term, ratios, budget tier, exam-week mode, days to
// exam) AND the per-question scoring breakdown.

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';

// Extract a useful message from a Convex mutation rejection. ConvexError
// carries the server-thrown message in `err.data`; plain Errors only get the
// generic "Server Error" string — fall back to that.
function describeMutationError(e: unknown): string {
  if (e instanceof ConvexError) {
    const data: unknown = (e as ConvexError<string>).data;
    if (typeof data === 'string') return data;
    if (data && typeof data === 'object' && 'message' in data) {
      return String((data as { message: unknown }).message);
    }
    return JSON.stringify(data);
  }
  return e instanceof Error ? e.message : String(e);
}
import {
  Calendar as CalendarIcon,
  User as UserIcon,
  Clock,
  Target,
  AlertTriangle,
  CircleAlert,
  Info,
  Coffee,
  Search,
  ChevronDown,
  ChevronRight,
  FileText,
  BookOpen,
  Save,
  Printer,
  CheckCircle2,
  Users,
  Loader2,
  ShieldAlert,
  Zap,
} from 'lucide-react';
import { api, type Id } from '@/lib/convex';
import { CURRICULUM_MODULES, findUnit } from '@/lib/curriculum-data';
import { MODULE_COLORS } from '@/lib/types';

const MODULE_IDS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'];

// ── Helpers ──────────────────────────────────────────────────────────────

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function offsetYmd(base: string, days: number): string {
  const ms = Date.parse(`${base}T00:00:00.000Z`) + days * 86_400_000;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function resolveGradeByModule(student: {
  schoolGrade: number;
  assignedGrades?: number[];
  assignedGradesByModule?: unknown;
}): Record<string, number[]> {
  const defaults =
    student.assignedGrades && student.assignedGrades.length > 0
      ? student.assignedGrades
      : [student.schoolGrade];
  const byMod = (student.assignedGradesByModule ?? {}) as Record<string, number[]>;
  const out: Record<string, number[]> = {};
  for (const m of MODULE_IDS) {
    const override = byMod[m];
    out[m] = Array.isArray(override) && override.length > 0 ? override : defaults;
  }
  return out;
}

function unitIdsForScope(gradeByModule: Record<string, number[]>): string[] {
  const out: string[] = [];
  for (const mod of CURRICULUM_MODULES) {
    const allowedGrades = new Set(gradeByModule[mod.id] ?? []);
    if (allowedGrades.size === 0) continue;
    for (const g of mod.grades) {
      if (!allowedGrades.has(g.grade)) continue;
      for (const t of g.terms) {
        for (const u of t.units) out.push(u.id);
      }
    }
  }
  return out;
}

const PHASE_LABEL: Record<string, string> = {
  default: 'Default mix',
  earlyT1: 'Early Term 1',
  lateT1: 'Late Term 1',
  earlyT2: 'Early Term 2',
  lateT2: 'Late Term 2',
  earlyT3: 'Early Term 3',
  lateT3: 'Late Term 3',
  'examWeek-T1': 'Exam week · Term 1',
  'examWeek-T2': 'Exam week · Term 2',
  'examWeek-T3': 'Exam week · Term 3',
};

const TIER_LABEL: Record<string, string> = {
  weak: 'Weak',
  default: 'Default',
  strong: 'Strong',
};

const SOURCE_LABEL: Record<string, string> = {
  'manual-override': 'Manual override',
  'auto-tuned': 'Auto-tuned',
  'default-no-history': 'Default (no history)',
  'default-fallback': 'Default',
};

const UNDERFILL_LABEL: Record<string, string> = {
  'warmup-fallback-same-module-review': 'Warm-up fell back to same-module review',
  'main-fallback-past-paper': 'Main block fell back to past papers',
  'exam-prep-fallback-harder-textbook': 'Exam-prep fell back to harder textbook Qs',
  'pool-exhausted': 'Candidate pool exhausted — sheet shorter than target',
};

// ── Main component ───────────────────────────────────────────────────────

export function SheetPlannerTab() {
  const allStudents = useQuery(api.students.list);
  const [studentId, setStudentId] = useState<Id<'students'> | null>(null);
  const [dateStr, setDateStr] = useState<string>(todayYmd());
  const [search, setSearch] = useState('');

  const student = useQuery(
    api.students.get,
    studentId ? { id: studentId } : 'skip',
  );

  const gradeByModule = useMemo<Record<string, number[]>>(
    () => (student ? resolveGradeByModule(student) : {}),
    [student],
  );
  const unitIds = useMemo(
    () => unitIdsForScope(gradeByModule),
    [gradeByModule],
  );

  const plan = useQuery(
    api.learningEngine.planner.planSheet,
    studentId && student && unitIds.length > 0
      ? { studentId, dateStr, unitIds, gradeByModule }
      : 'skip',
  );

  const savedSheet = useQuery(
    api.learningEngine.planner.getSavedSheet,
    studentId ? { studentId, dateStr } : 'skip',
  );

  const filteredStudents = useMemo(() => {
    if (!allStudents) return [];
    const q = search.trim().toLowerCase();
    const list = q
      ? allStudents.filter((s) => s.name.toLowerCase().includes(q))
      : allStudents;
    return list
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 30);
  }, [allStudents, search]);

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground">
        Verification surface for the daily sheet planner. Pick a student + date to inspect
        the proposed warm-up / main / exam-prep slots, the phase-of-term ratios that drove
        the split, and the per-question scoring breakdown.
      </p>

      <StudentPicker
        students={filteredStudents ?? []}
        selectedId={studentId}
        onSelect={setStudentId}
        search={search}
        setSearch={setSearch}
        loading={allStudents === undefined}
      />

      {studentId && (
        <DatePicker dateStr={dateStr} setDateStr={setDateStr} />
      )}

      {/* Render states */}
      {!studentId && (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <UserIcon className="w-6 h-6 text-muted-foreground/50 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">
            Pick a student above to plan their sheet.
          </p>
        </div>
      )}

      {studentId && plan === null && (
        <div className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
          Sign in required.
        </div>
      )}

      {studentId && plan === undefined && (
        <div className="space-y-2 animate-pulse">
          <div className="h-20 bg-muted rounded-xl" />
          <div className="h-32 bg-muted rounded-xl" />
          <div className="h-32 bg-muted rounded-xl" />
        </div>
      )}

      {plan && plan.status === 'off-day' && (
        <OffDayCard reason={plan.offDayReason ?? null} />
      )}

      {plan && plan.status === 'ok' && (
        <>
          <PhaseInfoCard
            phase={plan.phase}
            todayModule={plan.todayModule}
            examSummary={plan.meta?.examSummary ?? []}
          />
          <BudgetCard
            budget={plan.budget}
            usedQuestions={
              plan.warmup.length + plan.main.length + plan.examPrep.length
            }
          />
          {plan.underFillReasons.length > 0 && (
            <UnderfillBanner reasons={plan.underFillReasons} />
          )}
          <SlotSection
            title="Warm-up"
            subtitle={
              plan.phase?.examWeekMode
                ? 'Exam week · cross-module'
                : `Cross-module SR ${plan.todayModule ? `(off ${plan.todayModule})` : ''}`
            }
            slot={plan.warmup}
            color="#2E86C1"
          />
          <SlotSection
            title="Main block"
            subtitle={
              plan.phase?.examWeekMode
                ? `Exam-term focus (T${plan.phase?.examTerm ?? '?'})`
                : plan.todayModule
                ? `Today's module · ${plan.todayModule}`
                : 'No module today'
            }
            slot={plan.main}
            color={
              plan.todayModule
                ? MODULE_COLORS[plan.todayModule] ?? '#0D9488'
                : '#71717A'
            }
          />
          <SlotSection
            title="Exam-prep"
            subtitle="Past-paper mix on mastered concepts"
            slot={plan.examPrep}
            color="#B9770E"
          />
          {plan.alerts && plan.alerts.length > 0 && (
            <PrereqAlertsPanel alerts={plan.alerts as PrereqAlert[]} />
          )}
          {studentId && (
            <SaveSheetCard
              studentId={studentId}
              dateStr={dateStr}
              unitIds={unitIds}
              gradeByModule={gradeByModule}
              savedSheet={savedSheet ?? null}
            />
          )}
          {plan.plannerGaps.length > 0 && (
            <PlannerGapsPanel gaps={plan.plannerGaps} />
          )}
          <BulkSlotCard dateStr={dateStr} />
          <MetaPanel meta={plan.meta} ratios={plan.phase?.ratios ?? null} />
        </>
      )}
    </div>
  );
}

// ── Student picker ───────────────────────────────────────────────────────

function StudentPicker({
  students,
  selectedId,
  onSelect,
  search,
  setSearch,
  loading,
}: {
  students: Array<{ _id: Id<'students'>; name: string; schoolGrade: number }>;
  selectedId: Id<'students'> | null;
  onSelect: (id: Id<'students'>) => void;
  search: string;
  setSearch: (s: string) => void;
  loading: boolean;
}) {
  const selected = students.find((s) => s._id === selectedId);
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-2 mb-2">
        <UserIcon className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
          Student
        </span>
        {selected && (
          <span className="text-[11px] text-foreground truncate ml-auto">
            {selected.name} · G{selected.schoolGrade}
          </span>
        )}
      </div>
      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={loading ? 'Loading…' : 'Search students…'}
          className="w-full pl-8 pr-2 py-2 rounded-lg bg-muted text-sm text-foreground border border-border outline-none focus:border-primary"
        />
      </div>
      {students.length > 0 && (
        <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-border divide-y divide-border">
          {students.map((s) => (
            <button
              key={s._id as unknown as string}
              onClick={() => onSelect(s._id)}
              className={`w-full px-3 py-2 text-left flex items-center justify-between gap-2 hover:bg-muted/40 ${
                selectedId === s._id ? 'bg-primary/5' : ''
              }`}
            >
              <span className="text-xs text-foreground truncate">{s.name}</span>
              <span className="text-[10px] text-muted-foreground shrink-0">
                G{s.schoolGrade}
              </span>
            </button>
          ))}
        </div>
      )}
      {!loading && students.length === 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground text-center">
          No students match &ldquo;{search}&rdquo;.
        </p>
      )}
    </div>
  );
}

// ── Date picker ──────────────────────────────────────────────────────────

function DatePicker({
  dateStr,
  setDateStr,
}: {
  dateStr: string;
  setDateStr: (s: string) => void;
}) {
  const today = todayYmd();
  const isToday = dateStr === today;
  const isTomorrow = dateStr === offsetYmd(today, 1);
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-2 mb-2">
        <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
          Plan date
        </span>
      </div>
      <div className="flex gap-2 items-center">
        <input
          type="date"
          value={dateStr}
          onChange={(e) => setDateStr(e.target.value)}
          className="flex-1 px-2 py-1.5 rounded-md bg-muted text-sm text-foreground border border-border outline-none focus:border-primary"
        />
        <button
          onClick={() => setDateStr(today)}
          className={`px-2.5 py-1.5 rounded-md text-[11px] font-semibold border transition-colors ${
            isToday
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-transparent border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          Today
        </button>
        <button
          onClick={() => setDateStr(offsetYmd(today, 1))}
          className={`px-2.5 py-1.5 rounded-md text-[11px] font-semibold border transition-colors ${
            isTomorrow
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-transparent border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          Tomorrow
        </button>
      </div>
    </div>
  );
}

// ── Off-day card ─────────────────────────────────────────────────────────

function OffDayCard({ reason }: { reason: string | null }) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3">
      <Coffee className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground mb-0.5">Off-day</div>
        <p className="text-[11px] text-muted-foreground">
          {reason ?? "Student's off-day — no sheet would be generated."}
        </p>
      </div>
    </div>
  );
}

// ── Phase info ───────────────────────────────────────────────────────────

type PhaseShape = {
  key: string;
  ratios: { warmup: number; main: number; examPrep: number };
  examWeekMode: boolean;
  daysToExam: number | null;
  examTerm: number | null;
  examDate: string | null;
} | null;

function PhaseInfoCard({
  phase,
  todayModule,
  examSummary,
}: {
  phase: PhaseShape;
  todayModule: string | null;
  examSummary: Array<{ term: number; examDate: string; daysToExam: number }>;
}) {
  const label = phase ? PHASE_LABEL[phase.key] ?? phase.key : 'Default';
  const isExamWeek = phase?.examWeekMode ?? false;
  return (
    <section className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-2 mb-2">
        <Target className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
          Phase &amp; ratios
        </span>
        {isExamWeek && (
          <span className="ml-auto px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/30 text-[10px] font-semibold text-red-600 dark:text-red-400">
            EXAM WEEK
          </span>
        )}
      </div>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-sm font-bold text-foreground">{label}</span>
        <span className="text-[11px] text-muted-foreground">
          {todayModule ? `${todayModule} day` : 'No-module day'}
        </span>
      </div>
      {phase && (
        <>
          <RatioBar ratios={phase.ratios} />
          {phase.daysToExam !== null && phase.examDate && (
            <div className="mt-2 text-[11px] text-muted-foreground">
              Next exam:{' '}
              <span className="text-foreground font-semibold">
                T{phase.examTerm}
              </span>{' '}
              · {phase.examDate} ·{' '}
              <span
                className={
                  phase.daysToExam <= 14
                    ? 'text-red-500 font-semibold'
                    : phase.daysToExam <= 35
                    ? 'text-amber-500 font-semibold'
                    : 'text-foreground'
                }
              >
                {phase.daysToExam}d
              </span>
            </div>
          )}
          {phase.daysToExam === null && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              No upcoming exam scheduled — using default ratios.
            </p>
          )}
        </>
      )}
      {examSummary.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {examSummary.map((e) => (
            <span
              key={e.term}
              className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
            >
              T{e.term}: {e.daysToExam}d
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function RatioBar({
  ratios,
}: {
  ratios: { warmup: number; main: number; examPrep: number };
}) {
  const wp = Math.round(ratios.warmup * 100);
  const mp = Math.round(ratios.main * 100);
  const ep = Math.max(0, 100 - wp - mp);
  return (
    <div>
      <div className="flex h-2 rounded-full overflow-hidden bg-muted">
        <div className="h-full bg-blue-500" style={{ width: `${wp}%` }} title={`Warmup ${wp}%`} />
        <div
          className="h-full bg-emerald-500"
          style={{ width: `${mp}%` }}
          title={`Main ${mp}%`}
        />
        <div className="h-full bg-amber-500" style={{ width: `${ep}%` }} title={`Exam-prep ${ep}%`} />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
        <span>Warmup {wp}%</span>
        <span>Main {mp}%</span>
        <span>Exam {ep}%</span>
      </div>
    </div>
  );
}

// ── Budget ───────────────────────────────────────────────────────────────

type BudgetShape = {
  timeMin: number;
  questionCap: number;
  tier: string;
  source: string;
  recentCompletionRate: number | null;
  recentSheetsConsidered: number;
};

function BudgetCard({
  budget,
  usedQuestions,
}: {
  budget: BudgetShape;
  usedQuestions: number;
}) {
  const tierColor =
    budget.tier === 'weak'
      ? 'text-amber-500'
      : budget.tier === 'strong'
      ? 'text-emerald-500'
      : 'text-foreground';
  return (
    <section className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-2 mb-2">
        <Clock className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
          Budget
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {SOURCE_LABEL[budget.source] ?? budget.source}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Tier" value={TIER_LABEL[budget.tier] ?? budget.tier} valueClass={tierColor} />
        <Stat label="Target" value={`${Math.round(budget.timeMin)} min`} />
        <Stat label="Q cap" value={`${budget.questionCap}`} />
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">
          Picked{' '}
          <span className="text-foreground font-semibold">{usedQuestions}</span> of {budget.questionCap}
        </span>
        {budget.recentCompletionRate !== null && (
          <span className="text-muted-foreground">
            History: {Math.round(budget.recentCompletionRate * 100)}% over{' '}
            {budget.recentSheetsConsidered} sheets
          </span>
        )}
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-lg bg-muted p-2 text-center">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`text-sm font-bold mt-0.5 ${valueClass ?? 'text-foreground'}`}>
        {value}
      </div>
    </div>
  );
}

// ── Underfill banner ─────────────────────────────────────────────────────

function UnderfillBanner({ reasons }: { reasons: string[] }) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-1.5">
      {reasons.map((r) => (
        <div key={r} className="flex items-start gap-2 text-[11px] text-foreground">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
          <span>{UNDERFILL_LABEL[r] ?? r}</span>
        </div>
      ))}
    </div>
  );
}

// ── Slot section ─────────────────────────────────────────────────────────

// Shape we use locally — picked candidate from the planner. Keeping it loose
// (any) because the planner returns the full enriched shape and we just
// surface a subset; over-typing here is churn without benefit.
type PickedCandidate = {
  question: {
    _id: Id<'questionBank'>;
    source: string;
    difficulty: number | null;
    expectedTimeMin: number | null;
    questionNumberInPaper: string | null;
    linkedExerciseId: Id<'exercises'> | null;
    linkedQuestionKey: string | null;
  };
  concept: {
    conceptId: Id<'exercises'>;
    name: string;
    unitId: string;
    moduleId: string;
    grade: number;
    term: number;
    mastery: number;
    R: number;
    importance: number;
  };
  score: number;
  factors: {
    importance: number;
    urgency: number;
    fit: number;
    novelty: number;
    proximity: number;
    urgencyOverride: number | null;
    urgencyOverrideReason: string | null;
  };
};

// D.4 prereq alert shape matches planner.computePrereqAlerts return type.
type PrereqAlert = {
  type: 'prereqUnmet';
  questionId: Id<'questionBank'>;
  conceptId: Id<'exercises'>;
  conceptName: string;
  prereqId: Id<'exercises'>;
  prereqName: string;
  prereqMastery: number;
};

function SlotSection({
  title,
  subtitle,
  slot,
  color,
}: {
  title: string;
  subtitle: string;
  slot: PickedCandidate[];
  color: string;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-1 h-4 rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
        <h2 className="text-xs font-bold text-foreground uppercase tracking-wide">
          {title}
        </h2>
        <span className="text-[10px] text-muted-foreground ml-auto">{subtitle}</span>
      </div>
      {slot.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-4 text-center">
          <p className="text-[11px] text-muted-foreground">No questions allocated to this slot.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {slot.map((c, i) => (
            <QuestionCard key={c.question._id as unknown as string} c={c} index={i + 1} />
          ))}
        </div>
      )}
    </section>
  );
}

function QuestionCard({
  c,
  index,
}: {
  c: PickedCandidate;
  index: number;
}) {
  const [open, setOpen] = useState(false);
  const unitCtx = findUnit(c.concept.unitId);
  const moduleColor = MODULE_COLORS[c.concept.moduleId] ?? '#71717A';
  const sourceLabel =
    c.question.source === 'past-paper'
      ? `Past paper${c.question.questionNumberInPaper ? ` · Q${c.question.questionNumberInPaper}` : ''}`
      : c.question.source === 'textbook'
      ? c.question.linkedQuestionKey
        ? `Textbook · Q${c.question.linkedQuestionKey}`
        : 'Textbook'
      : c.question.source;
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2.5 flex items-start gap-2 text-left hover:bg-muted/40 transition-colors"
      >
        <span className="text-[10px] font-bold text-muted-foreground mt-0.5 w-4 tabular-nums">
          {index}
        </span>
        <div
          className="w-1 self-stretch rounded-full shrink-0"
          style={{ backgroundColor: moduleColor }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {c.question.source === 'past-paper' ? (
              <FileText className="w-3 h-3 text-amber-500 shrink-0" />
            ) : (
              <BookOpen className="w-3 h-3 text-muted-foreground shrink-0" />
            )}
            <span className="text-xs text-foreground truncate font-medium">
              {c.concept.name}
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
            {c.concept.moduleId} · G{c.concept.grade} T{c.concept.term}
            {unitCtx ? ` · ${unitCtx.unit.name}` : ''} · {sourceLabel}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[11px] font-bold text-foreground tabular-nums">
            {(c.score * 100).toFixed(0)}
          </div>
          <div className="text-[9px] text-muted-foreground tabular-nums">
            {c.question.expectedTimeMin ?? '?'}min · d{c.question.difficulty ?? '?'}
          </div>
        </div>
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
        )}
      </button>
      {open && (
        <div className="border-t border-border bg-muted/30 px-3 py-2.5 space-y-2">
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <ConceptStat label="Mastery" value={c.concept.mastery} highlightLow />
            <ConceptStat label="Retention R" value={c.concept.R} highlightLow />
            <ConceptStat label="Importance" value={c.concept.importance} />
            <ConceptStat label="Score" value={c.score} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1.5">
              Factor breakdown
              {c.factors.urgencyOverride !== null && (
                <span
                  title={c.factors.urgencyOverrideReason ?? ''}
                  className="px-1.5 py-0.5 rounded-full bg-red-500/10 border border-red-500/30 text-[9px] font-bold text-red-600 dark:text-red-400 flex items-center gap-0.5"
                >
                  <Zap className="w-2.5 h-2.5" />
                  EXAM BACKSTOP
                </span>
              )}
            </div>
            <FactorBar label="Importance" value={c.factors.importance} weight={0.3} />
            <FactorBar
              label="Urgency"
              value={c.factors.urgency}
              weight={0.25}
              suffix={
                c.factors.urgencyOverride !== null
                  ? '(forced)'
                  : undefined
              }
            />
            <FactorBar label="Fit" value={c.factors.fit} weight={0.2} />
            <FactorBar label="Novelty" value={c.factors.novelty} weight={0.15} />
            <FactorBar label="Proximity" value={c.factors.proximity} weight={0.1} />
            {c.factors.urgencyOverrideReason && (
              <p className="mt-1.5 text-[9.5px] text-red-600 dark:text-red-400 italic">
                {c.factors.urgencyOverrideReason}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ConceptStat({
  label,
  value,
  highlightLow,
}: {
  label: string;
  value: number;
  highlightLow?: boolean;
}) {
  const pct = value * 100;
  const cls = highlightLow
    ? value < 0.3
      ? 'text-red-500'
      : value < 0.5
      ? 'text-amber-500'
      : value < 0.75
      ? 'text-foreground'
      : 'text-emerald-500'
    : 'text-foreground';
  return (
    <div className="rounded-md bg-card border border-border px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`text-[11px] font-bold tabular-nums mt-0.5 ${cls}`}>
        {pct.toFixed(0)}%
      </div>
    </div>
  );
}

function FactorBar({
  label,
  value,
  weight,
  suffix,
}: {
  label: string;
  value: number;
  weight: number;
  suffix?: string;
}) {
  const contrib = value * weight;
  return (
    <div className="flex items-center gap-2 mb-1 last:mb-0">
      <div className="w-20 text-[10px] text-muted-foreground shrink-0 flex items-center gap-1">
        {label}
        {suffix && (
          <span className="text-[9px] text-red-500 font-semibold">{suffix}</span>
        )}
      </div>
      <div className="flex-1 h-1.5 rounded-full bg-card overflow-hidden border border-border">
        <div
          className={`h-full rounded-full ${suffix ? 'bg-red-500' : 'bg-primary'}`}
          style={{ width: `${value * 100}%` }}
        />
      </div>
      <div className="text-[10px] text-muted-foreground tabular-nums shrink-0 w-16 text-right">
        {value.toFixed(2)} × {weight} = {contrib.toFixed(2)}
      </div>
    </div>
  );
}

// ── Planner gaps ─────────────────────────────────────────────────────────

type PlannerGap = {
  conceptId: Id<'exercises'>;
  conceptName: string;
  reason: 'no-tags' | 'all-in-cooldown';
};

function PlannerGapsPanel({ gaps }: { gaps: PlannerGap[] }) {
  const [open, setOpen] = useState(false);
  const noTags = gaps.filter((g) => g.reason === 'no-tags');
  const cooldown = gaps.filter((g) => g.reason === 'all-in-cooldown');
  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2 flex items-center gap-2 hover:bg-muted/40"
      >
        <CircleAlert className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold text-foreground">
          Planner gaps ({gaps.length})
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {noTags.length} untagged · {cooldown.length} on cooldown
        </span>
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="border-t border-border max-h-60 overflow-y-auto divide-y divide-border">
          {gaps.map((g) => (
            <div
              key={g.conceptId as unknown as string}
              className="px-3 py-2 flex items-center gap-2"
            >
              <span className="text-xs text-foreground truncate flex-1">
                {g.conceptName}
              </span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${
                  g.reason === 'no-tags'
                    ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                    : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                }`}
              >
                {g.reason === 'no-tags' ? 'no tags' : 'cooldown'}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Meta panel ───────────────────────────────────────────────────────────

type MetaShape = {
  todayModule: string | null;
  cooldownStartYmd: string;
  cooldownDays: number;
  recentSheetCount: number;
  recentlyUsedQuestionCount: number;
  uniqueQuestionsConsidered: number;
  candidateCount: number;
  consideredConcepts: number;
  prereqGappedSkipped: number;
  scoredCount: number;
  pickedCount: number;
  weights: {
    importance: number;
    urgency: number;
    fit: number;
    novelty: number;
    proximity: number;
  };
  examSummary: Array<{ term: number; examDate: string; daysToExam: number }>;
};

function MetaPanel({
  meta,
  ratios,
}: {
  meta: MetaShape | null;
  ratios: { warmup: number; main: number; examPrep: number } | null;
}) {
  const [open, setOpen] = useState(false);
  if (!meta) return null;
  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2 flex items-center gap-2 hover:bg-muted/40"
      >
        <Info className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold text-foreground">Debug · planner internals</span>
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground ml-auto" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground ml-auto" />
        )}
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground space-y-0.5">
          <MetaRow label="Concepts in scope" value={`${meta.consideredConcepts}`} />
          <MetaRow label="Prereq-gapped skipped" value={`${meta.prereqGappedSkipped}`} />
          <MetaRow label="Unique Qs considered" value={`${meta.uniqueQuestionsConsidered}`} />
          <MetaRow label="Candidates (concept × Q)" value={`${meta.candidateCount}`} />
          <MetaRow label="Scored" value={`${meta.scoredCount}`} />
          <MetaRow label="Picked" value={`${meta.pickedCount}`} />
          <MetaRow
            label="Novelty cooldown"
            value={`${meta.cooldownDays}d (since ${meta.cooldownStartYmd}) · ${meta.recentlyUsedQuestionCount} Qs in ${meta.recentSheetCount} sheets`}
          />
          {ratios && (
            <MetaRow
              label="Ratios applied"
              value={`W ${ratios.warmup.toFixed(2)} · M ${ratios.main.toFixed(2)} · E ${ratios.examPrep.toFixed(2)}`}
            />
          )}
          <MetaRow
            label="Score weights"
            value={`I ${meta.weights.importance} · U ${meta.weights.urgency} · F ${meta.weights.fit} · N ${meta.weights.novelty} · P ${meta.weights.proximity}`}
          />
        </div>
      )}
    </section>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <span className="text-foreground font-mono text-right">{value}</span>
    </div>
  );
}

// ── D.4 prereq alerts panel ──────────────────────────────────────────────
// Loud-mode list — every (question, concept, prereq) triple where the
// prereq's mastery is below MASTERY_THRESHOLD. Soft warning, never blocks
// printing — Lead can override and print regardless.

function PrereqAlertsPanel({ alerts }: { alerts: PrereqAlert[] }) {
  const [open, setOpen] = useState(true);
  // Group by concept so the "10 alerts" feel less overwhelming when one
  // weak prereq spans many questions.
  const groups = useMemo(() => {
    const map = new Map<
      string,
      { conceptName: string; prereqs: Map<string, PrereqAlert[]> }
    >();
    for (const a of alerts) {
      const cKey = a.conceptId as unknown as string;
      let g = map.get(cKey);
      if (!g) {
        g = { conceptName: a.conceptName, prereqs: new Map() };
        map.set(cKey, g);
      }
      const pKey = a.prereqId as unknown as string;
      const list = g.prereqs.get(pKey) ?? [];
      list.push(a);
      g.prereqs.set(pKey, list);
    }
    return Array.from(map.entries()).map(([cKey, g]) => ({
      conceptId: cKey,
      conceptName: g.conceptName,
      prereqs: Array.from(g.prereqs.values()),
    }));
  }, [alerts]);
  return (
    <section className="rounded-xl border border-orange-500/30 bg-orange-500/5 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2 flex items-center gap-2 hover:bg-orange-500/10 transition-colors"
      >
        <ShieldAlert className="w-3.5 h-3.5 text-orange-500" />
        <span className="text-[11px] font-bold text-foreground">
          Prereq alerts ({alerts.length})
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {groups.length} concept{groups.length === 1 ? '' : 's'}
        </span>
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="border-t border-orange-500/30 max-h-64 overflow-y-auto divide-y divide-orange-500/20">
          {groups.map((g) => (
            <div key={g.conceptId} className="px-3 py-2">
              <div className="text-xs font-semibold text-foreground mb-1">
                {g.conceptName}
              </div>
              <div className="space-y-1 pl-2">
                {g.prereqs.map((alertList) => {
                  const first = alertList[0];
                  return (
                    <div
                      key={first.prereqId as unknown as string}
                      className="flex items-center justify-between gap-2 text-[10.5px]"
                    >
                      <span className="text-muted-foreground">
                        needs{' '}
                        <span className="text-foreground font-medium">
                          {first.prereqName}
                        </span>{' '}
                        ({alertList.length} Q{alertList.length === 1 ? '' : 's'})
                      </span>
                      <span
                        className={`tabular-nums font-mono shrink-0 ${
                          first.prereqMastery < 0.3
                            ? 'text-red-500 font-bold'
                            : 'text-amber-500 font-semibold'
                        }`}
                      >
                        {(first.prereqMastery * 100).toFixed(0)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── D.6 save / mark-printed / mark-completed ─────────────────────────────

type SavedSheet = {
  _id: Id<'generatedSheets'>;
  status?: string;
  generatedAt: number;
  printedAt?: number;
  completedAt?: number;
  warmupQuestionIds: Id<'questionBank'>[];
  mainQuestionIds: Id<'questionBank'>[];
  examPrepQuestionIds: Id<'questionBank'>[];
};

type SaveResult =
  | { ok: true; replaced: boolean; questionCount: number; alertCount: number }
  | { ok: false; message: string };

function SaveSheetCard({
  studentId,
  dateStr,
  unitIds,
  gradeByModule,
  savedSheet,
}: {
  studentId: Id<'students'>;
  dateStr: string;
  unitIds: string[];
  gradeByModule: Record<string, number[]>;
  savedSheet: SavedSheet | null;
}) {
  const saveMutation = useMutation(api.learningEngine.planner.saveSheetForStudent);
  const markPrintedMutation = useMutation(api.learningEngine.planner.markPrinted);
  const markCompletedMutation = useMutation(api.learningEngine.planner.markCompleted);
  const [busy, setBusy] = useState<'save' | 'print' | 'complete' | null>(null);
  const [result, setResult] = useState<SaveResult | null>(null);

  const status = savedSheet?.status ?? null;
  const isFrozen = status === 'printed' || status === 'completed';
  const savedQCount = savedSheet
    ? savedSheet.warmupQuestionIds.length +
      savedSheet.mainQuestionIds.length +
      savedSheet.examPrepQuestionIds.length
    : 0;

  async function handleSave() {
    setBusy('save');
    setResult(null);
    try {
      const r = await saveMutation({
        studentId,
        dateStr,
        unitIds,
        gradeByModule,
      });
      if (r.status === 'ok') {
        setResult({
          ok: true,
          replaced: r.replaced,
          questionCount: r.questionCount,
          alertCount: r.alertCount,
        });
      } else {
        setResult({ ok: false, message: `Skipped: ${r.status}` });
      }
    } catch (e) {
      setResult({ ok: false, message: describeMutationError(e) });
    } finally {
      setBusy(null);
    }
  }

  async function handlePrint() {
    if (!savedSheet) return;
    setBusy('print');
    try {
      await markPrintedMutation({ sheetId: savedSheet._id });
    } catch (e) {
      setResult({ ok: false, message: describeMutationError(e) });
    } finally {
      setBusy(null);
    }
  }

  async function handleComplete() {
    if (!savedSheet) return;
    setBusy('complete');
    try {
      await markCompletedMutation({ sheetId: savedSheet._id });
    } catch (e) {
      setResult({ ok: false, message: describeMutationError(e) });
    } finally {
      setBusy(null);
    }
  }

  const statusBadge = (() => {
    if (!status) return null;
    const styles: Record<string, string> = {
      draft: 'bg-muted text-muted-foreground border-border',
      printed:
        'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30',
      completed:
        'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    };
    return (
      <span
        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${
          styles[status] ?? styles.draft
        }`}
      >
        {status}
      </span>
    );
  })();

  return (
    <section className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-2 mb-2">
        <Save className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
          Save / print
        </span>
        {statusBadge}
        {savedSheet && (
          <span className="ml-auto text-[10px] text-muted-foreground">
            {savedQCount} Q saved · {new Date(savedSheet.generatedAt).toLocaleString()}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleSave}
          disabled={busy !== null || isFrozen}
          className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50 hover:bg-primary/90 transition-colors"
        >
          {busy === 'save' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          {savedSheet && !isFrozen ? 'Replace draft' : 'Save as draft'}
        </button>
        <button
          onClick={handlePrint}
          disabled={!savedSheet || busy !== null || status === 'completed'}
          className="px-3 py-2 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/30 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40 hover:bg-blue-500/20 transition-colors"
        >
          {busy === 'print' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Printer className="w-3.5 h-3.5" />
          )}
          Mark printed
        </button>
        <button
          onClick={handleComplete}
          disabled={!savedSheet || busy !== null || status === 'completed'}
          className="px-3 py-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40 hover:bg-emerald-500/20 transition-colors"
        >
          {busy === 'complete' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5" />
          )}
          Mark completed
        </button>
      </div>
      {isFrozen && (
        <p className="mt-2 text-[10.5px] text-muted-foreground italic">
          Sheet is {status} — delete from the dashboard before regenerating.
        </p>
      )}
      {result && (
        <div
          className={`mt-2 text-[11px] rounded-lg p-2 border ${
            result.ok
              ? 'bg-emerald-500/5 border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
              : 'bg-red-500/5 border-red-500/30 text-red-700 dark:text-red-400'
          }`}
        >
          {result.ok
            ? `${result.replaced ? 'Replaced draft' : 'Saved draft'} · ${result.questionCount} questions · ${result.alertCount} alerts`
            : result.message}
        </div>
      )}
    </section>
  );
}

// ── D.6 bulk class generation ────────────────────────────────────────────
// Lead picks a slot → we list its students client-side, compute scope per
// student, call saveSheetForStudent in a loop. No server-side mutation
// needed because scope derivation lives in src/lib/curriculum-data.ts.

type BulkProgress = {
  total: number;
  done: number;
  saved: number;
  offDay: number;
  errors: Array<{ name: string; message: string }>;
};

function BulkSlotCard({ dateStr }: { dateStr: string }) {
  const [open, setOpen] = useState(false);
  const allSlots = useQuery(api.scheduleSlots.list);
  const allStudents = useQuery(api.students.list);
  const [slotId, setSlotId] = useState<Id<'scheduleSlots'> | null>(null);
  const slotStudents = useQuery(
    api.learningEngine.planner.listSlotStudents,
    slotId ? { slotId } : 'skip',
  );
  const saveMutation = useMutation(api.learningEngine.planner.saveSheetForStudent);
  const [progress, setProgress] = useState<BulkProgress | null>(null);
  const [busy, setBusy] = useState(false);

  const dayOfWeek = new Date(`${dateStr}T00:00:00.000Z`).getUTCDay();
  const slotsForDay = useMemo(
    () => (allSlots ?? []).filter((s) => s.dayOfWeek === dayOfWeek),
    [allSlots, dayOfWeek],
  );

  async function handleBulkGenerate() {
    if (!slotStudents || slotStudents.length === 0) return;
    setBusy(true);
    const prog: BulkProgress = {
      total: slotStudents.length,
      done: 0,
      saved: 0,
      offDay: 0,
      errors: [],
    };
    setProgress({ ...prog });
    for (const s of slotStudents) {
      const studentForScope = allStudents?.find((x) => x._id === s._id) ?? s;
      const gbm = resolveGradeByModule(studentForScope);
      const uIds = unitIdsForScope(gbm);
      try {
        const r = await saveMutation({
          studentId: s._id,
          dateStr,
          unitIds: uIds,
          gradeByModule: gbm,
          slotId: slotId ?? undefined,
        });
        if (r.status === 'ok') prog.saved += 1;
        else if (r.status === 'off-day') prog.offDay += 1;
        else
          prog.errors.push({ name: s.name, message: `status: ${r.status}` });
      } catch (e) {
        prog.errors.push({ name: s.name, message: describeMutationError(e) });
      }
      prog.done += 1;
      setProgress({ ...prog });
    }
    setBusy(false);
  }

  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2 flex items-center gap-2 hover:bg-muted/40"
      >
        <Users className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold text-foreground">
          Bulk generate for whole class
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {slotsForDay.length} slot{slotsForDay.length === 1 ? '' : 's'} on this date
        </span>
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="border-t border-border p-3 space-y-2">
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">
              Slot
            </label>
            <select
              value={(slotId as unknown as string) ?? ''}
              onChange={(e) =>
                setSlotId((e.target.value || null) as Id<'scheduleSlots'> | null)
              }
              className="w-full px-2 py-1.5 rounded-md bg-muted text-sm text-foreground border border-border outline-none focus:border-primary"
            >
              <option value="">Pick a slot…</option>
              {slotsForDay.map((s) => (
                <option key={s._id as unknown as string} value={s._id as unknown as string}>
                  {s.startTime}–{s.endTime}
                </option>
              ))}
            </select>
          </div>
          {slotId && (
            <>
              <div className="text-[11px] text-muted-foreground">
                {slotStudents === undefined
                  ? 'Loading students…'
                  : `${slotStudents?.length ?? 0} student${(slotStudents?.length ?? 0) === 1 ? '' : 's'} in this slot`}
              </div>
              <button
                onClick={handleBulkGenerate}
                disabled={busy || !slotStudents || slotStudents.length === 0}
                className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50 hover:bg-primary/90 transition-colors"
              >
                {busy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                Generate {slotStudents?.length ?? 0} sheet
                {(slotStudents?.length ?? 0) === 1 ? '' : 's'}
              </button>
            </>
          )}
          {progress && (
            <div className="rounded-lg border border-border bg-muted/30 p-2 text-[11px] space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Progress</span>
                <span className="font-mono text-foreground">
                  {progress.done} / {progress.total}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-card overflow-hidden border border-border">
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: `${(progress.done / progress.total) * 100}%`,
                  }}
                />
              </div>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span>
                  Saved:{' '}
                  <span className="text-emerald-500 font-semibold">
                    {progress.saved}
                  </span>
                </span>
                <span>
                  Off-day:{' '}
                  <span className="text-amber-500 font-semibold">
                    {progress.offDay}
                  </span>
                </span>
                <span>
                  Errors:{' '}
                  <span
                    className={
                      progress.errors.length > 0
                        ? 'text-red-500 font-semibold'
                        : 'text-foreground'
                    }
                  >
                    {progress.errors.length}
                  </span>
                </span>
              </div>
              {progress.errors.length > 0 && (
                <div className="mt-1 max-h-32 overflow-y-auto space-y-0.5">
                  {progress.errors.map((e, i) => (
                    <div key={i} className="text-[10px] text-red-500">
                      <span className="font-semibold">{e.name}:</span> {e.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
