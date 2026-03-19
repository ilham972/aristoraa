import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  students: defineTable({
    name: v.string(),
    schoolGrade: v.number(),
    parentPhone: v.string(),
    schoolName: v.string(),
  }),

  exercises: defineTable({
    unitId: v.string(),
    name: v.string(),
    questionCount: v.number(),
    order: v.number(),
    type: v.optional(v.string()), // "exercise" | "concept"
    pageNumber: v.optional(v.number()),
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
  })
    .index("by_date", ["date"])
    .index("by_student", ["studentId"])
    .index("by_student_date", ["studentId", "date"]),

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
  })
    .index("by_slot_date", ["slotId", "date"])
    .index("by_student", ["studentId"]),

  studentModulePositions: defineTable({
    studentId: v.id("students"),
    moduleId: v.string(),
    grade: v.number(),
    term: v.number(),
  }).index("by_student_module", ["studentId", "moduleId"]),
});
