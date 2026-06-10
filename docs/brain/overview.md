# Overview — what Math Tracker is

Math Tracker is the internal operations app of **Aristora**, a tutoring business
built on a quality-over-bulk promise: classes of max 10 students, personalized
teaching, and a predicted-time guarantee of A results (see purpose.md — read it
to understand WHY anything here exists).

## What it does (one line per pillar)
- **Scheduling** — group-centric timetable (/groups): groups, slots, rooms,
  teachers, attendance; back-to-back slots fuse into multi-hour sessions.
- **Sheets & scoring** — per-session worksheet generation (PDF) from a question
  bank, scored per question inside the session screen.
- **Learning engine** — the moat. Spaced repetition / adaptive retrieval /
  interleaving planner that picks each student's next questions; blueprint,
  coverage and exam-calendar tools steer it. THE priority area (purpose.md).
- **Progression** — tracks (named cross-grade levels), points, leagues,
  leaderboard, railway-style progress map.
- **Analytics** — executive dashboard (5 tabs), timelines, per-student views.
- **Messaging** — WhatsApp-based parent/teacher messaging hub (templates,
  queue, broadcasts); the actual WhatsApp gateway (Phase W) is NOT built yet.

## Who uses it
Teachers and admins only — never students or parents. Today the founder is the
sole user, running ~40 students. The founder is non-technical: all UI must be
self-explanatory, and explanations to him should be plain language.

## State of the system
Live in production (Convex production backend) and used daily for real classes.
Built iteratively over ~6 months of frequently-changed ideas, so the repo
contains unwired remnants of abandoned directions — see legacy-map.md before
assuming any file is live, and decisions.md before re-proposing an old idea.

## Where to go next
- Stack, folders, routes, build commands → architecture.md
- Concept glossary (slot, sheet, track, …) → domain.md
- Per-feature truth → features/*.md
