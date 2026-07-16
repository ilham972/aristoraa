# Learning engine — the moat (/algorithm + convex/learningEngine)

THE priority area (purpose.md): the algorithm guaranteeing "A result within
predicted time". Plans (root, NEVER delete): `learning_engine_plan.md` +
`algorithm_plan.md`. Phases A–D shipped; validated via cumulative-exam holdouts.

## The loop (per student, per session)
1. **Memory model** (`memory.ts`) — FSRS-like per-concept S + D in
   `memoryState`; each scored question updates every tagged concept ("good"
   grows S ×lag-bonus, "again" decays, "skipped" no-op; weights ×0.8–1.6 by
   difficulty). Constants in `config.ts`; mastery = f(S, D) in `mastery.ts`.
2. **Planner** (`planner.ts`, 2309 lines — the heart):
   - D.1 pool: in-scope concepts, prerequisites met, question outside
     NOVELTY_COOLDOWN_DAYS. D.2 transparent 5-factor score (weights in
     config.ts): importance, urgency (1−retrievability + overdue boost),
     fit (Gaussian), novelty (hard-filtered), proximity (exam distance).
   - COVERAGE LADDER = THE DEFAULT (2026-07-14, toggle retired): fit is
     overridden per concept by the easy→hard ladder over UNSEEN questions
     (`coverageMode.ts`, pure + tested) — finish the book, no repeats; seen
     damped ×0.25; too-hard tail (>skill+2) deferred; SR untouched. Fallback:
     learningMode="consolidation" (student progress page) restores Gaussian
     fit + repeats; engineAlerts.ts cron suggests flips (weighted fail-rate,
     40%/20% hysteresis, consolidationCore.ts).
   - D.3 slots: warm-up OFF-module, Main ON-module (by TRACK), exam-prep
     module-agnostic past papers. Adaptive sheet length; `plannerGaps`
     surfaces zero-candidate concepts (never blocks). D.6 `scoringSnapshot`
     stores factor values — "why this question?" reads these, never re-derives.
3. **Scoring** (`scoring.ts`) — marks → applyAttempt per question → memory +
   points; single entry point finalizeSheetScoring.

## Control panels
- `/planner` (nav, 2026-07-15) — THE global planning page, 6 tabs; backend
  `plannerBoard.ts` (nav slot freed → leaderboard link in /students).
  Term: exam countdown + per-group CAPACITY PLAN (demand vs sessions, exact
  fix) + runway cards + crystallize one/all. Calendar: per-group day-grid to
  exam (unit/state, Revision slots, cancelled days, levers). Forecast: grade
  rollup. Tracks + Exams (from /algorithm; grade×term grid + Quick entry).
- Sheets tab = the CONTROL ROOM (2026-07-16): "Run all term sheets"
  (crystallize, 180d cap) + "Re-plan" (deleteFuturePlanned + rebuild); amber
  banner when the bank runs dry. Coverage collapses to a summary = TERM
  COVERAGE COCKPIT (`groupTermCoverage` question boxes + tap-provenance,
  per-student unit marks, UnitArrangeDialog drag=difficulty, one-tap
  "earlier terms taught"). Timeline = METRO-LINE MASTER/DETAIL: left rail of
  week ring-stations (ring = term progress, dim teal before / bright emerald
  this week's delta; exam = rose flag terminus; today = pulsing dot; all
  weeks visible, no scroll; circle-only on phones) + fixed sticky detail
  card per tapped week: new/review counts (mix bar dropped — always 100%),
  cumulative bar (red past exam; crystallize ignores the exam, overshoot
  shown not prevented), pick grids in TRUE book order (src/lib/book-order.ts
  — coverage returns ladder order), horizontal 7+7 day strip LAST
  (`groupSlotDays`). Drawer ‹› nav + planned-row actions. 2026-07-17 chip
  pills: real-PDF print preview (renderGroupSheetPDF reuses buildPDF; blob in
  groupSheets.pdfPreviewStorageId) + highlight-sheet-in-grid; unit name →
  GROUP LESSON BUILDER (group-unit-builder.tsx), CURATION ticks: untick =
  ban (groupUnitBans — queues/skeleton/coverage/exhaustion respect it,
  taught locked) + auto re-plan; "planned" chip badge hidden.
- `/algorithm` — inspection only (Coverage, Blueprint, Path; stale tabs →
  /planner). `/algorithm/exam-calendar` — exam mode MANUAL (`examModeActive`
  + daily alert cron). `/algorithm/scoring` — weights (`difficultyTab.ts`).

## Supporting modules
`profile.ts` studied scope/profile (planner input); `path.ts`/`tracks.ts`
path & tracks; `importance.ts`/`derivedConcepts.ts` importance + tagging;
`cropIntegrity.ts` crop validation; `pdf.ts`+`pdfHelpers.ts` PDF (pdf-lib);
`leagues.ts`/`map.ts`/`studentDashboard.ts` → tracks-leaderboard.md. UNWIRED:
`backfill.ts` (A.4 tool); `config.ts`/`mastery.ts`/`memory.ts` direct-import.

## Departments: group Main plan + Revision queues (2026-07-14)
`groupPlan.ts` + pure `groupPlanCore.ts` (tested): a group session's Main
block is ONE identical sheet planned at group level; bookmark = DERIVED
union (groupSheets + members' generatedSheets), never stored. Skeleton =
lesson plan to exam (unit/session, finish-vs-exam verdicts), CANCELLATION-
AWARE (cancelled days skipped, plan reflows). crystallizeUpcoming writes
groupSheets (new = next unseen ladder, textbook then capped past-paper tail,
scanBookExhaustion cron; spiral = unseen past-unit Qs, weakest group-avg R
first); session Sheets tab materializes per student via
mainQuestionIdsOverride. Revision dept: sessionType="revision"; queues =
group-claimed-but-unseen Qs (delegation + absence catch-up, ONE rule, cap
10); consolidation students get the personal planner. Tuning:
mainQuestionsPerSession (3–15), resizePlanned, groupCarryOvers log (tail →
"main" served FIRST next crystallize, or "revision" per-member queue;
deletePlanned un-consumes; bookmark never un-seen). Book-gap honesty:
zero-question units = "no-questions" never "done"; exercise deletes cascade
to crops. STARTING POINT: groupPreTaughtUnits + setGroupStartingPoint =
reversible track-prefix bookmark, no sheet/point/memory effects; planner
paths skip those units. UI: /groups/[id]/plan + StartingPointButton.

## Per-student views
- Coverage forecast advisor (2026-07-14): `coverageForecast.ts` + pure
  `coverageForecastCore.ts` (tested) — per unit: pool, seen, 14d pace,
  capacity to each term's exam → projected % + verdict, proportional-share;
  TERM-AWARE (only units with an UPCOMING exam compete). UI:
  /students/[id]/progress + /planner Forecast rollup (same core).
- Track Progress (2026-07-10): `trackProgress.ts` (metro-line + strip); pure
  `trackProgressCore.ts` MUST mirror planner pacing. Fixes: track units in
  pool scope; completion credits ≤48h; getSavedSheet duplicate-row safe.

## Rules for changing the engine
Read BOTH plan files first; behaviour must match algorithm_plan.md blocks.
Constants ONLY in config.ts; scorer stays module-blind (slots are D.3); keep
every factor exposed. repeatCount is a TEMPORARY stopgap — don't deepen it.
