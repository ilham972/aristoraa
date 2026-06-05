# Phase 2 — Sheet-Synced Scoring + Points (Single-Agent Execution Brief)

> **This file is a complete, self-contained brief for ONE agent to build all of Phase 2 in a single pass.** Everything specified here is **purely additive** — it must NOT change anything a student or parent currently sees. Read this whole file, then `sheet_scoring_plan.md` (repo root, the detailed System-B reference). Build Part A then Part B. Report to the orchestrator when done; do NOT deploy or run mutations.

---

## 0. Agent execution rules (read first)

- **Branch:** work in your own git worktree off `feat/track-model-phase1` (it has this spec and the deployed Phase-1 code; Phase 2 is additive on top). One commit per numbered task, messages `feat(score-X): …`.
- **Convex:** the only deployment is prod `loris` (rapid-loris-309). Use it for `npx convex codegen` + typecheck ONLY. **Do NOT run any mutation, do NOT `convex deploy`, do NOT `next build`-deploy.** You write code; the founder runs data + deploys.
- **Verify after every task:** `npx tsc --noEmit -p tsconfig.json` AND `npx tsc --noEmit -p convex/tsconfig.json` both exit 0. No test framework exists — do not add one.
- **Hard boundary (the safety of this whole build):** you may CREATE new tables, functions, and UI. You may NOT modify the existing public leaderboard behaviour, the legacy `entries` Score tab, `src/lib/scoring.ts`'s existing exports, or the position dialog. New points are computed and shown only in a NEW admin-only surface. See §7.

---

## 1. Context — why this exists

The learning engine is **blind**: sheets are generated, but per-question results never reach `memoryState`, because the live Score tab writes the legacy `entries` table and never calls `recordAttempt`. So the sheet's **Revision** and **Warm-up (mistakes)** sections stay empty. Part A closes that loop. Part B computes the new difficulty+section points from the same sheet marks, stored alongside the old points for a future parallel-run comparison — without disturbing the live motivator.

---

## 2. Locked decisions (all resolved — do not re-litigate)

1. Score once, on the sheet, per **session**. The Sheets tab is the scoring surface.
2. Points = **difficulty × section weighted**. `BASE_POINTS = 5`. `diffMult(d) = 0.6 + 0.2·d` (d∈1..5). Section multipliers: **Main 1.0, Revision 1.3, Exam-prep 1.5, Warm-up/mistake 1.0** (mistake NOT bonused — prevents deliberate-fail farming). Streak bonus: `+1` per consecutive correct beyond the 2nd in a session, capped at `+5`/session. Unknown difficulty → d=3.
3. Both old (triangular) and new (weighted) points are computed from the SAME sheet marks and stored — **no double entry, no public change yet**.
4. Finalize is **idempotent**: re-marking only re-applies the changed question.
5. Mobile-first, dark-navy + teal. Additive only.

---

## 3. Part A — Engine scoring loop (build first)

Implements `sheet_scoring_plan.md` System B. Follow that file's B1–B4 for full detail; the deltas/decisions are here.

### A1. Schema (additive on `generatedSheets`, `convex/schema.ts`)
```ts
results: v.optional(v.record(v.string(), v.string())),        // questionId(string) -> "correct"|"wrong"|"skipped"
committedMarks: v.optional(v.record(v.string(), v.string())), // last-applied mark per question (idempotency)
scoredAt: v.optional(v.number()),
```

### A2. Backend — `convex/learningEngine/scoring.ts`
- `setSheetMark(sheetId, questionId, mark)` — patches `results[questionId]` (delete on "unmarked"). **No engine write.**
- `finalizeSheetScoring(sheetId)` — for each question whose mark **differs from** `committedMarks`: map `correct→"good" | wrong→"again" | skipped→skip`; for non-skip call `applyAttempt(ctx, {studentId: sheet.studentId, questionId, response, occurredAt: Date.parse(sheet.date+"T12:00:00.000Z"), source:"sheet-score"})` (from `memory.ts`); set `committedMarks[questionId]=mark`. Then set `status:"completed"`, `scoredAt:Date.now()`, plus the Part B points (B2). Idempotent: unchanged marks do nothing.
- `getSheetForScoring(sheetId)` — reuse `pdfHelpers.getSheetForRender` shape: per section (warmup/main/revision/examPrep) → questionId, cropBox, pageImageUrl, conceptNames, marksAvailable, questionNumberInPaper, + current mark from `results`; + student, date, status, short id.

### A3. UI — sheet-scoped scoring drawer
- A **"Score" action per student row in `src/components/session/sheets-tab.tsx`**, opening a full-screen drawer bound to one `generatedSheets._id`.
- Four sections in order (Warm-up · Main · Revision · Exam-prep); each question row: number, crop image (reuse `CropThumbnail` from `src/components/algorithm/sheet-preview.tsx`), concept names, marks/paper tag.
- Tap cycles unmarked → correct → wrong → skipped → unmarked; each change calls `setSheetMark` (live-save).
- Sticky footer: correct/wrong/skipped tallies + "Finalize & record" → `finalizeSheetScoring` → toast + complete. Disabled until ≥1 mark. Re-open + re-finalize allowed (only deltas re-commit).

---

## 4. Part B — Points (additive; computed + stored + admin-only view)

### B1. Config — `convex/learningEngine/config.ts` (append)
```ts
export const BASE_POINTS = 5;
export const SECTION_MULT = { warmup: 1.0, main: 1.0, revision: 1.3, examPrep: 1.5 } as const;
export const STREAK_STEP = 1;
export const STREAK_CAP = 5;
export function diffMult(d: number): number { return 0.6 + 0.2 * (d || 3); }
```

### B2. Schema — new `sessionPoints` table (`convex/schema.ts`)
```ts
sessionPoints: defineTable({
  studentId: v.id("students"),
  sheetId: v.id("generatedSheets"),
  date: v.string(),
  slotId: v.optional(v.id("scheduleSlots")),
  correctCount: v.number(),
  totalQuestions: v.number(),
  pointsOld: v.number(),   // legacy triangular per session: 5*C*(C+1)/2
  pointsNew: v.number(),   // Σ BASE_POINTS·diffMult(d)·SECTION_MULT[section] + streak
  computedAt: v.number(),
})
  .index("by_student_date", ["studentId", "date"])
  .index("by_sheet", ["sheetId"])
  .index("by_date", ["date"]);
```

### B3. Compute in `finalizeSheetScoring` (extends A2)
After committing engine attempts, compute from the sheet's `results` + each question's section + difficulty:
```
C = count(correct)
pointsOld = 5 * C * (C+1) / 2
pointsNew = 0; streak = 0
for q in sheet questions in render order:
  if results[q]=="correct":
     streak += 1
     base = BASE_POINTS * diffMult(q.difficulty) * SECTION_MULT[q.section]
     bonus = streak > 2 ? min(STREAK_STEP*(streak-2), STREAK_CAP) : 0
     pointsNew += base + bonus
  else: streak = 0
upsert sessionPoints by sheetId with {correctCount:C, totalQuestions, pointsOld, pointsNew, computedAt}
```
Section per question: warmup/main/revision/examPrep from which array the questionId is in (reuse the resolution in `getSheetForScoring`). Difficulty from `questionBank.difficulty ?? 3`.

### B4. Read query + admin-only compare view
- `convex/learningEngine/scoring.ts` → `pointsLeaderboard(period, dates, gradeFilter?)`: sum `sessionPoints.pointsOld` and `pointsNew` per student over `dates`, return both columns ranked. **Grade-filtered only — cohort ranking is Phase 3.**
- New admin page `src/app/algorithm/scoring/page.tsx` (or a tab) showing the two columns **side by side (Old vs New)** for a period — this is the parallel-run comparison surface. **Do NOT modify `src/app/leaderboard/page.tsx`.**

---

## 5. Edge cases
- Question tagged to no concept → `applyAttempt` no-ops on mastery; still earns points by difficulty+section. Optional "won't affect mastery" hint.
- Past-paper question, no `linkedExerciseId` → earns points via difficulty + Exam-prep section (no exercise link needed).
- Question removed from sheet after scoring → ignore stale `results` keys absent from all section arrays.
- Re-open completed sheet, flip one mark, finalize → exactly one new `attemptLog` row; `sessionPoints` recomputed wholesale for that sheet.
- Sheet with zero marks → Finalize disabled.

---

## 6. Verification (the proofs)
1. Score a sheet, reload → marks persist (`results`).
2. Finalize → `memoryState` updates; `attemptLog` has `source:"sheet-score"` rows; sheet `completed`; one `sessionPoints` row with sane `pointsOld`/`pointsNew`.
3. **Loop closes:** generate that student's NEXT sheet → wrong-marked concepts appear in Warm-up; aged correct concepts appear in Revision.
4. Idempotency: re-finalize unchanged → no new `attemptLog` rows; flip one mark + finalize → exactly one new row; `sessionPoints` updated not duplicated.
5. **Nothing live changed:** `/leaderboard` still reads `entries` and looks identical; the legacy Score tab still works; position dialog unchanged. Both typechecks pass.

---

## 7. Explicit DO-NOT — founder-gated cutover (NOT in this build)
Leave ALL of these untouched; they are deliberate switches the founder throws after review:
- Do NOT modify or retire the legacy `entries` Score tab in the session workspace.
- Do NOT change `src/app/leaderboard/page.tsx` or `src/lib/scoring.ts` existing exports — the public board keeps reading `entries`.
- Do NOT migrate or alter the position dialog (`position-dialog.tsx`) or stop `entries` writes.
- Do NOT delete the `entries` table.
- Do NOT add cohort/track ranking (that is Phase 3).
The new points live ONLY in `sessionPoints` + the new admin compare view. The public flip happens later.

---

## 8. Key files
- `sheet_scoring_plan.md` — System B detail for Part A.
- `convex/learningEngine/memory.ts` — `applyAttempt` (engine entry; additive — guard at finalize).
- `convex/learningEngine/pdfHelpers.ts` — `getSheetForRender` shape to reuse for sections/difficulty/cropBox.
- `convex/learningEngine/planner.ts` — `generatedSheets` arrays (warmup/main/revision/examPrep) + `markCompleted`.
- `src/components/session/sheets-tab.tsx` — mount the Score action.
- `src/components/algorithm/sheet-preview.tsx` — `CropThumbnail` reuse.
- `convex/schema.ts` — `generatedSheets` (A1) + `sessionPoints` (B2).
- `convex/learningEngine/config.ts` — points constants (B1).

---

## 9. Build order (one pass)
1. A1 schema → codegen → BE tsc. Commit.
2. A2 `scoring.ts` (setSheetMark, finalizeSheetScoring, getSheetForScoring) → BE tsc. Commit.
3. A3 scoring drawer + Sheets-tab Score action → FE tsc. Commit.
4. B1 config + B2 `sessionPoints` schema → codegen → BE tsc. Commit.
5. B3 points compute inside finalize → BE tsc. Commit.
6. B4 `pointsLeaderboard` query + admin compare page → FE tsc. Commit.
7. Final: both typechecks 0; report to orchestrator with the §6 proofs argued (you can't run mutations — argue idempotency + additivity from the code).
