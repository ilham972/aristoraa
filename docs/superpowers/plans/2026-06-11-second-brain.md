# Second Brain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a layered, size-capped AI knowledge base (`CLAUDE.md` + `docs/brain/`) for Math Tracker via one evidence-based audit pass, so any AI session understands the app and its purpose without re-reading the codebase.

**Architecture:** A tiny auto-loaded index (`CLAUDE.md`, ≤50 lines) points to focused brain files in `docs/brain/` (each ≤100 lines). Live-vs-dead code is determined by import reachability from `src/app/**/page.tsx` entry points (via `knip`) plus `api.<module>` usage greps for Convex. Nothing is deleted or moved.

**Tech Stack:** Next.js 16 (App Router) + Convex + Clerk + Tailwind/shadcn. Audit tooling: `npx knip`, ripgrep. No new dependencies installed permanently.

**Spec:** `docs/superpowers/specs/2026-06-11-second-brain-design.md`

**Protected files (NEVER delete, never list as legacy):** `learning_engine_plan.md`, `algorithm_plan.md`

**Hard size caps (every task must respect):**
- `CLAUDE.md` ≤ 50 lines
- every `docs/brain/*.md` and `docs/brain/features/*.md` ≤ 100 lines
- No code blocks copied into brain files — file-path pointers + prose only

**Verify caps with:** `Get-ChildItem docs\brain -Recurse -Filter *.md | ForEach-Object { "$((Get-Content $_.FullName | Measure-Object -Line).Lines)`t$($_.Name)" }`

---

### Task 1: Founder interview → `docs/brain/purpose.md`

**Files:**
- Create: `docs/brain/purpose.md`

The founder is non-technical. Ask in plain language, ONE question per message, via AskUserQuestion or chat. Do not skip; code cannot reveal purpose.

- [ ] **Step 1: Ask the interview questions (one at a time)**

1. In one or two sentences: why did you build Math Tracker — what problem were you living with before it existed?
2. Who uses it today? (you only / other teachers / students directly / parents) And roughly how many students?
3. How does the business earn money today, and how do you want it to earn in 2 years?
4. What does success look like 1–2 years from now? (e.g., N students, N teachers, a product others pay for…)
5. What must NEVER break or change? (non-negotiables — e.g., "scoring data is sacred", "teachers must not need training")
6. If the AI could improve ONE thing about the app every week, which area matters most to the mission?

- [ ] **Step 2: Write `docs/brain/purpose.md` from the answers**

Structure (fill with the founder's actual answers, ≤100 lines):

```markdown
# Purpose — why Math Tracker exists

## Mission
<distilled answer 1>

## Who it serves
<answer 2: roles, counts>

## Business model
<answer 3: today + 2-year intent>

## What success looks like (1–2 years)
<answer 4>

## Non-negotiables
<answer 5, bullet list>

## Priority compass
<answer 6 — the area improvements should favor>

> Every idea in ideas-backlog.md must say which line of this file it serves.
```

- [ ] **Step 3: Founder reads it back**

Show the file content in chat; ask "is this exactly right?" Edit until yes.

- [ ] **Step 4: Commit**

```bash
git add docs/brain/purpose.md && git commit -m "brain: purpose.md from founder interview" && git push
```

---

### Task 2: Reachability evidence (the dead-code detector)

**Files:**
- Create: `knip.json` (repo root)
- Create: `docs/brain/_audit/knip-report.txt` (working artifact, not a brain file — no size cap)
- Create: `docs/brain/_audit/convex-usage.txt`

- [ ] **Step 1: Create `knip.json`**

```json
{
  "$schema": "https://unpkg.com/knip@5/schema.json",
  "entry": ["src/app/**/{page,layout,loading,error,not-found}.tsx", "src/middleware.ts", "convex/**/*.ts", "scripts/**/*.mjs"],
  "project": ["src/**/*.{ts,tsx}"],
  "ignore": ["convex/_generated/**", "src/components/ui/**"]
}
```

Note: `convex/**` is listed as entry so knip does NOT judge convex files (Convex functions are called via the generated `api` object, which knip can't trace). Convex liveness is handled in Step 3 instead. `src/components/ui/**` (shadcn primitives) is ignored — generated library code, not app code.

- [ ] **Step 2: Run knip, save the report**

```powershell
npx knip --reporter compact > docs\brain\_audit\knip-report.txt
Get-Content docs\brain\_audit\knip-report.txt -TotalCount 60
```

Expected: a list of unused files / unused exports under `src/`. Knip exits non-zero when it finds issues — that is success here, not failure.

- [ ] **Step 3: Trace Convex module usage**

For each `convex/<name>.ts`, the client calls it as `api.<name>.<fn>` (or `internal.<name>.<fn>` from other convex files). Run:

```powershell
Get-ChildItem convex -Filter *.ts -File | ForEach-Object {
  $n = $_.BaseName
  if ($n -in @('schema','seed','http','auth.config')) { return }
  $hits = (Select-String -Path src\**\*.ts,src\**\*.tsx,convex\**\*.ts -Pattern "api\.$n\.|internal\.$n\." -SimpleMatch:$false | Measure-Object).Count
  "$n`t$hits"
} | Out-File -Encoding utf8 docs\brain\_audit\convex-usage.txt
Get-Content docs\brain\_audit\convex-usage.txt
```

Modules with 0 hits = unwired backend candidates. Also check subfolders `convex/learningEngine`, `convex/messaging`, `convex/lib`, `convex/seeds` the same way (path-based references like `api.learningEngine.foo.bar` → pattern `learningEngine\.$n\.`).

- [ ] **Step 4: Commit the evidence**

```bash
git add knip.json docs/brain/_audit/ && git commit -m "brain: reachability evidence (knip + convex usage)" && git push
```

---

### Task 3: Skeleton + `overview.md` + `architecture.md` + `domain.md`

**Files:**
- Create: `docs/brain/overview.md`
- Create: `docs/brain/architecture.md`
- Create: `docs/brain/domain.md`

- [ ] **Step 1: Write `overview.md`** (≤60 lines)

Founder-language summary: what Math Tracker is (tutoring-center operations app: scheduling, worksheets, scoring, progression, analytics, messaging), who uses it, deployment (live in production; Convex prod + Vercel), pointer to `purpose.md`.

- [ ] **Step 2: Write `architecture.md`** (≤100 lines)

Must contain, as prose + tables of file-path pointers (no code):
- Stack: Next.js 16 App Router, React 19, Convex (DB + functions), Clerk auth, Tailwind + shadcn/Base UI, pdf-lib (NOT sharp — sharp is in package.json but the PDF path is pure-JS pdf-lib; flag sharp as possible dead dependency), vitest + convex-test.
- Folder map: `src/app/<area>` = pages; `src/components/<area>` = area components; `src/lib` = pure logic; `convex/*.ts` = backend modules; `convex/schema.ts` = ALL table definitions; `tests/`.
- Route inventory: list every `src/app/**/page.tsx` found by: `Get-ChildItem src\app -Recurse -Filter page.tsx | ForEach-Object { $_.FullName }`
- Build/typecheck gotcha: root `tsc` skips `convex/`; use `npx convex codegen`. Tests: `npm test`.

- [ ] **Step 3: Write `domain.md`** (≤100 lines)

One short paragraph per concept, each ending with its primary table(s) in `convex/schema.ts` and primary module. Concepts (verify each against schema.ts while writing): student, teacher, group, schedule slot (incl. back-to-back fusion), session, sheet (5 sections incl. Revision + Mistakes), entry/scoring, question bank, module/unit path, track & leagues (note `LEADERBOARD_PRIMARY='legacy'` flag state), learning engine (SR/AR/interleaving), repeatCount remedy, stem/leaf question model, points/leaderboard, attendance, doubts, messaging/notifications.

- [ ] **Step 4: Commit**

```bash
git add docs/brain/ && git commit -m "brain: overview, architecture, domain" && git push
```

---

### Task 4: Feature audit — groups & scheduling

**Files:**
- Create: `docs/brain/features/groups-scheduling.md`
- Append: `docs/brain/_audit/findings.md` (dead-code findings + improvement ideas, free-form working file)

Audit procedure (SAME for tasks 4–9): read the area's `page.tsx` files → follow imports into `src/components/<area>` and `src/lib` → note which `api.*` calls hit which convex modules → write the feature file. While reading, record into `_audit/findings.md`: (a) files imported by nothing live, (b) duplicated/confusing logic, (c) improvement ideas with the purpose.md line they serve.

- [ ] **Step 1: Read** `src/app/groups/`, `src/components/groups/`, `src/lib/groups/`, `convex/groups.ts`, `convex/scheduleSlots.ts`, `convex/slotTeachers.ts`, `convex/rooms.ts`, `convex/groupMigration.ts`, `convex/attendance.ts`
- [ ] **Step 2: Write `features/groups-scheduling.md`** (≤100 lines): what the /groups page does (day selector, slot fusion, session entry), data flow page→convex, key invariants (fusion rules, orphan/absorb from toggleSession), migration status (Phase F: F.6–F.8 pending — old tab not yet retired), file pointers.
- [ ] **Step 3: Record findings** in `_audit/findings.md` (dead candidates, ideas).
- [ ] **Step 4: Commit** `git add docs/brain/ && git commit -m "brain: groups-scheduling feature file" && git push`

---

### Task 5: Feature audit — session, sheets & scoring

**Files:**
- Create: `docs/brain/features/session-sheets-scoring.md`
- Append: `docs/brain/_audit/findings.md`

- [ ] **Step 1: Read** `src/app/session/[slotId]/`, `src/components/session/`, `src/components/sheets/`, `src/lib/sheets/`, `convex/sessionRecords.ts`, `convex/sessionSubmissions.ts`, `convex/entries.ts`, `convex/exercises.ts`, plus the PDF path (`convex/pastPaperPages.ts`, `convex/textbookPages.ts`, `convex/paperStructures.ts`, settings crop pages).
- [ ] **Step 2: Write the feature file** (≤100 lines): merged Sheets tab (sheet-only scoring, per-student sheet actions), sheet generation path (path-driven redesign status vs live behavior), PDF clipping (pdf-lib), stem/leaf rendering rule, repeatCount cooldown.
- [ ] **Step 3: Record findings.** Pay attention to the OLD scoring tab remnants (Score tab was merged away 2026-06-07) and pre-redesign sheet code.
- [ ] **Step 4: Commit** `git add docs/brain/ && git commit -m "brain: session-sheets-scoring feature file" && git push`

---

### Task 6: Feature audit — algorithm & learning engine

**Files:**
- Create: `docs/brain/features/learning-engine.md`
- Append: `docs/brain/_audit/findings.md`

- [ ] **Step 1: Read** `src/app/algorithm/` (blueprint, coverage, exam-calendar, scoring), `src/components/algorithm/`, `src/components/coverage/`, `src/components/learning/`, `convex/learningEngine/` (all files), `convex/questionBank.ts`, `convex/topicTags.ts`, `convex/unitMetadata.ts`, `convex/currentAssignments.ts`, `convex/studentModulePositions.ts`. Cross-check against `learning_engine_plan.md` + `algorithm_plan.md` (the CURRENT plans).
- [ ] **Step 2: Write the feature file** (≤100 lines): planner (leaves-only selection), SR/AR/interleaving state, blueprint/coverage pages' role, exam-calendar, what's shipped vs still planned per the two current plan docs.
- [ ] **Step 3: Record findings.**
- [ ] **Step 4: Commit** `git add docs/brain/ && git commit -m "brain: learning-engine feature file" && git push`

---

### Task 7: Feature audit — progression, leaderboard & tracks

**Files:**
- Create: `docs/brain/features/tracks-leaderboard.md`
- Append: `docs/brain/_audit/findings.md`

- [ ] **Step 1: Read** `src/app/leaderboard/` (+ `leagues`), `src/app/progress/`, `src/app/curriculum/`, relevant components, `convex/timeline.ts`, `convex/migrations.ts`, points/track convex modules found via grep `LEADERBOARD_PRIMARY`.
- [ ] **Step 2: Write the feature file** (≤100 lines): legacy points system vs track model (P1–P4 shipped, flag still `legacy`, founder-gated steps: prod seed+backfill, flag flip, runtime test), railway map, leagues.
- [ ] **Step 3: Record findings.** The dual system (legacy + track) is a known planned-transition, NOT dead code — mark it "transition in progress" in findings.
- [ ] **Step 4: Commit** `git add docs/brain/ && git commit -m "brain: tracks-leaderboard feature file" && git push`

---

### Task 8: Feature audit — analytics, timeline & students

**Files:**
- Create: `docs/brain/features/analytics-students.md`
- Append: `docs/brain/_audit/findings.md`

- [ ] **Step 1: Read** `src/app/analytics/`, `src/app/timeline/` (+compare, +student), `src/app/students/` (+[id]), `src/components/analytics/`, `convex/analytics.ts`, `convex/students.ts`, `convex/teachers.ts`, `convex/centers.ts`, `convex/doubts.ts`, `convex/lead.ts`.
- [ ] **Step 2: Write the feature file** (≤100 lines): 5-tab executive analytics (Phase G shipped), Day-view bulk-cancel, timeline views, student profile pages, doubts, leads.
- [ ] **Step 3: Record findings.**
- [ ] **Step 4: Commit** `git add docs/brain/ && git commit -m "brain: analytics-students feature file" && git push`

---

### Task 9: Feature audit — messaging, settings & shell

**Files:**
- Create: `docs/brain/features/messaging-settings.md`
- Append: `docs/brain/_audit/findings.md`

- [ ] **Step 1: Read** `src/app/messaging/` (all 8 subpages), `src/components/messaging/`, `convex/messaging/`, `convex/notifications.ts`, `src/app/settings/`, `src/app/more/`, `src/app/sign-in/`, `src/contexts/`, `src/hooks/`, `convex/settings.ts`, `convex/seed.ts`, `convex/seeds/`, `scripts/`.
- [ ] **Step 2: Write the feature file** (≤100 lines): messaging hub status vs Phase W WhatsApp plan (plan only, not started — gateway not built), notifications, settings/crop tools, app shell (nav, auth, contexts).
- [ ] **Step 3: Record findings.**
- [ ] **Step 4: Commit** `git add docs/brain/ && git commit -m "brain: messaging-settings feature file" && git push`

---

### Task 10: `decisions.md` + plan-file triage

**Files:**
- Create: `docs/brain/decisions.md`

- [ ] **Step 1: Skim every root `.md`** (`app_prompt.md`, `convesation_about_engine.md`, `curriculum context.md`, `new_change.md`, `open-wa-intro.md`, `phase_0_4_plan.md`, `phase_0_5_plan.md`, `phase_0_6_plan.md`, `sheet_scoring_plan.md`, `sheet_structure_redesign_plan.md`, `whatsapp_integration_plan.md`, `README.md`). First ~80 lines each is enough to classify.
- [ ] **Step 2: Write `decisions.md`** (≤100 lines). Format per entry: `**<decision>** — chose X over Y because Z (source: <file>, <date if known>)`. Must include at minimum: sharp→pdf-lib pivot; Score+Sheets tab merge; weekday→module killed in favor of teacher-curated path; slot fusion; track model vs legacy points; repeatCount as stopgap; stem/leaf model; plan-doc verdicts table: CURRENT = `learning_engine_plan.md`, `algorithm_plan.md`; ACTIVE-SPEC = `sheet_structure_redesign_plan.md`, `whatsapp_integration_plan.md` (planned, unbuilt); HISTORICAL = the rest, each with a one-line "what idea it held".
- [ ] **Step 3: Commit** `git add docs/brain/decisions.md && git commit -m "brain: decisions log + plan-file triage" && git push`

---

### Task 11: `legacy-map.md` (consolidated dead-code verdicts)

**Files:**
- Create: `docs/brain/legacy-map.md`

- [ ] **Step 1: Merge evidence** — `_audit/knip-report.txt` + `_audit/convex-usage.txt` + `_audit/findings.md` into one table.
- [ ] **Step 2: Write `legacy-map.md`** (≤100 lines; if more rows exist, keep the table terse — path, verdict, one-word reason). Verdict column values: `SAFE-DELETE` (zero references, no data risk), `FOUNDER-DECIDES` (unwired but might hold wanted ideas), `TRANSITION` (dual-running by design, e.g. legacy leaderboard), `KEEP` (false positive with explanation). Top of file: "Nothing here has been deleted. This is a map, not an action."
- [ ] **Step 3: Commit** `git add docs/brain/legacy-map.md && git commit -m "brain: legacy map with verdicts" && git push`

---

### Task 12: `ideas-backlog.md`

**Files:**
- Create: `docs/brain/ideas-backlog.md`

- [ ] **Step 1: Write the backlog** from `_audit/findings.md` ideas (≤100 lines). Format: `| # | Idea | Area | Serves (purpose.md line) | Effort S/M/L | Impact 1-5 |`, sorted by impact. Include a standing header: "AI: add ideas here whenever you notice one during other work. Founder: ask 'give me improvement ideas' anytime."
- [ ] **Step 2: Commit** `git add docs/brain/ideas-backlog.md && git commit -m "brain: seeded ideas backlog" && git push`

---

### Task 13: `CLAUDE.md` index + maintenance rule

**Files:**
- Create: `CLAUDE.md` (repo root — confirmed absent today)

- [ ] **Step 1: Write `CLAUDE.md`** — MUST be ≤50 lines. Exact skeleton (fill the one-liners from the finished brain files):

```markdown
# Math Tracker — start here

Tutoring-center app: scheduling, sheets, scoring, progression, analytics.
Stack: Next.js 16 App Router + Convex + Clerk. Founder is non-technical.

## Your role: co-founder & mentor, not order-taker
You know this app better than anyone. Act like it: be honest and direct.
If the founder's idea conflicts with purpose.md, past decisions, or won't work —
say so plainly and explain why BEFORE building. Proactively suggest growth moves.
Protect the app's quality like your own company.

## Brain (read ONLY the file your task needs)
- Why the app exists, mission, non-negotiables → docs/brain/purpose.md
- What the app is, who uses it → docs/brain/overview.md
- Stack, folder map, routes, build gotchas → docs/brain/architecture.md
- Concepts glossary (slots, sheets, tracks, SR…) → docs/brain/domain.md
- Feature areas → docs/brain/features/<area>.md
  (groups-scheduling, session-sheets-scoring, learning-engine,
   tracks-leaderboard, analytics-students, messaging-settings)
- Past decisions & abandoned ideas (check BEFORE proposing) → docs/brain/decisions.md
- Dead/unwired code map (check BEFORE assuming a file is live) → docs/brain/legacy-map.md
- Improvement ideas → docs/brain/ideas-backlog.md

## Hard rules
- NEVER delete learning_engine_plan.md or algorithm_plan.md.
- Always commit AND push after a change; never ask.
- Root tsc skips convex/; typecheck backend with `npx convex codegen`. Tests: `npm test`.
- Before proposing a new feature/idea, check decisions.md (it may be already-abandoned)
  and justify it against purpose.md.

## Maintenance rule (keeps the brain alive)
Any session that changes app behavior MUST, before finishing:
1. Update the matching docs/brain/features/*.md (and domain.md if concepts changed).
2. Add new decisions to decisions.md; new ideas noticed to ideas-backlog.md.
3. Keep every brain file ≤100 lines and this file ≤50 lines. No code in brain files.
```

- [ ] **Step 2: Verify size caps**

```powershell
(Get-Content CLAUDE.md | Measure-Object -Line).Lines   # must be ≤ 50
Get-ChildItem docs\brain -Recurse -Filter *.md | Where-Object { $_.DirectoryName -notmatch '_audit' } | ForEach-Object { "$((Get-Content $_.FullName | Measure-Object -Line).Lines)`t$($_.Name)" }   # each ≤ 100
```

- [ ] **Step 3: Commit** `git add CLAUDE.md && git commit -m "brain: CLAUDE.md index + maintenance rule" && git push`

---

### Task 14: Fresh-eyes verification

- [ ] **Step 1: Cold comprehension test** — dispatch ONE subagent (general-purpose) whose entire prompt is: "Read CLAUDE.md in C:\Users\Ilham\aaa projects\math-tracker, then ONLY the brain files it points you to as needed. Answer: (1) How does a teacher score a student's sheet, and which files implement it? (2) Why does the leaderboard have both a legacy and a track system? (3) Name three abandoned ideas I should not re-propose. Do NOT search or read any other source files." Grade the answers against the brain. Any wrong/unanswerable item = fix that brain file.
- [ ] **Step 2: Founder spot-check** — show the founder `overview.md` + `purpose.md` + 3 random ideas from the backlog; ask "does the AI sound like it knows your app?" Fix anything off.
- [ ] **Step 3: Final commit + memory** — commit fixes, push, and write assistant memory `project_second_brain.md` (brain shipped, location, maintenance rule active).

---

## Self-review notes

- Spec coverage: purpose layer (T1), audit evidence (T2), core docs (T3), features (T4–9), decisions+triage (T10), legacy map (T11), backlog (T12), index+maintenance (T13), success-criteria verification (T14). Protected files honored in T10/T13.
- No deletions anywhere; `_audit/` is exempt from size caps by design (working evidence, not loaded by sessions).
- TDD does not apply (documentation artifact); verification = size-cap commands + cold comprehension test, defined concretely in T13–T14.
