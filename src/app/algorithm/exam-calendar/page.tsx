'use client';

// Phase C.3 — Exam calendar management page.
//
// CRUD over the examCalendar table. One row per (grade, term, year). Drives
// the SR exam-date backstop (D.5), retention-debt "marks at risk" (C.2), and
// the predictor (G.1). Composite key is enforced by the upsert mutation.

import { useMemo, useState, useCallback } from 'react';
import { useQuery, useMutation } from 'convex/react';
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const GRADES = [6, 7, 8, 9, 10, 11];
const TERMS: Array<1 | 2 | 3> = [1, 2, 3];

type ExamRow = {
  _id: Id<'examCalendar'>;
  grade: number;
  term: number;
  year: number;
  examDate: string;
  totalMarks?: number;
  notes?: string;
  examModeActive?: boolean;
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

const TODAY_YMD = (): string => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

function blankDraft(): DraftForm {
  const d = new Date();
  return {
    id: null,
    grade: 7,
    term: 1,
    year: d.getFullYear(),
    examDate: TODAY_YMD(),
    totalMarks: '',
    notes: '',
  };
}

function daysFromNow(ymd: string): number | null {
  const t0 = Date.parse(`${TODAY_YMD()}T00:00:00.000Z`);
  const t1 = Date.parse(`${ymd}T00:00:00.000Z`);
  if (Number.isNaN(t0) || Number.isNaN(t1)) return null;
  return Math.round((t1 - t0) / 86_400_000);
}

export default function ExamCalendarPage() {
  const rows = useQuery(api.learningEngine.calendar.list, {});
  const upsert = useMutation(api.learningEngine.calendar.upsert);
  const updateById = useMutation(api.learningEngine.calendar.updateById);
  const remove = useMutation(api.learningEngine.calendar.remove);
  const setExamMode = useMutation(api.learningEngine.calendar.setExamMode);

  const [openGrade, setOpenGrade] = useState<number | null>(7);
  const [draft, setDraft] = useState<DraftForm | null>(null);
  const [saving, setSaving] = useState(false);

  const byGrade = useMemo(() => {
    const map = new Map<number, ExamRow[]>();
    for (const g of GRADES) map.set(g, []);
    for (const r of rows ?? []) {
      if (!map.has(r.grade)) map.set(r.grade, []);
      map.get(r.grade)!.push(r as ExamRow);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.examDate.localeCompare(b.examDate));
    }
    return map;
  }, [rows]);

  const openCreate = useCallback((grade?: number) => {
    setDraft({ ...blankDraft(), grade: grade ?? 7 });
  }, []);

  const openEdit = useCallback((row: ExamRow) => {
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.examDate)) {
      toast.error('Exam date must be YYYY-MM-DD');
      return;
    }
    const totalMarks = draft.totalMarks.trim()
      ? Number(draft.totalMarks)
      : undefined;
    if (totalMarks !== undefined && (Number.isNaN(totalMarks) || totalMarks <= 0)) {
      toast.error('Total marks must be a positive number');
      return;
    }
    setSaving(true);
    try {
      if (draft.id) {
        // Edit path: id-keyed update so the user can change grade/term/year
        // too. updateById enforces composite-key uniqueness server-side.
        await updateById({
          id: draft.id,
          grade: draft.grade,
          term: draft.term,
          year: draft.year,
          examDate: draft.examDate,
          totalMarks,
          notes: draft.notes.trim() ? draft.notes.trim() : undefined,
        });
        toast.success('Updated');
      } else {
        await upsert({
          grade: draft.grade,
          term: draft.term,
          year: draft.year,
          examDate: draft.examDate,
          totalMarks,
          notes: draft.notes.trim() ? draft.notes.trim() : undefined,
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

  const onDelete = useCallback(
    async (row: ExamRow) => {
      const ok = window.confirm(
        `Delete G${row.grade} Term ${row.term} ${row.year} (${row.examDate})?`,
      );
      if (!ok) return;
      try {
        await remove({ id: row._id });
        toast.success('Deleted');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Delete failed');
      }
    },
    [remove],
  );

  const onToggleExamMode = useCallback(
    async (row: ExamRow, next: boolean) => {
      try {
        await setExamMode({ id: row._id, active: next });
        toast.success(
          next
            ? `Exam mode ON — sheets focus on G${row.grade} Term ${row.term}`
            : 'Exam mode off — normal teaching order',
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to update');
      }
    },
    [setExamMode],
  );

  return (
    <div className="px-4 pt-5 pb-24 max-w-lg mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <CalendarDays className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground">Exam calendar</h1>
      </div>

      <p className="text-[11px] text-muted-foreground mb-4">
        Term-exam dates per (grade, term, year). Drives the SR exam-date
        backstop, retention-debt &ldquo;marks at risk&rdquo; estimates, and the
        Phase G predictor.
      </p>

      {/* The global Coverage-mode switch that lived here (2026-07-14) was
          retired the same day: the coverage ladder is now the permanent
          engine default; the per-student consolidation fallback is on
          /students/[id]/progress. */}

      <button
        onClick={() => openCreate(openGrade ?? 7)}
        className="w-full mb-4 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold"
      >
        <Plus className="w-3.5 h-3.5" />
        Add exam date
      </button>

      {rows === undefined && (
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-muted rounded-xl" />
          ))}
        </div>
      )}

      {rows && (
        <div className="space-y-2">
          {GRADES.map((g) => {
            const list = byGrade.get(g) ?? [];
            const isOpen = openGrade === g;
            return (
              <section
                key={g}
                className="rounded-xl border border-border bg-card overflow-hidden"
              >
                <button
                  onClick={() => setOpenGrade(isOpen ? null : g)}
                  className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-muted/40"
                >
                  <div className="flex items-center gap-2">
                    {isOpen ? (
                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                    )}
                    <span className="text-sm font-semibold text-foreground">
                      Grade {g}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {list.length} scheduled
                    </span>
                  </div>
                  <span
                    className="text-[11px] text-primary font-semibold cursor-pointer hover:underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      openCreate(g);
                    }}
                  >
                    + Add
                  </span>
                </button>
                {isOpen && (
                  <div className="border-t border-border divide-y divide-border">
                    {list.length === 0 && (
                      <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
                        No exams scheduled.
                      </div>
                    )}
                    {list.map((row) => (
                      <ExamRowItem
                        key={row._id as unknown as string}
                        row={row}
                        onEdit={() => openEdit(row)}
                        onDelete={() => onDelete(row)}
                        onToggleExamMode={(next) => onToggleExamMode(row, next)}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* Edit drawer */}
      {draft && (
        <DraftDialog
          draft={draft}
          setDraft={setDraft}
          onSave={onSave}
          onClose={() => setDraft(null)}
          saving={saving}
        />
      )}
    </div>
  );
}

function ExamRowItem({
  row,
  onEdit,
  onDelete,
  onToggleExamMode,
}: {
  row: ExamRow;
  onEdit: () => void;
  onDelete: () => void;
  onToggleExamMode: (next: boolean) => void;
}) {
  const dDays = daysFromNow(row.examDate);
  let relLabel: string;
  let relClass: string;
  if (dDays === null) {
    relLabel = '—';
    relClass = 'text-muted-foreground';
  } else if (dDays < 0) {
    relLabel = `${-dDays}d ago`;
    relClass = 'text-muted-foreground';
  } else if (dDays === 0) {
    relLabel = 'today';
    relClass = 'text-amber-500';
  } else if (dDays <= 21) {
    relLabel = `in ${dDays}d`;
    relClass = 'text-amber-500';
  } else {
    relLabel = `in ${dDays}d`;
    relClass = 'text-foreground';
  }
  const examModeOn = row.examModeActive === true;
  // Upcoming-and-soon but switch still off → hint that turning it on is due.
  const suggestOn =
    !examModeOn && dDays !== null && dDays >= 0 && dDays <= 14;
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-foreground">
            Term {row.term} · {row.year}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {row.examDate} · <span className={relClass}>{relLabel}</span>
            {row.totalMarks != null && <span> · {row.totalMarks} marks</span>}
          </div>
          {row.notes && (
            <div className="text-[10px] text-muted-foreground truncate mt-0.5">
              {row.notes}
            </div>
          )}
        </div>
        <button
          onClick={onEdit}
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
          aria-label="Edit"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-500"
          aria-label="Delete"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Manual exam-mode switch. ON = sheets lock to this exam's term. */}
      <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-foreground">
            Exam mode {examModeOn ? 'on' : 'off'}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {examModeOn
              ? 'Sheets focus on this term'
              : suggestOn
                ? 'Exam is near — turn on to focus sheets'
                : 'Normal teaching order'}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={examModeOn}
          aria-label="Toggle exam mode"
          onClick={() => onToggleExamMode(!examModeOn)}
          className={`relative shrink-0 inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            examModeOn
              ? 'bg-primary'
              : suggestOn
                ? 'bg-amber-500/60'
                : 'bg-border'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              examModeOn ? 'translate-x-[22px]' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
    </div>
  );
}

function DraftDialog({
  draft,
  setDraft,
  onSave,
  onClose,
  saving,
}: {
  draft: DraftForm;
  setDraft: (d: DraftForm) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
}) {
  return (
    <div
      // On mobile, lift the dialog above the fixed bottom nav (h-16 = 4rem)
      // plus iOS safe area; desktop centers normally with a small inset.
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-2 pb-[calc(4rem+env(safe-area-inset-bottom,0px)+0.5rem)] sm:pb-2"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-card border border-border p-4 shadow-xl max-h-[75vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-foreground">
            {draft.id ? 'Edit exam' : 'New exam'}
          </h2>
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
              Grade
            </label>
            <div className="flex gap-1 p-1 bg-muted rounded-lg mt-1 overflow-x-auto">
              {GRADES.map((g) => (
                <button
                  key={g}
                  onClick={() => setDraft({ ...draft, grade: g })}
                  className={`flex-1 py-1.5 px-2 rounded-md text-[11px] font-semibold transition-all whitespace-nowrap ${
                    g === draft.grade
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  G{g}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Term
            </label>
            <div className="flex gap-1 p-1 bg-muted rounded-lg mt-1">
              {TERMS.map((t) => (
                <button
                  key={t}
                  onClick={() => setDraft({ ...draft, term: t })}
                  className={`flex-1 py-1.5 px-2 rounded-md text-[11px] font-semibold transition-all ${
                    t === draft.term
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Term {t}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Year
              </label>
              <input
                type="number"
                value={draft.year}
                onChange={(e) =>
                  setDraft({ ...draft, year: Number(e.target.value) })
                }
                className="w-full mt-1 px-2 py-1.5 rounded-md bg-muted text-sm text-foreground border border-border"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Exam date
              </label>
              <input
                type="date"
                value={draft.examDate}
                onChange={(e) =>
                  setDraft({ ...draft, examDate: e.target.value })
                }
                className="w-full mt-1 px-2 py-1.5 rounded-md bg-muted text-sm text-foreground border border-border"
              />
            </div>
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
              onChange={(e) =>
                setDraft({ ...draft, totalMarks: e.target.value })
              }
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

          {draft.id && (
            <p className="text-[10px] text-muted-foreground">
              You can change grade / term / year too — saving will move this
              row to the new key (errors if another exam already exists there).
            </p>
          )}
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
            {saving ? 'Saving…' : draft.id ? 'Update' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}
