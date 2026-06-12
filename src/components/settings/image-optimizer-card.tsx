'use client';

// ImageOptimizerCard (perf phase 6) — one-tap backfill that generates the
// ~900px JPEG "small variant" for every textbook/past-paper page that lacks
// one. Runs ENTIRELY in the browser (fetch full page → canvas downscale →
// upload → attach), so no server image processing exists anywhere. Idempotent:
// safe to re-run after uploading new pages; already-optimized pages are
// skipped by the listMissing query. Originals are never modified.

import { useEffect, useRef, useState } from 'react';
import { useConvex, useQuery } from 'convex/react';
import { ImageDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/convex';

const TARGET_WIDTH = 900;
const JPEG_QUALITY = 0.82;
const BATCH_SIZE = 5;

async function downscaleToJpeg(fullUrl: string): Promise<Blob> {
  const res = await fetch(fullUrl);
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  const bitmap = await createImageBitmap(await res.blob());
  const scale = Math.min(1, TARGET_WIDTH / bitmap.width);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  // White backing: page scans are white paper; JPEG has no alpha channel.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
  );
  if (!blob) throw new Error('jpeg encode failed');
  return blob;
}

export function ImageOptimizerCard() {
  const convex = useConvex();
  const progress = useQuery(api.pageThumbnails.progress);
  const [running, setRunning] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const cancelRef = useRef(false);

  // Stop cleanly if the card unmounts mid-run (e.g. navigating away).
  useEffect(() => () => { cancelRef.current = true; }, []);

  const run = async () => {
    setRunning(true);
    setDoneCount(0);
    cancelRef.current = false;
    let processed = 0;
    try {
      for (;;) {
        if (cancelRef.current) break;
        const batch = await convex.query(api.pageThumbnails.listMissing, {
          limit: BATCH_SIZE,
        });
        if (batch.length === 0) break;
        for (const page of batch) {
          if (cancelRef.current) break;
          if (!page.url) continue;
          const small = await downscaleToJpeg(page.url);
          const uploadUrl = await convex.mutation(
            api.pageThumbnails.generateUploadUrl,
            {},
          );
          const up = await fetch(uploadUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'image/jpeg' },
            body: small,
          });
          if (!up.ok) throw new Error(`upload failed (${up.status})`);
          const { storageId } = (await up.json()) as { storageId: string };
          await convex.mutation(api.pageThumbnails.attachSmall, {
            table: page.table,
            pageId: page.pageId,
            smallStorageId: storageId as never,
          });
          processed += 1;
          setDoneCount(processed);
        }
      }
      if (!cancelRef.current) {
        toast.success(
          processed === 0
            ? 'All page images are already optimized.'
            : `Optimized ${processed} page image${processed === 1 ? '' : 's'}.`,
        );
      }
    } catch (e) {
      toast.error(
        `Image optimize stopped: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setRunning(false);
    }
  };

  const remaining =
    progress != null ? progress.total - progress.done : null;

  return (
    <div className="mb-4 rounded-xl border border-border bg-card px-3 py-2.5 flex items-center gap-3">
      <ImageDown className="w-4 h-4 text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground">Optimize question images</p>
        <p className="text-[10px] text-muted-foreground">
          {running
            ? `Working… ${doneCount} done this run`
            : progress == null
              ? 'Checking…'
              : remaining === 0
                ? `All ${progress.total} pages optimized — sheets load light.`
                : `${remaining} of ${progress.total} pages still load full-size in sheets.`}
        </p>
      </div>
      {running ? (
        <button
          type="button"
          onClick={() => { cancelRef.current = true; }}
          className="shrink-0 text-[11px] font-medium px-2.5 py-1.5 rounded-lg bg-muted text-foreground hover:bg-muted/70 transition-colors flex items-center gap-1.5"
        >
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Stop
        </button>
      ) : (
        <button
          type="button"
          onClick={run}
          disabled={progress == null || remaining === 0}
          className="shrink-0 text-[11px] font-medium px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-50 transition-colors"
        >
          Optimize
        </button>
      )}
    </div>
  );
}
