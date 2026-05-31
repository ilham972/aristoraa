# W.2 Handoff Prompt — Absence Alerts (paste this into a new Sonnet session)

> Copy everything below the `---` line into a fresh Sonnet session and send. Do NOT copy this header.

---

I want you to build **Phase W.2 — Absence alerts** for my Aristora math-tracker app. Phase W.1 (plumbing) is fully shipped and smoke-tested in production. The acceptance test (Register webhook → Send test → parent reply → bell badge → auto-ack) passed on the live site 2026-05-29. W.2 is the first real use case on top of that foundation.

## Read these files in order before writing any code

1. **`whatsapp_integration_plan.md`** at repo root — the complete Phase W spec. **It is gitignored because Section 17 has production secrets — never `git add -f` it, never paste its contents anywhere.** Most-relevant sections for W.2:
   - **Section 4.2** — the notification-driven trigger model (NO cron, ever)
   - **Section 5** — the human-mimic sender rules (35s–2min gap, quiet hours, caps, cooldown)
   - **Section 8.3 "Absence alert nudge"** — the inline UI in the existing Session Dialog
   - **Section 8.5 "Sibling merging"** — must-have: if two children share a phone, ONE merged message goes out
   - **Section 9 "Phase W.2"** — the scope summary
   - **Section 12** — things to AVOID (cron, blast loops, bypassing the provider chokepoint)
   - **Section 17** — live VPS + Open-WA credentials (don't write them to logs or commits)
2. **User memory** at `C:\Users\Ilham\.claude\projects\C--Users-Ilham-aaa-projects-math-tracker\memory\`:
   - `MEMORY.md` (index)
   - `project_phase_w_whatsapp.md` — recent status notes, gotchas (read in full — has the dev/prod deployment trap, the session UUID gotcha, and the locked decisions)
   - `feedback_ux_navigation.md` + `feedback_theme_preference.md`
   - `reference_build_typecheck.md` — backend typechecking is `npx convex codegen`, not root `tsc`
3. **The W.1 code as ground truth** for patterns to follow:
   - `convex/messaging/provider.ts` — the chokepoint. Every send goes through here.
   - `convex/messaging/queue.ts` — `internalDraftAndQueue` + `approveBatch` are how W.1 enqueues. Reuse them, do NOT add a parallel write path.
   - `convex/messaging/outbox.ts` — the human-mimic sender. Do NOT touch its pacing logic.
   - `convex/messaging/templates.ts` — variable contracts. Add new template variables here only if needed.
   - `convex/messaging/seedTemplates.ts` — `absence_alert` (ta + en) is already seeded. Adjust body wording only if user needs sibling-aware version (Section 8.5).
   - `convex/notifications.ts` — `postNotification` pattern. Use it for "1 absence alert pending" nudges.
   - `src/app/messaging/page.tsx` + sub-pages — UI patterns + theme conventions.
4. **The current attendance flow** — figure out where "absent" gets persisted today:
   - `convex/attendance.ts` — has `markPresent` mutation, likely `markAbsent` and others. Read all of it.
   - `convex/sessionRecords.ts` — Phase G additions for session-level state. Read it.
   - `src/app/session/[slotId]/[date]/page.tsx` — the existing per-session page (single slot legacy)
   - `src/components/session/attendance-tab.tsx` — single-slot attendance UI
   - `src/components/groups/attendance-tab.tsx` — newer group-centric attendance (Phase F). **This is likely the primary write path post-F.6.** Confirm which one the user actually opens in production.
   - `src/app/groups/page.tsx` — group hub
   - Any "Day view" / day-grid component (Phase G) that bulk-cancels — check whether it also touches absence

## W.2 working style (carries over from Section 14 of the plan)

- I'm a non-technical founder. Ship, verify, report. No tutorials.
- I want concrete pushback when I'm wrong. No sycophancy.
- **One sub-phase per chunk**, then ASK before moving to the next. Don't batch W.2.1+W.2.2+W.2.3 into one mega-commit.
- Mobile-first dark navy + teal. Tamil for parent-facing copy, English for internal/teacher.
- Never add emojis to code/files unless I ask.
- Typecheck before declaring done: `npx convex codegen` for backend, `tsc --noEmit -p tsconfig.json` for frontend.
- **Two Convex deployments exist:** dev (`qualified-alpaca-97`) and prod (`rapid-loris-309`). The user tests on **production** (the live Vercel site). After any code change for them to test live: `npx convex deploy -y`. After any new env var for them to test live: `npx convex env set --prod KEY value` AND `npx convex env set KEY value` (both). The Settings page "missing env vars" trap from W.1 was caused by setting env vars only on dev.

## W.2 hard requirements (non-negotiable — surface a question, don't deviate silently)

1. **Provider chokepoint preserved.** Every send still goes through `convex/messaging/provider.ts` via the existing queue. NO direct Open-WA REST calls from anywhere new.
2. **Notification-driven, not cron.** The trigger is the teacher marking a student "absent" — that's a human action. NO scheduled job that scans for absences. The user explicitly rejected cron in W.1 (Section 4.2 + 5 of the plan).
3. **Human-mimic delays preserved.** The sender is `processNext` self-chaining via `ctx.scheduler.runAfter`. Don't shortcut it for absence alerts.
4. **Dev-mode safety preserved.** `WHATSAPP_DEV_MODE=true` redirects every outbound `to` to `WHATSAPP_DEV_NUMBER` in `provider.ts`. Don't bypass this in the absence flow.
5. **Sibling merging is mandatory, not optional.** If two children of the same family (matched by normalized `parentPhone`) are both absent on the same day at the same slot OR across the same parent's slots that day, they must produce ONE merged message to that phone, not two. Implementation: group draft candidates by `phoneE164` before calling `internalDraftAndQueue`. The `absence_alert` template body may need an `{{student_names}}` list variable in addition to (or replacing) the current single `{{student_name}}`. If you change the template variable contract, update `convex/messaging/templates.ts` AND re-seed via the existing seed function (it's idempotent).
6. **Opt-out is respected.** If `parentContacts.optedOut === true` for the parent phone, no draft is created. Show a small inline indicator in the UI ("Opted out — not messaging") instead of the Send button.
7. **No duplicate sends per (student, slot, date).** If an absence alert was already queued/sent for the same (student, slotId, date), don't enqueue another. Either: (a) write a small "alert was sent" marker (new column on `attendance` like `absenceAlertQueuedAt`, OR a lookup on `messageLog` filtered by student+date+templateKey=`absence_alert`). Pick the simpler one and explain why in the commit message.

## W.2 acceptance test (what I'll click through after you ship)

On the live site, with `WHATSAPP_DEV_MODE=true`:

1. Open the existing session page (the one the user marks attendance on — figure out which screen this is in current code; the plan says `src/app/session/[slotId]/[date]/page.tsx` but post-Phase F it may now be a different route).
2. Mark one student "absent". An inline card appears under that student's row within ~1s: **"✉ Send absence alert to <ParentName>?"** with [Draft] and [Send now] buttons. If `parentContacts.optedOut === true`, the buttons are replaced with a muted "Opted out" indicator. If `students.parentPhone` is missing/invalid, the buttons are replaced with a muted "No parent phone on file" indicator.
3. Click [Send now] → status pill on the card changes to "Queued" → within 1–2 min the bot sends the Tamil absence alert to my personal phone (because dev mode) with `[DEV → orig +94...]` prefix.
4. Mark a SECOND student absent who **shares the same `parentPhone`** as the first (I'll set this up in advance). The inline card should now show **one merged draft** referencing both names ("Rahul + Priya missed today's M2 class"), not two separate cards. Send → one merged message arrives on my phone.
5. Mark a third student absent → click [Send now] → reload the page → mark that same student absent again (toggle off + back on) → inline card should show **"Already sent at HH:MM"** with no Send button. Dedup works.
6. Open `/messaging` → new **Today** tab shows all today's absences across centers, grouped by parent phone (sibling-merged). Bulk **"Send all"** queues everything not-already-sent in a single batch. Sender processes them with the normal 35s–2min spacing.
7. Open the Outbox — every absence alert appears with `templateKey=absence_alert`, `status=sent`, `batchId` set (groups them with the bulk send). Filterable.

## W.2 scope — what to build (proposed sub-phase split — push back if you want a different split)

- **W.2.1 — Backend draft + dedup** (1–2 hrs)
  - New mutation: `convex/messaging/absenceAlerts.ts` with:
    - `createDraftForAbsence({ studentId, slotId, date })` — looks up parent via `students.parentPhone` → `parentContacts` (normalized E.164), respects `optedOut`, dedup-checks against existing queue+log for same (studentId, date, templateKey), inserts a `messageQueue` row with `status="draft"` and a `batchId` tag of `absence-<date>`. Returns `{ status: "drafted"|"skipped"|"already-sent", queueId?: Id<"messageQueue">, reason?: string }`.
    - `siblingsForPhone({ phoneE164, date })` — returns all `studentId`s whose `parentPhone` normalizes to this number AND who are absent on this date (cross-slot OK). Used by the merging logic.
    - `approveAbsenceDrafts({ queueIds })` — wraps the existing `approveBatch` and kicks the outbox.
    - `recentForStudent({ studentId, date })` — returns the existing `messageQueue` row for dedup display, or null.
  - Template body update if needed: extend `absence_alert.ta` + `absence_alert.en` to handle `{{student_names}}` (singular today; future merging will use list). Keep variable contracts in `convex/messaging/templates.ts`.
  - Typecheck clean (`npx convex codegen`). Push to dev. Ask before W.2.2.
- **W.2.2 — Inline UI on the session/attendance page** (2–3 hrs)
  - Locate the current "mark absent" surface (check `src/components/session/attendance-tab.tsx` AND `src/components/groups/attendance-tab.tsx` — figure out which is in use post-Phase F).
  - Add a new component `src/components/messaging/AbsenceAlertNudge.tsx` that takes `{ studentId, slotId, date }` and renders the inline card per Section 8.3 of the plan. States: idle (Send/Draft buttons), opted-out, no-phone, drafted (Sent at HH:MM), sending (status pill).
  - Render the nudge inside the existing attendance row UI, only when the row's status is `absent`. Toggling back to `present` hides it (doesn't cancel queued — that's W.2.4 if needed).
  - Mobile-first, dark navy + teal.
  - Typecheck both `npx convex codegen` and `tsc --noEmit`. Push to dev. Ask before W.2.3.
- **W.2.3 — /messaging Today tab** (2–3 hrs)
  - Add a Today sub-route or tab in `/messaging`. Query: all today's `attendance` rows with `status="absent"`, joined to students + parentContacts. Group by `phoneE164` (sibling merging). For each group, show: parent display name, sibling names, draft body preview, current status, [Send] button.
  - "Send all" button enqueues every still-unqueued drafts in one batch, calls `approveBatch`, kicks outbox.
  - Use `feedback_ux_navigation.md` — inline filters, not drill-downs.
  - Mobile-first. Typecheck. Push to dev. Ask before W.2.4.
- **W.2.4 — Sibling merging end-to-end** (1–2 hrs)
  - Update W.2.1's `createDraftForAbsence` to look up siblings via `siblingsForPhone`. If 2+ students share the phone and are both absent today, the rendered body uses the multi-name template. Mutation must be idempotent — calling it for student B when student A's merged draft already exists updates the existing row to include B, doesn't insert a duplicate.
  - Show merging behavior in the inline UI (the second sibling's row shows "Included in merged alert with <Sibling>" instead of its own Send button).
  - Typecheck. Push to dev. Ask before W.2.5.
- **W.2.5 — Deploy to prod + smoke-test** (30 min, mostly user-driven)
  - `npx convex deploy -y` to push code to prod.
  - I (the user) walk through the acceptance test on live. You're on standby for fixes.
  - Once acceptance passes, write a single commit per sub-phase OR squash to one W.2 commit — match the W.1 commit style (one sub-phase per commit, plan-file-cited commit messages).

## What I need from you RIGHT NOW, before any code

1. Confirm you've read the plan file (cite 2–3 specific Section 5, 8.3, 8.5, or 17 facts so I know you actually read it).
2. Confirm you've read `project_phase_w_whatsapp.md` in memory (cite the dev/prod deployment trap + the session UUID gotcha).
3. Tell me which file the user actually marks absent on TODAY (check both legacy `src/components/session/attendance-tab.tsx` and the Phase F group-centric `src/components/groups/attendance-tab.tsx` — and any newer Day-view from Phase G). Don't guess. Read the code.
4. Surface any ambiguity in W.2's scope before writing. Specifically:
   - Dedup mechanism — new column on `attendance` vs `messageLog` lookup? Recommend one with the reason.
   - Whether to keep the single-student template body OR rename `{{student_name}}` → `{{student_names}}` (list) from the start. Recommend one.
   - What to do if the teacher unmarks "absent" after a draft was created but before it sent. (My take: leave the draft in place — the Outbox lets me cancel manually. But push back if you think auto-cancel is cleaner.)
5. Propose the smallest first slice (likely W.2.1 — backend only, no UI yet). Then **wait for my go-ahead**.

## Things I know will trip you up (do NOT learn these the hard way)

- **Convex queries CAN read `process.env`** — but the env vars must be set on the deployment your code is running against. Two deployments, two sets of env vars. (`npx convex env list` defaults to dev.)
- **The Open-WA session UUID rotates on QR re-scan.** `OPENWA_SESSION_ID` env var holds the UUID. The W.1 `getStatus` action matches by id-OR-name, so `aristora-prod` (the dashboard name) also works as a fallback — if a re-scan kills the UUID, use the name temporarily.
- **The Open-WA session is fragile** (logged out roughly every 1–4 weeks per plan §17.5, observed once on the first call). If your testing breaks the session, the user has to re-scan QR at `http://165.22.223.225:2886/`.
- **Browser caches Convex query results.** After deploying new code or new env vars, the user must HARD refresh (Ctrl+F5) or close+reopen the tab. Tell them explicitly when this is needed.
- **The Phase F migration may have moved the "mark absent" surface** from the slot-centric `/session/[slotId]/[date]` route to the group-centric `/groups` or Day-view. Read the actual code to find where the user clicks today. Don't assume.

When you're ready and have read everything, give me a numbered list of (a) the 5 things from the "RIGHT NOW" section above and (b) your proposed W.2.1 file list. Then wait.
