# Decisions — why things are the way they are

Check this BEFORE proposing anything. If an idea appears here as abandoned,
don't re-propose it without new evidence. Format: decision — chose X over Y
because Z.

## The big pivot
- **Learning engine over operations-only** — the app started as score
  tracking + leaderboard (app_prompt.md). Founder realized operations alone
  give no result guarantee: "we don't have standard SOP for service delivery"
  (convesation_about_engine.md). Pivot: SR/AR/interleaving engine that hands
  each student a personal SHEET instead of page+exercise numbers. This became
  the moat and the priority compass (purpose.md).

## Superseded designs (do NOT resurrect)
- **Weekday→module mapping** (Mon=Numbers … 6 modules, 6 days) — original
  backbone, killed by the path-driven redesign: teacher-curated unit path,
  then track-driven Main block after the exam-mode change. Remnants:
  MODULE_DAYS/getTodayModule in src/lib/types.ts (unused).
- **Per-exercise Score tab** — merged into the sheet-based Sheets tab
  (2026-06-07). Scoring is sheet-only; no sheet → no score.
- **sharp for PDF imaging** — abandoned because sharp's native binaries don't
  run in the Convex serverless runtime; replaced with pure-JS pdf-lib
  clipping. sharp still sits in package.json, dead.
- **Grade-based points/position** — replaced by cross-grade named TRACKS +
  leagues + railway map. Legacy still primary until LEADERBOARD_PRIMARY flips
  (founder-gated; see tracks-leaderboard.md).
- **Daily leaderboard images to WhatsApp groups** (app_prompt era) —
  superseded by Phase W messaging hub + weekly cards.
- **Automatic exam-week detection** — exam mode is a MANUAL switch
  (examModeActive) + daily alert; auto-detection rejected.
- **Per-module progress grid on /students cards** (8+ bars per student) —
  removed 2026-06-17. Cards now show only ONE overall %; founder rejected the
  module breakdown (and a tap-to-expand accordion) entirely — all actions +
  track picker sit inline on the compact card. Filters live in one row.
- **Required parentPhone on student add/edit** — caused silent save failures
  (normalizeToE164SL threw on blank/odd input, no catch). Now optional:
  validate only when filled, store "" otherwise, surface errors as toasts.
- **Standalone Sheets management UI** (inspector drawer/body, student rows,
  bulk actions) — superseded by the merged session Sheets tab; files dead.
- **Fixed-width question slots in sheet PDFs** (every crop stretched to
  80mm) — replaced 2026-06-12 by natural-size rendering (crop prints at its
  real textbook size) because mixed text sizes killed the exam-paper feel.
- **Typing the WHOLE question bank as text** — rejected 2026-06-12 (nightly
  typing tax, diagrams stay images anyway). Superseded same day by OPT-IN
  typed overrides: per-question/stem `overrideText` + browser-typeset PNG
  (MathJax math, canvas Tamil) stored on questionBank; PDF prefers it.
  Chose client-side render-at-save over server-side math (MathJax/canvas
  can't run in the Convex runtime; zero per-PDF cost).

## Paper classes / Library (2026-06-17)
- **Separate tables, NOT a scheduleSlots flag** — chose isolated paperBlocks/
  paperBlockStudents/paperAttendance over overloading scheduleSlots, so paper
  classes never drag in sheets/scoring/engine/leaderboard. Scope is attendance
  + billing only (founder's explicit call).
- **One paper-block primitive for both cases** — "fixed group paper class" and
  "pull individuals in on free days" are the same object: a block you fill by
  dropping a whole group OR one student at a time. No second system.
- **Flat 100/student/DAY** — two blocks same day still bill once (per-day, not
  per-block). Paper revenue reported separately from 250/hr personal revenue.
- **Capacity lives on the ROOM** (rooms.capacity), not the block — small rooms
  6, big rooms 10+. Hard cap; availability only WARNS (lead can override).
- **Availability = stored outside windows + derived personal slots** — only the
  night-class/outside commitments are entered (per student); the app already
  knows personal-class times from group slots, so it combines both for free.
- **UI = 4th "Library" view in /groups** (Option A), grid by room. Unified
  overlay on the Week grid (Option B) deferred to phase 2 (ideas-backlog).

## Standing constraints (decided, still binding)
- **Stem/leaf**: planner picks LEAF sub-questions only; stems glued at
  render; noStem flag for instruction-less leaves.
- **repeatCount remedy**: TEMPORARY count-based cooldown stopgap; must NOT
  touch SR/mastery; don't extend it.
- **Messaging: NO cron** — every batch human-triggered; all WhatsApp I/O via
  provider.ts chokepoint; Open-WA chosen over Meta Cloud (free, ban risk
  accepted, swap = one file).
- **Day-of-week = 1=Mon..7=Sun** everywhere (a 0-based assumption once
  silently dropped Sunday slots).
- **Deferred, not abandoned**: student tablet app + concept videos
  (new_change.md), W.6 homework PDF, W.7 predicted-vs-actual reports, W.8 fee
  reminders, weekly-card image variant.

## Plan-file verdicts (root *.md)
| File | Verdict |
|---|---|
| learning_engine_plan.md | **CURRENT** strategy — NEVER delete |
| algorithm_plan.md | **CURRENT** tactical spec — NEVER delete |
| whatsapp_integration_plan.md | ACTIVE spec (W.1–W.5 shipped; §17 has infra creds) |
| sheet_structure_redesign_plan.md | ACTIVE spec (path-driven sheets) |
| sheet_scoring_plan.md | ACTIVE spec (sheet-synced scoring) |
| business_strategy.txt | REFERENCE — "Factory Model" 4-role business plan |
| curriculum context.md | REFERENCE — raw Tamil unit lists (seed input) |
| app_prompt.md | HISTORICAL — original spec; Score section already obsolete |
| new_change.md | HISTORICAL — Lead dashboard (built) + tablet app (deferred) |
| convesation_about_engine.md | HISTORICAL — raw pivot conversation |
| phase_0_4/0_5/0_6_plan.md | HISTORICAL — executed build plans |
| open-wa-intro.md | HISTORICAL — vendor docs copy |
