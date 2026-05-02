'use client';

import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation } from 'convex/react';
import { ChevronLeft } from 'lucide-react';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import { PageCropOverlay } from '@/components/settings/page-crop-overlay';
import { PastPaperPillHeader } from '@/components/settings/past-paper-pill-header';
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

// cropLabelFor callbacks must accept the QuestionBankRow type defined locally
// inside PageCropOverlay / ZoomedPageView. That type has no questionNumberInPaper
// field, but the actual Convex objects passed at runtime do. We use `unknown`
// here and cast inside the body so the signature is compatible.
type QBRow = { _id: Id<'questionBank'>; cropBox?: CropBox };

export default function PastPaperCropPage() {
  const params = useParams<{ paperId: string }>();
  const router = useRouter();
  const paperId = params.paperId as Id<'pastPapers'>;

  const [tool, setTool] = useState<CropTool>('crop');
  const [questionNumber, setQuestionNumber] = useState('');
  const [selectedCropId, setSelectedCropId] = useState<Id<'questionBank'> | null>(null);
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

  type PaperCrop = NonNullable<typeof paperCrops>[number];

  // Map pageId → crops for that page
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

  // Already-cropped question numbers for the pill chips
  const existingNumbers = useMemo(
    () =>
      Array.from(
        new Set(
          (paperCrops || [])
            .map((c) => c.questionNumberInPaper)
            .filter((n): n is string => !!n),
        ),
      ).sort(),
    [paperCrops],
  );

  const upsertMut = useMutation(api.questionBank.upsertForPaperQuestion);
  const rekeyMut = useMutation(api.questionBank.rekeyToPaperQuestion);
  const updateMut = useMutation(api.questionBank.update);
  const removeMut = useMutation(api.questionBank.remove);

  const handleDraw = useCallback(
    async (pageId: Id<'pastPaperPages'>, box: CropBox) => {
      const qn = questionNumber.trim();
      if (!qn) {
        toast.error('Enter a question number first');
        return;
      }
      try {
        const id = await upsertMut({
          pastPaperId: paperId,
          questionNumberInPaper: qn,
          pastPaperPageId: pageId,
          cropBox: box,
        });
        lastTouchedCropIdRef.current = id as Id<'questionBank'>;
        setSelectedCropId(null);
      } catch (err) {
        console.error('[upsertForPaperQuestion]', err);
        toast.error(`Save failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    },
    [questionNumber, paperId, upsertMut],
  );

  const handleCropTap = useCallback(
    (cropId: Id<'questionBank'>) => {
      const c = (paperCrops || []).find((x) => x._id === cropId);
      if (!c) return;
      setSelectedCropId(cropId);
      lastTouchedCropIdRef.current = cropId;
      if (c.questionNumberInPaper) setQuestionNumber(c.questionNumberInPaper);
    },
    [paperCrops],
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

  // Tapping a chip: if a crop is selected, re-key it; otherwise switch active number
  const handlePickNumber = useCallback(
    async (n: string) => {
      if (selectedCropId) {
        try {
          await rekeyMut({
            id: selectedCropId,
            pastPaperId: paperId,
            questionNumberInPaper: n,
          });
          setSelectedCropId(null);
          setQuestionNumber(n);
        } catch (err) {
          console.error('[rekeyToPaperQuestion]', err);
          toast.error(`Re-key failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      } else {
        setQuestionNumber(n);
      }
    },
    [selectedCropId, paperId, rekeyMut],
  );

  // The component's cropLabelFor must be typed as (c: QBRow) => string to
  // satisfy PageCropOverlay / ZoomedPageView. At runtime the objects carry
  // questionNumberInPaper, so we cast to access it.
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

  // ── Render ───────────────────────────────────────────────
  if (paper === null) {
    return (
      <div className="px-4 pt-5 pb-6 max-w-lg mx-auto">
        <p className="text-sm text-muted-foreground">Paper not found.</p>
      </div>
    );
  }

  const isLoading = paper === undefined || paperPages === undefined;

  const paperLabel = paper
    ? `${paper.schoolName ? `${paper.schoolName} · ` : ''}Term ${paper.term} ${paper.year} (Gr ${paper.grade})`
    : '';

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
          />
        </div>

        <PastPaperPillHeader
          questionNumber={questionNumber}
          onChangeQuestionNumber={setQuestionNumber}
          selectedCropId={selectedCropId}
          existingNumbers={existingNumbers}
          onPickNumber={handlePickNumber}
          onCancelSelection={() => setSelectedCropId(null)}
        />
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
          pillHeader={
            <PastPaperPillHeader
              questionNumber={questionNumber}
              onChangeQuestionNumber={setQuestionNumber}
              selectedCropId={selectedCropId}
              existingNumbers={existingNumbers}
              onPickNumber={handlePickNumber}
              onCancelSelection={() => setSelectedCropId(null)}
            />
          }
        />
      )}
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
      onZoom={
        imageUrl
          ? (id, na) => onZoom(id, pg.pageNumber, imageUrl, na)
          : undefined
      }
    />
  );
}
