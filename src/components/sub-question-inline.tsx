'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getSubLabel, type SubQuestionsMap, type SubSubDef } from '@/lib/sub-questions';

interface Props {
  questionCount: number;
  subQuestions: SubQuestionsMap | null;
  onSave: (subQ: SubQuestionsMap | null) => void | Promise<void>;
}

const GRID_MAX = 20;

// Identifies which row's count picker is open. Two shapes:
//   { q }          → level-2 picker for Qq
//   { q, subIdx }  → level-3 picker for Qq sub-index subIdx
type PickerTarget = { q: number; subIdx?: number } | null;

export function SubQuestionInline({ questionCount, subQuestions, onSave }: Props) {
  const [picker, setPicker] = useState<PickerTarget>(null);
  // Type-toggle state for rows the user has touched but not committed.
  // Level-2 (per main Q) and level-3 (per "q:subIdx") tracked separately.
  const [pendingTypes, setPendingTypes] = useState<Record<string, 'letter' | 'roman'>>({});
  const [pendingSubSubTypes, setPendingSubSubTypes] = useState<Record<string, 'letter' | 'roman'>>({});
  // Which sub-rows have their sub-sub editor expanded. Keyed "q:subIdx".
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // ── Level-2 readers ───────────────────────────
  const getType = (q: number): 'letter' | 'roman' => {
    const k = String(q);
    return subQuestions?.[k]?.type ?? pendingTypes[k] ?? 'roman';
  };
  const getCount = (q: number): number => subQuestions?.[String(q)]?.count ?? 0;

  // ── Level-3 readers ───────────────────────────
  const subSubKey = (q: number, subIdx: number) => `${q}:${subIdx}`;
  const getSubSubType = (q: number, subIdx: number): 'letter' | 'roman' => {
    const def = subQuestions?.[String(q)]?.subSub?.[String(subIdx)];
    // Default sub-sub type: letter (most common pairing — outer roman / inner letter
    // OR outer letter / inner roman both happen, see project memory). We default
    // to the OPPOSITE of the parent so it visually reads as a new level.
    const fallback: 'letter' | 'roman' =
      pendingSubSubTypes[subSubKey(q, subIdx)] ?? (getType(q) === 'roman' ? 'letter' : 'roman');
    return def?.type ?? fallback;
  };
  const getSubSubCount = (q: number, subIdx: number): number =>
    subQuestions?.[String(q)]?.subSub?.[String(subIdx)]?.count ?? 0;

  // Mutator: returns the full new map (or null if entirely empty).
  const buildMap = (mutate: (m: SubQuestionsMap) => void): SubQuestionsMap | null => {
    // Deep-ish copy so we don't mutate parent state references.
    const m: SubQuestionsMap = {};
    for (const [k, v] of Object.entries(subQuestions || {})) {
      m[k] = { ...v, subSub: v.subSub ? { ...v.subSub } : undefined };
    }
    mutate(m);
    return Object.keys(m).length > 0 ? m : null;
  };

  // ── Level-2 handlers ───────────────────────────
  const handleTypeToggle = async (q: number) => {
    const k = String(q);
    const next: 'letter' | 'roman' = getType(q) === 'roman' ? 'letter' : 'roman';
    if (subQuestions?.[k]) {
      const m = buildMap(map => {
        map[k] = { ...map[k], type: next };
      });
      try { await onSave(m); }
      catch (err) { console.error('[sub-question] type toggle save failed', err); }
    } else {
      setPendingTypes(p => ({ ...p, [k]: next }));
    }
  };

  const handleCountSelect = async (q: number, count: number) => {
    const k = String(q);
    const type = getType(q);
    const m = buildMap(map => {
      if (count <= 1) {
        delete map[k];
      } else {
        // Preserve any existing subSub map but drop entries whose sub-index
        // is no longer in range (e.g. shrinking from 4 → 2 should evict
        // subSub for indices 2 and 3).
        const existingSubSub = map[k]?.subSub;
        let trimmedSubSub: Record<string, SubSubDef> | undefined;
        if (existingSubSub) {
          const next: Record<string, SubSubDef> = {};
          for (const [idxKey, def] of Object.entries(existingSubSub)) {
            if (Number(idxKey) < count) next[idxKey] = def;
          }
          if (Object.keys(next).length > 0) trimmedSubSub = next;
        }
        map[k] = { count, type, ...(trimmedSubSub ? { subSub: trimmedSubSub } : {}) };
      }
    });
    if (count <= 1) {
      setPendingTypes(p => { const n = { ...p }; delete n[k]; return n; });
    }
    setPicker(null);
    try {
      console.log('[sub-question] saving (level 2)', { q, count, type, payload: m });
      await onSave(m);
    } catch (err) {
      console.error('[sub-question] count save failed', err);
    }
  };

  // ── Level-3 handlers ───────────────────────────
  const handleSubSubTypeToggle = async (q: number, subIdx: number) => {
    const next: 'letter' | 'roman' = getSubSubType(q, subIdx) === 'roman' ? 'letter' : 'roman';
    const k = String(q);
    const def = subQuestions?.[k]?.subSub?.[String(subIdx)];
    if (def) {
      const m = buildMap(map => {
        if (!map[k]) return;
        const ss = { ...(map[k].subSub || {}) };
        ss[String(subIdx)] = { ...ss[String(subIdx)], type: next };
        map[k] = { ...map[k], subSub: ss };
      });
      try { await onSave(m); }
      catch (err) { console.error('[sub-sub] type toggle save failed', err); }
    } else {
      setPendingSubSubTypes(p => ({ ...p, [subSubKey(q, subIdx)]: next }));
    }
  };

  const handleSubSubCountSelect = async (q: number, subIdx: number, count: number) => {
    const k = String(q);
    const type = getSubSubType(q, subIdx);
    const m = buildMap(map => {
      if (!map[k]) return; // Defensive — level-2 must exist first.
      const ss = { ...(map[k].subSub || {}) };
      if (count <= 1) {
        delete ss[String(subIdx)];
      } else {
        ss[String(subIdx)] = { count, type };
      }
      if (Object.keys(ss).length === 0) {
        const { subSub: _ignored, ...rest } = map[k];
        void _ignored;
        map[k] = rest;
      } else {
        map[k] = { ...map[k], subSub: ss };
      }
    });
    if (count <= 1) {
      setPendingSubSubTypes(p => {
        const n = { ...p }; delete n[subSubKey(q, subIdx)]; return n;
      });
    }
    setPicker(null);
    try {
      console.log('[sub-sub] saving (level 3)', { q, subIdx, count, type, payload: m });
      await onSave(m);
    } catch (err) {
      console.error('[sub-sub] count save failed', err);
    }
  };

  const toggleExpand = (q: number, subIdx: number) => {
    const k = subSubKey(q, subIdx);
    setExpanded(prev => ({ ...prev, [k]: !prev[k] }));
  };

  return (
    <div className="bg-muted/30 rounded-lg p-2 mt-2 border border-border/40">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 px-1">
        Sub-questions
      </p>
      <div className="space-y-0.5 max-h-[55vh] overflow-y-auto no-scrollbar">
        {Array.from({ length: questionCount }, (_, i) => {
          const q = i + 1;
          const count = getCount(q);
          const type = getType(q);
          const hasSub = count > 1;
          return (
            <div key={q} className="space-y-0.5">
              {/* Level-2 row */}
              <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-card border border-border/30">
                <span className="text-[11px] font-mono font-semibold text-foreground min-w-[28px]">
                  Q{q}
                </span>
                <button
                  onClick={() => handleTypeToggle(q)}
                  className={`w-6 h-6 rounded text-[10px] font-bold italic transition-all active:scale-90
                    ${hasSub ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}
                  title={type === 'roman' ? 'Roman (tap for a,b,c)' : 'Letter (tap for i,ii,iii)'}
                >
                  {type === 'roman' ? 'i' : 'a'}
                </button>
                <div className="flex-1" />
                <button
                  onClick={() => setPicker({ q })}
                  className={`min-w-[36px] h-6 px-2 rounded text-[10px] font-bold transition-all active:scale-90
                    ${hasSub ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
                >
                  {hasSub ? count : '—'}
                </button>
              </div>

              {/* Level-3 nested rows — one per existing sub-part */}
              {hasSub && (
                <div className="pl-5 space-y-0.5">
                  {Array.from({ length: count }, (_, s) => {
                    const subLab = getSubLabel(s, type);
                    const ssCount = getSubSubCount(q, s);
                    const ssType = getSubSubType(q, s);
                    const hasSubSub = ssCount > 1;
                    const isExpanded = !!expanded[subSubKey(q, s)] || hasSubSub;
                    return (
                      <div key={s} className="flex items-center gap-2 px-2 py-1 rounded-md bg-muted/40 border border-border/20">
                        <button
                          onClick={() => toggleExpand(q, s)}
                          className={`w-5 h-5 rounded flex items-center justify-center hover:bg-muted transition-transform ${
                            isExpanded ? 'rotate-0' : '-rotate-90'
                          }`}
                          title={isExpanded ? 'Hide sub-parts' : 'Add sub-parts'}
                        >
                          <ChevronDown className="w-3 h-3 text-muted-foreground" />
                        </button>
                        <span className="text-[10px] font-mono font-semibold text-foreground min-w-[36px]">
                          {q}.{subLab}
                        </span>
                        {isExpanded ? (
                          <>
                            <button
                              onClick={() => handleSubSubTypeToggle(q, s)}
                              className={`w-5 h-5 rounded text-[9px] font-bold italic transition-all active:scale-90
                                ${hasSubSub ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}
                              title={ssType === 'roman' ? 'Roman (tap for a,b,c)' : 'Letter (tap for i,ii,iii)'}
                            >
                              {ssType === 'roman' ? 'i' : 'a'}
                            </button>
                            <div className="flex-1" />
                            <button
                              onClick={() => setPicker({ q, subIdx: s })}
                              className={`min-w-[32px] h-5 px-1.5 rounded text-[9px] font-bold transition-all active:scale-90
                                ${hasSubSub ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
                            >
                              {hasSubSub ? ssCount : '—'}
                            </button>
                          </>
                        ) : (
                          <span className="text-[9px] text-muted-foreground/60 ml-auto">
                            tap to add sub-parts
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Count picker dialog — used for BOTH level-2 and level-3 */}
      <Dialog open={picker !== null} onOpenChange={(o) => !o && setPicker(null)}>
        <DialogContent className="max-w-xs mx-auto">
          {picker !== null && (() => {
            const isLvl3 = picker.subIdx !== undefined;
            const type = isLvl3
              ? getSubSubType(picker.q, picker.subIdx!)
              : getType(picker.q);
            const count = isLvl3
              ? getSubSubCount(picker.q, picker.subIdx!)
              : getCount(picker.q);
            const titleKey = isLvl3
              ? `Q${picker.q}.${getSubLabel(picker.subIdx!, getType(picker.q))}`
              : `Q${picker.q}`;
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="text-sm">
                    {titleKey} sub-questions ({type === 'roman' ? 'i, ii, iii…' : 'a, b, c…'})
                  </DialogTitle>
                </DialogHeader>
                <div className="grid grid-cols-5 gap-1 mt-2">
                  {Array.from({ length: GRID_MAX }, (_, i) => {
                    const label = getSubLabel(i, type);
                    const isInRange = count > 1 && i < count;
                    const isLast = count > 1 && i === count - 1;
                    return (
                      <button
                        key={i}
                        onClick={() => {
                          if (isLvl3) {
                            handleSubSubCountSelect(picker.q, picker.subIdx!, i + 1);
                          } else {
                            handleCountSelect(picker.q, i + 1);
                          }
                        }}
                        className={`h-9 rounded-lg text-[11px] font-bold transition-all active:scale-95
                          ${isLast
                            ? 'bg-primary text-primary-foreground ring-2 ring-primary ring-offset-1 ring-offset-background'
                            : isInRange
                              ? 'bg-primary/20 text-primary'
                              : 'bg-muted text-muted-foreground'}`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground text-center mt-2">
                  Tap the last sub-question. Tap the first cell to clear.
                </p>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
