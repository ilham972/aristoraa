# Learning engine — the moat (/algorithm + convex/learningEngine)

THE priority area (purpose.md): the algorithm that guarantees "A result within
predicted time". Current plans (root, NEVER delete): `learning_engine_plan.md`
(strategy) + `algorithm_plan.md` (phases). Phases A–D shipped; validated via
cumulative-exam holdouts.

## The loop (per student, per session)
1. **Memory model** (`memory.ts`) — FSRS-like per-concept state in
   `memoryState`: stability S + difficulty D. Each scored question updates
   every tagged concept ("good": S grows ×lag-bonus, "again": S decays;
   weights scale 0.8–1.6 with question difficulty 1–5; "skipped": no-op).
   All constants in `config.ts`. Mastery = f(S, D) in `mastery.ts`.
2. **Planner** (`planner.ts`, 2309 lines — the heart):
   - D.1 candidate pool: in-scope concepts, no unmet prerequisites, question
     not used within NOVELTY_COOLDOWN_DAYS.
   - D.2 transparent 5-factor score (weights in config.ts): importance,
     urgency (1−retrievability, overdue boost), fit (Gaussian difficulty↔skill
     match), novelty (hard-filtered, factor kept for future soft-novelty),
     proximity (days to exam via examCalendar).
   - COVERAGE LADDER = THE DEFAULT (departments redesign 2026-07-14; the
     one-day global toggle is retired): fit is OVERRIDDEN per concept by the
     easy→hard ladder over UNSEEN questions (coverageMode.ts, pure + tested)
     — finish the book, no repeats; seen Qs damped ×0.25; too-hard tail
     (>skill+2) deferred. SR timing untouched. fitOverride/Reason in the
     scoringSnapshot. Per-student fallback: students.learningMode =
     "consolidation" (manual switch on /students/[id]/progress) returns THAT
     student to Gaussian fit + repeats; daily engineAlerts.ts cron suggests
     flips both ways (weighted fail-rate, enter 40% / exit 20% hysteresis,
     pure math in convex/lib/consolidationCore.ts).
   - D.3 slot allocator: warm-up = OFF-module, Main block = ON-module —
     driven by TRACK since the exam-mode change (not teachingPath) —
     exam-prep = module-agnostic, targets near-mastered via past papers.
   - Adaptive sheet length: grows/shrinks with completion rate history.
   - `plannerGaps` surfaces concepts with zero candidates (never blocks).
   - D.6 `scoringSnapshot` stores per-question factor values for audit — the
     Lead "why this question?" tooltip reads these, never re-derives.
3. **Scoring** (`scoring.ts`) — sheet marks → `applyAttempt` per question →
   memory updates + points. Single entry point: finalizeSheetScoring.

## Control panels
- `/planner` (nav, 2026-07-15) — THE global planning page, 6 tabs: Term
  (grade → exam countdown + per-group CAPACITY PLAN: demand-vs-sessions
  fits/short with the exact fix, from groupLessonPlan.examPlan; runway
  cards; crystallize one/all), Calendar (per-group scheme day-grid to exam:
  unit/state per session, Revision slots, cancelled days, tuning levers —
  `groupPlan.groupTermCalendar`), Sheets (FULL-TERM prebuild: "Run all term
  sheets" = crystallize to 180d cap, "Re-plan" = deleteFuturePlanned +
  rebuild after Lesson-Builder reorders; grid of date cards grouped into
  unit "line segments" + question-crop preview drawer with ‹› sheet nav —
  groupSheetHistory/groupSheetPreview; amber banner + honest toast when the
  question bank runs dry: crystallize returns exhausted/unplannedSessions;
  DEFAULT view now the TERM COVERAGE COCKPIT (2026-07-16) — `groupTermCoverage`
  term accordions of tiny question boxes taught/planned/unseen + tap-provenance,
  per-student per-unit marks `groupStudentUnitProgress`/`setStudentUnitDone`
  (catch-up + progress; group Main stays ONE sheet), tap unit → `UnitArrangeDialog`
  drag=difficulty, one-tap "earlier terms taught" reuses setGroupStartingPoint;
  Coverage + Timeline UNIFIED on one page (no toggle), timeline grouped BY WEEK
  w/ per-sheet mix + red EXAM line from examPlan.examDate — NB crystallize's
  180d horizon ignores the exam, so overshoot is shown not prevented),
  Forecast (grade rollup), Tracks + Exams (moved FROM /algorithm; Exams =
  grade×term grid/year + Quick entry). Backend `plannerBoard.ts`. Board nav
  slot freed → leaderboard link in /students.
- `/algorithm` — inspection only: Coverage, Blueprint, Path (stale
  ?tab=tracks|exams redirect to /planner).
- `/algorithm/exam-calendar` — standalone page; **exam mode is MANUAL**:
  `examModeActive` switch + daily alert cron (`calendar.ts`).
- `/algorithm/scoring` — factor weight inspection (`difficultyTab.ts`).

## Supporting modules
- `profile.ts` — studied-scope + per-concept profile (the planner's input).
- `path.ts` / `tracks.ts` — teaching path & track resolution (domain.md).
- `importance.ts` / `derivedConcepts.ts` — concept importance (Phase B) +
  question↔concept tagging graph. `cropIntegrity.ts` — crop validation tool.
- `pdf.ts` (1230) + `pdfHelpers.ts` — sheet PDF rendering (pdf-lib).
- `leagues.ts`, `map.ts`, `studentDashboard.ts` — see tracks-leaderboard.md.
- UNWIRED: `backfill.ts` (one-off A.4 backfill tool — founder-gated track
  seeding step may still need it), `config.ts` has no api callers by design
  (direct-import constants), `mastery.ts`/`memory.ts` likewise direct-import.

## Departments: group Main plan + Revision queues (2026-07-14)
`groupPlan.ts` + pure `convex/lib/groupPlanCore.ts` (tested): the Main block
of a group session is ONE identical sheet planned at group level. Bookmark =
DERIVED union (groupSheets rows + members' generatedSheets), never stored.
Skeleton query = lesson plan to exam day (unit per session, finish-vs-exam
verdicts); crystallizeUpcoming writes groupSheets rows ~7d ahead (new = next
unseen ladder of current unit — textbook first, then capped past-paper tail,
alert cron scanBookExhaustion at the boundary; spiral = unseen Qs from past
units, weakest group-avg R first). Sheets tab materializes rows per student
via mainQuestionIdsOverride (PDF/scoring/memory unchanged). Revision dept:
scheduleSlots.sessionType="revision"; queues = group-claimed-but-unseen Qs
(delegation + absence catch-up, ONE rule, cap 10); consolidation students
get the fully-personal planner instead. UI: /groups/[id]/plan (redesigned
2026-07-15: one runway strip + locked-in rows + unit-SPAN projection) +
/planner Term board + Calendar. Heavy walks batched with Promise.all.
Skeleton is CANCELLATION-AWARE (2026-07-15): dates whose representative
slot has a sessionLogs `cancelled_by_tutor` row are skipped — the plan
reflows past them and crystallize never writes onto a cancelled day.
Tuning levers (2026-07-15, /planner Calendar): `mainQuestionsPerSession`
(setGroupMainQuestions, 3–15); `resizePlanned` (one sheet, new count);
leftover log `groupCarryOvers` (carryOverLeftover: sheet tail → "main" =
next crystallize serves FIRST then consumedAt, or "revision" = per-member
queue rows consumed via consumeCarryRows). skeletonInputs adds unconsumed
carry to unit demand; deletePlanned un-consumes; bookmark never un-seen.
Book-gap honesty (2026-07-15): ZERO-question units → verdict "no-questions"
never "done" (shown on runway/Term/Calendar `unitsWithoutQuestions`/Sheets
banner); crystallize returns exhausted/unplannedSessions. Deleting an
exercise cascades to its crops (cleanupCropsForExercise: delete unreferenced
/ unlink printed) — dangling linkedExerciseId hid crops from every ladder
(52 dupes cleaned via migrations:cleanupOrphanCrops). STARTING POINT
(2026-07-15): `groupPreTaughtUnits` marks units done BEFORE the app;
loadGroupPlanState folds their questions into `seen` (skeleton/crystallize/
spiral/capacity skip them; verdict "done" beats no-questions).
`setGroupStartingPoint(groupId, throughUnitId|null)` = track-prefix
reconcile, reversible. Pure bookmark, no sheet/point/memory effects. UI:
`StartingPointButton` (group plan header + Term cards).

## Coverage forecast advisor (2026-07-14)
`coverageForecast.ts` (query) + pure math `convex/lib/coverageForecastCore.ts`
(unit-tested): per track unit — book-question pool (questionsTaggedToConcept),
seen count (all the student's sheets), pace from last 14d of sheets, capacity
before each term's exam vs remaining → projected % + verdict (done/on-track/
at-risk/wont-finish/no-exam/no-questions); proportional-share allocation
across unfinished units. TERM-AWARE (2026-07-15): only units with an
UPCOMING exam compete for capacity — past terms' leftovers are revision
material, not a deadline; summary carries datedRemaining/daysToFinishDated. UI `coverage-forecast.tsx` on /students/[id]/progress
below the metro line; GLOBAL grade rollup on /planner Forecast tab
(`plannerBoard.gradeForecastRollup`, same pure core + PACE_WINDOW_DAYS).

## Track Progress + 2026-07-10 safety fixes
- `trackProgress.ts` — live per-student unit/track progress query (metro-line
  view + session strip); pure math in `convex/lib/trackProgressCore.ts`
  MUST keep mirroring the planner's pacing constants.
- Planner fixes: track units now unioned into pool scope (cross-grade tracks
  no longer silently skipped); completion stats credit attempts within 48h of
  sheet date; getSavedSheet is duplicate-row safe (collect, not unique).

## Rules for changing the engine
- Read BOTH plan files first; behaviour must match algorithm_plan.md blocks.
- Constants live ONLY in config.ts. The scorer stays module-blind (slot
  concerns belong to D.3). Keep every factor exposed in return values.
- repeatCount remedy is a TEMPORARY stopgap outside SR/mastery — don't deepen it.
