'use client';

// SheetsTab — practice-sheet workflow for ONE session's roster. Lives as
// the Sheets tab on /session/[slotId]/[date]. Compared to the legacy
// /sheets page this drops:
//   • the slot picker (slotId is given, hard scoped)
//   • the search box and grade filter (roster is fixed)
//   • the off-slot "Other students" section
//   • the alerts-only filter
//   • the in-tab date stepper (the session-page header stepper now
//     navigates across the group's sessions; this tab is purely "sheets
//     for the current session's date")
// and keeps only the status filter — the one ergonomic filter for
// triaging the morning queue.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';
import { toast } from 'sonner';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { SheetPreviewDrawer } from '@/components/algorithm/sheet-preview';
import {
  STATUS_OPTIONS,
  type SheetRowStatus,
} from '@/components/sheets/filters-bar';
import { SummaryStrip } from '@/components/sheets/summary-strip';
import {
  BulkActions,
  type BulkBusy,
  type LastZip,
} from '@/components/sheets/bulk-actions';
import { StudentRow } from '@/components/sheets/student-row';
import { InspectorDrawer } from '@/components/sheets/inspector-drawer';
import { countByStatus, rowStatus, type Row } from '@/components/sheets/shared';
import {
  describeError,
  resolveGradeByModule,
  unitIdsForScope,
  type StudentLite,
} from '@/lib/sheets/scope';

export function SheetsTab({
  slotId,
  sessionDate,
}: {
  slotId: Id<'scheduleSlots'>;
  sessionDate: string;
}) {
  // Date is always the session's date. To view other days for the same
  // group, the user uses the session-page header stepper (which navigates
  // to the next/prev session of this group, possibly on a different slot).
  const dateStr = sessionDate;

  // Status filter only. No grade, no alertsOnly, no search.
  const [statuses, setStatuses] = useState<SheetRowStatus[]>([]);

  const [rowBusy, setRowBusy] = useState<Record<string, string | null>>({});
  const [bulkBusy, setBulkBusy] = useState<BulkBusy>(null);
  const [lastZip, setLastZip] = useState<LastZip>(null);
  const [openStudentId, setOpenStudentId] = useState<Id<'students'> | null>(null);
  const [editSheetId, setEditSheetId] = useState<Id<'generatedSheets'> | null>(null);

  const setRow = useCallback(
    (id: string, label: string | null) =>
      setRowBusy((m) => ({ ...m, [id]: label })),
    [],
  );

  // ── Data ────────────────────────────────────────────────────────────
  const slotRows = useQuery(api.learningEngine.sheets.listSheetsForSlotDate, {
    slotId,
    dateStr,
  });
  // Used by studentScope() to resolve per-student unit lists. Same query
  // /sheets uses — already cached site-wide.
  const allStudents = useQuery(api.students.list);

  const saveSheet = useMutation(api.learningEngine.planner.saveSheetForStudent);
  const renderPDF = useAction(api.learningEngine.pdf.renderSheetPDF);
  const zipAction = useAction(api.learningEngine.sheets.zipSheetPDFs);
  const markPrinted = useMutation(api.learningEngine.planner.markPrinted);
  const markCompleted = useMutation(api.learningEngine.planner.markCompleted);

  const studentScope = useCallback(
    (studentId: Id<'students'>) => {
      const s = (allStudents as StudentLite[] | undefined)?.find(
        (x) => x._id === studentId,
      );
      if (!s) return null;
      const gbm = resolveGradeByModule(s);
      return { gradeByModule: gbm, unitIds: unitIdsForScope(gbm) };
    },
    [allStudents],
  );

  // ── Filtering ──
  const filteredRows = useMemo(() => {
    if (!slotRows) return [];
    if (statuses.length === 0) return slotRows;
    return slotRows.filter((r) => statuses.includes(rowStatus(r)));
  }, [slotRows, statuses]);

  // Counts are over the FULL slot roster (unfiltered) so the morning
  // dashboard numbers don't shift when the tutor toggles a filter chip.
  const counts = useMemo(() => countByStatus(slotRows ?? []), [slotRows]);

  // ── Row state syncing — close edit drawer when student selection clears ──
  useEffect(() => {
    if (!openStudentId) setEditSheetId(null);
  }, [openStudentId]);

  const openRow: Row | null = useMemo(() => {
    if (!openStudentId) return null;
    for (const r of slotRows ?? []) {
      if ((r.studentId as unknown as string) === (openStudentId as unknown as string)) {
        return r;
      }
    }
    return null;
  }, [openStudentId, slotRows]);

  // ── Per-row actions ──
  const actGenerate = useCallback(
    async (r: Row) => {
      const scope = studentScope(r.studentId);
      if (!scope) {
        toast.error("Couldn't resolve student's module scope.");
        return;
      }
      const rid = r.studentId as unknown as string;
      setRow(rid, 'Generating…');
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
        setRow(rid, null);
      }
    },
    [saveSheet, studentScope, dateStr, slotId, setRow],
  );

  const actRender = useCallback(
    async (r: Row, force: boolean) => {
      if (!r.sheet) return;
      const rid = r.studentId as unknown as string;
      setRow(rid, force ? 'Force rendering…' : 'Rendering…');
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
        setRow(rid, null);
      }
    },
    [renderPDF, setRow],
  );

  const actMarkPrinted = useCallback(
    async (r: Row) => {
      if (!r.sheet) return;
      const rid = r.studentId as unknown as string;
      setRow(rid, 'Marking printed…');
      try {
        await markPrinted({ sheetId: r.sheet._id });
        toast.success(`${r.studentName}: marked printed`);
      } catch (e) {
        toast.error(`${r.studentName}: ${describeError(e)}`);
      } finally {
        setRow(rid, null);
      }
    },
    [markPrinted, setRow],
  );

  const actMarkCompleted = useCallback(
    async (r: Row) => {
      if (!r.sheet) return;
      const rid = r.studentId as unknown as string;
      setRow(rid, 'Marking completed…');
      try {
        await markCompleted({ sheetId: r.sheet._id });
        toast.success(`${r.studentName}: marked completed`);
      } catch (e) {
        toast.error(`${r.studentName}: ${describeError(e)}`);
      } finally {
        setRow(rid, null);
      }
    },
    [markCompleted, setRow],
  );

  // ── Bulk slot actions ──
  const eligible = useMemo(
    () => (slotRows ?? []).filter((r) => !r.isOffDay),
    [slotRows],
  );

  const bulkGenerate = useCallback(async () => {
    const targets = eligible;
    if (targets.length === 0) return;
    setBulkBusy({ kind: 'generate', total: targets.length, done: 0 });
    let saved = 0;
    let offDay = 0;
    const errs: string[] = [];
    for (const r of targets) {
      const scope = studentScope(r.studentId);
      if (!scope) {
        errs.push(`${r.studentName}: no scope`);
        setBulkBusy((b) => (b ? { ...b, done: b.done + 1 } : b));
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
      setBulkBusy((b) => (b ? { ...b, done: b.done + 1 } : b));
    }
    setBulkBusy(null);
    if (errs.length === 0) {
      toast.success(
        `Generated ${saved} draft${saved === 1 ? '' : 's'}${offDay ? ` (+${offDay} off-day skipped)` : ''}`,
      );
    } else {
      toast.error(`${saved} saved, ${errs.length} failed. First: ${errs[0]}`);
    }
  }, [eligible, saveSheet, studentScope, dateStr, slotId]);

  const bulkRender = useCallback(
    async (force: boolean) => {
      const targets = eligible.filter((r) => r.sheet && !r.sheet.pdfStorageId);
      if (targets.length === 0) {
        toast.info(
          force ? 'Nothing to force render.' : 'No drafts without PDFs — nothing to render.',
        );
        return;
      }
      setBulkBusy({
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
        setBulkBusy((b) => (b ? { ...b, done: b.done + 1 } : b));
      }
      setBulkBusy(null);
      if (errs.length === 0) {
        toast.success(
          `Rendered ${rendered} PDF${rendered === 1 ? '' : 's'}${partial ? ` (${partial} partial)` : ''}`,
        );
      } else {
        toast.error(`${rendered} rendered, ${errs.length} failed. First: ${errs[0]}`);
      }
    },
    [eligible, renderPDF],
  );

  const bulkZip = useCallback(async () => {
    setBulkBusy({ kind: 'zip', total: 1, done: 0 });
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
      setBulkBusy(null);
    }
  }, [zipAction, slotId, dateStr]);

  // ── Render ──
  return (
    <div className="h-full flex flex-col">
      {/* Status chips — sticky at the top of the tab. */}
      <div className="shrink-0 pb-2">
        <StatusChips selected={statuses} onChange={setStatuses} />
      </div>

      {/* Scrollable body: summary + bulk + row list. */}
      <div className="flex-1 min-h-0 overflow-y-auto pb-2">
        <SummaryStrip dateStr={dateStr} counts={counts} />
        <BulkActions
          counts={counts}
          busy={bulkBusy}
          onGenerate={bulkGenerate}
          onRender={() => bulkRender(false)}
          onForceRender={() => bulkRender(true)}
          onZip={bulkZip}
          lastZip={lastZip}
        />

        {slotRows === undefined || slotRows === null ? (
          <div className="mt-3 space-y-2 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 bg-muted rounded-xl" />
            ))}
          </div>
        ) : slotRows.length === 0 ? (
          <div className="mt-3 rounded-xl border border-border bg-card p-4 text-center text-[12px] text-muted-foreground">
            No students in this session.
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="mt-3 rounded-xl border border-border bg-card p-4 text-center text-[12px] text-muted-foreground">
            No rows match the current status filter.
          </div>
        ) : (
          <section className="mt-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1.5 px-1">
              Roster
              {filteredRows.length !== slotRows.length && (
                <span className="ml-1 text-muted-foreground/70">
                  · showing {filteredRows.length} of {slotRows.length}
                </span>
              )}
            </div>
            <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
              {filteredRows.map((r) => (
                <StudentRow
                  key={r.studentId as unknown as string}
                  row={r}
                  busyLabel={rowBusy[r.studentId as unknown as string] ?? null}
                  onOpenInspect={() => setOpenStudentId(r.studentId)}
                  onOpenEdit={() => {
                    if (r.sheet) setEditSheetId(r.sheet._id);
                  }}
                  onGenerate={() => actGenerate(r)}
                  onRender={() => actRender(r, false)}
                  onForceRender={() => actRender(r, true)}
                  onMarkPrinted={() => actMarkPrinted(r)}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      {openRow && !editSheetId && (
        <InspectorDrawer
          row={openRow}
          dateStr={dateStr}
          unitIds={studentScope(openRow.studentId)?.unitIds ?? []}
          gradeByModule={studentScope(openRow.studentId)?.gradeByModule ?? {}}
          busyLabel={rowBusy[openRow.studentId as unknown as string] ?? null}
          onClose={() => setOpenStudentId(null)}
          onOpenEdit={() => {
            if (openRow.sheet) setEditSheetId(openRow.sheet._id);
          }}
          onGenerate={() => actGenerate(openRow)}
          onRender={() => actRender(openRow, false)}
          onForceRender={() => actRender(openRow, true)}
          onMarkPrinted={() => actMarkPrinted(openRow)}
          onMarkCompleted={() => actMarkCompleted(openRow)}
        />
      )}

      {editSheetId && (
        <SheetPreviewDrawer
          sheetId={editSheetId}
          onClose={() => setEditSheetId(null)}
        />
      )}
    </div>
  );
}

function StatusChips({
  selected,
  onChange,
}: {
  selected: SheetRowStatus[];
  onChange: (next: SheetRowStatus[]) => void;
}) {
  const toggle = (s: SheetRowStatus) =>
    onChange(
      selected.includes(s) ? selected.filter((x) => x !== s) : [...selected, s],
    );
  return (
    <div className="flex flex-wrap gap-1">
      {STATUS_OPTIONS.map((opt) => {
        const on = selected.includes(opt.id);
        return (
          <button
            key={opt.id}
            onClick={() => toggle(opt.id)}
            className={cn(
              'px-2 py-0.5 rounded-md text-[10px] font-semibold border transition-colors',
              on
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {opt.label}
          </button>
        );
      })}
      {selected.length > 0 && (
        <button
          onClick={() => onChange([])}
          className="px-2 py-0.5 rounded-md text-[10px] font-semibold text-muted-foreground hover:text-foreground"
        >
          Clear
        </button>
      )}
    </div>
  );
}
