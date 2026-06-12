'use client';

// Typed-override editor ("digitalize as you go").
//
// Opened from a question row in the inline sheet view. Shows one editor
// block per editable target — the question's stems first (in print order),
// then the question itself. Each block: the original crop for reference,
// a textarea (Tamil/English + $TeX$ math), a math-snippet toolbar, a live
// preview rendered by the SAME typesetter that produces the saved PNG, and
// Save / Revert actions. Saving stores text + snapshot on the questionBank
// row — bank-level, every future sheet uses it.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api, type Id } from '@/lib/convex';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CropThumbnail } from '@/components/algorithm/sheet-preview';
import { renderTypeset } from '@/lib/typeset-render';
import { typesetSourceHasContent } from '@/lib/typeset-parse';
import { toast } from 'sonner';
import { Loader2, Pencil, Trash2 } from 'lucide-react';

// Math snippets the toolbar inserts at the cursor. `cursorOffset` is where
// the caret lands inside the inserted string (so the founder types straight
// into the first empty slot).
const MATH_SNIPPETS: Array<{ label: string; insert: string; cursorOffset: number }> = [
  { label: 'a/b', insert: '$\\frac{}{}$', cursorOffset: 7 },
  { label: '√', insert: '$\\sqrt{}$', cursorOffset: 7 },
  { label: 'x²', insert: '$x^{}$', cursorOffset: 4 },
  { label: '×', insert: '$\\times$', cursorOffset: 8 },
  { label: '÷', insert: '$\\div$', cursorOffset: 6 },
  { label: '±', insert: '$\\pm$', cursorOffset: 5 },
  { label: '≥', insert: '$\\geq$', cursorOffset: 6 },
  { label: '≤', insert: '$\\leq$', cursorOffset: 6 },
  { label: '≠', insert: '$\\neq$', cursorOffset: 6 },
  { label: 'π', insert: '$\\pi$', cursorOffset: 5 },
  { label: '°', insert: '$^{\\circ}$', cursorOffset: 10 },
];

type Target = {
  questionId: Id<'questionBank'>;
  role: 'question' | 'stem';
  cropBox: { x: number; y: number; w: number; h: number } | null;
  pageImageUrl: string | null;
  pageImageUrlSmall: string | null;
  overrideText: string | null;
  overrideImageUrl: string | null;
};

function TargetEditor({ target }: { target: Target }) {
  const [text, setText] = useState(target.overrideText ?? '');
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const renderSeq = useRef(0);

  const generateUploadUrl = useMutation(api.learningEngine.overrides.generateOverrideUploadUrl);
  const setOverride = useMutation(api.learningEngine.overrides.setQuestionOverride);
  const clearOverride = useMutation(api.learningEngine.overrides.clearQuestionOverride);

  const hasContent = useMemo(() => typesetSourceHasContent(text), [text]);

  // Live preview, debounced. Sequence guard drops stale renders.
  useEffect(() => {
    if (!hasContent) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    const seq = ++renderSeq.current;
    setRendering(true);
    const timer = setTimeout(async () => {
      try {
        const result = await renderTypeset(text);
        if (renderSeq.current !== seq) return;
        setPreview(result.dataUrl);
        setPreviewError(null);
      } catch (err) {
        if (renderSeq.current !== seq) return;
        setPreview(null);
        setPreviewError(err instanceof Error ? err.message : 'Render failed');
      } finally {
        if (renderSeq.current === seq) setRendering(false);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [text, hasContent]);

  const insertSnippet = useCallback((insert: string, cursorOffset: number) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? text.length;
    const end = ta.selectionEnd ?? start;
    const next = text.slice(0, start) + insert + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + cursorOffset;
      ta.setSelectionRange(pos, pos);
    });
  }, [text]);

  const handleSave = useCallback(async () => {
    if (!hasContent || previewError) return;
    setSaving(true);
    try {
      // Re-render at save time (never trust a possibly-stale preview).
      const result = await renderTypeset(text);
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'image/png' },
        body: result.blob,
      });
      if (!res.ok) throw new Error('Upload failed');
      const { storageId } = await res.json();
      await setOverride({
        questionId: target.questionId,
        overrideText: text,
        storageId,
        widthMm: result.widthMm,
        heightMm: result.heightMm,
      });
      toast.success('Typed version saved — all future sheets use it.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [hasContent, previewError, text, generateUploadUrl, setOverride, target.questionId]);

  const handleRevert = useCallback(async () => {
    setSaving(true);
    try {
      await clearOverride({ questionId: target.questionId });
      setText('');
      setPreview(null);
      toast.success('Reverted to the original image.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Revert failed');
    } finally {
      setSaving(false);
    }
  }, [clearOverride, target.questionId]);

  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {target.role === 'stem' ? 'Stem (instruction line)' : 'Question'}
        </span>
        {target.overrideText !== null && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-primary/15 text-primary font-medium">
            typed
          </span>
        )}
      </div>

      {/* Original crop, for reference while typing. */}
      {target.cropBox && target.pageImageUrl && (
        <div className="flex items-start gap-2">
          <CropThumbnail
            imageUrl={target.pageImageUrl}
            imageUrlSmall={target.pageImageUrlSmall}
            cropBox={target.cropBox}
            maxSide={120}
          />
          <p className="text-[10px] text-muted-foreground pt-1">
            Original from the book — copy it here, fixing the wording as you
            type (e.g. &quot;solve ALL&quot; → &quot;solve THIS&quot;).
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        {MATH_SNIPPETS.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => insertSnippet(s.insert, s.cursorOffset)}
            className="px-2 py-1 rounded-md bg-muted text-foreground text-[12px] font-medium hover:bg-accent active:scale-95 transition-all"
          >
            {s.label}
          </button>
        ))}
      </div>

      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        dir="auto"
        rows={3}
        placeholder="Type the question here… math goes between $ signs, or use the buttons above."
        className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-[13px] leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary resize-y"
      />

      {/* Live preview — exactly what will print. */}
      {hasContent && (
        <div className="rounded-lg border border-border bg-white p-2 min-h-[44px] flex items-center">
          {previewError ? (
            <span className="text-[11px] text-red-500">{previewError}</span>
          ) : preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Print preview" className="max-w-full h-auto" style={{ maxHeight: 160 }} />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
          {rendering && preview && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-2 shrink-0" />
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        {target.overrideText !== null ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRevert}
            disabled={saving}
            className="text-red-500 hover:text-red-600 h-8 px-2"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Revert to image
          </Button>
        ) : (
          <span />
        )}
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!hasContent || !!previewError || saving || rendering}
          className="h-8"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
          Save typed version
        </Button>
      </div>
    </div>
  );
}

export function QuestionOverrideDialog({
  questionId,
  onClose,
}: {
  questionId: Id<'questionBank'> | null;
  onClose: () => void;
}) {
  const info = useQuery(
    api.learningEngine.overrides.getQuestionOverrideInfo,
    questionId ? { questionId } : 'skip',
  );

  return (
    <Dialog open={questionId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Pencil className="h-4 w-4" />
            Type this question
          </DialogTitle>
        </DialogHeader>
        {info === undefined && questionId !== null && (
          <div className="py-8 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {info === null && (
          <p className="text-[12px] text-muted-foreground py-4">
            Question not found, or you are not signed in.
          </p>
        )}
        {info && (
          <div className="space-y-3">
            {info.targets.map((t) => (
              <TargetEditor key={t.questionId as unknown as string} target={t} />
            ))}
            <p className="text-[10px] text-muted-foreground">
              Saved typed versions apply to EVERY future sheet that uses this
              question — for all students. Re-render this sheet&apos;s PDF to
              see it on paper.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
