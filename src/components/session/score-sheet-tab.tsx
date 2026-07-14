'use client';

// ScoreSheetTab — the merged "Sheets" tab on /session/[slotId]/[date].
//
// Folds the old Score tab and the old Sheets tab into one master-detail
// surface:
//   • Pills header (always visible) — one chip per roster student, colored by
//     sheet-aware status (no-sheet / draft / printed / scoring / done /
//     off-day) and sorted "needs action first". Tapping a pill selects that
//     student.
//   • A compact controls row (Generate all · Render all · ZIP) for the whole
//     roster, lifted from the old Sheets tab.
//   • Detail pane — the selected student's section-tabbed scoring grid
//     (SheetScoringGrid), or an inline "Generate sheet" CTA when they have no
//     sheet yet, or an off-day note. The grid owns its own section tabs and an
//     inline "View sheet" toggle (question crops shown in place — no drawer).
//   • A per-student action toolbar (Open PDF · Render · Re-generate · Mark
//     printed) sits above the grid.
//
// Scoring writes only to generatedSheets / sessionPoints / the engine — the
// legacy `entries` table is no longer touched here. Marking a question also
// auto-marks the student present (guarded so it never overwrites an explicit
// absent set in the Attendance tab).

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAction, useMutation } from 'convex/react';
// Cached drop-in for useQuery: last result renders instantly from device
// storage while the live subscription refreshes (perf phase 3).
import { useCachedQuery as useQuery } from '@/hooks/use-cached-query';
import { toast } from 'sonner';
import {
  Coffee,
  ExternalLink,
  FileDown,
  Loader2,
  Printer,
  RefreshCw,
  Save,
  Sparkles,
  Zap,
} from 'lucide-react';
import { api, type Id } from '@/lib/convex';
import { cn } from '@/lib/utils';
import { SheetScoringGrid } from '@/components/session/sheet-scoring-grid';
import { SheetPlannerPanel } from '@/components/session/sheet-planner-panel';
import { TrackProgressStrip } from '@/components/session/track-progress-strip';
import {
  PILL_SORT_RANK,
  PILL_STYLES,
  pillStatus,
  rowStatus,
  type Row,
} from '@/components/sheets/shared';
import {
  describeError,
  resolveGradeByModule,
  unitIdsForScope,
  type StudentLite,
} from '@/lib/sheets/scope';

export function ScoreSheetTab({
  slotId,
  date,
}: {
  slotId: Id<'scheduleSlots'>;
  date: string;
}) {
  const [selectedStudentId, setSelectedStudentId] =
    useState<Id<'students'> | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState<{
    kind: string;
    total: number;
    done: number;
  } | null>(null);
  // Generate-time control panel target (null = closed).
  const [plannerRow, setPlannerRow] = useState<Row | null>(null);

  // ── Data ────────────────────────────────────────────────────────────
  const slotRows = useQuery(api.learningEngine.sheets.listSheetsForSlotDate, {
    slotId,
    dateStr: date,
  });
  const allStudents = useQuery(api.students.list);
  const attendance = useQuery(api.attendance.getBySlotAndDate, { slotId, date });
  // Departments redesign: group-plan context for this slot (non-null for any
  // group-owned slot; .sheet set when a crystallized group sheet exists —
  // then "Generate all" materializes it as the identical Main block for the
  // whole roster).
  const groupPlanInfo = useQuery(
    api.learningEngine.groupPlan.plannedGroupSheetForSlotDate,
    { slotId, dateStr: date },
  );
  // Non-null ONLY when this slot is a Revision-department session: per-student
  // queues of group-claimed-but-unseen questions (delegated + absence
  // catch-up). Drives Generate all instead of the group plan.
  const revisionQueues = useQuery(
    api.learningEngine.groupPlan.revisionQueuesForSlotDate,
    { slotId, dateStr: date },
  );

  const saveSheet = useMutation(api.learningEngine.planner.saveSheetForStudent);
  const markGroupSheetMaterialized = useMutation(
    api.learningEngine.groupPlan.markMaterialized,
  );
  const consumeCarryRows = useMutation(api.learningEngine.groupPlan.consumeCarryRows);
  const renderPDF = useAction(api.learningEngine.pdf.renderSheetPDF);
  const zipAction = useAction(api.learningEngine.sheets.zipSheetPDFs);
  const markPrinted = useMutation(api.learningEngine.planner.markPrinted);
  const markPresent = useMutation(api.attendance.markPresent);

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

  // Pills, sorted "needs action first" then by name.
  const pills = useMemo(() => {
    const rows = (slotRows ?? []).slice();
    rows.sort((a, b) => {
      const ra = PILL_SORT_RANK[pillStatus(a)];
      const rb = PILL_SORT_RANK[pillStatus(b)];
      if (ra !== rb) return ra - rb;
      return a.studentName.localeCompare(b.studentName);
    });
    return rows;
  }, [slotRows]);

  // Auto-select the first actionable student once data lands / selection drops.
  useEffect(() => {
    if (!slotRows || slotRows.length === 0) return;
    const stillValid =
      selectedStudentId &&
      slotRows.some((r) => r.studentId === selectedStudentId);
    if (stillValid) return;
    const firstActionable =
      pills.find((r) => !r.isOffDay) ?? pills[0] ?? null;
    setSelectedStudentId(firstActionable ? firstActionable.studentId : null);
  }, [slotRows, pills, selectedStudentId]);

  const selectedRow: Row | null = useMemo(() => {
    if (!selectedStudentId) return null;
    return (
      (slotRows ?? []).find((r) => r.studentId === selectedStudentId) ?? null
    );
  }, [slotRows, selectedStudentId]);

  // Full student doc for the selected pill — feeds the track-progress strip.
  const selectedStudent = useMemo(() => {
    if (!selectedStudentId) return null;
    return (
      (allStudents as StudentLite[] | undefined)?.find(
        (s) => s._id === selectedStudentId,
      ) ?? null
    );
  }, [allStudents, selectedStudentId]);

  // ── Auto-mark present (guarded) ───────────────────────────────────────
  // Called by the grid on the first mark. Marks the student present only if
  // they have NO attendance record yet — never overwrites an explicit absent.
  const onFirstMark = useCallback(() => {
    if (!selectedStudentId) return;
    const rec = (attendance ?? []).find(
      (a) => a.studentId === selectedStudentId,
    );
    if (rec) return; // present or explicitly absent — leave it alone
    markPresent({ studentId: selectedStudentId, slotId, date }).catch(() => {});
  }, [selectedStudentId, attendance, markPresent, slotId, date]);

  // ── Per-student sheet actions ─────────────────────────────────────────
  // Generate opens the control panel (preview + tune) rather than writing
  // immediately. The panel previews via planSheet and writes on confirm.
  const openPlanner = useCallback(
    (r: Row) => {
      if (!studentScope(r.studentId)) {
        toast.error("Couldn't resolve this student's module scope.");
        return;
      }
      setPlannerRow(r);
    },
    [studentScope],
  );

  const doRender = useCallback(
    async (r: Row, force: boolean) => {
      if (!r.sheet) return;
      setRowBusy(force ? 'Force rendering…' : 'Rendering…');
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
          toast.success(`${r.studentName}: PDF rendered`);
        }
      } catch (e) {
        toast.error(`${r.studentName}: ${describeError(e)}`);
      } finally {
        setRowBusy(null);
      }
    },
    [renderPDF],
  );

  const doMarkPrinted = useCallback(
    async (r: Row) => {
      if (!r.sheet) return;
      setRowBusy('Marking printed…');
      try {
        await markPrinted({ sheetId: r.sheet._id });
        toast.success(`${r.studentName}: marked printed`);
      } catch (e) {
        toast.error(`${r.studentName}: ${describeError(e)}`);
      } finally {
        setRowBusy(null);
      }
    },
    [markPrinted],
  );

  // ── Bulk roster actions ───────────────────────────────────────────────
  const eligible = useMemo(
    () => (slotRows ?? []).filter((r) => !r.isOffDay),
    [slotRows],
  );

  const bulkGenerate = useCallback(async () => {
    const targets = eligible;
    if (targets.length === 0) return;
    // Departments redesign, two special session shapes:
    //   Revision session → each student's Main block = their personal queue
    //   (delegated group material + absence catch-up); consolidation-mode
    //   students get the fully personal planner instead (empty queue).
    //   Main session with a crystallized group sheet → one identical Main
    //   block for the whole roster.
    const isRevisionSession = revisionQueues !== null && revisionQueues !== undefined;
    const planSheet = groupPlanInfo?.sheet ?? null;
    const fromPlan = !isRevisionSession && planSheet && planSheet.status === 'planned';
    setBulkBusy({ kind: 'generate', total: targets.length, done: 0 });
    let saved = 0;
    const errs: string[] = [];
    for (const r of targets) {
      const scope = studentScope(r.studentId);
      if (!scope) {
        errs.push(`${r.studentName}: no scope`);
        setBulkBusy((b) => (b ? { ...b, done: b.done + 1 } : b));
        continue;
      }
      const queue = isRevisionSession
        ? revisionQueues!.queues[r.studentId as unknown as string]
        : undefined;
      try {
        const res = await saveSheet({
          studentId: r.studentId,
          dateStr: date,
          unitIds: scope.unitIds,
          gradeByModule: scope.gradeByModule,
          slotId,
          ...(fromPlan
            ? { mainQuestionIdsOverride: planSheet.questionIds }
            : queue && queue.questionIds.length > 0
              ? { mainQuestionIdsOverride: queue.questionIds }
              : {}),
        });
        if (res.status === 'ok') {
          saved += 1;
          // Carry-over leftovers can't self-clean out of the queue (their
          // questions are already "seen") — stamp them consumed now that
          // this student's queue sheet exists.
          if (queue && queue.carryRowIds.length > 0) {
            await consumeCarryRows({ rowIds: queue.carryRowIds }).catch(() => {});
          }
        }
      } catch (e) {
        errs.push(`${r.studentName}: ${describeError(e)}`);
      }
      setBulkBusy((b) => (b ? { ...b, done: b.done + 1 } : b));
    }
    if (fromPlan && saved > 0) {
      try {
        await markGroupSheetMaterialized({ groupSheetId: planSheet.id });
      } catch {
        // Non-fatal: sheets exist; the plan row just keeps status "planned".
      }
    }
    setBulkBusy(null);
    if (errs.length === 0)
      toast.success(
        fromPlan
          ? `Generated ${saved} sheet${saved === 1 ? '' : 's'} from the group plan`
          : isRevisionSession
            ? `Generated ${saved} revision sheet${saved === 1 ? '' : 's'} (personal queues)`
            : `Generated ${saved} sheet${saved === 1 ? '' : 's'}`,
      );
    else toast.error(`${saved} saved, ${errs.length} failed. First: ${errs[0]}`);
  }, [
    eligible,
    saveSheet,
    studentScope,
    date,
    slotId,
    groupPlanInfo,
    revisionQueues,
    markGroupSheetMaterialized,
    consumeCarryRows,
  ]);

  const bulkRender = useCallback(async () => {
    const targets = eligible.filter((r) => r.sheet && !r.sheet.pdfStorageId);
    if (targets.length === 0) {
      toast.info('No drafts without PDFs — nothing to render.');
      return;
    }
    setBulkBusy({ kind: 'render', total: targets.length, done: 0 });
    let rendered = 0;
    const errs: string[] = [];
    for (const r of targets) {
      try {
        await renderPDF({ sheetId: r.sheet!._id, onMissingImage: 'fail' });
        rendered += 1;
      } catch (e) {
        errs.push(`${r.studentName}: ${describeError(e)}`);
      }
      setBulkBusy((b) => (b ? { ...b, done: b.done + 1 } : b));
    }
    setBulkBusy(null);
    if (errs.length === 0) toast.success(`Rendered ${rendered} PDF${rendered === 1 ? '' : 's'}`);
    else toast.error(`${rendered} rendered, ${errs.length} failed. First: ${errs[0]}`);
  }, [eligible, renderPDF]);

  const bulkZip = useCallback(async () => {
    setBulkBusy({ kind: 'zip', total: 1, done: 0 });
    try {
      const res = await zipAction({ slotId, dateStr: date });
      toast.success(
        `ZIP ready (${res.includedCount} PDF${res.includedCount === 1 ? '' : 's'}, ${res.skipped.length} skipped)`,
      );
      if (res.downloadUrl) window.open(res.downloadUrl, '_blank');
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setBulkBusy(null);
    }
  }, [zipAction, slotId, date]);

  // ── Render ────────────────────────────────────────────────────────────
  if (slotRows === undefined) {
    return (
      <div className="h-full flex flex-col gap-3 animate-pulse">
        <div className="h-9 rounded-xl bg-muted/40" />
        <div className="h-24 rounded-xl bg-muted/30" />
        <div className="flex-1 rounded-xl bg-muted/20" />
      </div>
    );
  }
  if (slotRows === null) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-center text-[12px] text-muted-foreground">
        Not signed in.
      </div>
    );
  }
  if (slotRows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-center text-[12px] text-muted-foreground">
        No students in this session.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Pills header */}
      <div className="shrink-0 min-h-[44px] flex flex-wrap gap-1.5 pb-2">
        {pills.map((r) => {
          const ps = pillStatus(r);
          const style = PILL_STYLES[ps];
          const selected = r.studentId === selectedStudentId;
          return (
            <button
              key={r.studentId as unknown as string}
              onClick={() => setSelectedStudentId(r.studentId)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium h-[36px] transition-all',
                style.cls,
                selected &&
                  'ring-2 ring-primary ring-offset-1 ring-offset-background',
              )}
              title={`${r.studentName} · ${style.label}`}
            >
              {r.studentName.split(' ')[0]}
            </button>
          );
        })}
      </div>

      {/* Revision session banner (departments redesign) */}
      {revisionQueues && (
        <div className="shrink-0 mb-2 rounded-lg border border-amber-500/50 bg-amber-500/10 px-2.5 py-1.5 text-[10px] text-foreground">
          <b>Revision session:</b> Generate all builds each student&rsquo;s
          personal sheet — delegated group material + missed questions
          (consolidation students get their repeat-heavy sheet instead).
        </div>
      )}

      {/* Group plan banner (departments redesign) — shown for EVERY
          group-owned main session so the plan page is always reachable. */}
      {!revisionQueues && groupPlanInfo && (
        <div
          className={cn(
            'shrink-0 mb-2 rounded-lg border px-2.5 py-1.5 flex items-center justify-between gap-2 text-[10px]',
            groupPlanInfo.sheet?.status === 'planned'
              ? 'border-primary/50 bg-primary/10 text-foreground'
              : 'border-border bg-card text-muted-foreground',
          )}
        >
          <span className="min-w-0 truncate">
            {groupPlanInfo.sheet?.status === 'planned' ? (
              <>
                <b>Group plan ready:</b> {groupPlanInfo.sheet.newCount} new +{' '}
                {groupPlanInfo.sheet.spiralCount} spiral — Generate all uses it.
              </>
            ) : groupPlanInfo.sheet ? (
              <>Group plan sheet already generated for this session.</>
            ) : (
              <>No prebuilt sheet for today — open the plan to crystallize.</>
            )}
          </span>
          <Link
            href={`/groups/${groupPlanInfo.groupId}/plan`}
            className="shrink-0 font-semibold text-primary"
          >
            Group plan
          </Link>
        </div>
      )}

      {/* Roster controls */}
      <div className="shrink-0 flex items-center gap-1.5 pb-2 overflow-x-auto">
        <CtrlBtn
          icon={<Save className="w-3 h-3" />}
          label="Generate all"
          busy={bulkBusy?.kind === 'generate'}
          busyLabel={bulkBusy ? `${bulkBusy.done}/${bulkBusy.total}` : undefined}
          onClick={bulkGenerate}
          disabled={!!bulkBusy}
        />
        <CtrlBtn
          icon={<RefreshCw className="w-3 h-3" />}
          label="Render all"
          busy={bulkBusy?.kind === 'render'}
          busyLabel={bulkBusy ? `${bulkBusy.done}/${bulkBusy.total}` : undefined}
          onClick={bulkRender}
          disabled={!!bulkBusy}
        />
        <CtrlBtn
          icon={<FileDown className="w-3 h-3" />}
          label="ZIP"
          busy={bulkBusy?.kind === 'zip'}
          onClick={bulkZip}
          disabled={!!bulkBusy}
        />
      </div>

      {/* Detail pane */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {!selectedRow ? (
          <div className="rounded-xl border border-border bg-card p-6 text-center text-[12px] text-muted-foreground">
            Select a student above to start scoring.
          </div>
        ) : (
          <>
            {selectedStudent && !selectedRow.isOffDay && (
              <TrackProgressStrip student={selectedStudent} />
            )}
            <DetailPane
              row={selectedRow}
              rowBusy={rowBusy}
              slotId={slotId}
              onFirstMark={onFirstMark}
              onGenerate={() => openPlanner(selectedRow)}
              onRender={() => doRender(selectedRow, false)}
              onForceRender={() => doRender(selectedRow, true)}
              onMarkPrinted={() => doMarkPrinted(selectedRow)}
            />
          </>
        )}
      </div>

      {/* Lesson Builder (full-screen generate dialog) */}
      {plannerRow &&
        (() => {
          const scope = studentScope(plannerRow.studentId);
          if (!scope) return null;
          // Roster chips: every non-off-day student in the session; students
          // with a printed/completed sheet are shown but locked.
          const plannerRoster = (slotRows ?? [])
            .filter((r) => !r.isOffDay)
            .map((r) => ({
              studentId: r.studentId,
              studentName: r.studentName,
              locked:
                r.sheet?.status === 'printed' ||
                r.sheet?.status === 'completed',
            }));
          return (
            <SheetPlannerPanel
              studentId={plannerRow.studentId}
              studentName={plannerRow.studentName}
              date={date}
              slotId={slotId}
              unitIds={scope.unitIds}
              gradeByModule={scope.gradeByModule}
              roster={plannerRoster}
              resolveScope={(id) => studentScope(id)}
              onClose={() => setPlannerRow(null)}
              onGenerated={() => setPlannerRow(null)}
            />
          );
        })()}
    </div>
  );
}

// ── Detail pane ─────────────────────────────────────────────────────────────

function DetailPane({
  row,
  rowBusy,
  slotId,
  onFirstMark,
  onGenerate,
  onRender,
  onForceRender,
  onMarkPrinted,
}: {
  row: Row;
  rowBusy: string | null;
  slotId: Id<'scheduleSlots'>;
  onFirstMark: () => void;
  onGenerate: () => void;
  onRender: () => void;
  onForceRender: () => void;
  onMarkPrinted: () => void;
}) {
  const status = rowStatus(row);
  const hasPdf = !!row.sheet?.pdfStorageId;
  const markedCount = row.sheet?.markedCount ?? 0;

  // Re-generate replaces the sheet (new question selection) — warn first if
  // marks already exist, since a fresh selection orphans those marks.
  const handleRegenerate = () => {
    if (
      markedCount > 0 &&
      !window.confirm(
        `${row.studentName} already has ${markedCount} marked question${markedCount === 1 ? '' : 's'}. Re-generating builds a new sheet and discards those marks. Continue?`,
      )
    ) {
      return;
    }
    onGenerate();
  };

  // Header line: name · grade · marked tally.
  const header = (
    <div className="flex items-center gap-2 mb-2 min-w-0">
      <div className="min-w-0">
        <div className="text-sm font-bold text-foreground truncate">
          {row.studentName}
        </div>
        <div className="text-[10px] text-muted-foreground">
          G{row.schoolGrade}
          {row.sheet && (
            <>
              {' · '}
              {row.sheet.questionCount} Q{row.sheet.questionCount === 1 ? '' : 's'}
              {row.sheet.markedCount > 0 && (
                <> · {row.sheet.markedCount} marked</>
              )}
            </>
          )}
        </div>
      </div>
      {rowBusy && (
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          {rowBusy}
        </span>
      )}
    </div>
  );

  // Off day — nothing to score.
  if (status === 'off-day') {
    return (
      <div className="rounded-xl border border-dashed border-border/60 p-6 text-center">
        <Coffee className="w-6 h-6 text-muted-foreground/50 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">{row.studentName} is off today.</p>
        <p className="text-[11px] text-muted-foreground/80">No sheet for this date.</p>
      </div>
    );
  }

  // No sheet — inline Generate CTA.
  if (status === 'no-sheet') {
    return (
      <div className="rounded-xl border border-dashed border-border/60 p-6 text-center">
        <p className="text-sm font-semibold text-foreground mb-1">
          {row.studentName}
        </p>
        <p className="text-[11px] text-muted-foreground mb-3">
          No sheet generated for this date yet.
        </p>
        <button
          onClick={onGenerate}
          disabled={!!rowBusy}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50"
        >
          {rowBusy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5" />
          )}
          Generate sheet
        </button>
      </div>
    );
  }

  // Sheet exists — action toolbar + scoring grid.
  return (
    <div>
      {header}

      {/* Per-student sheet actions — always available while a sheet exists, so
          the teacher can Re-generate (e.g. after changing the student's path),
          Re-render the PDF, or mark it printed without leaving the scoring
          grid. The section tabs + inline "View sheet" toggle live in the grid
          header below. */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {row.sheet?.pdfUrl && (
          <a
            href={row.sheet.pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-muted text-foreground text-[11px] font-semibold hover:bg-muted/80"
          >
            <ExternalLink className="w-3 h-3" />
            Open PDF
          </a>
        )}
        {row.sheet && (
          <>
            <ToolbarBtn
              icon={<RefreshCw className="w-3 h-3" />}
              label={hasPdf ? 'Re-render' : 'Render'}
              tone={hasPdf ? 'ghost' : 'primary'}
              onClick={onRender}
              disabled={!!rowBusy}
            />
            <ToolbarBtn
              icon={<Zap className="w-3 h-3" />}
              label="Force"
              tone="amber"
              onClick={onForceRender}
              disabled={!!rowBusy}
            />
            <ToolbarBtn
              icon={<Sparkles className="w-3 h-3" />}
              label="Re-generate"
              tone="ghost"
              onClick={handleRegenerate}
              disabled={!!rowBusy}
            />
            {status !== 'printed' && status !== 'completed' && (
              <ToolbarBtn
                icon={<Printer className="w-3 h-3" />}
                label="Mark printed"
                tone="primary"
                onClick={onMarkPrinted}
                disabled={!!rowBusy}
              />
            )}
          </>
        )}
      </div>

      {row.sheet && (
        <SheetScoringGrid
          key={row.sheet._id as unknown as string}
          sheetId={row.sheet._id}
          slotId={slotId}
          onFirstMark={onFirstMark}
        />
      )}
    </div>
  );
}

function ToolbarBtn({
  icon,
  label,
  tone,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  tone: 'primary' | 'amber' | 'ghost';
  onClick: () => void;
  disabled?: boolean;
}) {
  const cls = {
    primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
    amber:
      'bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20',
    ghost:
      'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80',
  }[tone];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50 ${cls}`}
    >
      {icon}
      {label}
    </button>
  );
}

function CtrlBtn({
  icon,
  label,
  busy,
  busyLabel,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  busy?: boolean;
  busyLabel?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 text-[11px] font-semibold transition-colors disabled:opacity-50"
    >
      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : icon}
      {busy && busyLabel ? busyLabel : label}
    </button>
  );
}
