'use client';

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { X, Maximize2 } from 'lucide-react';
import type { Id } from '@/lib/convex';
import { CropToolToolbar, type CropTool } from './crop-tool-toolbar';

type CropBox = { x: number; y: number; w: number; h: number };

type QuestionBankRow = {
  _id: Id<'questionBank'>;
  textbookPageId?: Id<'textbookPages'>;
  cropBox?: CropBox;
  linkedExerciseId?: Id<'exercises'>;
  linkedQuestionKey?: string;
};

interface Props {
  pageId: Id<'textbookPages'>;
  pageNumber: number;
  imageUrl: string;
  naturalAspect?: number; // width / height — loaded internally if omitted
  crops: QuestionBankRow[];
  cropLabelFor?: (crop: QuestionBankRow) => string;
  selectedCropId?: Id<'questionBank'> | null;
  flashCropId?: Id<'questionBank'> | null;
  // Active tool from the parent's shared toolbar. Each value works
  // independently:
  //   crop   → 1-finger draws a new crop rect.
  //   resize → tap rects to select; corner handles resize the selected one.
  //   delete → red X on every rect; tap an X to delete.
  //   all    → 2-finger pinch / pan adjusts the page view.
  tool: CropTool;
  onToolChange: (t: CropTool) => void;
  onClose: () => void;
  onDrawComplete?: (box: CropBox) => void;
  onCropTap?: (cropId: Id<'questionBank'>) => void;
  // Called on drag-release of a resize handle on the selected crop.
  onCropResize?: (cropId: Id<'questionBank'>, box: CropBox) => void;
  // Called when the user taps the red X on a crop while in Delete mode.
  onCropDelete?: (cropId: Id<'questionBank'>) => void;
  // Optional pill header rendered below the toolbar (fast-mode only).
  pillHeader?: React.ReactNode;
  badgesInside?: boolean;
  onToggleBadgesInside?: () => void;
}

const MIN_CROP_SIZE = 0.01; // 1% — generous threshold so very small Qs crop
const MAX_SCALE = 8;
const MIN_SCALE = 1;

// Full-screen page viewer with pinch-zoom + pan. Behaviour is dictated by
// the `tool` prop (the same 4-mode toolbar the parent renders for the
// inline view), so a single source of truth controls both surfaces:
//   crop    → 1-finger draws in normalised image space.
//   resize  → tap a rect to select; corner handles resize.
//   delete  → tap a rect's red X to delete.
// 2-finger pinch always works regardless of tool.
export function ZoomedPageView({
  pageId,
  pageNumber,
  imageUrl,
  naturalAspect: naturalAspectProp,
  crops,
  cropLabelFor,
  selectedCropId,
  flashCropId,
  tool,
  onToolChange,
  onClose,
  onDrawComplete,
  onCropTap,
  onCropResize,
  onCropDelete,
  pillHeader,
  badgesInside,
  onToggleBadgesInside,
}: Props) {
  const canCrop = !!onDrawComplete;
  // Convenience flags from the active tool. The pan-default catches every
  // tool that isn't "crop" — drawing requires a dedicated 1-finger gesture,
  // everything else lets the user navigate the zoomed image freely.
  const drawMode = tool === 'crop';

  // Load natural aspect if not provided.
  const [loadedAspect, setLoadedAspect] = useState<number | null>(null);
  const naturalAspect = naturalAspectProp ?? loadedAspect ?? 3 / 4;

  // Container = the body area that receives gestures. baseRect = the image
  // rect at scale=1, fitted (object-contain style) inside the container.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  // Measure container after mount and on resize.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Base image rect at scale=1: object-contain inside container.
  const baseRect = (() => {
    const { w, h } = containerSize;
    if (w === 0 || h === 0) return { left: 0, top: 0, width: 0, height: 0 };
    const containerAspect = w / h;
    if (containerAspect > naturalAspect) {
      // container wider than image — match height
      const height = h;
      const width = h * naturalAspect;
      return { left: (w - width) / 2, top: 0, width, height };
    } else {
      const width = w;
      const height = w / naturalAspect;
      return { left: 0, top: (h - height) / 2, width, height };
    }
  })();

  // Transform state: applied to the image div with origin at top-left of
  // the image's base position.
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);

  // Mirror the transform into a ref so gesture handlers can snapshot the
  // *current* transform without forcing the listener-attaching effect to
  // re-run on every tx/ty/scale change.
  const transformRef = useRef({ scale: 1, tx: 0, ty: 0 });
  useEffect(() => {
    transformRef.current = { scale, tx, ty };
  }, [scale, tx, ty]);

  // Reset to fit-screen.
  const resetView = useCallback(() => {
    setScale(1);
    setTx(0);
    setTy(0);
  }, []);

  // ─── Gesture state ────────────────────────────────────────────
  // Held in a ref so re-renders mid-gesture (state updates from within the
  // listener) don't reset it.
  type Gesture =
    | null
    | {
        type: 'pan';
        startContainerX: number;
        startContainerY: number;
        startTx: number;
        startTy: number;
      }
    | {
        type: 'pinch';
        startDist: number;
        startCenterX: number;
        startCenterY: number;
        startScale: number;
        startTx: number;
        startTy: number;
      }
    | {
        // Crop drag in normalised image coordinates (0..1).
        type: 'crop';
        startNX: number;
        startNY: number;
      };
  const gestureRef = useRef<Gesture>(null);

  const [cropPreview, setCropPreview] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  // ─── Coordinate conversions ──────────────────────────────────
  // screenToNorm: a screen point (relative to container) → normalised image
  // coordinates (0..1) for cropBox storage. Uses the *current* transform.
  const screenToNormRef = useRef<((sx: number, sy: number) => { x: number; y: number } | null) | null>(null);
  useEffect(() => {
    screenToNormRef.current = (sx, sy) => {
      if (baseRect.width === 0 || baseRect.height === 0) return null;
      const lx = (sx - baseRect.left - tx) / scale;
      const ly = (sy - baseRect.top - ty) / scale;
      const x = lx / baseRect.width;
      const y = ly / baseRect.height;
      return {
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y)),
      };
    };
  }, [baseRect.left, baseRect.top, baseRect.width, baseRect.height, tx, ty, scale]);

  // ─── Native touch listeners ───────────────────────────────────
  // Same rationale as PageCropOverlay: native + passive:false so iOS lets
  // us preventDefault and we don't lose touches to native scroll/pinch.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const rectOf = () => el.getBoundingClientRect();

    const distance = (a: Touch, b: Touch) =>
      Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

    const onTouchStart = (e: TouchEvent) => {
      // Resize handles inside selected crops are descendants of this
      // container; native ancestor listeners fire during bubble *before*
      // React's delegated stopPropagation can run, so without this bail-out
      // a handle tap would also start a pan/crop gesture on the page.
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-resize-handle]')) return;
      if (drawMode && target?.closest('[data-crop-rect]')) return;
      const r = rectOf();
      const tr = transformRef.current;
      if (e.touches.length === 2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const cx = (t1.clientX + t2.clientX) / 2 - r.left;
        const cy = (t1.clientY + t2.clientY) / 2 - r.top;
        gestureRef.current = {
          type: 'pinch',
          startDist: distance(t1, t2),
          startCenterX: cx,
          startCenterY: cy,
          startScale: tr.scale,
          startTx: tr.tx,
          startTy: tr.ty,
        };
        // Drawing a crop with 1 finger then adding a 2nd finger should
        // abandon the crop draft, not save a tiny one.
        setCropPreview(null);
        e.preventDefault();
        return;
      }
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const sx = t.clientX - r.left;
      const sy = t.clientY - r.top;
      if (drawMode && canCrop) {
        const norm = screenToNormRef.current?.(sx, sy);
        if (!norm) return;
        gestureRef.current = {
          type: 'crop',
          startNX: norm.x,
          startNY: norm.y,
        };
        setCropPreview({ x: norm.x, y: norm.y, w: 0, h: 0 });
      } else {
        gestureRef.current = {
          type: 'pan',
          startContainerX: sx,
          startContainerY: sy,
          startTx: tr.tx,
          startTy: tr.ty,
        };
      }
      e.preventDefault();
    };

    const onTouchMove = (e: TouchEvent) => {
      const g = gestureRef.current;
      if (!g) return;
      const r = rectOf();
      if (g.type === 'pinch' && e.touches.length === 2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const newDist = distance(t1, t2);
        if (newDist === 0) return;
        const cx = (t1.clientX + t2.clientX) / 2 - r.left;
        const cy = (t1.clientY + t2.clientY) / 2 - r.top;
        const ratio = newDist / g.startDist;
        let newScale = g.startScale * ratio;
        newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
        // Keep the world point that was under the start-center under the
        // current center, accounting for the actual (clamped) scale.
        const k = newScale / g.startScale;
        const newTx = cx - (g.startCenterX - g.startTx) * k;
        const newTy = cy - (g.startCenterY - g.startTy) * k;
        setScale(newScale);
        setTx(newTx);
        setTy(newTy);
        e.preventDefault();
        return;
      }
      if (g.type === 'pan' && e.touches.length === 1) {
        const t = e.touches[0];
        const sx = t.clientX - r.left;
        const sy = t.clientY - r.top;
        setTx(g.startTx + (sx - g.startContainerX));
        setTy(g.startTy + (sy - g.startContainerY));
        e.preventDefault();
        return;
      }
      if (g.type === 'crop' && e.touches.length === 1) {
        const t = e.touches[0];
        const sx = t.clientX - r.left;
        const sy = t.clientY - r.top;
        const norm = screenToNormRef.current?.(sx, sy);
        if (!norm) return;
        setCropPreview({
          x: Math.min(g.startNX, norm.x),
          y: Math.min(g.startNY, norm.y),
          w: Math.abs(norm.x - g.startNX),
          h: Math.abs(norm.y - g.startNY),
        });
        e.preventDefault();
        return;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      const g = gestureRef.current;
      if (!g) return;
      // Pinch ending while one finger remains: convert to a pan of the
      // remaining finger. Avoids a jump when releasing one of two fingers.
      if (g.type === 'pinch' && e.touches.length === 1) {
        const t = e.touches[0];
        const r = rectOf();
        // Use the live transform (via ref) so the new pan starts from
        // wherever the pinch most recently put us, not from the value tx/ty
        // had when this listener last attached.
        gestureRef.current = {
          type: 'pan',
          startContainerX: t.clientX - r.left,
          startContainerY: t.clientY - r.top,
          startTx: transformRef.current.tx,
          startTy: transformRef.current.ty,
        };
        return;
      }
      if (e.touches.length > 0) return;
      // All fingers up — finalise gesture.
      if (g.type === 'crop') {
        const p = cropPreview;
        gestureRef.current = null;
        setCropPreview(null);
        if (p && p.w >= MIN_CROP_SIZE && p.h >= MIN_CROP_SIZE && onDrawComplete) {
          onDrawComplete({ x: p.x, y: p.y, w: p.w, h: p.h });
        }
        e.preventDefault();
        return;
      }
      gestureRef.current = null;
      e.preventDefault();
    };

    const onTouchCancel = () => {
      gestureRef.current = null;
      setCropPreview(null);
    };

    const onContextMenu = (e: Event) => e.preventDefault();

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: false });
    el.addEventListener('touchcancel', onTouchCancel);
    el.addEventListener('contextmenu', onContextMenu);

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchCancel);
      el.removeEventListener('contextmenu', onContextMenu);
    };
  }, [drawMode, canCrop, onDrawComplete, cropPreview]);

  // ─── Mouse fallback (desktop) ─────────────────────────────────
  // Wheel zoom; click+drag draws crop in crop mode and pans otherwise.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const cx = e.clientX - r.left;
      const cy = e.clientY - r.top;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale * factor));
      const k = newScale / scale;
      setScale(newScale);
      setTx(cx - (cx - tx) * k);
      setTy(cy - (cy - ty) * k);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scale, tx, ty]);

  // Mouse drag state held in a ref so re-renders during a drag (which fire
  // continuously as cropPreview / tx / ty update) don't reset it. Without
  // this, the effect cleanup would null out a local `mouseStart` mid-drag
  // and the mouseup handler would see no gesture in flight.
  const mouseStartRef = useRef<{
    type: 'pan' | 'crop';
    sx: number;
    sy: number;
    startTx: number;
    startTy: number;
    startNX?: number;
    startNY?: number;
  } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      // Same ancestor-listener bail-out as the touch path.
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-resize-handle]')) return;
      if (drawMode && target?.closest('[data-crop-rect]')) return;
      const r = el.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      if (drawMode && canCrop) {
        const norm = screenToNormRef.current?.(sx, sy);
        if (!norm) return;
        mouseStartRef.current = {
          type: 'crop',
          sx,
          sy,
          startTx: tx,
          startTy: ty,
          startNX: norm.x,
          startNY: norm.y,
        };
        setCropPreview({ x: norm.x, y: norm.y, w: 0, h: 0 });
      } else {
        mouseStartRef.current = {
          type: 'pan',
          sx,
          sy,
          startTx: tx,
          startTy: ty,
        };
      }
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      e.preventDefault();
    };
    const onMouseMove = (e: MouseEvent) => {
      const start = mouseStartRef.current;
      if (!start) return;
      const r = el.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      if (start.type === 'pan') {
        setTx(start.startTx + (sx - start.sx));
        setTy(start.startTy + (sy - start.sy));
      } else if (
        start.type === 'crop' &&
        start.startNX != null &&
        start.startNY != null
      ) {
        const norm = screenToNormRef.current?.(sx, sy);
        if (!norm) return;
        setCropPreview({
          x: Math.min(start.startNX, norm.x),
          y: Math.min(start.startNY, norm.y),
          w: Math.abs(norm.x - start.startNX),
          h: Math.abs(norm.y - start.startNY),
        });
      }
    };
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      const start = mouseStartRef.current;
      mouseStartRef.current = null;
      if (start?.type === 'crop') {
        const p = cropPreview;
        setCropPreview(null);
        if (p && p.w >= MIN_CROP_SIZE && p.h >= MIN_CROP_SIZE && onDrawComplete) {
          onDrawComplete({ x: p.x, y: p.y, w: p.w, h: p.h });
        }
      }
    };
    el.addEventListener('mousedown', onMouseDown);
    return () => {
      el.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [drawMode, canCrop, tx, ty, onDrawComplete, cropPreview]);

  // ─── Body scroll lock while open ──────────────────────────────
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // ─── ESC key closes ───────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Hidden preloader to learn the natural image aspect ratio if the
          parent didn't supply it. */}
      {naturalAspectProp == null && imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          aria-hidden
          onLoad={(e) => {
            const im = e.currentTarget;
            if (im.naturalWidth && im.naturalHeight) {
              setLoadedAspect(im.naturalWidth / im.naturalHeight);
            }
          }}
          style={{ display: 'none' }}
        />
      )}
      {/* Toolbar */}
      <div className="shrink-0 px-3 py-2.5 border-b border-border/50 bg-background flex items-center gap-2">
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-muted transition-colors shrink-0"
          aria-label="Close"
        >
          <X className="w-5 h-5 text-muted-foreground" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">
            Page {pageNumber}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {Math.round(scale * 100)}% · pinch to zoom
          </p>
        </div>
        <button
          onClick={resetView}
          className="h-9 px-2.5 rounded-lg text-xs font-medium hover:bg-muted transition-colors flex items-center gap-1.5 shrink-0"
          aria-label="Reset zoom"
        >
          <Maximize2 className="w-3.5 h-3.5" />
          Fit
        </button>
      </div>

      {/* Tool toolbar — same 4-mode selector the parent renders inline. We
          mirror it inside the zoom view so the user can swap tools without
          closing the modal. */}
      {canCrop && (
        <div className="shrink-0 px-3 py-2 border-b border-border/50 bg-background flex justify-center">
          <CropToolToolbar tool={tool} onChange={onToolChange} badgesInside={badgesInside} onToggleBadgesInside={onToggleBadgesInside} />
        </div>
      )}

      {/* Pill header (fast mode) */}
      {pillHeader && (
        <div className="shrink-0 border-b border-border/50 bg-background pt-2">
          {pillHeader}
        </div>
      )}

      {/* Image area — full bleed, gestures handled here */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden bg-black/30 select-none"
        style={{
          touchAction: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
          cursor:
            drawMode && canCrop
              ? 'crosshair'
              : scale > 1
                ? 'grab'
                : 'default',
        }}
      >
        {baseRect.width > 0 && (
          <div
            // The transformed image: positioned at baseRect, scaled+translated.
            className="absolute"
            style={{
              left: baseRect.left,
              top: baseRect.top,
              width: baseRect.width,
              height: baseRect.height,
              transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
              transformOrigin: '0 0',
              backgroundImage: `url("${imageUrl}")`,
              backgroundSize: '100% 100%',
              backgroundRepeat: 'no-repeat',
            }}
          >
            {/* Existing crops — percentage positioning means they zoom with
                the image automatically. */}
            {crops.map(
              (c) =>
                c.cropBox && (
                  <CropRectZ
                    key={c._id}
                    crop={c}
                    label={cropLabelFor ? cropLabelFor(c) : c.linkedQuestionKey ? c.linkedQuestionKey : 'unlinked'}
                    isSelected={selectedCropId === c._id}
                    isFlash={flashCropId === c._id}
                    invScale={1 / scale}
                    tool={tool}
                    screenToNormRef={screenToNormRef}
                    containerRef={containerRef}
                    onTap={() => onCropTap?.(c._id)}
                    onResize={
                      onCropResize
                        ? (box) => onCropResize(c._id, box)
                        : undefined
                    }
                    onDelete={
                      onCropDelete ? () => onCropDelete(c._id) : undefined
                    }
                    badgesInside={badgesInside}
                  />
                ),
            )}

            {/* In-progress crop preview */}
            {cropPreview && cropPreview.w >= 0.005 && cropPreview.h >= 0.005 && (
              <div
                className="absolute border-2 border-primary bg-primary/15 rounded-sm pointer-events-none"
                style={{
                  left: `${cropPreview.x * 100}%`,
                  top: `${cropPreview.y * 100}%`,
                  width: `${cropPreview.w * 100}%`,
                  height: `${cropPreview.h * 100}%`,
                  // Counter-scale border so it stays a sane width regardless
                  // of zoom level.
                  outlineWidth: 0,
                }}
              />
            )}
          </div>
        )}

        {/* Bottom hint removed — keep the zoom view chromeless. */}
      </div>

      {/* hidden — pageId unused in render but keeps type safe / for future */}
      <span data-page-id={pageId} hidden />
    </div>
  );
}

// ─── Crop rectangle inside the zoomed view ─────────────────────
// invScale is used to keep border / label visually constant size as the
// image scales up. CSS `border` does scale with `transform: scale()` on the
// parent, which makes lines too thick when zoomed in. We counter-scale.
function CropRectZ({
  crop,
  label,
  isSelected,
  isFlash,
  invScale,
  tool,
  screenToNormRef,
  containerRef,
  onTap,
  onResize,
  onDelete,
  badgesInside,
}: {
  crop: QuestionBankRow;
  label: string;
  isSelected: boolean;
  isFlash: boolean;
  invScale: number;
  tool: CropTool;
  screenToNormRef: React.RefObject<
    ((sx: number, sy: number) => { x: number; y: number } | null) | null
  >;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onTap: () => void;
  onResize?: (box: CropBox) => void;
  onDelete?: () => void;
  badgesInside?: boolean;
}) {
  const showHandles = tool === 'crop' && isSelected;
  const showDeleteX = tool === 'delete';
  const interactive = tool === 'crop' || tool === 'delete';
  const savedBox = crop.cropBox!;
  const savedKey = `${savedBox.x},${savedBox.y},${savedBox.w},${savedBox.h}`;
  const [override, setOverride] = useState<{ savedKey: string; box: CropBox } | null>(null);
  const localBox = override && override.savedKey === savedKey ? override.box : null;
  const b = localBox ?? savedBox;

  // ── Long-press move gesture ──
  const [isMoveMode, setIsMoveMode] = useState(false);
  const justMovedRef = useRef(false);
  const moveGestureRef = useRef<{
    timerId: ReturnType<typeof setTimeout> | null;
    startClientX: number;
    startClientY: number;
    startNX: number;
    startNY: number;
    startBox: CropBox;
    pid: number;
    active: boolean;
  } | null>(null);

  const isLinked = !!crop.linkedExerciseId;
  const baseColor = isMoveMode
    ? 'bg-violet-400/30'
    : isFlash
      ? 'bg-yellow-400/30'
      : isSelected
        ? 'bg-sky-400/20'
        : isLinked
          ? (badgesInside ? 'bg-emerald-500/40' : 'bg-emerald-500/10')
          : (badgesInside ? 'bg-amber-500/40' : 'bg-amber-500/10');
  const borderColor = isMoveMode
    ? '#a78bfa'
    : isFlash
      ? '#facc15'
      : isSelected
        ? '#38bdf8'
        : isLinked
          ? '#10b981'
          : '#f59e0b';

  const startResize = (handle: HandleKindZ) => {
    const container = containerRef.current;
    if (!container) return;
    const startBox = { ...b };
    const startSavedKey = savedKey;

    const computeBox = (cx: number, cy: number): CropBox => {
      const rect = container.getBoundingClientRect();
      const sx = cx - rect.left;
      const sy = cy - rect.top;
      const norm = screenToNormRef.current?.(sx, sy);
      if (!norm) return startBox;
      const right = startBox.x + startBox.w;
      const bottom = startBox.y + startBox.h;
      let { x, y, w, h } = startBox;
      if (handle === 'tl') {
        x = Math.min(norm.x, right - RESIZE_MIN_DIM);
        y = Math.min(norm.y, bottom - RESIZE_MIN_DIM);
        w = right - x;
        h = bottom - y;
      } else if (handle === 'tr') {
        const newRight = Math.max(norm.x, startBox.x + RESIZE_MIN_DIM);
        y = Math.min(norm.y, bottom - RESIZE_MIN_DIM);
        w = newRight - startBox.x;
        h = bottom - y;
      } else if (handle === 'bl') {
        x = Math.min(norm.x, right - RESIZE_MIN_DIM);
        const newBottom = Math.max(norm.y, startBox.y + RESIZE_MIN_DIM);
        w = right - x;
        h = newBottom - startBox.y;
      } else {
        const newRight = Math.max(norm.x, startBox.x + RESIZE_MIN_DIM);
        const newBottom = Math.max(norm.y, startBox.y + RESIZE_MIN_DIM);
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

  // Counter-scaled handle size — keeps a constant visual footprint at any
  // zoom level (the parent transform would otherwise scale these too).
  const handleScale = invScale;

  return (
    <div
      data-crop-rect="1"
      className={`absolute rounded-sm transition-colors ${baseColor} ${
        isFlash ? 'animate-pulse' : ''
      } ${isMoveMode ? 'cursor-grabbing' : ''}`}
      style={{
        left: `${b.x * 100}%`,
        top: `${b.y * 100}%`,
        width: `${b.w * 100}%`,
        height: `${b.h * 100}%`,
        outline: `${2 * invScale}px solid ${borderColor}`,
        outlineOffset: 0,
        pointerEvents: interactive ? 'auto' : 'none',
        touchAction: isMoveMode ? 'none' : undefined,
      }}
      onClick={(e) => {
        if (justMovedRef.current) { justMovedRef.current = false; return; }
        if (tool !== 'crop') return;
        e.stopPropagation();
        onTap();
      }}
      onPointerDown={(e) => {
        if (!interactive) return;
        e.stopPropagation();
        if (tool !== 'crop' || !onResize) return;
        const el = e.currentTarget;
        const startClientX = e.clientX;
        const startClientY = e.clientY;
        const startBox = { ...b };
        const pid = e.pointerId;
        const timerId = setTimeout(() => {
          const mg = moveGestureRef.current;
          if (!mg || mg.pid !== pid) return;
          // Compute start normalized position at long-press activation.
          const container = containerRef.current;
          if (!container) return;
          const rect = container.getBoundingClientRect();
          const startNorm = screenToNormRef.current?.(mg.startClientX - rect.left, mg.startClientY - rect.top);
          if (!startNorm) return;
          mg.timerId = null;
          mg.active = true;
          mg.startNX = startNorm.x;
          mg.startNY = startNorm.y;
          el.setPointerCapture(pid);
          setIsMoveMode(true);
        }, 450);
        moveGestureRef.current = { timerId, startClientX, startClientY, startNX: 0, startNY: 0, startBox, pid, active: false };
      }}
      onPointerMove={(e) => {
        const mg = moveGestureRef.current;
        if (!mg || mg.pid !== e.pointerId) return;
        if (!mg.active) {
          if (Math.abs(e.clientX - mg.startClientX) > 14 || Math.abs(e.clientY - mg.startClientY) > 14) {
            if (mg.timerId) clearTimeout(mg.timerId);
            moveGestureRef.current = null;
          }
          return;
        }
        e.preventDefault();
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const norm = screenToNormRef.current?.(e.clientX - rect.left, e.clientY - rect.top);
        if (!norm) return;
        const dx = norm.x - mg.startNX;
        const dy = norm.y - mg.startNY;
        const newX = Math.max(0, Math.min(1 - mg.startBox.w, mg.startBox.x + dx));
        const newY = Math.max(0, Math.min(1 - mg.startBox.h, mg.startBox.y + dy));
        setOverride({ savedKey, box: { ...mg.startBox, x: newX, y: newY } });
      }}
      onPointerUp={(e) => {
        const mg = moveGestureRef.current;
        if (!mg || mg.pid !== e.pointerId) return;
        if (mg.timerId) clearTimeout(mg.timerId);
        const wasActive = mg.active;
        moveGestureRef.current = null;
        setIsMoveMode(false);
        if (wasActive) {
          justMovedRef.current = true;
          if (localBox && onResize) void onResize(localBox);
        }
      }}
      onPointerCancel={(e) => {
        const mg = moveGestureRef.current;
        if (!mg || mg.pid !== e.pointerId) return;
        if (mg.timerId) clearTimeout(mg.timerId);
        moveGestureRef.current = null;
        setIsMoveMode(false);
      }}
    >
      {/* Centered question number — zooms with the rect, no counter-scaling */}
      {badgesInside && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
          <span
            className="text-white font-bold leading-none"
            style={{
              fontSize: 9,
              textShadow: '0 1px 3px rgba(0,0,0,0.85)',
            }}
          >
            {label}
          </span>
        </div>
      )}

      {/* Delete X (only in Delete mode). Counter-scaled so the visual
          target stays roughly 22 CSS px regardless of zoom. The tag is
          marked data-resize-handle so the container's gesture-bail-out
          treats it like a handle — tapping the X must not start a pan. */}
      {showDeleteX && onDelete && (
        <button
          data-resize-handle="1"
          aria-label="Delete crop"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          onTouchStart={(e) => e.stopPropagation()}
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          className="absolute rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow-md ring-2 ring-background"
          style={{
            // 22 CSS-px target counter-scaled to fight the parent transform.
            width: 22 * invScale,
            height: 22 * invScale,
            top: -11 * invScale,
            right: -11 * invScale,
            touchAction: 'none',
          }}
        >
          <X
            style={{
              width: 14 * invScale,
              height: 14 * invScale,
            }}
          />
        </button>
      )}

      {/* Resize handles — small visible dot wrapped in a much larger touch
          target so even tiny crops are easy to grab. Counter-scaled with
          the page's pinch zoom so handles stay roughly constant on screen. */}
      {showHandles &&
        onResize &&
        HANDLE_KINDS_Z.map((h) => {
          const isTop = h === 'tl' || h === 'tr';
          const isLeft = h === 'tl' || h === 'bl';
          const visualPx = 12 * handleScale;
          const touchPx = 28 * handleScale;
          const offset = -touchPx / 2;
          return (
            <div
              key={h}
              role="button"
              aria-label={`Resize ${h}`}
              data-resize-handle="1"
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                startResize(h);
              }}
              onTouchStart={(e) => {
                e.stopPropagation();
                startResize(h);
              }}
              className="absolute flex items-center justify-center"
              style={{
                left: isLeft ? offset : undefined,
                right: !isLeft ? offset : undefined,
                top: isTop ? offset : undefined,
                bottom: !isTop ? offset : undefined,
                width: touchPx,
                height: touchPx,
                cursor: h === 'tl' || h === 'br' ? 'nwse-resize' : 'nesw-resize',
                touchAction: 'none',
              }}
            >
              <div
                className="bg-sky-400 border border-white shadow-sm rounded-sm pointer-events-none"
                style={{ width: visualPx, height: visualPx }}
              />
            </div>
          );
        })}
    </div>
  );
}

const HANDLE_KINDS_Z = ['tl', 'tr', 'bl', 'br'] as const;
type HandleKindZ = (typeof HANDLE_KINDS_Z)[number];
const RESIZE_MIN_DIM = 0.02;
