# Second Brain — Design

**Date:** 2026-06-11
**Status:** Approved by founder
**Goal:** A repo-resident knowledge system so any AI session understands Math Tracker without re-reading the codebase, keeps token cost low via layered loading, and can proactively suggest improvements.

## Problem

The app is 6 months old, works in production, but:

- Every AI session starts blind and burns 20k–60k tokens re-discovering the codebase.
- The AI can never be proactive; it only sees the slice of code it is pointed at.
- Many iterations left behind dead code: old idea pages exist in the repo but are NOT wired to the live site.
- The repo root holds many plan `.md` files; most describe abandoned directions.

## Solution overview

A layered documentation system in the repo. The AI never reads the whole brain — it auto-loads only a tiny index, then opens exactly one deeper file per task.

```
CLAUDE.md                      ← entry door, auto-loaded every session. ≤ 50 lines. Points, never explains.
docs/brain/
  overview.md                  ← what Math Tracker is, in founder language
  purpose.md                   ← WHY the app exists: mission, who the students/teachers
                                 are, business model, what success looks like, vision
  architecture.md              ← tech map: stack, folder map, what talks to what
  domain.md                    ← concepts: tracks, sheets, slots, sessions, scoring,
                                 groups, points, SR/learning engine
  features/<area>.md           ← one file per feature area; LIVE truth only
  decisions.md                 ← abandoned ideas + why ("we tried X, dropped it because Y")
  legacy-map.md                ← every dead/unwired file: safe-to-delete vs needs-founder-decision
  ideas-backlog.md             ← ranked improvement suggestions, AI-maintained
```

## Token-cost design rules (hard, non-negotiable)

1. `CLAUDE.md` ≤ 50 lines (~500 tokens). Table of contents only.
2. Each feature file ≤ ~100 lines. Grows past that → must be split.
3. No code copied into brain files. Maps and reasons only ("scoring logic lives in
   `convex/scoring.ts`"), never code content.
4. Maintenance updates must keep files within their size caps.

Result: total brain may be ~1,500 lines, but any single session loads ~150.

## Audit method (one big pass — founder's chosen execution mode)

- Trace reachability from the live site's entry points (deployed pages + backend
  functions) outward. Reachable = live, gets documented in `features/`.
  Unreachable = listed in `legacy-map.md`.
- Dead code is identified by evidence (reachability), never by what plan docs say.
- **Nothing is deleted or moved in this phase.** Zero risk to the live site.

## Founder interview (the purpose layer)

The founder's explicit goal: the AI should know the app AND its purpose better than
the founder himself. Code cannot reveal purpose, so the audit includes a short
founder interview (plain-language questions, one at a time) covering: mission, who
the students and teachers are, how the business earns/grows, what success looks
like in 1–2 years, and non-negotiables. Answers are distilled into `purpose.md`.
Every improvement suggestion in `ideas-backlog.md` must be justified against
`purpose.md` — ideas serve the mission, not just code quality.

## Plan-file triage

- `learning_engine_plan.md` and `algorithm_plan.md` are CURRENT and PROTECTED —
  never delete (also recorded in assistant permanent memory).
- All other root plan docs are historical: listed in `legacy-map.md`; their
  abandoned ideas get one-line summaries in `decisions.md` so knowledge isn't lost.
- Archiving (moving files) happens only later, with explicit founder approval.

## Maintenance rule

`CLAUDE.md` carries a standing instruction: any session that changes the app must
update the matching brain file before finishing, staying within size caps. This is
what keeps the brain alive instead of becoming a stale snapshot.

## Proactive suggestions

`ideas-backlog.md` is seeded during the audit (auditing is when weaknesses surface)
and grows over time. Founder can ask "give me improvement ideas" and the AI answers
from the backlog + feature files, ranked by impact.

## Out of scope (separate later phases)

- Deleting dead code or reorganizing folders (cleanup phase, guided by `legacy-map.md`).
- Any behavior change to the app.

## Success criteria

1. A fresh AI session, given only `CLAUDE.md`, can correctly describe any feature
   area and locate its code without searching.
2. Typical task context cost drops from tens of thousands of tokens to a few thousand.
3. `legacy-map.md` covers every unwired file in the repo with a verdict.
4. Founder can request improvement ideas and get specific, app-aware suggestions.
5. The AI can answer "why does this feature exist?" and evaluate any new idea
   against the app's mission — i.e., it knows the purpose, not just the code.
