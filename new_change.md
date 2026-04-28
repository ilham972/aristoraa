# Plan: Aristora — Lead Dashboard, Student Tablet App, Concept Videos, Timeline

> **For a fresh Claude session:** read this file top-to-bottom before touching any code. It contains the business rationale, every user decision captured during the planning conversation, the exact codebase state, what's already shipped (Phase 1), and the open questions you'll still need to raise.

---

## 0. Source Documents

The user runs a math tuition business in Sri Lanka, brand name **Aristora**. Two local files on disk hold the canonical spec & strategy — read them if in doubt:

- `C:\Users\Ilham\aaa projects\math-tracker\app_prompt.md` — full app specification (modules, scoring formula, pages, UI/UX guidelines). Note: the Score Entry Page section in there is commented out because the workflow changed (see section 2).
- `C:\Users\Ilham\aaa projects\math-tracker\business_strategy.txt` — "Factory Model" business plan with the 4-role machine (Lead Teacher, Correction Officer, Floor Monitor, App Operator).
- `C:\Users\Ilham\aaa projects\math-tracker\curriculum context.md` — raw curriculum JSON reference. **Do not read it unless needed** — it's already embedded as seed data inside the app.
- User memory at `C:\Users\Ilham\.claude\projects\C--Users-Ilham-aaa-projects-math-tracker\memory\` (MEMORY.md, user_profile.md, project_math_tracker.md, feedback_ux_navigation.md, feedback_theme_preference.md).

---

## 1. Business Context (what the tutor does)

- 6 modules, one per weekday (Mon = M1 Numbers, Tue = M2 Algebra, Wed = M3 Geometry, Thu = M4 Measurements, Fri = M5 Statistics, Sat = M6 Sets & Probability; Sun off).
- Grades 6–11, Sri Lankan Tamil-medium textbook. Unit names Tamil, everything else English.
- Each student has **independent progress per module** (a Grade 8 student may be on Grade 7 algebra but Grade 6 geometry).
- Scoring formula — Nth correct answer of the day = `N × 5` points. Day total = `5 × C × (C+1) / 2`. Resets every class day. Only correct answers earn points.
- Leaderboard is **per school grade** (not per classroom group), plus a center-level and future global leaderboard.
- Phone is the primary device for teachers. Tablets are new (coming in Phase 4 for students).
- Scaling target: from ~20 students to many groups, eventually multi-center franchise.

---

## 2. Why the Plan Changed (the shift the user explained)

**Old model** (in `business_strategy.txt`): Lead teaches theory live + 2 undergraduate assistants (Correction Officer + Floor Monitor).

**New model** (what this plan is built for):

1. **No live theory teaching.** The user will pre-record theory videos for every concept (YouTube, unlisted).
2. **Team shrinks to 2 people per class:** Lead + Correction Officer. Floor Monitor is removed.
3. **Lead's new job** = walk the floor, clear doubts, assign next tasks, hand over tablets for theory videos when needed. Lead needs a dedicated app page because right now:
   - Students finish an exercise → go to correction desk → after correction, they sit idle waiting for Lead to say "what's next". **This idle gap is the failure mode we're fixing.**
   - Multiple students may have doubts at the same time; Lead needs a queue.
4. **Every student gets a tablet** — full student app with:
   - Theory videos for concepts
   - Exercise details mirrored from the physical book (so the book is a preference, not a requirement)
   - A "need help" button (especially useful for homework from home)
5. **The "Law of the flow":** every finished exercise must be corrected by Correction Officer *before* the next one starts. This law makes the Correction Officer's last action the **source of truth** for each student's position. The Lead's app can infer state from latest entry timestamp — no separate live-tracking infrastructure needed.

**Outcome we're chasing:** no student ever sits idle; Lead decides each student's next task (next exercise vs concept video vs revision of past mistake) in one tap from a dedicated page.

---

## 3. User Decisions Captured During Planning (authoritative)

These came from AskUserQuestion prompts during the planning conversation. If a fresh session sees a conflict, these answers win.

| Decision | Answer |
|---|---|
| Team composition | **Lead + Correction Officer (2 people)**. No Floor Monitor. |
| Doubt signal sources | **All three: (a) Correction Officer flags wrong answers as "needs explanation"; (b) student taps "need help" in their tablet app (works from home too); (c) Lead adds manually.** |
| Past-mistakes feature UX | **Lead taps student → sees list of past wrong questions → picks one to re-assign today.** |
| Student auth | **4-digit PIN per student** (teacher sets/resets). User accepted after I explained safety (hash + lockout + name-picker two-factor + optional device binding for homework). |
| Theory video hosting | **YouTube (unlisted) — just a URL field per concept** (on the concept-type exercise row). |
| Timeline scope | **Two separate pages: (1) Live today view for during class; (2) Historical comparison across students.** |
| Tablets | **Every student has their own tablet** for the full app (theory + exercises + help button). Physical book is still a preference for doing exercises. |
| Build sequencing | **Claude recommends phases.** (This plan's Section 8.) |

---

## 4. Existing Codebase State (as of plan creation)

### Tech stack
- Next.js 16 (App Router)
- TypeScript (strict, bundler module resolution)
- Convex 1.33 (real-time DB + server functions)
- Clerk 7 (auth, username+password only, no Gmail). Instance: `topical-chicken-36.clerk.accounts.dev`
- shadcn/ui (Button, Card, Input, Label, Select, Tabs, Badge, ScrollArea, Separator, DropdownMenu, Dialog, Sheet, Drawer, Sonner toasts)
- Tailwind CSS v4, dark navy + teal theme, mobile-first

### Routes (`src/app/`)
- `/` → redirects to `/score-entry`
- `/score-entry/page.tsx` — 1000+ line monolith; correction officer's scoring + attendance flow
- `/progress/page.tsx` — student progress dashboard
- `/leaderboard/page.tsx` — leaderboard
- `/students/page.tsx` — student management
- `/settings/page.tsx` — admin settings
- `/curriculum/page.tsx` — curriculum management (teacher adds exercises + concepts)
- `/more/page.tsx` — misc
- `/sign-in/[[...sign-in]]/page.tsx` — Clerk login

### Convex tables (see `convex/schema.ts`)
`students`, `exercises`, `entries`, `settings`, `centers`, `rooms`, `scheduleSlots`, `slotStudents`, `slotOverrides`, `teachers`, `slotTeachers`, `attendance`, `studentModulePositions`, `sessionSubmissions`, `textbooks`, `unitMetadata`, `textbookPages`, **and now `doubts`** (added in Phase 1).

Key details:
- `exercises.type` already exists as `"exercise" | "concept"` — we reuse this instead of creating a separate concepts table.
- `entries.questions` is `v.any()` — actual shape is `Record<string, 'correct' | 'wrong' | 'skipped' | 'unmarked'>`. **This is why we chose not to embed `needsExplanation` inside the question shape — it would break every existing entry.** We create a `doubts` row instead.
- `teachers.role` is `v.string()` — currently stores `'admin'` or `'teacher'`. We will extend to `'admin' | 'lead' | 'correction'` without a schema change (just string value).

### Important source files
- `convex/schema.ts` — all tables
- `convex/entries.ts` — score entry CRUD (`add`, `update`, `getByStudentAndDate`, etc.)
- `convex/exercises.ts` — exercise CRUD (`add`, `bulkAdd`, `addConcept`, `update`, `setConceptVideo` [Phase 1])
- `convex/doubts.ts` — [Phase 1] doubt queue CRUD
- `convex/teachers.ts` — role enforcement (first teacher = admin bootstrap)
- `convex/attendance.ts` — session attendance
- `convex/studentModulePositions.ts` — per-student per-module position (grade + term)
- `src/app/score-entry/page.tsx` — the monolith; correction flagging UI goes here in Phase 2
- `src/components/sub-question-inline.tsx` — sub-question scoring pattern (mirror for flag toggle)
- `src/components/navigation.tsx` — bottom nav; add "Lead" tab gated by role in Phase 3
- `src/hooks/useActiveSlot.ts` — detects active class slot from time-of-day (reuse)
- `src/hooks/useCurrentTeacher.ts` — Clerk → teacher lookup (reuse)
- `src/lib/curriculum-data.ts` — hardcoded curriculum seed; **do NOT put videoUrl here**, it lives on `exercises` rows with `type: "concept"`
- `src/lib/scoring.ts` — N × 5 formula; do not touch
- `src/lib/types.ts` — shared frontend types (`Exercise`, `Doubt`, etc. — Phase 1 added)

### Existing roles (what is and isn't there)
- `teachers.role` field exists.
- Bootstrap: first registered teacher becomes `'admin'`. Only admins can add/remove other teachers.
- Teachers see only their assigned slots (via `slotTeachers` index).
- **No existing distinction between Lead and Correction Officer roles.** Phase 3 adds this.
- No student auth exists yet — students are data records, not user accounts.

### What already covers what we need
- Real-time reactive queries via `useQuery` / `useMutation` from `convex/react` — perfect for Lead's live dashboard.
- Attendance tracking + session submissions — Lead's live view can reuse attendance data.
- `exercises.type === 'concept'` rows — ready to receive `videoUrl`.
- Sub-question structure on `exercises.subQuestions` — flag UI in Phase 2 must respect this.

---

## 5. Data Model Additions

### Already done in Phase 1 ✅
- `exercises.videoUrl: string?` (YouTube unlisted URL for concept-type rows)
- `exercises.conceptSummary: string?` (short text next to video)
- New `doubts` table with fields: `studentId`, `centerId?`, `slotId?`, `raisedAt: number`, `source: "correction" | "student-app" | "lead-manual"`, `status: "pending" | "in-progress" | "resolved"`, `exerciseId?`, `conceptExerciseId?`, `questionIndex?`, `note?`, `resolvedAt?`, `resolvedByTeacherId?`
  - Indexes: `by_status`, `by_student`, `by_center_status`, `by_slot_status`
- `convex/doubts.ts` with queries: `listPending(centerId?)`, `listBySlotPending(slotId)`, `listByStudent(studentId)`; mutations: `create`, `markInProgress`, `resolve`, `remove`
- `convex/exercises.ts` → `setConceptVideo` mutation
- `src/lib/types.ts` → added `Exercise.type`/`videoUrl`/`conceptSummary`, `Doubt`, `DoubtSource`, `DoubtStatus`

### Still to come (Phase 4+)
- Student auth fields on `students`: `pinHash`, `pinSetAt`, `failedAttempts`, `lockedUntil?`, `deviceTokens?` (for optional home device binding)
- `teachers.role` values extended to include `'lead'` and `'correction'` — string value change only, no schema change
- **Open question (Phase 2):** concept ↔ exercise linkage. When Correction Officer flags a wrong question, which concept video should it map to? Options we'll have to pick between:
  - Add `exercises.conceptIds: string[]` — teacher explicitly tags an exercise with the concepts it tests
  - Auto-map by position in the unit (concept rows sit between exercise rows in the `order` sequence)
  - Leave it as nullable — flag just marks "needs SOME explanation", Lead picks the concept manually

**Decision not yet made.** Recommend defaulting to manual (Lead picks concept when assigning) for Phase 2/3, add `conceptIds` only if it becomes painful.

---

## 6. Phase 1 — Data Model Foundation ✅ COMPLETED

Status: shipped. Type-check passes (`npx tsc --noEmit -p tsconfig.json` → EXIT=0). Convex `_generated/api.d.ts` will regenerate on next `npx convex dev` run.

Files changed:
1. `convex/schema.ts` — added `videoUrl`, `conceptSummary` to `exercises`; added `doubts` table + 4 indexes
2. `convex/doubts.ts` (new) — full CRUD
3. `convex/exercises.ts` — added `setConceptVideo` mutation
4. `src/lib/types.ts` — added `Exercise.type/videoUrl/conceptSummary`, `Doubt`, `DoubtSource`, `DoubtStatus`

**No UI yet. No migration needed.** Existing exercises have `videoUrl === undefined`; no existing `doubts` rows.

Verification for the user to perform:
- Run `npx convex dev` — schema should deploy without errors.
- Seed a concept-type exercise with a YouTube URL via Convex dashboard or add a tiny admin UI in Phase 3.

---

## 7. Phase 2 — Correction Officer: "Needs Explanation" Flag

**Goal:** Correction Officer can flag wrong answers. Each flagged-wrong question creates a pending `doubts` row. Ready to be surfaced on Lead's dashboard (Phase 3).

### UX
- In `src/app/score-entry/page.tsx`, when a question is toggled to `wrong`, render a small secondary toggle next to the ✗: a flag icon (lucide `Flag`). Tap once to mark that wrong answer as "needs Lead's explanation".
- Must work for sub-questions too (see `src/components/sub-question-inline.tsx`).
- Visual: flag icon amber/orange when active, muted when inactive. No confirmation needed — it's a quick tap.
- Persist flag state in the component's local state alongside the question states. Could live as a parallel `Record<string, boolean>` state called `flaggedKeys`.

### Save flow
- When Correction Officer saves a session (or during live-save if that's how the existing code works), for each question where `state === 'wrong'` AND `flagged === true`, call `api.doubts.create` with:
  - `studentId`, `centerId` (if known), `slotId` (if known), `source: 'correction'`, `exerciseId`, `questionIndex: parseInt(key)` (or whatever the key is — check current shape), `note: optional`.
- Do NOT re-create doubts on edit if already created — check by `(studentId, exerciseId, questionIndex, status='pending')` before inserting. Add a helper query if needed.
- If a flagged question is un-flagged before save, skip creating. If it was saved earlier and now un-flagged, we should probably soft-resolve the existing pending doubt. Safest: add a `convex/doubts.ts` mutation `removePendingForQuestion(studentId, exerciseId, questionIndex)` and call it when un-flagging.

### Files to modify
- `src/app/score-entry/page.tsx` — add flagged state + flag icon UI on wrong questions
- `src/components/sub-question-inline.tsx` — mirror the flag UI for sub-questions
- `convex/doubts.ts` — add `removePendingForQuestion` helper mutation
- Probably a small `src/components/flag-toggle.tsx` for reuse

### Verification
- Mark a question wrong → tap flag → save → check Convex dashboard shows a pending `doubts` row with `source: 'correction'`.
- Reload the score-entry page → flag state should persist (from the saved `doubts` row, or from localStorage if that's the existing pattern).
- Un-flag before saving → no doubt row.
- Un-flag a previously-saved flag → pending doubt is removed.

---

## 8. Phase 3 — Lead's Live Dashboard (`/lead`)

**This is the highest-leverage slice. Ship this before Phase 4.** It alone solves the "students sitting idle" problem even without the tablet app.

### Access control
- Extend `teachers.role` allowed values: `'admin' | 'lead' | 'correction'`. Migration: existing non-admin teachers default to `'correction'`.
- Add settings UI (on `/settings`) to let admin set each teacher's role.
- In `src/components/navigation.tsx`, show "Lead" bottom-nav item only when `role === 'lead' || role === 'admin'`.
- Redirect a Correction Officer away from `/lead` back to `/score-entry`.

### Page layout (mobile-first, since Lead also uses a phone)
New route: `src/app/lead/page.tsx`.

**Top strip: Doubt queue** (horizontal scroll).
- One card per pending `doubts` row for today's slot.
- Each card shows: student name (big), source badge (correction / app / manual), concept name (if linked), "Resolve" button, tap-to-expand for note + past wrong answers on same concept.
- Real-time — uses `api.doubts.listBySlotPending` via `useQuery`, updates live when Correction Officer flags.

**Student grid** (each student in today's slot as a card).
- Name + current module position (from latest `entries` + `studentModulePositions`).
- **Inferred state** from most recent event:
  - Within 5 min of last correction → "Just corrected, choose next" (amber accent)
  - 5–20 min → "Probably doing exercise" (neutral)
  - \>20 min with no new entry → "Possibly idle — check" (red accent)
  - Has pending doubt → "Needs explanation" (orange accent)
  - Thresholds configurable in `settings` table later.
- **Assign-next action** (tap student card → action sheet):
  - "Next exercise" — auto-suggested from curriculum order + current position
  - "Watch concept video" — list of concepts in current/next unit that have `videoUrl` set
  - "Redo past mistake" — opens past-mistakes drill (see below)
  - "Mark as resting" — benign no-op to clear the red accent
- Action persists as… TBD. Options:
  - Write a `assignments` or `currentTask` table keyed by `(studentId, date)`
  - Just show the choice on Lead's screen as an ephemeral UI state until student arrives at correction desk again
  - **Recommended for Phase 3:** ephemeral, no new table. Phase 4 (student app) requires a persistent "next task" → add a `currentAssignments` table then.

**Past-mistakes drill:**
- Query `entries` by studentId, filter in-app for questions where `state === 'wrong'`.
- Group by exercise, newest first.
- Tap one → mark a "redo" note (ephemeral for now, persistent in Phase 4).

### Convex aggregated queries
- `convex/lead.ts` (new): `liveRoster({ slotId, date })` returns `{ students: [], latestEntryByStudentId: {...}, pendingDoubtsByStudentId: {...}, positionsByStudentId: {...} }` in one shot to avoid N+1 round trips.

### Files
- `src/app/lead/page.tsx` (new)
- `src/components/lead/student-card.tsx`, `doubt-card.tsx`, `assign-sheet.tsx` (new)
- `convex/lead.ts` (new)
- `convex/teachers.ts` — role setter + migration helper
- `src/components/navigation.tsx` — role-gated nav
- `src/app/settings/` — UI to set teacher role

### Verification
- Sign in as teacher with `role: 'lead'` → `/lead` renders with today's slot students.
- Correction Officer flags a wrong answer → Lead's doubt queue card appears within ~1 sec (Convex reactive).
- Tap student → Assign sheet → picks "Next exercise" → correct next from curriculum order shown.
- Open `/lead` as `role: 'correction'` → redirected to `/score-entry`.

---

## 9. Phase 4 — Student Tablet App

**Goal:** Every student logs into their tablet, sees their assigned next task, plays concept videos, views exercise details mirrored from the physical book, taps "I need help" from class or home.

### Student auth — safety analysis (for user's concern)
User's concern: "is 4-digit PIN safe? is this scalable?"

**Answer: Yes, safe enough for this use case. Here's why and the mitigations:**
1. **Blast radius is tiny.** A PIN breach exposes one student's math progress. No finance, no PII beyond name + parent phone + school grade. Compare to a banking PIN — entirely different stakes.
2. **Brute force mitigations:**
   - Store `pinHash` (bcrypt cost 10), never plaintext.
   - Lock account after 5 wrong attempts for 10 min.
   - **Two-factor at login**: student picks their name from a list AND enters PIN (so an attacker needs to know the name — effectively multiplies the search space).
3. **Teacher recovery:** admin can reset PIN from student management page. No email/SMS recovery needed.
4. **Scalable:** yes — stored in `students` table, verified server-side via a `studentAuth.verifyPin` Convex mutation that returns a short-lived session token stored in student tablet's localStorage. Convex handles this at any scale. No third-party auth costs.
5. **Device binding for homework:** first time student logs in from a device, tablet gets a 30-day token. Skips PIN next time. Trade-off: convenient for kids at home, slightly weaker security (but again, low stakes).

### Routes (`src/app/student/`)
- `/student/login` — pick name from list + enter 4-digit PIN (`src/components/ui/pin-pad.tsx` — big numeric keypad)
- `/student/home` — "Your next task" card (filled by Lead's assignment from Phase 3's `currentAssignments` table)
- `/student/concept/[id]` — YouTube embed + summary + "mark as watched" button
- `/student/exercise/[id]` — exercise details (name, book page number, question count, sub-questions) + "Start" / "I'm done → bring book to correction"
- `/student/help` — big "I need help" button + optional text note → inserts `doubts` row with `source: 'student-app'`

### Convex additions
- `convex/studentAuth.ts` — `setPin(studentId, pin)` [admin-only], `verifyPin(studentId, pin)` [public, returns token], `resetPin(studentId)` [admin-only]
- `src/hooks/useCurrentStudent.ts` — read student token from localStorage, query student profile
- Schema addition: `students.pinHash`, `pinSetAt`, `failedAttempts`, `lockedUntil?`, `deviceTokens?` (`v.optional(v.array(v.object({...})))` for device binding)
- **`currentAssignments` table** (if Phase 3 chose ephemeral): `{ studentId, date, type: 'exercise' | 'concept' | 'redo', exerciseId, note?, assignedAt, assignedByTeacherId, completedAt? }` — Lead writes, student reads.

### Files
- `src/app/student/layout.tsx` — student-only layout, no teacher navigation
- `src/app/student/login/page.tsx`, `home/page.tsx`, `concept/[id]/page.tsx`, `exercise/[id]/page.tsx`, `help/page.tsx` (all new)
- `src/components/ui/pin-pad.tsx` (new)
- `convex/studentAuth.ts`, `convex/currentAssignments.ts` (new)
- `src/app/students/page.tsx` — add "Set PIN" button per student, show last login

### Verification
- Create student with PIN `1234` in admin UI.
- Log in on tablet → home shows current task.
- Lead assigns "concept video X" → student's home updates in real-time.
- Student taps "I need help" → Lead's queue shows it instantly.
- 5 wrong PIN attempts → account locks for 10 min.

---

## 10. Phase 5 — Timeline Pages (two separate, per user's decision)

### 5a. Per-student timeline (`/timeline/student/[id]`)
- Horizontal scroll by date. Each day = column with exercises done, correct/wrong counts, concepts watched (from Phase 4's `currentAssignments` completions).
- Filter by module. Tap a day → see its entries.

### 5b. Cross-student comparison (`/timeline/compare`)
- Pick a grade + a module.
- Parallel timeline strips, one per student, aligned by date. Visual bars show progress velocity.
- Use case: Lead/admin spotting students who are falling behind peers.

### Files
- `src/app/timeline/student/[id]/page.tsx`, `compare/page.tsx`
- `convex/timeline.ts` — aggregate queries over `entries` by `studentId + date + moduleId`

### Verification
- With 3 students, 1 week of entries → per-student timeline shows day columns with correct counts; compare page shows 3 parallel strips.

---

## 11. Build Order (recommended)

1. ✅ **Phase 1 — schema foundation** (done)
2. **Phase 2 — Correction flag + auto-doubt creation** (small, unlocks Lead queue)
3. **Phase 3 — Lead's live dashboard** (biggest value; solves idle-student pain without tablets)
4. **Phase 4 — Student tablet app** (only after Phase 3 is validated in real class)
5. **Phase 5 — Timeline pages** (analytics layer on top of everything)

Each phase is independently shippable. Do not merge 3 into 4. Phase 3 alone is a complete product improvement even if students never get tablets.

---

## 12. Known Open Questions (raise with user before implementing)

1. **Concept ↔ exercise linkage** (needed mid Phase 2 / Phase 3):
   - Option A: teacher tags `exercises.conceptIds: string[]` explicitly when adding an exercise.
   - Option B: auto-infer by position (concept rows sit before/after exercise rows in `order`).
   - Option C: Lead picks concept manually when assigning (no auto-link). ← simplest; recommend until painful.
2. **Persistent vs ephemeral "current assignment"** (Phase 3 → 4 boundary):
   - Ephemeral (Phase 3 only, screen state) is simpler but can't feed student tablet.
   - Persistent `currentAssignments` table is unavoidable once Phase 4 ships.
   - Recommend: build it persistent from the start of Phase 3 to avoid rewrite.
3. **Inferred-state thresholds** (5 min / 20 min) are guesses. Consider making them configurable in `settings`.
4. **Student name collisions** on login picker — two students called "Saman" — show school name + grade beside name.
5. **Homework help-button spam** — rate limit: max 3 pending `doubts` per student at a time.
6. **Video playback offline / bad Wi-Fi** — YouTube requires internet. Centers with flaky networks may later need Convex storage fallback with downloadable MP4. Not blocking for MVP.
7. **Role migration script** — if production has teachers with role `'teacher'`, backfill to `'correction'` in a one-off `convex/migrations/assignRoles.ts` (or just update manually via dashboard for small user count).
8. **Does the user want student tablets to also show the leaderboard?** Not discussed yet.

---

## 13. End-to-End Happy Path Verification (after all phases)

1. Admin creates 3 students + sets their PINs.
2. Admin creates a slot; assigns Teacher-A as `'lead'`, Teacher-B as `'correction'`.
3. Lead opens `/lead` → 3 students show as "idle" (no entries today).
4. Correction Officer marks Student A's Ex 3.1 Q3 as wrong + flag.
5. Lead sees red "needs explanation" badge on Student A within ~1 sec.
6. Lead taps Student A → Assign sheet → "Watch concept video" → picks concept video for Q3.
7. Student A's tablet home updates → shows the concept video as next task.
8. Student A watches → taps "mark as watched" → goes back to book → redoes Q3.
9. Correction Officer re-corrects → now correct → pending doubt auto-resolves (or Lead resolves manually).
10. End of day, admin opens `/timeline/compare` → Student A's progress strip visible next to peers.

---

## 14. Style & Convention Reminders

- **Mobile-first everywhere.** Phone is teacher's primary; tablet is student's.
- **Tamil unit names only.** All other text English.
- **Module colors** (use consistently):
  - M1 `#1B4F72` · M2 `#6C3483` · M3 `#1E8449` · M4 `#B9770E` · M5 `#C0392B` · M6 `#2E86C1`
- **Dark navy + teal accent** theme (memory: `feedback_theme_preference.md`).
- Prefer inline filters / accordions over deep drill-down navigation (memory: `feedback_ux_navigation.md`).
- Do not add emojis to files/code unless user asks.
- Follow existing patterns — the score-entry page has live-save pattern via `liveEntryIdRef`; reuse for flag persistence.
- All Convex queries/mutations must check `ctx.auth.getUserIdentity()` — existing pattern.
- Convex codegen: after schema changes, run `npx convex dev` to regenerate `convex/_generated/api.d.ts`.
