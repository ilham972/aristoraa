# Legacy map — dead/unwired code with verdicts

**Nothing here has been deleted. This is a map, not an action.** Evidence:
`docs/brain/_audit/` (knip report + convex usage traces, 2026-06-12).
Verdicts: SAFE-DELETE (zero refs, no data risk) · FOUNDER-DECIDES (unwired
but may hold wanted ideas) · TRANSITION (dual-running by design) · KEEP
(false positive / manual tool).

## Frontend files (knip: imported by nothing)
| Path | Verdict | Why |
|---|---|---|
| src/components/groups/attendance-tab.tsx | SAFE-DELETE | analytics moved to /analytics |
| src/components/sheets/inspector-drawer.tsx | SAFE-DELETE | pre-merge sheets UI |
| src/components/sheets/inspector-body.tsx | SAFE-DELETE | pre-merge sheets UI (826 lines) |
| src/components/sheets/student-row.tsx | SAFE-DELETE | pre-merge sheets UI |
| src/components/sheets/bulk-actions.tsx | SAFE-DELETE | pre-merge sheets UI |
| src/components/sheets/summary-strip.tsx | SAFE-DELETE | pre-merge sheets UI |
| src/components/top-header.tsx | SAFE-DELETE | old shell; bottom nav is current |
| src/components/position-dialog.tsx | SAFE-DELETE | old position system |
| src/lib/store.ts | SAFE-DELETE | old position system |
| src/lib/phone.ts | SAFE-DELETE | superseded by convex/lib/phone.ts |
| src/components/learning/student-league-card.tsx | FOUNDER-DECIDES | league UI draft — may want when tracks go primary |
| src/components/flag-toggle.tsx | FOUNDER-DECIDES | generic flag UI draft |
| src/components/pinch-zoom-area.tsx | FOUNDER-DECIDES | zoom draft — maybe for crop/sheet view |
| src/components/settings/past-paper-pill-header.tsx | SAFE-DELETE | superseded crop UI piece |

## Convex modules (zero real callers)
| Path | Verdict | Why |
|---|---|---|
| convex/sessionSubmissions.ts | SAFE-DELETE* | superseded by learningEngine scoring (*table may hold old data — export first) |
| convex/studentModulePositions.ts | SAFE-DELETE* | superseded by path/tracks (*same data caveat) |
| convex/messaging/testSend.ts | SAFE-DELETE | dead twin of wired sendTest.ts |
| convex/lib/naming.ts | SAFE-DELETE | unused twin of src/lib/groups/naming.ts |
| convex/groupMigration.ts | KEEP | Phase F.7 migration tool, still pending |
| convex/learningEngine/backfill.ts | KEEP | needed for founder-gated track seeding |
| convex/seed.ts, convex/seeds/*, convex/migrations.ts | KEEP | manual `npx convex run` tools |

## Transition (dual-running BY DESIGN — touch only via the gate)
- /leaderboard + /progress + src/lib/scoring.ts (legacy points) vs track
  model — until LEADERBOARD_PRIMARY flips (tracks-leaderboard.md).
- Old scheduling-tab code (Phase F.6–F.8 pending) — retire after migration.

## Unused exports inside LIVE files (clean opportunistically)
src/lib/scoring.ts (12), src/lib/sub-questions.ts (7), src/lib/types.ts
(weekday-module era), src/lib/groups/time-grid.ts (3), sheets/filters-bar.tsx
(FiltersBar), session-workspace.tsx (2), shared.ts, scope.ts, curriculum-data
(getAllUnitIds), groups/color.ts (GROUP_PALETTE_SIZE).

## Dependencies (package.json)
| Dep | Verdict | Why |
|---|---|---|
| sharp | SAFE-DELETE | abandoned for pdf-lib (decisions.md) |
| html2canvas | FOUNDER-DECIDES | old leaderboard-image era; unused now |
| shadcn, tw-animate-css, uuid, @types/uuid | SAFE-DELETE | unreferenced |
| tailwindcss (devDep) | KEEP | knip false positive (PostCSS pipeline) |

## Cleanup ground rules (when founder approves a cleanup phase)
Delete in small commits, run `npm run build` + `npm test` + `npx convex
codegen` after each, never touch TRANSITION rows, export any convex table
before deleting its module, and update this map + findings as you go.
