# Ideas backlog — AI-maintained improvement queue

AI: add ideas here whenever you notice one during other work; every idea must
name the purpose.md line it serves. Founder: ask "give me improvement ideas"
anytime. Effort S/M/L · Impact 1–5 · sorted by impact.

| # | Idea | Area | Serves (purpose.md) | Effort | Impact |
|---|---|---|---|---|---|
| 1 | **Predicted-time-to-A ETA per student.** The brand promise ("A result within predicted time") exists nowhere as a number. Engine has all inputs: mastery, exam calendar, pacing, attempt history. Show per-student ETA + on/off-track status. | learning engine | Mission: the core promise | L | 5 |
| 2 | **Holdout validation surface.** learning_engine_plan's centerpiece (cumulative-exam holdout loop) needs a visible report: predicted vs actual per exam, error trend. Without it the moat can't be proven to parents or to yourself. Feeds W.7. | learning engine | Mission: A-result guarantee | M | 5 |
| 3 | **Finish the track flip** (backfill prod → LEADERBOARD_PRIMARY → runtime test). Unblocks retiring the whole legacy points system and the railway map becomes real. | progression | Brand: visible progression | S | 4 |
| 4 | **Acceptance-test Phase W + fill parentPhone data.** Messaging is built and the gateway is live, but all 40 students lack parent phones, so zero parent value is delivered today. One data-entry session unlocks absence alerts + weekly cards (parent-trust moat). | messaging | Brand: parent trust | S | 4 |
| 5 | **Wire studentsAtRisk → messaging.** Analytics already flags at-risk students; absence-alert plumbing exists. Close the loop: at-risk → proactive parent contact draft. | analytics+messaging | Personalized education | M | 4 |
| 6 | **Finish Phase F.6–F.8** (reader migration, data migration, retire old scheduling tab) — removes a dual-running legacy surface and its confusion risk. | scheduling | Teacher efficiency | M | 3 |
| 7 | **Engine quality metrics at finalize.** finalizeSheetScoring is the single funnel — log per-sheet completion %, factor distributions, gap counts to spot planner drift early. | learning engine | Mission: predictable results | M | 3 |
| 8 | **Scale-proof legacy pages.** /progress + /leaderboard aggregate full entries client-side — fine at 40 students, breaks at hundreds. Dies anyway if #3 ships; only do this if the flip stalls. | progression | Scale (multi-center) | M | 2 |
| 9 | **Split the giants** (lead-tab 1487, groups/page 1030, edit-group-dialog 816 lines) for maintainability as teacher count grows. Opportunistic, not urgent. | codebase health | Scale-readiness | M | 2 |
| 10 | **Cleanup phase from legacy-map.md** (~3k+ dead lines + 5 dead deps). Cheap insurance against future confusion; do after #3 retires the transition rows. | codebase health | Scale-readiness | S | 2 |

## Standing guidance for ranking
The learning engine is the priority compass (purpose.md): engine ideas
outrank everything at equal impact. Brand-trust features (parent-facing
proof) come second. Pure code health ranks last unless it blocks the first
two.
