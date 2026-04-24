'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
  const [dragging, setDragging] = useState<null | {
    startX: number; startY: number; endX: number; endY: number;
  }>(null);
  const [editCrop, setEditCrop] = useState<QuestionBankRow | null>(null);

  const exById = useMemo(() => {
    const m: Record<string, UnitExercise> = {};
    for (const e of unitExercises) m[e._id] = e;
    return m;
  }, [unitExercises]);

  const getNormalizedPoint = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    return {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!cropMode) return;
    // Left-click / primary touch only
    if (e.button !== undefined && e.button !== 0) return;
    const p = getNormalizedPoint(e);
    if (!p) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragging({ startX: p.x, startY: p.y, endX: p.x, endY: p.y });
    e.preventDefault();
    e.stopPropagation();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!cropMode || !dragging) return;
    const p = getNormalizedPoint(e);
    if (!p) return;
    setDragging({ ...dragging, endX: p.x, endY: p.y });
    e.preventDefault();
    e.stopPropagation();
  };

  const onPointerUp = async (e: React.PointerEvent<HTMLDivElement>) => {
    if (!cropMode || !dragging) return;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    const { startX, startY, endX, endY } = dragging;
    setDragging(null);

    const x = Math.min(startX, endX);
    const y = Math.min(startY, endY);
    const w = Math.abs(endX - startX);
    const h = Math.abs(endY - startY);

    if (w < MIN_CROP_SIZE || h < MIN_CROP_SIZE) return; // ignore taps

    try {
      await createMut({
        source: 'textbook',
        textbookPageId: pageId,
        cropBox: { x, y, w, h },
      });
    } catch (err) {
      console.error(err);
      toast.error('Could not save crop');
    }
  };

  const preview = dragging
    ? {
        x: Math.min(dragging.startX, dragging.endX),
        y: Math.min(dragging.startY, dragging.endY),
        w: Math.abs(dragging.endX - dragging.startX),
        h: Math.abs(dragging.endY - dragging.startY),
      }
    : null;

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
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDragging(null)}
        data-vaul-no-drag
        className={`relative select-none ${cropMode ? 'cursor-crosshair touch-none' : ''}`}
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

        {/* Existing crops */}
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
            className="absolute border-2 border-primary bg-primary/15 rounded-sm pointer-events-none"
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
      className={`absolute rounded-sm transition-colors ${
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
      onPointerDown={(e) => {
        // Prevent drawing-start from bubbling when interacting with a crop
        if (cropMode) e.stopPropagation();
      }}
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
