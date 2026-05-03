'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { Trash2, Pencil, Link2, X, Video } from 'lucide-react';
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
import { TagUnitPicker } from './tag-unit-picker';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tagId: Id<'examTopicTags'> | null;
  onDeleted?: () => void;
}

export function TagDetailDrawer({ open, onOpenChange, tagId, onDeleted }: Props) {
  const detail = useQuery(api.topicTags.getById, tagId ? { id: tagId } : 'skip');
  const linkedConcepts = useQuery(
    api.topicTags.getLinkedConcepts,
    tagId ? { tagId } : 'skip',
  );

  const updateTag = useMutation(api.topicTags.update);
  const removeTag = useMutation(api.topicTags.remove);
  const setLinks = useMutation(api.topicTags.setUnitLinks);

  const [editOpen, setEditOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editModuleId, setEditModuleId] = useState('');

  const links = detail?.links ?? [];
  const tag = detail?.tag;

  const selectedUnitIds = useMemo(() => links.map((l) => l.unitId), [links]);

  const handleEditOpen = () => {
    if (!tag) return;
    setEditName(tag.name);
    setEditColor(tag.color ?? '');
    setEditDescription(tag.description ?? '');
    setEditModuleId(tag.moduleId ?? '');
    setEditOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!tag) return;
    try {
      await updateTag({
        id: tag._id,
        name: editName.trim(),
        color: editColor.trim() || undefined,
        description: editDescription.trim() || undefined,
        moduleId: editModuleId.trim() || undefined,
      });
      toast.success('Saved');
      setEditOpen(false);
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : 'Could not save');
    }
  };

  const handleDelete = async () => {
    if (!tag) return;
    if (
      !confirm(
        `Delete tag "${tag.name}"?\n\nThis will:\n• unlink all questions tagged with it\n• remove all paper-structure slot configurations referencing it\n\nThis cannot be undone.`,
      )
    )
      return;
    try {
      await removeTag({ id: tag._id });
      toast.success('Tag deleted');
      onDeleted?.();
      onOpenChange(false);
    } catch (e) {
      console.error(e);
      toast.error('Could not delete');
    }
  };

  const handleSavePicker = async (units: { unitId: string; grade: number; term: number; moduleId: string }[]) => {
    if (!tag) return;
    try {
      await setLinks({ tagId: tag._id, units });
      toast.success(`Linked ${units.length} unit${units.length === 1 ? '' : 's'}`);
    } catch (e) {
      console.error(e);
      toast.error('Could not save links');
    }
  };

  return (
    <Drawer direction="right" open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="flex items-center gap-2">
            {tag && (
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: tag.color ?? MODULE_COLORS[tag.moduleId ?? ''] ?? '#888' }}
              />
            )}
            <span className="text-sm truncate flex-1">{tag?.name ?? '...'}</span>
            {tag && (
              <>
                <button
                  onClick={handleEditOpen}
                  className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Edit"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleDelete}
                  className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                  aria-label="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </DrawerTitle>
        </DrawerHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-4 no-scrollbar space-y-4">
          {tag?.description && (
            <p className="text-xs text-muted-foreground italic">{tag.description}</p>
          )}

          {/* Linked units section */}
          <section className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5 text-muted-foreground" />
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Linked units {links.length > 0 && <span className="lowercase">({links.length})</span>}
              </Label>
              <button
                onClick={() => setPickerOpen(true)}
                className="ml-auto text-[10px] text-primary hover:underline"
              >
                {links.length > 0 ? 'Edit' : '+ Add'}
              </button>
            </div>
            {links.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 px-3 py-4 text-center">
                <p className="text-[11px] text-muted-foreground">
                  No units linked yet. Tap “Add” to pick from the curriculum.
                </p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1">
                {links.map((l) => {
                  const ctx = findUnit(l.unitId);
                  return (
                    <span
                      key={l._id}
                      className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px]"
                    >
                      <span
                        className="font-mono text-[8px] font-bold"
                        style={{ color: MODULE_COLORS[l.moduleId] }}
                      >
                        {l.moduleId}·G{l.grade}·T{l.term}
                      </span>
                      <span className="truncate max-w-[160px]">
                        {ctx?.unit.name ?? '(unknown unit)'}
                      </span>
                    </span>
                  );
                })}
              </div>
            )}
          </section>

          {/* Derived concepts section */}
          <section className="space-y-2">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Concepts in linked units
            </Label>
            {linkedConcepts === undefined ? (
              <div className="space-y-1.5">
                <div className="h-12 bg-muted rounded-lg animate-pulse" />
                <div className="h-12 bg-muted rounded-lg animate-pulse" />
              </div>
            ) : linkedConcepts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 px-3 py-4 text-center">
                <p className="text-[11px] text-muted-foreground">
                  Link some units above to see their concepts here.
                </p>
              </div>
            ) : (
              <ConceptsByGrade groups={linkedConcepts} />
            )}
          </section>
        </div>

        {/* Edit dialog */}
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="max-w-sm mx-auto">
            <DialogHeader>
              <DialogTitle>Edit tag</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Name</Label>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Tag name"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Module</Label>
                  <select
                    value={editModuleId}
                    onChange={(e) => setEditModuleId(e.target.value)}
                    className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">none</option>
                    {Object.keys(MODULE_COLORS).map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Color</Label>
                  <Input
                    value={editColor}
                    onChange={(e) => setEditColor(e.target.value)}
                    placeholder="#1B4F72"
                    className="font-mono text-xs"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Description</Label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Optional teacher note"
                  rows={2}
                  className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <Button variant="outline" onClick={() => setEditOpen(false)} className="flex-1">
                  Cancel
                </Button>
                <Button onClick={handleSaveEdit} className="flex-1">
                  Save
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {tag && (
          <TagUnitPicker
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            selectedUnitIds={selectedUnitIds}
            onSave={handleSavePicker}
          />
        )}
      </DrawerContent>
    </Drawer>
  );
}

// ─── Derived concepts grouped by grade ───

type Group = {
  unitId: string;
  grade: number;
  term: number;
  moduleId: string;
  concepts: { _id: Id<'exercises'>; name: string; videoUrl?: string }[];
};

function ConceptsByGrade({ groups }: { groups: Group[] }) {
  const byGrade = useMemo(() => {
    const m = new Map<number, Group[]>();
    for (const g of groups) {
      if (!m.has(g.grade)) m.set(g.grade, []);
      m.get(g.grade)!.push(g);
    }
    return Array.from(m.entries()).sort((a, b) => a[0] - b[0]);
  }, [groups]);

  return (
    <div className="space-y-3">
      {byGrade.map(([grade, list]) => (
        <div key={grade} className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Grade {grade}
          </div>
          {list.map((g) => {
            const unit = findUnit(g.unitId);
            return (
              <div key={g.unitId} className="rounded-lg border border-border/60 bg-card p-2.5 space-y-1.5">
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span
                    className="font-mono font-bold"
                    style={{ color: MODULE_COLORS[g.moduleId] }}
                  >
                    {g.moduleId}·T{g.term}
                  </span>
                  <span className="text-foreground truncate flex-1">
                    {unit?.unit.name ?? '(unknown unit)'}
                  </span>
                </div>
                {g.concepts.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground italic">
                    No concepts seeded for this unit yet.
                  </p>
                ) : (
                  <ul className="space-y-0.5 pl-1">
                    {g.concepts.map((c) => (
                      <li key={c._id} className="flex items-center gap-1.5 text-[11px]">
                        <span className="w-1 h-1 rounded-full bg-muted-foreground shrink-0" />
                        <span className="flex-1 truncate">{c.name}</span>
                        {c.videoUrl && (
                          <Video className="w-2.5 h-2.5 text-violet-500 shrink-0" />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
