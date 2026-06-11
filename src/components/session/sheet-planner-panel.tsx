'use client';

// Generate-time control panel (Founder, 2026-06-12). Opens when generating a
// student's sheet. Shows a LIVE read-only preview of exactly which units /
// concepts each section will pull (via the planSheet query — never writes),
// lets the teacher tune per-section question counts, then writes with those
// targets. "Still auto, but feels like override": unset section = algorithm
// decides; set section = your number.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation } from 'convex/react';
import { Minus, Plus, Sparkles, ArrowRight, X } from 'lucide-react';
import { api, type Id } from '@/lib/convex';
import { findUnit } from '@/lib/curriculum-data';
import { describeError } from '@/lib/sheets/scope';
import { toast } from 'sonner';

type SectionKey = 'warmup' | 'main' | 'revision' | 'examPrep';

const SECTIONS: Array<{ key: SectionKey; label: string; emptyHint: string }> = [
  { key: 'warmup', label: 'Warm-up', emptyHint: 'no recent mistakes yet' },
  { key: 'main', label: 'Main', emptyHint: 'no new concepts left on the path' },
  { key: 'revision', label: 'Revision', emptyHint: 'nothing due for revision' },
  { key: 'examPrep', label: 'Exam prep', emptyHint: 'no exam-prep material' },
];

type Pick = {
  concept: { name: string; unitId: string; grade: number; term: number };
};

export function SheetPlannerPanel({
  studentId,
  studentName,
  date,
  slotId,
  unitIds,
  gradeByModule,
  onClose,
  onGenerated,
}: {
  studentId: Id<'students'>;
  studentName: string;
  date: string;
  slotId: Id<'scheduleSlots'>;
  unitIds: string[];
  gradeByModule: Record<string, number[]>;
  onClose: () => void;
  onGenerated: () => void;
}) {
  const [targets, setTargets] = useState<Partial<Record<SectionKey, number>>>({});
  const [saveMainForUnit, setSaveMainForUnit] = useState(false);
  const [busy, setBusy] = useState(false);

  const cleanedTargets = useMemo(() => {
    const out: Record<string, number> = {};
    for (const s of SECTIONS) {
      const v = targets[s.key];
      if (typeof v === 'number') out[s.key] = v;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }, [targets]);

  const plan = useQuery(api.learningEngine.planner.planSheet, {
    studentId,
    dateStr: date,
    unitIds,
    gradeByModule,
    slotId,
    ...(cleanedTargets ? { sectionTargets: cleanedTargets } : {}),
  });
  const saveSheet = useMutation(api.learningEngine.planner.saveSheetForStudent);
  const setUnitMain = useMutation(api.learningEngine.path.setUnitMainQuestions);

  const picks: Record<SectionKey, Pick[]> = {
    warmup: (plan?.warmup ?? []) as Pick[],
    main: (plan?.main ?? []) as Pick[],
    revision: (plan?.revision ?? []) as Pick[],
    examPrep: (plan?.examPrep ?? []) as Pick[],
  };

  // The number shown in the stepper: the explicit target if set, else the
  // count the algorithm actually planned.
  const shownCount = (k: SectionKey): number =>
    targets[k] ?? picks[k].length;
  const total = (['warmup', 'main', 'revision', 'examPrep'] as SectionKey[]).reduce(
    (s, k) => s + shownCount(k),
    0,
  );

  const bump = (k: SectionKey, delta: number) => {
    setTargets((t) => {
      const cur = t[k] ?? picks[k].length;
      const next = Math.max(0, Math.min(30, cur + delta));
      return { ...t, [k]: next };
    });
  };

  // The next unit the Main block teaches (for the "Change order" link + the
  // save-for-unit target). Derived from the first Main pick.
  const mainConcept = picks.main[0]?.concept ?? null;
  const mainUnitName = mainConcept
    ? findUnit(mainConcept.unitId)?.unit.name ?? mainConcept.unitId
    : null;

  const isOffDay = plan?.status === 'off-day';
  const loading = plan === undefined;

  const onGenerate = async () => {
    setBusy(true);
    try {
      if (
        saveMainForUnit &&
        targets.main !== undefined &&
        mainConcept
      ) {
        await setUnitMain({
          grade: mainConcept.grade,
          term: mainConcept.term,
          unitId: mainConcept.unitId,
          count: targets.main,
        });
      }
      const res = await saveSheet({
        studentId,
        dateStr: date,
        unitIds,
        gradeByModule,
        slotId,
        ...(cleanedTargets ? { sectionTargets: cleanedTargets } : {}),
      });
      if (res.status === 'ok') {
        toast.success(`${studentName}: sheet ready`);
        onGenerated();
      } else if (res.status === 'off-day') {
        toast.info(`${studentName}: off-day — no sheet written`);
        onClose();
      } else {
        toast.error(`${studentName}: ${res.status}`);
      }
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-2 pb-[calc(4rem+env(safe-area-inset-bottom,0px)+0.5rem)] sm:pb-2"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-card border border-border shadow-xl max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="min-w-0">
            <div className="text-sm font-bold text-foreground truncate">
              Generate sheet · {studentName}
            </div>
            <div className="text-[11px] text-muted-foreground">{date}</div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Sections */}
        <div className="p-3 space-y-2">
          {isOffDay ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              This student rests today — no sheet will be written.
            </div>
          ) : (
            SECTIONS.map((s) => {
              const list = picks[s.key];
              const n = shownCount(s.key);
              const units = Array.from(
                new Set(list.map((p) => p.concept.unitId)),
              )
                .map((u) => findUnit(u)?.unit.name ?? u)
                .slice(0, 3);
              return (
                <div
                  key={s.key}
                  className="rounded-xl border border-border/70 bg-muted/20 px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-foreground">
                      {s.label}
                    </div>
                    <Stepper
                      value={n}
                      onDec={() => bump(s.key, -1)}
                      onInc={() => bump(s.key, +1)}
                      disabled={loading || busy}
                    />
                  </div>
                  {/* What it will pull */}
                  <div className="mt-1.5 text-[11px] text-muted-foreground">
                    {loading ? (
                      <span className="opacity-60">loading…</span>
                    ) : list.length === 0 ? (
                      <span className="italic">{s.emptyHint}</span>
                    ) : (
                      <span>
                        ▸ {units.join(' · ')}
                        {list.length > 0 && (
                          <span className="text-foreground/70">
                            {' '}
                            — {list.length} question{list.length === 1 ? '' : 's'}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                  {/* Main-only: change order + save-for-unit */}
                  {s.key === 'main' && !loading && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Link
                        href="/algorithm?tab=tracks"
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                      >
                        Change order <ArrowRight className="w-3 h-3" />
                      </Link>
                      {targets.main !== undefined && mainConcept && (
                        <label className="inline-flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer">
                          <input
                            type="checkbox"
                            checked={saveMainForUnit}
                            onChange={(e) => setSaveMainForUnit(e.target.checked)}
                            className="accent-primary"
                          />
                          save {n} for {mainUnitName}
                        </label>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border">
          <div className="text-[11px] text-muted-foreground">
            Total{' '}
            <span className="font-semibold text-foreground">{total}</span>
            {cleanedTargets && (
              <button
                onClick={() => {
                  setTargets({});
                  setSaveMainForUnit(false);
                }}
                className="ml-2 text-primary hover:underline"
              >
                reset to auto
              </button>
            )}
          </div>
          <button
            onClick={onGenerate}
            disabled={loading || busy || isOffDay}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {busy ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stepper({
  value,
  onDec,
  onInc,
  disabled,
}: {
  value: number;
  onDec: () => void;
  onInc: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        onClick={onDec}
        disabled={disabled || value <= 0}
        className="w-6 h-6 inline-flex items-center justify-center rounded-md bg-muted text-foreground disabled:opacity-40 hover:bg-muted/70"
        aria-label="Decrease"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>
      <span className="min-w-[1.5rem] text-center text-sm font-bold tabular-nums text-foreground">
        {value}
      </span>
      <button
        onClick={onInc}
        disabled={disabled || value >= 30}
        className="w-6 h-6 inline-flex items-center justify-center rounded-md bg-muted text-foreground disabled:opacity-40 hover:bg-muted/70"
        aria-label="Increase"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
