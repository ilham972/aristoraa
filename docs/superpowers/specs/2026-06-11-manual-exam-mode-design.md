# Manual exam mode + bottom-nav notifications — design

Date: 2026-06-11
Status: approved (brainstorming) — pending spec review

## Problem

The sheet planner auto-enters "exam-week mode" whenever any exam for a
student's grade is within `EXAM_WEEK_DAYS` (14) days (`determinePhase` in
`convex/learningEngine/planner.ts`). In that mode the Main block stops walking
the normal teaching order and instead locks to the exam term, ranked by score.

Root cause of the founder's complaint (verified against live prod data
2026-06-11): an `examCalendar` row `G10 T2 examDate=2026-06-12` silently put
every G10 student into exam-week mode, so Main blocks were locked to a Term-2
unit ("Algebra, Graphs & Matrices" / the "graph" unit) and Term-1 / Path edits
had no effect.

The founder wants exam mode to be **manual** (an explicit switch they flip),
with a **reminder** when an exam is approaching so they decide when to turn it
on. Separately, the notification bell should move from the top-right corner
into the **bottom navigation** as a standard notifications page.

## Scope (3 pieces)

### Piece 1 — Exam mode becomes a manual per-exam switch

**Behavior:** The planner enters exam-week mode for a student **only when the
matched upcoming exam row has its switch ON** — never from the 14-day window.
When OFF, sheets follow the normal teaching/track order (Term-1 returns).
Everything else about exam-week behavior is unchanged when ON.

The exam *date* stays in the calendar and continues to drive the gentler,
non-locking signals (D.2 proximity scoring, D.5 exam-date backstop, C.2
retention debt). Only the disruptive term-lock (`examWeekMode`) is gated.

**Schema** (`convex/schema.ts`, `examCalendar` table):
- Add `examModeActive: v.optional(v.boolean())`. Absent/undefined = OFF.

**Backend** (`convex/learningEngine/calendar.ts`):
- Add mutation `setExamMode({ id, active })` — patches `examModeActive`. Auth
  required (same as other mutations here).
- `upsert` / `updateById` leave `examModeActive` untouched (don't reset it on
  an unrelated edit).

**Planner** (`convex/learningEngine/planner.ts`, `determinePhase`):
- `determinePhase` already finds `next` = earliest upcoming exam at the grade.
  Carry `examModeActive` onto `next`.
- Replace the trigger `if (daysToExam <= EXAM_WEEK_DAYS)` with
  `if (next.examModeActive === true)` for the exam-week branch. Keep the
  early/late-term ratio buckets (still based on `daysToExam`) exactly as they
  are; only the exam-week override changes.
- `EXAM_WEEK_DAYS` stays in config — it is now only used by Piece 2 (the
  reminder threshold).

**UI** (`src/app/algorithm/exam-calendar/page.tsx`):
- Each exam row gets an **"Exam mode" on/off switch** wired to `setExamMode`.
- Show an inline hint when an exam is within `EXAM_WEEK_DAYS` and the switch is
  still off (mirrors the reminder).

### Piece 2 — "Exam approaching" reminder in the bell

**Trigger:** a daily Convex cron (new file `convex/crons.ts`) → an internal
mutation `internal.examAlerts.scanAndNotify`.

**`convex/examAlerts.ts` — `scanAndNotify` (internalMutation):**
- For each `examCalendar` row where `examDate` is between today and
  today+`EXAM_WEEK_DAYS` (inclusive) AND `examModeActive !== true`:
  - Build a dedupe key from `payload = { examCalendarId, examDate }`.
  - Skip if an **unactioned** notification of `type = "exam_mode_suggest"`
    already exists for that `examCalendarId` (query the recipient's rows or a
    small scan; dedupe so it posts once, not daily).
  - Otherwise post via `internal.notifications.postNotification` to each
    recipient:
    - `type: "exam_mode_suggest"`, `priority: "high"`
    - `title`: e.g. `"Exam mode suggested — G10 Term 2"`
    - `body`: `"G10 Term 2 exam is in N days. Turn on Exam mode to focus sheets on the exam."`
    - `actionUrl: "/algorithm/exam-calendar"`
    - `payload: { examCalendarId, grade, term, examDate }`
- **Recipients:** all teachers with `role` `"lead"` or `"admin"` (from the
  `teachers` table), posted to each `clerkUserId`.
- Naturally self-resolves: once the founder turns the switch on, the row is
  skipped; once the date passes, it falls out of the window.

**Cron cadence:** once daily (e.g. 06:00 UTC). Exact hour is not critical.

### Piece 3 — Notification bell → bottom navigation + page

**Remove** the top-right bell: delete the `fixed top-3 right-3` wrapper +
`<NotificationBell/>` in `src/components/auth-layout.tsx`.

**Bottom nav** (`src/components/navigation.tsx`):
- Add a nav item `{ href: '/notifications', label: 'Alerts', icon: Bell }`
  (lucide `Bell`). Visible to everyone (notifications are per-user).
- Decision: **add it as an 8th item** (founder chose option a). Lead/admin
  accounts will see 8 items; plain teachers fewer.
- Render the **unseen-count badge** on the Alerts item only: a small red dot /
  count fed by `api.notifications.unseenCount` (the only item with a badge, so
  special-case it rather than generalizing `NavItem`).

**New page** (`src/app/notifications/page.tsx`):
- Full-page notifications list. Reuse the existing row rendering from
  `NotificationBell` by extracting a shared `NotificationList` component
  (title, body, priority dot, time-ago, `actionUrl` link, click→`markSeen`).
- Header with "Notifications" + "Mark all seen" (`markAllSeen`).
- Empty + loading states.

**`NotificationBell.tsx`:** keep the file only if still referenced; after
removal from `auth-layout` it is unused → delete it, moving its list-row markup
into the shared `NotificationList` used by the page. (Grep for other importers
first.)

## Out of scope / unchanged

- Proximity scoring, D.5 backstop, retention-debt, exam-score predictor — all
  keep using `examDate` automatically. Only the term-lock is manual.
- No change to how notifications are stored, marked seen, or queried beyond the
  new `exam_mode_suggest` type and the shared list component.
- No new roles/permissions.

## Verification

- `npx tsc --noEmit` (frontend) + `npx convex codegen` (backend) clean.
- Manual: with a `G10 T2` exam row dated within 14 days and switch **off**,
  generating a G10 sheet yields a normal Term-1-first Main block; flipping the
  switch **on** reproduces today's exam-term-locked behavior.
- The daily scan posts one `exam_mode_suggest` to lead/admin accounts, visible
  on the new `/notifications` page and badged on the bottom-nav Alerts item;
  turning the switch on stops further posts; tapping the alert opens the exam
  calendar.
- Top-right bell is gone; bottom nav shows the Alerts item with the unread
  badge.

## Key risks

- **Dedupe correctness** — must post once per exam, not every daily run. Keyed
  on `examCalendarId` + unactioned existing alert.
- **Recipient resolution** — confirm the `teachers` table role field values
  (`lead` / `admin`) and that each has a usable `clerkUserId`.
- **Planner regression** — ensure only the `examWeekMode` branch changes;
  early/late ratio buckets and all date-based scoring stay intact.
- **Nav crowding** — 8 items is tight on narrow phones (accepted for now).
