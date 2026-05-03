'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation } from 'convex/react';
import { Search, X, Plus, Trash2, Check } from 'lucide-react';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import { MODULE_COLORS } from '@/lib/types';
import { toast } from 'sonner';

type TagDoc = {
  _id: Id<'examTopicTags'>;
  name: string;
  color?: string;
  moduleId?: string;
};

type SlotTagDoc = {
  _id: Id<'paperStructureSlotTags'>;
  partId: Id<'paperStructureParts'>;
  slotNumber: number;
  tagId: Id<'examTopicTags'>;
  mode: string;
};

interface Props {
  open: boolean;
  onClose: () => void;
  partId: Id<'paperStructureParts'> | null;
  partCode: string;
  slotNumber: number;
  grade: number;
  slotTagsAtSlot: SlotTagDoc[];
  allTags: TagDoc[];
}

// Bottom-sheet popover for configuring a single slot's tag rules:
//   • Permanent — single tag auto-applied on crop save (one row max).
//   • Option   — N suggested tags surfaced first in the crop tag picker.
//   • Learned  — read-only display of top-5 tags actually used at this slot
//                across past papers of this grade.
//
// Mutations: setSlotTag (permanent | option), removeSlotTag (delete one
// option row), clearSlotPermanent (delete the permanent row).
export function PaperSlotConfigPopover({
  open,
  onClose,
  partId,
  partCode,
  slotNumber,
  grade,
  slotTagsAtSlot,
  allTags,
}: Props) {
  const setSlotTag = useMutation(api.paperStructures.setSlotTag);
  const removeSlotTag = useMutation(api.paperStructures.removeSlotTag);
  const clearPermanent = useMutation(api.paperStructures.clearSlotPermanent);

  const learned = useQuery(
    api.paperStructures.getLearnedOptionsForSlot,
    open && partId
      ? { grade, partCode, slotNumber }
      : 'skip',
  );

  const [pickerMode, setPickerMode] = useState<'permanent' | 'option' | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setPickerMode(null);
      setSearch('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pickerMode) setPickerMode(null);
        else onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, pickerMode, onClose]);

  const permanent = useMemo(
    () => slotTagsAtSlot.find((s) => s.mode === 'permanent'),
    [slotTagsAtSlot],
  );
  const options = useMemo(
    () => slotTagsAtSlot.filter((s) => s.mode === 'option'),
    [slotTagsAtSlot],
  );
  const tagById = useMemo(() => {
    const m = new Map<string, TagDoc>();
    for (const t of allTags) m.set(t._id, t);
    return m;
  }, [allTags]);

  const filteredTags = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allTags;
    return allTags.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.moduleId ?? '').toLowerCase().includes(q),
    );
  }, [allTags, search]);

  const onPickTag = async (tagId: Id<'examTopicTags'>) => {
    if (!partId || !pickerMode) return;
    setBusy(true);
    try {
      await setSlotTag({ partId, slotNumber, tagId, mode: pickerMode });
      toast.success(pickerMode === 'permanent' ? 'Permanent set' : 'Option added');
      setPickerMode(null);
      setSearch('');
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const onClearPermanent = async () => {
    if (!partId) return;
    setBusy(true);
    try {
      await clearPermanent({ partId, slotNumber });
      toast.success('Permanent cleared');
    } catch (e) {
      console.error(e);
      toast.error('Failed');
    } finally {
      setBusy(false);
    }
  };

  const onRemoveOption = async (tagId: Id<'examTopicTags'>) => {
    if (!partId) return;
    setBusy(true);
    try {
      await removeSlotTag({ partId, slotNumber, tagId, mode: 'option' });
    } catch (e) {
      console.error(e);
      toast.error('Failed');
    } finally {
      setBusy(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div
        className={`fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        style={{ zIndex: 9994 }}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Slot ${partCode}.${slotNumber} configuration`}
        className={`fixed inset-x-0 bottom-0 bg-background rounded-t-2xl shadow-2xl transition-transform duration-300 ease-out max-h-[85vh] flex flex-col ${
          open ? 'translate-y-0' : 'translate-y-full pointer-events-none'
        }`}
        style={{ zIndex: 9995 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 shrink-0">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Slot</p>
            <h2 className="text-base font-semibold font-mono">{partCode}.{slotNumber}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {pickerMode ? (
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-border/60 shrink-0 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium">
                  Pick a tag for{' '}
                  <span className="text-primary font-semibold">{pickerMode}</span>
                </p>
                <button
                  type="button"
                  onClick={() => setPickerMode(null)}
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Back
                </button>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search tags…"
                  className="w-full h-9 pl-9 pr-3 rounded-xl bg-muted border border-border/60 text-sm outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-2">
              {filteredTags.length === 0 ? (
                <p className="text-xs text-muted-foreground py-8 text-center">
                  No tags match.
                </p>
              ) : (
                <div className="space-y-1">
                  {filteredTags.map((t) => {
                    const color = t.color ?? MODULE_COLORS[t.moduleId ?? ''] ?? '#888';
                    return (
                      <button
                        key={t._id}
                        type="button"
                        disabled={busy}
                        onClick={() => onPickTag(t._id)}
                        className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-muted/60 transition-colors text-left disabled:opacity-50"
                      >
                        <span
                          className="w-1 h-5 rounded-full shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        {t.moduleId && (
                          <span
                            className="font-mono text-[9px] font-bold rounded px-1 py-0.5 shrink-0"
                            style={{
                              backgroundColor: `${color}22`,
                              color,
                            }}
                          >
                            {t.moduleId}
                          </span>
                        )}
                        <span className="text-sm flex-1 truncate">{t.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
            {/* Permanent */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                  Permanent tag
                </p>
                <p className="text-[10px] text-muted-foreground/70">
                  Auto-applied on crop save
                </p>
              </div>
              {permanent ? (
                (() => {
                  const t = tagById.get(permanent.tagId);
                  const color = t?.color ?? MODULE_COLORS[t?.moduleId ?? ''] ?? '#888';
                  return (
                    <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5">
                      <span
                        className="w-1.5 h-6 rounded-full shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-sm font-medium flex-1 truncate">
                        {t?.name ?? '(unknown tag)'}
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setPickerMode('permanent')}
                        className="text-[11px] px-2 py-1 rounded-lg bg-muted hover:bg-muted/70 disabled:opacity-50"
                      >
                        Change
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={onClearPermanent}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50"
                        aria-label="Clear permanent"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })()
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setPickerMode('permanent')}
                  className="w-full flex items-center justify-center gap-1.5 h-10 rounded-xl border border-dashed border-border text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" /> Set permanent tag
                </button>
              )}
            </section>

            {/* Options */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                  Suggested options
                </p>
                <p className="text-[10px] text-muted-foreground/70">
                  Surfaced first in crop picker
                </p>
              </div>
              {options.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {options.map((o) => {
                    const t = tagById.get(o.tagId);
                    const color = t?.color ?? MODULE_COLORS[t?.moduleId ?? ''] ?? '#888';
                    return (
                      <span
                        key={o._id}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 pl-2 pr-1 py-1"
                      >
                        <span
                          className="w-1 h-4 rounded-full shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <span className="text-xs">{t?.name ?? '(unknown)'}</span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onRemoveOption(o.tagId)}
                          className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground hover:text-destructive disabled:opacity-50"
                          aria-label={`Remove ${t?.name ?? 'option'}`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground/70 italic">
                  No suggested options.
                </p>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => setPickerMode('option')}
                className="w-full flex items-center justify-center gap-1.5 h-9 rounded-xl border border-dashed border-border text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" /> Add option
              </button>
            </section>

            {/* Learned */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                  Learned (top 5)
                </p>
                <p className="text-[10px] text-muted-foreground/70">
                  From past-paper crops
                </p>
              </div>
              {learned === undefined ? (
                <p className="text-[11px] text-muted-foreground/70 italic">Loading…</p>
              ) : learned.length === 0 ? (
                <p className="text-[11px] text-muted-foreground/70 italic">
                  No history yet.
                </p>
              ) : (
                <div className="space-y-1">
                  {learned.map((entry) => {
                    const t = entry.tag as TagDoc;
                    const color = t.color ?? MODULE_COLORS[t.moduleId ?? ''] ?? '#888';
                    return (
                      <div
                        key={entry.tagId}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-muted/30"
                      >
                        <span
                          className="w-1 h-4 rounded-full shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <span className="text-xs flex-1 truncate">{t.name}</span>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          ×{entry.count}
                        </span>
                        {!options.find((o) => o.tagId === entry.tagId) &&
                          permanent?.tagId !== entry.tagId && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={async () => {
                                if (!partId) return;
                                setBusy(true);
                                try {
                                  await setSlotTag({
                                    partId,
                                    slotNumber,
                                    tagId: entry.tagId as Id<'examTopicTags'>,
                                    mode: 'option',
                                  });
                                  toast.success('Promoted to option');
                                } catch (e) {
                                  console.error(e);
                                  toast.error('Failed');
                                } finally {
                                  setBusy(false);
                                }
                              }}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
                            >
                              Add as option
                            </button>
                          )}
                        {(options.find((o) => o.tagId === entry.tagId) ||
                          permanent?.tagId === entry.tagId) && (
                          <Check className="w-3 h-3 text-emerald-500" />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
