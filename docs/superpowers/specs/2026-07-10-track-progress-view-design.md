# Track Progress view — design spec (2026-07-10)

Founder-approved design. Answers the question the app cannot answer today:
**"Which unit is finished, which is in progress, how much is left, and will we
make it before the exam?"** — per student, on their track. Backlog idea #1b.

## Decisions locked with the founder (do not re-litigate)

1. **Placement**: full rich view on a per-student page (`/students/[id]/progress`)
   PLUS a compact one-line strip in the session Sheets tab. One shared query.
2. **Done rule — two-tier**: a unit is **TAUGHT** (blue ✓) when every concept
   has ≥1 scored attempt; **MASTERED** (teal ★) when additionally its mean
   mastery ≥ `MASTERY_THRESHOLD` (0.75). No single "done" state.
3. **Predictions included**: per-unit "~N sessions left" AND a projected track
   finish date compared to the exam date, with an on-track/behind badge.
4. **Visual style: metro line** — the track drawn as a vertical railway;
   units are stations; pulsing marker at the current unit; exam flag terminus.
   Matches the existing dark-navy + teal transit brand.
5. **Architecture: compute fresh on open** (live reactive query, no new
   tables, no saved-progress copy that can drift). The `unitCompletions`
   event log for parent messaging is explicitly deferred.

## Backend

### New file `convex/learningEngine/trackProgress.ts`

One query, `trackProgressForStudent`:

```ts
args: {
  studentId: Id<"students">,
  // Client-supplied curriculum metadata (Convex can't read curriculum-data.ts;
  // same pattern as tracks.listCandidateUnitsForTrack). ALL units, any grade.
  units: Array<{ unitId: string; unitName: string; grade: number; term: number }>,
  // Client-computed unitIdsForScope(resolveGradeByModule(student)) — used to
  // flag track units the planner would silently skip (scope∩track bug).
  scopeUnitIds: string[],
}
```

Returns (shape, not code):

- `status: "ok" | "no-track"` (+ null on missing student/auth, matching planner queries)
- `track: { name, level, targetGrade, targetTerm }`
- `summary: { unitsTotal, unitsTaught, unitsMastered, conceptsTotal, conceptsTaught }`
- `prediction: { sessionsLeftTotal, sessionsPerWeek, avgSessionMinutes,
   projectedFinishYmd | null, examYmd | null, examTerm | null, onTrack | null }`
- `units[]` in track order: `{ unitId, unitName, grade, term,
   status: "mastered" | "taught" | "current" | "upcoming",
   outOfScope: boolean, conceptsTotal, conceptsTaught, meanMastery | null,
   sessionsLeft | null, concepts[]: { conceptId, name, taught,
   mastery | null, isNext, noQuestions? } }`

### Derivation rules

- **Memory**: load ALL `memoryState` rows for the student once (`by_student`),
  map by concept. taught = `attemptCount > 0`; mastery via `masteryFromState`
  at `Date.now()`.
- **Concepts per unit**: `exercises.by_unit`, `type === "concept"`, sorted by
  `order`. Zero-concept units render greyed ("no syllabus data"), excluded
  from counts and estimates.
- **Current unit** (the frontier): first unit in track order with ≥1 untaught
  concept AND not `outOfScope`. `isNext` marks its first untaught concept(s).
- **outOfScope**: `unitId ∉ scopeUnitIds` — badge text tells the founder the
  planner will skip it until the student's assigned grades cover it.
- **noQuestions**: per-concept `questionsTaggedToConcept(...).length === 0`,
  computed ONLY for the current unit and the next upcoming unit (bounded cost;
  the warning matters at the frontier).
- **Sessions-left math — must mirror the planner exactly** so predictions
  match what sheets actually do:
  - `conceptsPerSession = clamp(round(pacing != null
      ? pacing * avgSessionMinutes / 60
      : avgSessionMinutes / MINUTES_PER_NEW_CONCEPT),
      MAIN_NEW_CONCEPTS_MIN, MAIN_NEW_CONCEPTS_MAX)` — same constants,
      `pacing` from `resolveUnitPacing` per unit.
  - `sessionsLeft(unit) = ceil(untaughtInScopeConcepts / conceptsPerSession)`.
- **Weekly schedule**: union of (a) `groupMembers.by_student` →
  `scheduleSlots.by_group` and (b) legacy `slotStudents.by_student` → slot,
  deduped by slot id. `avgSessionMinutes` = mean of `minutesBetweenClock`
  (reuse/extract the helper); `sessionsPerWeek` = slot count. No slots →
  `sessionsPerWeek = 0` → date predictions null (sessions-left still shown).
- **Projection**: `sessionsLeftTotal` = Σ over current + upcoming in-scope
  units; `projectedFinishYmd = today + ceil(sessionsLeftTotal /
  sessionsPerWeek) * 7 days`. Exam = `examCalendar` row at
  `(track.targetGrade, track.targetTerm)` if upcoming, else the latest
  upcoming exam at `targetGrade`, else null. `onTrack = projectedFinish <=
  examYmd` (null when either side missing).

### New file `convex/lib/trackProgressCore.ts` (pure, unit-tested)

Extract the pure math: unit-status derivation, conceptsPerSession,
sessionsLeft, projection walk, minutesBetweenClock (move or re-export from
planner). Follows the `convex/lib/rosterMoves.ts` precedent. The Convex query
is a thin data-loader over this.

## Frontend

### `src/components/students/track-progress.tsx` — the metro line

- Client component; `useCachedQuery` (instant paint) on the new query; builds
  `units` + `scopeUnitIds` args from `curriculum-data.ts` + the student doc.
- Header: track chip + "14/24 units taught · 9 mastered" + slim two-color bar
  (teal mastered / blue taught).
- Prediction banner: `⚐ G10 T2 exam — Sep 14 · projected Sep 02 · ✓ on track`
  / amber "⚠ ~N weeks behind" / date-less variant when no schedule; hidden
  when no exam AND no schedule.
- Vertical metro line, one station per unit, in track order:
  - ★ mastered (filled teal + star) · ✓ taught (filled blue + tiny mastery
    bar) · ▶ NOW (pulsing marker — CSS animation, no new deps; auto-scroll
    into view on mount; pre-expanded) · ○ upcoming (hollow) · ⚠ blocked
    (amber; outOfScope or noQuestions).
  - Station row: unit name, `x/y` concepts, status chip, `~N sessions` for
    current/upcoming.
  - Tap → accordion of concepts: ✓ + mastery dot / ○ "next" highlight / ⚠
    "no questions cropped". Inline accordions, never drill-down navigation.
  - Thin labeled separators at grade/term boundaries (cross-grade tracks).
  - Exam flag terminus row at the bottom.
- Empty states: `no-track` → friendly card + pointer to the track picker on
  the student card; loading skeleton mirrors the mastery page.

### New page `src/app/students/[id]/progress/page.tsx`

Mirrors the mastery page shell (back link, header, student card) and hosts
the component. Cross-links: Mastery page header ↔ Progress page header;
students-list card gets a "Track" link in its existing inline actions row
(link only — do NOT add progress bars to the card; that layout was
explicitly rejected, see decisions.md).

### `src/components/session/track-progress-strip.tsx` — session mini strip

One compact tappable line in the Sheets-tab DetailPane (above the toolbar):
`◉ Algebra I · 4/7 · ~2 sessions · on track ✓ ›` → links to the progress
page. Same query via `useCachedQuery`; renders nothing on `no-track` or
while loading (never blocks the scoring flow).

## Follow-up scope (same effort, executed after the view ships)

Small safety fixes from the 2026-07-10 audit (see ideas-backlog #1c):

1. **track∩scope fix**: in `planSheetCore`, union the track's
   `orderedUnitIds` into the profile scope before building the candidate
   pool, so cross-grade track units are servable (removes the silent-skip
   bug at the root; the view's ⚠ badge then only fires for genuinely
   misconfigured data).
2. **`getSavedSheet` crash**: replace `.unique()` with collect-and-pick-
   latest (same defense the save path already has).
3. **Late-scoring fix**: `recentCompletionStats` counts attempts within 48h
   of the sheet date instead of same-calendar-day, so next-day scoring stops
   misclassifying students as "weak".

Out of scope: `unitCompletions` event log + parent messaging hook (deferred);
exam-prep harder-fallback pedagogy (needs a founder decision); any change to
the scoring engine or section allocation.

## Testing & verification

- vitest on `trackProgressCore.ts`: status tiers (incl. taught-but-shaky),
  frontier selection skipping outOfScope units, estimate math vs planner
  constants, projection with/without schedule.
- convex-test integration: seed student + track + memoryState + slots + exam
  row → assert full query shape, statuses, prediction.
- Typecheck both layers (`tsc` + `npx convex codegen`); `npm test`.
- Manual: open progress page for a real dev student; score a question in a
  session and watch the strip/line update live; verify no-track and
  no-schedule states.
- Brain maintenance: update `docs/brain/features/analytics-students.md` (or
  the closest feature file) + ideas-backlog rows 1b/1c on completion.
