'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { Plus, Tag as TagIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import { MODULE_COLORS } from '@/lib/types';
import { TagDetailDrawer } from './tag-detail-drawer';
import { toast } from 'sonner';

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

export function TagsTab() {
  const tags = useQuery(api.topicTags.list) as TagDoc[] | undefined;
  const counts = useQuery(api.topicTags.getQuestionCounts) as
    | Record<string, number>
    | undefined;
  const createTag = useMutation(api.topicTags.create);

  const [moduleFilter, setModuleFilter] = useState<string>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newModuleId, setNewModuleId] = useState<string>('');
  const [activeTagId, setActiveTagId] = useState<Id<'examTopicTags'> | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!tags) return [] as TagDoc[];
    if (moduleFilter === 'all') return tags;
    return tags.filter((t) => t.moduleId === moduleFilter);
  }, [tags, moduleFilter]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error('Tag name required');
      return;
    }
    try {
      await createTag({
        name,
        moduleId: newModuleId || undefined,
        color: newModuleId ? MODULE_COLORS[newModuleId] : undefined,
      });
      toast.success('Tag created');
      setNewName('');
      setNewModuleId('');
      setCreateOpen(false);
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : 'Could not create tag');
    }
  };

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
          onClick={() => {
            setNewName('');
            setNewModuleId('');
            setCreateOpen(true);
          }}
          className="gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" /> New
        </Button>
      </div>

      {/* Module filter */}
      <div className="flex gap-1 p-1 bg-muted rounded-xl overflow-x-auto">
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
            {tags.length === 0 ? 'No tags yet.' : 'No tags in this module.'}
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
          {filtered.map((t) => (
            <button
              key={t._id}
              onClick={() => {
                setActiveTagId(t._id);
                setDrawerOpen(true);
              }}
              className="w-full flex items-stretch rounded-lg border border-border/60 bg-card hover:bg-muted/40 transition-colors text-left overflow-hidden"
            >
              <span
                className="w-1 shrink-0"
                style={{
                  backgroundColor: t.color ?? MODULE_COLORS[t.moduleId ?? ''] ?? '#888',
                }}
              />
              <div className="flex-1 px-3 py-2.5 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {t.moduleId && (
                      <span
                        className="font-mono text-[9px] font-bold rounded px-1 py-0.5"
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
                {counts && counts[t._id] !== undefined && counts[t._id] > 0 && (
                  <Badge variant="secondary" className="text-[9px] px-1.5">
                    {counts[t._id]} q
                  </Badge>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm mx-auto">
          <DialogHeader>
            <DialogTitle>New topic tag</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Name
              </Label>
              <Input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Trigonometry"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Module
              </Label>
              <select
                value={newModuleId}
                onChange={(e) => setNewModuleId(e.target.value)}
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
            <Button onClick={handleCreate} className="w-full rounded-xl">
              Create
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
