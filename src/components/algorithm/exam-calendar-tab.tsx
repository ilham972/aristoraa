'use client';

// Exam Calendar tab — grid redesign (2026-07-15). Columns = terms (1/2/3),
// rows = grades (6..11), one year at a time (year stepper on top). Every cell
// is either an exam date (tap to edit/delete) or a subtle + (tap to add for
// that exact grade+term+year — no way to create a conflicting key). A global
// "Quick entry" button sets one date per term across ALL grades at once.
//
// CRUD still goes through the untouched examCalendar backend (upsert /
// updateById / remove). Drives the SR exam-date backstop, retention-debt
// "marks at risk", the Phase G predictor, AND every planner runway verdict.

import { useMemo, useState, useCallback } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { ChevronLeft, ChevronRight, Trash2, Plus, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api, type Id } from '@/lib/convex';
import { toast } from 'sonner';

const GRADES = [6, 7, 8, 9, 10, 11];
const TERMS: Array<1 | 2 | 3> = [1, 2, 3];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

const TODAY_YMD = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function daysFromNow(ymd: string): number | null {
  const t0 = Date.parse(`${TODAY_YMD()}T00:00:00.000Z`);
  const t1 = Date.parse(`${ymd}T00:00:00.000Z`);
  if (Number.isNaN(t0) || Number.isNaN(t1)) return null;
  return Math.round((t1 - t0) / 86_400_000);
}

// "2026-03-12" → "12 Mar"
function fmtShort(ymd: string): string {
  const m = YMD_RE.exec(ymd);
  if (!m) return ymd;
  const [, mm, dd] = ymd.split('-');
  return `${Number(dd)} ${MONTHS[Number(mm) - 1] ?? mm}`;
}

// Compact countdown text + tint for a cell.
function relTag(ymd: string): { label: string; className: string } {
  const d = daysFromNow(ymd);
  if (d === null) return { label: '—', className: 'text-muted-foreground' };
  if (d < 0) return { label: `${-d}d ago`, className: 'text-muted-foreground' };
  if (d === 0) return { label: 'today', className: 'text-amber-500' };
  if (d <= 21) return { label: `in ${d}d`, className: 'text-amber-500' };
  return { label: `in ${d}d`, className: 'text-muted-foreground' };
}

type ExamEntry = {
  _id: Id<'examCalendar'>;
  grade: number;
  term: number;
  year: number;
  examDate: string;
  totalMarks?: number;
  notes?: string;
};

interface DraftForm {
  id: Id<'examCalendar'> | null;
  grade: number;
  term: number;
  year: number;
  examDate: string;
  totalMarks: string;
  notes: string;
}

interface QuickForm {
  year: number;
  dates: [string, string, string]; // term 1, 2, 3
}

export function ExamCalendarTab() {
  const rows = useQuery(api.learningEngine.calendar.list, {});
  const upsert = useMutation(api.learningEngine.calendar.upsert);
  const updateById = useMutation(api.learningEngine.calendar.updateById);
  const remove = useMutation(api.learningEngine.calendar.remove);

  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [draft, setDraft] = useState<DraftForm | null>(null);
  const [quick, setQuick] = useState<QuickForm | null>(null);
  const [saving, setSaving] = useState(false);

  // (grade,term) → entry for the selected year. One cell each.
  const cellMap = useMemo(() => {
    const m = new Map<string, ExamEntry>();
    for (const r of rows ?? []) {
      if (r.year !== year) continue;
      m.set(`${r.grade}-${r.term}`, r as ExamEntry);
    }
    return m;
  }, [rows, year]);

  const scheduledCount = cellMap.size;

  const openAdd = useCallback(
    (grade: number, term: number) => {
      setDraft({
        id: null,
        grade,
        term,
        year,
        examDate: `${year}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`,
        totalMarks: '',
        notes: '',
      });
    },
    [year],
  );

  const openEdit = useCallback((row: ExamEntry) => {
    setDraft({
      id: row._id,
      grade: row.grade,
      term: row.term,
      year: row.year,
      examDate: row.examDate,
      totalMarks: row.totalMarks != null ? String(row.totalMarks) : '',
      notes: row.notes ?? '',
    });
  }, []);

  const onSave = useCallback(async () => {
    if (!draft) return;
    if (!YMD_RE.test(draft.examDate)) {
      toast.error('Exam date must be YYYY-MM-DD');
      return;
    }
    const totalMarks = draft.totalMarks.trim() ? Number(draft.totalMarks) : undefined;
    if (totalMarks !== undefined && (Number.isNaN(totalMarks) || totalMarks <= 0)) {
      toast.error('Total marks must be a positive number');
      return;
    }
    const notes = draft.notes.trim() ? draft.notes.trim() : undefined;
    setSaving(true);
    try {
      if (draft.id) {
        await updateById({
          id: draft.id,
          grade: draft.grade,
          term: draft.term,
          year: draft.year,
          examDate: draft.examDate,
          totalMarks,
          notes,
        });
        toast.success('Updated');
      } else {
        await upsert({
          grade: draft.grade,
          term: draft.term,
          year: draft.year,
          examDate: draft.examDate,
          totalMarks,
          notes,
        });
        toast.success('Added');
      }
      setDraft(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [draft, upsert, updateById]);

  const onDelete = useCallback(async () => {
    if (!draft?.id) return;
    const ok = window.confirm(
      `Delete G${draft.grade} Term ${draft.term} ${draft.year} (${draft.examDate})?`,
    );
    if (!ok) return;
    setSaving(true);
    try {
      await remove({ id: draft.id });
      toast.success('Deleted');
      setDraft(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setSaving(false);
    }
  }, [draft, remove]);

  const onQuickSave = useCallback(async () => {
    if (!quick) return;
    const jobs: Array<{ term: number; date: string }> = [];
    for (const t of TERMS) {
      const date = quick.dates[t - 1].trim();
      if (!date) continue;
      if (!YMD_RE.test(date)) {
        toast.error(`Term ${t} date must be YYYY-MM-DD`);
        return;
      }
      jobs.push({ term: t, date });
    }
    if (jobs.length === 0) {
      toast.error('Enter at least one term date');
      return;
    }
    setSaving(true);
    try {
      for (const { term, date } of jobs) {
        for (const g of GRADES) {
          // Preserve any existing marks/notes for this cell; only the date is
          // being set school-wide.
          const existing = cellMap.get(`${g}-${term}`);
          await upsert({
            grade: g,
            term,
            year: quick.year,
            examDate: date,
            totalMarks: existing?.totalMarks,
            notes: existing?.notes,
          });
        }
      }
      toast.success(`Applied to all grades (${jobs.length} term${jobs.length > 1 ? 's' : ''})`);
      setQuick(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Quick entry failed');
    } finally {
      setSaving(false);
    }
  }, [quick, upsert, cellMap]);

  return (
    <>
      <p className="text-[11px] text-muted-foreground mb-3">
        Term-exam dates per grade. Every planner runway verdict (&ldquo;on
        track&rdquo; / &ldquo;won&rsquo;t finish&rdquo;) counts down to these dates.
        Tap a date to edit, or a <span className="text-primary">+</span> to add.
      </p>

      {/* Year stepper + quick entry */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setYear((y) => Math.max(2020, y - 1))}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
            aria-label="Previous year"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-bold text-foreground tabular-nums w-12 text-center">
            {year}
          </span>
          <button
            onClick={() => setYear((y) => Math.min(2100, y + 1))}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
            aria-label="Next year"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <span className="ml-1.5 text-[11px] text-muted-foreground">
            {scheduledCount} scheduled
          </span>
        </div>
        <button
          onClick={() => setQuick({ year, dates: ['', '', ''] })}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold"
        >
          <Zap className="w-3.5 h-3.5" />
          Quick entry
        </button>
      </div>

      {rows === undefined ? (
        <div className="h-64 rounded-xl bg-muted animate-pulse" />
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {/* Header row */}
          <div className="grid grid-cols-[2.75rem_1fr_1fr_1fr] bg-muted/40">
            <div />
            {TERMS.map((t) => (
              <div
                key={t}
                className="py-2 text-center text-[11px] font-semibold text-muted-foreground border-l border-border"
              >
                Term {t}
              </div>
            ))}
          </div>
          {/* Grade rows */}
          {GRADES.map((g) => (
            <div key={g} className="grid grid-cols-[2.75rem_1fr_1fr_1fr] border-t border-border">
              <div className="flex items-center justify-center text-xs font-bold text-foreground bg-muted/40">
                G{g}
              </div>
              {TERMS.map((t) => {
                const entry = cellMap.get(`${g}-${t}`);
                return (
                  <GridCell
                    key={t}
                    entry={entry}
                    onClick={() => (entry ? openEdit(entry) : openAdd(g, t))}
                  />
                );
              })}
            </div>
          ))}
        </div>
      )}

      {draft && (
        <DraftDialog
          draft={draft}
          setDraft={setDraft}
          onSave={onSave}
          onDelete={draft.id ? onDelete : undefined}
          onClose={() => setDraft(null)}
          saving={saving}
        />
      )}

      {quick && (
        <QuickEntryDialog
          quick={quick}
          setQuick={setQuick}
          onSave={onQuickSave}
          onClose={() => setQuick(null)}
          saving={saving}
        />
      )}
    </>
  );
}

function GridCell({ entry, onClick }: { entry?: ExamEntry; onClick: () => void }) {
  if (!entry) {
    return (
      <button
        onClick={onClick}
        className="min-h-[3.75rem] flex items-center justify-center border-l border-border text-muted-foreground/30 hover:text-primary hover:bg-muted/40 transition-colors"
        aria-label="Add exam date"
      >
        <Plus className="w-4 h-4" />
      </button>
    );
  }
  const rel = relTag(entry.examDate);
  return (
    <button
      onClick={onClick}
      className="min-h-[3.75rem] flex flex-col items-center justify-center gap-0.5 px-1 border-l border-border hover:bg-muted/40 transition-colors"
    >
      <span className="text-xs font-semibold text-foreground tabular-nums">
        {fmtShort(entry.examDate)}
      </span>
      <span className={cn('text-[10px] font-medium tabular-nums', rel.className)}>{rel.label}</span>
      {entry.totalMarks != null && (
        <span className="text-[9px] text-muted-foreground">{entry.totalMarks} marks</span>
      )}
    </button>
  );
}

function DraftDialog({
  draft,
  setDraft,
  onSave,
  onDelete,
  onClose,
  saving,
}: {
  draft: DraftForm;
  setDraft: (d: DraftForm) => void;
  onSave: () => void;
  onDelete?: () => void;
  onClose: () => void;
  saving: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-2 pb-[calc(4rem+env(safe-area-inset-bottom,0px)+0.5rem)] sm:pb-2"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-card border border-border p-4 shadow-xl max-h-[75vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-bold text-foreground">
              {draft.id ? 'Edit exam' : 'New exam'}
            </h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Grade {draft.grade} · Term {draft.term} · {draft.year}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[11px] px-2 py-1 rounded-md hover:bg-muted text-muted-foreground"
          >
            Close
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Exam date
            </label>
            <input
              type="date"
              value={draft.examDate}
              onChange={(e) => setDraft({ ...draft, examDate: e.target.value })}
              className="w-full mt-1 px-2 py-1.5 rounded-md bg-muted text-sm text-foreground border border-border"
            />
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Total marks (optional)
            </label>
            <input
              type="number"
              inputMode="numeric"
              value={draft.totalMarks}
              placeholder="e.g. 100"
              onChange={(e) => setDraft({ ...draft, totalMarks: e.target.value })}
              className="w-full mt-1 px-2 py-1.5 rounded-md bg-muted text-sm text-foreground border border-border"
            />
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Notes (optional)
            </label>
            <textarea
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              rows={2}
              className="w-full mt-1 px-2 py-1.5 rounded-md bg-muted text-sm text-foreground border border-border"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 mt-4">
          {onDelete && (
            <button
              onClick={onDelete}
              disabled={saving}
              className="p-2 rounded-lg border border-border text-muted-foreground hover:text-red-500 hover:border-red-500/40 hover:bg-red-500/10 disabled:opacity-50"
              aria-label="Delete"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 px-3 py-2 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="flex-1 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50"
          >
            {saving ? 'Saving…' : draft.id ? 'Update' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

function QuickEntryDialog({
  quick,
  setQuick,
  onSave,
  onClose,
  saving,
}: {
  quick: QuickForm;
  setQuick: (q: QuickForm) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
}) {
  const setDate = (term: 1 | 2 | 3, value: string) => {
    const dates = [...quick.dates] as [string, string, string];
    dates[term - 1] = value;
    setQuick({ ...quick, dates });
  };
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-2 pb-[calc(4rem+env(safe-area-inset-bottom,0px)+0.5rem)] sm:pb-2"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-card border border-border p-4 shadow-xl max-h-[75vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <Zap className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-bold text-foreground">Quick entry · {quick.year}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-[11px] px-2 py-1 rounded-md hover:bg-muted text-muted-foreground"
          >
            Close
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground mb-3">
          Set one date per term and it applies to <strong className="text-foreground">all six
          grades</strong> for {quick.year}. Leave a term blank to skip it. This overwrites any
          existing dates for the terms you fill in.
        </p>

        <div className="space-y-3">
          {TERMS.map((t) => (
            <div key={t}>
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Term {t} exam date
              </label>
              <input
                type="date"
                value={quick.dates[t - 1]}
                onChange={(e) => setDate(t, e.target.value)}
                className="w-full mt-1 px-2 py-1.5 rounded-md bg-muted text-sm text-foreground border border-border"
              />
            </div>
          ))}
        </div>

        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 px-3 py-2 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="flex-1 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50"
          >
            {saving ? 'Applying…' : 'Apply to all grades'}
          </button>
        </div>
      </div>
    </div>
  );
}
