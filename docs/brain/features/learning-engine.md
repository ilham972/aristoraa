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
     config.ts): importance, urgency (1−retrievability + overdue boost), fit
     (Gaussian), novelty (hard-filtered), proximity (exam distance).
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
  `plannerBoard.ts` (nav slot freed → leaderboard link in /students). Term:
  exam countdown + per-group CAPACITY PLAN (demand vs sessions, exact fix) +
  runway cards + crystallize one/all. Calendar: per-group day-grid to exam
  (unit/state, Revision slots, cancelled days, levers). Forecast: grade rollup.
  Tracks + Exams (from /algorithm; grade×term grid + Quick entry).
- Sheets tab = the CONTROL ROOM (2026-07-16; sessions redesign 2026-07-18):
  "Run all term sheets" (crystallize, 180d cap) + "Re-plan"; amber bank-dry
  banner. Coverage = % strip + TERM CHIPS (set covTerm for the week grids —
  never remove) linking to Insights. Timeline = METRO-LINE MASTER/DETAIL
  (rules in decisions.md): week ring-station rail + sticky detail card: chips
  are SESSIONS (one groupSheets row each; "+ session" adds one on a free day);
  highlight pill lights a session's picks, and its A4 PAGES appear as "Sheet
  1/2…" pills narrowing the highlight per printed page (`groupSheetPages` —
  exact from pdfPageAssignments stamped by renderGroupSheetPDF, else estimated
  via convex/lib/sheetLayout.ts, constants MUST match pdf.ts). Grids in TRUE
  book order; 7+7 day strip last; drawer ‹› nav. Unit name → GROUP LESSON
  BUILDER (`group-lesson-builder.tsx`, SHARED grid with the session builder
  via `components/lesson/lesson-question-grid.tsx`): Main/Revision tabs; tap
  tile = tick/untick (ban), tap tick chip = flip GREEN (Main) ↔ YELLOW
  (revision route, `groupQuestionRoutes`, manual never auto-overwritten).
  "+ unit" (week card + builder) = UNIT COMPRESSION (`compression-dialog.tsx`,
  compressionPreview/applyCompression): start the next unit now — keep concept
  intros + hardest ~20% green, middle drill flips yellow, then re-plan.
- `/algorithm` — Coverage = TWO LENSES (2026-07-17): GROUPS = the Cockpit moved
  off /planner (`groupsTermCoverageSummary` = cheap all-group rail rings, counts
  only; only the tapped group pays for `groupTermCoverage`), BANK = concept
  stock (grade×term, cumulative); book-gap bridges Groups→Bank. Plus Blueprint,
  Path; stale tabs → /planner; duplicate routes → legacy-map.
  `/algorithm/exam-calendar` — exam mode MANUAL (`examModeActive` + daily alert
  cron); `/algorithm/scoring` — weights (`difficultyTab.ts`).

## Supporting modules
`profile.ts` scope/profile; `path.ts`/`tracks.ts`; `importance.ts`/
`derivedConcepts.ts` importance + tagging; `cropIntegrity.ts`; `pdf.ts`+
`pdfHelpers.ts` (pdf-lib); `leagues.ts`/`map.ts`/`studentDashboard.ts` →
tracks-leaderboard.md. UNWIRED: `backfill.ts`; `config.ts`/`mastery.ts`/
`memory.ts` direct-import (see legacy-map).

## Departments: group Main plan + Revision queues (2026-07-14)
`groupPlan.ts` + pure `groupPlanCore.ts` (tested): a group session's Main block
is ONE identical sheet planned at group level; bookmark = DERIVED union
(groupSheets + members' generatedSheets), never stored. Skeleton = lesson plan
to exam (unit/session, finish-vs-exam verdicts), CANCELLATION-AWARE (cancelled
days skipped, plan reflows). crystallizeUpcoming writes groupSheets (new = next
unseen ladder, textbook then capped past-paper tail, scanBookExhaustion cron;
spiral = unseen past-unit Qs, weakest group-avg R first); session Sheets tab
materializes per student via mainQuestionIdsOverride. Revision dept:
sessionType="revision"; queues = group-claimed-but-unseen Qs (delegation +
absence catch-up, ONE rule, cap 10) + ROUTED yellow Qs (groupQuestionRoutes,
2026-07-18 — question-level delegation; out of Main demand/queues/coverage
denominators, ban wins, seen wins); consolidation students get the personal
planner. Tuning: mainQuestionsPerSession (3–15), resizePlanned, groupCarryOvers
log (tail → "main" served FIRST next crystallize, or "revision" per-member
queue; deletePlanned un-consumes; bookmark never un-seen). Book-gap honesty:
zero-question units = "no-questions" never "done"; exercise deletes cascade to
crops. STARTING POINT: groupPreTaughtUnits + setGroupStartingPoint = reversible
track-prefix bookmark, no sheet/point/memory effects; planner paths skip those
units. UI: /groups/[id]/plan + StartingPointButton.

## Per-student views
- Coverage forecast advisor (2026-07-14): `coverageForecast.ts` + pure
  `coverageForecastCore.ts` (tested) — per unit: pool, seen, 14d pace, capacity
  to each term's exam → projected % + verdict, proportional-share; TERM-AWARE
  (only units with an UPCOMING exam compete). UI: /students/[id]/progress +
  /planner Forecast rollup (same core).
- Track Progress (2026-07-10): `trackProgress.ts` (metro-line + strip); pure
  `trackProgressCore.ts` MUST mirror planner pacing. Fixes: track units in pool
  scope; completion credits ≤48h; getSavedSheet duplicate-row safe.

## Rules for changing the engine
Read BOTH plan files first; behaviour must match algorithm_plan.md blocks.
Constants ONLY in config.ts; scorer stays module-blind (slots are D.3); keep
every factor exposed. repeatCount is a TEMPORARY stopgap — don't deepen it.
