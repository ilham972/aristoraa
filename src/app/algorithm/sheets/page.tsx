'use client';

// Phase E.3 — Sheets dashboard.
//
// "Airplane dashboard" surface for the Lead: pick a date + slot, see every
// student in the slot as a row with their state and an explicit per-row
// action button (Generate / Render / Force render / Open PDF). Bulk
// controls at the slot level run the same actions in a client-side loop —
// matching the D.6 BulkSlotCard pattern rather than fan-out on the server.
//
// Founder decisions baked in (do not auto-magic):
//   - PDFs never render as a side effect of clicking ZIP. ZIP packs what
//     already exists and tells you what's missing.
//   - Off-day students never appear as a "needs PDF" row — they show as a
//     calm grey "Off day" chip with no action button.
//   - Default render policy is "fail loud" — broken images surface an
//     alert listing the missing question IDs. [Force render] is a
//     separate explicit button that passes onMissingImage: "skip".

import { Suspense, useCallback, useMemo, useState } from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';
import { toast } from 'sonner';
import {
  Calendar as CalendarIcon,
  Users,
  FileSpreadsheet,
  Save,
  Printer,
  Download,
  RefreshCw,
  Zap,
  AlertTriangle,
  CheckCircle2,
  Coffee,
  Archive,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { api, type Id } from '@/lib/convex';
import { CURRICULUM_MODULES } from '@/lib/curriculum-data';

const MODULE_IDS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'];

// ── Small helpers (duplicated from sheet-planner-tab to avoid cross-file
// imports of unexported internals; keep in sync if either changes) ──────

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function tomorrowYmd(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function describeError(e: unknown): string {
  if (e instanceof ConvexError) {
    const data: unknown = (e as ConvexError<string>).data;
    if (typeof data === 'string') return data;
    if (data && typeof data === 'object' && 'message' in data) {
      return String((data as { message: unknown }).message);
    }
    return JSON.stringify(data);
  }
  return e instanceof Error ? e.message : String(e);
}

function resolveGradeByModule(student: {
  schoolGrade: number;
  assignedGrades?: number[];
  assignedGradesByModule?: unknown;
}): Record<string, number[]> {
  const defaults =
    student.assignedGrades && student.assignedGrades.length > 0
      ? student.assignedGrades
      : [student.schoolGrade];
  const byMod = (student.assignedGradesByModule ?? {}) as Record<string, number[]>;
  const out: Record<string, number[]> = {};
  for (const m of MODULE_IDS) {
    const override = byMod[m];
    out[m] = Array.isArray(override) && override.length > 0 ? override : defaults;
  }
  return out;
}

function unitIdsForScope(gradeByModule: Record<string, number[]>): string[] {
  const out: string[] = [];
  for (const mod of CURRICULUM_MODULES) {
    const allowedGrades = new Set(gradeByModule[mod.id] ?? []);
    if (allowedGrades.size === 0) continue;
    for (const g of mod.grades) {
      if (!allowedGrades.has(g.grade)) continue;
      for (const t of g.terms) {
        for (const u of t.units) out.push(u.id);
      }
    }
  }
  return out;
}

// ── Types ────────────────────────────────────────────────────────────────

type RowStatus =
  | 'off-day'
  | 'no-sheet'
  | 'draft-no-pdf'
  | 'draft-with-pdf'
  | 'printed'
  | 'completed';

type Row = {
  studentId: Id<'students'>;
  studentName: string;
  schoolGrade: number;
  isOffDay: boolean;
  sheet: {
    _id: Id<'generatedSheets'>;
    status: string | undefined;
    pdfStorageId: Id<'_storage'> | undefined;
    pdfUrl: string | null;
    alertCount: number;
    questionCount: number;
    generatedAt: number;
  } | null;
};

function rowStatus(r: Row): RowStatus {
  if (r.isOffDay) return 'off-day';
  if (!r.sheet) return 'no-sheet';
  if (r.sheet.status === 'completed') return 'completed';
  if (r.sheet.status === 'printed') return 'printed';
  return r.sheet.pdfStorageId ? 'draft-with-pdf' : 'draft-no-pdf';
}

// ── Page ─────────────────────────────────────────────────────────────────

function SheetsPageInner() {
  const [dateStr, setDateStr] = useState<string>(tomorrowYmd());
  // Explicit user pick. When null, the page falls back to the first slot
  // available for the current weekday (computed below as effectiveSlotId).
  // Resetting on date-change happens inside changeDate, not in an effect.
  const [pickedSlotId, setPickedSlotId] = useState<Id<'scheduleSlots'> | null>(
    null,
  );

  const allSlots = useQuery(api.scheduleSlots.list);
  const allStudents = useQuery(api.students.list);

  const dayOfWeek = useMemo(() => {
    const t = Date.parse(`${dateStr}T00:00:00.000Z`);
    return Number.isNaN(t) ? null : new Date(t).getUTCDay();
  }, [dateStr]);

  const slotsForDay = useMemo(
    () =>
      (allSlots ?? []).filter((s) =>
        dayOfWeek === null ? true : s.dayOfWeek === dayOfWeek,
      ),
    [allSlots, dayOfWeek],
  );

  // Derived effective slot: user pick if still valid for this weekday,
  // otherwise the first available. Computed in render to avoid setState-in-
  // effect lint violations.
  const effectiveSlotId: Id<'scheduleSlots'> | null = useMemo(() => {
    if (pickedSlotId && slotsForDay.some((s) => s._id === pickedSlotId)) {
      return pickedSlotId;
    }
    return slotsForDay[0]?._id ?? null;
  }, [pickedSlotId, slotsForDay]);

  const changeDate = useCallback(
    (next: string) => {
      setDateStr(next);
      // Clear the explicit pick so the new weekday falls back to its first
      // slot automatically. The user can pick again from the new list.
      setPickedSlotId(null);
    },
    [],
  );

  const rows = useQuery(
    api.learningEngine.sheets.listSheetsForSlotDate,
    effectiveSlotId ? { slotId: effectiveSlotId, dateStr } : 'skip',
  );

  return (
    <div className="px-4 pt-5 pb-24 max-w-lg mx-auto">
      <header className="flex items-center gap-2 mb-4">
        <FileSpreadsheet className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground">Sheets</h1>
      </header>

      <DateAndSlotPicker
        dateStr={dateStr}
        setDateStr={changeDate}
        slotId={effectiveSlotId}
        setSlotId={setPickedSlotId}
        slotsForDay={slotsForDay}
      />

      {!effectiveSlotId && (
        <div className="mt-4 rounded-xl border border-border bg-card p-4 text-center text-[12px] text-muted-foreground">
          {slotsForDay.length === 0
            ? 'No slots are scheduled for this weekday. Add one in Settings → Schedule, or pick another date.'
            : 'Pick a slot above.'}
        </div>
      )}

      {effectiveSlotId && (
        <SlotDashboard
          slotId={effectiveSlotId}
          dateStr={dateStr}
          rows={rows === undefined ? null : rows}
          allStudents={allStudents ?? []}
        />
      )}
    </div>
  );
}

export default function SheetsPage() {
  return (
    <Suspense
      fallback={
        <div className="px-4 pt-5 max-w-lg mx-auto text-sm text-muted-foreground">
          Loading…
        </div>
      }
    >
      <SheetsPageInner />
    </Suspense>
  );
}

// ── Date + slot picker ───────────────────────────────────────────────────

function DateAndSlotPicker({
  dateStr,
  setDateStr,
  slotId,
  setSlotId,
  slotsForDay,
}: {
  dateStr: string;
  setDateStr: (s: string) => void;
  slotId: Id<'scheduleSlots'> | null;
  setSlotId: (id: Id<'scheduleSlots'> | null) => void;
  slotsForDay: Array<{
    _id: Id<'scheduleSlots'>;
    startTime: string;
    endTime: string;
  }>;
}) {
  const today = todayYmd();
  const tomorrow = tomorrowYmd();
  return (
    <section className="rounded-xl border border-border bg-card p-3 space-y-3">
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground" />
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
            Date
          </label>
        </div>
        <div className="flex gap-1 mb-2">
          <button
            onClick={() => setDateStr(today)}
            className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${
              dateStr === today
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            Today
          </button>
          <button
            onClick={() => setDateStr(tomorrow)}
            className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${
              dateStr === tomorrow
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            Tomorrow
          </button>
        </div>
        <input
          type="date"
          value={dateStr}
          onChange={(e) => setDateStr(e.target.value)}
          className="w-full px-2 py-1.5 rounded-md bg-muted text-sm text-foreground border border-border outline-none focus:border-primary"
        />
      </div>

      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <Users className="w-3.5 h-3.5 text-muted-foreground" />
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
            Slot
          </label>
        </div>
        <select
          value={(slotId as unknown as string) ?? ''}
          onChange={(e) =>
            setSlotId((e.target.value || null) as Id<'scheduleSlots'> | null)
          }
          className="w-full px-2 py-1.5 rounded-md bg-muted text-sm text-foreground border border-border outline-none focus:border-primary"
        >
          <option value="">Pick a slot…</option>
          {slotsForDay.map((s) => (
            <option key={s._id as unknown as string} value={s._id as unknown as string}>
              {s.startTime}–{s.endTime}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}

// ── Slot dashboard ───────────────────────────────────────────────────────

function SlotDashboard({
  slotId,
  dateStr,
  rows,
  allStudents,
}: {
  slotId: Id<'scheduleSlots'>;
  dateStr: string;
  rows: Row[] | null;
  allStudents: Array<{
    _id: Id<'students'>;
    schoolGrade: number;
    assignedGrades?: number[];
    assignedGradesByModule?: unknown;
  }>;
}) {
  const saveSheet = useMutation(api.learningEngine.planner.saveSheetForStudent);
  const renderPDF = useAction(api.learningEngine.pdf.renderSheetPDF);
  const zipAction = useAction(api.learningEngine.sheets.zipSheetPDFs);
  const markPrinted = useMutation(api.learningEngine.planner.markPrinted);

  const [busy, setBusy] = useState<{
    kind: 'generate' | 'render' | 'force-render' | 'zip' | null;
    total: number;
    done: number;
  } | null>(null);
  const [lastZip, setLastZip] = useState<{
    url: string | null;
    included: number;
    skipped: number;
    bytes: number;
  } | null>(null);

  // Per-row spinner state. Decoupled from bulk state so a single-row click
  // doesn't disable everything.
  const [rowBusy, setRowBusy] = useState<Record<string, string | null>>({});
  const setRow = useCallback(
    (id: string, label: string | null) =>
      setRowBusy((m) => ({ ...m, [id]: label })),
    [],
  );

  const studentScope = useCallback(
    (studentId: Id<'students'>) => {
      const s = allStudents.find((x) => x._id === studentId);
      if (!s) return null;
      const gbm = resolveGradeByModule(s);
      return { gradeByModule: gbm, unitIds: unitIdsForScope(gbm) };
    },
    [allStudents],
  );

  // ── Row-level actions ──
  const onGenerate = useCallback(
    async (r: Row) => {
      const scope = studentScope(r.studentId);
      if (!scope) {
        toast.error("Couldn't resolve student's module scope.");
        return;
      }
      setRow(r.studentId, 'Generating…');
      try {
        const res = await saveSheet({
          studentId: r.studentId,
          dateStr,
          unitIds: scope.unitIds,
          gradeByModule: scope.gradeByModule,
          slotId,
        });
        if (res.status === 'ok') toast.success(`${r.studentName}: draft saved`);
        else if (res.status === 'off-day')
          toast.info(`${r.studentName}: off-day — no sheet written`);
        else toast.error(`${r.studentName}: ${res.status}`);
      } catch (e) {
        toast.error(`${r.studentName}: ${describeError(e)}`);
      } finally {
        setRow(r.studentId, null);
      }
    },
    [saveSheet, studentScope, dateStr, slotId, setRow],
  );

  const onRender = useCallback(
    async (r: Row, force: boolean) => {
      if (!r.sheet) return;
      setRow(r.studentId, force ? 'Force rendering…' : 'Rendering…');
      try {
        const res = await renderPDF({
          sheetId: r.sheet._id,
          onMissingImage: force ? 'skip' : 'fail',
        });
        if (res.missing.length > 0) {
          toast.warning(
            `${r.studentName}: rendered ${res.renderedCount}/${res.questionCount} (${res.missing.length} skipped)`,
          );
        } else {
          toast.success(
            `${r.studentName}: PDF rendered (${res.renderedCount} Qs, ${res.pageCount} page${res.pageCount === 1 ? '' : 's'})`,
          );
        }
      } catch (e) {
        toast.error(`${r.studentName}: ${describeError(e)}`);
      } finally {
        setRow(r.studentId, null);
      }
    },
    [renderPDF, setRow],
  );

  const onMarkPrinted = useCallback(
    async (r: Row) => {
      if (!r.sheet) return;
      setRow(r.studentId, 'Marking printed…');
      try {
        await markPrinted({ sheetId: r.sheet._id });
        toast.success(`${r.studentName}: marked printed`);
      } catch (e) {
        toast.error(`${r.studentName}: ${describeError(e)}`);
      } finally {
        setRow(r.studentId, null);
      }
    },
    [markPrinted, setRow],
  );

  // ── Slot-level bulk actions ──
  const eligibleStudents = useMemo(
    () => (rows ?? []).filter((r) => !r.isOffDay),
    [rows],
  );

  const onBulkGenerate = useCallback(async () => {
    const targets = eligibleStudents;
    if (targets.length === 0) return;
    setBusy({ kind: 'generate', total: targets.length, done: 0 });
    let saved = 0;
    let offDay = 0;
    const errs: string[] = [];
    for (const r of targets) {
      const scope = studentScope(r.studentId);
      if (!scope) {
        errs.push(`${r.studentName}: no scope`);
        setBusy((b) => (b ? { ...b, done: b.done + 1 } : b));
        continue;
      }
      try {
        const res = await saveSheet({
          studentId: r.studentId,
          dateStr,
          unitIds: scope.unitIds,
          gradeByModule: scope.gradeByModule,
          slotId,
        });
        if (res.status === 'ok') saved += 1;
        else if (res.status === 'off-day') offDay += 1;
        else errs.push(`${r.studentName}: ${res.status}`);
      } catch (e) {
        errs.push(`${r.studentName}: ${describeError(e)}`);
      }
      setBusy((b) => (b ? { ...b, done: b.done + 1 } : b));
    }
    setBusy(null);
    if (errs.length === 0) {
      toast.success(
        `Generated ${saved} draft${saved === 1 ? '' : 's'}${offDay ? ` (+${offDay} off-day skipped)` : ''}`,
      );
    } else {
      toast.error(`${saved} saved, ${errs.length} failed. First: ${errs[0]}`);
    }
  }, [eligibleStudents, saveSheet, studentScope, dateStr, slotId]);

  const onBulkRender = useCallback(
    async (force: boolean) => {
      const targets = eligibleStudents.filter(
        (r) => r.sheet && !r.sheet.pdfStorageId,
      );
      if (targets.length === 0) {
        toast.info(
          force
            ? 'Nothing to force render.'
            : 'No drafts without PDFs — nothing to render.',
        );
        return;
      }
      setBusy({
        kind: force ? 'force-render' : 'render',
        total: targets.length,
        done: 0,
      });
      let rendered = 0;
      let partial = 0;
      const errs: string[] = [];
      for (const r of targets) {
        try {
          const res = await renderPDF({
            sheetId: r.sheet!._id,
            onMissingImage: force ? 'skip' : 'fail',
          });
          rendered += 1;
          if (res.missing.length > 0) partial += 1;
        } catch (e) {
          errs.push(`${r.studentName}: ${describeError(e)}`);
        }
        setBusy((b) => (b ? { ...b, done: b.done + 1 } : b));
      }
      setBusy(null);
      if (errs.length === 0) {
        toast.success(
          `Rendered ${rendered} PDF${rendered === 1 ? '' : 's'}${partial ? ` (${partial} partial)` : ''}`,
        );
      } else {
        toast.error(
          `${rendered} rendered, ${errs.length} failed. First: ${errs[0]}`,
        );
      }
    },
    [eligibleStudents, renderPDF],
  );

  const onBulkZip = useCallback(async () => {
    setBusy({ kind: 'zip', total: 1, done: 0 });
    setLastZip(null);
    try {
      const res = await zipAction({ slotId, dateStr });
      setLastZip({
        url: res.downloadUrl,
        included: res.includedCount,
        skipped: res.skipped.length,
        bytes: res.approxBytes,
      });
      toast.success(
        `ZIP ready (${res.includedCount} PDF${res.includedCount === 1 ? '' : 's'}, ${res.skipped.length} skipped)`,
      );
      if (res.downloadUrl) window.open(res.downloadUrl, '_blank');
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setBusy(null);
    }
  }, [zipAction, slotId, dateStr]);

  // ── Render ──
  if (rows === null) {
    return (
      <div className="mt-4 space-y-2 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-muted rounded-xl" />
        ))}
      </div>
    );
  }

  const counts = countByStatus(rows);

  return (
    <>
      <SummaryStrip dateStr={dateStr} counts={counts} />

      <BulkActions
        counts={counts}
        busy={busy}
        onGenerate={onBulkGenerate}
        onRender={() => onBulkRender(false)}
        onForceRender={() => onBulkRender(true)}
        onZip={onBulkZip}
        lastZip={lastZip}
      />

      {rows.length === 0 && (
        <div className="mt-4 rounded-xl border border-border bg-card p-4 text-center text-[12px] text-muted-foreground">
          No students in this slot. Add some in Settings → Schedule.
        </div>
      )}

      <section className="mt-3 rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
        {rows.map((r) => (
          <SheetRow
            key={r.studentId as unknown as string}
            row={r}
            busyLabel={rowBusy[r.studentId as unknown as string] ?? null}
            onGenerate={() => onGenerate(r)}
            onRender={() => onRender(r, false)}
            onForceRender={() => onRender(r, true)}
            onMarkPrinted={() => onMarkPrinted(r)}
          />
        ))}
      </section>
    </>
  );
}

// ── Summary strip ────────────────────────────────────────────────────────

type Counts = {
  total: number;
  offDay: number;
  noSheet: number;
  draftNoPdf: number;
  draftWithPdf: number;
  printed: number;
  completed: number;
  alerts: number;
};

function countByStatus(rows: Row[]): Counts {
  const c: Counts = {
    total: rows.length,
    offDay: 0,
    noSheet: 0,
    draftNoPdf: 0,
    draftWithPdf: 0,
    printed: 0,
    completed: 0,
    alerts: 0,
  };
  for (const r of rows) {
    c.alerts += r.sheet?.alertCount ?? 0;
    switch (rowStatus(r)) {
      case 'off-day':
        c.offDay += 1;
        break;
      case 'no-sheet':
        c.noSheet += 1;
        break;
      case 'draft-no-pdf':
        c.draftNoPdf += 1;
        break;
      case 'draft-with-pdf':
        c.draftWithPdf += 1;
        break;
      case 'printed':
        c.printed += 1;
        break;
      case 'completed':
        c.completed += 1;
        break;
    }
  }
  return c;
}

function SummaryStrip({ dateStr, counts }: { dateStr: string; counts: Counts }) {
  return (
    <section className="mt-3 rounded-xl border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1.5">
        {dateStr} · {counts.total} student{counts.total === 1 ? '' : 's'}
      </div>
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <StatBox label="Off day" n={counts.offDay} accent="muted" />
        <StatBox label="No draft" n={counts.noSheet} accent="amber" />
        <StatBox label="Drafts" n={counts.draftNoPdf} accent="teal" />
        <StatBox label="PDF ready" n={counts.draftWithPdf} accent="emerald" />
        <StatBox label="Printed" n={counts.printed} accent="primary" />
        <StatBox label="Done" n={counts.completed} accent="emerald" />
      </div>
      {counts.alerts > 0 && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
          <AlertTriangle className="w-3 h-3" />
          {counts.alerts} prereq alert{counts.alerts === 1 ? '' : 's'} across sheets
        </div>
      )}
    </section>
  );
}

function StatBox({
  label,
  n,
  accent,
}: {
  label: string;
  n: number;
  accent: 'muted' | 'amber' | 'teal' | 'emerald' | 'primary';
}) {
  const cls = {
    muted: 'text-muted-foreground',
    amber: 'text-amber-600 dark:text-amber-400',
    teal: 'text-teal-600 dark:text-teal-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    primary: 'text-primary',
  }[accent];
  return (
    <div className="rounded-md bg-muted/40 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-base font-bold tabular-nums ${cls}`}>{n}</div>
    </div>
  );
}

// ── Bulk action panel ────────────────────────────────────────────────────

function BulkActions({
  counts,
  busy,
  onGenerate,
  onRender,
  onForceRender,
  onZip,
  lastZip,
}: {
  counts: Counts;
  busy: { kind: string | null; total: number; done: number } | null;
  onGenerate: () => void;
  onRender: () => void;
  onForceRender: () => void;
  onZip: () => void;
  lastZip: {
    url: string | null;
    included: number;
    skipped: number;
    bytes: number;
  } | null;
}) {
  const someBusy = !!busy?.kind;
  return (
    <section className="mt-3 rounded-xl border border-border bg-card p-3 space-y-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
        Slot actions
      </div>
      <div className="grid grid-cols-2 gap-2">
        <BulkButton
          icon={<Save className="w-3.5 h-3.5" />}
          label="Generate drafts"
          hint={`${counts.total - counts.offDay} student${counts.total - counts.offDay === 1 ? '' : 's'}`}
          onClick={onGenerate}
          busy={busy?.kind === 'generate'}
          progress={busy?.kind === 'generate' ? busy : null}
          disabled={someBusy}
          tone="primary"
        />
        <BulkButton
          icon={<RefreshCw className="w-3.5 h-3.5" />}
          label="Render PDFs"
          hint={`${counts.draftNoPdf} to render`}
          onClick={onRender}
          busy={busy?.kind === 'render'}
          progress={busy?.kind === 'render' ? busy : null}
          disabled={someBusy || counts.draftNoPdf === 0}
          tone="primary"
        />
        <BulkButton
          icon={<Zap className="w-3.5 h-3.5" />}
          label="Force render"
          hint="skip missing imgs"
          onClick={onForceRender}
          busy={busy?.kind === 'force-render'}
          progress={busy?.kind === 'force-render' ? busy : null}
          disabled={someBusy || counts.draftNoPdf === 0}
          tone="amber"
        />
        <BulkButton
          icon={<Archive className="w-3.5 h-3.5" />}
          label="Download ZIP"
          hint={`${counts.draftWithPdf + counts.printed + counts.completed} PDF${counts.draftWithPdf + counts.printed + counts.completed === 1 ? '' : 's'} ready`}
          onClick={onZip}
          busy={busy?.kind === 'zip'}
          progress={null}
          disabled={
            someBusy ||
            counts.draftWithPdf + counts.printed + counts.completed === 0
          }
          tone="emerald"
        />
      </div>
      {lastZip && (
        <div className="rounded-md bg-muted/40 px-2 py-2 text-[11px] flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-foreground">
              ZIP: <strong>{lastZip.included}</strong> PDF
              {lastZip.included === 1 ? '' : 's'}
              {lastZip.skipped > 0 && (
                <span className="text-muted-foreground">
                  {' '}
                  · {lastZip.skipped} skipped
                </span>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground">
              ~{(lastZip.bytes / 1024 / 1024).toFixed(1)} MB
            </div>
          </div>
          {lastZip.url && (
            <a
              href={lastZip.url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-[10px] font-semibold"
            >
              <Download className="w-3 h-3" />
              Open
            </a>
          )}
        </div>
      )}
    </section>
  );
}

function BulkButton({
  icon,
  label,
  hint,
  onClick,
  busy,
  progress,
  disabled,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
  busy: boolean;
  progress: { total: number; done: number } | null;
  disabled: boolean;
  tone: 'primary' | 'amber' | 'emerald';
}) {
  const base = 'flex flex-col gap-0.5 px-3 py-2 rounded-lg text-left transition-colors disabled:opacity-50';
  const cls = {
    primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
    amber:
      'bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20',
    emerald:
      'bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20',
  }[tone];
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className={`${base} ${cls}`}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-semibold">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
        {label}
      </div>
      <div className="text-[10px] opacity-80">
        {busy && progress
          ? `${progress.done}/${progress.total}…`
          : hint}
      </div>
    </button>
  );
}

// ── Per-student row ──────────────────────────────────────────────────────

function SheetRow({
  row,
  busyLabel,
  onGenerate,
  onRender,
  onForceRender,
  onMarkPrinted,
}: {
  row: Row;
  busyLabel: string | null;
  onGenerate: () => void;
  onRender: () => void;
  onForceRender: () => void;
  onMarkPrinted: () => void;
}) {
  const status = rowStatus(row);

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-2 mb-1.5">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-foreground truncate">
            {row.studentName}
          </div>
          <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
            <span>G{row.schoolGrade}</span>
            {row.sheet && (
              <>
                <span>·</span>
                <span>
                  {row.sheet.questionCount} Q{row.sheet.questionCount === 1 ? '' : 's'}
                </span>
              </>
            )}
            {row.sheet && row.sheet.alertCount > 0 && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="w-2.5 h-2.5" />
                  {row.sheet.alertCount}
                </span>
              </>
            )}
          </div>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {busyLabel && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            {busyLabel}
          </span>
        )}
        {!busyLabel && <RowActions
          status={status}
          row={row}
          onGenerate={onGenerate}
          onRender={onRender}
          onForceRender={onForceRender}
          onMarkPrinted={onMarkPrinted}
        />}
      </div>
    </div>
  );
}

function RowActions({
  status,
  row,
  onGenerate,
  onRender,
  onForceRender,
  onMarkPrinted,
}: {
  status: RowStatus;
  row: Row;
  onGenerate: () => void;
  onRender: () => void;
  onForceRender: () => void;
  onMarkPrinted: () => void;
}) {
  if (status === 'off-day') {
    return (
      <span className="text-[10px] text-muted-foreground">No action — off day.</span>
    );
  }
  if (status === 'no-sheet') {
    return <ActionBtn icon={<Save className="w-3 h-3" />} label="Generate" onClick={onGenerate} tone="primary" />;
  }
  if (status === 'draft-no-pdf') {
    return (
      <>
        <ActionBtn icon={<RefreshCw className="w-3 h-3" />} label="Render" onClick={onRender} tone="primary" />
        <ActionBtn icon={<Zap className="w-3 h-3" />} label="Force render" onClick={onForceRender} tone="amber" />
        <ActionBtn icon={<Save className="w-3 h-3" />} label="Re-generate" onClick={onGenerate} tone="ghost" />
      </>
    );
  }
  if (status === 'draft-with-pdf') {
    return (
      <>
        {row.sheet?.pdfUrl && (
          <a
            href={row.sheet.pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-[10px] font-semibold"
          >
            <ExternalLink className="w-3 h-3" />
            Open PDF
          </a>
        )}
        <ActionBtn icon={<RefreshCw className="w-3 h-3" />} label="Re-render" onClick={onRender} tone="ghost" />
        <ActionBtn icon={<Zap className="w-3 h-3" />} label="Force re-render" onClick={onForceRender} tone="ghost" />
        <ActionBtn icon={<Printer className="w-3 h-3" />} label="Mark printed" onClick={onMarkPrinted} tone="primary" />
      </>
    );
  }
  if (status === 'printed') {
    return (
      <>
        {row.sheet?.pdfUrl && (
          <a
            href={row.sheet.pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted text-foreground text-[10px] font-semibold"
          >
            <ExternalLink className="w-3 h-3" />
            Open PDF
          </a>
        )}
        <span className="text-[10px] text-muted-foreground">
          Locked — printed. Delete the row to regenerate.
        </span>
      </>
    );
  }
  // completed
  return (
    <>
      {row.sheet?.pdfUrl && (
        <a
          href={row.sheet.pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted text-foreground text-[10px] font-semibold"
        >
          <ExternalLink className="w-3 h-3" />
          Open PDF
        </a>
      )}
    </>
  );
}

function ActionBtn({
  icon,
  label,
  onClick,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  tone: 'primary' | 'amber' | 'ghost';
}) {
  const cls = {
    primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
    amber:
      'bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20',
    ghost: 'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80',
  }[tone];
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold transition-colors ${cls}`}
    >
      {icon}
      {label}
    </button>
  );
}

function StatusBadge({ status }: { status: RowStatus }) {
  const map: Record<
    RowStatus,
    { label: string; cls: string; icon: React.ReactNode }
  > = {
    'off-day': {
      label: 'Off day',
      cls: 'bg-muted text-muted-foreground',
      icon: <Coffee className="w-3 h-3" />,
    },
    'no-sheet': {
      label: 'No draft',
      cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30',
      icon: <AlertTriangle className="w-3 h-3" />,
    },
    'draft-no-pdf': {
      label: 'Draft',
      cls: 'bg-teal-500/10 text-teal-700 dark:text-teal-400 border border-teal-500/30',
      icon: <Save className="w-3 h-3" />,
    },
    'draft-with-pdf': {
      label: 'PDF ready',
      cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30',
      icon: <CheckCircle2 className="w-3 h-3" />,
    },
    printed: {
      label: 'Printed',
      cls: 'bg-primary/15 text-primary border border-primary/30',
      icon: <Printer className="w-3 h-3" />,
    },
    completed: {
      label: 'Done',
      cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30',
      icon: <CheckCircle2 className="w-3 h-3" />,
    },
  };
  const e = map[status];
  return (
    <span
      className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold ${e.cls}`}
    >
      {e.icon}
      {e.label}
    </span>
  );
}
