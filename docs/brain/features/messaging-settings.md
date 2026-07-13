# Messaging, settings & app shell

## /messaging — WhatsApp parent-communication hub (Phase W — BUILT)
Hub home links 8 sections: settings (bot connection, send test, webhook,
opt-outs), inbox (parent replies), today (absence alerts + due sends),
tomorrow (reminders), outbox (queue/log), broadcasts, templates, weekly-cards.
Backend `convex/messaging/` (~22 modules): outbox.ts is the workhorse;
absenceAlerts, tomorrowReminders, weeklyCards, broadcasts, inbound/inbox,
contacts, recipients, policy (opt-out/quiet-hours), queue, templates(+Admin),
groupsWa, sessionStatus, connectWebhook.

**Provider chokepoint** (`convex/messaging/provider.ts`): ALL outbound
WhatsApp goes through getProvider() — Open-WA REST today, swappable to Meta
Cloud API by replacing one file. No caller may hit the API directly.
**Dev-mode safety:** `WHATSAPP_DEV_MODE=true` (default) rewrites every
recipient to `WHATSAPP_DEV_NUMBER` at the provider layer with a "[DEV → orig]"
prefix — no accidental real-parent sends. Spec: whatsapp_integration_plan.md
(root; its gitignored Section 17 holds infra credentials). The Open-WA gateway
runs on a DigitalOcean droplet and W.1–W.5 are shipped to prod (2026-05-30).
Remaining: founder acceptance tests, and a DATA blocker — students'
parentPhone is empty on prod (normalize via /messaging/settings button).
**NO cron jobs in messaging BY DESIGN** — every batch is human-triggered;
human-mimic pacing via scheduler self-chaining inside a triggered batch.
Sessions drop to qr_ready often — re-scan QR at the gateway dashboard.
Tables: parentContacts, studentParents, whatsappGroups, messageTemplates,
messageQueue, messageLog, conversations.
Near-duplicate modules: `sendTest.ts` is WIRED, `testSend.ts` is DEAD.

## Notifications (`convex/notifications.ts`)
In-app notification feed + the exam-approaching daily alert (cron) surfaced
by the bell in the bottom nav (`src/components/navigation.tsx`). Exam mode
itself is the manual `examModeActive` switch (see learning-engine.md).

## /settings + crop tools
- `/settings` — app config (`convex/settings.ts`), textbook/past-paper
  management (textbooks, pastPapers modules).
- Data Entry sub-tabs (2026-07-13): old Exercises + Page Nos merged into one
  "Book" tab (`book-entry-view.tsx`) — whole uploaded book scrolls inline
  (small thumbnails via `textbookPages.listSmallPages`), unit pills show two
  dots (pages/exercises; amber partial, green complete), Mark start/end grabs
  the on-screen page, one Save logs pages + exercise count (+review), then
  auto-advances with next start prefilled (prev end + 1).
- `/settings/crop/[unitId]` + `/settings/past-paper-crop/[paperId]` — the
  question-cropping workbenches that feed the question bank (the engine's
  raw material). Crop validation: `learningEngine/cropIntegrity.ts`.

## App shell
- `src/components/navigation.tsx` — bottom nav (transit-app aesthetic, dark
  navy + teal — founder's locked-in theme, feedback_theme_preference).
  `/notifications` page hosts the bell's feed.
- `src/components/auth-layout.tsx` — renders an instant ShellSkeleton while
  Clerk verifies (never a blank screen — perf phase 2). Skeleton is visual
  only: no queries, no real nav.
- `public/sw.js` — PWA worker: cache-first for /_next/static (immutable),
  network-first for navigations, stale-while-revalidate for the rest;
  cross-origin (Clerk/Convex) NEVER intercepted. Bump CACHE_NAME on change.
- `src/app/more/page.tsx` — overflow menu to secondary pages.
- `src/contexts/`, `src/hooks/` — app-wide state/helpers.
- Auth: Clerk (`/sign-in`, `src/middleware.ts`, `convex/auth.config.ts`).
- `convex/http.ts` — HTTP endpoints (incl. messaging webhook inbound).

## Manual tools (no UI callers BY DESIGN — run via `npx convex run`)
`convex/seed.ts`, `convex/seeds/*` (paperStructures, topicTags),
`convex/migrations.ts`, `convex/groupMigration.ts` (Phase F data migration,
pending F.7), `learningEngine/backfill.ts` (track seeding, founder-gated).
