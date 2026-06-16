# Build Spec — Sheet-Synced Scoring (feeds the learning engine)

> **Audience:** a fresh engineering session (Sonnet) with full repo access but **no memory of the conversation that produced this.** Read this whole file first.
>
> **Two systems will be worked on in your session, in this order:**
> 1. **System A — the points reconciliation (BRAINSTORM FIRST, do not build blind).** See Phase 0.
> 2. **System B — the sheet-synced scoring page (this spec).** Build after Phase 0.
>
> **Format:** standard repo build-spec — Files to read first / Schema diff / Algorithm / Edge cases / Verification, one phase at a time, commit per phase, ask the founder when a decision is ambiguous.

---

## 0. Background — why this exists (read carefully)

Aristora just shipped a **path-driven sheet redesign** (see `sheet_structure_redesign_plan.md` and `convex/learningEngine/planner.ts`). Each student now gets a printed practice sheet with 4 sections: **Warm-up** (recent mistakes), **Main block** (new concepts on a teacher-curated path), **Revision** (spaced-repetition / forgetting-curve), **Exam-prep** (past papers).

**The problem this spec fixes:** the Revision and Mistakes (Warm-up) sections are driven entirely by the student's **attempt history in `memoryState`**. That table is updated *only* by `recordAttempt()` in `convex/learningEngine/memory.ts`. But the **current Score tab** (`src/components/session/score-tab.tsx`) writes to the legacy **`entries`** table (a unit→exercise→question-key model) and **never calls `recordAttempt`**. So right now:

> The engine is blind. Main block keeps advancing the path, but **Revision and Warm-up(mistakes) stay empty** because no per-question correct/wrong result ever reaches `memoryState`.

**This spec builds the missing data loop:** a scoring surface scoped to **one specific sheet (by its `generatedSheets._id`)** that shows the sheet's exact questions and records each correct/wrong/skip into the engine via `recordAttempt`.

---

## 1. Locked decisions (from the founder — do not re-litigate)

1. **The new sheet-scoring feeds the LEARNING ENGINE ONLY** (`recordAttempt` → `memoryState`). It must **NOT** break or remove the existing `entries`-based scoring, which still powers **daily points, the leaderboard, and student "position."** Those keep running untouched for now.
2. **Points reconciliation is a separate System A** — the founder wants to **brainstorm it with you first** (Phase 0) before building. Do not assume how points should migrate; ask.
3. **Sheet-scoped, never mis-scored:** the whole scoring surface is opened from one sheet and bound to its `_id`. The teacher can never accidentally score a different sheet.
4. **Idempotent corrections:** re-marking a question must not double-apply memory updates (`recordAttempt` is additive — see §5).
5. Mobile-first, dark-navy + teal theme. Typecheck both layers (`npx tsc --noEmit -p tsconfig.json` AND `npx tsc --noEmit -p convex/tsconfig.json`). One phase per commit.

---

## Phase 0 — BRAINSTORM the points system with the founder (System A)

**Before writing any code**, use the brainstorming skill with the founder to decide System A: how the new sheet-scoring should eventually relate to **daily points / leaderboard / student position** (today all derived from `entries`). The founder deferred this on purpose to discuss it fresh with you.

Things to resolve in that brainstorm (do not guess):
- Should the new sheet-scoring **eventually replace** the old `entries` scoring, or **coexist**?
- Past-paper questions have **no exercise link** (`linkedExerciseId` is null) — how should they count toward points, if at all?
- Does the leaderboard move to a **mastery-based** model (it's sketched as Phase H.3 in `algorithm_plan.md`), or keep daily points?
- Where does the scoring UI live — **rewrite the Score tab**, or a **new sheet-scoped surface** beside it (recommended below)?

Produce a short written decision from that brainstorm, THEN build System B below according to it. **The only thing already locked:** System B (this build) records into the engine and must not break the existing points/entries system.

---

## System B — the sheet-synced scoring page

### Files to read first
- `convex/learningEngine/memory.ts` — `recordAttempt` / `applyAttempt`. **This is the engine entry point.** Note: `response` is `"good" | "again" | "skipped"`; `"skipped"` is a no-op; it credits **all** concepts tagged to the question; it is **additive** (not idempotent).
- `convex/learningEngine/pdfHelpers.ts` — `getSheetForRender(sheetId)` already returns each section's questions with `cropBox`, `pageImageUrl`, `conceptNames`, and the `slot`. **Reuse/extend this shape for the scoring read query** instead of re-deriving.
- `convex/learningEngine/planner.ts` — `markCompleted` mutation + the `generatedSheets` question arrays (`warmupQuestionIds`, `mainQuestionIds`, `revisionQuestionIds`, `examPrepQuestionIds`).
- `src/components/algorithm/sheet-preview.tsx` — `CropThumbnail` / the `backgroundImage` crop-clip trick. **Reuse it to show each question's image** in the scoring UI.
- `src/components/session/score-tab.tsx` — the existing scoring UX (student roster, attendance badges, tap-to-cycle marking, live-save). Mirror its patterns; reuse its roster/attendance scaffolding per the Phase 0 decision.
- `convex/schema.ts` — `generatedSheets`.

### Phase B1 — Schema: per-sheet results on the sheet row

**Schema diff** (`generatedSheets`, all optional — backward compatible):
```ts
// Live marks the teacher is entering, keyed by questionBank id (as string).
results: v.optional(v.record(v.string(), v.string())),          // questionId -> "correct" | "wrong" | "skipped"
// What has already been pushed to memoryState, so finalize is idempotent.
committedMarks: v.optional(v.record(v.string(), v.string())),    // questionId -> last-applied mark
scoredAt: v.optional(v.number()),
```
- Keys are `questionId as unknown as string`. Old sheets have neither field; treat as `{}`.

### Phase B2 — Backend: live mark + idempotent finalize

**Files:** new `convex/learningEngine/scoring.ts` (or extend `planner.ts`), reusing `applyAttempt` from `memory.ts`.

**Algorithm:**
```
# Live mark — called on every tap. NO memory write yet (idempotency lives at finalize).
mutation setSheetMark(sheetId, questionId, mark):       # mark in {correct,wrong,skipped,unmarked}
  sheet = get(sheetId)
  results = { ...(sheet.results ?? {}) }
  if mark == "unmarked": delete results[questionId]
  else: results[questionId] = mark
  patch(sheet, { results })

# Finalize — commit results to the engine, idempotently, and complete the sheet.
mutation finalizeSheetScoring(sheetId):
  sheet = get(sheetId)
  results   = sheet.results ?? {}
  committed = { ...(sheet.committedMarks ?? {}) }
  occurredAt = Date.parse(sheet.date + "T12:00:00.000Z")   # anchor to the practice day, not the marking day
  for (questionId, mark) in results:
    if committed[questionId] == mark: continue              # already applied → skip (idempotent)
    response = mark == "correct" ? "good" : mark == "wrong" ? "again" : "skipped"
    if response != "skipped":
      applyAttempt(ctx, { studentId: sheet.studentId, questionId, response, occurredAt, source: "sheet-score" })
    committed[questionId] = mark
  patch(sheet, { committedMarks: committed, scoredAt: Date.now(), status: "completed", completedAt: Date.now() })
```
- **Idempotency is the whole point:** `applyAttempt` fires only for questions whose mark **changed** since the last commit. Re-finalizing an unchanged sheet does nothing. Correcting one answer commits only that one delta.
- Reuse the existing `markCompleted` logic/guard or inline the status flip; do not duplicate completion side-effects.

**Edge cases:**
- Question tagged to no concept (some past-paper crops) → `applyAttempt` returns `updatedConcepts: 0`; harmless. Optionally surface an "untagged — won't affect mastery" hint in the UI.
- Re-opening a completed sheet to fix a mark → teacher edits `results`, presses Finalize again → only the corrected question re-commits (a fresh corrective attempt; acceptable per `algorithm_plan.md` A.2).
- A question removed from the sheet via the Edit drawer after scoring → ignore stale `results` keys not present in any section array.

### Phase B3 — Read query for the scoring UI

**Algorithm:** add `getSheetForScoring(sheetId)` (or extend `getSheetForRender`) returning, per section (warmup/main/revision/examPrep) in order: `questionId`, `cropBox`, `pageImageUrl`, `conceptNames`, `marksAvailable`, `questionNumberInPaper`, and the **current mark** from `sheet.results`. Plus `student`, `sheet.date`, `sheet.status`, and a short sheet id for the header. Reuse the resolution logic already in `getSheetForRender`.

### Phase B4 — Scoring UI (sheet-scoped)

**Recommended placement** (confirm against the Phase 0 brainstorm): a **new sheet-scoped scoring surface** opened from a row on the Sheets tab (e.g. a "Score" action on each student row in `src/components/session/sheets-tab.tsx`), rendered as a full-screen drawer like `SheetPreviewDrawer`. This is sheet-id-bound by construction (solves "I scored the wrong sheet") and avoids rewriting the 2264-line `score-tab.tsx` while points still depend on it.

**UI behavior:**
- Header: student name, date, sheet #, status, progress (`marked / total`).
- Four section groups in order **Warm-up · Main block · Revision · Exam-prep**, each question as a row with: number, **crop image** (reuse `CropThumbnail`), concept names, marks/paper tag.
- Tap a question to cycle **unmarked → correct → wrong → skipped → unmarked** (match `handleQuestionTap` in `score-tab.tsx`); each change calls `setSheetMark` (live-save).
- Sticky footer: correct/wrong/skipped tallies + **"Finalize & record"** button → `finalizeSheetScoring` → toast, mark complete. Disable until at least one question is marked.
- If `status === "completed"`, show it's already recorded; allow re-open + re-finalize (only deltas re-commit).
- Mobile-first, dark-navy + teal, reuse existing components.

**Edge cases:** loading/empty sheet; old sheet with no `results`; unauthenticated → existing guard pattern.

### Verification (System B)
1. Generate + score a sheet: mark some correct/some wrong → `setSheetMark` persists; reload keeps marks.
2. Press Finalize → `memoryState` rows update for the tagged concepts (check `attemptLog` has `source: "sheet-score"` rows); sheet flips to `completed`.
3. **The real proof:** generate that student's *next* sheet → the wrong-marked concepts now appear in **Warm-up (mistakes)**, and previously-correct concepts begin showing in **Revision** as they age. This closes the loop end-to-end.
4. Re-open the completed sheet, flip one mark, Finalize again → exactly one new `attemptLog` row (idempotency holds), not a full re-commit.
5. Old `entries`-based points/leaderboard untouched. Both typechecks pass.

---

## Execution protocol
- **Phase 0 first** (brainstorm points with founder, write the decision down). Then B1 → B4 in order.
- Typecheck both layers + run each phase's verification before committing `feat(scoring-BX): …`. Report after each phase.
- Never call `recordAttempt`/`applyAttempt` from the live-mark path — only from `finalizeSheetScoring`, guarded by the committed-marks diff.
- Do not modify the scoring engine weights. Do not break the `entries`/points system.

## Handoff summary for the orchestrator
When done, report: (1) the Phase 0 points decision; (2) new schema fields; (3) new function names + signatures (`setSheetMark`, `finalizeSheetScoring`, `getSheetForScoring`); (4) where the scoring UI lives + how it's opened; (5) anything you deviated from and why; (6) confirmation that finalize is idempotent and the engine loop was verified (point 3 above).
```
