'use client';

// Inspector body for the /sheets drawer. Extracted from the legacy
// algorithm/sheet-planner-tab.tsx — kept feature-equivalent (Phase 0.x ..
// Phase E.x decisions all preserved):
//
//   - Phase & ratios card (with EXAM WEEK badge + multi-term days-to-exam)
//   - Budget card (tier, target time, Q cap, source, completion history)
//   - Underfill banner
//   - Three slot sections (warm-up / main / exam-prep) with per-Q cards
//   - Per-Q expand: mastery / R / importance / score + factor bars
//   - EXAM BACKSTOP urgency-override badge
//   - Prereq alerts panel (grouped concept → prereq)
//   - Planner gaps panel (no-tags / cooldown)
//   - Meta debug panel (concepts in scope, candidates, weights, cooldown)
//
// Save / print / complete actions live in the drawer's sticky action bar.
// Bulk-class generate is intentionally not duplicated here — the /sheets
// page has the richer slot-bulk panel at the top.

import { useMemo, useState } from 'react';
import { useQuery } from 'convex/react';
import {
  Target,
  Clock,
  AlertTriangle,
  CircleAlert,
  Info,
  Coffee,
  ChevronDown,
  ChevronRight,
  FileText,
  BookOpen,
  ShieldAlert,
  Zap,
} from 'lucide-react';
import { api, type Id } from '@/lib/convex';
import { findUnit } from '@/lib/curriculum-data';
import { MODULE_COLORS } from '@/lib/types';

// ── Labels (copy of planner constants) ───────────────────────────────────

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

// ── Public types ─────────────────────────────────────────────────────────

export type PrereqAlert = {
  type: 'prereqUnmet';
  questionId: Id<'questionBank'>;
  conceptId: Id<'exercises'>;
  conceptName: string;
  prereqId: Id<'exercises'>;
  prereqName: string;
  prereqMastery: number;
};

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

type PhaseShape = {
  key: string;
  ratios: { warmup: number; main: number; examPrep: number };
  examWeekMode: boolean;
  daysToExam: number | null;
  examTerm: number | null;
  examDate: string | null;
} | null;

type BudgetShape = {
  timeMin: number;
  questionCap: number;
  tier: string;
  source: string;
  recentCompletionRate: number | null;
  recentSheetsConsidered: number;
};

type PlannerGap = {
  conceptId: Id<'exercises'>;
  conceptName: string;
  reason: 'no-tags' | 'all-in-cooldown';
};

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

// ── Main exported component ──────────────────────────────────────────────

export function InspectorBody({
  studentId,
  dateStr,
  unitIds,
  gradeByModule,
}: {
  studentId: Id<'students'>;
  dateStr: string;
  unitIds: string[];
  gradeByModule: Record<string, number[]>;
}) {
  const plan = useQuery(
    api.learningEngine.planner.planSheet,
    unitIds.length > 0
      ? { studentId, dateStr, unitIds, gradeByModule }
      : 'skip',
  );

  if (plan === undefined) {
    return (
      <div className="space-y-2 animate-pulse">
        <div className="h-20 bg-muted rounded-xl" />
        <div className="h-24 bg-muted rounded-xl" />
        <div className="h-32 bg-muted rounded-xl" />
        <div className="h-32 bg-muted rounded-xl" />
      </div>
    );
  }
  if (plan === null) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
        Sign in required.
      </div>
    );
  }
  if (plan.status === 'off-day') {
    return <OffDayCard reason={plan.offDayReason ?? null} />;
  }

  return (
    <div className="space-y-4">
      <PhaseInfoCard
        phase={plan.phase}
        examSummary={plan.meta?.examSummary ?? []}
      />
      <BudgetCard
        budget={plan.budget}
        usedQuestions={
          plan.warmup.length +
          plan.main.length +
          plan.revision.length +
          plan.examPrep.length
        }
      />
      {plan.underFillReasons.length > 0 && (
        <UnderfillBanner reasons={plan.underFillReasons} />
      )}
      <SlotSection
        title="Warm-up"
        subtitle="Recent mistakes · easy first"
        slot={plan.warmup}
        color="#2E86C1"
      />
      <SlotSection
        title="Main block"
        subtitle={
          plan.phase?.examWeekMode
            ? `Exam-term focus (T${plan.phase?.examTerm ?? '?'})`
            : 'Next new concept(s) on the path'
        }
        slot={plan.main}
        color="#0D9488"
      />
      <SlotSection
        title="Revision"
        subtitle="Spaced repetition · due concepts"
        slot={plan.revision}
        color="#1E8449"
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
      {plan.plannerGaps.length > 0 && (
        <PlannerGapsPanel gaps={plan.plannerGaps} />
      )}
      <MetaPanel meta={plan.meta} ratios={plan.phase?.ratios ?? null} />
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

// ── Phase & ratios ───────────────────────────────────────────────────────

function PhaseInfoCard({
  phase,
  examSummary,
}: {
  phase: PhaseShape;
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
        <div className="h-full bg-emerald-500" style={{ width: `${mp}%` }} title={`Main ${mp}%`} />
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
        <div className="w-1 h-4 rounded-full shrink-0" style={{ backgroundColor: color }} />
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

function QuestionCard({ c, index }: { c: PickedCandidate; index: number }) {
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
              suffix={c.factors.urgencyOverride !== null ? '(forced)' : undefined}
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

// ── Prereq alerts ────────────────────────────────────────────────────────

function PrereqAlertsPanel({ alerts }: { alerts: PrereqAlert[] }) {
  const [open, setOpen] = useState(true);
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

// ── Meta debug ───────────────────────────────────────────────────────────

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
