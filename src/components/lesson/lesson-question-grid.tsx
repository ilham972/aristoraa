'use client';

// Shared Lesson Builder pieces (sessions redesign, 2026-07-18): the dense
// v4 question grid, true-aspect crop renderer, concept chips and the
// Arrange drag list — ONE implementation used by BOTH builders:
//   • session Lesson Builder (sheet-planner-panel.tsx, student mode)
//   • planner group Lesson Builder (group-lesson-builder.tsx, group mode
//     with green/yellow routing)
// Pulled out of sheet-planner-panel.tsx so the two can never drift apart.
//
// Routing (group mode only — routeByQid provided): every ticked question is
// GREEN (taught in Main) or YELLOW (goes to the Revision department).
// Tap the TILE = tick/untick; tap the small tick CHIP = flip green↔yellow.
// No double-tap by design — phone browsers make it flickery.

import { Fragment, useEffect, useMemo, useState } from 'react';
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
import { Check, GripVertical, Sparkles, ZoomIn } from 'lucide-react';
import { sortByBookOrder } from '@/lib/book-order';
import { FullCropDialog } from '@/components/algorithm/sheet-preview';
import { cn } from '@/lib/utils';

// ── Crop renderer ───────────────────────────────────────────────────────
// One crop drawn at TRUE aspect ratio, width-driven (v4): it fills its
// container's width — up to the width its maxH cap allows — so text always
// renders at page scale instead of being letterboxed in a square. A4 scans
// ⇒ aspect fallback 0.71 until the page image reports its real dimensions.
const PAGE_ASPECT_FALLBACK = 0.71;

export type LessonCropRef = {
  cropBox: { x: number; y: number; w: number; h: number } | null;
  pageImageUrl: string | null;
  pageImageUrlSmall?: string | null;
  overrideImageUrl?: string | null;
};

export function LessonCrop({
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

// ── Concept filter chip ─────────────────────────────────────────────────
export function ConceptChip({
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
        // Rose, NOT amber: amber is the Revision route's color, and a
        // "no book entered" warning wearing it read as "this concept is
        // routed to revision" (founder confusion 2026-07-19).
        warn && !active && 'border-rose-500/50 text-rose-500',
      )}
    >
      <span className="whitespace-normal break-words">{label}</span>
      <span className="shrink-0 tabular-nums opacity-80">{count}</span>
    </button>
  );
}

// ── The dense 2-column tile grid (one concept's questions) ──────────────

export type GridQuestion = LessonCropRef & {
  questionId: unknown;
  label: string | null;
  difficulty: number | null;
  stems?: Array<
    LessonCropRef & {
      stemId: unknown;
    }
  >;
};

export function QuestionTileGrid({
  questions,
  bookView = false,
  ticked,
  algoPicks,
  lockedQids,
  routeByQid,
  onToggle,
  onFlipRoute,
}: {
  questions: GridQuestion[];
  bookView?: boolean;
  ticked: Set<string>;
  algoPicks?: Set<string>;
  // Taught questions — tick is locked on, route is locked too.
  lockedQids?: Set<string>;
  // Group mode: effective route per question ("main" green / "revision"
  // yellow). Absent = student mode (primary tick, no flipping).
  routeByQid?: Map<string, 'main' | 'revision'>;
  onToggle: (qid: string) => void;
  onFlipRoute?: (qid: string) => void;
}) {
  const qs = bookView ? sortByBookOrder(questions) : questions;
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {qs.map((q, qi) => {
        const k = q.questionId as string;
        const on = ticked.has(k);
        const locked = lockedQids?.has(k) ?? false;
        const route = routeByQid?.get(k) ?? null;
        const byAlgo = algoPicks?.has(k) ?? false;
        const stems = q.stems ?? [];
        const stemKey =
          stems.length > 0
            ? stems.map((s) => s.stemId as string).join('|')
            : null;
        const prevStems = qi > 0 ? (qs[qi - 1].stems ?? []) : [];
        const prevStemKey =
          prevStems.length > 0
            ? prevStems.map((s) => s.stemId as string).join('|')
            : null;
        // Compact = the crop is narrow on the page, so two fit side by side
        // at the SAME page scale as a full-width crop — text stays equally
        // readable in both tracks.
        const wide = !!q.overrideImageUrl || !q.cropBox || q.cropBox.w > 0.5;
        const flippable = !!onFlipRoute && on && !locked && route !== null;
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
                      key={s.stemId as string}
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
              onClick={() => !locked && onToggle(k)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (!locked) onToggle(k);
                }
              }}
              className={cn(
                'relative rounded-lg border p-1 transition-colors',
                locked ? 'cursor-default' : 'cursor-pointer',
                on
                  ? route === 'revision'
                    ? 'border-amber-400 bg-amber-400/10 ring-1 ring-amber-400/50'
                    : route === 'main'
                      ? 'border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500/40'
                      : 'border-primary bg-primary/10 ring-1 ring-primary/50'
                  : 'border-border/60 bg-card',
                wide && 'col-span-2',
              )}
            >
              {/* Slim strip: tick + label + tags */}
              <div className="flex items-center gap-1 px-0.5 pb-1">
                <button
                  type="button"
                  disabled={!flippable}
                  onClick={(e) => {
                    if (!flippable) return; // tile handles the tap
                    e.stopPropagation();
                    onFlipRoute?.(k);
                  }}
                  aria-label={
                    flippable
                      ? route === 'revision'
                        ? 'Move to Main (green)'
                        : 'Move to Revision (yellow)'
                      : undefined
                  }
                  title={
                    flippable
                      ? route === 'revision'
                        ? 'Yellow = revision · tap to teach in Main'
                        : 'Green = Main · tap to send to Revision'
                      : undefined
                  }
                  className={cn(
                    'shrink-0 flex items-center justify-center',
                    // Bigger invisible hit target around the small chip when
                    // the chip is the green↔yellow switch (phone thumbs).
                    flippable && 'p-1.5 -m-1.5',
                  )}
                >
                  <span
                    className={cn(
                      'w-4 h-4 rounded-[4px] border flex items-center justify-center transition-colors',
                      on
                        ? route === 'revision'
                          ? 'bg-amber-400 border-amber-400 text-amber-950'
                          : route === 'main'
                            ? 'bg-emerald-500 border-emerald-500 text-white'
                            : 'bg-primary border-primary text-primary-foreground'
                        : 'border-muted-foreground/40 bg-background',
                    )}
                  >
                    {on && <Check className="w-2.5 h-2.5" strokeWidth={3.5} />}
                  </span>
                </button>
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
              <LessonCrop crop={q} maxH={wide ? 240 : 200} zoomOn="button" />
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

// ── Arrange mode: drag order = difficulty ───────────────────────────────
// Mirror of the backend decimal formula in reorderConceptQuestions — the dN
// badge on each row previews the difficulty its position will save.
export function difficultyForPosition(i: number, n: number): number {
  return n <= 1 ? 3 : Math.round((1 + (4 * i) / (n - 1)) * 10) / 10;
}

export type ArrangeQ = LessonCropRef & {
  questionId: unknown;
  label: string | null;
};

export function ArrangeList({
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
      <span className="w-7 shrink-0 text-[9px] tabular-nums text-muted-foreground">
        d{difficultyForPosition(index, count)}
      </span>
      <div className="flex-1 min-w-0">
        <LessonCrop crop={q} maxH={40} zoomOn="tap" />
      </div>
    </div>
  );
}
