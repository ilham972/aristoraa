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
(root). The external Open-WA gateway is a separate server process; hub
features only deliver for real when it is running + connected (see
/messaging/settings connection status). Human-mimic send pacing per spec.
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
- `/settings/crop/[unitId]` + `/settings/past-paper-crop/[paperId]` — the
  question-cropping workbenches that feed the question bank (the engine's
  raw material). Crop validation: `learningEngine/cropIntegrity.ts`.

## App shell
- `src/components/navigation.tsx` — bottom nav (transit-app aesthetic, dark
  navy + teal — founder's locked-in theme, feedback_theme_preference).
- `src/app/more/page.tsx` — overflow menu to secondary pages.
- `src/contexts/`, `src/hooks/` — app-wide state/helpers.
- Auth: Clerk (`/sign-in`, `src/middleware.ts`, `convex/auth.config.ts`).
- `convex/http.ts` — HTTP endpoints (incl. messaging webhook inbound).

## Manual tools (no UI callers BY DESIGN — run via `npx convex run`)
`convex/seed.ts`, `convex/seeds/*` (paperStructures, topicTags),
`convex/migrations.ts`, `convex/groupMigration.ts` (Phase F data migration,
pending F.7), `learningEngine/backfill.ts` (track seeding, founder-gated).
