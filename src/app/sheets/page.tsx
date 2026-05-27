'use client';

// Phase E.5 — Merged Sheets page.
//
// Consolidates the legacy /algorithm?tab=sheet (single-student planner
// inspector) and /algorithm/sheets (slot dashboard) into one route.
//
// Layout:
//   - Sticky filters bar: date (today/tomorrow/picker), slot, search,
//     filter popover (grade / status / alerts-only).
//   - Summary strip: status counts + prereq-alert total.
//   - Slot bulk actions: Generate / Render / Force render / Download ZIP.
//   - Row list: "In this slot" (always) + "Other students" (only when
//     search or grade filter is active; capped at 50).
//   - Row click → InspectorDrawer (lazy planSheet). Drawer action bar
//     mirrors every per-row verb and adds Mark completed + Edit overrides.
//   - Edit overrides → existing SheetPreviewDrawer mounted by the page.
//
// URL state: ?d=YYYY-MM-DD&slot=<id>&s=<id>. Filters/search stay client-
// only (ephemeral, not bookmarkable).

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAction, useMutation, useQuery } from 'convex/react';
import { toast } from 'sonner';
import { FileSpreadsheet } from 'lucide-react';
import { api, type Id } from '@/lib/convex';
import { SheetPreviewDrawer } from '@/components/algorithm/sheet-preview';
import {
  describeError,
  resolveGradeByModule,
  unitIdsForScope,
  type StudentLite,
} from '@/lib/sheets/scope';
import {
  FiltersBar,
  EMPTY_FILTERS,
  type SheetFilters,
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

// ── Constants + helpers ──────────────────────────────────────────────────

const OFF_SLOT_CAP = 50;

function tomorrowYmd(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Page entry ───────────────────────────────────────────────────────────

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

function SheetsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ── URL-synced state (d / slot / s) ──
  const urlDate = searchParams.get('d') ?? tomorrowYmd();
  const urlSlot = searchParams.get('slot') ?? '';
  const urlStudent = searchParams.get('s') ?? '';

  const updateUrl = useCallback(
    (patch: { d?: string; slot?: string | null; s?: string | null }) => {
      const params = new URLSearchParams(searchParams.toString());
      if (patch.d !== undefined) params.set('d', patch.d);
      if (patch.slot !== undefined) {
        if (patch.slot) params.set('slot', patch.slot);
        else params.delete('slot');
      }
      if (patch.s !== undefined) {
        if (patch.s) params.set('s', patch.s);
        else params.delete('s');
      }
      router.replace(`/sheets?${params.toString()}`);
    },
    [router, searchParams],
  );

  const setDateStr = useCallback(
    (next: string) => {
      // Date change clears slot — a new weekday may have different slots.
      updateUrl({ d: next, slot: null });
    },
    [updateUrl],
  );

  const setSlotId = useCallback(
    (id: Id<'scheduleSlots'> | null) =>
      updateUrl({ slot: id ? (id as unknown as string) : null }),
    [updateUrl],
  );

  const setOpenStudentId = useCallback(
    (id: Id<'students'> | null) =>
      updateUrl({ s: id ? (id as unknown as string) : null }),
    [updateUrl],
  );

  // ── Client-only state ──
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<SheetFilters>(EMPTY_FILTERS);
  const [rowBusy, setRowBusy] = useState<Record<string, string | null>>({});
  const [bulkBusy, setBulkBusy] = useState<BulkBusy>(null);
  const [lastZip, setLastZip] = useState<LastZip>(null);
  // When the drawer is in Edit-overrides mode the inspector is hidden and
  // the existing SheetPreviewDrawer renders on top.
  const [editSheetId, setEditSheetId] = useState<Id<'generatedSheets'> | null>(
    null,
  );

  const setRow = useCallback(
    (id: string, label: string | null) =>
      setRowBusy((m) => ({ ...m, [id]: label })),
    [],
  );

  // ── Convex data ──
  const allSlots = useQuery(api.scheduleSlots.list);
  const allStudents = useQuery(api.students.list);

  // Mutations + actions
  const saveSheet = useMutation(api.learningEngine.planner.saveSheetForStudent);
  const renderPDF = useAction(api.learningEngine.pdf.renderSheetPDF);
  const zipAction = useAction(api.learningEngine.sheets.zipSheetPDFs);
  const markPrinted = useMutation(api.learningEngine.planner.markPrinted);
  const markCompleted = useMutation(api.learningEngine.planner.markCompleted);

  // ── Derived: weekday + slots for this date ──
  const dayOfWeek = useMemo(() => {
    const t = Date.parse(`${urlDate}T00:00:00.000Z`);
    return Number.isNaN(t) ? null : new Date(t).getUTCDay();
  }, [urlDate]);

  const slotsForDay = useMemo(
    () =>
      (allSlots ?? []).filter((s) =>
        dayOfWeek === null ? true : s.dayOfWeek === dayOfWeek,
      ),
    [allSlots, dayOfWeek],
  );

  // Effective slot — explicit URL pick if still valid, else first available.
  const effectiveSlotId: Id<'scheduleSlots'> | null = useMemo(() => {
    if (urlSlot && slotsForDay.some((s) => (s._id as unknown as string) === urlSlot)) {
      return urlSlot as unknown as Id<'scheduleSlots'>;
    }
    return (slotsForDay[0]?._id as Id<'scheduleSlots'> | undefined) ?? null;
  }, [urlSlot, slotsForDay]);

  // Slot students + their sheet rows.
  const slotRows = useQuery(
    api.learningEngine.sheets.listSheetsForSlotDate,
    effectiveSlotId ? { slotId: effectiveSlotId, dateStr: urlDate } : 'skip',
  );

  // ── Off-slot search/filter computation ──
  // Only show "Other students" when the user is actively searching or has a
  // grade filter — otherwise we'd be querying the entire roster every render.
  const hasSearchOrGrade =
    search.trim().length > 0 || filters.grades.length > 0;

  const slotStudentIdSet = useMemo(() => {
    const set = new Set<string>();
    for (const r of slotRows ?? []) {
      set.add(r.studentId as unknown as string);
    }
    return set;
  }, [slotRows]);

  const offSlotCandidateIds = useMemo<Id<'students'>[]>(() => {
    if (!hasSearchOrGrade || !allStudents) return [];
    const q = search.trim().toLowerCase();
    const matches = (allStudents as StudentLite[]).filter((s) => {
      if (slotStudentIdSet.has(s._id as unknown as string)) return false;
      if (filters.grades.length > 0 && !filters.grades.includes(s.schoolGrade))
        return false;
      if (q && !s.name.toLowerCase().includes(q)) return false;
      return true;
    });
    matches.sort((a, b) => a.name.localeCompare(b.name));
    return matches.slice(0, OFF_SLOT_CAP).map((s) => s._id);
  }, [allStudents, hasSearchOrGrade, search, filters.grades, slotStudentIdSet]);

  const offSlotRows = useQuery(
    api.learningEngine.sheets.listSavedSheetHeadersForStudentIds,
    offSlotCandidateIds.length > 0
      ? { studentIds: offSlotCandidateIds, dateStr: urlDate }
      : 'skip',
  );

  // ── Client-side row filtering (search + status + alerts) ──
  const applyClientFilters = useCallback(
    (rows: Row[]): Row[] => {
      const q = search.trim().toLowerCase();
      return rows.filter((r) => {
        if (q && !r.studentName.toLowerCase().includes(q)) return false;
        if (filters.grades.length > 0 && !filters.grades.includes(r.schoolGrade))
          return false;
        if (filters.statuses.length > 0) {
          const s: SheetRowStatus = rowStatus(r);
          if (!filters.statuses.includes(s)) return false;
        }
        if (filters.alertsOnly && (r.sheet?.alertCount ?? 0) === 0)
          return false;
        return true;
      });
    },
    [search, filters],
  );

  const filteredSlotRows = useMemo(
    () => (slotRows ? applyClientFilters(slotRows) : []),
    [slotRows, applyClientFilters],
  );

  const filteredOffSlotRows = useMemo(
    () => (offSlotRows ? applyClientFilters(offSlotRows) : []),
    [offSlotRows, applyClientFilters],
  );

  // Counts for summary/bulk are over the actual slot (unfiltered), so the
  // morning workflow numbers don't drift when the Lead is searching.
  const counts = useMemo(
    () => countByStatus(slotRows ?? []),
    [slotRows],
  );

  // ── Drawer state — resolve which Row is open ──
  const openRow: Row | null = useMemo(() => {
    if (!urlStudent) return null;
    const id = urlStudent;
    for (const r of slotRows ?? []) {
      if ((r.studentId as unknown as string) === id) return r;
    }
    for (const r of offSlotRows ?? []) {
      if ((r.studentId as unknown as string) === id) return r;
    }
    return null;
  }, [urlStudent, slotRows, offSlotRows]);

  // Edit drawer follows the open row's saved sheetId. If the inspector is
  // open but the user clicks Edit overrides we transition by setting
  // editSheetId — see openEdit().
  useEffect(() => {
    // Close edit drawer if the open student changes.
    if (!openRow) setEditSheetId(null);
  }, [openRow]);

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

  // ── Per-row actions (shared with drawer action bar) ──
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
          dateStr: urlDate,
          unitIds: scope.unitIds,
          gradeByModule: scope.gradeByModule,
          slotId: effectiveSlotId ?? undefined,
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
    [saveSheet, studentScope, urlDate, effectiveSlotId, setRow],
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
  const eligibleSlotStudents = useMemo(
    () => (slotRows ?? []).filter((r) => !r.isOffDay),
    [slotRows],
  );

  const bulkGenerate = useCallback(async () => {
    if (!effectiveSlotId) return;
    const targets = eligibleSlotStudents;
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
          dateStr: urlDate,
          unitIds: scope.unitIds,
          gradeByModule: scope.gradeByModule,
          slotId: effectiveSlotId,
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
  }, [eligibleSlotStudents, saveSheet, studentScope, urlDate, effectiveSlotId]);

  const bulkRender = useCallback(
    async (force: boolean) => {
      const targets = eligibleSlotStudents.filter(
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
        toast.error(
          `${rendered} rendered, ${errs.length} failed. First: ${errs[0]}`,
        );
      }
    },
    [eligibleSlotStudents, renderPDF],
  );

  const bulkZip = useCallback(async () => {
    if (!effectiveSlotId) return;
    setBulkBusy({ kind: 'zip', total: 1, done: 0 });
    setLastZip(null);
    try {
      const res = await zipAction({ slotId: effectiveSlotId, dateStr: urlDate });
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
  }, [zipAction, effectiveSlotId, urlDate]);

  // ── Render ──
  const slotsLoading = allSlots === undefined || allStudents === undefined;
  const showOtherStudents = hasSearchOrGrade && filteredOffSlotRows.length > 0;

  return (
    <div className="px-4 pt-5 pb-24 max-w-lg mx-auto">
      <header className="flex items-center gap-2 mb-3">
        <FileSpreadsheet className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground">Sheets</h1>
        {dayOfWeek !== null && (
          <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
            {
              ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayOfWeek]
            }
          </span>
        )}
      </header>

      <FiltersBar
        dateStr={urlDate}
        setDateStr={setDateStr}
        slotId={effectiveSlotId}
        setSlotId={setSlotId}
        slotsForDay={slotsForDay}
        search={search}
        setSearch={setSearch}
        filters={filters}
        setFilters={setFilters}
      />

      {/* No-slot empty state */}
      {!effectiveSlotId && !slotsLoading && (
        <div className="mt-4 rounded-xl border border-border bg-card p-4 text-center text-[12px] text-muted-foreground">
          {slotsForDay.length === 0
            ? 'No slots are scheduled for this weekday. Add one in Settings → Schedule, or search for a student below to inspect them anyway.'
            : 'Pick a slot above.'}
        </div>
      )}

      {/* Summary + bulk panel — only meaningful when a slot is selected */}
      {effectiveSlotId && slotRows !== undefined && slotRows !== null && (
        <>
          <SummaryStrip dateStr={urlDate} counts={counts} />
          <BulkActions
            counts={counts}
            busy={bulkBusy}
            onGenerate={bulkGenerate}
            onRender={() => bulkRender(false)}
            onForceRender={() => bulkRender(true)}
            onZip={bulkZip}
            lastZip={lastZip}
          />
        </>
      )}

      {/* Loading skeleton for slot rows */}
      {effectiveSlotId && slotRows === undefined && (
        <div className="mt-3 space-y-2 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 bg-muted rounded-xl" />
          ))}
        </div>
      )}

      {/* Slot rows */}
      {effectiveSlotId && slotRows && (
        <section className="mt-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1.5 px-1">
            In this slot
            {filteredSlotRows.length !== slotRows.length && (
              <span className="ml-1 text-muted-foreground/70">
                · showing {filteredSlotRows.length} of {slotRows.length}
              </span>
            )}
          </div>
          {filteredSlotRows.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-4 text-center text-[12px] text-muted-foreground">
              {slotRows.length === 0
                ? 'No students in this slot. Add some in Settings → Schedule.'
                : 'No rows match the current search / filter.'}
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
              {filteredSlotRows.map((r) => (
                <StudentRow
                  key={r.studentId as unknown as string}
                  row={r}
                  busyLabel={rowBusy[r.studentId as unknown as string] ?? null}
                  onOpenInspect={() => setOpenStudentId(r.studentId)}
                  onOpenEdit={() => {
                    // Edit-from-row goes straight to the override drawer
                    // without setting openStudentId — so closing the edit
                    // drawer returns the user to the list, not the
                    // inspector they didn't ask for.
                    if (r.sheet) setEditSheetId(r.sheet._id);
                  }}
                  onGenerate={() => actGenerate(r)}
                  onRender={() => actRender(r, false)}
                  onForceRender={() => actRender(r, true)}
                  onMarkPrinted={() => actMarkPrinted(r)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Other students (search / grade matches outside the slot) */}
      {showOtherStudents && (
        <section className="mt-4">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1.5 px-1">
            Other students
            <span className="ml-1 text-muted-foreground/70">
              · {filteredOffSlotRows.length} match
              {filteredOffSlotRows.length === 1 ? '' : 'es'}
            </span>
          </div>
          <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
            {filteredOffSlotRows.map((r) => (
              <StudentRow
                key={r.studentId as unknown as string}
                row={r}
                busyLabel={rowBusy[r.studentId as unknown as string] ?? null}
                onOpenInspect={() => setOpenStudentId(r.studentId)}
                onOpenEdit={() => {
                  if (r.sheet) {
                    setOpenStudentId(r.studentId);
                    setEditSheetId(r.sheet._id);
                  }
                }}
                onGenerate={() => actGenerate(r)}
                onRender={() => actRender(r, false)}
                onForceRender={() => actRender(r, true)}
                onMarkPrinted={() => actMarkPrinted(r)}
              />
            ))}
            {offSlotCandidateIds.length === OFF_SLOT_CAP && (
              <div className="px-3 py-2 text-[10px] text-muted-foreground text-center">
                Showing first {OFF_SLOT_CAP} matches — refine your search to narrow.
              </div>
            )}
          </div>
        </section>
      )}

      {/* Inspector drawer */}
      {openRow && !editSheetId && (
        <InspectorDrawer
          row={openRow}
          dateStr={urlDate}
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

      {/* Edit overrides drawer (existing E.4 modal, mounted by us) */}
      {editSheetId && (
        <SheetPreviewDrawer
          sheetId={editSheetId}
          onClose={() => setEditSheetId(null)}
        />
      )}
    </div>
  );
}
