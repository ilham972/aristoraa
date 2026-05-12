'use client';

// Phase C.1 + C.2 — Per-student exam outlook surface.
//
// Reads studentProfile (Layer 4 view) and renders three sections:
//   1. Predicted exam % per (grade, term) the student studies. Downgraded
//      students see one row per studied grade — they sit only one exam (their
//      schoolGrade) but the Lead reads remediation grades separately to track
//      "is the catch-up working?"
//   2. Retention debt — "marks at risk in upcoming exam" per scheduled exam.
//      Hidden when no examCalendar row exists for that bucket.
//   3. Top at-risk concepts — high importance + low retention R.

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from 'convex/react';
import { AlertTriangle, CalendarClock, Target } from 'lucide-react';
import { api, type Id } from '@/lib/convex';
import { CURRICULUM_MODULES, findUnit } from '@/lib/curriculum-data';
import { MODULE_COLORS } from '@/lib/types';

interface Props {
  studentId: Id<'students'>;
}

const MODULE_IDS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'];

// Resolve per-module grade scope for the student. assignedGradesByModule wins
// per module when set; otherwise the global assignedGrades (or schoolGrade)
// applies to all modules. This is the canonical "what does this student
// actually study?" mapping used everywhere downstream.
function resolveGradeByModule(student: {
  schoolGrade: number;
  assignedGrades?: number[];
  assignedGradesByModule?: unknown;
}): Record<string, number[]> {
  const defaults =
    student.assignedGrades && student.assignedGrades.length > 0
      ? student.assignedGrades
      : [student.schoolGrade];
  const byMod = (student.assignedGradesByModule ?? {}) as Record<
    string,
    number[]
  >;
  const out: Record<string, number[]> = {};
  for (const m of MODULE_IDS) {
    const override = byMod[m];
    out[m] = Array.isArray(override) && override.length > 0 ? override : defaults;
  }
  return out;
}

// Cumulative unit list across all (moduleId, grade) pairs the student
// actually studies. Predictions for (G, T=3) need T1+T2+T3 concepts under
// that grade. Pairs the student does NOT study are excluded so the backend
// doesn't have to filter them out.
function unitIdsForScope(
  gradeByModule: Record<string, number[]>,
): string[] {
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

export function StudentExamOutlook({ studentId }: Props) {
  // We need to know the student's grade scope before we can resolve unitIds.
  // The student query is cached separately from studentProfile so the
  // unitIds derivation is cheap once `student` lands.
  const student = useQuery(api.students.get, { id: studentId });

  const gradeByModule = useMemo<Record<string, number[]>>(
    () => (student ? resolveGradeByModule(student) : {}),
    [student],
  );

  const unitIds = useMemo(() => unitIdsForScope(gradeByModule), [gradeByModule]);

  const data = useQuery(
    api.learningEngine.profile.studentProfile,
    student && unitIds.length > 0
      ? { studentId, unitIds, gradeByModule }
      : 'skip',
  );

  if (student === undefined || data === undefined) {
    return (
      <div className="space-y-2 animate-pulse mb-4">
        <div className="h-24 bg-muted rounded-xl" />
        <div className="h-20 bg-muted rounded-xl" />
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground mb-4">
        Sign in required.
      </div>
    );
  }

  const predicted = data.predictedExamPctPerGradeTerm;
  const studiedShare = data.studiedImportanceShareByGradeTerm;
  const debt = data.retentionDebtByGradeTerm;

  // Bucket list to render — only (G, T) where we have *any* importance data.
  // Sort: the student's own schoolGrade comes first (it's the exam they will
  // actually sit), downgrade grades follow. Within a grade, ascending term.
  // Without this, a downgraded G11 student sees the G10 row above G11 and may
  // misread the predicted % as their primary signal.
  const schoolGrade = data.student.schoolGrade;
  const buckets = Object.keys(predicted)
    .map((k) => {
      const m = /^G(\d+)T(\d+)$/.exec(k);
      if (!m) return null;
      return { key: k, grade: Number(m[1]), term: Number(m[2]) };
    })
    .filter((b): b is { key: string; grade: number; term: number } => b !== null)
    .sort((a, b) => {
      const aIsSchool = a.grade === schoolGrade ? 0 : 1;
      const bIsSchool = b.grade === schoolGrade ? 0 : 1;
      if (aIsSchool !== bIsSchool) return aIsSchool - bIsSchool;
      // After schoolGrade group: descending grade so higher (closer to school
      // grade) downgrades show before deeper remediation.
      if (a.grade !== b.grade) return b.grade - a.grade;
      return a.term - b.term;
    });

  const top5AtRisk = data.atRiskConcepts.slice(0, 5);

  // The student sits the exam at their schoolGrade. Surface a clear hint when
  // we have buckets for downgrade grades but none for the school grade — that
  // almost always means "Recompute importance for the actual exam grade has
  // not been run yet."
  const hasSchoolGradeBucket = buckets.some((b) => b.grade === schoolGrade);
  const hasOtherBucket = buckets.some((b) => b.grade !== schoolGrade);
  const missingSchoolGradeImportance =
    buckets.length > 0 && !hasSchoolGradeBucket && hasOtherBucket;

  return (
    <div className="space-y-3 mb-4">
      {/* Next exam summary */}
      {data.nextExam && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-center gap-2 mb-1">
            <CalendarClock className="w-3.5 h-3.5 text-primary" />
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
              Next exam
            </div>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <div className="text-sm font-bold text-foreground">
                G{data.nextExam.grade} · Term {data.nextExam.term}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {data.nextExam.examDate}
                {data.nextExam.totalMarks != null && (
                  <span> · {data.nextExam.totalMarks} marks</span>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xl font-bold text-primary tabular-nums">
                {data.nextExam.daysToExam}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {data.nextExam.daysToExam === 1 ? 'day' : 'days'}
              </div>
            </div>
          </div>
        </div>
      )}

      {!data.nextExam && (
        <Link
          href="/algorithm/exam-calendar"
          className="block rounded-xl border border-dashed border-border bg-card/40 p-3 text-center hover:bg-muted/30"
        >
          <div className="text-[11px] text-muted-foreground">
            No upcoming exam scheduled for this student&apos;s grades.
          </div>
          <div className="text-[10px] text-primary mt-1">
            Add one in Exam calendar →
          </div>
        </Link>
      )}

      {/* Predicted exam % + retention debt per (G, T) */}
      {buckets.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-3.5 h-3.5 text-muted-foreground" />
            <h2 className="text-[10px] font-bold text-foreground uppercase tracking-wide">
              Exam outlook
            </h2>
          </div>
          {missingSchoolGradeImportance && (
            <Link
              href={`/algorithm/blueprint?g=${schoolGrade}&t=1`}
              className="block mb-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 hover:bg-amber-500/10"
            >
              <div className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold">
                No G{schoolGrade} importance computed yet
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                This student sits the G{schoolGrade} exam. Recompute the
                blueprint for that grade to see their primary prediction →
              </div>
            </Link>
          )}
          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            {buckets.map((b) => {
              const pct = predicted[b.key] ?? 0;
              const share = studiedShare[b.key] ?? 0;
              const d = debt[b.key];
              return (
                <BucketRow
                  key={b.key}
                  grade={b.grade}
                  term={b.term}
                  predictedPct={pct}
                  studiedShare={share}
                  debt={d}
                  isSchoolGrade={b.grade === schoolGrade}
                />
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            Predicted % = Σ (mastery × concept importance) under the (grade,
            term) exam blueprint. Marks at risk = importance share of concepts
            with mastery &lt; 0.5, scaled to the exam&apos;s total marks.
          </p>
        </section>
      )}

      {buckets.length === 0 && (
        <Link
          href="/algorithm/blueprint"
          className="block rounded-xl border border-dashed border-border bg-card/40 p-3 text-center hover:bg-muted/30"
        >
          <div className="text-[11px] text-muted-foreground">
            No importance data yet — predictions and at-risk cannot be computed.
          </div>
          <div className="text-[10px] text-primary mt-1">
            Recompute in Blueprint →
          </div>
        </Link>
      )}

      {/* Top at-risk concepts */}
      {top5AtRisk.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            <h2 className="text-[10px] font-bold text-foreground uppercase tracking-wide">
              At risk · top {top5AtRisk.length}
            </h2>
          </div>
          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            {top5AtRisk.map((c) => (
              <AtRiskRow key={c.conceptId as unknown as string} concept={c} />
            ))}
          </div>
          {data.atRiskConcepts.length > top5AtRisk.length && (
            <p className="text-[10px] text-muted-foreground mt-2">
              {data.atRiskConcepts.length - top5AtRisk.length} more concepts at
              risk — full list will surface on the Lead dashboard.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function BucketRow({
  grade,
  term,
  predictedPct,
  studiedShare,
  debt,
  isSchoolGrade,
}: {
  grade: number;
  term: number;
  predictedPct: number;
  studiedShare: number;
  isSchoolGrade: boolean;
  debt:
    | {
        grade: number;
        term: number;
        atRiskImportanceSum: number;
        totalMarks: number;
        marksAtRisk: number;
        totalMarksSource: 'calendar' | 'paper' | 'fallback';
        nextExamDate: string | null;
        daysToExam: number | null;
      }
    | undefined;
}) {
  const pct = predictedPct * 100;
  let pctClass = 'text-foreground';
  if (predictedPct >= 0.75) pctClass = 'text-emerald-500';
  else if (predictedPct >= 0.5) pctClass = 'text-teal-500';
  else if (predictedPct >= 0.25) pctClass = 'text-amber-500';
  else pctClass = 'text-red-500';

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <div className="text-xs font-semibold text-foreground">
              G{grade} · Term {term}
            </div>
            {isSchoolGrade && (
              <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/15 text-primary font-bold">
                Actual
              </span>
            )}
            {!isSchoolGrade && (
              <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-semibold">
                Remediation
              </span>
            )}
          </div>
          {debt && debt.nextExamDate ? (
            <div className="text-[10px] text-muted-foreground">
              {debt.nextExamDate} ·{' '}
              {debt.daysToExam === 0
                ? 'today'
                : `in ${debt.daysToExam}d`}
            </div>
          ) : (
            <div className="text-[10px] text-muted-foreground italic">
              no exam scheduled
            </div>
          )}
          {studiedShare < 0.99 && studiedShare > 0 && (
            <div className="text-[10px] text-muted-foreground">
              studies {(studiedShare * 100).toFixed(0)}% of paper weight
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className={`text-base font-bold tabular-nums ${pctClass}`}>
            {pct.toFixed(0)}%
          </div>
          <div className="text-[10px] text-muted-foreground">predicted</div>
        </div>
      </div>
      {debt && (
        <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
          <div className="flex items-baseline gap-1">
            <span className="font-semibold text-amber-500 tabular-nums">
              {debt.marksAtRisk.toFixed(1)}
            </span>
            <span className="text-muted-foreground">
              / {debt.totalMarks} marks at risk
            </span>
            {debt.totalMarksSource !== 'calendar' && (
              <span className="text-[9px] text-muted-foreground/70 uppercase">
                ({debt.totalMarksSource})
              </span>
            )}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {(debt.atRiskImportanceSum * 100).toFixed(0)}% of weight
          </div>
        </div>
      )}
    </div>
  );
}

function AtRiskRow({
  concept,
}: {
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
    prereqGap: boolean;
  };
}) {
  const ctx = findUnit(concept.unitId);
  const color = MODULE_COLORS[concept.moduleId] ?? '#0D9488';
  return (
    <div className="px-3 py-2 flex items-center gap-2">
      <div
        className="w-1 h-8 rounded-full shrink-0"
        style={{ backgroundColor: color }}
      />
      <div className="min-w-0 flex-1">
        <div className="text-xs text-foreground truncate">
          {concept.name}
        </div>
        <div className="text-[10px] text-muted-foreground truncate">
          {concept.moduleId} · G{concept.grade} T{concept.term}
          {ctx ? ` · ${ctx.unit.name}` : ''}
          {concept.prereqGap && (
            <span className="ml-1 text-red-500">· prereq gap</span>
          )}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-[11px] font-semibold text-foreground tabular-nums">
          {(concept.importance * 100).toFixed(1)}%
        </div>
        <div className="text-[10px] text-muted-foreground tabular-nums">
          R {(concept.R * 100).toFixed(0)}%
        </div>
      </div>
    </div>
  );
}
