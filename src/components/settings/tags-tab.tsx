'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { Plus, Tag as TagIcon, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import { MODULE_COLORS } from '@/lib/types';
import { TagDetailDrawer } from './tag-detail-drawer';
import { toast } from 'sonner';
import { createPortal } from 'react-dom';
import { useEffect, useRef } from 'react';

type TagDoc = {
  _id: Id<'examTopicTags'>;
  name: string;
  description?: string;
  color?: string;
  moduleId?: string;
  createdAt: number;
};

const MODULE_FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'M1', label: 'M1' },
  { key: 'M2', label: 'M2' },
  { key: 'M3', label: 'M3' },
  { key: 'M4', label: 'M4' },
  { key: 'M5', label: 'M5' },
  { key: 'M6', label: 'M6' },
];

// ─── Create Tag Sheet (portal-based, no Dialog) ─────────────────────────────

interface CreateSheetProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

function CreateTagSheet({ open, onClose, onCreated }: CreateSheetProps) {
  const createTag = useMutation(api.topicTags.create);
  const [name, setName] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setModuleId('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) { toast.error('Tag name required'); return; }
    setSaving(true);
    try {
      await createTag({
        name: trimmed,
        moduleId: moduleId || undefined,
        color: moduleId ? MODULE_COLORS[moduleId] : undefined,
      });
      toast.success('Tag created');
      onCreated();
      onClose();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : 'Could not create tag');
    } finally {
      setSaving(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div
        className={`fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        style={{ zIndex: 9990 }}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create new tag"
        className={`fixed inset-x-0 bottom-0 bg-background rounded-t-2xl shadow-2xl transition-transform duration-300 ease-out ${
          open ? 'translate-y-0' : 'translate-y-full pointer-events-none'
        }`}
        style={{ zIndex: 9991 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
          <h2 className="text-base font-semibold">New topic tag</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-4 space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Name</label>
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Trigonometry"
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              className="w-full h-10 px-3 rounded-xl bg-muted border border-border/60 text-sm outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Module</label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setModuleId('')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  moduleId === ''
                    ? 'bg-muted-foreground text-background'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                None
              </button>
              {Object.entries(MODULE_COLORS).map(([m, color]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModuleId(m)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    moduleId === m ? 'ring-2 ring-offset-1' : 'opacity-60 hover:opacity-100'
                  }`}
                  style={{
                    backgroundColor: `${color}22`,
                    color,
                    ...(moduleId === m ? { outlineColor: color } : {}),
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Preview */}
          {name.trim() && (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">Preview</p>
              <div className="flex items-center gap-2">
                <span
                  className="w-1.5 h-6 rounded-full shrink-0"
                  style={{ backgroundColor: moduleId ? MODULE_COLORS[moduleId] : '#888' }}
                />
                {moduleId && (
                  <span
                    className="font-mono text-[9px] font-bold rounded px-1 py-0.5"
                    style={{
                      backgroundColor: `${MODULE_COLORS[moduleId]}22`,
                      color: MODULE_COLORS[moduleId],
                    }}
                  >
                    {moduleId}
                  </span>
                )}
                <span className="text-sm font-medium">{name.trim()}</span>
              </div>
            </div>
          )}

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
              onClick={handleCreate}
              disabled={saving || !name.trim()}
              className="flex-1 h-11 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving && <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />}
              Create tag
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}

// ─── Main TagsTab ─────────────────────────────────────────────────────────────

export function TagsTab() {
  const tags = useQuery(api.topicTags.list) as TagDoc[] | undefined;
  const counts = useQuery(api.topicTags.getQuestionCounts) as
    | Record<string, number>
    | undefined;

  const [moduleFilter, setModuleFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [activeTagId, setActiveTagId] = useState<Id<'examTopicTags'> | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!tags) return [] as TagDoc[];
    let list = moduleFilter === 'all' ? tags : tags.filter((t) => t.moduleId === moduleFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          (t.description ?? '').toLowerCase().includes(q) ||
          (t.moduleId ?? '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [tags, moduleFilter, search]);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Topic tags</h2>
          <p className="text-[11px] text-muted-foreground">
            Broad tags linking past-paper questions to curriculum units.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setCreateOpen(true)}
          className="gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" /> New
        </Button>
      </div>

      {/* Module filter */}
      <div className="flex gap-1 p-1 bg-muted rounded-xl overflow-x-auto no-scrollbar">
        {MODULE_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setModuleFilter(f.key)}
            className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-medium transition-all whitespace-nowrap ${
              moduleFilter === f.key
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            style={
              moduleFilter === f.key && f.key !== 'all'
                ? { color: MODULE_COLORS[f.key] }
                : undefined
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Search */}
      {tags && tags.length > 5 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tags…"
            className="w-full h-9 pl-9 pr-4 rounded-xl bg-muted border border-border/60 text-sm outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-muted-foreground/20 flex items-center justify-center"
            >
              <X className="w-3 h-3 text-muted-foreground" />
            </button>
          )}
        </div>
      )}

      {/* List */}
      {tags === undefined ? (
        <div className="space-y-1.5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 px-4 py-10 text-center">
          <TagIcon className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
          <p className="text-xs text-muted-foreground mb-1">
            {tags.length === 0
              ? 'No tags yet.'
              : search
              ? 'No tags match your search.'
              : 'No tags in this module.'}
          </p>
          {tags.length === 0 && (
            <p className="text-[10px] text-muted-foreground">
              Run the seed via{' '}
              <code className="font-mono">npx convex run seeds/topicTags:seedAll</code>
              , or create one manually with the button above.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          {/* Summary row */}
          {tags.length > 0 && (
            <p className="text-[10px] text-muted-foreground px-0.5">
              {filtered.length} tag{filtered.length !== 1 ? 's' : ''}
              {moduleFilter !== 'all' && ` in ${moduleFilter}`}
              {search && ` matching "${search}"`}
            </p>
          )}

          {filtered.map((t) => {
            const tagColor = t.color ?? MODULE_COLORS[t.moduleId ?? ''] ?? '#888';
            const questionCount = counts?.[t._id] ?? 0;
            return (
              <button
                key={t._id}
                onClick={() => {
                  setActiveTagId(t._id);
                  setDrawerOpen(true);
                }}
                className="w-full flex items-stretch rounded-xl border border-border/60 bg-card hover:bg-muted/40 hover:border-border active:scale-[0.98] transition-all text-left overflow-hidden group"
              >
                {/* Color stripe */}
                <span
                  className="w-1 shrink-0 transition-all group-hover:w-1.5"
                  style={{ backgroundColor: tagColor }}
                />

                <div className="flex-1 px-3 py-2.5 flex items-center gap-2 min-w-0">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {t.moduleId && (
                        <span
                          className="font-mono text-[9px] font-bold rounded px-1 py-0.5 shrink-0"
                          style={{
                            backgroundColor: `${MODULE_COLORS[t.moduleId] ?? '#888'}22`,
                            color: MODULE_COLORS[t.moduleId] ?? '#888',
                          }}
                        >
                          {t.moduleId}
                        </span>
                      )}
                      <span className="text-sm font-medium text-foreground truncate">
                        {t.name}
                      </span>
                    </div>
                    {t.description && (
                      <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                        {t.description}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {questionCount > 0 && (
                      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[9px] font-medium text-muted-foreground">
                        {questionCount}q
                      </span>
                    )}
                    <svg className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Create sheet */}
      <CreateTagSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {}}
      />

      {/* Detail drawer */}
      <TagDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        tagId={activeTagId}
        onDeleted={() => setActiveTagId(null)}
      />
    </div>
  );
}
