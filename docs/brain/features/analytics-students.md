# Analytics, timeline & students

## /analytics — 5-tab executive dashboard (Phase G, shipped)
`src/components/analytics/{pulse,students,finance,operations,growth}-tab.tsx`
(+ shared `ui.tsx`). All data from `convex/analytics.ts` server-side queries:
- **Pulse** — pulseSnapshot: today-at-a-glance.
- **Students** — studentsAtRisk, cohortRetention.
- **Finance** — lostRevenue, creditAging; revenue detail reuses
  `src/components/groups/revenue-tab.tsx` (lives in groups/ folder but serves
  analytics — moved surface, Phase G).
- **Operations** — capacityUtilization, cancellationBreakdown,
  attendanceInsights (sessionRecords).
- **Growth** — acquisitionByMonth.
This is the founder's "CEO view". Day-view bulk-cancel insights live here too.

## /timeline — module timelines
- `/timeline/student/[id]` — one student's journey (`api.timeline.byStudent`).
- `/timeline/compare` — multi-student comparison (`api.timeline.compare`).
Backend: `convex/timeline.ts`.

## /students — roster + per-student mastery
- `/students` — CRUD roster (`api.students.*`), grade assignment
  (`src/components/grade-assignment-dialog.tsx`). Cards are compact, no
  accordion: each shows name/chips, ONE overall progress % (per-module bars
  removed by founder request), the track picker, and all actions inline.
  Filter bar = one horizontally-scrollable row: search (name/school) + grade
  + center + track + sort (name/grade/lowest progress). Progress uses
  precomputed exercises-by-unit + entries-by-key maps (O(1)). parentPhone is
  optional — `students.add/update` validate it only when filled (empty stored
  as ""), and the form catches save errors as toasts.
- `/students/[id]/mastery` — per-student engine view built from
  `src/components/learning/student-mastery.tsx` (concept mastery) +
  `student-exam-outlook.tsx` (exam-readiness); engine data via
  `learningEngine/profile.ts` + `studentDashboard.ts`.

## Adjacent small modules
- **Doubts** (`convex/doubts.ts`) — flagged per question during scoring;
  resolved in session Lead tab. Sheet Mistakes section draws on these.
- **Leads** (`convex/lead.ts`) — live session roster/context feeding the
  Lead tab (`src/components/session/lead-tab.tsx`).
- **Centers/teachers** (`convex/centers.ts`, `teachers.ts`) — reference data;
  multi-center is the scaling path (purpose.md), today one real center.

## Notes & dead weight
- Analytics queries are proper server-side aggregations (scale-friendly) —
  unlike legacy /progress + /leaderboard which aggregate client-side.
- `src/components/top-header.tsx` — dead old shell header (knip); navigation
  is `src/components/navigation.tsx` (bottom nav, includes alert bell from
  exam-mode change).
- `src/components/flag-toggle.tsx`, `pinch-zoom-area.tsx` — unwired drafts.
