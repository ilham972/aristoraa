'use client';

// Sheet redesign (Phase 2) — Teaching Path editor.
// A per-(grade, term) ordered list of units the teacher intends to TEACH, in
// order. This order drives the Main block of every sheet (Phase 4): the
// planner walks each student to the next not-yet-introduced concept along this
// path. Exam-priority is shown only as a HINT — the order stays the teacher's.
//
// Reorder works two ways so it's reliable on a phone:
//   • drag the grip handle (pointer events; works with touch), or
//   • the ▲ / ▼ buttons (precise, never mis-fires).
// Either way, the new order persists immediately via setTeachingPath.

import { useMemo, useRef, useState, useCallback } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { GripVertical, ChevronUp, ChevronDown, Check } from 'lucide-react';
import { api } from '@/lib/convex';
import { CURRICULUM_MODULES } from '@/lib/curriculum-data';
import { MODULE_COLORS } from '@/lib/types';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const GRADES = [6, 7, 8, 9, 10, 11];
const TERMS: Array<1 | 2 | 3> = [1, 2, 3];

// Natural curriculum order of units for (grade, term) across ALL modules.
function naturalUnits(
  grade: number,
  term: number,
): Array<{ unitId: string; unitName: string; moduleId: string }> {
  const out: Array<{ unitId: string; unitName: string; moduleId: string }> = [];
  for (const mod of CURRICULUM_MODULES) {
    const g = mod.grades.find((gr) => gr.grade === grade);
    if (!g) continue;
    const t = g.terms.find((tt) => tt.term === term);
    if (!t) continue;
    for (const u of t.units) {
      out.push({ unitId: u.id, unitName: u.name, moduleId: mod.id });
    }
  }
  return out;
}

type Card = {
  unitId: string;
  unitName: string;
  conceptCount: number;
  examPriority: number;
  marks: number | null;
};

function GradeTermSelector({
  grade,
  term,
  setGrade,
  setTerm,
}: {
  grade: number;
  term: 1 | 2 | 3;
  setGrade: (g: number) => void;
  setTerm: (t: number) => void;
}) {
  return (
    <div className="space-y-2 mb-4">
      <div className="flex gap-1 p-1 bg-muted rounded-xl overflow-x-auto">
        {GRADES.map((g) => (
          <button
            key={g}
            onClick={() => setGrade(g)}
            className={cn(
              'flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all whitespace-nowrap',
              g === grade
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            G{g}
          </button>
        ))}
      </div>
      <div className="flex gap-1 p-1 bg-muted rounded-xl">
        {TERMS.map((t) => (
          <button
            key={t}
            onClick={() => setTerm(t)}
            className={cn(
              'flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all',
              t === term
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Term {t}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PathTab({
  grade,
  term,
  setGrade,
  setTerm,
}: {
  grade: number;
  term: 1 | 2 | 3;
  setGrade: (g: number) => void;
  setTerm: (t: number) => void;
}) {
  const units = useMemo(
    () => naturalUnits(grade, term).map((u) => ({ unitId: u.unitId, unitName: u.unitName })),
    [grade, term],
  );
  const moduleByUnit = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of naturalUnits(grade, term)) m.set(u.unitId, u.moduleId);
    return m;
  }, [grade, term]);

  const data = useQuery(api.learningEngine.path.listPathUnitsWithPriority, {
    grade,
    term,
    units,
  });
  const setPath = useMutation(api.learningEngine.path.setTeachingPath);

  // Local working order. Seeded from the server (already sorted by saved
  // order); re-seeded whenever the (grade, term) scope or server data changes
  // — but NOT while the user is mid-drag, so an in-flight save can't snap the
  // list back under their finger.
  const [order, setOrder] = useState<Card[]>([]);
  const [savedFlash, setSavedFlash] = useState(false);
  const draggingRef = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Re-seed local order from the server whenever the query result changes
  // (grade/term switch, or a save round-trips) — but never mid-drag, so an
  // in-flight save can't snap the list back under the user's finger. This is
  // React's "adjust state during render" pattern: a state-guarded signature
  // (not a ref) keeps it to once per new server order and lets it converge.
  const [seedSig, setSeedSig] = useState<string | null>(null);
  const sig = data
    ? `${grade}-${term}:${(data as Card[]).map((c) => c.unitId).join('|')}`
    : null;
  if (sig !== null && sig !== seedSig && draggingId === null) {
    setSeedSig(sig);
    setOrder(data as Card[]);
  }

  const persist = useCallback(
    async (next: Card[]) => {
      try {
        await setPath({
          grade,
          term,
          orderedUnitIds: next.map((c) => c.unitId),
        });
        setSavedFlash(true);
        window.setTimeout(() => setSavedFlash(false), 1200);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to save order');
        if (data) setOrder(data as Card[]); // revert to server truth
      }
    },
    [setPath, grade, term, data],
  );

  // ── Pointer drag ──────────────────────────────────────────────────────────
  const itemRefs = useRef<Map<string, HTMLLIElement>>(new Map());

  const onHandlePointerDown = (
    e: React.PointerEvent,
    unitId: string,
  ) => {
    e.preventDefault();
    draggingRef.current = unitId;
    setDraggingId(unitId);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onHandlePointerMove = (e: React.PointerEvent) => {
    const dragId = draggingRef.current;
    if (!dragId) return;
    const y = e.clientY;
    // Find the unit whose row currently contains the pointer's Y.
    let targetId: string | null = null;
    for (const [uid, el] of itemRefs.current) {
      const r = el.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) {
        targetId = uid;
        break;
      }
    }
    if (!targetId || targetId === dragId) return;
    setOrder((prev) => {
      const from = prev.findIndex((c) => c.unitId === dragId);
      const to = prev.findIndex((c) => c.unitId === targetId);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = prev.slice();
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  const onHandlePointerUp = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    draggingRef.current = null;
    setDraggingId(null);
    setOrder((cur) => {
      void persist(cur);
      return cur;
    });
  };

  const onButtonMove = (idx: number, dir: -1 | 1) => {
    const to = idx + dir;
    setOrder((prev) => {
      if (to < 0 || to >= prev.length) return prev;
      const next = prev.slice();
      const [item] = next.splice(idx, 1);
      next.splice(to, 0, item);
      void persist(next);
      return next;
    });
  };

  return (
    <>
      <GradeTermSelector grade={grade} term={term} setGrade={setGrade} setTerm={setTerm} />

      <div className="flex items-start justify-between gap-2 mb-3">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          The order you teach these units. Drag the grip or use ▲▼ to reorder.
          The Main block walks each student down this path. The exam-priority
          bar is a hint — keep the order that suits your teaching.
        </p>
        {savedFlash && (
          <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
            <Check className="w-3 h-3" /> Saved
          </span>
        )}
      </div>

      {data === undefined && (
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-16 bg-muted rounded-xl" />)}
        </div>
      )}
      {data && order.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No units in G{grade} Term {term}.
          </p>
        </div>
      )}

      {order.length > 0 && (
        <ol className="space-y-2">
          {order.map((card, idx) => {
            const moduleId = moduleByUnit.get(card.unitId) ?? card.unitId.split('-')[0];
            const color = MODULE_COLORS[moduleId] ?? '#0D9488';
            const pct = Math.round(card.examPriority * 100);
            const visualPct = Math.min(card.examPriority * 100 * 4, 100);
            const isDragging = draggingId === card.unitId;
            return (
              <li
                key={card.unitId}
                ref={(el) => {
                  if (el) itemRefs.current.set(card.unitId, el);
                  else itemRefs.current.delete(card.unitId);
                }}
                className={cn(
                  'flex items-center gap-2 rounded-xl border bg-card p-2.5 transition-shadow',
                  isDragging
                    ? 'border-primary shadow-lg opacity-90'
                    : 'border-border',
                )}
              >
                {/* Drag handle */}
                <button
                  type="button"
                  aria-label="Drag to reorder"
                  onPointerDown={(e) => onHandlePointerDown(e, card.unitId)}
                  onPointerMove={onHandlePointerMove}
                  onPointerUp={onHandlePointerUp}
                  onPointerCancel={onHandlePointerUp}
                  className="shrink-0 p-1 -ml-1 text-muted-foreground hover:text-foreground touch-none cursor-grab active:cursor-grabbing"
                  style={{ touchAction: 'none' }}
                >
                  <GripVertical className="w-4 h-4" />
                </button>

                {/* Order index + module color */}
                <div className="flex flex-col items-center gap-1 shrink-0 w-5">
                  <span className="text-[10px] font-bold tabular-nums text-muted-foreground">
                    {idx + 1}
                  </span>
                  <div className="w-1 h-6 rounded-full" style={{ backgroundColor: color }} />
                </div>

                {/* Unit name + priority + meta */}
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-foreground truncate">
                    {card.unitName}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${visualPct}%`, backgroundColor: color }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground tabular-nums shrink-0 w-8 text-right">
                      {pct}%
                    </span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {moduleId} · {card.conceptCount} concept{card.conceptCount === 1 ? '' : 's'}
                    {card.marks !== null && <span> · {card.marks} exam marks</span>}
                  </div>
                </div>

                {/* Up / Down */}
                <div className="flex flex-col shrink-0">
                  <button
                    type="button"
                    aria-label="Move up"
                    disabled={idx === 0}
                    onClick={() => onButtonMove(idx, -1)}
                    className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-25"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    disabled={idx === order.length - 1}
                    onClick={() => onButtonMove(idx, 1)}
                    className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-25"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
