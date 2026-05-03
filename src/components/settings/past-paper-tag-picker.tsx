'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation } from 'convex/react';
import { Search, X, Check } from 'lucide-react';
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

interface Props {
  open: boolean;
  onClose: () => void;
  cropId: Id<'questionBank'> | null;
  // The current crop's topic tag; null = unset.
  currentTopicTagId: Id<'examTopicTags'> | null;
  // Permanent and option tags configured for the crop's slot. Surfaced
  // first in the picker as "Suggested for this slot".
  permanentTagId: Id<'examTopicTags'> | null;
  optionTagIds: Id<'examTopicTags'>[];
  // All tags for free pick.
  allTags: TagDoc[];
}

// Bottom-sheet tag + concept picker for a single past-paper crop. Two
// sections:
//   1. Tag picker — searchable list of all tags, with permanent / option
//      slot-config tags surfaced first.
//   2. Concept multi-select — concepts inside the current tag's linked
//      units. Auto-derived; updates whenever the selected tag changes.
export function PastPaperTagPicker({
  open,
  onClose,
  cropId,
  currentTopicTagId,
  permanentTagId,
  optionTagIds,
  allTags,
}: Props) {
  const setTopicTag = useMutation(api.questionBank.setTopicTag);
  const setConcepts = useMutation(api.questionBank.setConcepts);

  // Active tag for the picker — starts at the crop's current tag (or the
  // permanent slot tag if none).
  const [activeTagId, setActiveTagId] = useState<Id<'examTopicTags'> | null>(
    null,
  );
  const [search, setSearch] = useState('');
  const [selectedConceptIds, setSelectedConceptIds] = useState<Set<string>>(
    new Set(),
  );
  const [busy, setBusy] = useState(false);

  // Reset when (re-)opened.
  useEffect(() => {
    if (open) {
      setActiveTagId(currentTopicTagId ?? permanentTagId ?? null);
      setSearch('');
    }
  }, [open, currentTopicTagId, permanentTagId]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Existing concept rows for this crop.
  const cropConcepts = useQuery(
    api.questionBank.listConcepts,
    open && cropId ? { questionId: cropId } : 'skip',
  );
  // Hydrate selectedConceptIds when cropConcepts arrives.
  useEffect(() => {
    if (cropConcepts) {
      setSelectedConceptIds(
        new Set(cropConcepts.map((r) => r.conceptExerciseId as string)),
      );
    }
  }, [cropConcepts]);

  // Concepts under the active tag's linked units, grouped by grade.
  const linkedConcepts = useQuery(
    api.topicTags.getLinkedConcepts,
    open && activeTagId ? { tagId: activeTagId } : 'skip',
  );

  const filteredTags = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allTags;
    return allTags.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.moduleId ?? '').toLowerCase().includes(q),
    );
  }, [allTags, search]);

  // Sort: permanent first, then options, then rest. Keeps relative order
  // within each bucket.
  const sortedTags = useMemo(() => {
    const optSet = new Set(optionTagIds as string[]);
    const score = (t: TagDoc): number => {
      if (t._id === permanentTagId) return 0;
      if (optSet.has(t._id)) return 1;
      return 2;
    };
    return [...filteredTags].sort((a, b) => {
      const sa = score(a);
      const sb = score(b);
      if (sa !== sb) return sa - sb;
      return 0;
    });
  }, [filteredTags, optionTagIds, permanentTagId]);

  const handlePickTag = async (tagId: Id<'examTopicTags'>) => {
    if (!cropId) return;
    setBusy(true);
    try {
      await setTopicTag({ id: cropId, topicTagId: tagId });
      setActiveTagId(tagId);
      toast.success('Tag set');
    } catch (e) {
      console.error(e);
      toast.error('Could not set tag');
    } finally {
      setBusy(false);
    }
  };

  const handleClearTag = async () => {
    if (!cropId) return;
    setBusy(true);
    try {
      await setTopicTag({ id: cropId, topicTagId: null });
      setActiveTagId(null);
      // Clear concepts too — they're tag-scoped.
      await setConcepts({ id: cropId, conceptExerciseIds: [] });
      setSelectedConceptIds(new Set());
      toast.success('Tag cleared');
    } catch (e) {
      console.error(e);
      toast.error('Could not clear');
    } finally {
      setBusy(false);
    }
  };

  const toggleConcept = (id: Id<'exercises'>) => {
    setSelectedConceptIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSaveConcepts = async () => {
    if (!cropId) return;
    setBusy(true);
    try {
      await setConcepts({
        id: cropId,
        conceptExerciseIds: Array.from(selectedConceptIds) as Id<'exercises'>[],
      });
      toast.success('Concepts saved');
      onClose();
    } catch (e) {
      console.error(e);
      toast.error('Could not save concepts');
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
        aria-label="Tag and concept picker"
        className={`fixed inset-x-0 bottom-0 bg-background rounded-t-2xl shadow-2xl transition-transform duration-300 ease-out max-h-[88vh] flex flex-col ${
          open ? 'translate-y-0' : 'translate-y-full pointer-events-none'
        }`}
        style={{ zIndex: 9995 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 shrink-0">
          <h2 className="text-base font-semibold">Tag &amp; concepts</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          {/* Tag section */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                Topic tag
              </p>
              {activeTagId && (
                <button
                  type="button"
                  disabled={busy || !cropId}
                  onClick={handleClearTag}
                  className="text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-50"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tags…"
                className="w-full h-9 pl-9 pr-3 rounded-xl bg-muted border border-border/60 text-sm outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
              />
            </div>

            <div className="space-y-1 max-h-56 overflow-y-auto">
              {sortedTags.map((t) => {
                const color = t.color ?? MODULE_COLORS[t.moduleId ?? ''] ?? '#888';
                const isActive = t._id === activeTagId;
                const isPermanent = t._id === permanentTagId;
                const isOption = optionTagIds.includes(t._id);
                return (
                  <button
                    key={t._id}
                    type="button"
                    disabled={busy || !cropId}
                    onClick={() => handlePickTag(t._id)}
                    className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg transition-colors text-left disabled:opacity-50 ${
                      isActive
                        ? 'bg-primary/10 ring-1 ring-primary/40'
                        : 'hover:bg-muted/60'
                    }`}
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
                    {isPermanent && (
                      <span className="text-[9px] font-medium uppercase tracking-wide text-primary shrink-0">
                        permanent
                      </span>
                    )}
                    {!isPermanent && isOption && (
                      <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground shrink-0">
                        suggested
                      </span>
                    )}
                    {isActive && <Check className="w-3.5 h-3.5 text-primary" />}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Concept section */}
          <section className="space-y-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
              Concepts
            </p>
            {!activeTagId ? (
              <p className="text-[11px] text-muted-foreground/70 italic">
                Pick a tag first to see its concepts.
              </p>
            ) : linkedConcepts === undefined ? (
              <p className="text-[11px] text-muted-foreground/70 italic">Loading…</p>
            ) : linkedConcepts.length === 0 ? (
              <p className="text-[11px] text-muted-foreground/70 italic">
                This tag has no linked units yet.
              </p>
            ) : (
              <div className="space-y-2">
                {linkedConcepts.map((group) => (
                  <ConceptGroup
                    key={group.unitId}
                    grade={group.grade}
                    term={group.term}
                    moduleId={group.moduleId}
                    concepts={group.concepts as { _id: Id<'exercises'>; name: string }[]}
                    selected={selectedConceptIds}
                    onToggle={toggleConcept}
                    busy={busy || !cropId}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="flex gap-3 px-4 py-3 border-t border-border/60 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 h-11 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleSaveConcepts}
            disabled={busy || !cropId}
            className="flex-1 h-11 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50"
          >
            Save concepts
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

function ConceptGroup({
  grade,
  term,
  moduleId,
  concepts,
  selected,
  onToggle,
  busy,
}: {
  grade: number;
  term: number;
  moduleId: string;
  concepts: { _id: Id<'exercises'>; name: string }[];
  selected: Set<string>;
  onToggle: (id: Id<'exercises'>) => void;
  busy: boolean;
}) {
  const color = MODULE_COLORS[moduleId] ?? '#888';
  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
      <div
        className="px-2.5 py-1.5 flex items-center gap-1.5 border-b border-border/40"
        style={{ backgroundColor: `${color}11` }}
      >
        <span
          className="font-mono text-[9px] font-bold rounded px-1 py-0.5"
          style={{ backgroundColor: `${color}22`, color }}
        >
          {moduleId}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground">
          G{grade} · T{term}
        </span>
      </div>
      <div className="p-1">
        {concepts.length === 0 ? (
          <p className="text-[10px] text-muted-foreground italic px-2 py-1">
            No concepts in this unit yet.
          </p>
        ) : (
          concepts.map((c) => {
            const checked = selected.has(c._id);
            return (
              <button
                key={c._id}
                type="button"
                disabled={busy}
                onClick={() => onToggle(c._id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/60 transition-colors text-left disabled:opacity-50"
              >
                <span
                  className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                    checked
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'border-border bg-background'
                  }`}
                >
                  {checked && <Check className="w-2.5 h-2.5" />}
                </span>
                <span className="text-xs flex-1 truncate">{c.name}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
