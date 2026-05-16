'use client';

// Phase 0.6b — bulk-rate workflow for already-cropped questions.
//
// Two modes via top toggle:
//   - Textbook: pick grade → pick book (a textbook part) → unit pills →
//     scrollable list of crops in that unit. Each row shows the cropped
//     preview, the question label (Ex.X Q.Y), read-only auto-derived
//     concept chips (from 0.6a), and a 1..5 difficulty picker.
//   - Past Papers: pick grade → pick paper → paper-structure-part pills →
//     scrollable list of crops in (paper, part). Each row shows the
//     cropped preview, slot label, a concepts multi-select (limited to
//     concepts in the crop's tag's linked units), and a difficulty picker.
//
// Selections persist in sessionStorage so back-nav lands on the same view.

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { Check, X } from 'lucide-react';
import { api } from '@/lib/convex';
import type { Id } from '@/lib/convex';
import { MODULE_COLORS } from '@/lib/types';
import { getUnitsForBook, findUnit } from '@/lib/curriculum-data';
import { DifficultyPicker } from './difficulty-picker';
import { toast } from 'sonner';

const GRADES = [6, 7, 8, 9, 10, 11];

// sessionStorage keys
const SS_MODE = 'difficultyTab.mode';
const SS_GRADE = 'difficultyTab.grade';
const SS_BOOK = 'difficultyTab.bookId';
const SS_UNIT = 'difficultyTab.unitId';
const SS_PAPER = 'difficultyTab.paperId';
const SS_PART = 'difficultyTab.partId';

type Mode = 'textbook' | 'past-paper';

export function DifficultyTab() {
  // Lazy-init from sessionStorage so back-nav returns the same view.
  const [mode, setMode] = useState<Mode>(() => {
    if (typeof window === 'undefined') return 'textbook';
    const v = window.sessionStorage.getItem(SS_MODE);
    return v === 'past-paper' ? 'past-paper' : 'textbook';
  });
  const [grade, setGrade] = useState<number>(() => {
    if (typeof window === 'undefined') return 7;
    const v = window.sessionStorage.getItem(SS_GRADE);
    const n = v ? parseInt(v, 10) : 7;
    return GRADES.includes(n) ? n : 7;
  });

  useEffect(() => {
    if (typeof window !== 'undefined') window.sessionStorage.setItem(SS_MODE, mode);
  }, [mode]);
  useEffect(() => {
    if (typeof window !== 'undefined')
      window.sessionStorage.setItem(SS_GRADE, String(grade));
  }, [grade]);

  return (
    <div className="space-y-3">
      {/* Mode toggle */}
      <div className="flex bg-muted rounded-xl p-0.5">
        <button
          onClick={() => setMode('textbook')}
          className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-all ${
            mode === 'textbook'
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Textbook
        </button>
        <button
          onClick={() => setMode('past-paper')}
          className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-all ${
            mode === 'past-paper'
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Past Papers
        </button>
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

      {mode === 'textbook' ? (
        <TextbookView grade={grade} />
      ) : (
        <PastPaperView grade={grade} />
      )}
    </div>
  );
}

// ─── Textbook view ───────────────────────────────────────────────────────

function TextbookView({ grade }: { grade: number }) {
  const textbooks = useQuery(api.textbooks.list);
  const gradeBooks = useMemo(
    () => (textbooks ?? []).filter((t) => t.grade === grade).sort((a, b) => a.part - b.part),
    [textbooks, grade],
  );

  const [bookId, setBookId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage.getItem(SS_BOOK);
  });
  const [unitId, setUnitId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage.getItem(SS_UNIT);
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (bookId) window.sessionStorage.setItem(SS_BOOK, bookId);
    else window.sessionStorage.removeItem(SS_BOOK);
  }, [bookId]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (unitId) window.sessionStorage.setItem(SS_UNIT, unitId);
    else window.sessionStorage.removeItem(SS_UNIT);
  }, [unitId]);

  // Reset selections when the books list narrows away from the current pick.
  useEffect(() => {
    if (!bookId) return;
    if (gradeBooks.length === 0) return;
    if (!gradeBooks.some((b) => b._id === bookId)) {
      setBookId(null);
      setUnitId(null);
    }
  }, [bookId, gradeBooks]);

  const selectedBook = gradeBooks.find((b) => b._id === bookId) ?? null;

  const bookUnits = useMemo(() => {
    if (!selectedBook?.startUnit || !selectedBook?.endUnit) return [];
    return getUnitsForBook(selectedBook.grade, selectedBook.startUnit, selectedBook.endUnit);
  }, [selectedBook]);

  // Reset unit selection if it no longer belongs to the current book.
  useEffect(() => {
    if (!unitId) return;
    if (bookUnits.length === 0) return;
    if (!bookUnits.some((u) => u.id === unitId)) {
      setUnitId(null);
    }
  }, [unitId, bookUnits]);

  if (textbooks === undefined) return <SkeletonStrip />;
  if (gradeBooks.length === 0) {
    return (
      <EmptyHint message={`No textbooks uploaded for G${grade}. Add books in Data Entry first.`} />
    );
  }

  return (
    <div className="space-y-3">
      {/* Book selector */}
      <div className="flex gap-1 p-1 bg-muted rounded-xl overflow-x-auto no-scrollbar">
        {gradeBooks.map((b) => (
          <button
            key={b._id}
            onClick={() => {
              setBookId(b._id);
              setUnitId(null);
            }}
            className={`shrink-0 py-1.5 px-3 rounded-lg text-[12px] font-mono font-semibold transition-all whitespace-nowrap ${
              bookId === b._id
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Book {b.part}
          </button>
        ))}
      </div>

      {!selectedBook ? (
        <EmptyHint message="Pick a book." />
      ) : bookUnits.length === 0 ? (
        <EmptyHint message="This book has no units configured." />
      ) : (
        <>
          {/* Unit pills */}
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
            {bookUnits.map((u) => {
              const ctx = findUnit(u.id);
              const color = ctx ? MODULE_COLORS[ctx.module.id] : '#888';
              const active = unitId === u.id;
              return (
                <button
                  key={u.id}
                  onClick={() => setUnitId(u.id)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all whitespace-nowrap ${
                    active ? 'text-white border-transparent' : 'border-border'
                  }`}
                  style={
                    active
                      ? { backgroundColor: color }
                      : { color }
                  }
                >
                  {u.number}. {u.name}
                </button>
              );
            })}
          </div>

          {!unitId ? (
            <EmptyHint message="Pick a unit to see its cropped questions." />
          ) : (
            <TextbookUnitCrops unitId={unitId} />
          )}
        </>
      )}
    </div>
  );
}

function TextbookUnitCrops({ unitId }: { unitId: string }) {
  const rows = useQuery(api.learningEngine.difficultyTab.listTextbookCropsForUnit, {
    unitId,
  });
  const setDifficulty = useMutation(api.questionBank.setDifficulty);

  if (rows === undefined) return <SkeletonRows />;
  if (rows.length === 0) {
    return (
      <EmptyHint message="No crops in this unit yet. Crop questions in Data Entry → Details first." />
    );
  }

  // Summary header (rated vs total).
  const total = rows.length;
  const rated = rows.filter((r) => r.crop.difficulty !== undefined).length;
  const remaining = total - rated;

  return (
    <div className="space-y-2">
      <SummaryBar total={total} rated={rated} remaining={remaining} />
      <div className="space-y-2">
        {rows.map((r) => (
          <CropRow
            key={r.crop._id as string}
            cropId={r.crop._id as Id<'questionBank'>}
            label={`${r.exerciseName} · Q${r.crop.linkedQuestionKey ?? '?'}`}
            pageImageUrl={r.pageImageUrl}
            cropBox={r.crop.cropBox ?? null}
            difficulty={r.crop.difficulty}
            onChangeDifficulty={async (n) => {
              try {
                await setDifficulty({
                  id: r.crop._id as Id<'questionBank'>,
                  difficulty: n,
                });
              } catch (e) {
                console.error(e);
                toast.error('Could not save');
              }
            }}
            chipsRow={
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[10px] text-muted-foreground shrink-0">
                  Concepts:
                </span>
                {r.inheritedConcepts.length === 0 ? (
                  <span className="text-[10px] italic text-amber-500">
                    none — fix unit ordering
                  </span>
                ) : (
                  r.inheritedConcepts.map((c) => (
                    <span
                      key={c._id as string}
                      className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-medium"
                    >
                      {c.name}
                    </span>
                  ))
                )}
              </div>
            }
          />
        ))}
      </div>
    </div>
  );
}

// ─── Past-paper view ─────────────────────────────────────────────────────

function PastPaperView({ grade }: { grade: number }) {
  const papers = useQuery(api.pastPapers.listByGrade, { grade });
  const [paperId, setPaperId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage.getItem(SS_PAPER);
  });
  const [partId, setPartId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage.getItem(SS_PART);
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (paperId) window.sessionStorage.setItem(SS_PAPER, paperId);
    else window.sessionStorage.removeItem(SS_PAPER);
  }, [paperId]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (partId) window.sessionStorage.setItem(SS_PART, partId);
    else window.sessionStorage.removeItem(SS_PART);
  }, [partId]);

  // Reset paper if it's not in the new grade's list.
  useEffect(() => {
    if (!paperId || !papers) return;
    if (!papers.some((p) => p._id === paperId)) {
      setPaperId(null);
      setPartId(null);
    }
  }, [paperId, papers]);

  const resolved = useQuery(
    api.paperStructures.getResolvedForPaper,
    paperId ? { paperId: paperId as Id<'pastPapers'> } : 'skip',
  );
  const parts = resolved?.parts ?? [];

  // Reset part if the paper structure changes and that part is gone.
  useEffect(() => {
    if (!partId) return;
    if (parts.length === 0) return;
    if (!parts.some((p) => p._id === partId)) {
      setPartId(null);
    }
  }, [partId, parts]);

  if (papers === undefined) return <SkeletonStrip />;
  if (papers.length === 0) {
    return (
      <EmptyHint message={`No past papers uploaded for G${grade}. Upload in Content → Past Papers first.`} />
    );
  }

  return (
    <div className="space-y-3">
      {/* Paper selector — vertical list, not pills, since labels are long */}
      <div className="space-y-1.5 max-h-44 overflow-y-auto rounded-xl border border-border/60 bg-muted/30 p-1.5">
        {papers
          .slice()
          .sort((a, b) => b.year - a.year || b.term - a.term)
          .map((p) => {
            const active = paperId === p._id;
            return (
              <button
                key={p._id}
                onClick={() => {
                  setPaperId(p._id);
                  setPartId(null);
                }}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] transition-all ${
                  active
                    ? 'bg-primary/10 ring-1 ring-primary/40 text-foreground'
                    : 'hover:bg-muted/60 text-muted-foreground'
                }`}
              >
                <span className="font-medium">
                  T{p.term} {p.year}
                  {p.schoolName ? ` · ${p.schoolName}` : ''}
                </span>
              </button>
            );
          })}
      </div>

      {!paperId ? (
        <EmptyHint message="Pick a paper." />
      ) : resolved === undefined ? (
        <SkeletonStrip />
      ) : parts.length === 0 ? (
        <EmptyHint message="This paper has no structure parts configured (Settings → Exam tab)." />
      ) : (
        <>
          {/* Part pills */}
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
            {parts.map((pt) => {
              const active = partId === pt._id;
              return (
                <button
                  key={pt._id}
                  onClick={() => setPartId(pt._id)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all whitespace-nowrap ${
                    active
                      ? 'bg-primary text-primary-foreground border-transparent'
                      : 'border-border text-muted-foreground'
                  }`}
                >
                  {pt.partCode}
                  <span className="ml-1 opacity-70">({pt.questionCount})</span>
                </button>
              );
            })}
          </div>

          {!partId ? (
            <EmptyHint message="Pick a part." />
          ) : (
            <PastPaperPartCrops
              pastPaperId={paperId as Id<'pastPapers'>}
              paperStructurePartId={partId as Id<'paperStructureParts'>}
            />
          )}
        </>
      )}
    </div>
  );
}

function PastPaperPartCrops({
  pastPaperId,
  paperStructurePartId,
}: {
  pastPaperId: Id<'pastPapers'>;
  paperStructurePartId: Id<'paperStructureParts'>;
}) {
  const rows = useQuery(api.learningEngine.difficultyTab.listPastPaperCropsForPart, {
    pastPaperId,
    paperStructurePartId,
  });
  const setDifficulty = useMutation(api.questionBank.setDifficulty);
  const setConcepts = useMutation(api.questionBank.setConcepts);

  if (rows === undefined) return <SkeletonRows />;
  if (rows.length === 0) {
    return (
      <EmptyHint message="No crops in this part yet. Crop questions in Data Entry → Past Papers first." />
    );
  }

  const total = rows.length;
  const rated = rows.filter(
    (r) => r.crop.difficulty !== undefined && r.pickedConceptIds.length > 0,
  ).length;
  const remaining = total - rated;

  return (
    <div className="space-y-2">
      <SummaryBar total={total} rated={rated} remaining={remaining} />
      <div className="space-y-2">
        {rows.map((r) => (
          <PastPaperCropRow
            key={r.crop._id as string}
            cropId={r.crop._id as Id<'questionBank'>}
            label={r.crop.questionNumberInPaper ?? `Slot ${r.crop.paperStructureSlotNumber}`}
            pageImageUrl={r.pageImageUrl}
            cropBox={r.crop.cropBox ?? null}
            difficulty={r.crop.difficulty}
            topicTagId={(r.crop.topicTagId as Id<'examTopicTags'> | undefined) ?? null}
            pickedConceptIds={r.pickedConceptIds}
            onChangeDifficulty={async (n) => {
              try {
                await setDifficulty({
                  id: r.crop._id as Id<'questionBank'>,
                  difficulty: n,
                });
              } catch (e) {
                console.error(e);
                toast.error('Could not save');
              }
            }}
            onSaveConcepts={async (ids) => {
              try {
                await setConcepts({
                  id: r.crop._id as Id<'questionBank'>,
                  conceptExerciseIds: ids,
                });
                toast.success('Concepts saved');
              } catch (e) {
                console.error(e);
                toast.error('Could not save concepts');
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Shared row primitives ───────────────────────────────────────────────

interface CropRowProps {
  cropId: Id<'questionBank'>;
  label: string;
  pageImageUrl: string | null;
  cropBox: { x: number; y: number; w: number; h: number } | null;
  difficulty: number | undefined;
  onChangeDifficulty: (n: number) => Promise<void> | void;
  chipsRow?: React.ReactNode;
}

function CropRow({
  label,
  pageImageUrl,
  cropBox,
  difficulty,
  onChangeDifficulty,
  chipsRow,
}: CropRowProps) {
  const incomplete = difficulty === undefined;
  return (
    <div
      className={`rounded-xl border p-2.5 bg-card flex gap-2.5 ${
        incomplete ? 'border-red-500/60 bg-red-500/5' : 'border-border/60'
      }`}
    >
      <CroppedPreview imageUrl={pageImageUrl} cropBox={cropBox} />
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-medium text-foreground truncate">{label}</span>
          <DifficultyPicker
            value={difficulty}
            onChange={(n) => onChangeDifficulty(n)}
            size="sm"
          />
        </div>
        {chipsRow}
      </div>
    </div>
  );
}

interface PastPaperCropRowProps extends Omit<CropRowProps, 'chipsRow' | 'onChangeDifficulty'> {
  topicTagId: Id<'examTopicTags'> | null;
  pickedConceptIds: Id<'exercises'>[];
  onChangeDifficulty: (n: number) => Promise<void> | void;
  onSaveConcepts: (ids: Id<'exercises'>[]) => Promise<void>;
}

function PastPaperCropRow({
  label,
  pageImageUrl,
  cropBox,
  difficulty,
  topicTagId,
  pickedConceptIds,
  onChangeDifficulty,
  onSaveConcepts,
}: PastPaperCropRowProps) {
  const [conceptPickerOpen, setConceptPickerOpen] = useState(false);
  const incomplete = difficulty === undefined || pickedConceptIds.length === 0;

  return (
    <div
      className={`rounded-xl border p-2.5 bg-card flex gap-2.5 ${
        incomplete ? 'border-red-500/60 bg-red-500/5' : 'border-border/60'
      }`}
    >
      <CroppedPreview imageUrl={pageImageUrl} cropBox={cropBox} />
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-medium text-foreground truncate">{label}</span>
          <DifficultyPicker
            value={difficulty}
            onChange={(n) => onChangeDifficulty(n)}
            size="sm"
          />
        </div>
        <ConceptsRow
          topicTagId={topicTagId}
          pickedConceptIds={pickedConceptIds}
          onOpenPicker={() => setConceptPickerOpen(true)}
        />
      </div>

      {conceptPickerOpen && (
        <ConceptPickerSheet
          topicTagId={topicTagId}
          pickedConceptIds={pickedConceptIds}
          onClose={() => setConceptPickerOpen(false)}
          onSave={async (ids) => {
            await onSaveConcepts(ids);
            setConceptPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}

function ConceptsRow({
  topicTagId,
  pickedConceptIds,
  onOpenPicker,
}: {
  topicTagId: Id<'examTopicTags'> | null;
  pickedConceptIds: Id<'exercises'>[];
  onOpenPicker: () => void;
}) {
  const allConcepts = useQuery(api.exercises.list);
  const namesById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of allConcepts ?? []) m.set(e._id, e.name);
    return m;
  }, [allConcepts]);

  if (!topicTagId) {
    return (
      <p className="text-[10px] italic text-amber-500">
        No topic tag — set tag in past-paper crop page first.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] text-muted-foreground shrink-0">Concepts:</span>
      {pickedConceptIds.length === 0 ? (
        <span className="text-[10px] italic text-red-500">none picked</span>
      ) : (
        pickedConceptIds.map((id) => (
          <span
            key={id as string}
            className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-medium"
          >
            {namesById.get(id as string) ?? '?'}
          </span>
        ))
      )}
      <button
        type="button"
        onClick={onOpenPicker}
        className="ml-auto text-[10px] text-primary hover:underline"
      >
        {pickedConceptIds.length > 0 ? 'Edit' : '+ Pick'}
      </button>
    </div>
  );
}

// Bottom-sheet style concept picker — mirrors past-paper-tag-picker's
// concept multi-select, scoped to the active topic tag's linked units.
function ConceptPickerSheet({
  topicTagId,
  pickedConceptIds,
  onClose,
  onSave,
}: {
  topicTagId: Id<'examTopicTags'> | null;
  pickedConceptIds: Id<'exercises'>[];
  onClose: () => void;
  onSave: (ids: Id<'exercises'>[]) => Promise<void>;
}) {
  const linkedConcepts = useQuery(
    api.topicTags.getLinkedConcepts,
    topicTagId ? { tagId: topicTagId } : 'skip',
  );
  const [draft, setDraft] = useState<Set<string>>(
    () => new Set(pickedConceptIds as unknown as string[]),
  );
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    setBusy(true);
    try {
      await onSave(Array.from(draft) as Id<'exercises'>[]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9990] bg-black/50 backdrop-blur-sm flex items-end justify-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-background rounded-t-2xl shadow-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
          <h3 className="text-sm font-semibold">Pick concepts</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center bg-muted text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {!topicTagId ? (
            <p className="text-xs text-muted-foreground italic">No topic tag set.</p>
          ) : linkedConcepts === undefined ? (
            <p className="text-xs text-muted-foreground italic">Loading…</p>
          ) : linkedConcepts.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              Tag has no linked units.
            </p>
          ) : (
            linkedConcepts.map((group) => (
              <div
                key={group.unitId}
                className="rounded-xl border border-border/60 bg-card overflow-hidden"
              >
                <div
                  className="px-2.5 py-1.5 flex items-center gap-1.5 border-b border-border/40"
                  style={{ backgroundColor: `${MODULE_COLORS[group.moduleId] ?? '#888'}11` }}
                >
                  <span
                    className="font-mono text-[9px] font-bold rounded px-1 py-0.5"
                    style={{
                      backgroundColor: `${MODULE_COLORS[group.moduleId] ?? '#888'}22`,
                      color: MODULE_COLORS[group.moduleId] ?? '#888',
                    }}
                  >
                    {group.moduleId}
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    G{group.grade} · T{group.term}
                  </span>
                </div>
                <div className="p-1">
                  {group.concepts.length === 0 ? (
                    <p className="text-[10px] text-muted-foreground italic px-2 py-1">
                      No concepts in this unit yet.
                    </p>
                  ) : (
                    group.concepts.map((c) => {
                      const checked = draft.has(c._id as string);
                      return (
                        <button
                          key={c._id}
                          type="button"
                          onClick={() => toggle(c._id as string)}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/60 text-left"
                        >
                          <span
                            className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center shrink-0 ${
                              checked
                                ? 'bg-primary border-primary text-primary-foreground'
                                : 'border-border bg-background'
                            }`}
                          >
                            {checked && <Check className="w-2.5 h-2.5" />}
                          </span>
                          <span className="text-xs flex-1 truncate">{c.name}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            ))
          )}
        </div>
        <div className="flex gap-3 px-4 py-3 border-t border-border/60">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 h-10 rounded-xl border border-border text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={busy}
            className="flex-1 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Cropped image preview ───────────────────────────────────────────────

// Renders a small thumbnail showing only the cropBox region of the source
// page image. Implementation: use the source URL as a CSS background, sized
// so the cropBox fills the thumbnail box, positioned so the cropBox aligns
// to the box's top-left.
//
// The thumbnail is intentionally aspect-preserving — it sizes its WIDTH from
// the cropBox's actual aspect ratio (using the natural image dims read on
// load) so wide crops look wide and tall crops look tall. Square-on-square
// thumbnails were misleading: a tall narrow crop got squashed into 84×84
// and looked broken; a wide short crop got stretched the same way.
//
// Tapping the thumbnail opens a full-fidelity dialog that displays exactly
// the pixels the database stores. This is the load-bearing diagnostic for
// "is the cropBox stored correctly or not?" — what the dialog shows is
// what's saved, full stop.
function CroppedPreview({
  imageUrl,
  cropBox,
}: {
  imageUrl: string | null;
  cropBox: { x: number; y: number; w: number; h: number } | null;
}) {
  const MAX_SIDE = 96; // px — biggest of width / height in the row thumbnail
  const MIN_SIDE = 40; // px — keep skinny crops still tappable
  // Track the URL that each loaded set of natural dims belongs to. When
  // imageUrl changes, the stored dims are simply ignored (treated as if
  // unloaded) — we avoid a synchronous setState reset to keep
  // react-hooks/set-state-in-effect happy.
  const [loaded, setLoaded] = useState<
    { url: string; w: number; h: number } | null
  >(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Preload the image once per URL to learn its natural pixel dims. This is
  // the only way to compute the crop's TRUE aspect ratio (cropBox is
  // normalized to the image; we need imgW/imgH to convert to pixels). The
  // setState happens inside the load callback — an external-system event —
  // not synchronously in the effect body.
  useEffect(() => {
    if (!imageUrl) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      setLoaded({ url: imageUrl, w: img.naturalWidth, h: img.naturalHeight });
    };
    img.src = imageUrl;
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  const naturalDims =
    loaded && loaded.url === imageUrl
      ? { w: loaded.w, h: loaded.h }
      : null;

  if (!imageUrl || !cropBox) {
    return (
      <div
        className="rounded-md bg-muted border border-border/40 shrink-0"
        style={{ width: MAX_SIDE, height: MAX_SIDE }}
      />
    );
  }

  const safeW = Math.max(cropBox.w, 0.001);
  const safeH = Math.max(cropBox.h, 0.001);
  // Crop's pixel aspect (W/H). Without natural dims we have to guess —
  // assume the image itself is portrait A4-ish (≈ 0.71) since textbook
  // pages and past-paper scans are always portrait in this project.
  const fallbackImgAspect = 0.71;
  const imgAspect = naturalDims ? naturalDims.w / naturalDims.h : fallbackImgAspect;
  const cropAspect = (imgAspect * safeW) / safeH;
  // Fit the cropAspect into a MAX_SIDE × MAX_SIDE bounding box, keeping at
  // least MIN_SIDE on the smaller dimension so skinny crops stay legible.
  let boxW: number;
  let boxH: number;
  if (cropAspect >= 1) {
    boxW = MAX_SIDE;
    boxH = Math.max(MIN_SIDE, MAX_SIDE / cropAspect);
  } else {
    boxH = MAX_SIDE;
    boxW = Math.max(MIN_SIDE, MAX_SIDE * cropAspect);
  }
  const imgW = boxW / safeW;
  const imgH = boxH / safeH;
  const bgX = -cropBox.x * imgW;
  const bgY = -cropBox.y * imgH;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setPreviewOpen(true);
        }}
        // Center the thumbnail within a fixed-width column so rows stay
        // aligned regardless of each crop's aspect ratio.
        className="shrink-0 flex items-center justify-center cursor-zoom-in"
        style={{ width: MAX_SIDE, height: MAX_SIDE }}
        aria-label="Show full saved crop"
      >
        <div
          className="rounded-md bg-muted border border-border/40 overflow-hidden hover:ring-2 hover:ring-primary/40 transition-shadow"
          style={{
            width: boxW,
            height: boxH,
            backgroundImage: `url(${imageUrl})`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: `${imgW}px ${imgH}px`,
            backgroundPosition: `${bgX}px ${bgY}px`,
          }}
        />
      </button>
      {previewOpen && (
        <FullCropPreviewDialog
          imageUrl={imageUrl}
          cropBox={cropBox}
          naturalDims={naturalDims}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </>
  );
}

// Full-fidelity dialog. Renders the cropBox region as large as fits in the
// viewport, with the cropBox's true aspect ratio, plus a metadata strip so
// the Lead can see EXACTLY what's stored in questionBank.cropBox. This is
// the diagnostic surface: if the rendered region here doesn't look like
// what was drawn during cropping, the cropping UI is the bug; if it
// matches, the cropping UI was honest and the crop was simply drawn that
// way.
function FullCropPreviewDialog({
  imageUrl,
  cropBox,
  naturalDims,
  onClose,
}: {
  imageUrl: string;
  cropBox: { x: number; y: number; w: number; h: number };
  naturalDims: { w: number; h: number } | null;
  onClose: () => void;
}) {
  const safeW = Math.max(cropBox.w, 0.001);
  const safeH = Math.max(cropBox.h, 0.001);
  const cropPxW = naturalDims ? Math.round(naturalDims.w * safeW) : null;
  const cropPxH = naturalDims ? Math.round(naturalDims.h * safeH) : null;
  const cropAspect = naturalDims
    ? (naturalDims.w * safeW) / (naturalDims.h * safeH)
    : safeW / safeH;
  // Cap display to viewport. Use 70vw × 60vh as the bounding box.
  const MAX_VW = 70;
  const MAX_VH = 60;
  let dispW: string;
  let dispH: string;
  if (cropAspect >= MAX_VW / MAX_VH) {
    dispW = `${MAX_VW}vw`;
    dispH = `${MAX_VW / cropAspect}vw`;
  } else {
    dispH = `${MAX_VH}vh`;
    dispW = `${MAX_VH * cropAspect}vh`;
  }
  // Background sizing so the cropBox region fills the display box exactly.
  const imgWcss = `calc(${dispW} / ${safeW})`;
  const imgHcss = `calc(${dispH} / ${safeH})`;
  const bgXcss = `calc(-${cropBox.x} * ${imgWcss})`;
  const bgYcss = `calc(-${cropBox.y} * ${imgHcss})`;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="rounded-2xl bg-card border border-border p-3 shadow-xl max-w-[90vw] max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-bold text-foreground">Saved crop preview</div>
          <button
            onClick={onClose}
            className="text-[11px] px-2 py-1 rounded-md hover:bg-muted text-muted-foreground"
          >
            Close
          </button>
        </div>
        <div
          className="rounded-md bg-muted border border-border overflow-hidden mx-auto"
          style={{
            width: dispW,
            height: dispH,
            backgroundImage: `url(${imageUrl})`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: `${imgWcss} ${imgHcss}`,
            backgroundPosition: `${bgXcss} ${bgYcss}`,
          }}
        />
        <div className="mt-2 text-[10px] text-muted-foreground font-mono space-y-0.5">
          <div>
            cropBox: x={cropBox.x.toFixed(4)} y={cropBox.y.toFixed(4)} w=
            {cropBox.w.toFixed(4)} h={cropBox.h.toFixed(4)}
          </div>
          {naturalDims && cropPxW !== null && cropPxH !== null && (
            <div>
              source image: {naturalDims.w} × {naturalDims.h} px · crop region:{' '}
              {cropPxW} × {cropPxH} px
            </div>
          )}
          {!naturalDims && <div>source image: loading…</div>}
        </div>
        <div className="mt-2 text-[10px] text-muted-foreground leading-snug">
          What you see above is exactly the pixels stored in the database. If
          it doesn&apos;t match what you intended to crop, re-open the cropping
          page and adjust this question&apos;s box.
        </div>
      </div>
    </div>
  );
}

// ─── Small UI bits ───────────────────────────────────────────────────────

function SummaryBar({
  total,
  rated,
  remaining,
}: {
  total: number;
  rated: number;
  remaining: number;
}) {
  const pct = total === 0 ? 0 : Math.round((rated / total) * 100);
  return (
    <div className="rounded-lg bg-muted/40 border border-border/50 px-3 py-2 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium text-foreground">
          {rated} / {total} complete
          {remaining > 0 && (
            <span className="ml-1.5 text-red-500 font-normal">
              · {remaining} to go
            </span>
          )}
        </div>
        <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <span className="text-[10px] font-mono text-muted-foreground">{pct}%</span>
    </div>
  );
}

function EmptyHint({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 px-4 py-8 text-center">
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

function SkeletonStrip() {
  return <div className="h-9 bg-muted rounded-xl animate-pulse" />;
}

function SkeletonRows() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />
      ))}
    </div>
  );
}
