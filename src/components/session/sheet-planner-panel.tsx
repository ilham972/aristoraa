'use client';

// Lesson Builder — the full-screen generate dialog (2026-07-11).
// v2 layout (founder feedback, same day): SECTION TABS at the top (Main /
// Warm-up / Revision / Exam prep — each tab is a future improvement surface),
// a +/- stepper on Main too (+ ticks the next best unticked question, easy
// first; − unticks the last — instant, manual ticks preserved), CONCEPT
// FILTER CHIPS under the unit name (no more mile-long scroll).
//
// v4 question list (founder feedback 2026-07-13): DENSE 2-COLUMN GRID.
// Every crop renders at TRUE aspect ratio (text never shrinks below page
// scale); crops narrower than half the page pack two per row, wide/text
// crops span the full width. No per-question header bar — a slim strip
// (tick, label, difficulty, algo) sits above each crop. STEM crops render
// as shared context rows above their sub-parts (once per run of siblings,
// same source of truth as the PDF renderer). Tap a tile to tick; the
// magnifier zooms.
//
// Core rules (unchanged from v1, founder-locked):
//   • JOIN students → same ticked Main block; warm-up/revision/exam-prep
//     stay PERSONAL per student.
//   • Algorithm's Main picks arrive pre-ticked; teacher overrides freely.
//   • Named lesson sets per unit ("Fractions — Layer 1") as one-tap presets.
//   • Generation = one saveSheetForStudent per joined student with
//     mainQuestionIdsOverride = ticks in display order.

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation } from 'convex/react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowRight,
  ArrowUpDown,
  BookmarkPlus,
  BookOpen,
  Check,
  ChevronDown,
  GripVertical,
  Minus,
  Plus,
  Sparkles,
  X,
  ZoomIn,
} from 'lucide-react';
import { sortByBookOrder } from '@/lib/book-order';
import { api, type Id } from '@/lib/convex';
import { findUnit } from '@/lib/curriculum-data';
import { describeError } from '@/lib/sheets/scope';
import { FullCropDialog } from '@/components/algorithm/sheet-preview';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type PersonalKey = 'warmup' | 'revision' | 'examPrep';
type TabKey = 'main' | PersonalKey;

const PERSONAL_TABS: Array<{ key: PersonalKey; label: string; hint: string }> =
  [
    {
      key: 'warmup',
      label: 'Warm-up',
      hint: 'each student’s recent mistakes, easiest first',
    },
    {
      key: 'revision',
      label: 'Revision',
      hint: 'each student’s forgetting curve — due concepts across all units',
    },
    {
      key: 'examPrep',
      label: 'Exam prep',
      hint: 'past-paper questions on each student’s mastered concepts',
    },
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
  const [tab, setTab] = useState<TabKey>('main');

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

  // ── Personal-section targets (steppers on their tabs) ───────────────
  const [targets, setTargets] = useState<Partial<Record<PersonalKey, number>>>(
    {},
  );
  const [busy, setBusy] = useState(false);

  // ── The taught unit + tick state ────────────────────────────────────
  const [unitId, setUnitId] = useState<string | null>(null);
  const [conceptFilter, setConceptFilter] = useState<string | 'all'>('all');
  const [ticked, setTicked] = useState<Set<string>>(() => new Set());
  const seededForUnit = useRef<string | null>(null);
  // View modes (2026-07-13): bookView = textbook-order LENS (view only —
  // print/tick order stays canonical easy-first; the founder uses it to
  // inspect how the algorithm picked). arranging = drag-reorder mode where
  // order IS difficulty (persists pickerOrder + rewrites difficulty 1-5).
  const [bookView, setBookView] = useState(false);
  const [arranging, setArranging] = useState(false);
  const [arrangeOrder, setArrangeOrder] = useState<Record<string, string[]>>(
    {},
  );

  const tickedArr = useMemo(() => Array.from(ticked), [ticked]);
  const cleanedTargets = useMemo(() => {
    const out: Record<string, number> = {};
    for (const t of PERSONAL_TABS) {
      const v = targets[t.key];
      if (typeof v === 'number') out[t.key] = v;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }, [targets]);

  // Live read-only preview for the PRIMARY student. Includes the override so
  // the personal sections plan AROUND the ticked questions.
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

  const catalog = useQuery(
    api.learningEngine.lessonSets.listUnitQuestions,
    unitId ? { unitId } : 'skip',
  );
  const lessonSets = useQuery(
    api.learningEngine.lessonSets.listForUnit,
    unitId ? { unitId } : 'skip',
  );
  const saveLesson = useMutation(api.learningEngine.lessonSets.saveLessonSet);
  const deleteLesson = useMutation(
    api.learningEngine.lessonSets.deleteLessonSet,
  );
  const saveSheet = useMutation(api.learningEngine.planner.saveSheetForStudent);
  const reorderQuestions = useMutation(
    api.learningEngine.lessonSets.reorderConceptQuestions,
  );

  // Seed ticks ONCE per unit: frontier unit → the algorithm's own Main
  // picks; another unit the teacher navigates to → start empty.
  useEffect(() => {
    if (!unitId || seededForUnit.current === unitId) return;
    if (unitId === frontierUnitId) {
      if (!plan) return; // wait for picks
      seededForUnit.current = unitId;
      setTicked(
        new Set(
          (plan.main ?? []).map((p) => p.question._id as unknown as string),
        ),
      );
    } else {
      seededForUnit.current = unitId;
      setTicked(new Set());
    }
    setConceptFilter('all');
    setBookView(false);
    setArranging(false);
    setArrangeOrder({});
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

  // Catalog question ids in DISPLAY order (concept order → easy-first),
  // optionally restricted to the active concept filter.
  const displayOrder = useMemo(() => {
    if (!catalog) return [] as string[];
    const out: string[] = [];
    for (const c of catalog.concepts) {
      for (const q of c.questions) out.push(q.questionId as unknown as string);
    }
    return out;
  }, [catalog]);

  // Ticks in display order = print order (unknown ids kept at the end).
  const orderedTicks = useMemo(() => {
    const inCatalog = displayOrder.filter((k) => ticked.has(k));
    for (const k of tickedArr) if (!inCatalog.includes(k)) inCatalog.push(k);
    return inCatalog;
  }, [displayOrder, ticked, tickedArr]);

  // Main stepper: + ticks the next unticked question (preferring the concept
  // being viewed, then the rest, easy-first); − unticks the last ticked.
  // Instant + never clobbers manual ticks.
  const bumpMain = (delta: 1 | -1) => {
    if (!catalog) return;
    if (delta === -1) {
      const last = [...displayOrder].reverse().find((k) => ticked.has(k));
      if (last) toggleTick(last);
      return;
    }
    const preferred =
      conceptFilter === 'all'
        ? displayOrder
        : [
            ...(catalog.concepts
              .find((c) => (c.conceptId as unknown as string) === conceptFilter)
              ?.questions.map((q) => q.questionId as unknown as string) ?? []),
            ...displayOrder,
          ];
    const next = preferred.find((k) => !ticked.has(k));
    if (next) toggleTick(next);
    else toast.info('Every question of this unit is already ticked');
  };

  const tickedTimeMin = useMemo(() => {
    if (!catalog) return null;
    let t = 0;
    for (const c of catalog.concepts) {
      for (const q of c.questions) {
        if (ticked.has(q.questionId as unknown as string))
          t += q.expectedTimeMin ?? 4;
      }
    }
    return t;
  }, [catalog, ticked]);

  const unitName = unitId ? (findUnit(unitId)?.unit.name ?? unitId) : null;
  const isOffDay = plan?.status === 'off-day';
  const loading = plan === undefined;

  const personalCount = (k: PersonalKey): number =>
    targets[k] ??
    (k === 'warmup'
      ? (plan?.warmup?.length ?? 0)
      : k === 'revision'
        ? (plan?.revision?.length ?? 0)
        : (plan?.examPrep?.length ?? 0));

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
      toast.success(
        res.updated ? `"${name.trim()}" updated` : `"${name.trim()}" saved`,
      );
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
        else if (res.status === 'off-day')
          errs.push(`${r.studentName}: off day`);
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

  const activeConcept =
    catalog && conceptFilter !== 'all'
      ? (catalog.concepts.find(
          (c) => (c.conceptId as unknown as string) === conceptFilter,
        ) ?? null)
      : null;
  const visibleConcepts = catalog
    ? activeConcept
      ? [activeConcept]
      : catalog.concepts
    : [];

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 pt-3 pb-2 border-b border-border">
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

      {/* Students row (global) */}
      <div className="shrink-0 flex gap-1.5 px-4 py-2 overflow-x-auto border-b border-border/60">
        {roster.map((r) => {
          const k = r.studentId as unknown as string;
          const on = joined.has(k);
          return (
            <button
              key={k}
              disabled={r.locked}
              onClick={() => toggleJoin(r.studentId)}
              className={cn(
                'shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors',
                on
                  ? 'bg-primary/15 border-primary/50 text-primary'
                  : 'bg-muted/40 border-border text-muted-foreground',
                r.locked && 'opacity-40',
              )}
              title={
                r.locked ? 'Sheet already printed — delete it first' : undefined
              }
            >
              {on && <Check className="w-3 h-3" />}
              {r.studentName.split(' ')[0]}
            </button>
          );
        })}
      </div>

      {/* Section tabs */}
      <div className="shrink-0 flex px-2 border-b border-border">
        {[
          { key: 'main' as TabKey, label: 'Main', count: orderedTicks.length },
          ...PERSONAL_TABS.map((t) => ({
            key: t.key as TabKey,
            label: t.label,
            count: personalCount(t.key),
          })),
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'flex-1 px-1 py-2.5 text-[11px] font-semibold border-b-2 transition-colors',
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground',
            )}
          >
            {t.label}
            <span className="ml-1 tabular-nums opacity-80">{t.count}</span>
          </button>
        ))}
      </div>

      {isOffDay ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          {studentName} rests today — no sheet will be written.
        </div>
      ) : tab === 'main' ? (
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3 pb-6">
          {/* Unit selector + Main stepper on one compact row */}
          <div className="flex items-center gap-2">
            {track && track.orderedUnitIds.length > 0 ? (
              <div className="relative flex-1 min-w-0">
                <select
                  value={unitId ?? ''}
                  onChange={(e) => setUnitId(e.target.value || null)}
                  className="w-full appearance-none rounded-xl border border-border bg-card px-3 py-2 text-[12px] text-foreground pr-8"
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
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              </div>
            ) : (
              <div className="flex-1 min-w-0 text-[12px] font-semibold text-foreground truncate">
                {unitName ?? '…'}
              </div>
            )}
            <Stepper
              value={orderedTicks.length}
              onDec={() => bumpMain(-1)}
              onInc={() => bumpMain(1)}
              disabled={!catalog || busy}
            />
          </div>
          <div className="text-[10px] text-muted-foreground -mt-2">
            {tickedTimeMin !== null && `~${tickedTimeMin} min of work · `}tap a
            question to tick · + adds the next best, − removes the last
          </div>

          {/* Saved lessons */}
          {unitId && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {(lessonSets ?? []).map((ls) => (
                <span
                  key={ls._id as unknown as string}
                  className="inline-flex items-center rounded-lg border border-border bg-muted/40 overflow-hidden"
                >
                  <button
                    onClick={() =>
                      setTicked(
                        new Set(
                          ls.questionIds.map((q) => q as unknown as string),
                        ),
                      )
                    }
                    className="px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted/70"
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
                    className="px-1 py-1 text-muted-foreground hover:text-red-400"
                    aria-label={`Delete ${ls.name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <button
                onClick={onSaveLesson}
                disabled={orderedTicks.length === 0}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-primary disabled:opacity-40"
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                Save as lesson
              </button>
            </div>
          )}

          {/* View pills: book-order lens + drag-arrange mode */}
          {catalog && catalog.concepts.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                onClick={() => {
                  setBookView((v) => !v);
                  setArranging(false);
                }}
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-medium transition-colors',
                  bookView
                    ? 'bg-primary/15 border-primary/50 text-primary'
                    : 'bg-muted/30 border-border/70 text-muted-foreground',
                )}
              >
                <BookOpen className="w-3 h-3" />
                Book order
              </button>
              <button
                onClick={() => {
                  setArranging((a) => !a);
                  setBookView(false);
                  setArrangeOrder({});
                }}
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-medium transition-colors',
                  arranging
                    ? 'bg-primary/15 border-primary/50 text-primary'
                    : 'bg-muted/30 border-border/70 text-muted-foreground',
                )}
              >
                <ArrowUpDown className="w-3 h-3" />
                {arranging ? 'Done arranging' : 'Arrange'}
              </button>
              {bookView && (
                <span className="text-[9px] text-muted-foreground">
                  view only — sheets still print easy → hard
                </span>
              )}
              {arranging && (
                <span className="text-[9px] text-muted-foreground">
                  drag easy → hard · saves difficulty
                </span>
              )}
            </div>
          )}

          {/* Concept filter chips — small, space-efficient */}
          {catalog && catalog.concepts.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <ConceptChip
                label="all"
                count={`${orderedTicks.length}`}
                active={conceptFilter === 'all'}
                onClick={() => setConceptFilter('all')}
              />
              {catalog.concepts.map((c, i) => {
                const k = c.conceptId as unknown as string;
                const nTicked = c.questions.filter((q) =>
                  ticked.has(q.questionId as unknown as string),
                ).length;
                return (
                  <ConceptChip
                    key={k}
                    label={`${i + 1}. ${c.conceptName}`}
                    count={`${nTicked}/${c.questions.length}`}
                    active={conceptFilter === k}
                    warn={c.questions.length === 0}
                    onClick={() =>
                      setConceptFilter(conceptFilter === k ? 'all' : k)
                    }
                  />
                );
              })}
            </div>
          )}

          {/* Question list — dense 2-col grid, true-aspect crops, stem rows */}
          {!unitId || catalog === undefined ? (
            <div className="grid grid-cols-2 gap-1.5 animate-pulse">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className={cn(
                    'h-20 bg-muted rounded-lg',
                    i === 1 && 'col-span-2',
                  )}
                />
              ))}
            </div>
          ) : catalog === null ? (
            <div className="text-[11px] text-muted-foreground">
              Not signed in.
            </div>
          ) : catalog.concepts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 p-4 text-center text-[11px] text-muted-foreground">
              No concepts found for this unit.
            </div>
          ) : (
            <div className="space-y-4">
              {visibleConcepts.map((c) => (
                <div key={c.conceptId as unknown as string}>
                  {conceptFilter === 'all' && (
                    <div className="text-[11px] font-semibold text-foreground/90 mb-1.5">
                      {c.conceptName}
                    </div>
                  )}
                  {c.questions.length === 0 ? (
                    <div className="text-[10px] text-amber-500">
                      ⚠ no questions cropped for this concept
                    </div>
                  ) : arranging ? (
                    <ArrangeList
                      questions={c.questions}
                      orderIds={
                        arrangeOrder[c.conceptId as unknown as string] ??
                        c.questions.map(
                          (q) => q.questionId as unknown as string,
                        )
                      }
                      onReorder={(next) => {
                        setArrangeOrder((s) => ({
                          ...s,
                          [c.conceptId as unknown as string]: next,
                        }));
                        reorderQuestions({
                          orderedQuestionIds:
                            next as unknown as Id<'questionBank'>[],
                        }).catch((e) => toast.error(describeError(e)));
                      }}
                    />
                  ) : (
                    <div className="grid grid-cols-2 gap-1.5">
                      {(bookView
                        ? sortByBookOrder(c.questions)
                        : c.questions
                      ).map((q, qi, qs) => {
                        const k = q.questionId as unknown as string;
                        const on = ticked.has(k);
                        const byAlgo = algoPicks.has(k);
                        const stems = q.stems ?? [];
                        const stemKey =
                          stems.length > 0
                            ? stems
                                .map((s) => s.stemId as unknown as string)
                                .join('|')
                            : null;
                        const prevStems =
                          qi > 0 ? (qs[qi - 1].stems ?? []) : [];
                        const prevStemKey =
                          prevStems.length > 0
                            ? prevStems
                                .map((s) => s.stemId as unknown as string)
                                .join('|')
                            : null;
                        // Compact = the crop is narrow on the page, so two fit
                        // side by side at the SAME page scale as a full-width
                        // crop — text stays equally readable in both tracks.
                        const wide =
                          !!q.overrideImageUrl ||
                          !q.cropBox ||
                          q.cropBox.w > 0.5;
                        return (
                          <Fragment key={k}>
                            {/* Stem row — shown once per run of siblings */}
                            {stemKey && stemKey !== prevStemKey && (
                              <div className="col-span-2 rounded-lg border border-border/50 bg-muted/30 px-1.5 py-1">
                                <div className="text-[8px] font-bold uppercase tracking-wide text-muted-foreground mb-0.5">
                                  stem · Q{(q.label ?? '').split('.')[0]}
                                </div>
                                <div className="space-y-1">
                                  {stems.map((s) => (
                                    <LessonCrop
                                      key={s.stemId as unknown as string}
                                      crop={s}
                                      maxH={220}
                                      zoomOn="tap"
                                    />
                                  ))}
                                </div>
                              </div>
                            )}
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={() => toggleTick(k)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  toggleTick(k);
                                }
                              }}
                              className={cn(
                                'relative rounded-lg border p-1 cursor-pointer transition-colors',
                                on
                                  ? 'border-primary bg-primary/10 ring-1 ring-primary/50'
                                  : 'border-border/60 bg-card',
                                wide && 'col-span-2',
                              )}
                            >
                              {/* Slim strip: tick + label + tags */}
                              <div className="flex items-center gap-1 px-0.5 pb-1">
                                <span
                                  className={cn(
                                    'w-3.5 h-3.5 shrink-0 rounded-[4px] border flex items-center justify-center transition-colors',
                                    on
                                      ? 'bg-primary border-primary text-primary-foreground'
                                      : 'border-muted-foreground/40 bg-background',
                                  )}
                                >
                                  {on && (
                                    <Check
                                      className="w-2.5 h-2.5"
                                      strokeWidth={3.5}
                                    />
                                  )}
                                </span>
                                <span className="text-[9px] font-semibold text-foreground truncate">
                                  {q.label ?? 'Q'}
                                </span>
                                {q.difficulty !== null && (
                                  <span className="text-[9px] text-muted-foreground shrink-0">
                                    d{q.difficulty}
                                  </span>
                                )}
                                {byAlgo && (
                                  <Sparkles className="w-2.5 h-2.5 text-primary shrink-0" />
                                )}
                              </div>
                              <LessonCrop
                                crop={q}
                                maxH={wide ? 240 : 200}
                                zoomOn="button"
                              />
                            </div>
                          </Fragment>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        // ── Personal-section tabs ──
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
          {(() => {
            const meta = PERSONAL_TABS.find((t) => t.key === tab)!;
            const picks =
              tab === 'warmup'
                ? (plan?.warmup ?? [])
                : tab === 'revision'
                  ? (plan?.revision ?? [])
                  : (plan?.examPrep ?? []);
            const unitsPulled = Array.from(
              new Set(picks.map((p) => p.concept.unitId)),
            ).map((u) => findUnit(u)?.unit.name ?? u);
            return (
              <>
                <div className="rounded-xl border border-border bg-card px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-foreground">
                        {meta.label} · personal per student
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {meta.hint}
                      </div>
                    </div>
                    <Stepper
                      value={personalCount(tab as PersonalKey)}
                      onDec={() =>
                        setTargets((t) => ({
                          ...t,
                          [tab]: Math.max(
                            0,
                            personalCount(tab as PersonalKey) - 1,
                          ),
                        }))
                      }
                      onInc={() =>
                        setTargets((t) => ({
                          ...t,
                          [tab]: Math.min(
                            30,
                            personalCount(tab as PersonalKey) + 1,
                          ),
                        }))
                      }
                      disabled={loading || busy}
                    />
                  </div>
                </div>
                <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">
                    Preview for {studentName.split(' ')[0]}
                  </div>
                  {loading ? (
                    <div className="text-[11px] text-muted-foreground">
                      loading…
                    </div>
                  ) : picks.length === 0 ? (
                    <div className="text-[11px] text-muted-foreground italic">
                      nothing to pull yet
                    </div>
                  ) : (
                    <div className="text-[11px] text-muted-foreground">
                      {picks.length} question{picks.length === 1 ? '' : 's'}{' '}
                      from {unitsPulled.slice(0, 4).join(' · ')}
                      {unitsPulled.length > 4 &&
                        ` +${unitsPulled.length - 4} more`}
                    </div>
                  )}
                  <div className="mt-1 text-[10px] text-muted-foreground/80">
                    Joined students each get their own version of this section.
                  </div>
                </div>
                {tab === 'revision' && (
                  <Link
                    href="/algorithm?tab=tracks"
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                  >
                    Change unit order <ArrowRight className="w-3 h-3" />
                  </Link>
                )}
              </>
            );
          })()}
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

function ConceptChip({
  label,
  count,
  active,
  warn,
  onClick,
}: {
  label: string;
  count: string;
  active: boolean;
  warn?: boolean;
  onClick: () => void;
}) {
  // Full name always readable: the chip WRAPS its text instead of truncating
  // (founder feedback — concept titles are long).
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-start gap-1 px-2 py-1 rounded-lg border text-[10px] leading-tight text-left transition-colors',
        active
          ? 'bg-primary/15 border-primary/50 text-primary font-semibold'
          : 'bg-muted/30 border-border/70 text-muted-foreground',
        warn && !active && 'border-amber-500/50 text-amber-500',
      )}
    >
      <span className="whitespace-normal break-words">{label}</span>
      <span className="shrink-0 tabular-nums opacity-80">{count}</span>
    </button>
  );
}

// One crop drawn at TRUE aspect ratio, width-driven (v4): it fills its
// container's width — up to the width its maxH cap allows — so text always
// renders at page scale instead of being letterboxed in a square. The
// background math is percentage-based, so the box is fully responsive with
// no container measuring. A4 scans ⇒ aspect fallback 0.71 until the page
// image reports its real dimensions.
const PAGE_ASPECT_FALLBACK = 0.71;

type LessonCropRef = {
  cropBox: { x: number; y: number; w: number; h: number } | null;
  pageImageUrl: string | null;
  pageImageUrlSmall?: string | null;
  overrideImageUrl?: string | null;
};

function LessonCrop({
  crop,
  maxH,
  zoomOn,
}: {
  crop: LessonCropRef;
  maxH: number;
  // 'tap' → the whole crop opens the zoom (stem rows, nothing competes);
  // 'button' → a small magnifier overlay (tiles, where tap means tick).
  zoomOn: 'tap' | 'button';
}) {
  const thumbUrl = crop.pageImageUrlSmall || crop.pageImageUrl;
  const isOverride = !!crop.overrideImageUrl;
  const [dims, setDims] = useState<{
    url: string;
    w: number;
    h: number;
  } | null>(null);
  const [zoomOpen, setZoomOpen] = useState(false);

  useEffect(() => {
    if (!thumbUrl || isOverride) return;
    let cancelled = false;
    const img = new window.Image();
    img.onload = () => {
      if (cancelled) return;
      setDims({ url: thumbUrl, w: img.naturalWidth, h: img.naturalHeight });
    };
    img.src = thumbUrl;
    return () => {
      cancelled = true;
    };
  }, [thumbUrl, isOverride]);

  if (crop.overrideImageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={crop.overrideImageUrl}
        alt="Question"
        className="max-w-full h-auto rounded bg-white mx-auto"
        style={{ maxHeight: maxH }}
      />
    );
  }
  if (!crop.cropBox || !thumbUrl || !crop.pageImageUrl) {
    return (
      <div className="px-1 py-2 text-[10px] text-muted-foreground italic">
        no crop image
      </div>
    );
  }

  const safeW = Math.max(crop.cropBox.w, 0.001);
  const safeH = Math.max(crop.cropBox.h, 0.001);
  const natural =
    dims && dims.url === thumbUrl ? { w: dims.w, h: dims.h } : null;
  const imgAspect = natural ? natural.w / natural.h : PAGE_ASPECT_FALLBACK;
  const cropAspect = Math.max(0.05, (imgAspect * safeW) / safeH);
  // background-position percentage p aligns p% of the image with p% of the
  // box: solving for "left edge of the crop at the left edge of the box"
  // gives p = x / (1 - w). Degenerate full-width/height crops need no pan.
  const posX = safeW >= 0.999 ? 0 : (crop.cropBox.x / (1 - safeW)) * 100;
  const posY = safeH >= 0.999 ? 0 : (crop.cropBox.y / (1 - safeH)) * 100;
  const box = (
    <div
      className="rounded bg-white mx-auto"
      style={{
        width: `min(100%, ${Math.round(maxH * cropAspect)}px)`,
        aspectRatio: `${cropAspect}`,
        backgroundImage: `url(${thumbUrl})`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: `${100 / safeW}% ${100 / safeH}%`,
        backgroundPosition: `${posX}% ${posY}%`,
      }}
    />
  );

  return (
    <>
      {zoomOn === 'tap' ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setZoomOpen(true);
          }}
          className="block w-full cursor-zoom-in"
          aria-label="Zoom question"
        >
          {box}
        </button>
      ) : (
        <div className="relative">
          {box}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setZoomOpen(true);
            }}
            className="absolute bottom-1 right-1 w-6 h-6 rounded-md bg-black/50 text-white flex items-center justify-center hover:bg-black/70"
            aria-label="Zoom question"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {zoomOpen && (
        <FullCropDialog
          imageUrl={crop.pageImageUrl}
          cropBox={crop.cropBox}
          naturalDims={natural}
          onClose={() => setZoomOpen(false)}
        />
      )}
    </>
  );
}

// Book-order lens sort now lives in src/lib/book-order.ts (shared with the
// planner's per-week question grids).

// ── Arrange mode: drag order = difficulty ───────────────────────────────
// Mirror of the backend bucket formula in reorderConceptQuestions — the dN
// badge on each row previews the difficulty its position will save.
function difficultyForPosition(i: number, n: number): number {
  return Math.min(5, Math.floor((i * 5) / n) + 1);
}

type ArrangeQ = LessonCropRef & {
  questionId: unknown;
  label: string | null;
};

function ArrangeList({
  questions,
  orderIds,
  onReorder,
}: {
  questions: ArrangeQ[];
  orderIds: string[];
  onReorder: (next: string[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const byId = useMemo(() => {
    const m = new Map<string, ArrangeQ>();
    for (const q of questions) m.set(q.questionId as string, q);
    return m;
  }, [questions]);
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = orderIds.indexOf(active.id as string);
    const to = orderIds.indexOf(over.id as string);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(orderIds, from, to));
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={orderIds} strategy={verticalListSortingStrategy}>
        <div className="space-y-1.5">
          {orderIds.map((id, i) => {
            const q = byId.get(id);
            if (!q) return null; // question left the catalog mid-arrange
            return (
              <ArrangeRow
                key={id}
                id={id}
                q={q}
                index={i}
                count={orderIds.length}
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function ArrangeRow({
  id,
  q,
  index,
  count,
}: {
  id: string;
  q: ArrangeQ;
  index: number;
  count: number;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5',
        isDragging
          ? 'relative z-10 border-primary ring-2 ring-primary/50 shadow-lg'
          : 'border-border/60',
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="shrink-0 p-1.5 -m-1 text-muted-foreground touch-none cursor-grab active:cursor-grabbing"
        aria-label="Drag to reorder"
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <span className="w-9 shrink-0 text-[10px] font-semibold text-foreground truncate">
        {q.label ?? 'Q'}
      </span>
      <span className="w-5 shrink-0 text-[9px] tabular-nums text-muted-foreground">
        d{difficultyForPosition(index, count)}
      </span>
      <div className="flex-1 min-w-0">
        <LessonCrop crop={q} maxH={40} zoomOn="tap" />
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
        className="w-7 h-7 inline-flex items-center justify-center rounded-md bg-muted text-foreground disabled:opacity-40 hover:bg-muted/70"
        aria-label="Decrease"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>
      <span className="min-w-[1.5rem] text-center text-sm font-bold tabular-nums text-foreground">
        {value}
      </span>
      <button
        onClick={onInc}
        disabled={disabled}
        className="w-7 h-7 inline-flex items-center justify-center rounded-md bg-muted text-foreground disabled:opacity-40 hover:bg-muted/70"
        aria-label="Increase"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
