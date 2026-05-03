'use client';

import { useMemo } from 'react';
import type { Id } from '@/lib/convex';
import { MODULE_COLORS } from '@/lib/types';
import { Tag as TagIcon, AlertCircle } from 'lucide-react';

export type ResolvedPart = {
  _id: Id<'paperStructureParts'>;
  partCode: string;
  partLabel: string;
  questionCount: number;
  marksPerQuestion: number;
  requiredCount: number;
  order: number;
};

type TagDoc = {
  _id: Id<'examTopicTags'>;
  name: string;
  color?: string;
  moduleId?: string;
};

interface Props {
  parts: ResolvedPart[];
  selectedPartCode: string | null;
  selectedSlot: number | null;
  selectedCropId: Id<'questionBank'> | null;
  // Map "${partCode}:${slotNumber}" -> Id<'questionBank'> for filled slots.
  cropsBySlotKey: Map<string, Id<'questionBank'>>;
  // Map "${partCode}:${slotNumber}" -> permanent tag id (if any).
  permanentTagBySlot: Map<string, Id<'examTopicTags'>>;
  tagById: Map<string, TagDoc>;
  // Active crop's current topic tag (if any) — drives the tag chip label.
  activeTopicTagId: Id<'examTopicTags'> | null;
  conceptCount: number;
  onPickPart: (partCode: string) => void;
  onPickSlot: (partCode: string, slotNumber: number) => void;
  onCancelSelection: () => void;
  onOpenTagPicker: () => void;
}

// Sticky header for the past-paper crop route. Replaces the free-text
// PastPaperPillHeader with structured slot identity driven by the grade's
// paperStructure. Layout:
//   • Row 1: part tabs (1A / 1B / 2A / 2B  or  1 / 2)
//   • Row 2: slot grid for the active part — compact pill grid, ● for
//            already-cropped slots, ○ for empty
//   • Row 3: status + tag chip showing the resolved topic tag for the
//            active selection, tap to open the picker sheet
export function PastPaperStructuredHeader({
  parts,
  selectedPartCode,
  selectedSlot,
  selectedCropId,
  cropsBySlotKey,
  permanentTagBySlot,
  tagById,
  activeTopicTagId,
  conceptCount,
  onPickPart,
  onPickSlot,
  onCancelSelection,
  onOpenTagPicker,
}: Props) {
  const activePart = useMemo(
    () => parts.find((p) => p.partCode === selectedPartCode) ?? null,
    [parts, selectedPartCode],
  );

  const slots = useMemo(() => {
    if (!activePart) return [] as number[];
    return Array.from({ length: activePart.questionCount }, (_, i) => i + 1);
  }, [activePart]);

  // Resolved tag for the chip: explicit > permanent > none
  const chipTagId =
    activeTopicTagId ??
    (selectedPartCode && selectedSlot
      ? permanentTagBySlot.get(`${selectedPartCode}:${selectedSlot}`) ?? null
      : null);
  const chipTag = chipTagId ? tagById.get(chipTagId) : null;
  const chipColor =
    chipTag?.color ?? MODULE_COLORS[chipTag?.moduleId ?? ''] ?? '#888';

  const slotKey = (slot: number) => `${selectedPartCode ?? ''}:${slot}`;

  return (
    <div className="max-w-lg mx-auto px-3 pb-2.5 space-y-1.5">
      {/* Part tabs */}
      {parts.length === 0 ? (
        <div className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 px-2.5 py-1.5">
          <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            No paper structure for this grade. Set one up in Settings → Exam.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {parts.map((p) => {
            const isActive = p.partCode === selectedPartCode;
            return (
              <button
                key={p._id}
                onClick={() => onPickPart(p.partCode)}
                className={`relative h-8 px-2.5 rounded-lg text-xs font-mono font-bold transition-all active:scale-95 ${
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-muted text-foreground hover:bg-muted/70'
                }`}
              >
                {p.partCode}
              </button>
            );
          })}
        </div>
      )}

      {/* Slot grid */}
      {activePart && (
        <div className="flex flex-wrap gap-1">
          {slots.map((slot) => {
            const k = slotKey(slot);
            const filled = cropsBySlotKey.has(k);
            const permanent = permanentTagBySlot.get(k);
            const permanentTag = permanent ? tagById.get(permanent) : undefined;
            const permColor =
              permanentTag?.color ??
              MODULE_COLORS[permanentTag?.moduleId ?? ''] ??
              null;
            const isActive = selectedSlot === slot;
            return (
              <button
                key={slot}
                onClick={() => onPickSlot(activePart.partCode, slot)}
                className={`relative h-8 min-w-[34px] px-2 rounded-lg text-xs font-mono font-semibold transition-all active:scale-95 border ${
                  isActive
                    ? 'bg-primary text-primary-foreground border-transparent shadow-sm'
                    : filled
                      ? 'bg-muted text-foreground border-transparent hover:bg-muted/70'
                      : 'bg-background text-muted-foreground border-dashed border-border hover:border-border-foreground hover:text-foreground'
                }`}
                style={
                  !isActive && permColor
                    ? { borderColor: `${permColor}80`, borderStyle: 'solid' }
                    : undefined
                }
                aria-label={`Slot ${activePart.partCode}.${slot}${
                  filled ? ' (already cropped)' : ''
                }`}
              >
                {slot}
                {filled && (
                  <span
                    className={`absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full ${
                      isActive ? 'bg-primary-foreground/70' : 'bg-emerald-500'
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Status row: selection + tag chip */}
      {activePart && selectedSlot != null && (
        <div className="flex items-center gap-1.5 pt-0.5">
          <span className="text-[11px] text-muted-foreground shrink-0">
            <span className="font-mono font-semibold text-foreground">
              {activePart.partCode}.{selectedSlot}
            </span>
            {selectedCropId ? ' · re-key mode' : ''}
          </span>

          <button
            onClick={onOpenTagPicker}
            className={`flex items-center gap-1.5 h-7 px-2 rounded-lg text-[11px] font-medium transition-colors ${
              chipTag
                ? 'bg-muted hover:bg-muted/70'
                : 'bg-primary/10 text-primary hover:bg-primary/20'
            }`}
            style={chipTag ? { color: chipColor } : undefined}
          >
            <TagIcon className="w-3 h-3" />
            {chipTag ? chipTag.name : '+ tag'}
            {conceptCount > 0 && (
              <span className="text-[9px] text-muted-foreground font-mono">
                · {conceptCount}c
              </span>
            )}
          </button>

          {selectedCropId && (
            <button
              onClick={onCancelSelection}
              className="h-7 px-2 rounded-lg bg-sky-500/20 text-sky-500 text-[11px] font-medium hover:bg-sky-500/30 transition-colors shrink-0 ml-auto"
            >
              Cancel re-key
            </button>
          )}
        </div>
      )}
    </div>
  );
}
