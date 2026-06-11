# Audit working file — findings (dead-code candidates + improvement ideas)

Working evidence file. Not a brain file; no size cap. Consolidated into
legacy-map.md (verdicts) and ideas-backlog.md (ideas) at the end of the audit.

## Dead-code candidates from tooling (Task 2 evidence)

### Frontend files imported by nothing live (knip, 14 files)
- src/components/flag-toggle.tsx
- src/components/groups/attendance-tab.tsx
- src/components/learning/student-league-card.tsx
- src/components/pinch-zoom-area.tsx
- src/components/position-dialog.tsx
- src/components/settings/past-paper-pill-header.tsx
- src/components/sheets/bulk-actions.tsx
- src/components/sheets/inspector-body.tsx
- src/components/sheets/inspector-drawer.tsx
- src/components/sheets/student-row.tsx
- src/components/sheets/summary-strip.tsx
- src/components/top-header.tsx
- src/lib/phone.ts
- src/lib/store.ts

### Convex modules with NO real callers (only referenced by generated api.d.ts)
- convex/groupMigration.ts            (possibly intentional one-off migration tool)
- convex/learningEngine/backfill.ts   (possibly intentional one-off backfill tool — track model founder-gated step)
- convex/lib/naming.ts
- convex/messaging/testSend.ts        (note: messaging/sendTest.ts EXISTS too and IS called — near-duplicate names)
- convex/sessionSubmissions.ts
- convex/studentModulePositions.ts

### Unused dependencies (knip)
- html2canvas, shadcn, sharp, tw-animate-css, uuid (deps)
- @types/uuid, tailwindcss (devDeps — tailwindcss likely false positive, used via PostCSS)

### Unused exports (knip — within live files; symptom of iteration layers)
- src/lib/scoring.ts: 12 unused exports (calculateDailyPoints, getDailyScore, …) — old points system remnants
- src/lib/sub-questions.ts: 7 unused exports — pre-stem/leaf model remnants
- src/lib/types.ts: formatMinutesToTime, MODULE_DAYS, getTodayModule, getDayName — weekday→module system remnants (killed by path redesign)
- src/components/sheets/filters-bar.tsx: FiltersBar itself unused — superseded sheets UI
- src/components/session/session-workspace.tsx: ALL_SESSION_TABS, isSessionTab — tab-merge remnants

### Notes
- convex/seeds/* have 0 api callers — run manually via `npx convex run`; KEEP as tools.
- convex/lib/* are direct-import helpers; all alive except lib/naming.ts.

## Improvement ideas (seeded during audit; justify against purpose.md)
(appended by Tasks 4–9)

## Task 4 findings (groups & scheduling)
- DEAD: src/components/groups/attendance-tab.tsx (536 lines) — analytics moved to /analytics, this stayed behind.
- DEAD-ish: convex/lib/naming.ts — backend twin of src/lib/groups/naming.ts, zero importers.
- Unused exports in src/lib/groups/time-grid.ts (WEEKDAY_BANDS, bandsForDay, jsDowToDayNum) — old weekday-band system leftovers.
- IDEA: /groups page.tsx is 1030 lines and edit-group-dialog 816 — split candidates for maintainability (serves scale-readiness, secondary to engine).
- IDEA: Phase F.6–F.8 unfinished (old scheduling tab still wired) — finishing it removes a whole legacy surface (serves teacher efficiency + dead-code reduction).

## Task 5 findings (session/sheets/scoring)
- DEAD cluster: src/components/sheets/{inspector-drawer,inspector-body,student-row,bulk-actions,summary-strip}.tsx + FiltersBar — pre-merge standalone Sheets UI (~1.6k lines total).
- DEAD: convex/sessionSubmissions.ts — zero callers; superseded by learningEngine scoring path.
- IDEA: lead-tab.tsx is 1487 lines — split candidate.
- IDEA: scoring finalize is the single SR/points entry point — good place for engine-quality metrics (serves learning engine / moat).

## Task 6 findings (learning engine)
- planner.ts (2309) and pdf.ts (1230) are huge but ALIVE and well-commented — split only with great care, the comments are load-bearing docs.
- backfill.ts unwired but KEEP — needed for founder-gated track seed/backfill step (project_track_model).
- IDEA (high): cumulative-exam holdout validation loop is the plan centerpiece — verify it has a UI/report surface; if not, build one (serves: learning engine, predicted-time promise).
- IDEA: predicted-time-to-A is the brand promise but no module computes a per-student ETA — candidate flagship feature (serves: mission promise directly).
