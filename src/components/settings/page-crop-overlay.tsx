'use client';

import { useMemo, useRef, useState, useEffect, type TouchEventHandler, type MouseEventHandler } from 'react';
import { useMutation } from 'convex/react';
import { X, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import { toast } from 'sonner';

type CropBox = { x: number; y: number; w: number; h: number };

type QuestionBankRow = {
  _id: Id<'questionBank'>;
  textbookPageId?: Id<'textbookPages'>;
  cropBox?: CropBox;
  linkedExerciseId?: Id<'exercises'>;
  linkedQuestionKey?: string;
};

type UnitExercise = {
  _id: Id<'exercises'>;
  name: string;
  questionCount: number;
  type?: string;
  order: number;
};

interface Props {
  pageId: Id<'textbookPages'>;
  pageNumber: number;
  imageUrl: string | null;
  cropMode: boolean;
  crops: QuestionBankRow[];
  unitExercises: UnitExercise[];
}

const MIN_CROP_SIZE = 0.03; // 3% of image in either dimension

export function PageCropOverlay({
  pageId,
  pageNumber,
  imageUrl,
  cropMode,
  crops,
  unitExercises,
}: Props) {
  const createMut = useMutation(api.questionBank.create);
  const removeMut = useMutation(api.questionBank.remove);
  const updateMut = useMutation(api.questionBank.update);
  const clearLinkMut = useMutation(api.questionBank.clearLink);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const captureRef = useRef<HTMLDivElement | null>(null);
  // Drag state in a ref so rapid re-renders don't wipe it. setDraggingPreview
  // is only called to drive the visual preview rectangle, not to persist
  // drag coordinates.
  const dragRef = useRef<{ startX: number; startY: number; touchId: number | null } | null>(null);
  const [draggingPreview, setDraggingPreview] = useState<null | {
    startX: number; startY: number; endX: number; endY: number;
  }>(null);
  const [editCrop, setEditCrop] = useState<QuestionBankRow | null>(null);

  const exById = useMemo(() => {
    const m: Record<string, UnitExercise> = {};
    for (const e of unitExercises) m[e._id] = e;
    return m;
  }, [unitExercises]);

  const toPoint = (clientX: number, clientY: number) => {
    const el = captureRef.current ?? containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  };

  const finishDrag = (endX: number, endY: number) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDraggingPreview(null);
    if (!d) return;
    const x = Math.min(d.startX, endX);
    const y = Math.min(d.startY, endY);
    const w = Math.abs(endX - d.startX);
    const h = Math.abs(endY - d.startY);
    if (w < MIN_CROP_SIZE || h < MIN_CROP_SIZE) return;
    createMut({ source: 'textbook', textbookPageId: pageId, cropBox: { x, y, w, h } })
      .catch((err) => {
        console.error(err);
        toast.error('Could not save crop');
      });
  };

  // ── React synthetic touch handlers (mobile) ────────────
  // React synthetic touchstart/move/end are passive by default — but since
  // the capture div has touch-action: none and data-vaul-no-drag, the
  // browser/Vaul won't claim the gesture, so passive is fine.
  const onTouchStart: TouchEventHandler<HTMLDivElement> = (e) => {
    const t = e.touches[0];
    if (!t) return;
    const p = toPoint(t.clientX, t.clientY);
    if (!p) return;
    dragRef.current = { startX: p.x, startY: p.y, touchId: t.identifier };
    setDraggingPreview({ startX: p.x, startY: p.y, endX: p.x, endY: p.y });
  };

  const onTouchMove: TouchEventHandler<HTMLDivElement> = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const t = Array.from(e.touches).find((x) => x.identifier === d.touchId) || e.touches[0];
    if (!t) return;
    const p = toPoint(t.clientX, t.clientY);
    if (!p) return;
    setDraggingPreview({ startX: d.startX, startY: d.startY, endX: p.x, endY: p.y });
  };

  const onTouchEnd: TouchEventHandler<HTMLDivElement> = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const t = Array.from(e.changedTouches).find((x) => x.identifier === d.touchId) || e.changedTouches[0];
    if (!t) { dragRef.current = null; setDraggingPreview(null); return; }
    const p = toPoint(t.clientX, t.clientY);
    if (!p) { dragRef.current = null; setDraggingPreview(null); return; }
    finishDrag(p.x, p.y);
  };

  const onTouchCancel: TouchEventHandler<HTMLDivElement> = () => {
    dragRef.current = null;
    setDraggingPreview(null);
  };

  // ── Mouse handlers (desktop) ───────────────────────────
  const onMouseDown: MouseEventHandler<HTMLDivElement> = (e) => {
    if (e.button !== 0) return;
    const p = toPoint(e.clientX, e.clientY);
    if (!p) return;
    dragRef.current = { startX: p.x, startY: p.y, touchId: null };
    setDraggingPreview({ startX: p.x, startY: p.y, endX: p.x, endY: p.y });

    // Listen on window so drag continues even when cursor leaves the div.
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const pt = toPoint(ev.clientX, ev.clientY);
      if (!pt) return;
      setDraggingPreview({ startX: d.startX, startY: d.startY, endX: pt.x, endY: pt.y });
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const pt = toPoint(ev.clientX, ev.clientY);
      if (pt) finishDrag(pt.x, pt.y);
      else { dragRef.current = null; setDraggingPreview(null); }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    e.preventDefault();
  };

  const preview = draggingPreview
    ? {
        x: Math.min(draggingPreview.startX, draggingPreview.endX),
        y: Math.min(draggingPreview.startY, draggingPreview.endY),
        w: Math.abs(draggingPreview.endX - draggingPreview.startX),
        h: Math.abs(draggingPreview.endY - draggingPreview.startY),
      }
    : null;

  // Reset drag state when crop mode turns off mid-drag.
  useEffect(() => {
    if (!cropMode) {
      dragRef.current = null;
      setDraggingPreview(null);
    }
  }, [cropMode]);

  return (
    <div className="relative">
      {/* Page number label */}
      <div className="absolute top-2 left-2 z-20 bg-background/80 backdrop-blur-sm rounded-md px-2 py-0.5 text-xs font-mono border border-border/50 pointer-events-none">
        p.{pageNumber}
        {cropMode && (
          <span className="ml-1.5 text-[10px] text-primary font-bold">CROP</span>
        )}
      </div>

      {/* Crop count chip */}
      {crops.length > 0 && (
        <div className="absolute top-2 right-2 z-20 bg-primary/90 text-primary-foreground rounded-full px-2 py-0.5 text-[10px] font-bold pointer-events-none">
          {crops.length}
        </div>
      )}

      <div
        ref={containerRef}
        className="relative select-none"
        style={{ WebkitUserSelect: 'none' }}
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={`Page ${pageNumber}`}
            className="w-full rounded-lg border border-border block pointer-events-none"
            draggable={false}
          />
        ) : (
          <div className="w-full aspect-[3/4] bg-muted rounded-lg flex items-center justify-center">
            <p className="text-sm text-muted-foreground">Page {pageNumber} not captured</p>
          </div>
        )}

        {/* Dedicated touch-capture layer: only exists in crop mode, sits
            above the image but below the rendered crops so tapping an
            existing crop hits the crop, and dragging anywhere else starts
            a new drag. React synthetic events on the capture div keep the
            handlers stable across re-renders. */}
        {cropMode && (
          <div
            ref={captureRef}
            data-vaul-no-drag
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchCancel}
            onMouseDown={onMouseDown}
            className="absolute inset-0 cursor-crosshair z-10"
            style={{ touchAction: 'none', WebkitUserSelect: 'none' }}
          />
        )}

        {/* Existing crops — rendered AFTER the capture layer so they are
            on top and receive their own taps. */}
        {crops.map((c) => (
          c.cropBox && (
            <CropRect
              key={c._id}
              crop={c}
              linkedExercise={c.linkedExerciseId ? exById[c.linkedExerciseId] : undefined}
              cropMode={cropMode}
              onEdit={() => setEditCrop(c)}
              onDelete={async () => {
                if (!confirm('Delete this crop?')) return;
                try {
                  await removeMut({ id: c._id });
                } catch (err) {
                  console.error(err);
                  toast.error('Could not delete');
                }
              }}
            />
          )
        ))}

        {/* In-progress drag preview */}
        {preview && preview.w >= 0.005 && preview.h >= 0.005 && (
          <div
            className="absolute border-2 border-primary bg-primary/15 rounded-sm pointer-events-none z-20"
            style={{
              left: `${preview.x * 100}%`,
              top: `${preview.y * 100}%`,
              width: `${preview.w * 100}%`,
              height: `${preview.h * 100}%`,
            }}
          />
        )}
      </div>

      {/* Edit link dialog */}
      <CropLinkDialog
        open={!!editCrop}
        onOpenChange={(o) => { if (!o) setEditCrop(null); }}
        crop={editCrop}
        unitExercises={unitExercises}
        onSave={async (payload) => {
          if (!editCrop) return;
          try {
            await updateMut({ id: editCrop._id, ...payload });
            toast.success('Link saved');
            setEditCrop(null);
          } catch (err) {
            console.error(err);
            toast.error('Could not save');
          }
        }}
        onClear={async () => {
          if (!editCrop) return;
          try {
            await clearLinkMut({ id: editCrop._id });
            toast.success('Link cleared');
            setEditCrop(null);
          } catch (err) {
            console.error(err);
            toast.error('Could not clear');
          }
        }}
      />
    </div>
  );
}

// ─── A rendered crop rectangle overlay ───

function CropRect({
  crop,
  linkedExercise,
  cropMode,
  onEdit,
  onDelete,
}: {
  crop: QuestionBankRow;
  linkedExercise?: UnitExercise;
  cropMode: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const b = crop.cropBox!;
  const isLinked = !!crop.linkedExerciseId;
  const label = isLinked && linkedExercise
    ? `${linkedExercise.name}${crop.linkedQuestionKey ? ` Q${crop.linkedQuestionKey}` : ''}`
    : 'unlinked';

  return (
    <div
      data-crop-rect="1"
      className={`absolute rounded-sm transition-colors z-30 ${
        isLinked
          ? 'border-2 border-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/20'
          : 'border-2 border-amber-500 bg-amber-500/10 hover:bg-amber-500/20'
      } ${cropMode ? 'pointer-events-auto' : 'pointer-events-none opacity-60'}`}
      style={{
        left: `${b.x * 100}%`,
        top: `${b.y * 100}%`,
        width: `${b.w * 100}%`,
        height: `${b.h * 100}%`,
      }}
      onClick={(e) => {
        if (!cropMode) return;
        e.stopPropagation();
        onEdit();
      }}
      onTouchStart={(e) => { if (cropMode) e.stopPropagation(); }}
      onMouseDown={(e) => { if (cropMode) e.stopPropagation(); }}
    >
      {/* Label chip at top-left */}
      <div
        className={`absolute top-0 left-0 -translate-y-full mb-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${
          isLinked
            ? 'bg-emerald-500 text-white'
            : 'bg-amber-500 text-white'
        }`}
        style={{ transform: 'translateY(-100%)' }}
      >
        {label}
      </div>

      {/* Delete button at top-right (only in crop mode) */}
      {cropMode && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow-sm hover:scale-110 transition-transform"
          aria-label="Delete crop"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ─── Edit link dialog ───

function CropLinkDialog({
  open,
  onOpenChange,
  crop,
  unitExercises,
  onSave,
  onClear,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  crop: QuestionBankRow | null;
  unitExercises: UnitExercise[];
  onSave: (payload: {
    linkedExerciseId?: Id<'exercises'>;
    linkedQuestionKey?: string;
  }) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const [exerciseId, setExerciseId] = useState<Id<'exercises'> | ''>('');
  const [questionKey, setQuestionKey] = useState('');

  // Sync state when crop opens
  useEffect(() => {
    if (open && crop) {
      setExerciseId(crop.linkedExerciseId ?? '');
      setQuestionKey(crop.linkedQuestionKey ?? '');
    }
  }, [open, crop]);

  const exerciseRows = unitExercises
    .filter((e) => (e.type ?? 'exercise') === 'exercise')
    .sort((a, b) => a.order - b.order);

  const picked = exerciseId ? unitExercises.find((e) => e._id === exerciseId) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm mx-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            <Link2 className="w-4 h-4" />
            Link crop to exercise
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Exercise</Label>
            <div className="grid grid-cols-5 gap-1 mt-1 max-h-[200px] overflow-y-auto">
              {exerciseRows.length === 0 ? (
                <p className="col-span-5 text-[11px] text-muted-foreground py-2 text-center">
                  No exercises in this unit. Add them first in Exercises subtab.
                </p>
              ) : (
                exerciseRows.map((ex) => {
                  const selected = exerciseId === ex._id;
                  return (
                    <button
                      key={ex._id}
                      onClick={() => setExerciseId(selected ? '' : ex._id)}
                      className={`h-9 rounded-lg text-xs font-mono font-bold transition-all ${
                        selected
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted hover:bg-muted/80 text-foreground'
                      }`}
                      title={ex.name}
                    >
                      {ex.name.replace(/^\d+\./, '')}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div>
            <Label className="text-xs">
              Question key
              {picked && (
                <span className="text-muted-foreground ml-1">
                  (1–{picked.questionCount || '?'} or e.g. 2.a, 3.iii)
                </span>
              )}
            </Label>
            <Input
              value={questionKey}
              onChange={(e) => setQuestionKey(e.target.value)}
              placeholder="e.g. 3 or 2.a"
              className="mt-1 font-mono text-sm"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              onClick={onClear}
              className="shrink-0"
              disabled={!crop?.linkedExerciseId}
            >
              Clear link
            </Button>
            <Button
              onClick={() => onSave({
                linkedExerciseId: exerciseId || undefined,
                linkedQuestionKey: questionKey.trim() || undefined,
              })}
              className="flex-1"
            >
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
