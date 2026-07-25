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
  management (textbooks, pastPapers modules). Tabs: General, Content, Book,
  Details, Tags, Data Entry. (Curriculum tab UI removed 2026-07-15 —
  superseded by the Book tab; `exercises` backend data untouched. Standalone
  `/curriculum` route still exists.)
- Top-level "Book" tab (2026-07-13): replaces the Exercises + Page Nos
  Data-Entry layers (`book-tab.tsx` hosts `book-entry-view.tsx`) — whole
  uploaded book scrolls inline (small thumbnails via
  `textbookPages.listSmallPages`), unit pills show two dots
  (pages/exercises; amber partial, green complete), Mark start/end grabs
  the on-screen page, one Save logs pages + exercise count (+review), then
  auto-advances with next start prefilled (prev end + 1). Full-screen
  toggle = fixed overlay + bottom nav hidden (NavVisibility); shares the
  selected-book sessionStorage key with Data Entry. Rev toggle works on
  units that ALREADY have exercises (not just new ones): Save reconciles via
  `exercises.setReview` — adds/removes the `N.0` review row (untoggle also
  deletes its scoring entries). (2026-07-13 fix)
- Top-level "Details" (Studio) tab (2026-07-25): one-screen rebuild of the
  Data Entry → Details layer (`details-studio-tab.tsx` + `studio-crop-view.tsx`
  + `studio-entry-bar.tsx`). Unit pills → exercise/theory pills → viewer →
  sticky thumb-reach bar. Browse mode = unit pages inline (pinch-zoom,
  current-page badge) with From/To marked off the on-screen page, tap-grid
  question count, Parts drawer (reuses `SubQuestionInline`), theory rows
  added/renamed/deleted in place. Crop mode hosts the per-exercise fast-crop
  flow INLINE (same PageCropOverlay / CropPillHeader / ZoomedPageView, same
  1:1 (exercise,key) upsert) with the key pills moved to the bottom bar;
  drawing auto-advances key → key, then exercise → exercise, then unit → unit.
  ADDITIVE: the old Data Entry tab + `/settings/crop` route stay live until
  the founder retires them. `exercises.addConcept` now returns the new id.
- `/settings/crop/[unitId]` + `/settings/past-paper-crop/[paperId]` — the
  question-cropping workbenches that feed the question bank (the engine's
  raw material). Crop validation: `learningEngine/cropIntegrity.ts`.
- "Tags" tab (`tags-tab.tsx` + `tag-detail-drawer.tsx`): exam topic tags →
  linked curriculum units → concepts grouped by grade. Tapping a concept
  opens the **Topic Journey reader** (`topic-journey-reader.tsx`,
  2026-07-14): full-screen overlay ABOVE the drawer (closing lands back in
  it) — grade-ordered concept strip (G6→G11, unmarked concepts greyed), the
  concept's marked book pages (thumbnails via
  `textbookPages.getSmallPagesByGradeRange`; tap a page = pinch-zoom
  full-res via ZoomedPageView with crops off), Prev/Next + "Next concept"
  card to read one topic across grades as a continuous story.

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
