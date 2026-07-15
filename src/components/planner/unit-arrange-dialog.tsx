'use client';

// UnitArrangeDialog — Part 2 of the Term Planning Cockpit (2026-07-16).
// Reached from a unit in the Coverage grid: "Arrange order". This is the
// Lesson Builder's difficulty-ordering power, brought into the Planner in a
// curate-the-unit mode (no student, no sheet). The teacher drags each
// concept's questions into easy→hard teaching order; saving rewrites the
// unit's difficulty (1..5 across the list) + pickerOrder — the SAME fields the
// coverage ladder walks. So the whole-term prebuild then follows this order.
//
// "How does the algorithm pick?" — top-to-bottom IS the pick order. The engine
// teaches a unit's questions in exactly the sequence shown here.
//
// Backend: listUnitQuestions (catalog) + reorderConceptQuestions (per concept).

import { useEffect, useMemo, useState } from 'react';
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
import { ArrowUpDown, GripVertical, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { useCachedQuery } from '@/hooks/use-cached-query';
import { CropThumbnail } from '@/components/algorithm/sheet-preview';

type CatalogQ = {
  questionId: Id<'questionBank'>;
  label: string | null;
  difficulty: number | null;
  cropBox: { x: number; y: number; w: number; h: number } | null;
  pageImageUrl: string | null;
  pageImageUrlSmall: string | null;
  overrideImageUrl: string | null;
};

// Mirror of the backend bucket formula in reorderConceptQuestions — the dN
// badge previews the difficulty a row's position will save.
function difficultyForPosition(i: number, n: number): number {
  return Math.min(5, Math.floor((i * 5) / n) + 1);
}

export function UnitArrangeDialog({
  unitId,
  unitName,
  onClose,
}: {
  unitId: string;
  unitName: string;
  onClose: () => void;
}) {
  const catalog = useCachedQuery(api.learningEngine.lessonSets.listUnitQuestions, {
    unitId,
  });
  const reorder = useMutation(
    api.learningEngine.lessonSets.reorderConceptQuestions,
  );

  // Per-concept working order (question-id arrays). Initialised from the
  // catalog and mutated by drags until the teacher saves.
  const [order, setOrder] = useState<Record<string, string[]>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!catalog) return;
    const init: Record<string, string[]> = {};
    for (const c of catalog.concepts) {
      init[c.conceptId as unknown as string] = c.questions.map(
        (q) => q.questionId as unknown as string,
      );
    }
    setOrder(init);
    setDirty(new Set());
  }, [catalog]);

  const qById = useMemo(() => {
    const m = new Map<string, CatalogQ>();
    if (catalog) {
      for (const c of catalog.concepts) {
        for (const q of c.questions) m.set(q.questionId as unknown as string, q);
      }
    }
    return m;
  }, [catalog]);

  const onReorderConcept = (conceptId: string, next: string[]) => {
    setOrder((cur) => ({ ...cur, [conceptId]: next }));
    setDirty((cur) => new Set(cur).add(conceptId));
  };

  const save = async () => {
    if (dirty.size === 0) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      for (const conceptId of dirty) {
        const ids = order[conceptId] ?? [];
        await reorder({
          orderedQuestionIds: ids as unknown as Id<'questionBank'>[],
        });
      }
      toast.success('Order saved — the term will build in this sequence.');
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save order');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-border shrink-0">
        <ArrowUpDown className="w-4 h-4 text-primary shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-foreground truncate">
            Arrange · {unitName}
          </div>
          <div className="text-[10px] text-muted-foreground">
            Drag easy → hard. Top is taught first.
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

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-3 py-3 pb-24">
        {catalog === undefined && (
          <div className="space-y-2 animate-pulse">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-12 bg-muted rounded-lg" />
            ))}
          </div>
        )}
        {catalog === null && (
          <div className="text-center text-sm text-muted-foreground py-8">
            Sign in to arrange questions.
          </div>
        )}
        {catalog && catalog.concepts.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-8">
            No questions entered for this unit yet.
          </div>
        )}
        {catalog &&
          catalog.concepts.map((c) => {
            const cid = c.conceptId as unknown as string;
            const ids = order[cid] ?? [];
            if (ids.length === 0) return null;
            return (
              <div key={cid} className="mb-4">
                <div className="text-[11px] font-bold text-foreground mb-1.5 flex items-center gap-2">
                  <span className="truncate">{c.conceptName}</span>
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-[9px] text-muted-foreground shrink-0">
                    {ids.length} questions
                  </span>
                </div>
                <ArrangeList
                  ids={ids}
                  qById={qById}
                  onReorder={(next) => onReorderConcept(cid, next)}
                />
              </div>
            );
          })}
      </div>

      {/* Save bar */}
      <div className="absolute bottom-0 inset-x-0 border-t border-border bg-card px-3 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] flex gap-2">
        <button
          onClick={onClose}
          className="px-4 py-2.5 rounded-lg border border-border text-foreground text-sm font-semibold"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {dirty.size === 0
            ? 'Done'
            : `Save order (${dirty.size} concept${dirty.size > 1 ? 's' : ''})`}
        </button>
      </div>
    </div>
  );
}

function ArrangeList({
  ids,
  qById,
  onReorder,
}: {
  ids: string[];
  qById: Map<string, CatalogQ>;
  onReorder: (next: string[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(active.id as string);
    const to = ids.indexOf(over.id as string);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="space-y-1.5">
          {ids.map((id, i) => {
            const q = qById.get(id);
            if (!q) return null;
            return (
              <ArrangeRow key={id} id={id} q={q} index={i} count={ids.length} />
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
  q: CatalogQ;
  index: number;
  count: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
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
      <span className="w-6 shrink-0 text-[9px] tabular-nums text-muted-foreground">
        d{difficultyForPosition(index, count)}
      </span>
      {q.overrideImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={q.overrideImageUrl}
          alt={q.label ?? 'Question'}
          className="max-h-10 rounded border border-border/40"
        />
      ) : (
        <CropThumbnail
          imageUrl={q.pageImageUrl}
          imageUrlSmall={q.pageImageUrlSmall}
          cropBox={q.cropBox}
          maxSide={64}
        />
      )}
    </div>
  );
}
