// Scheduled jobs. Convex reads the default export of this file.

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Once a day, look for exams within EXAM_WEEK_DAYS whose manual "Exam mode"
// switch is still off, and drop a reminder into the Lead/Admin notification
// bell. See convex/examAlerts.ts.
crons.daily(
  "exam-mode reminder scan",
  { hourUTC: 6, minuteUTC: 0 },
  internal.examAlerts.scanAndNotify,
  {},
);

// Once a day, look for students whose recent failure rate says their manual
// learning mode should change (normal → consolidation, or recovered → back),
// and drop a suggestion into the Lead/Admin bell. See convex/engineAlerts.ts.
crons.daily(
  "consolidation-mode reminder scan",
  { hourUTC: 6, minuteUTC: 15 },
  internal.engineAlerts.scanAndNotify,
  {},
);

// Once a day, look for groups whose CURRENT unit has finished all textbook
// questions (the Main plan is now serving the past-paper tail) and tell the
// founder. See scanBookExhaustion in convex/learningEngine/groupPlan.ts.
crons.daily(
  "group book-exhaustion scan",
  { hourUTC: 6, minuteUTC: 30 },
  internal.learningEngine.groupPlan.scanBookExhaustion,
  {},
);

export default crons;
