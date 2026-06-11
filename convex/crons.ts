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

export default crons;
