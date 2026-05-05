'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { Plus, Trash2, Video, Link2, X, Search, Check, Layers } from 'lucide-react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import { findUnit } from '@/lib/curriculum-data';
import { MODULE_COLORS } from '@/lib/types';
import { toast } from 'sonner';

type Exercise = {
  _id: Id<'exercises'>;
  unitId: string;
  name: string;
  questionCount: number;
  order: number;
  type?: string;
  pageNumber?: number;
  pageNumberEnd?: number;
  videoUrl?: string;
  conceptSummary?: string;
  prerequisiteExerciseIds?: Id<'exercises'>[];
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unit: { id: string; name: string; number: number } | null;
  unitMeta: { startPage?: number; endPage?: number } | undefined;
  allExercises: Exercise[];
}

export function ConceptsUnitDrawer({ open, onOpenChange, unit, unitMeta, allExercises }: Props) {
  const addConceptMut = useMutation(api.exercises.addConcept);
  const renameMut = useMutation(api.exercises.renameConcept);
  const setVideoMut = useMutation(api.exercises.setConceptVideo);
  const updatePageMut = useMutation(api.exercises.updatePageNumber);
  const setPrereqsMut = useMutation(api.exercises.setConceptPrerequisites);
  const removeMut = useMutation(api.exercises.remove);

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newConceptName, setNewConceptName] = useState('');

  // Backend mapping: exercise → concept list, orphans, duplicate-order warnings.
  const unitMapping = useQuery(
    api.learningEngine.derivedConcepts.getUnitMapping,
    unit ? { unitId: unit.id } : 'skip',
  );

  // All rows for the unit sorted by order (both types) — used for grouping.
  const unitAllRows = useMemo(() => {
    if (!unit) return [] as Exercise[];
    return allExercises
      .filter((e) => e.unitId === unit.id)
      .sort((a, b) => a.order - b.order);
  }, [allExercises, unit]);

  // Exercise-type rows only (in order).
  const unitExerciseRows = useMemo(
    () => unitAllRows.filter((e) => e.type !== 'concept'),
    [unitAllRows],
  );

  // Concept-type rows for the active unit (for "Add concept" logic and prereq picker).
  const unitConcepts = useMemo(
    () => unitAllRows.filter((e) => e.type === 'concept'),
    [unitAllRows],
  );

  // All concept-type rows globally — for the prereq picker.
  const allConcepts = useMemo(
    () => allExercises.filter((e) => e.type === 'concept'),
    [allExercises],
  );

  // Fast lookup by ID.
  const exerciseById = useMemo(() => {
    const m = new Map<string, Exercise>();
    for (const e of allExercises) m.set(e._id, e);
    return m;
  }, [allExercises]);

  // exerciseId → conceptIds (from backend).
  const exToConceptIds = useMemo(() => {
    const m = new Map<string, Id<'exercises'>[]>();
    for (const row of (unitMapping?.exerciseToConcepts ?? [])) {
      m.set(row.exerciseId as string, row.conceptIds as Id<'exercises'>[]);
    }
    return m;
  }, [unitMapping]);

  // Set of orphan concept IDs (from backend).
  const orphanSet = useMemo(
    () => new Set<string>((unitMapping?.orphanConceptIds ?? []) as string[]),
    [unitMapping],
  );

  // Concepts that are orphaned (trailing after the last exercise).
  const orphanConcepts = useMemo(
    () => unitConcepts.filter((c) => orphanSet.has(c._id as string)),
    [unitConcepts, orphanSet],
  );

  const handleAdd = async () => {
    if (!unit || !newConceptName.trim()) return;
    const maxOrder = unitAllRows.length
      ? Math.max(...unitAllRows.map((e) => e.order))
      : -1;
    try {
      await addConceptMut({
        unitId: unit.id,
        name: newConceptName.trim(),
        afterOrder: maxOrder,
      });
      toast.success('Concept added');
      setNewConceptName('');
      setAddDialogOpen(false);
    } catch (e) {
      console.error(e);
      toast.error('Could not add concept');
    }
  };

  const handleDelete = async (c: Exercise) => {
    if (!confirm(`Delete concept "${c.name}"?`)) return;
    try {
      await removeMut({ id: c._id });
      toast.success('Deleted');
    } catch (e) {
      console.error(e);
      toast.error('Could not delete');
    }
  };

  const conceptCardProps = (c: Exercise) => ({
    concept: c,
    allConcepts,
    onRename: async (name: string) => {
      try {
        await renameMut({ id: c._id, name });
        toast.success('Renamed');
      } catch (e) { console.error(e); toast.error('Rename failed'); }
    },
    onPageChange: async (start: number, end?: number) => {
      try {
        await updatePageMut({ id: c._id, pageNumber: start, pageNumberEnd: end });
      } catch (e) { console.error(e); toast.error('Could not save pages'); }
    },
    onVideoChange: async (videoUrl?: string, summary?: string) => {
      try {
        await setVideoMut({ id: c._id, videoUrl, conceptSummary: summary });
      } catch (e) { console.error(e); toast.error('Could not save video'); }
    },
    onPrereqsChange: async (ids: Id<'exercises'>[]) => {
      try {
        await setPrereqsMut({ id: c._id, prerequisiteExerciseIds: ids });
      } catch (e) { console.error(e); toast.error('Could not save prerequisites'); }
    },
    onDelete: () => handleDelete(c),
  });

  // ─── Render ───────────────────────────────────────────────────────────────

  // Determine if we have a mapping loaded.
  const mappingReady = unitMapping !== undefined;

  return (
    <Drawer direction="right" open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="text-sm truncate">
            {unit ? `Unit ${unit.number}: ${unit.name.replace(/^\d+\.\s*/, '')}` : ''}
            {unitMeta?.startPage != null && unitMeta?.endPage != null && (
              <span className="text-muted-foreground font-normal">
                {' '}(pp. {unitMeta.startPage}–{unitMeta.endPage})
              </span>
            )}
          </DrawerTitle>
        </DrawerHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-4 no-scrollbar space-y-3">
          {/* Add concept button */}
          <Button
            onClick={() => { setNewConceptName(''); setAddDialogOpen(true); }}
            variant="outline"
            size="sm"
            className="w-full gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Add concept
          </Button>

          {/* Empty state — no concepts at all */}
          {unitConcepts.length === 0 && (
            <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 px-4 py-8 text-center">
              <p className="text-xs text-muted-foreground">
                No concepts yet. Add one above, or add theory chunks inline via the Details subtab.
              </p>
            </div>
          )}

          {/* ── Layout when exercise rows exist ── */}
          {unitExerciseRows.length > 0 && unitConcepts.length > 0 && (
            <>
              {unitExerciseRows.map((ex) => {
                const conceptIds = exToConceptIds.get(ex._id as string) ?? [];
                const concepts = conceptIds
                  .map((cid) => exerciseById.get(cid as string))
                  .filter(Boolean) as Exercise[];

                return (
                  <div key={ex._id} className="space-y-2">
                    {/* Exercise header */}
                    <div className="rounded-lg bg-muted/40 border border-border/50 px-3 py-2 space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <Layers className="w-3 h-3 text-muted-foreground shrink-0" />
                        <span className="text-[11px] font-medium text-foreground truncate">
                          {ex.name}
                        </span>
                      </div>
                      {mappingReady && (
                        conceptIds.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="text-[10px] text-muted-foreground shrink-0">Tests concepts:</span>
                            {conceptIds.map((cid) => {
                              const concept = exerciseById.get(cid as string);
                              return (
                                <span
                                  key={cid as string}
                                  className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-medium"
                                >
                                  {concept?.name ?? '?'}
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-[10px] text-muted-foreground/60 italic">
                            No concepts before this exercise — add concept rows above it on the Details page.
                          </p>
                        )
                      )}
                    </div>

                    {/* Editable concept cards for this exercise group */}
                    {concepts.map((c) => (
                      <ConceptCard key={c._id} {...conceptCardProps(c)} />
                    ))}
                  </div>
                );
              })}

              {/* Orphan section — concepts after the last exercise */}
              {orphanConcepts.length > 0 && (
                <div className="space-y-2">
                  <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2">
                    <p className="text-[11px] font-medium text-amber-600">Trailing concepts</p>
                    <p className="text-[10px] text-amber-600/80 mt-0.5">
                      Not covered by any exercise — move above an exercise on the Details page.
                    </p>
                  </div>
                  {orphanConcepts.map((c) => (
                    <div key={c._id} className="rounded-xl border border-amber-500/40 overflow-hidden">
                      <div className="bg-amber-500/10 px-3 py-1.5 flex items-center gap-1.5">
                        <span className="text-[10px] text-amber-600 font-medium">Trailing concept</span>
                      </div>
                      <div className="p-0">
                        <ConceptCard {...conceptCardProps(c)} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── Layout when NO exercise rows exist but concepts do ── */}
          {unitExerciseRows.length === 0 && unitConcepts.length > 0 && (
            <>
              {mappingReady && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2">
                  <p className="text-[11px] font-medium text-amber-600">No exercise rows in this unit</p>
                  <p className="text-[10px] text-amber-600/80 mt-0.5">
                    All concepts are unlinked. Add exercise rows on the Details page so concepts can be assigned to them.
                  </p>
                </div>
              )}
              {unitConcepts.map((c) => (
                <ConceptCard key={c._id} {...conceptCardProps(c)} />
              ))}
            </>
          )}
        </div>

        {/* Add concept dialog */}
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogContent className="max-w-sm mx-auto">
            <DialogHeader>
              <DialogTitle>Add concept</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                autoFocus
                value={newConceptName}
                onChange={(e) => setNewConceptName(e.target.value)}
                placeholder="Theory / concept title"
                onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
              />
              <Button onClick={handleAdd} className="w-full rounded-xl">Add</Button>
            </div>
          </DialogContent>
        </Dialog>
      </DrawerContent>
    </Drawer>
  );
}

// ─── Single concept card with inline editable fields ───

function ConceptCard({
  concept,
  allConcepts,
  onRename,
  onPageChange,
  onVideoChange,
  onPrereqsChange,
  onDelete,
}: {
  concept: Exercise;
  allConcepts: Exercise[];
  onRename: (name: string) => Promise<void>;
  onPageChange: (start: number, end?: number) => Promise<void>;
  onVideoChange: (videoUrl?: string, summary?: string) => Promise<void>;
  onPrereqsChange: (ids: Id<'exercises'>[]) => Promise<void>;
  onDelete: () => void;
}) {
  const [prereqPickerOpen, setPrereqPickerOpen] = useState(false);

  const prereqIds = concept.prerequisiteExerciseIds ?? [];
  const prereqById = useMemo(() => {
    const m: Record<string, Exercise> = {};
    for (const c of allConcepts) m[c._id] = c;
    return m;
  }, [allConcepts]);

  return (
    <div className="rounded-xl border border-border/60 bg-card p-3 space-y-2.5">
      {/* Row 1: name + delete */}
      <div className="flex items-start gap-2">
        <Input
          key={`nm-${concept._id}-${concept.name}`}
          defaultValue={concept.name}
          placeholder="Concept title"
          className="flex-1 h-8 text-sm"
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== concept.name) onRename(v);
          }}
        />
        <button
          onClick={onDelete}
          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors shrink-0"
          aria-label="Delete"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Row 2: page range */}
      <div className="flex items-center gap-1.5">
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground w-10 shrink-0">Pages</Label>
        <Input
          key={`pg-${concept._id}-${concept.pageNumber}`}
          type="number"
          min={1}
          defaultValue={concept.pageNumber ?? ''}
          placeholder="from"
          className="w-14 h-7 text-xs text-center font-mono px-1"
          onBlur={(e) => {
            const s = parseInt(e.target.value);
            if (isNaN(s)) return;
            if (s === concept.pageNumber) return;
            onPageChange(s, concept.pageNumberEnd);
          }}
        />
        <span className="text-[10px] text-muted-foreground">–</span>
        <Input
          key={`pge-${concept._id}-${concept.pageNumberEnd}`}
          type="number"
          min={1}
          defaultValue={concept.pageNumberEnd ?? ''}
          placeholder="to"
          className="w-14 h-7 text-xs text-center font-mono px-1"
          onBlur={(e) => {
            const v = e.target.value.trim();
            const end = v ? parseInt(v) : undefined;
            if (v && (isNaN(end!) || (concept.pageNumber && end! < concept.pageNumber))) return;
            if (end === concept.pageNumberEnd) return;
            onPageChange(concept.pageNumber ?? 0, end);
          }}
        />
      </div>

      {/* Row 3: video URL */}
      <div className="flex items-center gap-1.5">
        <Video className="w-3.5 h-3.5 text-violet-500 shrink-0" />
        <Input
          key={`vu-${concept._id}-${concept.videoUrl}`}
          defaultValue={concept.videoUrl ?? ''}
          placeholder="YouTube URL (unlisted)"
          className="flex-1 h-7 text-xs font-mono"
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v === (concept.videoUrl ?? '')) return;
            onVideoChange(v || undefined, concept.conceptSummary);
          }}
        />
      </div>

      {/* Row 4: summary */}
      <textarea
        key={`sm-${concept._id}-${concept.conceptSummary}`}
        defaultValue={concept.conceptSummary ?? ''}
        placeholder="Short summary (optional)"
        rows={2}
        className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-xs resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v === (concept.conceptSummary ?? '')) return;
          onVideoChange(concept.videoUrl, v || undefined);
        }}
      />

      {/* Row 5: prerequisites */}
      <div>
        <div className="flex items-center gap-1.5 mb-1.5">
          <Link2 className="w-3 h-3 text-muted-foreground" />
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Prerequisites {prereqIds.length > 0 && <span className="lowercase">({prereqIds.length})</span>}
          </Label>
          <button
            onClick={() => setPrereqPickerOpen(true)}
            className="ml-auto text-[10px] text-primary hover:underline"
          >
            {prereqIds.length > 0 ? 'Edit' : '+ Add'}
          </button>
        </div>
        {prereqIds.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {prereqIds.map((id) => {
              const p = prereqById[id];
              if (!p) return null;
              const ctx = findUnit(p.unitId);
              return (
                <button
                  key={id}
                  onClick={() => onPrereqsChange(prereqIds.filter((x) => x !== id))}
                  className="inline-flex items-center gap-1 rounded-full bg-muted hover:bg-destructive/10 hover:text-destructive px-2 py-0.5 text-[10px] transition-colors"
                  title="Remove prerequisite"
                >
                  {ctx && (
                    <span
                      className="font-mono text-[8px] font-bold"
                      style={{ color: MODULE_COLORS[ctx.module.id] }}
                    >
                      {ctx.module.id}·G{ctx.grade}
                    </span>
                  )}
                  <span className="truncate max-w-[140px]">{p.name}</span>
                  <X className="w-2.5 h-2.5" />
                </button>
              );
            })}
          </div>
        )}
      </div>

      <PrereqPickerDialog
        open={prereqPickerOpen}
        onOpenChange={setPrereqPickerOpen}
        selfId={concept._id}
        allConcepts={allConcepts}
        selectedIds={prereqIds}
        onSave={async (ids) => {
          await onPrereqsChange(ids);
          setPrereqPickerOpen(false);
        }}
      />
    </div>
  );
}

// ─── Prerequisite picker ───

function PrereqPickerDialog({
  open,
  onOpenChange,
  selfId,
  allConcepts,
  selectedIds,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  selfId: Id<'exercises'>;
  allConcepts: Exercise[];
  selectedIds: Id<'exercises'>[];
  onSave: (ids: Id<'exercises'>[]) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Id<'exercises'>[]>(selectedIds);

  // Reset draft when opened
  useMemo(() => { if (open) setDraft(selectedIds); }, [open, selectedIds]);

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allConcepts
      .filter((c) => c._id !== selfId)
      .map((c) => ({ c, ctx: findUnit(c.unitId) }))
      .filter(({ c, ctx }) => {
        if (!q) return true;
        if (c.name.toLowerCase().includes(q)) return true;
        if (ctx?.module.id.toLowerCase().includes(q)) return true;
        if (ctx && `g${ctx.grade}`.includes(q)) return true;
        return false;
      })
      .sort((a, b) => {
        if (!a.ctx || !b.ctx) return 0;
        if (a.ctx.module.id !== b.ctx.module.id) return a.ctx.module.id.localeCompare(b.ctx.module.id);
        if (a.ctx.grade !== b.ctx.grade) return a.ctx.grade - b.ctx.grade;
        return a.c.order - b.c.order;
      });
  }, [allConcepts, selfId, search]);

  const toggle = (id: Id<'exercises'>) => {
    setDraft((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md mx-auto max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Select prerequisites</DialogTitle>
        </DialogHeader>
        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search concepts across all units..."
            className="pl-8 h-9 text-sm"
            autoFocus
          />
        </div>
        <div className="flex-1 overflow-y-auto rounded-lg border border-border/60 divide-y divide-border/50">
          {candidates.length === 0 ? (
            <p className="text-xs text-muted-foreground p-4 text-center">No concepts match.</p>
          ) : (
            candidates.slice(0, 100).map(({ c, ctx }) => {
              const selected = draft.includes(c._id);
              return (
                <button
                  key={c._id}
                  onClick={() => toggle(c._id)}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 text-left transition-colors ${
                    selected ? 'bg-primary/10' : 'hover:bg-muted/60'
                  }`}
                >
                  {ctx && (
                    <span
                      className="font-mono text-[9px] font-bold rounded px-1 py-0.5 shrink-0"
                      style={{
                        backgroundColor: `${MODULE_COLORS[ctx.module.id]}22`,
                        color: MODULE_COLORS[ctx.module.id],
                      }}
                    >
                      {ctx.module.id}·G{ctx.grade}·T{ctx.term}
                    </span>
                  )}
                  <span className="text-xs flex-1 truncate">{c.name}</span>
                  {selected && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                </button>
              );
            })
          )}
        </div>
        <div className="flex gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">Cancel</Button>
          <Button onClick={() => onSave(draft)} className="flex-1">
            Save {draft.length > 0 && <Badge variant="secondary" className="ml-1.5 text-[9px] px-1">{draft.length}</Badge>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
