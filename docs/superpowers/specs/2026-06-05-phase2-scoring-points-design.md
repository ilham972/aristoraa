# Phase 2 — Sheet-Synced Scoring + Difficulty/Section Points (Design Spec)

> **Status:** Drafted by orchestrator 2026-06-05, pending founder confirm on the flagged calls in §7.
> **Audience:** the build agent(s) + orchestrator. Read this whole file, then `sheet_scoring_plan.md` (repo root — the detailed System B build spec this wraps), then `algorithm_plan.md` §H.1.
> **Prereq:** Phase 1 (tracks) is code-complete + deployed to prod inert. Phase 2 does NOT depend on the Phase 1 *migration* being run — scoring works whether or not students ride tracks.

---

## 0. Why this exists + the honest staging

The learning engine is **blind today**: sheets are generated, but per-question correct/wrong results never reach `memoryState`, because the live Score tab writes the legacy `entries` table and never calls `recordAttempt`. So the sheet's **Revision** and **Warm-up (mistakes)** sections stay empty — the loop is open. Phase 2 closes it, and rebuilds points on top.

Phase 2 splits into two stages by risk. **The agent builds Stage 2a now. Stage 2b is specified here for context but is founder-gated and gets confirmed before build.**

| Stage | What | Risk | Touches |
|---|---|---|---|
| **2a — Engine scoring loop** | Score a sheet once → `recordAttempt` per question → engine fills Revision/Mistakes. Idempotent finalize. New sheet-scoped scoring surface. | **Low** — purely additive; does not touch the live `entries` points/leaderboard/position. | new functions + UI only |
| **2b — Points migration** | Compute difficulty+section points from the same sheet marks; new `sessionPoints` record; migrate the leaderboard data source; parallel-run old vs new for one term; retire the legacy Score tab. | **High** — touches the live parent-facing leaderboard + the `entries`-derived "position". | leaderboard, scoring tab, position |

**2a is the unblocker and is safe. 2b is the motivator change and must be deliberate.** Do not collapse them.

---

## 1. Locked decisions (from the founder brainstorm)

1. **Score once, on the sheet, per SESSION** (not per day — unequal weekly class counts). Scoring is a session ritual logged like attendance; the Sheets tab is the scoring surface. (Full effect lands in 2b; 2a introduces the sheet-scoped scoring surface.)
2. **Points = difficulty × section weighted** (Stage 2b). Section multipliers: Main 1.0, Revision 1.3, Exam-prep 1.5, **Warm-up/mistake 1.0** (NOT bonused — prevents deliberate-fail farming). Difficulty multiplier reuses the engine's `weight(q) = 0.6 + 0.2·d`. Plus a light per-session streak bonus.
3. **Parallel-run** old vs new points for one term before switching the public leaderboard (founder's de-risk call). Both computed from the SAME sheet marks — no double entry.
4. **Idempotent corrections:** re-marking a question must not double-apply engine updates.
5. Mobile-first, dark-navy + teal. Dual typecheck. App LIVE on prod `loris` — additive only, founder-gated cutovers.

---

## 2. Stage 2a — Engine scoring loop (BUILD THIS)

This stage IS `sheet_scoring_plan.md` "System B". Follow that file's Phases B1–B4 in full. This section captures the decisions + deltas; do not re-derive what's already there.

### 2a.1 Schema (additive on `generatedSheets`)
```ts
// generatedSheets — all optional, backward compatible:
results: v.optional(v.record(v.string(), v.string())),        // questionId(string) -> "correct"|"wrong"|"skipped"
committedMarks: v.optional(v.record(v.string(), v.string())), // last-applied mark per question (idempotency)
scoredAt: v.optional(v.number()),
```

### 2a.2 Backend (`convex/learningEngine/scoring.ts`)
- `setSheetMark(sheetId, questionId, mark)` — live mark; patches `results`; **no engine write** (idempotency lives at finalize).
- `finalizeSheetScoring(sheetId)` — for each question whose mark **changed** vs `committedMarks`, call `applyAttempt` (from `memory.ts`) with `response = correct→"good" | wrong→"again" | skipped→skip`, `occurredAt = sheet.date@12:00Z`, `source:"sheet-score"`; update `committedMarks`; set `status:"completed"`. Re-finalizing an unchanged sheet is a no-op; correcting one mark commits only that delta.
- `getSheetForScoring(sheetId)` — reuse `pdfHelpers.getSheetForRender` shape: per section (warmup/main/revision/examPrep) the questionId, cropBox, pageImageUrl, conceptNames, marks tag, plus the current mark from `results`; + student, date, status, short id.

### 2a.3 UI — sheet-scoped scoring surface
- New full-screen drawer opened from a **"Score" action on each student row in the Sheets tab** (`src/components/session/sheets-tab.tsx`), bound to one `generatedSheets._id` (solves "scored the wrong sheet" by construction).
- Four sections in order (Warm-up · Main · Revision · Exam-prep); each question row: number, crop image (reuse `CropThumbnail` from `sheet-preview.tsx`), concept names, marks/paper tag.
- Tap cycles unmarked → correct → wrong → skipped → unmarked; each change calls `setSheetMark` (live-save).
- Sticky footer: correct/wrong/skipped tallies + "Finalize & record" → `finalizeSheetScoring` → toast + mark complete. Disabled until ≥1 mark. Re-open + re-finalize allowed (only deltas re-commit).

### 2a.4 Interim reality (acknowledged, not a bug)
During 2a the legacy `entries` Score tab **keeps running untouched** (it still powers points/leaderboard/position). So a teacher who wants both engine data and points scores in two places for now. That double-entry is **resolved in 2b**, not here. Do NOT touch `entries`, points, or the leaderboard in 2a.

### 2a.5 Edge cases
- Question tagged to no concept (some past-paper crops) → `applyAttempt` no-ops on concepts; optionally show "won't affect mastery" hint.
- Question removed from the sheet after scoring → ignore stale `results` keys not in any section array.
- Re-open completed sheet, flip one mark, finalize → exactly one new `attemptLog` row.

### 2a.6 Verification (the loop closes — this is the proof)
1. Score a sheet (some correct, some wrong) → `setSheetMark` persists; reload keeps marks.
2. Finalize → `memoryState` updates for tagged concepts; `attemptLog` has `source:"sheet-score"` rows; sheet → `completed`.
3. **Generate that student's NEXT sheet → the wrong-marked concepts now appear in Warm-up (mistakes); previously-correct concepts begin appearing in Revision as they age.** Loop closed end-to-end.
4. Re-open, flip one mark, finalize → exactly one new `attemptLog` row (idempotency holds).
5. Legacy `entries` points/leaderboard untouched. Both typechecks pass.

---

## 3. Stage 2b — Points migration (SPEC ONLY; founder-gated, confirm §7 first)

### 3.1 Points formula (per correct answer on a finalized sheet)
```
BASE_POINTS = 5
diffMult(d)   = 0.6 + 0.2 * d            # d in 1..5 → 0.8 .. 1.6  (mirrors engine weight)
sectionMult   = { main:1.0, revision:1.3, examPrep:1.5, warmup:1.0 }
points(q)     = BASE_POINTS * diffMult(d) * sectionMult[section]
# streak bonus: +STREAK_STEP per consecutive correct beyond the 2nd in a session,
#   capped at STREAK_CAP. wrong/skipped reset the streak and earn 0.
```
Defaults (tunable, flagged §7): `STREAK_STEP = 1`, `STREAK_CAP = 5`. Unknown difficulty → d=3.

### 3.2 New table `sessionPoints` (one row per finalized sheet)
```ts
sessionPoints: defineTable({
  studentId: v.id("students"),
  sheetId: v.id("generatedSheets"),
  date: v.string(),                 // YYYY-MM-DD (sheet.date)
  slotId: v.optional(v.id("scheduleSlots")),
  correctCount: v.number(),
  totalQuestions: v.number(),
  pointsOld: v.number(),            // legacy triangular, per session: 5*C*(C+1)/2
  pointsNew: v.number(),            // difficulty+section weighted + streak
  computedAt: v.number(),
})
  .index("by_student_date", ["studentId", "date"])
  .index("by_sheet", ["sheetId"])
  .index("by_date", ["date"]);
```
Computed inside `finalizeSheetScoring` (extends 2a). Idempotent: upsert by `sheetId`.

### 3.3 Leaderboard migration + parallel run
- Leaderboard reads `sessionPoints` summed per student over the period (still **grade-filtered — cohort ranking is Phase 3**).
- A config flag `LEADERBOARD_SCORING_MODE: "old" | "new"` (default `"old"` for the trial term) controls which column the public board shows. Admin view shows both side-by-side.
- The legacy `entries`-based leaderboard path stays available as a fallback until the founder flips the mode after one term.

### 3.4 Retire legacy Score tab + position note
- Once 2b is verified, hide the legacy `entries` Score tab in the session workspace (scoring happens on the Sheets tab).
- **Position caveat:** the next-exercise pointer + progress grid (`position-dialog.tsx`) read `entries`. Retiring `entries` writes affects position. In the track world, position = track position (Phase 1) + mastery. **Position migration is its own task — flag it; do not silently break the position dialog.** Simplest interim: keep writing a minimal `entries` row from sheet scoring for position continuity, OR migrate position to read track+mastery. Decide at 2b build time.

### 3.5 Edge cases
- Past-paper question, no `linkedExerciseId`: still earns points via its difficulty + Exam-prep section (no exercise link needed for points).
- Multi-session day: `sessionPoints` is per session; the leaderboard sums them — matches the per-session model.
- Old `entries` history pre-Phase-2: leaderboard over historical dates falls back to the `entries` computation; `sessionPoints` only exists from 2a-scoring onward.

---

## 4. Out of scope (Phase 3+/explicitly NOT here)
- Cohort/track-based leaderboard ranking + promotion/leagues (Phase 3).
- Railway map (Phase 4).
- Deleting the `entries` table (kept for history).
- Auto-difficulty Elo (algorithm_plan §H.2).

---

## 5. Key files
- `sheet_scoring_plan.md` (repo root) — the System B build detail for Stage 2a.
- `convex/learningEngine/memory.ts` — `applyAttempt`/`recordAttempt` (engine entry; additive, not idempotent — guard at finalize).
- `convex/learningEngine/pdfHelpers.ts` — `getSheetForRender` shape to reuse.
- `convex/learningEngine/planner.ts` — `generatedSheets` question arrays + `markCompleted`.
- `src/components/session/sheets-tab.tsx` — where the Score action mounts.
- `src/components/algorithm/sheet-preview.tsx` — `CropThumbnail` reuse.
- `src/lib/scoring.ts` + `src/app/leaderboard/page.tsx` — legacy points/leaderboard (Stage 2b touches these).
- `convex/schema.ts` — `generatedSheets` (2a fields) + `sessionPoints` (2b).

---

## 6. Build order
1. **Stage 2a** (engine loop): schema → `scoring.ts` (`setSheetMark`, `finalizeSheetScoring`, `getSheetForScoring`) → scoring UI → verify the loop closes (§2a.6). Ship + deploy inert (additive).
2. **Stage 2b** (points) — only after founder confirms §7: `sessionPoints` + dual-compute in finalize → leaderboard reads sessionPoints behind the mode flag → parallel-run a term → retire Score tab + handle position → flip mode.

---

## 7. Open calls for the founder to confirm before Stage 2b build
1. **Section multipliers** — Main 1.0 / Revision 1.3 / Exam-prep 1.5 / Warm-up 1.0. Good, or different weights?
2. **Streak bonus** — keep it (STREAK_STEP=1, cap 5/session), or drop the streak entirely for simplicity?
3. **BASE_POINTS = 5** — preserves today's "5 per question" feel. Keep?
4. **Position during 2b** — keep writing a shim `entries` row for the position dialog, or migrate position to read track+mastery now? (Affects scope.)
These do NOT block Stage 2a — it can be built and shipped while these are decided.
