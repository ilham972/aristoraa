import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  students: defineTable({
    name: v.string(),
    schoolGrade: v.number(),
    group: v.string(),
    parentPhone: v.string(),
    schoolName: v.string(),
  }),

  groups: defineTable({
    name: v.string(),
  }),

  exercises: defineTable({
    unitId: v.string(),
    name: v.string(),
    questionCount: v.number(),
    order: v.number(),
    type: v.optional(v.string()), // "exercise" | "concept"
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
    tuitionName: v.string(),
  }),
});
