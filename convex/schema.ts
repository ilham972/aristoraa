import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  students: defineTable({
    name: v.string(),
    schoolGrade: v.number(),
    parentPhone: v.string(),
    schoolName: v.string(),
    centerId: v.optional(v.id("centers")),
    // Grades the student is taught across all 6 modules. Defaults to
    // [schoolGrade] when unset. Lead can downgrade a weak student by adding
    // lower grades (e.g. a G10 student gets [10, 9] so they re-cover G9 work).
    assignedGrades: v.optional(v.array(v.number())),
    // Per-module override of assignedGrades. Key = moduleId ("M1".."M6"),
    // value = grade list. When a module has its own override, it takes
    // precedence over the global assignedGrades for that module.
    assignedGradesByModule: v.optional(v.any()),
  }).index("by_center", ["centerId"]),

  exercises: defineTable({
    unitId: v.string(),
    name: v.string(),
    questionCount: v.number(),
    order: v.number(),
    type: v.optional(v.string()), // "exercise" | "concept"
    pageNumber: v.optional(v.number()),
    pageNumberEnd: v.optional(v.number()),
    subQuestions: v.optional(v.any()), // Record<string, { count: number, type: 'letter' | 'roman' }>
    videoUrl: v.optional(v.string()), // YouTube (unlisted) URL for concept-type rows
    conceptSummary: v.optional(v.string()), // short text shown next to video
  }).index("by_unit", ["unitId"]),

  entries: defineTable({
    studentId: v.id("students"),
    date: v.string(),
    exerciseId: v.id("exercises"),
    unitId: v.string(),
    moduleId: v.string(),
    questions: v.any(),
    correctCount: v.number(),
    totalAttempted: v.number(),
    slotId: v.optional(v.id("scheduleSlots")),
    centerId: v.optional(v.id("centers")),
  })
    .index("by_date", ["date"])
    .index("by_student", ["studentId"])
    .index("by_student_date", ["studentId", "date"])
    .index("by_center", ["centerId"]),

  settings: defineTable({
    tuitionName: v.optional(v.string()),
    allowManualSlotSelection: v.optional(v.boolean()),
  }),

  centers: defineTable({
    name: v.string(),
    city: v.string(),
    district: v.string(),
    road: v.string(),
  }),

  rooms: defineTable({
    centerId: v.id("centers"),
    name: v.string(),
    moduleTimetable: v.optional(v.any()), // { "1": "M1", "2": "M2", ... } dayOfWeek → moduleId
  }).index("by_center", ["centerId"]),

  scheduleSlots: defineTable({
    dayOfWeek: v.number(),
    startTime: v.string(),
    endTime: v.string(),
    roomId: v.id("rooms"),
  })
    .index("by_room", ["roomId"])
    .index("by_day", ["dayOfWeek"]),

  slotStudents: defineTable({
    slotId: v.id("scheduleSlots"),
    studentId: v.id("students"),
  })
    .index("by_slot", ["slotId"])
    .index("by_student", ["studentId"]),

  slotOverrides: defineTable({
    slotId: v.id("scheduleSlots"),
    studentId: v.id("students"),
    date: v.string(),
    action: v.string(),
  }).index("by_slot_date", ["slotId", "date"]),

  teachers: defineTable({
    clerkUserId: v.string(),
    name: v.string(),
    role: v.string(),
  }).index("by_clerk_user", ["clerkUserId"]),

  slotTeachers: defineTable({
    slotId: v.id("scheduleSlots"),
    teacherId: v.id("teachers"),
  })
    .index("by_slot", ["slotId"])
    .index("by_teacher", ["teacherId"]),

  attendance: defineTable({
    studentId: v.id("students"),
    slotId: v.id("scheduleSlots"),
    date: v.string(),
    status: v.string(),
    sessionFinished: v.optional(v.boolean()),
  })
    .index("by_slot_date", ["slotId", "date"])
    .index("by_student", ["studentId"]),

  studentModulePositions: defineTable({
    studentId: v.id("students"),
    moduleId: v.string(),
    grade: v.number(),
    term: v.number(),
  }).index("by_student_module", ["studentId", "moduleId"]),

  sessionSubmissions: defineTable({
    slotId: v.id("scheduleSlots"),
    date: v.string(),
    teacherId: v.id("teachers"),
    presentCount: v.number(),
    absentCount: v.number(),
    entryCount: v.number(),
    submittedAt: v.number(),
  })
    .index("by_slot_date", ["slotId", "date"])
    .index("by_teacher", ["teacherId"]),

  textbooks: defineTable({
    grade: v.number(),
    part: v.number(),
    totalPages: v.number(),
    startUnit: v.optional(v.number()),
    endUnit: v.optional(v.number()),
  }).index("by_grade", ["grade"]),

  unitMetadata: defineTable({
    unitId: v.string(),
    startPage: v.optional(v.number()),
    endPage: v.optional(v.number()),
  }).index("by_unit", ["unitId"]),

  textbookPages: defineTable({
    textbookId: v.id("textbooks"),
    pageNumber: v.number(),
    storageId: v.id("_storage"),
  })
    .index("by_textbook", ["textbookId"])
    .index("by_textbook_page", ["textbookId", "pageNumber"]),

  // Doubts queue surfaced on the Lead's dashboard.
  // Sources:
  //   "correction"  — Correction Officer flagged a wrong answer as "needs explanation"
  //   "student-app" — Student tapped "I need help" from their tablet/home
  //   "lead-manual" — Lead added a student to the queue manually
  doubts: defineTable({
    studentId: v.id("students"),
    centerId: v.optional(v.id("centers")),
    slotId: v.optional(v.id("scheduleSlots")),
    raisedAt: v.number(),
    source: v.string(), // "correction" | "student-app" | "lead-manual"
    status: v.string(), // "pending" | "in-progress" | "resolved"
    exerciseId: v.optional(v.id("exercises")),
    conceptExerciseId: v.optional(v.id("exercises")), // concept-type exercise this doubt maps to
    // Question key matches the entries.questions shape: "1", "3", "2.a", "5.iii".
    // Stored as string so sub-questions stay identifiable.
    questionKey: v.optional(v.string()),
    note: v.optional(v.string()),
    resolvedAt: v.optional(v.number()),
    resolvedByTeacherId: v.optional(v.id("teachers")),
  })
    .index("by_status", ["status"])
    .index("by_student", ["studentId"])
    .index("by_center_status", ["centerId", "status"])
    .index("by_slot_status", ["slotId", "status"])
    .index("by_student_exercise", ["studentId", "exerciseId"]),

  // Lead's per-student "next task" for a given day. Upserted by (studentId, date).
  // Phase 4 (student tablet) reads this for the student's home screen.
  currentAssignments: defineTable({
    studentId: v.id("students"),
    date: v.string(), // YYYY-MM-DD
    slotId: v.optional(v.id("scheduleSlots")),
    type: v.string(), // "exercise" | "concept" | "redo" | "resting"
    exerciseId: v.optional(v.id("exercises")), // for exercise/concept
    redoEntryId: v.optional(v.id("entries")), // for redo: past entry containing the mistake
    redoQuestionKey: v.optional(v.string()), // for redo: specific question within that entry
    note: v.optional(v.string()),
    assignedAt: v.number(),
    assignedByTeacherId: v.optional(v.id("teachers")),
    completedAt: v.optional(v.number()),
  })
    .index("by_student_date", ["studentId", "date"])
    .index("by_slot_date", ["slotId", "date"])
    .index("by_date", ["date"]),
});
