# W.3 Handoff Prompt — Manual Broadcasts (paste this into a new Sonnet session)

> Copy everything below the `---` line into a fresh Sonnet session and send. Do NOT copy this header. **Only paste this AFTER W.2's acceptance test has passed live.** If W.2 turned up bugs, fix them first, then revisit this prompt.

---

I want you to build **Phase W.3 — Manual broadcasts to WhatsApp groups** for my Aristora math-tracker app. Phase W.1 (plumbing) and W.2 (absence alerts) are both shipped and live in production. W.3 is the third real use case on top of the same plumbing — saves the Lead from copy-pasting "tomorrow's M3 class cancelled" into N WhatsApp parent groups one by one.

## Read these files in order before writing any code

1. **`whatsapp_integration_plan.md`** at repo root — the complete Phase W spec. **It is gitignored because Section 17 has production secrets — never `git add -f` it, never paste its contents anywhere.** Most-relevant sections for W.3:
   - **Section 4.1** — the provider chokepoint. `sendGroupText` / `sendGroupMedia` are part of the interface; check whether W.1 actually implemented them (likely only `sendText` exists today — see W.3 requirements below).
   - **Section 4.2** — notification-driven trigger model (NO cron). Broadcasts are triggered by a human clicking Send on the Broadcasts page.
   - **Section 5** — human-mimic sender rules (35s–2min gap, quiet hours, per-hour/day caps). Broadcasts use the SAME queue, so all rules apply automatically.
   - **Section 7.2 (`whatsappGroups` table)** — schema exists from W.1.0. Has `whatsappGroupId`, `displayName`, `scope: { grade?, centerId?, moduleId?, groupId? }`, `active`, `syncedAt`. Use it; don't redefine.
   - **Section 8.2 "Broadcasts" tab** — the UX target.
   - **Section 9 "Phase W.3"** — the original scope summary.
   - **Section 12** — things to AVOID (cron, blast loops, bypassing the provider chokepoint).
   - **Section 15 (open question #2)** — bot must be a member of every parent group to post in it. Founder will add the bot manually before clicking "Sync groups."
   - **Section 17** — live VPS + Open-WA credentials (don't log, don't commit).
2. **User memory** at `C:\Users\Ilham\.claude\projects\C--Users-Ilham-aaa-projects-math-tracker\memory\`:
   - `MEMORY.md` (index)
   - `project_phase_w_whatsapp.md` — read in full; has the dev/prod deployment trap, the session UUID gotcha, the W.2 commits/decisions, and the deploy gotchas. Both prod env vars AND `git push` (for the Next.js frontend) AND `npx convex deploy -y` (for the Convex backend) are needed to put W.3 live.
   - `feedback_ux_navigation.md` + `feedback_theme_preference.md`
   - `reference_build_typecheck.md` — backend typechecking is `npx convex codegen`; to push functions to dev use `npx convex dev --once`. `_generated/api.d.ts` IS git-tracked — commit it so Vercel build has current types.
3. **The W.1 + W.2 code as ground truth** for patterns to follow:
   - `convex/messaging/provider.ts` — the chokepoint. **Check if `sendGroupText` exists.** If not, you add it in W.3.1 (Open-WA group-send endpoint is `POST /api/sessions/{sessionId}/messages/send-text` with `chatId: "<groupId>@g.us"` — verify at `http://165.22.223.225:2886/api/docs`).
   - `convex/messaging/queue.ts` — `internalDraftAndQueue` already supports `toType: "group"` per the schema. Reuse it.
   - `convex/messaging/outbox.ts` — DO NOT touch. Pacing logic must stay identical for broadcasts.
   - `convex/messaging/templates.ts` + `seedTemplates.ts` — `schedule_change` (ta + en) is already seeded with var `body_text`. Confirm it's there in BOTH dev and prod (W.2 had to heal templates on prod because some W.1 templates were never seeded there — see `seedTemplates:ensureAbsenceTemplateV2Internal` pattern. Apply the same defensive seeding for `schedule_change` if absent on prod).
   - `convex/messaging/absenceAlerts.ts` (W.2) — pattern for "draft + dedup + approve" mutations. Mirror it for `convex/messaging/broadcasts.ts`.
   - `src/app/messaging/today/page.tsx` (W.2) — pattern for a `/messaging/<sub>` page with scope filters, drafts list, per-row Send + top "Send all". Mirror it for `src/app/messaging/broadcasts/page.tsx`.
   - `src/app/messaging/page.tsx` — the hub. Add a Broadcasts card alongside the existing Today card.
4. **Find the bot's group memberships:**
   - Hit `http://165.22.223.225:2886/api/sessions/{sessionId}/groups` with `X-API-Key: <OPENWA_API_KEY>` from a Convex action (NOT from `curl` in your dev session). Open-WA returns the list of groups the bot is a member of. This is what `whatsappGroups` syncs from. Confirm payload shape against `/api/docs`.

## W.3 working style (carries over)

- I'm a non-technical founder. Ship, verify, report. No tutorials.
- I want concrete pushback when I'm wrong. No sycophancy.
- **One sub-phase per chunk**, then ASK before moving to the next. Don't batch W.3.1+W.3.2+W.3.3 into a mega-commit.
- Mobile-first dark navy + teal. Tamil for parent-facing copy, English for internal/teacher.
- Never add emojis to code/files unless I ask.
- Typecheck before declaring done: `npx convex codegen` for backend, `tsc --noEmit -p tsconfig.json` for frontend.
- **Two Convex deployments exist:** dev (`qualified-alpaca-97`) and prod (`rapid-loris-309`). I test on **production** (live Vercel site). After any code change for me to test live: `git push origin master` (frontend → Vercel auto-deploys) AND `npx convex deploy -y` (backend). After any new env var: `npx convex env set --prod KEY value` AND `npx convex env set KEY value` (both). After any prod data migration: `npx convex run --prod <fn>` — use `internalMutation`/`internalQuery` twins for CLI runs because `npx convex run` has no Clerk auth.

## W.3 hard requirements (non-negotiable — surface a question, don't deviate silently)

1. **Provider chokepoint preserved.** Every group send goes through `convex/messaging/provider.ts`. If `sendGroupText` doesn't exist there yet, add it in W.3.1 — but do NOT call Open-WA's REST API from anywhere outside `provider.ts`.
2. **Same queue, same sender, same pacing.** Broadcasts enqueue `messageQueue` rows with `toType="group"`, `toWhatsappGroupId=<id>`, just like contacts use `toType="contact"`. `outbox.ts:processNext` already handles both. Don't add a parallel sender.
3. **Notification-driven, not cron.** The trigger is a human clicking Send on the Broadcasts page. NO scheduled broadcast jobs, ever.
4. **Dev-mode safety preserved — and extended for groups.** `WHATSAPP_DEV_MODE=true` rewrites `to` to `WHATSAPP_DEV_NUMBER` for contact sends. For group sends in dev mode, you can't rewrite a group ID to a phone number. **Default behavior: in dev mode, group sends are REDIRECTED to the founder's personal phone with a `[DEV → orig group "<displayName>"]` prefix in the body.** Implement this in `provider.ts:sendGroupText`. Founder confirmed this in W.1; don't ship "groups go through unconditionally in dev mode" — that risks blasting real parent groups during testing.
5. **Group sync only adds groups the bot is in.** `whatsappGroups.syncFromOpenWa` mutation calls Open-WA's `/sessions/{id}/groups`, iterates the response, upserts by `whatsappGroupId`. Groups the bot has left disappear from the list (set `active=false`, don't delete — preserves audit trail in `messageLog`).
6. **Scope tags are manual.** Open-WA can't infer which WhatsApp group maps to which Aristora `grade`/`centerId`/`moduleId`. After sync, the synced list shows each group with **inline editors for scope.grade / scope.centerId / scope.moduleId / scope.groupId**. The founder fills these in once. Filtering the Broadcasts picker by "Grade 8 Colombo" then resolves to all `whatsappGroups` matching that scope.
7. **Opt-out is N/A for groups.** `parentContacts.optedOut` is per-individual-phone. Groups don't have opt-out (the chat is the whole group). If you ever surface a per-parent-in-group opt-out later, it's W.8.
8. **Quiet hours + per-hour cap still apply.** If the founder clicks "Send to 12 groups" at 9:30pm, all 12 are deferred to 7am the next morning. The Broadcasts UI should warn ("12 messages will be sent starting 07:00 tomorrow — quiet hours active") before queueing. Don't quietly defer without warning.
9. **Text-only for W.3.** Image/PDF attachments are W.5 (weekly card images) and W.6 (homework PDF). Do NOT add a media uploader to Broadcasts in W.3 — keep it minimal.

## W.3 acceptance test (what I'll click through after you ship)

On the live site, with `WHATSAPP_DEV_MODE=true`:

1. On my phone, I add the bot's business WhatsApp number (`+94778909467`) to a small test WhatsApp group I control (e.g. "Aristora Test Group" with just me in it).
2. Open `/messaging/broadcasts` → click **Sync groups from WhatsApp** → spinner → list populates with my test group (and any other groups the bot is in).
3. Click the test group row → inline editor → set `scope.grade = 8`, `scope.centerId = <one of my centers>`. Save.
4. In the Broadcasts compose section: select template **"Schedule change (Tamil)"** OR check "Freeform"; type body `"Tomorrow's M3 class moved to 4pm. — Test"`. Live preview renders the final text.
5. Scope filter: pick `Grade = 8` AND `Center = <that center>`. Group picker shows my test group as selected (1 group, 1 message). Click **Send**.
6. Within ~1 min (daytime), the test group on my phone receives the Tamil message **with `[DEV → orig group "Aristora Test Group"]` prefix** in the body. (Because dev mode redirected the send to my personal phone — not the actual group — but annotated with what the real target would have been.)
7. Open the **Outbox** → broadcast row appears with `templateKey="schedule_change"` (or `null` if freeform), `batchId="broadcast-<timestamp>"`, `toType="group"`, `toWhatsappGroupId=<id>`, `status="sent"`.
8. Click **Sync groups** again → my test group is still listed; nothing duplicated. The `syncedAt` timestamp updates.
9. Remove the bot from the test group on my phone → wait 30s → click **Sync** → the group row moves to a muted "Inactive" section (or hides), `active=false`. Try to send to it → blocked with "Group no longer accessible to the bot."
10. Quiet-hours test: change my laptop clock to 21:30 Sri Lanka time (or wait until evening) → click Send to a group → UI warns "Messages will be sent starting 07:00 tomorrow" → I confirm → the row goes into queue with `scheduledNotBefore = tomorrow 07:00`. Outbox shows the deferred row.

## W.3 scope — proposed sub-phase split (push back if you want a different split)

- **W.3.1 — Backend: provider group send + group sync + broadcast draft** (2–3 hrs)
  - **Extend `convex/messaging/provider.ts`:** add `sendGroupText({ groupId, text })` that POSTs to `${OPENWA_BASE_URL}/sessions/${sessionId}/messages/send-text` with `chatId: "<groupId>@g.us"` (verify exact field name + endpoint at `/api/docs`). In dev mode, rewrite `groupId` → contact-send to `WHATSAPP_DEV_NUMBER` and prepend `[DEV → orig group "<displayName>"]` to the body. The provider needs to know the display name — pass it through, or look it up from `whatsappGroups`.
  - **Extend `convex/messaging/outbox.ts:processNext`** to handle `toType: "group"` rows: pick `sendGroupText` instead of `sendText` based on `toType`. **Pacing logic itself does not change** — same MIN_GAP, quiet hours, per-hour cap.
  - **New `convex/messaging/groupsWa.ts`:**
    - `syncFromOpenWa` — action that hits Open-WA's groups endpoint, upserts `whatsappGroups` by `whatsappGroupId`, marks no-longer-present groups `active=false`.
    - `setScope({ id, scope })` — mutation, founder sets grade/center/module/groupId tags.
    - `list({ activeOnly, scopeFilter })` — query, returns filtered group list.
    - `listInactive` — query for the muted section.
  - **New `convex/messaging/broadcasts.ts`:**
    - `draftBatch({ targetGroupIds, templateKey?, freeformBody?, vars? })` — for each target group, render the body (template or freeform), call `internalDraftAndQueue` with `toType="group"`, `toWhatsappGroupId=<id>`. All drafts share `batchId="broadcast-<Date.now()>"`. Returns the batchId + count.
    - `approveBroadcastBatch({ batchId })` — wraps existing `approveBatch`. Returns `{ queued: N, deferredToMorning: M }` so the UI can show the quiet-hours warning.
    - `quietHoursCheck({ at })` — query, returns `{ inQuietHours: bool, nextWindowStart: number }` so the UI can warn before approval.
  - **Defensive seed:** `seedTemplates:ensureScheduleChangeOnProdInternal` — idempotent, only inserts if missing. Pattern from W.2's `ensureAbsenceTemplateV2Internal`.
  - Typecheck (`npx convex codegen`). Push to dev (`npx convex dev --once`). Ask before W.3.2.

- **W.3.2 — `/messaging/broadcasts` UI** (2–3 hrs)
  - New page `src/app/messaging/broadcasts/page.tsx`. Mirror the layout of `src/app/messaging/today/page.tsx`.
  - Top section: **Compose** — template radio OR freeform body. Live preview as you type. Template picker shows only `schedule_change` for now (others added in later phases).
  - Middle section: **Targets** — group picker filtered by scope (grade/center/module dropdowns). Picker shows display name, sibling tags, last-synced. Multi-select.
  - Bottom: **Send batch** button. On click: pre-flight `quietHoursCheck`; if inside quiet hours, show modal with "Send anyway (will deliver at 07:00)" / "Cancel". On confirm → `draftBatch` + `approveBroadcastBatch` → toast "Queued N messages" → navigate to Outbox filtered by `batchId`.
  - Empty state: if no groups exist yet → CTA "Sync groups from WhatsApp" (calls `syncFromOpenWa`).
  - Add a Broadcasts card to `/messaging` hub matching the Today card's style.
  - Mobile-first, dark navy + teal. Typecheck both `npx convex codegen` and `tsc --noEmit`. Push to dev. Ask before W.3.3.

- **W.3.3 — Group management UI (sync + scope editor + inactive list)** (1–2 hrs)
  - Sub-route or accordion on the Broadcasts page: **Manage groups**.
  - Synced groups list with inline scope editor (grade / center / module / specific internal group). Save on blur.
  - "Sync groups" button — calls `syncFromOpenWa`, shows toast with `{ added, updated, deactivated }`.
  - Inactive section showing groups the bot has left (read-only).
  - Typecheck. Push to dev. Ask before W.3.4.

- **W.3.4 — Deploy to prod + smoke-test** (30 min, mostly user-driven)
  - Commit `_generated/api.d.ts` (W.2 learning).
  - `git push origin master` (Vercel auto-builds frontend).
  - `npx convex deploy -y` (Convex backend).
  - `npx convex run --prod seedTemplates:ensureScheduleChangeOnProdInternal` if defensive-seed wasn't already triggered.
  - I walk through the acceptance test on live. You're on standby for fixes.

## What I need from you RIGHT NOW, before any code

1. Confirm you've read the plan file (cite 2–3 specific facts from Sections 5, 7.2, 8.2, or 17).
2. Confirm you've read `project_phase_w_whatsapp.md` in memory (cite the dev/prod deployment trap + the deploy gotchas section + at least one W.2 baked-in decision).
3. Tell me what's currently in `convex/messaging/provider.ts` — specifically: does `sendGroupText` exist yet, or are we adding it in W.3.1? Read the file.
4. Tell me the exact Open-WA endpoint + field for group sends. Verify against `http://165.22.223.225:2886/api/docs` — quote the route + payload shape in your reply. Don't guess.
5. Surface any ambiguity in W.3's scope before writing. Specifically:
   - Dev-mode group-send redirect — confirm my "rewrite to personal phone + `[DEV → orig group …]` prefix" choice, or recommend a better one.
   - Should the Send batch button be a single-step click-confirm, or always show a "you're about to send to N groups" confirmation modal even outside quiet hours? (My take: confirmation modal always — broadcasts are higher-stakes than personal messages.)
   - Freeform broadcasts — should they be allowed in Tamil-only, or do we render the same text regardless of language? (My take: freeform = the founder's responsibility for language. Templates handle language switching.)
6. Propose the smallest first slice (probably W.3.1 backend only). Then **wait for my go-ahead.**

## Things to know about (do NOT learn these the hard way)

- **Open-WA group IDs end in `@g.us`** (vs `@c.us` for contacts). Strip or include the suffix consistently — `whatsappGroups.whatsappGroupId` should store the full `120363xxx@g.us` form so it can be used directly as `chatId` in API calls.
- **Sync returns ALL groups the bot is in**, including spam/personal/test groups. The Lead picks which to tag in W.3.3. Don't auto-tag; that's a Section 12 "no surprises" rule.
- **The bot's group membership can change without notice** (admin kicks the bot, group is deleted). Always re-check `active=true` at send time; if false, fail the queue row with `lastError="Group inactive"`.
- **Quiet hours in `policy.ts`** are 21:00–07:00 Asia/Colombo. Don't change them for broadcasts. The whole point is anti-ban posture.
- **Per-hour cap of 60 still applies.** If the founder picks 80 groups, the first 60 send in the first hour, the next 20 in the second. The UI should show this in the pre-flight summary, not surprise them.
- **Convex queries CAN read `process.env`** — but only when the env var is set on the deployment the code is running against. Two deployments = two env-var sets.
- **`_generated/api.d.ts` is git-tracked.** After adding new Convex functions, commit it before `git push` — otherwise Vercel's TypeScript build fails because the frontend references functions Vercel doesn't know exist.
- **`npx convex run` has no Clerk identity.** Use `internalMutation`/`internalQuery` twins for any CLI-runnable seed / migration / smoke-test function.

When you're ready and have read everything, give me a numbered list of (a) the 6 things from the "RIGHT NOW" section above and (b) your proposed W.3.1 file list. Then wait.
