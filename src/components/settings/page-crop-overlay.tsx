'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import { useMutation } from 'convex/react';
import { X } from 'lucide-react';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import { toast } from 'sonner';
import type { CropTool } from './crop-tool-toolbar';

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
  pageId: Id<'textbookPages'> | null;
  pageNumber: number;
  imageUrl: string | null;
  // Active tool from the parent's 4-mode toolbar. Each mode behaves
  // independently — we no longer have a single "crop mode" boolean.
  //   crop   → 1-finger drag draws a new crop rect; existing crops inert.
  //   resize → tap a crop to select; corner handles resize the selected one.
  //   delete → red X on every crop; tapping X removes that crop.
  //   all    → 2-finger pinch / pan adjusts the page view.
  tool: CropTool;
  crops: QuestionBankRow[];
  unitExercises: UnitExercise[];
  // ── Fast-mode (per-exercise) ──
  // If `onDrawComplete` is provided, the parent owns crop persistence — the
  // overlay does not call createMut itself. Used by the per-exercise crop
  // route, which auto-keys each new crop with the currently-selected
  // main-Q/sub key from its sticky pill header.
  onDrawComplete?: (box: CropBox) => void;
  // If provided, tap on an existing crop dispatches to parent instead of
  // opening the legacy edit dialog. Lets the route highlight + re-key via
  // the same pill header.
  onCropTap?: (cropId: Id<'questionBank'>) => void;
  // Highlights the currently-selected crop (used by the route while the user
  // is re-keying a previously-saved crop).
  selectedCropId?: Id<'questionBank'> | null;
  // Caption rendered above each crop. Defaults to a "Ex.X Q.Y" derived from
  // unitExercises; per-exercise mode passes only the question key.
  cropLabelFor?: (crop: QuestionBankRow) => string;
  // If provided, an icon button is shown on the page that opens this page in
  // the full-screen zoom view. Parent route owns the actual zoom modal.
  onZoom?: (pageId: Id<'textbookPages'>, naturalAspect: number | null) => void;
  // If set and matches one of `crops`, that rect briefly pulses yellow so
  // the user can see exactly which crop a deep-link from the Details capture
  // grid pointed at.
  flashCropId?: Id<'questionBank'> | null;
}

const MIN_CROP_SIZE = 0.03; // 3% of image in either dimension
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;

export function PageCropOverlay({
  pageId,
  pageNumber,
  imageUrl,
  tool,
  crops,
  unitExercises,
  onDrawComplete,
  onCropTap,
  selectedCropId,
  cropLabelFor,
  onZoom,
  flashCropId,
}: Props) {
  // Convenience flags derived from the active tool. `resizeMode` is gated
  // per-rect inside CropRect, not here.
  const drawMode = tool === 'crop';
  const deleteMode = tool === 'delete';
  const removeMut = useMutation(api.questionBank.remove);
  const updateMut = useMutation(api.questionBank.update);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const captureRef = useRef<HTMLDivElement | null>(null);
  // Drag state in a ref so re-renders don't wipe it.
  const dragRef = useRef<{ startX: number; startY: number; touchId: number | null } | null>(null);
  // Same ref-pattern for the parent-owned save callback so the listener
  // effect doesn't tear down on every render of the parent.
  const onDrawCompleteRef = useRef(onDrawComplete);
  useEffect(() => { onDrawCompleteRef.current = onDrawComplete; }, [onDrawComplete]);

  const [draggingPreview, setDraggingPreview] = useState<null | {
    startX: number; startY: number; endX: number; endY: number;
  }>(null);
  // Natural aspect ratio of the page image (width / height). We render the
  // visible page as a <div> with `background-image` to bypass Android Chrome's
  // image context-menu (long-press save/share), which only fires on real <img>
  // elements. A hidden preloader <img> reports the natural aspect once loaded.
  const [naturalAspect, setNaturalAspect] = useState<number | null>(null);

  // Per-page pinch-zoom state. Two-finger gestures can change this transform
  // in every tool, and the image / crop rects render through the same layer
  // so the user's zoomed position persists while editing.
  const [zoomState, setZoomState] = useState({ scale: 1, tx: 0, ty: 0 });
  const zoom = zoomState;
  const isZoomed = zoom.scale > 1.001;
  // Live mirror so the gesture handlers can snapshot the current transform
  // without forcing the listener-attaching effect to re-bind on every tick.
  const zoomRef = useRef(zoomState);
  useEffect(() => { zoomRef.current = zoomState; }, [zoomState]);

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
  // Effect deps are only [drawMode, pageId, imageUrl]. Listeners attach only
  // in `crop` tool mode; resize/delete use their own rect controls.
  useEffect(() => {
    if (!drawMode) return;
    // Listener attaches whenever there's an image to crop. We don't gate on
    // pageId here: if the convex backend hasn't been redeployed (so pageId
    // isn't returned from getPagesInRange), the listener still attaches and
    // the user can drag — the save handler shows a clear toast pointing at
    // the missing pageId. Gating here would cause "L:OFF" on visible pages,
    // which looks like a frontend bug when it's actually a backend deploy
    // mismatch.
    if (!imageUrl) return;
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
      if (!pageId) {
        // pageId is null even though imageUrl is set → the production Convex
        // backend is on an old version of getPagesInRange that doesn't
        // return pageId. Tell the user the actual fix.
        toast.error('Backend out of date — run `npx convex deploy`');
        return;
      }
      if (onDrawCompleteRef.current) {
        onDrawCompleteRef.current({ x, y, w, h });
        return;
      }
    };

    // ── Touch (mobile) ─────────────────────────────
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        dragRef.current = null;
        setDraggingPreview(null);
        return;
      }
      const t = e.touches[0];
      if (!t) return;
      const p = toPoint(t.clientX, t.clientY);
      if (!p) return;
      dragRef.current = { startX: p.x, startY: p.y, touchId: t.identifier };
      setDraggingPreview({ startX: p.x, startY: p.y, endX: p.x, endY: p.y });
      e.preventDefault();
    };
    const onTouchMove = (e: TouchEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (e.touches.length !== 1) {
        dragRef.current = null;
        setDraggingPreview(null);
        return;
      }
      const t = Array.from(e.touches).find((x) => x.identifier === d.touchId) || e.touches[0];
      if (!t) return;
      const p = toPoint(t.clientX, t.clientY);
      if (!p) return;
      setDraggingPreview({ startX: d.startX, startY: d.startY, endX: p.x, endY: p.y });
      e.preventDefault();
    };
    const onTouchEnd = (e: TouchEvent) => {
      const d = dragRef.current;
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
    const onContextMenu = (e: Event) => e.preventDefault();

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: false });
    el.addEventListener('touchcancel', onTouchCancel);
    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('contextmenu', onContextMenu);

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchCancel);
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [drawMode, pageId, imageUrl]);

  // ── Two-finger pinch + pan in every tool ───────────────────────
  // Listener attached to the outer container (not captureRef) so a 2-finger
  // gesture is captured regardless of which child the fingers land on, and
  // the existing draw / resize / delete listeners stay untouched.
  //
  // In editing tools, 1-finger gestures remain reserved for the active tool.
  // Panning a zoomed page is still possible with a two-finger drag because
  // the pinch center changes even when the finger distance stays the same.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const distance = (a: Touch, b: Touch) =>
      Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

    type Gesture =
      | {
          type: 'pinch';
          startDist: number;
          startCenterX: number;
          startCenterY: number;
          startScale: number;
          startTx: number;
          startTy: number;
        }
      | null;
    let g: Gesture = null;

    // Keep the image edges flush with the container so the user can't pan
    // the page off-screen and into a black void. Snaps back to the fit
    // rect when scale rounds back to 1.
    const clamp = (z: { scale: number; tx: number; ty: number }) => {
      if (z.scale <= 1.001) return { scale: 1, tx: 0, ty: 0 };
      const w = el.clientWidth;
      const h = el.clientHeight;
      const minTx = w - w * z.scale;
      const minTy = h - h * z.scale;
      return {
        scale: z.scale,
        tx: Math.max(minTx, Math.min(0, z.tx)),
        ty: Math.max(minTy, Math.min(0, z.ty)),
      };
    };

    const onTouchStart = (e: TouchEvent) => {
      const r = el.getBoundingClientRect();
      const tr = zoomRef.current;
      if (e.touches.length === 2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const cx = (t1.clientX + t2.clientX) / 2 - r.left;
        const cy = (t1.clientY + t2.clientY) / 2 - r.top;
        g = {
          type: 'pinch',
          startDist: distance(t1, t2),
          startCenterX: cx,
          startCenterY: cy,
          startScale: tr.scale,
          startTx: tr.tx,
          startTy: tr.ty,
        };
        e.preventDefault();
        return;
      }
      // Otherwise leave 1-finger gestures to the active tool / browser.
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!g) return;
      const r = el.getBoundingClientRect();
      if (g.type === 'pinch' && e.touches.length === 2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const newDist = distance(t1, t2);
        if (newDist === 0) return;
        const cx = (t1.clientX + t2.clientX) / 2 - r.left;
        const cy = (t1.clientY + t2.clientY) / 2 - r.top;
        const ratio = newDist / g.startDist;
        let newScale = g.startScale * ratio;
        newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newScale));
        const k = newScale / g.startScale;
        const newTx = cx - (g.startCenterX - g.startTx) * k;
        const newTy = cy - (g.startCenterY - g.startTy) * k;
        setZoomState(clamp({ scale: newScale, tx: newTx, ty: newTy }));
        e.preventDefault();
        return;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!g) return;
      if (e.touches.length === 0) g = null;
    };

    const onTouchCancel = () => {
      g = null;
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: false });
    el.addEventListener('touchcancel', onTouchCancel);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchCancel);
    };
  }, []);

  // Preview is gated by drawMode — when the tool isn't "crop", the preview is
  // always hidden, even if draggingPreview state still holds the last drag
  // coordinates from before the tool changed. The next touchstart in a
  // future crop session overwrites it, so no explicit reset effect is needed
  // (which would trigger the react-hooks/set-state-in-effect lint).
  const preview = drawMode && draggingPreview
    ? {
        x: Math.min(draggingPreview.startX, draggingPreview.endX),
        y: Math.min(draggingPreview.startY, draggingPreview.endY),
        w: Math.abs(draggingPreview.endX - draggingPreview.startX),
        h: Math.abs(draggingPreview.endY - draggingPreview.startY),
      }
    : null;

  // Local refs to props that are no longer rendered to keep the page
  // lightweight — the badges/buttons they fed have been removed. Reading
  // them once silences unused-var lint without changing the public Props
  // shape (callers still pass these).
  void deleteMode;
  void drawMode;
  void onZoom;
  void pageNumber;

  return (
    <div className="relative" data-page-id={pageId ?? undefined}>
      <div
        ref={containerRef}
        className={`relative w-full select-none rounded-lg overflow-hidden border ${
          !imageUrl
            ? 'bg-muted/40 border-border'
            : drawMode && pageId
              ? 'cursor-crosshair border-border'
              : 'border-border'
        }`}
        style={{
          aspectRatio:
            imageUrl && naturalAspect ? `${naturalAspect}` : '3 / 4',
          // Per-tool native-gesture policy:
          //   crop   → none (1-finger draws; our JS captures 2-finger zoom)
          //   others → pan-y (1-finger vertical scroll can pass through;
          //                   our JS captures 2-finger zoom)
          touchAction:
            drawMode && imageUrl && pageId
              ? 'none'
              : imageUrl
                ? 'pan-y'
                : 'auto',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
        }}
      >
        {/* Hidden preloader to learn the natural image aspect ratio. */}
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
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
        )}

        {/* Zoom layer — wraps the image AND the crop rects so they zoom
            together, keeping crops visually pinned to their pixels. Crop
            draw / resize math reads the transformed bounding rect, so the
            adjusted view can stay active while editing. */}
        <div
          className="absolute inset-0"
          style={{
            transform: isZoomed
              ? `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.scale})`
              : undefined,
            transformOrigin: '0 0',
            willChange: isZoomed ? 'transform' : undefined,
          }}
        >
          {/* SINGLE capture-and-image element. The visible page itself has
              the touch listeners — "if you can see the image, your touch
              hits the listener" — so no z-index/layering can fail. The
              <div> + background-image avoids the iOS image-callout that a
              real <img> would trigger on long-press. */}
          <div
            ref={captureRef}
            role={imageUrl ? 'img' : undefined}
            aria-label={imageUrl ? `Page ${pageNumber}` : undefined}
            className={`w-full h-full block ${
              !imageUrl
                ? 'flex flex-col items-center justify-center gap-2 text-center px-4'
                : ''
            }`}
            style={{
              backgroundImage: imageUrl ? `url("${imageUrl}")` : undefined,
              backgroundSize: '100% 100%',
              backgroundRepeat: 'no-repeat',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none',
              userSelect: 'none',
            }}
          >
            {!imageUrl && (
              <>
                <p className="text-sm font-medium text-muted-foreground pointer-events-none">
                  Page {pageNumber} not uploaded
                </p>
                <p className="text-[11px] text-muted-foreground/70 pointer-events-none max-w-[220px]">
                  Upload this page in Settings → Content tab, then return here to crop it.
                </p>
              </>
            )}
          </div>

          {/* Existing crops — inside the zoom layer so they stay aligned
              to image pixels at any scale. */}
          {crops.map((c) => (
            c.cropBox && (
              <CropRect
                key={c._id}
                crop={c}
                linkedExercise={c.linkedExerciseId ? exById[c.linkedExerciseId] : undefined}
                tool={tool}
                isSelected={selectedCropId === c._id}
                isFlash={flashCropId === c._id}
                labelOverride={cropLabelFor ? cropLabelFor(c) : undefined}
                parentRef={captureRef}
                zoomScale={zoom.scale}
                onEdit={() => {
                  if (onCropTap) onCropTap(c._id);
                }}
                onResize={async (newBox) => {
                  try {
                    await updateMut({ id: c._id, cropBox: newBox });
                  } catch (err) {
                    console.error(err);
                    toast.error('Could not resize');
                  }
                }}
                onDelete={async () => {
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
      </div>
    </div>
  );
}

// ─── A rendered crop rectangle overlay ───
// When `isSelected` and the active tool is `resize`, four corner handles appear so
// the user can drag a corner to resize the rect. During drag we keep an
// optimistic `localBox` so the rect tracks the finger smoothly; on release
// we commit via `onResize` and clear the override on the next prop sync.

const HANDLE_KINDS = ['tl', 'tr', 'bl', 'br'] as const;
type HandleKind = (typeof HANDLE_KINDS)[number];
const RESIZE_MIN_DIM = 0.02; // 2% of image — keep the box from collapsing

function CropRect({
  crop,
  linkedExercise,
  tool,
  isSelected,
  isFlash,
  labelOverride,
  parentRef,
  zoomScale,
  onEdit,
  onResize,
  onDelete,
}: {
  crop: QuestionBankRow;
  linkedExercise?: UnitExercise;
  tool: CropTool;
  isSelected?: boolean;
  isFlash?: boolean;
  labelOverride?: string;
  parentRef?: React.RefObject<HTMLDivElement | null>;
  zoomScale: number;
  onEdit: () => void;
  onResize?: (box: CropBox) => void | Promise<void>;
  onDelete: () => void;
}) {
  // Per-tool interactivity:
  //   - crop/resize: taps select the rect and sync the active question pill.
  //   - delete: red X handles deletion.
  const interactive = tool === 'crop' || tool === 'resize' || tool === 'delete';
  const showHandles = tool === 'resize' && !!isSelected;
  const showDeleteX = tool === 'delete';
  const invZoom = 1 / Math.max(1, zoomScale);
  const savedBox = crop.cropBox!;
  // Optimistic resize override. We tag the override with the savedBox values
  // it was last applied against; once the server echoes back a different
  // savedBox, the tag mismatches and the override is naturally discarded —
  // no setState-in-effect needed.
  const savedKey = `${savedBox.x},${savedBox.y},${savedBox.w},${savedBox.h}`;
  const [override, setOverride] = useState<
    { savedKey: string; box: CropBox } | null
  >(null);
  const localBox =
    override && override.savedKey === savedKey ? override.box : null;
  const b = localBox ?? savedBox;

  const isLinked = !!crop.linkedExerciseId;
  const defaultLabel = isLinked && linkedExercise
    ? `${linkedExercise.name}${crop.linkedQuestionKey ? ` ${crop.linkedQuestionKey}` : ''}`
    : 'unlinked';
  const label = labelOverride ?? defaultLabel;
  const colorClasses = isFlash
    ? 'border-2 border-yellow-400 bg-yellow-400/30 ring-4 ring-yellow-400/50 animate-pulse'
    : isSelected
      ? 'border-2 border-sky-400 bg-sky-400/20 hover:bg-sky-400/30 ring-2 ring-sky-400/40'
      : isLinked
        ? 'border-2 border-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/20'
        : 'border-2 border-amber-500 bg-amber-500/10 hover:bg-amber-500/20';

  const startResize = (handle: HandleKind) => {
    const parent = parentRef?.current;
    if (!parent) return;
    const startBox = { ...b };
    const startSavedKey = savedKey;

    const computeBox = (cx: number, cy: number): CropBox => {
      const rect = parent.getBoundingClientRect();
      const nx = Math.max(0, Math.min(1, (cx - rect.left) / rect.width));
      const ny = Math.max(0, Math.min(1, (cy - rect.top) / rect.height));
      const right = startBox.x + startBox.w;
      const bottom = startBox.y + startBox.h;
      let { x, y, w, h } = startBox;
      if (handle === 'tl') {
        x = Math.min(nx, right - RESIZE_MIN_DIM);
        y = Math.min(ny, bottom - RESIZE_MIN_DIM);
        w = right - x;
        h = bottom - y;
      } else if (handle === 'tr') {
        const newRight = Math.max(nx, startBox.x + RESIZE_MIN_DIM);
        y = Math.min(ny, bottom - RESIZE_MIN_DIM);
        w = newRight - startBox.x;
        h = bottom - y;
      } else if (handle === 'bl') {
        x = Math.min(nx, right - RESIZE_MIN_DIM);
        const newBottom = Math.max(ny, startBox.y + RESIZE_MIN_DIM);
        w = right - x;
        h = newBottom - startBox.y;
      } else {
        const newRight = Math.max(nx, startBox.x + RESIZE_MIN_DIM);
        const newBottom = Math.max(ny, startBox.y + RESIZE_MIN_DIM);
        w = newRight - startBox.x;
        h = newBottom - startBox.y;
      }
      return { x, y, w, h };
    };

    let lastBox = startBox;
    const onMove = (cx: number, cy: number) => {
      lastBox = computeBox(cx, cy);
      setOverride({ savedKey: startSavedKey, box: lastBox });
    };
    const onEnd = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
      if (onResize) onResize(lastBox);
      // Override is automatically discarded once the saved box echoes back
      // (savedKey changes → override.savedKey mismatch → falls back to
      // savedBox in the render).
    };
    const onMouseMove = (e: MouseEvent) => onMove(e.clientX, e.clientY);
    const onMouseUp = () => onEnd();
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      onMove(t.clientX, t.clientY);
      e.preventDefault();
    };
    const onTouchEnd = () => onEnd();

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);
  };

  return (
    <div
      data-crop-rect="1"
      className={`absolute rounded-sm transition-colors z-30 ${colorClasses} ${
        interactive
          ? 'pointer-events-auto'
          : 'pointer-events-none'
      }`}
      style={{
        left: `${b.x * 100}%`,
        top: `${b.y * 100}%`,
        width: `${b.w * 100}%`,
        height: `${b.h * 100}%`,
      }}
      onClick={(e) => {
        // Crop and Resize mode both let a tap select the rect. In Crop mode
        // this is mainly for syncing the active question pill; in Resize it
        // also exposes the handles.
        if (tool !== 'crop' && tool !== 'resize') return;
        e.stopPropagation();
        onEdit();
      }}
      onTouchStart={(e) => { if (interactive) e.stopPropagation(); }}
      onMouseDown={(e) => { if (interactive) e.stopPropagation(); }}
    >
      {/* Label chip at top-left */}
      <div
        className={`absolute top-0 left-0 -translate-y-full mb-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${
          isFlash
            ? 'bg-yellow-400 text-black'
            : isSelected
              ? 'bg-sky-500 text-white'
              : isLinked
                ? 'bg-emerald-500 text-white'
                : 'bg-amber-500 text-white'
        }`}
        style={{ transform: 'translateY(-100%)' }}
      >
        {label}
      </div>

      {/* Delete button at top-right — only visible in Delete mode. */}
      {showDeleteX && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow-sm hover:scale-110 transition-transform"
          aria-label="Delete crop"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Resize handles (only when selected) */}
      {showHandles && HANDLE_KINDS.map((h) => {
        const isTop = h === 'tl' || h === 'tr';
        const isLeft = h === 'tl' || h === 'bl';
        const sizePx = 10 * invZoom;
        const offset = -sizePx / 2;
        return (
          <div
            key={h}
            role="button"
            aria-label={`Resize ${h}`}
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              startResize(h);
            }}
            onTouchStart={(e) => {
              e.stopPropagation();
              startResize(h);
            }}
            className="absolute rounded-[3px] bg-sky-400 border border-white shadow-sm cursor-nwse-resize"
            style={{
              left: isLeft ? offset : undefined,
              right: !isLeft ? offset : undefined,
              top: isTop ? offset : undefined,
              bottom: !isTop ? offset : undefined,
              width: sizePx,
              height: sizePx,
              cursor:
                h === 'tl' || h === 'br' ? 'nwse-resize' : 'nesw-resize',
              touchAction: 'none',
            }}
          />
        );
      })}
    </div>
  );
}
