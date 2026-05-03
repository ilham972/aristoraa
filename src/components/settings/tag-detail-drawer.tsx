'use client';

import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation } from 'convex/react';
import { Trash2, Pencil, Link2, X, Video } from 'lucide-react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Label } from '@/components/ui/label';
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

// ─── Standalone Edit Sheet rendered as a portal ──────────────────────────────

interface EditSheetProps {
  open: boolean;
  onClose: () => void;
  tag: {
    _id: Id<'examTopicTags'>;
    name: string;
    color?: string;
    description?: string;
    moduleId?: string;
  };
  onSaved: () => void;
}

function EditTagSheet({ open, onClose, tag, onSaved }: EditSheetProps) {
  const updateTag = useMutation(api.topicTags.update);
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color ?? '');
  const [description, setDescription] = useState(tag.description ?? '');
  const [moduleId, setModuleId] = useState(tag.moduleId ?? '');
  const [saving, setSaving] = useState(false);

  // Reset form whenever sheet opens for this tag
  useEffect(() => {
    if (open) {
      setName(tag.name);
      setColor(tag.color ?? '');
      setDescription(tag.description ?? '');
      setModuleId(tag.moduleId ?? '');
    }
  }, [open, tag.name, tag.color, tag.description, tag.moduleId]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      await updateTag({
        id: tag._id,
        name: trimmedName,
        color: color.trim() || undefined,
        description: description.trim() || undefined,
        moduleId: moduleId.trim() || undefined,
      });
      toast.success('Tag saved');
      onSaved();
      onClose();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        style={{ zIndex: 9996 }}
        onClick={onClose}
      />

      {/* Sheet panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit tag"
        className={`fixed inset-x-0 bottom-0 bg-background rounded-t-2xl shadow-2xl transition-transform duration-300 ease-out ${
          open ? 'translate-y-0' : 'translate-y-full pointer-events-none'
        }`}
        style={{ zIndex: 9997 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
          <h2 className="text-base font-semibold">Edit tag</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <div className="px-4 py-4 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Name</Label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tag name"
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
              className="w-full h-10 px-3 rounded-xl bg-muted border border-border/60 text-sm outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Module</Label>
              <select
                value={moduleId}
                onChange={(e) => setModuleId(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-muted border border-border/60 text-sm outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all appearance-none"
              >
                <option value="">none</option>
                {Object.keys(MODULE_COLORS).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Color</Label>
              <input
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#1B4F72"
                className="w-full h-10 px-3 rounded-xl bg-muted border border-border/60 text-sm font-mono outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Description</Label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional teacher note"
              rows={2}
              className="w-full px-3 py-2.5 rounded-xl bg-muted border border-border/60 text-sm resize-none outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
            />
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 h-11 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex-1 h-11 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving && <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />}
              Save changes
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}

// ─── Main Drawer ─────────────────────────────────────────────────────────────

export function TagDetailDrawer({ open, onOpenChange, tagId, onDeleted }: Props) {
  const detail = useQuery(api.topicTags.getById, tagId ? { id: tagId } : 'skip');
  const linkedConcepts = useQuery(
    api.topicTags.getLinkedConcepts,
    tagId ? { tagId } : 'skip',
  );

  const removeTag = useMutation(api.topicTags.remove);
  const setLinks = useMutation(api.topicTags.setUnitLinks);

  const [editOpen, setEditOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const links = detail?.links ?? [];
  const tag = detail?.tag;
  const selectedUnitIds = useMemo(() => links.map((l) => l.unitId), [links]);

  // Close sub-panels when drawer closes
  useEffect(() => {
    if (!open) {
      setEditOpen(false);
      setPickerOpen(false);
    }
  }, [open]);

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
    <>
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
                    onClick={() => setEditOpen(true)}
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
                  className="ml-auto text-[10px] font-medium text-primary hover:underline"
                >
                  {links.length > 0 ? 'Edit' : '+ Add'}
                </button>
              </div>

              {links.length === 0 ? (
                <button
                  onClick={() => setPickerOpen(true)}
                  className="w-full rounded-xl border border-dashed border-border/60 bg-muted/30 px-3 py-4 text-center hover:bg-muted/50 transition-colors"
                >
                  <p className="text-[11px] text-muted-foreground">
                    No units linked yet. Tap to pick from the curriculum.
                  </p>
                </button>
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
        </DrawerContent>
      </Drawer>

      {/* Edit sheet – rendered completely outside the Drawer */}
      {tag && (
        <EditTagSheet
          open={editOpen}
          onClose={() => setEditOpen(false)}
          tag={tag}
          onSaved={() => {}}
        />
      )}

      {/* Unit picker – rendered completely outside the Drawer */}
      <TagUnitPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        selectedUnitIds={selectedUnitIds}
        onSave={handleSavePicker}
      />
    </>
  );
}

// ─── Derived concepts grouped by grade ───────────────────────────────────────

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
