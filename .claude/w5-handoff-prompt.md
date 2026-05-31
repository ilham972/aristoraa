# W.5 Handoff Prompt — Weekly Cards (THE MOAT) + Inbox + Outbox + Templates editor (paste into new Sonnet session)

> Copy everything below the `---` line into a fresh Sonnet session and send. Do NOT copy this header. **Only paste this AFTER W.4's acceptance test has passed live.** This is the FINAL Phase W build — completes everything originally scoped for W.1–W.5 plus the operational UI items deferred during W.1.4 (Inbox, Outbox, Templates editor). After this, Phase W is feature-complete; remaining items (W.6 homework PDF / W.7 predicted-vs-actual / W.8 fee reminders + Tamil opt-out) are explicitly deferred — see "Explicitly DEFERRED" at bottom.

---

I want you to build the **final phase of Phase W** for my Aristora math-tracker app. Phases W.1 (plumbing) through W.4 (tomorrow's-class reminders) are all shipped and live in production. This phase completes everything originally scoped: **the Weekly performance card (the moat) + the three operational UI pages that were deferred during W.1.4 (Inbox, Outbox, Templates editor).**

After this ships, Phase W is feature-complete. W.6 (homework PDF auto-delivery) and W.7 (predicted-vs-actual exam reports) are explicitly deferred because they depend on learning-engine Phases B and A/F respectively, which haven't shipped. W.8 (fee reminders, doubt-queue notifications, leaderboard messages, Tamil opt-out keywords) is future polish.

## Read these files in order before writing any code

1. **`whatsapp_integration_plan.md`** at repo root — gitignored (Section 17 has production secrets). Most-relevant sections for this phase:
   - **Section 2** — the moat argument. Weekly card is THE reason this whole system exists.
   - **Section 4.1** — provider chokepoint. No new direct REST calls.
   - **Section 4.2** — notification-driven trigger (NO cron). Weekly cards too.
   - **Section 5** — human-mimic sender rules. Unchanged.
   - **Section 6** — reply handling design. **Inbox is the visible surface of this** — the conversations table, the per-thread view, the reply box.
   - **Section 7.2** — `conversations` + `messageLog` + `messageQueue` schemas. Inbox reads these. Outbox reads `messageQueue`.
   - **Section 7.4** — `weekly_card` template seeded with vars `parent_name`, `student_name`, `week_label`, `attended`, `total_sessions`, `points`, `rank_label`, `strong_module`, `weak_module`. Confirm both ta + en exist on dev AND prod; defensive-seed if missing.
   - **Section 8.2** — UX targets for Inbox, Outbox, Templates, Weekly Cards tabs.
   - **Section 9 "Phase W.5"** — original scope summary. **Recommends image rendering for shareability — see "W.5 — Weekly Cards" sub-phases below for the text-first / image-later split.**
   - **Section 9.2** — "First month: every weekly card requires explicit Send-all click; no scheduled job is allowed."
   - **Section 12** — things to AVOID.
   - **Section 17** — live VPS + Open-WA credentials.
2. **User memory** at `C:\Users\Ilham\.claude\projects\C--Users-Ilham-aaa-projects-math-tracker\memory\`:
   - `MEMORY.md` (index)
   - `project_phase_w_whatsapp.md` — **read in full.** Dev/prod deployment trap, deploy gotchas, ALL W.1/W.2/W.3/W.4 baked-in decisions, the "no Outbox yet" callout from W.3.
   - `project_phase_g_analytics.md` — Phase G analytics are SHIPPED. **Weekly card backend reuses those analytics queries — don't recompute.** Read it.
   - `project_phase_f_groups.md` — Phase F roster resolution.
   - `feedback_ux_navigation.md` (inline filters, no drill-down) + `feedback_theme_preference.md`.
   - `reference_build_typecheck.md`.
3. **W.1–W.4 code as ground truth** for patterns:
   - `convex/messaging/provider.ts` — chokepoint. Adding `sendMedia` for weekly-card-as-image is in scope ONLY if you ship W.5.4.b (image variant). For text-first weekly cards, no provider changes.
   - `convex/messaging/queue.ts` — reuse `internalDraftAndQueue`, `approveBatch`.
   - `convex/messaging/outbox.ts` — DO NOT TOUCH the sender. All four pages here drop into the existing queue.
   - `convex/messaging/templates.ts` + `seedTemplates.ts` — extend if you change `weekly_card` contract; defensive-seed on prod if needed (mirror W.2/W.3/W.4 pattern).
   - `convex/messaging/absenceAlerts.ts` (W.2) — `upsertDraft` + dedup pattern.
   - `convex/messaging/broadcasts.ts` (W.3) — `quietHoursCheck` pre-flight, multi-target batch pattern.
   - `convex/messaging/tomorrowReminders.ts` (W.4) — sibling-merge pattern, parent-grouped preview query.
   - `convex/messaging/inbound.ts` (W.1.3) — already writes inbound `messageLog` rows + upserts `conversations` + posts notifications. Inbox reads from this; don't re-route inbound writes.
   - `src/app/messaging/today/page.tsx` + `tomorrow/page.tsx` + `broadcasts/page.tsx` — page layout patterns. Mirror them.
   - `convex/analytics.ts` (Phase G) — **per-student weekly stats. The weekly card body fills from this.** Don't recompute attendance / points / module strength.

## Working style (carries over)

- Non-technical founder. Ship, verify, report.
- Honest pushback when I'm wrong.
- **One sub-phase per chunk**, ASK before next. This is the biggest phase by scope — DO NOT batch sub-phases.
- Mobile-first dark navy + teal. Tamil parent-facing, English internal.
- No emojis in code/files unless asked.
- Typecheck: `npx convex codegen` (backend), `tsc --noEmit -p tsconfig.json` (frontend).
- **Two Convex deployments:** dev (`qualified-alpaca-97`) + prod (`rapid-loris-309`). For me to test live: `git push origin master` + `npx convex deploy -y` + (if new env var) `npx convex env set --prod KEY value` AND `npx convex env set KEY value`. Commit `_generated/api.d.ts`. `npx convex run` has no Clerk identity — use `internalMutation`/`internalQuery` twins.

## Hard requirements (apply to EVERYTHING in this phase)

1. **Provider chokepoint preserved.** No direct Open-WA REST calls outside `provider.ts`.
2. **Notification/page-load triggers ONLY. NO cron.** Inbox replies are typed-and-clicked. Outbox actions are user-clicked. Weekly card drafts are computed on `/messaging/weekly-cards` page load.
3. **Same queue + same sender + same pacing for every outbound** including weekly cards + inbox replies.
4. **Dev-mode safety preserved.** Every outbound `to` still rewritten to `WHATSAPP_DEV_NUMBER` in `provider.ts` when `WHATSAPP_DEV_MODE=true`. Inbox replies + weekly cards must NOT bypass this.
5. **Quiet hours apply to weekly cards.** A Sunday-evening Send-all between 9pm and 7am defers to 07:00 Monday. UI warns (W.3 pattern).
6. **First-month manual rhythm** for weekly cards: every card goes through draft → review → send. No auto-rule that hits Send. This is a Section 9.2 hard rule.
7. **Defensive seeding on prod** for any template missing there (the pattern surfaced in W.2 and W.3).

---

## Sub-phase split (ship one at a time, ASK before next — do NOT batch)

### W.5.A — INBOX (small, foundational, ship first)

**Why first:** parents WILL reply to absence alerts (W.2) and tomorrow reminders (W.4). Today those replies surface only as notifications + a forward to my personal WA. There's no in-app thread view. Inbox is the proper home — and it's small (the schema + inbound write path already exist from W.1.3).

**W.5.A.1 — Backend: conversation reads + reply mutation** (1–2 hrs)
- New `convex/messaging/inbox.ts`:
  - `listConversations({ archived?: boolean, limit?: number })` — query, returns `conversations` rows sorted by `lastInboundAt desc`, joined with `parentContacts` (display name, language, optedOut) + best-guess primary student.
  - `getThread({ conversationId })` — query, returns the conversation row + `parentContact` + all `studentParents` joins (siblings) + last 100 `messageLog` rows for the conversation (inbound + outbound merged + chronological).
  - `markRead({ conversationId })` — mutation, sets `unreadCount=0`. Auto-called from the thread page on mount.
  - `archive({ conversationId })` / `unarchive({ conversationId })` — mutations.
  - `replyToConversation({ conversationId, body })` — mutation. Looks up the conversation's `phoneE164`, enqueues a `messageQueue` row with `toType="contact"`, `toPhone=that phone`, `body=that text`, `templateKey=null` (freeform), `batchId="inbox-reply-<conversationId>"`, status="queued" directly (no draft step — Lead just typed it), kicks outbox. Returns `{ queueId }`. The sender's per-number cooldown + quiet hours still apply. The Lead's reply also rides dev-mode redirect when applicable.
- Reuse the existing inbound write path in `convex/messaging/inbound.ts` (already upserts conversations + increments `unreadCount`). No changes there.
- Typecheck. Push to dev. Ask.

**W.5.A.2 — Inbox UI** (2 hrs)
- New page `src/app/messaging/inbox/page.tsx`.
- Desktop: 2-column (conversation list left, thread view right). Mobile: stacked, list → tap → thread (back button returns to list).
- Conversation list rows: parent display name, last-message preview, time, unread badge (red dot if `unreadCount > 0`). Archived section collapsed below.
- Thread view: chronological bubbles (outbound right teal, inbound left grey), each with timestamp + delivery status. Sibling chips at top ("Children: Rahul, Priya"). Bottom: reply box (textarea + Send button) with character count + a small "Reply will be sent within 1–2 min" hint (so the Lead isn't confused by the pacing delay).
- Header status indicators: opted-out lock icon, missing-phone warning (rare for inbox since the inbound already proved the phone works).
- Archive button on the thread header.
- Add an Inbox card to `/messaging` hub with unread badge.
- Wire the existing `whatsapp_parent_reply` notification's `actionUrl` to `/messaging/inbox?conversation=<id>` (W.1.3 may already have set this).
- Mobile-first. Typecheck. Push to dev. Ask.

### W.5.B — OUTBOX (small, operational visibility, ship second)

**Why now:** every smoke-test so far has said "check messageQueue in the Convex dashboard" which is awful UX. Outbox is the proper home for "what was queued, what sent, what failed, can I cancel/retry?"

**W.5.B.1 — Backend** (1 hr)
- Extend `convex/messaging/queue.ts` (or new `convex/messaging/outbox.ts` — pick whichever doesn't conflict with the W.1 outbox-sender file):
  - `listQueue({ status?: string, templateKey?: string, batchId?: string, limit?: number, cursor?: string })` — paginated query.
  - `cancelQueued({ queueId })` — mutation, sets `status="cancelled"`. Only allowed if current status is `draft` or `queued` (NOT `sending`/`sent`).
  - `retryFailed({ queueId })` — mutation, sets `status="queued"`, resets `attempts=0`, `lastError=null`, kicks outbox.
  - `batchSummary({ batchId })` — query, returns `{ total, draft, queued, sending, sent, failed, cancelled }` for a batch.
- Typecheck. Push to dev. Ask.

**W.5.B.2 — Outbox UI** (1.5 hrs)
- New page `src/app/messaging/outbox/page.tsx`.
- Filter bar: status pill (All / Draft / Queued / Sending / Sent / Failed / Cancelled), template dropdown, batch search (free text).
- Table/list rows: created-at, template/freeform, batch id, target (phone or group name), body preview (truncated), status pill, scheduled time (when in queue), action button (Cancel for queued, Retry for failed).
- Empty state: "Nothing in the outbox" with link back to /messaging.
- Add an Outbox card to /messaging hub.
- Mobile-first. Typecheck. Push to dev. Ask.

### W.5.C — TEMPLATES EDITOR (small, non-blocking, ship third)

**Why now:** today every template edit requires a re-deploy (`seedTemplates` is idempotent but you have to edit code + push). The Lead should be able to polish Tamil wording without me touching code.

**W.5.C.1 — Backend** (1 hr)
- Extend `convex/messaging/templates.ts` (or new `convex/messaging/templatesAdmin.ts`):
  - `listTemplates({ activeOnly?: boolean })` — query.
  - `updateTemplate({ key, language, body })` — mutation. Validates the body against the variable contract registered in code for that `key` (the contract lives in code per Section 7.4 — extract the set of valid `{{variables}}` and reject the update if the new body references unknown vars OR omits required vars). Returns `{ ok: true } | { ok: false, errors: string[] }`.
  - `previewTemplate({ key, language, body?, sampleVars: Record<string, string> })` — query, returns the rendered body for the given vars (uses the existing renderer, no DB write). Lets the editor show a live preview without saving.
- Typecheck. Push to dev. Ask.

**W.5.C.2 — Templates editor UI** (1.5 hrs)
- New page `src/app/messaging/templates/page.tsx`.
- List view: all seeded templates grouped by `key`, with Tamil + English side-by-side.
- Click a template → modal/drawer with:
  - Editable textarea (the body).
  - Variable chips listing the contract (`parent_name`, `student_name`, etc.) — click a chip to insert `{{var}}` at cursor.
  - Sample-vars panel where the Lead can type test values for each var.
  - Live preview pane showing the final rendered body (calls `previewTemplate` reactively).
  - Save button (disabled until validation passes).
- Inline "Last edited by X at Y" provenance.
- Add a Templates card to /messaging hub.
- Mobile-first. Typecheck. Push to dev. Ask.

### W.5.D — WEEKLY PERFORMANCE CARDS (the moat — ship last because biggest)

**Why last:** highest value, highest complexity. By the time we get here, Inbox + Outbox + Templates are live, so the Lead can actually USE the weekly cards properly (edit templates, see them in Outbox, handle replies in Inbox).

**Two-variant choice for the body format. Recommend one in your first response, but here's the trade-off:**

| Variant | Effort | Parent-shareability | Notes |
|---|---|---|---|
| **Text-only (W.5.D.4.a)** | Low | Lower (parents can copy/share text but not as viral as image) | Ship FIRST. Done in one sub-phase. Founder polishes the Tamil body via the new Templates editor (W.5.C). |
| **Image (W.5.D.4.b)** | High | High (parents screenshot-share, free referrals) | Adds: a render path (Satori + Tamil font, OR Puppeteer worker on the VPS, OR `@vercel/og`). Pick after text-only ships and founder confirms it's worth the work. |

Default plan: ship text-only (D.4.a). Image (D.4.b) is OPTIONAL — only build if I explicitly ask after seeing the text-only version.

**W.5.D.1 — Backend: per-student weekly stats aggregation** (2 hrs)
- New `convex/messaging/weeklyCards.ts`:
  - `weeklyStatsForStudent({ studentId, weekStartDate })` — query. Returns `{ attended: N, totalSessions: M, points: P, gradeRankLabel: "Top 20%" | "..." | null, strongModule: { id, label, score } | null, weakModule: { id, label, score } | null }`. **REUSE Phase G analytics functions in `convex/analytics.ts`** — read that file first; do NOT re-derive attendance/points from raw tables.
  - `weekStartDateInColombo({ offsetWeeks?: number })` — helper, returns YYYY-MM-DD for the Monday of the requested ISO week in Asia/Colombo (offset 0 = this week, -1 = last week which is what we usually want for a Sunday-evening review).
  - `previewWeeklyCards({ weekStartDate })` — query, returns one preview per active student: `{ studentId, parentContactId, phoneE164, displayName, studentName, bodyPreview, existingQueueRowId?, existingStatus?, skipReason? }`. Skip reasons: `optedOut`, `noParentPhone`, `noWeekData` (student has zero attendance + zero points all week — probably a new student or long-term absentee), `alreadySent`. Sibling-merging applies here too — group by `phoneE164`; merged body enumerates each child's mini-summary.
  - `upsertWeeklyCardDraft({ parentContactId, studentBundles, weekStartDate })` — idempotent like W.2/W.4 patterns. `batchId="weeklycards-<weekStartDate>"`.
  - `approveWeeklyCardsBatch({ batchId, includeAlreadyDrafted: bool })` — wraps `approveBatch`. Returns counts + quiet-hours deferred info.
- Defensive seed `seedTemplates:ensureWeeklyCardOnProdInternal` — idempotent insert/heal for `weekly_card` ta + en if missing on prod.
- Typecheck. Push to dev. Ask.

**W.5.D.2 — Weekly Cards UI** (2.5 hrs)
- New page `src/app/messaging/weekly-cards/page.tsx`. Mirror the Today/Tomorrow page rhythm.
- Header: "Weekly cards for [week of YYYY-MM-DD to YYYY-MM-DD]" + summary chips (totalParents / merged-siblings / skipped breakdown / week-selector dropdown).
- Week selector: default to "last completed week" (Sunday-eve mental model — review Mon-Sun that just ended). Allow back-shifting to any past week.
- Filter bar: center, grade.
- Body: parent-grouped cards (similar to Tomorrow's row design), with body preview, per-card EDIT button (opens the body in a modal for Lead's personal touch on a specific card — saves a draft `messageQueue` row with the edited body, NOT a template change), per-card Send button.
- Top: Send all with confirm modal (always-on per W.3 pattern). Quiet-hours warning if applicable.
- Empty state messages for each skip reason.
- Add a Weekly cards card to /messaging hub.
- Mobile-first. Typecheck. Push to dev. Ask.

**W.5.D.3 — Per-card edit modal (small but important)** (1 hr)
- The modal opened by the per-card EDIT button.
- Pre-fills with the body preview (template-rendered). Lead can freely rewrite the body for this specific card without changing the template.
- Save → that row's body is overridden to the edited text, `templateKey` set to `null` (it's now freeform), original `templateKey` saved in a `meta` field for audit if you add one.
- Cancel → modal closes, no change.
- The Templates editor (W.5.C) is for permanent changes to the body; this modal is for one-off personalizations ("Special note: Rahul did especially well — keep it up.").
- Typecheck. Push to dev. Ask.

**W.5.D.4.a — Smoke test text-only end-to-end** (founder-driven, 30 min)
- See "Acceptance test" below.

**W.5.D.4.b — IMAGE RENDERING (only if I explicitly ask after seeing D.4.a)** (3–5 hrs)
- Investigate: Satori + `@vercel/og` (Vercel-native, fastest, Tamil glyph support uncertain) vs Puppeteer worker on the VPS (slower, full browser, definite Tamil support) vs `node-canvas` (no Tamil support without setup, skip).
- Add a Convex action that calls the chosen render path with the per-card stats, returns an image bytes blob, stores in Convex storage, attaches to the `messageQueue` row via `mediaStorageId`.
- Provider's `sendMedia` already exists (W.1 schema) but may not have an Open-WA impl — wire it now if not. Open-WA accepts media via the same `send-text` endpoint with a media URL OR a separate `send-image`/`send-document` route — verify at `http://165.22.223.225:2886/api/docs`.
- Tamil font: ship Noto Sans Tamil from `https://fonts.google.com/noto/specimen/Noto+Sans+Tamil` bundled with the renderer.
- Updates `weeklyCards.ts` to attach the image storage id at draft time.
- Test rendering with a real card before queuing any send.

### W.5.E — Final deploy + sign-off

- Commit `_generated/api.d.ts`.
- `git push origin master`.
- `npx convex deploy -y`.
- Run any defensive seeds on prod: `npx convex run --prod seedTemplates:ensureWeeklyCardOnProdInternal` (and any others added during this phase).
- I walk the full acceptance test below. You're on standby for fixes.

---

## Acceptance test (FULL — covers all four sub-phases)

On the live site, with `WHATSAPP_DEV_MODE=true`:

### Inbox
1. Send myself a test message from `/messaging/settings` ("Send test") so my personal phone has a recent thread with the bot.
2. Reply to that bot message from my personal phone.
3. Open `/messaging/inbox` → my conversation appears at the top with unread badge `1`.
4. Tap it → thread view opens, badge clears, marked-read mutation fires.
5. Type a reply in the box → Send → status pill "Sending". Within 1–2 min (daytime) my personal phone receives the reply (with `[DEV → orig +94...]` because dev mode still applies).
6. Reply from my phone again → thread auto-updates within ~1s (Convex reactive query).
7. Archive button → thread moves to archived section.
8. Unarchive → returns to inbox.

### Outbox
9. Open `/messaging/outbox` → all the rows from W.2/W.3/W.4/W.5 tests visible.
10. Filter by `templateKey=absence_alert` → only absence alerts. Filter by status=failed → only failed (likely empty in dev).
11. Find a queued row that hasn't sent yet (queue it in evening so it's `scheduledNotBefore` set to morning). Click Cancel → status changes to `cancelled`. Confirm the bot doesn't send it.
12. Force a failure (temporarily break `OPENWA_BASE_URL`, queue a send, restore it) → row appears as `failed` with error. Click Retry → status returns to `queued`, sends successfully.

### Templates editor
13. Open `/messaging/templates` → see all seeded templates.
14. Open `absence_alert` (Tamil). Change a word in the body. Live preview updates with the sample vars.
15. Try to add `{{unknown_variable}}` → validation rejects with "unknown variable: unknown_variable".
16. Save with valid body → next absence alert sent uses the new wording. Confirm by triggering a fresh absence alert (W.2 flow) and checking the message content.

### Weekly cards (text-only)
17. Open `/messaging/weekly-cards` → week selector defaults to last completed week.
18. List shows all parents with at least one student who had data last week, sibling-merged. Each card shows the rendered Tamil body preview.
19. Click EDIT on one card → modal opens with body editable → change text → Save → preview updates with the edited body; the source template is unchanged (verified by reopening Templates editor).
20. Click Send on one card → within 1–2 min (daytime) my personal phone receives the Tamil weekly card with `[DEV → orig +94...]` prefix.
21. Send all → confirm modal shows total parents, deferred-to-morning count if applicable, opt-out-skipped count → confirm → queue fills.
22. Outbox shows all weekly card rows with `templateKey="weekly_card"`, `batchId="weeklycards-<weekStartDate>"`.
23. Sibling merging: a parent with 2 children both having data last week gets ONE card enumerating both names + their stats.

## What I need from you RIGHT NOW, before any code

1. Confirm you've read the plan file (cite 2–3 facts from Sections 2, 5, 6, 7.2, 7.4, 9.2, or 17).
2. Confirm you've read `project_phase_w_whatsapp.md` AND `project_phase_g_analytics.md` (cite at least one specific decision from each).
3. Tell me which Phase G analytics functions in `convex/analytics.ts` you'll reuse for weekly stats. Read the file. Don't re-derive.
4. Tell me whether `weekly_card` template is seeded on BOTH dev AND prod today. If missing on prod, you must include the defensive seed in W.5.D.1.
5. Recommend text-only (W.5.D.4.a) ship first, with image (W.5.D.4.b) deferred until I explicitly ask after seeing text live. If you think image-first is right despite the effort, defend it.
6. Surface scope ambiguities. Specifically:
   - **Template variable contract change.** Current `weekly_card` vars are singular (`student_name`, `points`, ...). For sibling merging you'll need either (a) `student_lines` (pre-rendered list) or (b) sibling-aware conditional in the template. Recommend.
   - **`rank_label`.** What's the data source? (E.g. "Top 20% of Grade 8" or "+3 ranks since last week" or both?) Probably Phase G analytics has this; verify.
   - **Per-card edit (W.5.D.3) overrides.** Storing the override on the `messageQueue` row vs in a separate `cardOverrides` table. Recommend.
   - **Inbox-reply rate limiting.** A Lead spamming "ok" 10 times in 10 seconds — the per-number cooldown (5 min) means only 1 sends per 5 min, rest defer. UI should warn? (My take: yes, soft hint above the reply box if there's a recently-sent outbound to this phone.)
   - **Quiet hours for inbox replies.** A reply typed at 10pm — defer to 7am? My instinct: yes, but with explicit "Will deliver at 07:00 tomorrow" hint shown above Send. Confirm or push back.
7. Propose the smallest first slice (W.5.A.1 — Inbox backend). Then **wait for my go-ahead.**

## Things to know about (do NOT learn the hard way)

- All the deploy/env-var/Convex gotchas from W.1–W.4 still apply. They're in `project_phase_w_whatsapp.md`.
- The `whatsapp_session_down` notification (W.1) fires when Open-WA disconnects. If you see it during weekly-card testing, the founder has to re-scan QR at `http://165.22.223.225:2886/`.
- Phase G analytics queries are auth-gated. Weekly-card backend calls them in a context with `ctx.auth.getUserIdentity()` — confirm they don't throw when called from another backend function (they should accept the propagated identity).
- Convex queries can read `process.env` only when the env var is set on the deployment.
- `_generated/api.d.ts` is git-tracked — commit after every Convex function add/rename.
- `npx convex run` has no Clerk identity — use internal twins.
- Don't break the W.1.3 inbound write path in `convex/messaging/inbound.ts`. Inbox just READS from `conversations` + `messageLog`.

## Explicitly DEFERRED (do NOT build in this phase — tell the founder if they ask)

- **W.6 Homework PDF auto-delivery** — depends on learning-engine Phase B (sheets being PDF-rendered). Phase B is not shipped. Defer until learning-engine plan reaches Phase B.
- **W.7 Predicted-vs-actual exam reports** — depends on learning-engine Phase A (mastery model) AND Phase F (calibration loop) being live with at least one term-end snapshot. Both not shipped. Defer.
- **W.8 polish** — fee reminders (uses sessionPayments), doubt-queue notifications to teachers, leaderboard milestone messages, Tamil opt-out keyword (`நிறுத்து`). All future, not blocking moat or operations.
- **Image rendering for weekly cards (W.5.D.4.b)** — optional. Ship text-only first; founder decides after seeing it whether the image variant is worth the effort.

When you're ready and have read everything, give me a numbered list of (a) the 7 things from the "RIGHT NOW" section above and (b) your proposed W.5.A.1 file list. Then wait.
