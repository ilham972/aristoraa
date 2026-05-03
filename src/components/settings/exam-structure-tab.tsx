'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import { MODULE_COLORS } from '@/lib/types';
import { PaperSlotConfigPopover } from './paper-slot-config-popover';
import { toast } from 'sonner';
import { createPortal } from 'react-dom';

const GRADES = [6, 7, 8, 9, 10, 11];

type Tag = {
  _id: Id<'examTopicTags'>;
  name: string;
  color?: string;
  moduleId?: string;
};

type Part = {
  _id: Id<'paperStructureParts'>;
  structureId: Id<'paperStructures'>;
  partCode: string;
  partLabel: string;
  questionCount: number;
  marksPerQuestion: number;
  requiredCount: number;
  order: number;
  notes?: string;
};

type SlotTag = {
  _id: Id<'paperStructureSlotTags'>;
  partId: Id<'paperStructureParts'>;
  slotNumber: number;
  tagId: Id<'examTopicTags'>;
  mode: string;
};

export function ExamStructureTab() {
  const [grade, setGrade] = useState<number>(10);

  const data = useQuery(api.paperStructures.getByGrade, { grade });
  const allTags = useQuery(api.topicTags.list) as Tag[] | undefined;

  const [editingPart, setEditingPart] = useState<Part | null>(null);
  const [addPartOpen, setAddPartOpen] = useState(false);
  const [slotConfig, setSlotConfig] = useState<{
    partId: Id<'paperStructureParts'>;
    partCode: string;
    slotNumber: number;
  } | null>(null);

  if (data === undefined || allTags === undefined) {
    return (
      <div className="space-y-3">
        <div className="h-9 bg-muted rounded-xl animate-pulse" />
        <div className="h-32 bg-muted rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Exam structure</h2>
        <p className="text-[11px] text-muted-foreground">
          National paper shape per grade. Drives slot identity in past-paper crops.
        </p>
      </div>

      {/* Grade selector */}
      <div className="flex gap-1 p-1 bg-muted rounded-xl overflow-x-auto no-scrollbar">
        {GRADES.map((g) => (
          <button
            key={g}
            onClick={() => setGrade(g)}
            className={`flex-1 py-1.5 px-2 rounded-lg text-[12px] font-mono font-semibold transition-all whitespace-nowrap ${
              grade === g
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            G{g}
          </button>
        ))}
      </div>

      {data === null ? (
        <NoStructureForGrade grade={grade} />
      ) : (
        <ExamStructureBody
          grade={grade}
          structureId={data.structure._id}
          divisionFactor={data.structure.divisionFactor}
          totalRawMarks={data.structure.totalRawMarks}
          scaledTotal={data.structure.scaledTotal}
          parts={data.parts}
          slotTags={data.slotTags}
          allTags={allTags}
          onEditPart={(p) => setEditingPart(p)}
          onAddPart={() => setAddPartOpen(true)}
          onConfigSlot={(partId, partCode, slotNumber) =>
            setSlotConfig({ partId, partCode, slotNumber })
          }
        />
      )}

      {/* Edit part sheet */}
      {editingPart && (
        <EditPartSheet
          open={true}
          onClose={() => setEditingPart(null)}
          part={editingPart}
        />
      )}

      {/* Add part sheet */}
      {data && addPartOpen && (
        <AddPartSheet
          open={true}
          onClose={() => setAddPartOpen(false)}
          structureId={data.structure._id}
          existingPartCodes={data.parts.map((p) => p.partCode)}
          nextOrder={
            data.parts.length === 0
              ? 1
              : Math.max(...data.parts.map((p) => p.order)) + 1
          }
        />
      )}

      {/* Slot config popover */}
      <PaperSlotConfigPopover
        open={!!slotConfig}
        onClose={() => setSlotConfig(null)}
        partId={slotConfig?.partId ?? null}
        partCode={slotConfig?.partCode ?? ''}
        slotNumber={slotConfig?.slotNumber ?? 0}
        grade={grade}
        slotTagsAtSlot={
          slotConfig
            ? (data?.slotTags ?? []).filter(
                (s) =>
                  s.partId === slotConfig.partId &&
                  s.slotNumber === slotConfig.slotNumber,
              )
            : []
        }
        allTags={allTags}
      />
    </div>
  );
}

// ─── No structure → seed CTA ────────────────────────────────────────────

function NoStructureForGrade({ grade }: { grade: number }) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 p-6 text-center space-y-2">
      <p className="text-sm text-foreground">No structure for Grade {grade} yet.</p>
      <p className="text-[11px] text-muted-foreground">
        Run the seed to create defaults for all grades:
      </p>
      <code className="text-[10px] font-mono bg-background px-2 py-1 rounded border border-border inline-block">
        npx convex run seeds/paperStructures:seedDefaults
      </code>
      <p className="text-[10px] text-muted-foreground/70 pt-1">
        Or build a custom structure via the create-structure mutation.
      </p>
    </div>
  );
}

// ─── Body: structure summary + parts ────────────────────────────────────

interface BodyProps {
  grade: number;
  structureId: Id<'paperStructures'>;
  divisionFactor: number;
  totalRawMarks: number;
  scaledTotal: number;
  parts: Part[];
  slotTags: SlotTag[];
  allTags: Tag[];
  onEditPart: (p: Part) => void;
  onAddPart: () => void;
  onConfigSlot: (
    partId: Id<'paperStructureParts'>,
    partCode: string,
    slotNumber: number,
  ) => void;
}

function ExamStructureBody({
  grade,
  divisionFactor,
  totalRawMarks,
  scaledTotal,
  parts,
  slotTags,
  allTags,
  onEditPart,
  onAddPart,
  onConfigSlot,
}: BodyProps) {
  const tagById = useMemo(() => {
    const m = new Map<string, Tag>();
    for (const t of allTags) m.set(t._id, t);
    return m;
  }, [allTags]);

  const slotTagsByPartSlot = useMemo(() => {
    const m = new Map<string, SlotTag[]>();
    for (const s of slotTags) {
      const k = `${s.partId}:${s.slotNumber}`;
      const arr = m.get(k) ?? [];
      arr.push(s);
      m.set(k, arr);
    }
    return m;
  }, [slotTags]);

  return (
    <>
      {/* Total summary */}
      <div className="rounded-xl border border-border/60 bg-card px-3 py-2.5 flex items-baseline gap-3">
        <div className="flex-1">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Grade {grade}</p>
          <p className="text-sm font-semibold">
            Raw {totalRawMarks} → scaled {scaledTotal}
            {divisionFactor !== 1 && (
              <span className="text-muted-foreground font-normal"> (÷{divisionFactor})</span>
            )}
          </p>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {parts.length} part{parts.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Parts */}
      {parts.length === 0 ? (
        <p className="text-xs text-muted-foreground italic text-center py-6">
          No parts yet.
        </p>
      ) : (
        <div className="space-y-2.5">
          {parts.map((p) => (
            <PartCard
              key={p._id}
              part={p}
              slotTagsByPartSlot={slotTagsByPartSlot}
              tagById={tagById}
              onEdit={() => onEditPart(p)}
              onConfigSlot={(slot) => onConfigSlot(p._id, p.partCode, slot)}
            />
          ))}
        </div>
      )}

      <Button
        variant="outline"
        size="sm"
        onClick={onAddPart}
        className="w-full rounded-xl gap-1.5 border-dashed"
      >
        <Plus className="w-3.5 h-3.5" /> Add part
      </Button>
    </>
  );
}

// ─── Part card with slot grid ────────────────────────────────────────────

interface PartCardProps {
  part: Part;
  slotTagsByPartSlot: Map<string, SlotTag[]>;
  tagById: Map<string, Tag>;
  onEdit: () => void;
  onConfigSlot: (slotNumber: number) => void;
}

function PartCard({ part, slotTagsByPartSlot, tagById, onEdit, onConfigSlot }: PartCardProps) {
  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
      <div className="px-3 py-2.5 flex items-center gap-2 border-b border-border/40">
        <span className="font-mono text-[10px] font-bold rounded px-1.5 py-0.5 bg-primary/10 text-primary shrink-0">
          {part.partCode}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground truncate">{part.partLabel}</p>
          <p className="text-[10px] text-muted-foreground">
            {part.questionCount} × {part.marksPerQuestion}m · req {part.requiredCount}/
            {part.questionCount}
          </p>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
          aria-label="Edit part"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Slot grid */}
      <div className="px-3 py-3">
        <div className="grid grid-cols-5 gap-1.5">
          {Array.from({ length: part.questionCount }, (_, i) => i + 1).map((slot) => {
            const slotTags = slotTagsByPartSlot.get(`${part._id}:${slot}`) ?? [];
            const permanent = slotTags.find((s) => s.mode === 'permanent');
            const optionsCount = slotTags.filter((s) => s.mode === 'option').length;
            const tag = permanent ? tagById.get(permanent.tagId) : undefined;
            const color = tag?.color ?? MODULE_COLORS[tag?.moduleId ?? ''] ?? '#888';
            return (
              <button
                key={slot}
                type="button"
                onClick={() => onConfigSlot(slot)}
                className={`relative aspect-square rounded-lg border flex flex-col items-center justify-center text-[10px] font-mono font-semibold transition-all active:scale-95 ${
                  permanent
                    ? 'border-transparent text-foreground'
                    : optionsCount > 0
                      ? 'border-border bg-muted/50 text-foreground'
                      : 'border-dashed border-border/60 text-muted-foreground/70 hover:border-border hover:text-foreground'
                }`}
                style={
                  permanent
                    ? {
                        backgroundColor: `${color}1F`,
                        borderColor: `${color}60`,
                      }
                    : undefined
                }
                aria-label={`Configure slot ${part.partCode}.${slot}`}
              >
                <span>{slot}</span>
                {permanent && tag && (
                  <span
                    className="text-[7px] truncate w-full px-0.5 leading-tight font-normal"
                    style={{ color }}
                  >
                    {tag.name}
                  </span>
                )}
                {!permanent && optionsCount > 0 && (
                  <span className="text-[7px] text-muted-foreground leading-tight font-normal">
                    {optionsCount} opt
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Edit part sheet ─────────────────────────────────────────────────────

function EditPartSheet({
  open,
  onClose,
  part,
}: {
  open: boolean;
  onClose: () => void;
  part: Part;
}) {
  const updatePart = useMutation(api.paperStructures.updatePart);
  const removePart = useMutation(api.paperStructures.removePart);

  const [partLabel, setPartLabel] = useState(part.partLabel);
  const [questionCount, setQuestionCount] = useState(String(part.questionCount));
  const [marksPerQuestion, setMarksPerQuestion] = useState(
    String(part.marksPerQuestion),
  );
  const [requiredCount, setRequiredCount] = useState(String(part.requiredCount));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setPartLabel(part.partLabel);
      setQuestionCount(String(part.questionCount));
      setMarksPerQuestion(String(part.marksPerQuestion));
      setRequiredCount(String(part.requiredCount));
    }
  }, [open, part]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handleSave = async () => {
    const qc = parseInt(questionCount, 10);
    const mq = parseInt(marksPerQuestion, 10);
    const rc = parseInt(requiredCount, 10);
    if (isNaN(qc) || qc < 1) { toast.error('Question count must be ≥ 1'); return; }
    if (isNaN(mq) || mq < 1) { toast.error('Marks per question must be ≥ 1'); return; }
    if (isNaN(rc) || rc < 0 || rc > qc) {
      toast.error('Required count must be 0..questionCount');
      return;
    }
    if (!partLabel.trim()) { toast.error('Label required'); return; }
    setSaving(true);
    try {
      await updatePart({
        id: part._id,
        partLabel: partLabel.trim(),
        questionCount: qc,
        marksPerQuestion: mq,
        requiredCount: rc,
      });
      toast.success('Part saved');
      onClose();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (
      !confirm(
        `Delete part "${part.partCode}"?\n\nThis removes the part and any slot tag configurations attached to it.`,
      )
    )
      return;
    setSaving(true);
    try {
      await removePart({ id: part._id });
      toast.success('Part deleted');
      onClose();
    } catch (e) {
      console.error(e);
      toast.error('Could not delete');
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
        aria-label={`Edit part ${part.partCode}`}
        className={`fixed inset-x-0 bottom-0 bg-background rounded-t-2xl shadow-2xl transition-transform duration-300 ease-out max-h-[90vh] flex flex-col ${
          open ? 'translate-y-0' : 'translate-y-full pointer-events-none'
        }`}
        style={{ zIndex: 9991 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 shrink-0">
          <h2 className="text-base font-semibold">
            Edit part <span className="font-mono text-primary">{part.partCode}</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
              Label
            </label>
            <input
              value={partLabel}
              onChange={(e) => setPartLabel(e.target.value)}
              className="w-full h-10 px-3 rounded-xl bg-muted border border-border/60 text-sm outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
            />
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                Qs
              </label>
              <input
                type="number"
                value={questionCount}
                onChange={(e) => setQuestionCount(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-muted border border-border/60 text-sm font-mono outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                min={1}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                Marks
              </label>
              <input
                type="number"
                value={marksPerQuestion}
                onChange={(e) => setMarksPerQuestion(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-muted border border-border/60 text-sm font-mono outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                min={1}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                Req
              </label>
              <input
                type="number"
                value={requiredCount}
                onChange={(e) => setRequiredCount(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-muted border border-border/60 text-sm font-mono outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                min={0}
              />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Shrinking question count cascades-deletes slot tags above the new max.
          </p>
        </div>
        <div className="flex gap-3 px-4 py-3 border-t border-border/60 shrink-0">
          <button
            type="button"
            onClick={handleDelete}
            disabled={saving}
            className="h-11 px-4 rounded-xl border border-destructive/30 text-destructive text-sm font-medium hover:bg-destructive/10 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
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
            className="flex-1 h-11 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

// ─── Add part sheet ──────────────────────────────────────────────────────

function AddPartSheet({
  open,
  onClose,
  structureId,
  existingPartCodes,
  nextOrder,
}: {
  open: boolean;
  onClose: () => void;
  structureId: Id<'paperStructures'>;
  existingPartCodes: string[];
  nextOrder: number;
}) {
  const addPart = useMutation(api.paperStructures.addPart);

  const [partCode, setPartCode] = useState('');
  const [partLabel, setPartLabel] = useState('');
  const [questionCount, setQuestionCount] = useState('5');
  const [marksPerQuestion, setMarksPerQuestion] = useState('10');
  const [requiredCount, setRequiredCount] = useState('5');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setPartCode('');
      setPartLabel('');
      setQuestionCount('5');
      setMarksPerQuestion('10');
      setRequiredCount('5');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handleSave = async () => {
    const code = partCode.trim();
    if (!code) { toast.error('Part code required'); return; }
    if (existingPartCodes.includes(code)) {
      toast.error(`Part code "${code}" already exists`);
      return;
    }
    if (!partLabel.trim()) { toast.error('Label required'); return; }
    const qc = parseInt(questionCount, 10);
    const mq = parseInt(marksPerQuestion, 10);
    const rc = parseInt(requiredCount, 10);
    if (isNaN(qc) || qc < 1) { toast.error('Question count must be ≥ 1'); return; }
    if (isNaN(mq) || mq < 1) { toast.error('Marks per question must be ≥ 1'); return; }
    if (isNaN(rc) || rc < 0 || rc > qc) {
      toast.error('Required count must be 0..questionCount');
      return;
    }
    setSaving(true);
    try {
      await addPart({
        structureId,
        partCode: code,
        partLabel: partLabel.trim(),
        questionCount: qc,
        marksPerQuestion: mq,
        requiredCount: rc,
        order: nextOrder,
      });
      toast.success('Part added');
      onClose();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : 'Could not add');
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
        aria-label="Add part"
        className={`fixed inset-x-0 bottom-0 bg-background rounded-t-2xl shadow-2xl transition-transform duration-300 ease-out max-h-[90vh] flex flex-col ${
          open ? 'translate-y-0' : 'translate-y-full pointer-events-none'
        }`}
        style={{ zIndex: 9991 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 shrink-0">
          <h2 className="text-base font-semibold">Add part</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          <div className="grid grid-cols-3 gap-2.5">
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                Code
              </label>
              <input
                value={partCode}
                onChange={(e) => setPartCode(e.target.value)}
                placeholder="2C"
                className="w-full h-10 px-3 rounded-xl bg-muted border border-border/60 text-sm font-mono outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                Label
              </label>
              <input
                value={partLabel}
                onChange={(e) => setPartLabel(e.target.value)}
                placeholder="Part II Section C — …"
                className="w-full h-10 px-3 rounded-xl bg-muted border border-border/60 text-sm outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                Qs
              </label>
              <input
                type="number"
                value={questionCount}
                onChange={(e) => setQuestionCount(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-muted border border-border/60 text-sm font-mono outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                min={1}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                Marks
              </label>
              <input
                type="number"
                value={marksPerQuestion}
                onChange={(e) => setMarksPerQuestion(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-muted border border-border/60 text-sm font-mono outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                min={1}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                Req
              </label>
              <input
                type="number"
                value={requiredCount}
                onChange={(e) => setRequiredCount(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-muted border border-border/60 text-sm font-mono outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                min={0}
              />
            </div>
          </div>
        </div>
        <div className="flex gap-3 px-4 py-3 border-t border-border/60 shrink-0">
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
            className="flex-1 h-11 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
