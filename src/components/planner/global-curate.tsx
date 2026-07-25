'use client';

// GlobalCurate — the Planner's "Curate" tab (2026-07-25). The Lesson Builder
// pulled out of the per-group pop-up and made GLOBAL: one green/yellow/blue
// decision per question, shared by every group teaching the unit. Pick a
// grade (shared with the other tabs) → a unit → its questions grouped by
// concept. Everything auto-saves the moment you tap or drag — this is the
// global lesson design, so there is no draft and no Save button.
//
//   • Tap a question's tick   → cycle its color green → yellow → blue.
//       green  = conceptual, taught new in the Main session.
//       yellow = middle, handed to the Revision session.
//       blue   = hard, kept in Main but spaced to return later.
//   • Long-press a tile       → exclude it (greyed, taught nowhere) / restore.
//   • Drag the handle         → reorder inside the concept; the order IS the
//                               difficulty (easy → hard), written globally.
// No Arrange / Book-order / Save chips — the grid already IS book order, drag
// is inline, and saving is automatic.

import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { useMutation } from 'convex/react';
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
import { GripVertical, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { useCachedQuery } from '@/hooks/use-cached-query';
import { ALL_CURRICULUM_UNITS } from '@/lib/track-progress-args';
import { LessonCrop, type GridQuestion } from '@/components/lesson/lesson-question-grid';

type Role = 'green' | 'yellow' | 'blue';
const NEXT_ROLE: Record<Role, Role> = {
  green: 'yellow',
  yellow: 'blue',
  blue: 'green',
};
const ROLE_META: Record<
  Role,
  { label: string; tile: string; chip: string; where: string }
> = {
  green: {
    label: 'Easy',
    tile: 'border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500/40',
    chip: 'bg-emerald-500 border-emerald-500 text-white',
    where: 'Main · taught new',
  },
  yellow: {
    label: 'Middle',
    tile: 'border-amber-400 bg-amber-400/10 ring-1 ring-amber-400/50',
    chip: 'bg-amber-400 border-amber-400 text-amber-950',
    where: 'Revision session',
  },
  blue: {
    label: 'Hard',
    tile: 'border-sky-500 bg-sky-500/10 ring-1 ring-sky-500/40',
    chip: 'bg-sky-500 border-sky-500 text-white',
    where: 'Main · spaced later',
  },
};

// A curate question row: the shared crop shape + its global state.
type CurateQ = GridQuestion & {
  role: Role | null;
  excluded: boolean;
};

export function GlobalCurate({ grade }: { grade: number }) {
  const gradeUnits = useMemo(
    () =>
      ALL_CURRICULUM_UNITS.filter((u) => u.grade === grade).sort(
        (a, b) => a.term - b.term || a.unitId.localeCompare(b.unitId),
      ),
    [grade],
  );

  const [unitId, setUnitId] = useState<string | null>(null);
  // Reset the selected unit when the grade changes to one without it.
  const effectiveUnitId =
    unitId && gradeUnits.some((u) => u.unitId === unitId)
      ? unitId
      : (gradeUnits[0]?.unitId ?? null);

  const catalog = useCachedQuery(
    api.learningEngine.lessonSets.listUnitQuestions,
    effectiveUnitId ? { unitId: effectiveUnitId } : 'skip',
  );

  const setRole = useMutation(api.learningEngine.lessonSets.setQuestionRole);
  const setExcluded = useMutation(
    api.learningEngine.lessonSets.setQuestionExcluded,
  );
  const reorder = useMutation(
    api.learningEngine.lessonSets.reorderConceptQuestions,
  );

  const cycleColor = async (q: CurateQ) => {
    const next = NEXT_ROLE[q.role ?? 'green'];
    try {
      await setRole({ questionId: q.questionId as Id<'questionBank'>, role: next });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    }
  };

  const toggleExcluded = async (q: CurateQ) => {
    try {
      await setExcluded({
        questionId: q.questionId as Id<'questionBank'>,
        excluded: !q.excluded,
      });
      toast.success(q.excluded ? 'Question restored.' : 'Question excluded.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    }
  };

  const saveOrder = async (orderedIds: string[]) => {
    try {
      await reorder({
        orderedQuestionIds: orderedIds as Id<'questionBank'>[],
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save order');
    }
  };

  if (gradeUnits.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
        No grade-{grade} units in the curriculum.
      </div>
    );
  }

  return (
    <div>
      {/* Unit picker */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-2">
        {gradeUnits.map((u) => (
          <button
            key={u.unitId}
            onClick={() => setUnitId(u.unitId)}
            className={cn(
              'shrink-0 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold',
              u.unitId === effectiveUnitId
                ? 'border-primary/60 bg-primary/10 text-foreground'
                : 'border-border bg-card text-muted-foreground',
            )}
          >
            <span className="opacity-60 mr-1">T{u.term}</span>
            {u.unitName}
          </button>
        ))}
      </div>

      {/* Legend — what each color means, in one glance */}
      <div className="rounded-xl border border-border bg-card px-3 py-2 mb-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[10px]">
          {(['green', 'yellow', 'blue'] as Role[]).map((r) => (
            <span key={r} className="inline-flex items-center gap-1.5">
              <span
                className={cn('w-3 h-3 rounded-[4px] border', ROLE_META[r].chip)}
              />
              <b className="text-foreground">{ROLE_META[r].label}</b>
              <span className="text-muted-foreground">
                · {ROLE_META[r].where}
              </span>
            </span>
          ))}
        </div>
        <div className="mt-1.5 text-[9.5px] text-muted-foreground">
          Tap the tick to change color · long-press a card to exclude · drag the
          handle to reorder (easy → hard). Saves automatically for every group.
        </div>
      </div>

      {catalog === undefined && (
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-muted rounded-xl" />
          ))}
        </div>
      )}

      {catalog && catalog.concepts.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
          No questions entered for this unit yet.
        </div>
      )}

      {catalog &&
        catalog.concepts.map((c) => (
          <ConceptSection
            key={c.conceptId as unknown as string}
            conceptName={c.conceptName}
            questions={c.questions.map(
              (q): CurateQ => ({
                ...q,
                role: q.sessionRole,
                excluded: q.excludedFromPlan,
              }),
            )}
            onCycle={cycleColor}
            onToggleExcluded={toggleExcluded}
            onSaveOrder={saveOrder}
          />
        ))}
    </div>
  );
}

// One concept: a drag-sortable list of its questions. Reordering writes the
// global difficulty via reorderConceptQuestions (order = difficulty).
function ConceptSection({
  conceptName,
  questions,
  onCycle,
  onToggleExcluded,
  onSaveOrder,
}: {
  conceptName: string;
  questions: CurateQ[];
  onCycle: (q: CurateQ) => void;
  onToggleExcluded: (q: CurateQ) => void;
  onSaveOrder: (orderedIds: string[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  // Local optimistic order so the list doesn't jump while the mutation flies.
  const [orderOverride, setOrderOverride] = useState<string[] | null>(null);
  const byId = useMemo(() => {
    const m = new Map<string, CurateQ>();
    for (const q of questions) m.set(q.questionId as string, q);
    return m;
  }, [questions]);
  const serverOrder = useMemo(
    () => questions.map((q) => q.questionId as string),
    [questions],
  );
  // Drop the optimistic override once the server order matches it.
  const orderIds =
    orderOverride && orderOverride.every((id) => byId.has(id))
      ? orderOverride
      : serverOrder;

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = orderIds.indexOf(active.id as string);
    const to = orderIds.indexOf(over.id as string);
    if (from < 0 || to < 0) return;
    const next = arrayMove(orderIds, from, to);
    setOrderOverride(next);
    onSaveOrder(next);
  };

  const greens = questions.filter((q) => q.role === 'green' && !q.excluded).length;

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[11px] font-bold text-foreground">
          {conceptName}
        </span>
        <span className="text-[9px] text-muted-foreground tabular-nums">
          {questions.length}q
        </span>
        <span className="h-px flex-1 bg-border" />
        {greens > 0 && (
          <span className="text-[9px] text-emerald-500 font-semibold">
            {greens} taught new
          </span>
        )}
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={orderIds}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-1.5">
            {orderIds.map((id) => {
              const q = byId.get(id);
              if (!q) return null;
              return (
                <CurateRow
                  key={id}
                  id={id}
                  q={q}
                  onCycle={() => onCycle(q)}
                  onToggleExcluded={() => onToggleExcluded(q)}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

// One question card: drag handle · color tick · crop. Long-press anywhere on
// the card (not the handle/tick) excludes or restores it.
function CurateRow({
  id,
  q,
  onCycle,
  onToggleExcluded,
}: {
  id: string;
  q: CurateQ;
  onCycle: () => void;
  onToggleExcluded: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const role: Role = q.role ?? 'green';
  const meta = ROLE_META[role];

  // Long-press = exclude/restore. A 500ms hold that doesn't move (a moving
  // finger is a scroll, not a hold — cancel so we never exclude by accident).
  const press = useRef<{
    timer: ReturnType<typeof setTimeout>;
    x: number;
    y: number;
  } | null>(null);
  const startPress = (e: PointerEvent) => {
    const x = e.clientX;
    const y = e.clientY;
    const timer = setTimeout(() => {
      onToggleExcluded();
      press.current = null;
    }, 500);
    press.current = { timer, x, y };
  };
  const movePress = (e: PointerEvent) => {
    const p = press.current;
    if (!p) return;
    if (Math.abs(e.clientX - p.x) > 10 || Math.abs(e.clientY - p.y) > 10)
      cancelPress();
  };
  const cancelPress = () => {
    if (press.current) {
      clearTimeout(press.current.timer);
      press.current = null;
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onPointerDown={startPress}
      onPointerMove={movePress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerCancel={cancelPress}
      className={cn(
        'flex items-center gap-2 rounded-lg border p-1.5',
        q.excluded
          ? 'border-dashed border-border/60 bg-muted/20 opacity-50'
          : isDragging
            ? 'relative z-10 border-primary ring-2 ring-primary/50 shadow-lg bg-card'
            : cn('bg-card', meta.tile),
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        onPointerDown={(e) => e.stopPropagation()}
        className="shrink-0 p-1.5 -m-1 text-muted-foreground touch-none cursor-grab active:cursor-grabbing"
        aria-label="Drag to reorder"
      >
        <GripVertical className="w-4 h-4" />
      </button>

      {/* Color tick — tap cycles green → yellow → blue. When excluded it
          becomes a restore button instead. */}
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={q.excluded ? onToggleExcluded : onCycle}
        aria-label={
          q.excluded
            ? 'Restore question'
            : `${meta.label} — ${meta.where}. Tap to change color`
        }
        title={q.excluded ? 'Excluded — tap to restore' : `${meta.label} · ${meta.where}`}
        className="shrink-0 flex items-center justify-center p-2 -m-1 active:scale-90 transition-transform"
      >
        {q.excluded ? (
          <span className="w-6 h-6 rounded-[6px] border border-dashed border-muted-foreground/50 bg-background flex items-center justify-center text-muted-foreground">
            <RotateCcw className="w-3.5 h-3.5" />
          </span>
        ) : (
          <span
            className={cn(
              'w-6 h-6 rounded-[6px] border flex flex-col items-center justify-center leading-none',
              meta.chip,
            )}
          >
            <span className="text-[7px] font-bold uppercase">
              {meta.label.slice(0, 4)}
            </span>
          </span>
        )}
      </button>

      <span className="w-9 shrink-0 text-[10px] font-semibold text-foreground truncate">
        {q.label ?? 'Q'}
      </span>

      <div className="flex-1 min-w-0">
        <LessonCrop crop={q} maxH={48} zoomOn="tap" />
      </div>
    </div>
  );
}
