'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { X } from 'lucide-react';
import { getSubLabel, type SubQuestionsMap, type SubQuestionDef } from '@/lib/sub-questions';

interface SubQuestionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  questionCount: number;
  subQuestions: SubQuestionsMap | null | undefined;
  onSave: (subQuestions: SubQuestionsMap | null) => void;
}

const GRID_MAX = 20;

export function SubQuestionDialog({
  open, onOpenChange, questionCount, subQuestions, onSave,
}: SubQuestionDialogProps) {
  // Which main question is being configured (null = none selected)
  const [selectedQ, setSelectedQ] = useState<number | null>(null);
  const [draft, setDraft] = useState<SubQuestionsMap>({});
  // Pending type selection for questions that don't have a count yet
  const [pendingTypes, setPendingTypes] = useState<Record<string, 'letter' | 'roman'>>({});

  // Reset draft when dialog opens
  useEffect(() => {
    if (open) {
      setDraft(subQuestions ? { ...subQuestions } : {});
      setSelectedQ(null);
      setPendingTypes({});
    }
  }, [open, subQuestions]);

  const selectedKey = selectedQ ? String(selectedQ) : null;
  const selectedDef = selectedKey ? draft[selectedKey] : null;
  const selectedType: 'letter' | 'roman' = selectedDef?.type ?? (selectedKey ? pendingTypes[selectedKey] : undefined) ?? 'letter';
  const selectedCount = selectedDef?.count ?? 0;

  const handleTypeChange = (type: 'letter' | 'roman') => {
    if (!selectedKey) return;
    if (draft[selectedKey]) {
      setDraft({ ...draft, [selectedKey]: { ...draft[selectedKey], type } });
    } else {
      setPendingTypes({ ...pendingTypes, [selectedKey]: type });
    }
  };

  const handleGridTap = (index: number) => {
    if (!selectedKey) return;
    const count = index + 1; // tapping index 0 (first item) = 1 sub-question... but 1 sub-question doesn't make sense
    // Minimum 2 sub-questions (a,b), tapping first item = clear
    if (count <= 1) {
      // Remove sub-questions for this question
      const next = { ...draft };
      delete next[selectedKey];
      setDraft(next);
    } else {
      const type = draft[selectedKey]?.type ?? pendingTypes[selectedKey] ?? 'letter';
      setDraft({ ...draft, [selectedKey]: { count, type } });
    }
  };

  const handleClear = () => {
    if (!selectedKey) return;
    const next = { ...draft };
    delete next[selectedKey];
    setDraft(next);
    // Also clear any pending type so the UI resets to default
    const nextPending = { ...pendingTypes };
    delete nextPending[selectedKey];
    setPendingTypes(nextPending);
  };

  const handleSave = () => {
    // Clean: remove entries with count <= 1
    const cleaned: SubQuestionsMap = {};
    for (const [k, v] of Object.entries(draft)) {
      if (v.count > 1) cleaned[k] = v;
    }
    onSave(Object.keys(cleaned).length > 0 ? cleaned : null);
    onOpenChange(false);
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm mx-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">Sub-Questions</DialogTitle>
        </DialogHeader>

        {/* Main question grid */}
        <div className="mb-4">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Select question</p>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: questionCount }, (_, i) => {
              const q = i + 1;
              const hasSub = draft[String(q)]?.count > 1;
              const isSelected = selectedQ === q;
              return (
                <button
                  key={q}
                  onClick={() => setSelectedQ(q)}
                  className={`w-9 h-9 rounded-lg text-xs font-bold transition-all active:scale-95 relative
                    ${isSelected
                      ? 'bg-primary text-primary-foreground ring-2 ring-primary ring-offset-1 ring-offset-background'
                      : hasSub
                        ? 'bg-primary/15 text-primary'
                        : 'bg-muted text-muted-foreground'}`}
                >
                  {q}
                  {hasSub && !isSelected && (
                    <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] rounded-full bg-primary text-[8px] font-bold text-primary-foreground flex items-center justify-center px-0.5">
                      {draft[String(q)].count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Sub-question config for selected question */}
        {selectedQ && (
          <div className="border-t border-border/50 pt-3">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-foreground">Q{selectedQ} sub-questions</p>
              {selectedCount > 1 && (
                <button
                  onClick={handleClear}
                  className="text-[10px] text-red-500 font-medium px-2 py-0.5 rounded bg-red-500/10 active:scale-95 transition-all"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Type toggle */}
            <div className="flex gap-1 mb-3">
              <button
                onClick={() => handleTypeChange('letter')}
                className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-all
                  ${selectedType === 'letter' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
              >
                a, b, c ...
              </button>
              <button
                onClick={() => handleTypeChange('roman')}
                className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-all
                  ${selectedType === 'roman' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
              >
                i, ii, iii ...
              </button>
            </div>

            {/* Label grid — tap to select last sub-question */}
            <div className="grid grid-cols-5 gap-1">
              {Array.from({ length: GRID_MAX }, (_, i) => {
                const label = getSubLabel(i, selectedType);
                const isInRange = selectedCount > 1 && i < selectedCount;
                const isLast = selectedCount > 1 && i === selectedCount - 1;
                return (
                  <button
                    key={i}
                    onClick={() => handleGridTap(i)}
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
            {selectedCount > 1 && (
              <p className="text-[10px] text-muted-foreground mt-2 text-center">
                {selectedCount} sub-questions: {getSubLabel(0, selectedType)} – {getSubLabel(selectedCount - 1, selectedType)}
              </p>
            )}
          </div>
        )}

        {/* Save button */}
        <button
          onClick={handleSave}
          className="w-full mt-3 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold active:scale-[0.98] transition-all"
        >
          Save
        </button>
      </DialogContent>
    </Dialog>
  );
}
