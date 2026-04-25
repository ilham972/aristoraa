'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
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
  // Drag state in a ref so re-renders don't wipe it.
  const dragRef = useRef<{ startX: number; startY: number; touchId: number | null } | null>(null);
  // Mutation kept in a ref so the listener-attaching effect doesn't tear down
  // and re-attach every render (Convex's useMutation can return new refs).
  const createMutRef = useRef(createMut);
  useEffect(() => { createMutRef.current = createMut; }, [createMut]);

  const [draggingPreview, setDraggingPreview] = useState<null | {
    startX: number; startY: number; endX: number; endY: number;
  }>(null);
  const [editCrop, setEditCrop] = useState<QuestionBankRow | null>(null);
  // Natural aspect ratio of the page image (width / height). We render the
  // visible page as a <div> with `background-image` to bypass Android Chrome's
  // image context-menu (long-press save/share), which only fires on real <img>
  // elements. A hidden preloader <img> reports the natural aspect once loaded.
  const [naturalAspect, setNaturalAspect] = useState<number | null>(null);

  // ─── Mobile-only on-screen diagnostic ──────────────────────────────────
  // The user has no Mac/USB to see iOS console logs. This panel tells us
  // in one screenshot whether: (a) the effect actually attached listeners,
  // (b) touchstart/move/end are firing, (c) the captureRef has non-zero
  // bounds, (d) the computed point is non-null. Remove once crop is
  // confirmed working on device.
  const [diag, setDiag] = useState({
    attached: false,
    ts: 0,
    tm: 0,
    te: 0,
    cm: 0,
    rectW: 0,
    rectH: 0,
    lastX: -1,
    lastY: -1,
    note: '',
  });

  // Forward diag updates to the route header via window CustomEvent so the
  // user can see the counters without having to find the small per-page
  // panel. Only dispatches when we have a real signal (touch reached the
  // listener at least once) to avoid each page's mount overwriting the
  // others' counters with default zeros.
  useEffect(() => {
    if (diag.ts === 0 && diag.tm === 0 && diag.te === 0 && diag.cm === 0 && !diag.attached) return;
    window.dispatchEvent(new CustomEvent('cropdiag', {
      detail: { page: pageNumber, ...diag },
    }));
  }, [diag, pageNumber]);

  const exById = useMemo(() => {
    const m: Record<string, UnitExercise> = {};
    for (const e of unitExercises) m[e._id] = e;
    return m;
  }, [unitExercises]);

  // Native event listeners on the capture div. Native (not React synthetic)
  // because:
  //   1. React synthetic touch events on iOS are PASSIVE by default — calling
  //      e.preventDefault() in a synthetic handler is a no-op, so iOS's image
  //      callout (long-press save/copy/share menu) couldn't be cancelled and
  //      the image gesture recogniser kept stealing the touch.
  //   2. Native addEventListener with { passive: false } lets us preventDefault
  //      on touchstart and touchmove, which iOS respects.
  // Effect deps are only [cropMode, pageId] — createMutRef stays stable so
  // the effect doesn't tear down listeners mid-gesture.
  useEffect(() => {
    if (!cropMode) return;
    const el = captureRef.current;
    if (!el) return;

    const toPoint = (clientX: number, clientY: number) => {
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
      createMutRef.current({
        source: 'textbook',
        textbookPageId: pageId,
        cropBox: { x, y, w, h },
      }).catch((err) => {
        console.error(err);
        toast.error('Could not save crop');
      });
    };

    // ── Touch (mobile) ─────────────────────────────
    const onTouchStart = (e: TouchEvent) => {
      const r = el.getBoundingClientRect();
      const t = e.touches[0];
      // Diag FIRST — if this counter never increments on screen, the
      // listener isn't being reached at all (most likely cause of the bug).
      setDiag((d) => ({
        ...d,
        ts: d.ts + 1,
        rectW: r.width,
        rectH: r.height,
        note: !t ? 'no touches[0]' : r.width === 0 || r.height === 0 ? 'rect 0' : '',
      }));
      if (!t) return;
      const p = toPoint(t.clientX, t.clientY);
      if (!p) return;
      dragRef.current = { startX: p.x, startY: p.y, touchId: t.identifier };
      setDraggingPreview({ startX: p.x, startY: p.y, endX: p.x, endY: p.y });
      setDiag((d) => ({ ...d, lastX: p.x, lastY: p.y }));
      e.preventDefault();
    };
    const onTouchMove = (e: TouchEvent) => {
      const d = dragRef.current;
      setDiag((s) => ({ ...s, tm: s.tm + 1 }));
      if (!d) return;
      const t = Array.from(e.touches).find((x) => x.identifier === d.touchId) || e.touches[0];
      if (!t) return;
      const p = toPoint(t.clientX, t.clientY);
      if (!p) return;
      setDraggingPreview({ startX: d.startX, startY: d.startY, endX: p.x, endY: p.y });
      setDiag((s) => ({ ...s, lastX: p.x, lastY: p.y }));
      e.preventDefault();
    };
    const onTouchEnd = (e: TouchEvent) => {
      const d = dragRef.current;
      setDiag((s) => ({ ...s, te: s.te + 1 }));
      if (!d) return;
      const t = Array.from(e.changedTouches).find((x) => x.identifier === d.touchId) || e.changedTouches[0];
      const p = t ? toPoint(t.clientX, t.clientY) : null;
      if (!p) { dragRef.current = null; setDraggingPreview(null); return; }
      finishDrag(p.x, p.y);
      e.preventDefault();
    };
    const onTouchCancel = () => {
      dragRef.current = null;
      setDraggingPreview(null);
    };

    // ── Mouse (desktop) ────────────────────────────
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const p = toPoint(e.clientX, e.clientY);
      if (!p) return;
      dragRef.current = { startX: p.x, startY: p.y, touchId: null };
      setDraggingPreview({ startX: p.x, startY: p.y, endX: p.x, endY: p.y });
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      e.preventDefault();
    };
    const onMouseMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const p = toPoint(e.clientX, e.clientY);
      if (!p) return;
      setDraggingPreview({ startX: d.startX, startY: d.startY, endX: p.x, endY: p.y });
    };
    const onMouseUp = (e: MouseEvent) => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      const p = toPoint(e.clientX, e.clientY);
      if (!p) { dragRef.current = null; setDraggingPreview(null); return; }
      finishDrag(p.x, p.y);
    };

    // Android Chrome's long-press image menu (save/share/copy) is fired via
    // the `contextmenu` event, NOT via touchstart's default. preventDefault
    // on touchstart does not block it. We must also block contextmenu.
    // Also count it so we can see in the diagnostic whether contextmenu
    // even reaches our listener (if cm:0 but the menu still appears, the
    // long-press is not hitting captureRef at all).
    const onContextMenu = (e: Event) => {
      setDiag((d) => ({ ...d, cm: d.cm + 1 }));
      e.preventDefault();
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: false });
    el.addEventListener('touchcancel', onTouchCancel);
    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('contextmenu', onContextMenu);
    setDiag((d) => ({ ...d, attached: true }));

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchCancel);
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      setDiag((d) => ({ ...d, attached: false }));
    };
  }, [cropMode, pageId]);

  // Preview is gated by cropMode — when crop mode is off, the preview is
  // always hidden, even if draggingPreview state still holds the last drag
  // coordinates from before the mode toggled. The next touchstart in a
  // future crop session overwrites it, so no explicit reset effect is needed
  // (which would trigger the react-hooks/set-state-in-effect lint).
  const preview = cropMode && draggingPreview
    ? {
        x: Math.min(draggingPreview.startX, draggingPreview.endX),
        y: Math.min(draggingPreview.startY, draggingPreview.endY),
        w: Math.abs(draggingPreview.endX - draggingPreview.startX),
        h: Math.abs(draggingPreview.endY - draggingPreview.startY),
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

      {/* DIAGNOSTIC — temporary, remove once iOS crop is verified working */}
      {cropMode && (
        <div
          className="absolute top-9 left-2 z-40 bg-black/85 text-white text-[9px] font-mono px-1.5 py-1 rounded pointer-events-none leading-tight space-y-0.5"
          style={{ maxWidth: 180 }}
        >
          <div>L:{diag.attached ? 'ON' : 'OFF'} ts:{diag.ts} tm:{diag.tm} te:{diag.te}</div>
          <div>rect:{Math.round(diag.rectW)}x{Math.round(diag.rectH)}</div>
          <div>last:{diag.lastX.toFixed(2)},{diag.lastY.toFixed(2)}</div>
          {diag.note && <div className="text-amber-300">{diag.note}</div>}
        </div>
      )}

      <div
        ref={containerRef}
        className="relative select-none"
        style={{
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
        }}
      >
        {imageUrl ? (
          // Replaced <img> with a hidden preloader + background-image div.
          // Android Chrome's long-press save/share menu only fires on real
          // <img> elements; rendering the page image via CSS background-image
          // removes that target completely. The hidden <img> preloads the
          // image so we can read naturalWidth/Height to compute aspect.
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt=""
              aria-hidden
              onLoad={(e) => {
                const im = e.currentTarget;
                if (im.naturalWidth && im.naturalHeight) {
                  setNaturalAspect(im.naturalWidth / im.naturalHeight);
                }
              }}
              style={{ display: 'none' }}
            />
            <div
              role="img"
              aria-label={`Page ${pageNumber}`}
              className="w-full rounded-lg border border-border block pointer-events-none"
              style={{
                backgroundImage: `url("${imageUrl}")`,
                backgroundSize: '100% 100%',
                backgroundRepeat: 'no-repeat',
                aspectRatio: naturalAspect ? `${naturalAspect}` : '3 / 4',
                WebkitUserSelect: 'none',
                userSelect: 'none',
              }}
            />
          </>
        ) : (
          <div className="w-full aspect-[3/4] bg-muted rounded-lg flex items-center justify-center">
            <p className="text-sm text-muted-foreground">Page {pageNumber} not captured</p>
          </div>
        )}

        {/* Dedicated touch-capture layer — listeners attached natively in
            useEffect (see above). Only exists in crop mode; sits above the
            image (z-10) and below crops (z-30) so tapping an existing crop
            hits the crop and dragging empty area starts a new crop. */}
        {cropMode && (
          <div
            ref={captureRef}
            className="absolute inset-0 cursor-crosshair z-10"
            style={{
              touchAction: 'none',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none',
              userSelect: 'none',
            }}
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm mx-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            <Link2 className="w-4 h-4" />
            Link crop to exercise
          </DialogTitle>
        </DialogHeader>
        {/* Body remounts per crop via the key prop, so its useState
            initialisers seed from the latest crop without an effect. */}
        {crop && (
          <CropLinkDialogBody
            key={crop._id}
            crop={crop}
            unitExercises={unitExercises}
            onSave={onSave}
            onClear={onClear}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CropLinkDialogBody({
  crop,
  unitExercises,
  onSave,
  onClear,
}: {
  crop: QuestionBankRow;
  unitExercises: UnitExercise[];
  onSave: (payload: {
    linkedExerciseId?: Id<'exercises'>;
    linkedQuestionKey?: string;
  }) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const [exerciseId, setExerciseId] = useState<Id<'exercises'> | ''>(crop.linkedExerciseId ?? '');
  const [questionKey, setQuestionKey] = useState(crop.linkedQuestionKey ?? '');

  const exerciseRows = unitExercises
    .filter((e) => (e.type ?? 'exercise') === 'exercise')
    .sort((a, b) => a.order - b.order);

  const picked = exerciseId ? unitExercises.find((e) => e._id === exerciseId) : null;

  return (
    <>
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
            disabled={!crop.linkedExerciseId}
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
    </>
  );
}
