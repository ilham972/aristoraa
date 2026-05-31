# W.4 Handoff Prompt — Tomorrow's-class reminders (paste this into a new Sonnet session)

> Copy everything below the `---` line into a fresh Sonnet session and send. Do NOT copy this header. **Only paste this AFTER W.3's acceptance test has passed live.** If W.3 turned up bugs, fix them first.

---

I want you to build **Phase W.4 — Tomorrow's-class reminders** for my Aristora math-tracker app. Phases W.1 (plumbing), W.2 (absence alerts), and W.3 (manual broadcasts) are all shipped and live in production. W.4 is the evening routine: the Lead opens a page after dinner, sees a pre-built draft list of "tomorrow's parents to remind", reviews, sends. Drives attendance and gives parents one more touchpoint.

## Read these files in order before writing any code

1. **`whatsapp_integration_plan.md`** at repo root — the complete Phase W spec. **It is gitignored because Section 17 has production secrets — never `git add -f` it, never paste its contents anywhere.** Most-relevant sections for W.4:
   - **Section 4.2** — notification-driven trigger model (NO cron). W.4's trigger is the Lead opening `/messaging/tomorrow` and clicking Send.
   - **Section 5** — human-mimic sender rules. W.4 reuses the existing queue + sender unchanged.
   - **Section 7.4 (templates)** — `tomorrow_reminder` (ta + en) seeded in W.1 with vars `parent_name`, `student_name`, `module`, `start_time`, `bring_text`. Confirm both are present on dev AND prod; if missing on prod, apply the defensive seed pattern from W.2/W.3 (`seedTemplates:ensureXOnProdInternal` idempotent).
   - **Section 8.2 "Tomorrow" tab** — the UX target.
   - **Section 9 "Phase W.4"** — the original scope summary.
   - **Section 12** — things to AVOID (cron, blast loops, bypassing provider).
   - **Section 17** — live VPS + Open-WA credentials (don't log, don't commit).
2. **User memory** at `C:\Users\Ilham\.claude\projects\C--Users-Ilham-aaa-projects-math-tracker\memory\`:
   - `MEMORY.md` (index)
   - `project_phase_w_whatsapp.md` — **read in full.** Has the dev/prod deployment trap, deploy gotchas, all baked-in W.1/W.2/W.3 decisions (especially W.2's `(parentPhone, date)` sibling-merge identity which W.4 mirrors).
   - `project_phase_f_groups.md` — Phase F group-centric scheduling. **The roster resolution post-F.6 is: `scheduleSlots.groupId → groupMembers (current) ∪ slotStudents (legacy fallback for slots with no groupId).** Confirm by reading current `convex/scheduleSlots.ts` / `convex/groups.ts`.
   - `feedback_ux_navigation.md` (inline filters, no drill-down) + `feedback_theme_preference.md` (dark navy + teal).
   - `reference_build_typecheck.md`.
3. **The W.1 + W.2 + W.3 code as ground truth** for patterns to follow:
   - `convex/messaging/provider.ts` — chokepoint. W.4 sends contact-type messages only (parents, one phone each). No new provider methods needed.
   - `convex/messaging/queue.ts` + `internalDraftAndQueue` + `approveBatch` — reuse.
   - `convex/messaging/outbox.ts` — DO NOT touch.
   - `convex/messaging/templates.ts` + `seedTemplates.ts` — extend if you change template contract (see Hard Requirements #5 about template variable changes).
   - `convex/messaging/absenceAlerts.ts` — **pattern for "draft + dedup + sibling-merge + approve" mutations. Mirror this for `convex/messaging/tomorrowReminders.ts`.** Same `(parentPhone, date)` identity, same `batchId` strategy (use `tomorrow-<YYYY-MM-DD>` keyed to tomorrow's date in Asia/Colombo).
   - `convex/messaging/broadcasts.ts` (W.3) — pattern for `quietHoursCheck` pre-flight before bulk send. Reuse the same pre-flight on W.4's "Send all".
   - `src/app/messaging/today/page.tsx` (W.2) — **page layout pattern.** Mirror the structure: header → filter bar → grouped-by-parent draft list with per-row Send + top Send-all → confirm modal → outcome toast. Adapt for "tomorrow" semantics.
   - `src/app/messaging/page.tsx` — hub. Add a Tomorrow card alongside Today + Broadcasts.

## W.4 working style (carries over)

- I'm a non-technical founder. Ship, verify, report. No tutorials.
- Concrete pushback when I'm wrong. No sycophancy.
- **One sub-phase per chunk**, then ASK before the next.
- Mobile-first dark navy + teal. Tamil for parent-facing copy, English for internal.
- Never add emojis to code/files unless I ask.
- Typecheck: `npx convex codegen` for backend, `tsc --noEmit -p tsconfig.json` for frontend.
- **Two Convex deployments:** dev (`qualified-alpaca-97`) and prod (`rapid-loris-309`). I test on **production**. After any change for me to test live:
  - `git push origin master` (Vercel auto-builds frontend) — commit `_generated/api.d.ts` so Vercel build has current types.
  - `npx convex deploy -y` (Convex backend → prod).
  - Any new env var: `npx convex env set --prod KEY value` AND `npx convex env set KEY value`.
  - Any prod data migration / seed: `npx convex run --prod <fn>`. Use `internalMutation`/`internalQuery` twins because `npx convex run` has no Clerk identity.
  - **No "Outbox" page exists yet** (called out in W.3) — for any acceptance step that says "open the Outbox," I open `/messaging/settings` → recent activity instead, or check Convex dashboard `messageQueue` table directly. Don't build an Outbox page in W.4; that's a separate item.

## W.4 hard requirements (non-negotiable — surface a question, don't deviate silently)

1. **Provider chokepoint preserved.** Every send through `convex/messaging/provider.ts`. No new direct REST calls.
2. **Notification-driven, not cron.** The Lead opens `/messaging/tomorrow` (page-load triggers draft computation), reviews, clicks Send. **NO scheduled job that auto-drafts at 7pm.** Page-load-as-trigger is the only allowed pattern.
3. **Same queue, same sender, same pacing.** `messageQueue` rows with `templateKey="tomorrow_reminder"`, `toType="contact"`, `batchId="tomorrow-<YYYY-MM-DD>"`.
4. **Sibling merging mandatory.** Identity is `(parentPhone, tomorrowDate)`. Two kids with the same `students.parentPhone` (E.164-normalized) → ONE merged message. Pattern matches W.2's `upsertAbsenceDraft` — read it before writing. The merged body must enumerate each child's class details (e.g. "Rahul has M3 at 4pm and Priya has M2 at 3pm tomorrow"). NOT "your children have class tomorrow."
5. **Template variable contract — propose, don't silently change.** Today's seeded vars are `parent_name`, `student_name`, `module`, `start_time`, `bring_text`. For sibling merging you'll need either (a) `student_lines` (a pre-rendered list of "<name> has <module> at <time>") or (b) keep individual vars and disallow merging at the template level. **Recommend one with a reason before changing.** If you change the contract, follow W.2's pattern: rename in `templates.ts` AND write a `seedTemplates:ensureTomorrowTemplateV2Internal` idempotent migration that patches existing DB rows (the renderer is fail-loud — old rows will throw).
6. **Opt-out + missing-phone respected.** Parents with `parentContacts.optedOut === true` produce no draft (skip silently in the list). Students with no parseable `parentPhone` show a muted "No parent phone on file" row, no Send button.
7. **Off-days respected.** `students.offDays?: string[]` (lowercase weekday names like "sunday", "wednesday"). If tomorrow's weekday is in a student's offDays, skip that student. Don't message a parent that their child "has class tomorrow" when the child takes that day off.
8. **Cancelled slots excluded.** A `sessionLogs` row for `(slotId, tomorrowDate)` with `status="cancelled_by_tutor"` means no class tomorrow for that slot. Skip everyone enrolled in it. If ALL of a parent's children's slots are cancelled, no draft for that parent.
9. **Phase F roster resolution.** Tomorrow's slots come from `scheduleSlots.by_day(tomorrowWeekday)`. For each slot: if `scheduleSlots.groupId` is set, roster = `groupMembers.by_group(groupId)`. If unset (legacy slot), roster = `slotStudents.by_slot(slotId)`. There is likely a helper in `convex/scheduleSlots.ts` or `convex/groups.ts` already doing this resolution for the existing Day view — **find it and reuse it. Don't re-implement.**
10. **Dedup at batch level.** Re-clicking "Send all" after a partial send must NOT re-queue already-sent rows. Identity for skip: existing `messageQueue` row with same `batchId=tomorrow-<date>` AND same `toPhone` AND `status ∈ {queued, sending, sent}`. Show "Already queued/sent" on those rows in the UI.
11. **Quiet-hours pre-flight (reuse W.3's pattern).** If the Lead clicks Send between 9pm and 7am, warn that messages will deliver at 7am tomorrow morning — and that's PROBABLY THE INTENDED USE because reminders are an evening routine. The warning should say "Looks fine for tomorrow morning delivery" rather than treating it as an error.
12. **Tomorrow date computed in Asia/Colombo, not UTC.** Convex runs in UTC. Compute `tomorrowDateInColombo()` by offsetting now() by +5:30 then adding 1 day, formatting `YYYY-MM-DD`. Put the helper in a shared spot if `today()` doesn't already exist (check `convex/lib/` or `src/lib/`); reuse if it does.

## W.4 acceptance test (what I'll click through after you ship)

On the live site, with `WHATSAPP_DEV_MODE=true`:

1. Open `/messaging/tomorrow`. Header shows "Reminders for [tomorrow's weekday], [date]". Subheader shows `{ totalParents, totalStudents, sessionsTomorrow, skippedOptOut, skippedNoPhone }` summary.
2. The body lists rows grouped by parent. Each row: parent display name + phone (last 4 digits), child names + each child's tomorrow class (module + start time), draft body preview, [Send] button.
3. If I set one of my test students' `offDays` to include tomorrow's weekday → reload → that student is excluded; if they were a parent's only child, the parent row disappears.
4. If I mark a tomorrow slot `cancelled_by_tutor` via `sessionLogs` → reload → students of that slot are excluded; if that was their only class, parent row disappears.
5. Two students sharing a `parentPhone` BOTH having class tomorrow → ONE merged row, body enumerates both names + times.
6. Click [Send] on one row → status pill changes to "Queued" → within 1–2 min (daytime) my personal phone receives the Tamil reminder with `[DEV → orig +94...]` prefix.
7. Reload → that row shows "Sent at HH:MM" with no Send button (dedup).
8. Top of page: [Send all] button. Click → confirm modal showing "Send to N parents (M skipped already-sent)". Confirm → queue fills, spaced 35s–2min apart.
9. Verify via `/messaging/settings` → recent activity: rows with `templateKey="tomorrow_reminder"`, `batchId="tomorrow-2026-05-30"` (or whatever tomorrow is when I test), `status="sent"`.
10. Evening test: click Send between 9pm–7am → pre-flight modal says "Will deliver tomorrow from 07:00 — that's fine for a morning reminder" → I confirm → rows go to queue with `scheduledNotBefore = tomorrow 07:00`.

## W.4 scope — proposed sub-phase split (push back if you want a different split)

- **W.4.1 — Backend: tomorrow-roster resolution + draft mutations** (2–3 hrs)
  - **Find or write `tomorrowDateInColombo()` helper** — single source of truth; reuse if it exists (likely in `src/lib/types.ts` or `convex/lib/dates.ts`).
  - **Find or write `rosterForSlotAndDate(slotId, date)` helper** — must exist somewhere given Phase F + G shipped. Resolves `groupMembers` (new path) ∪ `slotStudents` (legacy fallback). Reuse it.
  - **New `convex/messaging/tomorrowReminders.ts`:**
    - `previewTomorrow({ /* no args; uses tomorrowDateInColombo */ })` — query, returns the full grouped-by-parent draft list with summary stats. Per-parent group includes: `parentContactId`, `phoneE164`, `displayName`, `students: [{ id, name, slotId, moduleId, startTime }]`, `bodyPreview`, `existingQueueRowId?`, `existingStatus?`. Honors all filters: offDays, cancelled slots, opt-out, missing-phone.
    - `upsertTomorrowDraft({ parentContactId, students: [{ id, slotId, moduleId, startTime }] })` — idempotent mutation. If a `messageQueue` row exists for `batchId=tomorrow-<date>` AND `toPhone=this`, update body; else insert with `status="draft"`. Mirrors W.2's `upsertAbsenceDraft`.
    - `approveTomorrowBatch({ batchId, includeAlreadyDrafted: bool })` — wraps `approveBatch`, filters out already-sent. Returns `{ queued, alreadySent, deferredToMorning }`.
    - `quietHoursPreflight({ at })` — re-use W.3's `quietHoursCheck` if exported; if not, compose it.
  - **Defensive seed** `seedTemplates:ensureTomorrowReminderOnProdInternal` — idempotent insert/heal for `tomorrow_reminder` (ta + en) on whichever deployment doesn't have it.
  - Typecheck `npx convex codegen`. Push to dev `npx convex dev --once`. Ask before W.4.2.

- **W.4.2 — `/messaging/tomorrow` page** (2–3 hrs)
  - New page `src/app/messaging/tomorrow/page.tsx`. Mirror layout of `src/app/messaging/today/page.tsx` line for line where feasible.
  - Header: "Reminders for {weekday}, {date}" + summary chips (totalParents / sessionsTomorrow / skipped breakdown).
  - Filter bar: optional center filter (default: all centers), optional grade filter. Inline (no drill-down, per `feedback_ux_navigation.md`).
  - Body: parent-grouped draft cards, each with body preview, per-card Send. Quiet-hours / opt-out / no-phone surfaced inline.
  - Top: "Send all" with confirm modal + quiet-hours warning when applicable.
  - Empty state: "No reminders to send tomorrow — all opted out, off-day, or cancelled" with breakdown.
  - Mobile-first dark navy + teal.
  - Add a Tomorrow card to `/messaging` hub.
  - Typecheck. Push to dev. Ask before W.4.3.

- **W.4.3 — Deploy to prod + smoke-test** (30 min, mostly user-driven)
  - Commit `_generated/api.d.ts`.
  - `git push origin master`.
  - `npx convex deploy -y`.
  - `npx convex run --prod seedTemplates:ensureTomorrowReminderOnProdInternal`.
  - I walk through the 10-step acceptance test. You're on standby for fixes.

## What I need from you RIGHT NOW, before any code

1. Confirm you've read the plan file (cite 2–3 facts from Sections 5, 7.4, 8.2, or 17).
2. Confirm you've read `project_phase_w_whatsapp.md` in memory (cite the W.2 sibling-merge identity decision + the deploy gotchas + the W.3 "no Outbox" note).
3. Tell me what helpers already exist for `tomorrowDate` AND for "resolve roster for a slot on a date" — search the codebase. Don't re-implement.
4. Tell me whether `tomorrow_reminder` exists in BOTH `messageTemplates` on dev AND on prod. Use `npx convex run messaging/seedTemplates:listInternal` (or write a tiny internal listing query if none exists) to check. If missing anywhere → W.4.1 must include defensive seed.
5. Surface scope ambiguities. Specifically:
   - **Template contract change.** Recommend: keep `student_name`+`module`+`start_time` for single-child case; add `student_lines` (pre-rendered "Rahul has M3 at 4pm\nPriya has M2 at 3pm") and use a sibling-aware body that picks at render time. Or your alternative — explain trade-off.
   - **Time format.** `scheduleSlots.startTime` stored as `"HH:MM"` 24-hour. Render as "4:00 PM" (US-style) or "4.00pm" (Sri Lanka-common) or 24-hour "16:00"? Default: "4.00pm" matches local convention, but ask me before committing.
   - **`bring_text` variable.** Today seeded as "{{bring_text}}" but there's no per-class "bring your Grade 8 textbook" data source. Either drop the var entirely from the template OR derive a fallback like "Bring your usual class materials." Recommend.
   - **Filter defaults.** Should the Tomorrow page default to today's lead-assigned center, or all centers? (My take: all centers, founder filters down.)
6. Propose the smallest first slice (probably W.4.1 backend only — no UI). Then **wait for my go-ahead.**

## Things to know about (do NOT learn the hard way)

- **Date math in Convex actions runs in UTC.** Always compute "tomorrow in Sri Lanka" by offsetting +5:30 from `Date.now()` then adding 1 day, then formatting `YYYY-MM-DD`. Reuse the existing helper if found.
- **`students.offDays`** is optional and defaults to `["sunday"]` per the sheet planner convention (per memory). Treat undefined as `["sunday"]`.
- **`scheduleSlots.dayOfWeek`** is `0..6` with `0=Sunday`. Convert tomorrow's JS `Date#getDay()` accordingly.
- **Phase F migration:** new groups write `scheduleSlots.groupId`; old slots may not have it. Resolver must handle both.
- **Browser caches Convex query results.** After any deploy + env-var change, tell me to Ctrl+F5.
- **Open-WA session UUID can rotate on QR re-scan.** `OPENWA_SESSION_ID` env var holds the UUID; `aristora-prod` (the dashboard name) is a fallback.
- **The Open-WA session is fragile.** If testing breaks it, I re-scan at `http://165.22.223.225:2886/`.
- **`npx convex run` has no Clerk identity** — use `internalMutation`/`internalQuery` twins for any CLI-runnable seed / smoke-test.

When you're ready and have read everything, give me a numbered list of (a) the 6 things from the "RIGHT NOW" section above and (b) your proposed W.4.1 file list. Then wait.
