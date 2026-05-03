'use client';

import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation } from 'convex/react';
import { ChevronLeft } from 'lucide-react';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import { PageCropOverlay } from '@/components/settings/page-crop-overlay';
import {
  PastPaperStructuredHeader,
  type ResolvedPart,
} from '@/components/settings/past-paper-structured-header';
import { PastPaperTagPicker } from '@/components/settings/past-paper-tag-picker';
import { ZoomedPageView } from '@/components/settings/zoomed-page-view';
import {
  CropToolToolbar,
  type CropTool,
} from '@/components/settings/crop-tool-toolbar';
import { toast } from 'sonner';

type CropBox = { x: number; y: number; w: number; h: number };

// PageCropOverlay and ZoomedPageView type their pageId as Id<'textbookPages'>.
// Past papers use Id<'pastPaperPages'>. We cast at call sites — the underlying
// Convex id string is identical at runtime.
type FakePageId = Id<'textbookPages'>;
function asPageId(id: Id<'pastPaperPages'>): FakePageId {
  return id as unknown as FakePageId;
}

type QBRow = { _id: Id<'questionBank'>; cropBox?: CropBox };

export default function PastPaperCropPage() {
  const params = useParams<{ paperId: string }>();
  const router = useRouter();
  const paperId = params.paperId as Id<'pastPapers'>;

  const [tool, setTool] = useState<CropTool>('crop');
  const [badgesInside, setBadgesInside] = useState(false);
  const [selectedPartCode, setSelectedPartCode] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [selectedCropId, setSelectedCropId] = useState<Id<'questionBank'> | null>(null);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [zoomState, setZoomState] = useState<{
    pageId: FakePageId;
    pageNumber: number;
    imageUrl: string;
    naturalAspect: number | null;
  } | null>(null);

  const lastTouchedCropIdRef = useRef<Id<'questionBank'> | null>(null);

  useEffect(() => {
    const onCtx = (e: Event) => e.preventDefault();
    document.addEventListener('contextmenu', onCtx);
    return () => document.removeEventListener('contextmenu', onCtx);
  }, []);

  const paper = useQuery(api.pastPapers.getById, { id: paperId });
  const paperPages = useQuery(api.pastPaperPages.getByPaper, { pastPaperId: paperId });
  const paperCrops = useQuery(api.questionBank.listByPaper, { pastPaperId: paperId });
  const resolved = useQuery(api.paperStructures.getResolvedForPaper, { paperId });
  const allTags = useQuery(api.topicTags.list);

  type PaperCrop = NonNullable<typeof paperCrops>[number];

  const cropsByPage = useMemo(() => {
    const map = new Map<string, PaperCrop[]>();
    if (!paperCrops) return map;
    for (const c of paperCrops) {
      if (!c.pastPaperPageId) continue;
      const arr = map.get(c.pastPaperPageId) || [];
      arr.push(c);
      map.set(c.pastPaperPageId, arr);
    }
    return map;
  }, [paperCrops]);

  // Resolved structure pieces for the header
  const parts = useMemo<ResolvedPart[]>(
    () => resolved?.parts ?? [],
    [resolved],
  );
  const partByCode = useMemo(() => {
    const m = new Map<string, ResolvedPart>();
    for (const p of parts) m.set(p.partCode, p);
    return m;
  }, [parts]);
  const partById = useMemo(() => {
    const m = new Map<string, ResolvedPart>();
    for (const p of parts) m.set(p._id, p);
    return m;
  }, [parts]);

  // Default-select the first part if the user hasn't explicitly picked one.
  // Derived rather than stored, to avoid setState-in-effect cascades.
  const effectivePartCode = selectedPartCode ?? parts[0]?.partCode ?? null;

  // Map `${partCode}:${slotNumber}` → cropId for filled slots; ignores
  // legacy crops with no structured slot fields.
  const cropsBySlotKey = useMemo(() => {
    const m = new Map<string, Id<'questionBank'>>();
    if (!paperCrops) return m;
    for (const c of paperCrops) {
      if (!c.paperStructurePartId || c.paperStructureSlotNumber == null) continue;
      const part = partById.get(c.paperStructurePartId);
      if (!part) continue;
      m.set(`${part.partCode}:${c.paperStructureSlotNumber}`, c._id);
    }
    return m;
  }, [paperCrops, partById]);

  // Map slotKey → permanent tag id
  const permanentTagBySlot = useMemo(() => {
    const m = new Map<string, Id<'examTopicTags'>>();
    const slotTags = resolved?.slotTags ?? [];
    for (const s of slotTags) {
      if (s.mode !== 'permanent') continue;
      const part = partById.get(s.partId);
      if (!part) continue;
      m.set(`${part.partCode}:${s.slotNumber}`, s.tagId);
    }
    return m;
  }, [resolved, partById]);

  // Map slotKey → option tag ids
  const optionTagsBySlot = useMemo(() => {
    const m = new Map<string, Id<'examTopicTags'>[]>();
    const slotTags = resolved?.slotTags ?? [];
    for (const s of slotTags) {
      if (s.mode !== 'option') continue;
      const part = partById.get(s.partId);
      if (!part) continue;
      const k = `${part.partCode}:${s.slotNumber}`;
      const arr = m.get(k) ?? [];
      arr.push(s.tagId);
      m.set(k, arr);
    }
    return m;
  }, [resolved, partById]);

  const tagById = useMemo(() => {
    const m = new Map<string, NonNullable<typeof allTags>[number]>();
    for (const t of allTags ?? []) m.set(t._id, t);
    return m;
  }, [allTags]);

  // Active crop (the one we'd patch with tag/concept changes) — selectedCropId
  // takes precedence; otherwise the crop at the active slot if any.
  const activeCropId = useMemo<Id<'questionBank'> | null>(() => {
    if (selectedCropId) return selectedCropId;
    if (effectivePartCode && selectedSlot != null) {
      return cropsBySlotKey.get(`${effectivePartCode}:${selectedSlot}`) ?? null;
    }
    return null;
  }, [selectedCropId, effectivePartCode, selectedSlot, cropsBySlotKey]);

  const activeCrop = useMemo<PaperCrop | null>(() => {
    if (!activeCropId || !paperCrops) return null;
    return paperCrops.find((c) => c._id === activeCropId) ?? null;
  }, [activeCropId, paperCrops]);

  // Concept count for the chip — pulled lazily.
  const activeCropConcepts = useQuery(
    api.questionBank.listConcepts,
    activeCropId ? { questionId: activeCropId } : 'skip',
  );
  const activeConceptCount = activeCropConcepts?.length ?? 0;

  const upsertSlotMut = useMutation(api.questionBank.upsertForPaperSlot);
  const rekeySlotMut = useMutation(api.questionBank.rekeyToPaperSlot);
  const updateMut = useMutation(api.questionBank.update);
  const removeMut = useMutation(api.questionBank.remove);

  const handlePickPart = useCallback((code: string) => {
    setSelectedPartCode(code);
    setSelectedSlot(null);
    setSelectedCropId(null);
  }, []);

  // Find the next empty slot in the active part, starting after `from`.
  const advanceToNextEmptySlot = useCallback(
    (partCode: string, from: number) => {
      const part = partByCode.get(partCode);
      if (!part) return;
      for (let s = from + 1; s <= part.questionCount; s++) {
        if (!cropsBySlotKey.has(`${partCode}:${s}`)) {
          setSelectedSlot(s);
          return;
        }
      }
      // No more empty slots in this part — leave selection where it is.
    },
    [partByCode, cropsBySlotKey],
  );

  // Tap a slot: re-key if a crop is selected, else just switch active slot.
  const handlePickSlot = useCallback(
    async (partCode: string, slotNumber: number) => {
      const part = partByCode.get(partCode);
      if (!part) return;
      if (selectedCropId) {
        try {
          await rekeySlotMut({
            id: selectedCropId,
            pastPaperId: paperId,
            paperStructurePartId: part._id,
            paperStructureSlotNumber: slotNumber,
          });
          setSelectedCropId(null);
          setSelectedPartCode(partCode);
          setSelectedSlot(slotNumber);
          toast.success(`Re-keyed to ${partCode}.${slotNumber}`);
        } catch (err) {
          console.error('[rekeyToPaperSlot]', err);
          toast.error(`Re-key failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      } else {
        setSelectedPartCode(partCode);
        setSelectedSlot(slotNumber);
      }
    },
    [partByCode, selectedCropId, paperId, rekeySlotMut],
  );

  const handleDraw = useCallback(
    async (pageId: Id<'pastPaperPages'>, box: CropBox) => {
      if (!effectivePartCode || selectedSlot == null) {
        toast.error('Pick a slot first');
        return;
      }
      const part = partByCode.get(effectivePartCode);
      if (!part) {
        toast.error('Active part not found');
        return;
      }
      const slotKey = `${effectivePartCode}:${selectedSlot}`;
      // Permanent tag re-applies on every save — by spec, permanent always
      // wins. Users who want a different tag clear the slot's permanent in
      // the structure builder, or override per-crop after via the tag picker.
      const permanentTagId = permanentTagBySlot.get(slotKey);
      try {
        const id = await upsertSlotMut({
          pastPaperId: paperId,
          paperStructurePartId: part._id,
          paperStructureSlotNumber: selectedSlot,
          pastPaperPageId: pageId,
          cropBox: box,
          marksAvailable: part.marksPerQuestion,
          ...(permanentTagId ? { topicTagId: permanentTagId } : {}),
        });
        lastTouchedCropIdRef.current = id as Id<'questionBank'>;
        toast.success(`Saved ${effectivePartCode}.${selectedSlot}`);
        // Auto-advance to next empty slot in this part.
        advanceToNextEmptySlot(effectivePartCode, selectedSlot);
      } catch (err) {
        console.error('[upsertForPaperSlot]', err);
        toast.error(`Save failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    },
    [
      effectivePartCode,
      selectedSlot,
      partByCode,
      paperId,
      upsertSlotMut,
      permanentTagBySlot,
      advanceToNextEmptySlot,
    ],
  );

  const handleCropTap = useCallback(
    (cropId: Id<'questionBank'>) => {
      const c = (paperCrops || []).find((x) => x._id === cropId);
      if (!c) return;
      setSelectedCropId(cropId);
      lastTouchedCropIdRef.current = cropId;
      // If crop has structured identity, surface its slot.
      if (c.paperStructurePartId && c.paperStructureSlotNumber != null) {
        const part = partById.get(c.paperStructurePartId);
        if (part) {
          setSelectedPartCode(part.partCode);
          setSelectedSlot(c.paperStructureSlotNumber);
        }
      }
    },
    [paperCrops, partById],
  );

  const handleToolChange = useCallback(
    (next: CropTool) => {
      setTool(next);
      if (next === 'resize') {
        setSelectedCropId((cur) => {
          if (cur) return cur;
          const fallback = lastTouchedCropIdRef.current;
          if (!fallback) return null;
          const stillExists = (paperCrops || []).some((c) => c._id === fallback);
          return stillExists ? fallback : null;
        });
      } else if (next === 'crop') {
        setSelectedCropId(null);
      }
    },
    [paperCrops],
  );

  const handleCropDelete = useCallback(
    async (cropId: Id<'questionBank'>) => {
      try {
        await removeMut({ id: cropId });
        setSelectedCropId((cur) => (cur === cropId ? null : cur));
        if (lastTouchedCropIdRef.current === cropId) {
          lastTouchedCropIdRef.current = null;
        }
      } catch (err) {
        console.error(err);
        toast.error('Could not delete');
      }
    },
    [removeMut],
  );

  const cropLabelFor = useCallback(
    (c: QBRow) =>
      (c as QBRow & { questionNumberInPaper?: string }).questionNumberInPaper ||
      'untagged',
    [],
  );

  // Scroll persistence
  const scrollKey = `pp-crop.scroll.${paperId}`;
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let pending = false;
    const onScroll = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        try {
          window.sessionStorage.setItem(scrollKey, String(window.scrollY));
        } catch { /* quota */ }
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [scrollKey]);

  const didRestoreScroll = useRef(false);
  useEffect(() => {
    if (didRestoreScroll.current) return;
    if (!paperPages || paperPages.length === 0) return;
    if (typeof window === 'undefined') return;
    const raw = window.sessionStorage.getItem(scrollKey);
    if (!raw) { didRestoreScroll.current = true; return; }
    const y = parseInt(raw, 10);
    if (isNaN(y)) { didRestoreScroll.current = true; return; }
    didRestoreScroll.current = true;
    requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)));
  }, [paperPages, scrollKey]);

  // Render header — extracted as a function so we can mount it in both the
  // sticky page header and inside ZoomedPageView's pill-header slot.
  const renderHeader = () => {
    return (
      <PastPaperStructuredHeader
        parts={parts}
        selectedPartCode={effectivePartCode}
        selectedSlot={selectedSlot}
        selectedCropId={selectedCropId}
        cropsBySlotKey={cropsBySlotKey}
        permanentTagBySlot={permanentTagBySlot}
        tagById={tagById}
        activeTopicTagId={
          (activeCrop?.topicTagId as Id<'examTopicTags'> | undefined) ?? null
        }
        conceptCount={activeConceptCount}
        onPickPart={handlePickPart}
        onPickSlot={handlePickSlot}
        onCancelSelection={() => setSelectedCropId(null)}
        onOpenTagPicker={() => {
          if (!activeCropId) {
            toast.error('No crop yet for this slot');
            return;
          }
          setTagPickerOpen(true);
        }}
      />
    );
  };

  // ── Render ───────────────────────────────────────────────
  if (paper === null) {
    return (
      <div className="px-4 pt-5 pb-6 max-w-lg mx-auto">
        <p className="text-sm text-muted-foreground">Paper not found.</p>
      </div>
    );
  }

  const isLoading =
    paper === undefined || paperPages === undefined || resolved === undefined;

  const paperLabel = paper
    ? `${paper.schoolName ? `${paper.schoolName} · ` : ''}Term ${paper.term} ${paper.year} (Gr ${paper.grade})`
    : '';

  const slotKey =
    effectivePartCode && selectedSlot != null
      ? `${effectivePartCode}:${selectedSlot}`
      : null;
  const optionTagIdsForActive = slotKey
    ? optionTagsBySlot.get(slotKey) ?? []
    : [];
  const permanentTagIdForActive = slotKey
    ? permanentTagBySlot.get(slotKey) ?? null
    : null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Sticky header */}
      <div className="sticky top-0 z-40 bg-background border-b border-border/50">
        <div className="max-w-lg mx-auto px-3 py-2.5 flex items-center gap-2">
          <button
            onClick={() => router.back()}
            className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-muted transition-colors shrink-0"
            aria-label="Back"
          >
            <ChevronLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {paperLabel || 'Past Paper'}
            </p>
            {paper && (
              <p className="text-[11px] text-muted-foreground">
                {paper.totalPages} pages
                {paper.totalMarks != null && ` · ${paper.totalMarks} marks`}
              </p>
            )}
          </div>
        </div>

        <div className="max-w-lg mx-auto px-3 pb-2 flex justify-center">
          <CropToolToolbar
            tool={tool}
            onChange={handleToolChange}
            disabled={isLoading}
            badgesInside={badgesInside}
            onToggleBadgesInside={() => setBadgesInside((b) => !b)}
          />
        </div>

        {renderHeader()}
      </div>

      {/* Body */}
      <div className="flex-1 max-w-lg mx-auto w-full px-3 py-3">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="w-full aspect-[3/4] bg-muted rounded-lg animate-pulse" />
            ))}
          </div>
        ) : paperPages!.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">
            No pages uploaded yet. Upload pages from Content → Past Papers first.
          </p>
        ) : (
          <div className="space-y-3">
            {paperPages!
              .slice()
              .sort((a, b) => a.pageNumber - b.pageNumber)
              .map((pg) => (
                <PaperPageRow
                  key={pg._id}
                  pg={pg}
                  paperId={paperId}
                  tool={tool}
                  cropsByPage={cropsByPage}
                  selectedCropId={selectedCropId}
                  cropLabelFor={cropLabelFor}
                  badgesInside={badgesInside}
                  onDraw={handleDraw}
                  onCropTap={handleCropTap}
                  onZoom={(fakeId, pageNumber, imageUrl, na) =>
                    setZoomState({ pageId: fakeId, pageNumber, imageUrl, naturalAspect: na })
                  }
                />
              ))}
          </div>
        )}
      </div>

      {zoomState && (
        <ZoomedPageView
          pageId={zoomState.pageId}
          pageNumber={zoomState.pageNumber}
          imageUrl={zoomState.imageUrl}
          naturalAspect={zoomState.naturalAspect ?? undefined}
          crops={(cropsByPage.get(zoomState.pageId as unknown as string) || []) as QBRow[]}
          cropLabelFor={cropLabelFor}
          selectedCropId={selectedCropId}
          flashCropId={null}
          tool={tool}
          badgesInside={badgesInside}
          onToggleBadgesInside={() => setBadgesInside((b) => !b)}
          onToolChange={handleToolChange}
          onClose={() => setZoomState(null)}
          onDrawComplete={(box) => {
            const realId = zoomState.pageId as unknown as Id<'pastPaperPages'>;
            handleDraw(realId, box);
          }}
          onCropTap={handleCropTap}
          onCropResize={async (cropId, box) => {
            try {
              await updateMut({ id: cropId, cropBox: box });
            } catch (err) {
              console.error(err);
              toast.error('Could not resize');
            }
          }}
          onCropDelete={handleCropDelete}
          pillHeader={renderHeader()}
        />
      )}

      {/* Tag + concept picker bottom sheet */}
      <PastPaperTagPicker
        open={tagPickerOpen}
        onClose={() => setTagPickerOpen(false)}
        cropId={activeCropId}
        currentTopicTagId={
          (activeCrop?.topicTagId as Id<'examTopicTags'> | undefined) ?? null
        }
        permanentTagId={permanentTagIdForActive}
        optionTagIds={optionTagIdsForActive}
        allTags={allTags ?? []}
      />
    </div>
  );
}

// Per-page row that resolves its image URL via getPageImage so we don't need
// to add URL hydration to getByPaper (which returns raw DB rows).
function PaperPageRow({
  pg,
  paperId,
  tool,
  cropsByPage,
  selectedCropId,
  cropLabelFor,
  badgesInside,
  onDraw,
  onCropTap,
  onZoom,
}: {
  pg: { _id: Id<'pastPaperPages'>; pageNumber: number };
  paperId: Id<'pastPapers'>;
  tool: CropTool;
  cropsByPage: Map<string, QBRow[]>;
  selectedCropId: Id<'questionBank'> | null;
  cropLabelFor: (c: QBRow) => string;
  badgesInside: boolean;
  onDraw: (pageId: Id<'pastPaperPages'>, box: CropBox) => void;
  onCropTap: (cropId: Id<'questionBank'>) => void;
  onZoom: (fakeId: FakePageId, pageNumber: number, imageUrl: string, naturalAspect: number | null) => void;
}) {
  const imageUrl = useQuery(api.pastPaperPages.getPageImage, {
    pastPaperId: paperId,
    pageNumber: pg.pageNumber,
  });
  const fakePageId = asPageId(pg._id);
  const crops = cropsByPage.get(pg._id) || [];

  return (
    <PageCropOverlay
      pageId={fakePageId}
      pageNumber={pg.pageNumber}
      imageUrl={imageUrl ?? null}
      tool={tool}
      crops={crops}
      unitExercises={[]}
      onDrawComplete={(box) => onDraw(pg._id, box)}
      onCropTap={onCropTap}
      selectedCropId={selectedCropId}
      cropLabelFor={cropLabelFor}
      flashCropId={null}
      badgesInside={badgesInside}
      onZoom={
        imageUrl
          ? (id, na) => onZoom(id, pg.pageNumber, imageUrl, na)
          : undefined
      }
    />
  );
}
