// Group lesson-plan skeleton — pure math (departments redesign, 2026-07-14).
//
// Given the group's upcoming session dates and the remaining unseen question
// count per track unit (in track order), lays the book across the calendar:
// which unit each session teaches, how many new + spiral questions it holds,
// when each unit is projected to finish, and whether that beats the unit's
// exam date. This is the "skeleton" — question-level sheets crystallize
// separately (~a week ahead, convex/learningEngine/groupPlan.ts) so the
// projection self-corrects as reality happens.
//
// Pure and synchronous: unit-tested without a database.

export type SkeletonUnitInput = {
  unitId: string;
  term: number | null;
  unseenCount: number; // unseen-for-the-GROUP questions remaining
};

export type SkeletonSessionPart = { unitId: string; newCount: number };

export type SkeletonSession = {
  date: string; // YYYY-MM-DD
  parts: SkeletonSessionPart[]; // usually one unit; two when a unit ends mid-session
  spiralCount: number;
};

export type SkeletonUnitProjection = {
  unitId: string;
  term: number | null;
  unseenCount: number;
  projectedFinishDate: string | null; // null → doesn't finish within the horizon
  examDate: string | null;
  verdict: "done" | "on-track" | "wont-finish" | "no-exam" | "after-horizon";
};

export function buildGroupSkeleton(args: {
  sessionDates: string[]; // ascending, upcoming session dates
  units: SkeletonUnitInput[]; // track order
  mainQuestionsPerSession: number;
  spiralShare: number; // 0..1 of the sheet reserved for review
  examDateByTerm: Record<number, string>; // term → next exam YYYY-MM-DD
  anyPastUnitStarted: boolean; // spiral only exists once there is a past
}): {
  sessions: SkeletonSession[];
  units: SkeletonUnitProjection[];
} {
  const mainSize = Math.max(1, Math.round(args.mainQuestionsPerSession));
  const remaining = args.units.map((u) => ({ ...u }));
  let idx = 0;
  while (idx < remaining.length && remaining[idx].unseenCount <= 0) idx += 1;

  const finishDate = new Map<string, string>();
  const sessions: SkeletonSession[] = [];
  // Spiral slots exist once any earlier unit has been started — from the
  // group's very first session onward that's almost always true.
  let spiralActive = args.anyPastUnitStarted;

  for (const date of args.sessionDates) {
    if (idx >= remaining.length) break; // book finished — sessions become free
    const spiralCount = spiralActive
      ? Math.min(mainSize - 1, Math.round(mainSize * args.spiralShare))
      : 0;
    let newBudget = mainSize - spiralCount;
    const parts: SkeletonSessionPart[] = [];
    while (newBudget > 0 && idx < remaining.length) {
      const u = remaining[idx];
      const take = Math.min(newBudget, u.unseenCount);
      if (take > 0) {
        parts.push({ unitId: u.unitId, newCount: take });
        u.unseenCount -= take;
        newBudget -= take;
      }
      if (u.unseenCount <= 0) {
        finishDate.set(u.unitId, date);
        idx += 1;
        spiralActive = true; // a finished unit is a past unit
      } else {
        break; // budget exhausted inside this unit
      }
    }
    if (parts.length > 0) sessions.push({ date, parts, spiralCount });
  }

  const units: SkeletonUnitProjection[] = args.units.map((u) => {
    const fin = finishDate.get(u.unitId) ?? null;
    const exam = u.term !== null ? (args.examDateByTerm[u.term] ?? null) : null;
    let verdict: SkeletonUnitProjection["verdict"];
    if (u.unseenCount <= 0) verdict = "done";
    else if (fin === null) verdict = exam === null ? "no-exam" : "after-horizon";
    else if (exam === null) verdict = "no-exam";
    else verdict = fin <= exam ? "on-track" : "wont-finish";
    return {
      unitId: u.unitId,
      term: u.term,
      unseenCount: u.unseenCount,
      projectedFinishDate: fin,
      examDate: exam,
      verdict,
    };
  });

  return { sessions, units };
}
