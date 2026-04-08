'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getSubLabel, type SubQuestionsMap } from '@/lib/sub-questions';

interface Props {
  questionCount: number;
  subQuestions: SubQuestionsMap | null;
  onSave: (subQ: SubQuestionsMap | null) => void | Promise<void>;
}

const GRID_MAX = 20;

export function SubQuestionInline({ questionCount, subQuestions, onSave }: Props) {
  // Which question is the count picker open for
  const [pickerForQ, setPickerForQ] = useState<number | null>(null);
  // Type selected before count is set; lives only while expanded
  const [pendingTypes, setPendingTypes] = useState<Record<string, 'letter' | 'roman'>>({});

  const getType = (q: number): 'letter' | 'roman' => {
    const k = String(q);
    return subQuestions?.[k]?.type ?? pendingTypes[k] ?? 'roman';
  };

  const getCount = (q: number): number => {
    const k = String(q);
    return subQuestions?.[k]?.count ?? 0;
  };

  const buildMap = (mutate: (m: SubQuestionsMap) => void): SubQuestionsMap | null => {
    const m: SubQuestionsMap = { ...(subQuestions || {}) };
    mutate(m);
    return Object.keys(m).length > 0 ? m : null;
  };

  const handleTypeToggle = async (q: number) => {
    const k = String(q);
    const next: 'letter' | 'roman' = getType(q) === 'roman' ? 'letter' : 'roman';
    if (subQuestions?.[k]) {
      const m = buildMap(map => {
        map[k] = { ...map[k], type: next };
      });
      try {
        await onSave(m);
      } catch (err) {
        console.error('[sub-question] type toggle save failed', err);
      }
    } else {
      setPendingTypes(p => ({ ...p, [k]: next }));
    }
  };

  const handleCountSelect = async (q: number, count: number) => {
    const k = String(q);
    const type = getType(q);
    const m = buildMap(map => {
      if (count <= 1) {
        delete map[k];
      } else {
        map[k] = { count, type };
      }
    });
    if (count <= 1) {
      setPendingTypes(p => {
        const n = { ...p };
        delete n[k];
        return n;
      });
    }
    setPickerForQ(null);
    try {
      console.log('[sub-question] saving', { q, count, type, payload: m });
      await onSave(m);
      console.log('[sub-question] save complete', m);
    } catch (err) {
      console.error('[sub-question] count save failed', err);
    }
  };

  return (
    <div className="bg-muted/30 rounded-lg p-2 mt-2 border border-border/40">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 px-1">
        Sub-questions
      </p>
      <div className="space-y-0.5 max-h-[55vh] overflow-y-auto no-scrollbar">
        {Array.from({ length: questionCount }, (_, i) => {
          const q = i + 1;
          const count = getCount(q);
          const type = getType(q);
          const hasSub = count > 1;
          return (
            <div
              key={q}
              className="flex items-center gap-2 px-2 py-1 rounded-md bg-card border border-border/30"
            >
              <span className="text-[11px] font-mono font-semibold text-foreground min-w-[28px]">
                Q{q}
              </span>
              <button
                onClick={() => handleTypeToggle(q)}
                className={`w-6 h-6 rounded text-[10px] font-bold italic transition-all active:scale-90
                  ${hasSub ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}
                title={type === 'roman' ? 'Roman (tap for a,b,c)' : 'Letter (tap for i,ii,iii)'}
              >
                {type === 'roman' ? 'i' : 'a'}
              </button>
              <div className="flex-1" />
              <button
                onClick={() => setPickerForQ(q)}
                className={`min-w-[36px] h-6 px-2 rounded text-[10px] font-bold transition-all active:scale-90
                  ${hasSub ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
              >
                {hasSub ? count : '—'}
              </button>
            </div>
          );
        })}
      </div>

      {/* Count picker dialog */}
      <Dialog open={pickerForQ !== null} onOpenChange={(o) => !o && setPickerForQ(null)}>
        <DialogContent className="max-w-xs mx-auto">
          {pickerForQ !== null && (() => {
            const type = getType(pickerForQ);
            const count = getCount(pickerForQ);
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="text-sm">
                    Q{pickerForQ} sub-questions ({type === 'roman' ? 'i, ii, iii…' : 'a, b, c…'})
                  </DialogTitle>
                </DialogHeader>
                <div className="grid grid-cols-5 gap-1 mt-2">
                  {Array.from({ length: GRID_MAX }, (_, i) => {
                    const label = getSubLabel(i, type);
                    const isInRange = count > 1 && i < count;
                    const isLast = count > 1 && i === count - 1;
                    return (
                      <button
                        key={i}
                        onClick={() => handleCountSelect(pickerForQ, i + 1)}
                        className={`h-9 rounded-lg text-[11px] font-bold transition-all active:scale-95
                          ${isLast
                            ? 'bg-primary text-primary-foreground ring-2 ring-primary ring-offset-1 ring-offset-background'
                            : isInRange
                              ? 'bg-primary/20 text-primary'
                              : 'bg-muted text-muted-foreground'}`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground text-center mt-2">
                  Tap the last sub-question. Tap the first cell to clear.
                </p>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
