'use client';

// Lesson Builder — the full-screen generate dialog (2026-07-11, replaces the
// small stepper-only control panel from 2026-06-12).
//
// What it adds (founder design, approved in-chat):
//   • JOIN students: session roster chips — joined students all receive the
//     SAME ticked Main block (the shared lesson) while Warm-up / Revision /
//     Exam-prep stay PERSONAL per student (the moat survives).
//   • QUESTION PICKER: every question of the taught unit, grouped by concept
//     in teaching order, each row = checkbox + crop thumbnail. The
//     algorithm's Main picks arrive pre-ticked; the teacher overrides freely
//     (engine-picked with manual override — a locked founder decision).
//   • LESSON SETS: save the tick-set as a named preset per unit
//     ("Fractions — Layer 1") and reuse it for any student/group later.
//
// Generation = one saveSheetForStudent call per joined student with the same
// mainQuestionIdsOverride (ticks, in display order) — same bulk pattern the
// Sheets tab already uses. An untouched dialog still behaves as before:
// no ticks changed → the override equals the algorithm's own picks.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation } from 'convex/react';
import {
  ArrowRight,
  BookmarkPlus,
  Check,
  ChevronDown,
  Minus,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import { api, type Id } from '@/lib/convex';
import { findUnit } from '@/lib/curriculum-data';
import { describeError } from '@/lib/sheets/scope';
import { CropThumbnail } from '@/components/algorithm/sheet-preview';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type SectionKey = 'warmup' | 'revision' | 'examPrep';

const PERSONAL_SECTIONS: Array<{ key: SectionKey; label: string; hint: string }> = [
  { key: 'warmup', label: 'Warm-up', hint: 'their recent mistakes' },
  { key: 'revision', label: 'Revision', hint: 'their forgetting curve' },
  { key: 'examPrep', label: 'Exam prep', hint: 'their mastered concepts' },
];

export type PlannerRosterEntry = {
  studentId: Id<'students'>;
  studentName: string;
  locked: boolean; // printed/completed sheet — cannot regenerate from here
};

export function SheetPlannerPanel({
  studentId,
  studentName,
  date,
  slotId,
  unitIds,
  gradeByModule,
  roster,
  resolveScope,
  onClose,
  onGenerated,
}: {
  studentId: Id<'students'>;
  studentName: string;
  date: string;
  slotId: Id<'scheduleSlots'>;
  unitIds: string[];
  gradeByModule: Record<string, number[]>;
  roster: PlannerRosterEntry[];
  resolveScope: (
    id: Id<'students'>,
  ) => { unitIds: string[]; gradeByModule: Record<string, number[]> } | null;
  onClose: () => void;
  onGenerated: () => void;
}) {
  // ── Who's in this lesson ────────────────────────────────────────────
  const [joined, setJoined] = useState<Set<string>>(
    () => new Set([studentId as unknown as string]),
  );
  const toggleJoin = (id: Id<'students'>) => {
    const k = id as unknown as string;
    setJoined((s) => {
      const next = new Set(s);
      if (next.has(k)) {
        if (next.size > 1) next.delete(k); // never empty
      } else {
        next.add(k);
      }
      return next;
    });
  };

  // ── Section targets for the PERSONAL sections (unchanged behavior) ──
  const [targets, setTargets] = useState<Partial<Record<SectionKey, number>>>({});
  const [busy, setBusy] = useState(false);

  // ── The taught unit + tick state ────────────────────────────────────
  // null until the plan preview reveals the primary student's frontier.
  const [unitId, setUnitId] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(() => new Set());
  const seededForUnit = useRef<string | null>(null);

  // Live preview for the PRIMARY student (read-only planSheet — never writes).
  // Includes the override so the personal-section preview plans around it.
  const tickedArr = useMemo(() => Array.from(ticked), [ticked]);
  const cleanedTargets = useMemo(() => {
    const out: Record<string, number> = {};
    for (const s of PERSONAL_SECTIONS) {
      const v = targets[s.key];
      if (typeof v === 'number') out[s.key] = v;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }, [targets]);
  const plan = useQuery(api.learningEngine.planner.planSheet, {
    studentId,
    dateStr: date,
    unitIds,
    gradeByModule,
    slotId,
    ...(cleanedTargets ? { sectionTargets: cleanedTargets } : {}),
    ...(seededForUnit.current && tickedArr.length > 0
      ? { mainQuestionIdsOverride: tickedArr as Id<'questionBank'>[] }
      : {}),
  });

  // Student doc → track → unit dropdown options.
  const student = useQuery(api.students.get, { id: studentId });
  const track = useQuery(
    api.learningEngine.tracks.getTrack,
    student?.trackId ? { id: student.trackId } : 'skip',
  );

  // Default unit = the frontier the algorithm planned to teach.
  const frontierUnitId = plan?.main?.[0]?.concept.unitId ?? null;
  useEffect(() => {
    if (unitId === null && frontierUnitId) setUnitId(frontierUnitId);
  }, [unitId, frontierUnitId]);

  // Unit question catalog + saved lessons.
  const catalog = useQuery(
    api.learningEngine.lessonSets.listUnitQuestions,
    unitId ? { unitId } : 'skip',
  );
  const lessonSets = useQuery(
    api.learningEngine.lessonSets.listForUnit,
    unitId ? { unitId } : 'skip',
  );
  const saveLesson = useMutation(api.learningEngine.lessonSets.saveLessonSet);
  const deleteLesson = useMutation(api.learningEngine.lessonSets.deleteLessonSet);
  const saveSheet = useMutation(api.learningEngine.planner.saveSheetForStudent);

  // Seed ticks ONCE per unit: frontier unit → the algorithm's own Main picks;
  // any other unit the teacher navigates to → start empty.
  useEffect(() => {
    if (!unitId || seededForUnit.current === unitId) return;
    if (unitId === frontierUnitId) {
      if (!plan) return; // wait for picks
      seededForUnit.current = unitId;
      setTicked(
        new Set(
          (plan.main ?? []).map(
            (p) => p.question._id as unknown as string,
          ),
        ),
      );
    } else {
      seededForUnit.current = unitId;
      setTicked(new Set());
    }
  }, [unitId, frontierUnitId, plan]);

  const algoPicks = useMemo(
    () =>
      new Set(
        (plan?.main ?? []).map((p) => p.question._id as unknown as string),
      ),
    [plan],
  );

  const toggleTick = (qid: string) => {
    setTicked((s) => {
      const next = new Set(s);
      if (next.has(qid)) next.delete(qid);
      else next.add(qid);
      return next;
    });
  };

  // Ticks in DISPLAY order (concept order → difficulty) = print order.
  const orderedTicks = useMemo(() => {
    if (!catalog) return tickedArr;
    const out: string[] = [];
    for (const c of catalog.concepts) {
      for (const q of c.questions) {
        const k = q.questionId as unknown as string;
        if (ticked.has(k)) out.push(k);
      }
    }
    // Keep any ticked ids not visible in the catalog (e.g. preset from an
    // edited bank) at the end rather than silently dropping them.
    for (const k of tickedArr) if (!out.includes(k)) out.push(k);
    return out;
  }, [catalog, ticked, tickedArr]);

  const tickedTimeMin = useMemo(() => {
    if (!catalog) return null;
    let t = 0;
    for (const c of catalog.concepts) {
      for (const q of c.questions) {
        if (ticked.has(q.questionId as unknown as string)) {
          t += q.expectedTimeMin ?? 4;
        }
      }
    }
    return t;
  }, [catalog, ticked]);

  const unitName = unitId ? findUnit(unitId)?.unit.name ?? unitId : null;
  const isOffDay = plan?.status === 'off-day';
  const loading = plan === undefined;

  // ── Save lesson set ─────────────────────────────────────────────────
  const onSaveLesson = async () => {
    if (!unitId || orderedTicks.length === 0) return;
    const name = window.prompt(
      'Lesson name (e.g. "Layer 1 — intro", "Layer 2 — hard"):',
    );
    if (!name || name.trim().length === 0) return;
    try {
      const res = await saveLesson({
        unitId,
        name: name.trim(),
        questionIds: orderedTicks as Id<'questionBank'>[],
      });
      toast.success(res.updated ? `"${name.trim()}" updated` : `"${name.trim()}" saved`);
    } catch (e) {
      toast.error(describeError(e));
    }
  };

  // ── Generate for all joined students ────────────────────────────────
  const onGenerate = async () => {
    const targetsList = roster.filter(
      (r) => joined.has(r.studentId as unknown as string) && !r.locked,
    );
    if (targetsList.length === 0) return;
    setBusy(true);
    let saved = 0;
    const errs: string[] = [];
    for (const r of targetsList) {
      const scope = resolveScope(r.studentId) ?? { unitIds, gradeByModule };
      try {
        const res = await saveSheet({
          studentId: r.studentId,
          dateStr: date,
          unitIds: scope.unitIds,
          gradeByModule: scope.gradeByModule,
          slotId,
          ...(cleanedTargets ? { sectionTargets: cleanedTargets } : {}),
          ...(orderedTicks.length > 0
            ? { mainQuestionIdsOverride: orderedTicks as Id<'questionBank'>[] }
            : {}),
        });
        if (res.status === 'ok') saved += 1;
        else if (res.status === 'off-day') {
          errs.push(`${r.studentName}: off day`);
        }
      } catch (e) {
        errs.push(`${r.studentName}: ${describeError(e)}`);
      }
    }
    setBusy(false);
    if (errs.length === 0) {
      toast.success(
        `${saved} sheet${saved === 1 ? '' : 's'} generated — same lesson, personal revision`,
      );
      onGenerated();
    } else {
      toast.error(`${saved} saved, ${errs.length} failed. First: ${errs[0]}`);
    }
  };

  const joinedCount = roster.filter(
    (r) => joined.has(r.studentId as unknown as string) && !r.locked,
  ).length;

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="min-w-0">
          <div className="text-sm font-bold text-foreground truncate">
            Build lesson · {date}
          </div>
          <div className="text-[11px] text-muted-foreground truncate">
            {unitName ?? 'Loading unit…'}
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-md hover:bg-muted text-muted-foreground"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {isOffDay ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          {studentName} rests today — no sheet will be written.
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4 pb-6">
          {/* ── Students in this lesson ── */}
          <section>
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">
              Students in this lesson — same Main block, personal revision
            </div>
            <div className="flex flex-wrap gap-1.5">
              {roster.map((r) => {
                const k = r.studentId as unknown as string;
                const on = joined.has(k);
                return (
                  <button
                    key={k}
                    disabled={r.locked}
                    onClick={() => toggleJoin(r.studentId)}
                    className={cn(
                      'inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors',
                      on
                        ? 'bg-primary/15 border-primary/50 text-primary'
                        : 'bg-muted/40 border-border text-muted-foreground',
                      r.locked && 'opacity-40',
                    )}
                    title={r.locked ? 'Sheet already printed — delete it first' : undefined}
                  >
                    {on && <Check className="w-3 h-3" />}
                    {r.studentName.split(' ')[0]}
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── Unit selector ── */}
          {track && track.orderedUnitIds.length > 0 && (
            <section>
              <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">
                Teaching unit
              </div>
              <div className="relative">
                <select
                  value={unitId ?? ''}
                  onChange={(e) => setUnitId(e.target.value || null)}
                  className="w-full appearance-none rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground pr-9"
                >
                  {unitId && !track.orderedUnitIds.includes(unitId) && (
                    <option value={unitId}>{unitName}</option>
                  )}
                  {track.orderedUnitIds.map((u) => (
                    <option key={u} value={u}>
                      {findUnit(u)?.unit.name ?? u}
                      {u === frontierUnitId ? '  ← now' : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              </div>
            </section>
          )}

          {/* ── Saved lessons ── */}
          {unitId && (
            <section>
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  Saved lessons for this unit
                </div>
                <button
                  onClick={onSaveLesson}
                  disabled={orderedTicks.length === 0}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary disabled:opacity-40"
                >
                  <BookmarkPlus className="w-3.5 h-3.5" />
                  Save as lesson
                </button>
              </div>
              {lessonSets && lessonSets.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {lessonSets.map((ls) => (
                    <span
                      key={ls._id as unknown as string}
                      className="inline-flex items-center rounded-xl border border-border bg-muted/40 overflow-hidden"
                    >
                      <button
                        onClick={() =>
                          setTicked(
                            new Set(
                              ls.questionIds.map(
                                (q) => q as unknown as string,
                              ),
                            ),
                          )
                        }
                        className="px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/70"
                      >
                        {ls.name}
                        <span className="ml-1 text-muted-foreground">
                          ({ls.questionIds.length})
                        </span>
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(`Delete lesson "${ls.name}"?`)) {
                            deleteLesson({ id: ls._id }).catch((e) =>
                              toast.error(describeError(e)),
                            );
                          }
                        }}
                        className="px-1.5 py-1.5 text-muted-foreground hover:text-red-400"
                        aria-label={`Delete ${ls.name}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] text-muted-foreground italic">
                  None yet — tick questions below, then “Save as lesson”.
                </div>
              )}
            </section>
          )}

          {/* ── Question picker ── */}
          <section>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Main block — tick the questions to teach
              </div>
              <div className="text-[11px] text-muted-foreground">
                <span className="font-bold text-foreground">{orderedTicks.length}</span> ticked
                {tickedTimeMin !== null && ` · ~${tickedTimeMin} min`}
              </div>
            </div>
            {!unitId || catalog === undefined ? (
              <div className="space-y-2 animate-pulse">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 bg-muted rounded-xl" />
                ))}
              </div>
            ) : catalog === null ? (
              <div className="text-[11px] text-muted-foreground">Not signed in.</div>
            ) : catalog.concepts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 p-4 text-center text-[11px] text-muted-foreground">
                No concepts found for this unit.
              </div>
            ) : (
              <div className="space-y-3">
                {catalog.concepts.map((c) => (
                  <div key={c.conceptId as unknown as string}>
                    <div className="text-[11px] font-semibold text-foreground/90 mb-1">
                      {c.conceptName}
                      <span className="ml-1.5 text-muted-foreground font-normal">
                        {
                          c.questions.filter((q) =>
                            ticked.has(q.questionId as unknown as string),
                          ).length
                        }
                        /{c.questions.length}
                      </span>
                    </div>
                    {c.questions.length === 0 ? (
                      <div className="text-[10px] text-amber-500 mb-1">
                        ⚠ no questions cropped for this concept
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {c.questions.map((q) => {
                          const k = q.questionId as unknown as string;
                          const on = ticked.has(k);
                          const byAlgo = algoPicks.has(k);
                          return (
                            <div
                              key={k}
                              className={cn(
                                'flex items-center gap-2.5 rounded-xl border px-2.5 py-1.5',
                                on
                                  ? 'border-primary/50 bg-primary/5'
                                  : 'border-border/60 bg-card',
                              )}
                            >
                              <button
                                onClick={() => toggleTick(k)}
                                className={cn(
                                  'w-5 h-5 shrink-0 rounded-md border-2 flex items-center justify-center transition-colors',
                                  on
                                    ? 'bg-primary border-primary text-primary-foreground'
                                    : 'border-muted-foreground/40 bg-background',
                                )}
                                aria-label={on ? 'Untick' : 'Tick'}
                              >
                                {on && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                              </button>
                              <button
                                onClick={() => toggleTick(k)}
                                className="w-10 shrink-0 text-left"
                              >
                                <span className="block text-[11px] font-semibold text-foreground">
                                  {q.label ?? '·'}
                                </span>
                                {q.difficulty !== null && (
                                  <span className="block text-[9px] text-muted-foreground">
                                    d{q.difficulty}
                                  </span>
                                )}
                                {byAlgo && (
                                  <span className="block text-[8px] font-bold uppercase text-primary">
                                    algo
                                  </span>
                                )}
                              </button>
                              <div className="flex-1 min-w-0">
                                {q.overrideImageUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={q.overrideImageUrl}
                                    alt="Question"
                                    className="max-w-full h-auto rounded"
                                    style={{ maxHeight: 72 }}
                                  />
                                ) : q.cropBox && q.pageImageUrl ? (
                                  <CropThumbnail
                                    imageUrl={q.pageImageUrl}
                                    imageUrlSmall={q.pageImageUrlSmall}
                                    cropBox={q.cropBox}
                                    maxSide={72}
                                  />
                                ) : (
                                  <span className="text-[10px] text-muted-foreground italic">
                                    no crop image
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── Personal sections ── */}
          <section>
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">
              Personal sections — adapt to each student individually
            </div>
            <div className="space-y-2">
              {PERSONAL_SECTIONS.map((s) => {
                const picks =
                  s.key === 'warmup'
                    ? plan?.warmup ?? []
                    : s.key === 'revision'
                      ? plan?.revision ?? []
                      : plan?.examPrep ?? [];
                const n = targets[s.key] ?? picks.length;
                return (
                  <div
                    key={s.key}
                    className="rounded-xl border border-border/70 bg-muted/20 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold text-foreground">
                          {s.label}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {s.hint}
                          {loading && ' · loading…'}
                        </div>
                      </div>
                      <Stepper
                        value={n}
                        onDec={() =>
                          setTargets((t) => ({
                            ...t,
                            [s.key]: Math.max(0, (t[s.key] ?? picks.length) - 1),
                          }))
                        }
                        onInc={() =>
                          setTargets((t) => ({
                            ...t,
                            [s.key]: Math.min(30, (t[s.key] ?? picks.length) + 1),
                          }))
                        }
                        disabled={loading || busy}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <Link
              href="/algorithm?tab=tracks"
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
            >
              Change unit order <ArrowRight className="w-3 h-3" />
            </Link>
          </section>
        </div>
      )}

      {/* Footer */}
      <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-3 border-t border-border pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
        <div className="text-[11px] text-muted-foreground">
          Existing drafts are replaced.
        </div>
        <button
          onClick={onGenerate}
          disabled={loading || busy || isOffDay || joinedCount === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50"
        >
          <Sparkles className="w-3.5 h-3.5" />
          {busy
            ? 'Generating…'
            : `Generate for ${joinedCount} student${joinedCount === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  );
}

function Stepper({
  value,
  onDec,
  onInc,
  disabled,
}: {
  value: number;
  onDec: () => void;
  onInc: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        onClick={onDec}
        disabled={disabled || value <= 0}
        className="w-6 h-6 inline-flex items-center justify-center rounded-md bg-muted text-foreground disabled:opacity-40 hover:bg-muted/70"
        aria-label="Decrease"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>
      <span className="min-w-[1.5rem] text-center text-sm font-bold tabular-nums text-foreground">
        {value}
      </span>
      <button
        onClick={onInc}
        disabled={disabled || value >= 30}
        className="w-6 h-6 inline-flex items-center justify-center rounded-md bg-muted text-foreground disabled:opacity-40 hover:bg-muted/70"
        aria-label="Increase"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
