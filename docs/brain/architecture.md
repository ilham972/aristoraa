# Architecture — stack, folders, routes, commands

## Stack
- **Next.js 16** (App Router) + **React 19**, TypeScript.
- **Convex** — database + backend functions (queries/mutations/actions). Schema:
  `convex/schema.ts` (51 tables — the single source of truth for all data).
- **Clerk** — authentication (`src/app/sign-in`, `convex/auth.config.ts`).
- **Tailwind + shadcn/Base UI** (`src/components/ui` = generated primitives,
  treat as library code), lucide icons, sonner toasts, vaul drawers.
- **PDF**: pure-JS `pdf-lib` (+fontkit) for sheet rendering/clipping,
  `pdfjs-dist` for viewing (lazy-loaded, settings content-tab only). `sharp`
  is a devDependency only — used by icon scripts, never at runtime.
- **Tests**: vitest (pure logic) + convex-test (DB integration), in `tests/`.

## Folder map
- `src/app/<area>/page.tsx` — pages (routes listed below).
- `src/components/<area>/` — components per area; root-level files = shared/shell.
- `src/lib/` — pure client logic (no React): scoring, sheets, groups, curriculum.
- `src/contexts/`, `src/hooks/` — app-wide state and helpers.
  `hooks/use-cached-query.ts` — drop-in useQuery replacement: persists last
  result to localStorage, renders it instantly, live data replaces it (the
  native-feel layer; used on /groups, /students and all session tabs).
- `convex/<module>.ts` — backend, one module per domain (students, groups, …).
- `convex/learningEngine/` — the planner/SR/mastery/tracks engine (the moat).
- `convex/messaging/` — messaging hub backend.
- `convex/lib/` — direct-import helpers (roster, slotMerge, phone, …).
- `convex/seeds/`, `convex/seed.ts`, `convex/migrations.ts` — manual tools run
  via `npx convex run`; zero UI callers by design.
- `scripts/` — build-time utilities (font install).
- Root `*.md` — plan documents; triage in decisions.md. NEVER delete
  `learning_engine_plan.md` or `algorithm_plan.md`.

## Routes (30)
- `/groups` — main daily screen: timetable, sessions, attendance.
- `/session/[slotId]/[date]` — in-session workspace: sheets + scoring tabs.
- `/algorithm` + `/blueprint` `/coverage` `/exam-calendar` `/scoring` — learning
  engine control panels.
- `/leaderboard` + `/leagues`, `/progress`, `/curriculum` — progression views.
- `/analytics`, `/timeline/compare`, `/timeline/student/[id]` — dashboards.
- `/students`, `/students/[id]/mastery` — roster + per-student mastery.
- `/messaging` + 8 subpages (today, tomorrow, inbox, outbox, broadcasts,
  templates, weekly-cards, settings) — messaging hub.
- `/settings` + `/crop/[unitId]` + `/past-paper-crop/[paperId]` — config + PDF
  crop tools. `/more`, `/notifications`, `/sign-in/[[...sign-in]]` — shell/auth.

## Data flow (typical)
page.tsx → `useQuery/useMutation(api.<module>.<fn>)` → convex module →
tables in schema.ts. Components never talk to Convex except via generated `api`.

## Commands & gotchas
- `npm run dev` — Next dev; `npx convex dev` — backend dev sync.
- **Root `tsc` SKIPS `convex/`** — typecheck backend with `npx convex codegen`.
- `npm test` — vitest. Deploy backend: `npx convex deploy` (prod is live!).
- `npx knip` — unused-code scan (config: `knip.json`).
- Founder workflow rule: always commit AND push after a change; never ask.
