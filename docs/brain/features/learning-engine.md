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
   - D.3 slot allocator: warm-up = OFF-module, Main block = ON-module —
     driven by TRACK since the exam-mode change (not teachingPath) —
     exam-prep = module-agnostic, targets near-mastered via past papers.
   - Adaptive sheet length: grows/shrinks with completion rate history.
   - `plannerGaps` surfaces concepts with zero candidates (never blocks).
   - D.6 `scoringSnapshot` stores per-question factor values for audit — the
     Lead "why this question?" tooltip reads these, never re-derives.
3. **Scoring** (`scoring.ts`) — sheet marks → `applyAttempt` per question →
   memory updates + points. Single entry point: finalizeSheetScoring.

## Control panels (src/app/algorithm/*)
- `/algorithm` (1047 lines) — engine dashboard + per-student inspection.
- `/algorithm/blueprint` — exam paper structures (paperStructures*) defining
  composition targets.
- `/algorithm/coverage` — deployment gate: every studied concept needs
  ≥ MIN_QUESTIONS_PER_CONCEPT tagged questions (`coverage.ts`).
- `/algorithm/exam-calendar` — exam dates per (schoolGrade, term) feeding the
  proximity factor (`calendar.ts`). **Exam mode is MANUAL**: `examModeActive`
  switch + daily exam-approaching alert cron + bell in bottom nav.
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

## Rules for changing the engine
- Read BOTH plan files first; behaviour must match algorithm_plan.md blocks.
- Constants live ONLY in config.ts. The scorer stays module-blind (slot
  concerns belong to D.3). Keep every factor exposed in return values.
- repeatCount remedy is a TEMPORARY stopgap outside SR/mastery — don't deepen it.
