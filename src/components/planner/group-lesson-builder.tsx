'use client';

// GroupLessonBuilder — the planner's group-mode Lesson Builder (sessions
// redesign, 2026-07-18). Replaces GroupUnitBuilderDialog: SAME full-screen
// screen language as the session Lesson Builder — dense tile grid with
// stems, concept chips, book-order lens, Arrange, lesson sets — via the
// SHARED components in components/lesson/lesson-question-grid.tsx.
// Group-mode differences:
//   • header shows the GROUP name; the tapped unit is a chip (no dropdown)
//     plus the "+ unit" button (unit compression — same dialog as the
//     week card);
//   • TWO tabs — Main and Timeline (2026-07-19; the Revision tab is gone —
//     founder: Main should show EVERYTHING, yellow ticks inline, so a
//     separate yellow-only list said nothing new). Main: tap the tile =
//     tick/untick (untick = ban); tap the tick chip = flip green↔yellow
//     (saved as a MANUAL route the algorithm never overrides). Timeline:
//     this unit on the calendar — real Main dates + SR-predicted revision
//     days (group-unit-timeline.tsx);
//   • Save & re-plan writes bans + changed routes, then rebuilds every
//     future planned sheet.

import { useMemo, useState } from 'react';
import { useMutation } from 'convex/react';
import {
  ArrowUpDown,
  BookOpen,
  BookmarkPlus,
  Loader2,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { useCachedQuery } from '@/hooks/use-cached-query';
import {
  ConceptChip,
  QuestionTileGrid,
  type GridQuestion,
} from '@/components/lesson/lesson-question-grid';
import { CompressionDialog } from './compression-dialog';
import { GroupUnitTimeline } from './group-unit-timeline';
import { UnitArrangeDialog } from './unit-arrange-dialog';

export function GroupLessonBuilder({
  groupId,
  groupName,
  unitId,
  unitName,
  resolveUnitName,
  onClose,
}: {
  groupId: Id<'groups'>;
  groupName: string;
  unitId: string;
  unitName: string;
  resolveUnitName: (unitId: string) => string;
  onClose: () => void;
}) {
  const catalog = useCachedQuery(
    api.learningEngine.lessonSets.listUnitQuestions,
    { unitId },
  );
  const curation = useCachedQuery(
    api.learningEngine.groupPlan.groupUnitCuration,
    { groupId, unitId },
  );
  const lessonSets = useCachedQuery(api.learningEngine.lessonSets.listForUnit, {
    unitId,
  });
  const saveLessonSet = useMutation(
    api.learningEngine.lessonSets.saveLessonSet,
  );
  const setBans = useMutation(api.learningEngine.groupPlan.setGroupUnitBans);
  const setRoutes = useMutation(
    api.learningEngine.groupPlan.setQuestionRoutes,
  );
  const replanTermMut = useMutation(api.learningEngine.groupPlan.replanTerm);

  const [tab, setTab] = useState<'main' | 'timeline'>('main');
  const [conceptFilter, setConceptFilter] = useState<string | 'all'>('all');
  const [bookView, setBookView] = useState(false);
  const [arranging, setArranging] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Group state per question: taught (locked), planned, banned, route.
  const curOk = curation && 'status' in curation && curation.status === 'ok';
  const stateByQid = useMemo(() => {
    const m = new Map<
      string,
      {
        taught: boolean;
        planned: boolean;
        banned: boolean;
        route: 'main' | 'revision';
      }
    >();
    if (curOk) {
      for (const q of curation.questions)
        m.set(q.questionId as unknown as string, {
          taught: q.taught,
          planned: q.planned,
          banned: q.banned,
          route: q.route,
        });
    }
    return m;
  }, [curation, curOk]);

  // Ticks + routes — initialised from the group state at render time when it
  // first arrives (the "reset state when input changes" pattern).
  const [ticked, setTicked] = useState<Set<string>>(() => new Set());
  const [routes, setRoutesState] = useState<Map<string, 'main' | 'revision'>>(
    () => new Map(),
  );
  const [initialTicked, setInitialTicked] = useState<Set<string>>(
    () => new Set(),
  );
  const [initialRoutes, setInitialRoutes] = useState<
    Map<string, 'main' | 'revision'>
  >(() => new Map());
  const [seededFrom, setSeededFrom] = useState<unknown>(undefined);
  if (curOk && curation !== seededFrom) {
    setSeededFrom(curation);
    const tickInit = new Set<string>();
    const routeInit = new Map<string, 'main' | 'revision'>();
    for (const q of curation.questions) {
      const k = q.questionId as unknown as string;
      if (q.taught || !q.banned) tickInit.add(k);
      routeInit.set(k, q.route);
    }
    setTicked(tickInit);
    setInitialTicked(new Set(tickInit));
    setRoutesState(routeInit);
    setInitialRoutes(new Map(routeInit));
  }

  // History is locked — but never silently (founder bug report 2026-07-19:
  // "the tick is not working" was a taught question swallowing taps).
  const lockedToast = () =>
    toast.info('Already taught — history is locked and can’t be changed.');
  const toggle = (qid: string) => {
    if (stateByQid.get(qid)?.taught) {
      lockedToast();
      return;
    }
    setTicked((cur) => {
      const next = new Set(cur);
      if (next.has(qid)) next.delete(qid);
      else next.add(qid);
      return next;
    });
  };
  const flipRoute = (qid: string) => {
    if (stateByQid.get(qid)?.taught) {
      lockedToast();
      return;
    }
    setRoutesState((cur) => {
      const next = new Map(cur);
      next.set(qid, cur.get(qid) === 'revision' ? 'main' : 'revision');
      return next;
    });
  };

  const concepts = useMemo(() => catalog?.concepts ?? [], [catalog]);
  const allQs = useMemo(
    () => concepts.flatMap((c) => c.questions),
    [concepts],
  );
  const lockedQids = useMemo(() => {
    const s = new Set<string>();
    stateByQid.forEach((st, k) => {
      if (st.taught) s.add(k);
    });
    return s;
  }, [stateByQid]);

  const routeOf = (k: string): 'main' | 'revision' =>
    routes.get(k) ?? 'main';
  const greenCount = allQs.filter((q) => {
    const k = q.questionId as unknown as string;
    return ticked.has(k) && routeOf(k) === 'main';
  }).length;
  const yellowCount = allQs.filter((q) => {
    const k = q.questionId as unknown as string;
    return ticked.has(k) && routeOf(k) === 'revision';
  }).length;

  const dirty = useMemo(() => {
    if (ticked.size !== initialTicked.size) return true;
    for (const k of ticked) if (!initialTicked.has(k)) return true;
    for (const [k, r] of routes) if (initialRoutes.get(k) !== r) return true;
    return false;
  }, [ticked, initialTicked, routes, initialRoutes]);

  const saveAsLesson = async () => {
    const name = window.prompt(
      'Name this lesson set (saving the ticked questions for reuse):',
    );
    if (!name?.trim()) return;
    try {
      await saveLessonSet({
        unitId,
        name: name.trim(),
        questionIds: allQs
          .filter((q) => ticked.has(q.questionId as unknown as string))
          .map((q) => q.questionId),
      });
      toast.success(`Lesson set “${name.trim()}” saved.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save lesson set');
    }
  };

  // Save & re-plan: unticked ⇒ banned; changed colors ⇒ MANUAL routes; then
  // future planned sheets are dropped and rebuilt to match immediately.
  const saveAndReplan = async () => {
    setSaving(true);
    try {
      const banned = allQs
        .filter((q) => {
          const k = q.questionId as unknown as string;
          return !ticked.has(k) && !stateByQid.get(k)?.taught;
        })
        .map((q) => q.questionId);
      await setBans({ groupId, unitId, bannedQuestionIds: banned });
      const changedRoutes = allQs
        .filter((q) => {
          const k = q.questionId as unknown as string;
          return (
            !stateByQid.get(k)?.taught &&
            routeOf(k) !== (initialRoutes.get(k) ?? 'main')
          );
        })
        .map((q) => ({
          questionId: q.questionId,
          route: routeOf(q.questionId as unknown as string),
        }));
      if (changedRoutes.length > 0)
        await setRoutes({ groupId, unitId, routes: changedRoutes });
      const res = await replanTermMut({ groupId, daysAhead: 180 });
      toast.success(
        `Saved — ${banned.length} excluded, ${yellowCount} in Revision. Re-planned ${res.deleted}→${res.written} sheets.`,
      );
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
      setSaving(false);
    }
  };

  const filtered =
    conceptFilter === 'all'
      ? concepts
      : concepts.filter(
          (c) => (c.conceptId as unknown as string) === conceptFilter,
        );

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header — GROUP name, the unit as a chip, + unit */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-border shrink-0">
        <Sparkles className="w-4 h-4 text-primary shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-foreground truncate">
            {groupName}
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="px-2 py-0.5 rounded-lg border border-primary/60 bg-primary/10 text-[10.5px] font-semibold text-foreground truncate max-w-[60vw]">
              {unitName}
            </span>
            <button
              onClick={() => setCompressing(true)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border border-dashed border-border text-[10.5px] font-semibold text-muted-foreground hover:text-foreground"
              title="Start the next unit now (compress this one)"
            >
              <Plus className="w-3 h-3" />
              unit
            </button>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Main / Timeline tabs — Main shows EVERYTHING (green + yellow
          ticks inline); Timeline lays this unit on the calendar. */}
      <div className="flex px-2 border-b border-border shrink-0">
        <button
          onClick={() => setTab('main')}
          className={cn(
            'flex-1 px-1 py-2.5 text-[11px] font-semibold border-b-2 transition-colors',
            tab === 'main'
              ? 'border-emerald-500 text-emerald-500'
              : 'border-transparent text-muted-foreground',
          )}
        >
          Main
          <span className="ml-1 tabular-nums opacity-80">{greenCount}</span>
          {yellowCount > 0 && (
            <span className="ml-1 tabular-nums text-amber-500">
              · {yellowCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('timeline')}
          className={cn(
            'flex-1 px-1 py-2.5 text-[11px] font-semibold border-b-2 transition-colors',
            tab === 'timeline'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground',
          )}
        >
          Timeline
        </button>
      </div>

      {/* Toolbar: book-order lens · arrange · lesson sets (Main tab only) */}
      <div
        className={cn(
          'px-3 py-2 border-b border-border/60 shrink-0 space-y-2',
          tab !== 'main' && 'hidden',
        )}
      >
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            onClick={() => setBookView((v) => !v)}
            className={cn(
              'shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10.5px] font-semibold',
              bookView
                ? 'border-primary/60 bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground',
            )}
          >
            <BookOpen className="w-3 h-3" />
            Book order
          </button>
          <button
            onClick={() => setArranging(true)}
            className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-border text-[10.5px] font-semibold text-muted-foreground"
          >
            <ArrowUpDown className="w-3 h-3" />
            Arrange
          </button>
          <button
            onClick={saveAsLesson}
            className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-border text-[10.5px] font-semibold text-muted-foreground"
          >
            <BookmarkPlus className="w-3 h-3" />
            Save lesson
          </button>
          {(lessonSets ?? []).map((ls) => (
            <button
              key={ls._id as unknown as string}
              onClick={() => {
                const preset = new Set(
                  (ls.questionIds as unknown as string[]).map(String),
                );
                setTicked(() => {
                  const next = new Set<string>();
                  for (const q of allQs) {
                    const k = q.questionId as unknown as string;
                    if (stateByQid.get(k)?.taught || preset.has(k)) next.add(k);
                  }
                  return next;
                });
              }}
              className="shrink-0 px-2 py-1 rounded-lg border border-border text-[10.5px] text-foreground"
              title="Apply this lesson set's ticks"
            >
              {ls.name}
            </button>
          ))}
        </div>
        {/* Concept chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <ConceptChip
            label="All"
            count={`${greenCount + yellowCount}`}
            active={conceptFilter === 'all'}
            onClick={() => setConceptFilter('all')}
          />
          {concepts.map((c) => {
            const cid = c.conceptId as unknown as string;
            const n = (c.questions as GridQuestion[]).filter((q) =>
              ticked.has(q.questionId as string),
            ).length;
            return (
              <ConceptChip
                key={cid}
                label={c.conceptName}
                count={`${n}/${c.questions.length}`}
                active={conceptFilter === cid}
                warn={c.questions.length === 0}
                onClick={() =>
                  setConceptFilter(conceptFilter === cid ? 'all' : cid)
                }
              />
            );
          })}
        </div>
        <div className="text-[9.5px] text-muted-foreground">
          each concept&rsquo;s middle drill is auto-
          <b className="text-amber-500">yellow</b> (Revision) — tap a tick to
          override <b className="text-emerald-500">green</b> ↔{' '}
          <b className="text-amber-500">yellow</b>, tap the question to
          tick/untick · <b className="text-rose-500">red</b> concept = no book
          entered yet
        </div>
      </div>

      {/* Timeline tab — this unit on the calendar */}
      {tab === 'timeline' && (
        <div className="flex-1 overflow-y-auto pb-28">
          <GroupUnitTimeline groupId={groupId} unitId={unitId} />
        </div>
      )}

      {/* Question grid */}
      <div
        className={cn(
          'flex-1 overflow-y-auto px-3 py-3 pb-28',
          tab !== 'main' && 'hidden',
        )}
      >
        {(catalog === undefined || curation === undefined) && (
          <div className="grid grid-cols-2 gap-1.5 animate-pulse">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className={cn('h-20 bg-muted rounded-lg', i === 1 && 'col-span-2')}
              />
            ))}
          </div>
        )}
        {catalog && concepts.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-8">
            No questions entered for this unit yet — enter the book first.
          </div>
        )}
        {curation !== undefined &&
          !curOk &&
          curation !== null &&
          'status' in (curation ?? {}) && (
            <div className="text-center text-[11px] text-muted-foreground py-2">
              Group plan unavailable ({(curation as { status: string }).status})
              — ticks show the whole unit.
            </div>
          )}
        {catalog &&
          curation !== undefined &&
          filtered.map((c) => {
            const qs = c.questions as GridQuestion[];
            if (qs.length === 0) return null;
            return (
              <div key={c.conceptId as unknown as string} className="mb-4">
                <div className="text-[11px] font-bold text-foreground mb-1.5 flex items-center gap-2">
                  <span className="truncate">{c.conceptName}</span>
                  <span className="h-px flex-1 bg-border" />
                </div>
                <QuestionTileGrid
                  questions={qs}
                  bookView={bookView}
                  ticked={ticked}
                  lockedQids={lockedQids}
                  routeByQid={routes}
                  onToggle={toggle}
                  onFlipRoute={flipRoute}
                />
              </div>
            );
          })}
      </div>

      {/* Save bar */}
      <div className="absolute bottom-0 inset-x-0 border-t border-border bg-card px-3 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] flex gap-2">
        <button
          onClick={onClose}
          disabled={saving}
          className="px-4 py-2.5 rounded-lg border border-border text-foreground text-sm font-semibold disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={saveAndReplan}
          disabled={saving || !dirty || !curOk}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {saving
            ? 'Saving & re-planning…'
            : dirty
              ? 'Save & re-plan future sheets'
              : 'No changes'}
        </button>
      </div>

      {arranging && (
        <UnitArrangeDialog
          unitId={unitId}
          unitName={unitName}
          onClose={() => setArranging(false)}
        />
      )}
      {compressing && (
        <CompressionDialog
          groupId={groupId}
          unitName={resolveUnitName}
          onClose={() => setCompressing(false)}
          onApplied={onClose}
        />
      )}
    </div>
  );
}
