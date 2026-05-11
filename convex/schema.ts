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
    // For concept-type rows only: other concept-type exercise rows that must
    // be mastered before this one. Forms the prerequisite DAG used by the
    // sheet generator to avoid assigning content whose prereqs aren't ready.
    prerequisiteExerciseIds: v.optional(v.array(v.id("exercises"))),
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

  // ─── Past exam papers (Phase 0.5) ─────────────────────────────────────────
  // Source for exam-blueprint importance weighting (Phase B) and calibration
  // loop (Phase F). Current-term papers are marked isHoldout=true and NEVER
  // fed to the algorithm; old papers are training signal.
  pastPapers: defineTable({
    grade: v.number(),                         // 6..11
    term: v.number(),                          // 1 | 2 | 3
    year: v.number(),
    schoolName: v.optional(v.string()),        // undefined = own / centre paper
    totalPages: v.number(),
    useAsTrainingSignal: v.boolean(),          // user-set; default true for old/school papers
    isHoldout: v.boolean(),                    // true = current term's own paper, never feeds algorithm
    totalMarks: v.optional(v.number()),
    uploadedAt: v.number(),
    // Per-paper overrides on the grade's default paperStructure parts. Only
    // populated when this paper deviates from the grade's default structure
    // (e.g. G6-G9 alternate Part 2 with 8 essays × 10 marks instead of the
    // default 7 × 12). Each entry overlays the matching part by partCode;
    // unset fields fall through to the structure default.
    partOverrides: v.optional(v.array(v.object({
      partCode: v.string(),
      questionCount: v.optional(v.number()),
      marksPerQuestion: v.optional(v.number()),
      requiredCount: v.optional(v.number()),
    }))),
  })
    .index("by_grade_term_year", ["grade", "term", "year"])
    .index("by_training_signal", ["useAsTrainingSignal"])
    .index("by_grade", ["grade"]),

  pastPaperPages: defineTable({
    pastPaperId: v.id("pastPapers"),
    pageNumber: v.number(),
    storageId: v.id("_storage"),
  })
    .index("by_paper", ["pastPaperId"])
    .index("by_paper_page", ["pastPaperId", "pageNumber"]),

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

  // ─── Learning engine (Phase 0) ─────────────────────────────────────────
  // A single croppable question image + its tags. Source today is textbook
  // pages (OCR unusable due to Tamil encoding issues — we crop per-question
  // images from existing textbookPages instead). Past-paper and teacher-
  // authored sources join in sub-phase 0.5.
  questionBank: defineTable({
    source: v.string(), // "textbook" | "past-paper" | "teacher-authored"
    textbookPageId: v.optional(v.id("textbookPages")),
    // Normalized (0–1) crop coordinates on the source page image so crops
    // are resolution-independent and re-render cleanly at any size.
    cropBox: v.optional(v.object({
      x: v.number(),
      y: v.number(),
      w: v.number(),
      h: v.number(),
    })),
    difficulty: v.optional(v.number()), // 1-5
    answerKey: v.optional(v.string()), // added later
    expectedTimeMin: v.optional(v.number()),
    // Back-link to the legacy exercise/question identity. Keeps the existing
    // score-entry flow working while the question-bank flow is built alongside.
    // linkedQuestionKey matches entries.questions keys ("1", "3.a", "5.iii").
    linkedExerciseId: v.optional(v.id("exercises")),
    linkedQuestionKey: v.optional(v.string()),
    // Past-paper provenance (Phase 0.5). Populated when source === "past-paper".
    pastPaperId: v.optional(v.id("pastPapers")),
    pastPaperPageId: v.optional(v.id("pastPaperPages")),
    marksAvailable: v.optional(v.number()),        // marks this question is worth in the paper
    questionNumberInPaper: v.optional(v.string()),  // "1.a", "5.iii" — free-text (legacy) or denormalized "1A.1" (Phase 0.4)
    // Phase 0.4: structured slot identity for past-paper crops. When set,
    // (pastPaperId, paperStructurePartId, paperStructureSlotNumber) is the
    // 1:1 key; questionNumberInPaper becomes a denormalized cache for display.
    paperStructurePartId: v.optional(v.id("paperStructureParts")),
    paperStructureSlotNumber: v.optional(v.number()),
    // Broad topic tag for the question — feeds the Phase B importance engine.
    // Distinct from (and complementary to) questionConcepts which carries
    // fine-grained per-concept identity.
    topicTagId: v.optional(v.id("examTopicTags")),
    createdAt: v.number(),
  })
    .index("by_source", ["source"])
    .index("by_textbook_page", ["textbookPageId"])
    .index("by_linked_exercise", ["linkedExerciseId"])
    .index("by_past_paper", ["pastPaperId"])
    .index("by_past_paper_page", ["pastPaperPageId"])
    .index("by_topic_tag", ["topicTagId"])
    .index("by_paper_slot", ["pastPaperId", "paperStructurePartId", "paperStructureSlotNumber"]),

  // Many-to-many join tagging questionBank rows with concept-type exercises.
  // A "concept" here = an existing exercises row where type === "concept"
  // (the theory chunk already part of each unit's timeline). Convex can't
  // index array-member lookups so this join lets us efficiently answer
  // "give me all questions tagged to concept X" for the sheet generator.
  questionConcepts: defineTable({
    questionId: v.id("questionBank"),
    conceptExerciseId: v.id("exercises"),
    weight: v.optional(v.number()), // (0, 1]; reserved for Phase G importance weighting; default 1.0
  })
    .index("by_question", ["questionId"])
    .index("by_concept_exercise", ["conceptExerciseId"]),

  // ─── Topic tags + paper structure (Phase 0.4) ──────────────────────────
  // Broad-topic taxonomy bridging past-paper crops to the Phase B importance
  // engine. Each tag links to one or more curriculum *units* via
  // examTopicTagLinks; concepts derived from those units come along for free.
  examTopicTags: defineTable({
    name: v.string(),                           // "Fractions" — user-facing label
    description: v.optional(v.string()),
    color: v.optional(v.string()),              // CSS hex; defaults to module color
    moduleId: v.optional(v.string()),           // "M1".."M6" for grouping + default color
    createdAt: v.number(),
  })
    .index("by_module", ["moduleId"])
    .index("by_name", ["name"]),                 // soft-uniqueness — checked in mutation

  // Tag → unit join. unitId is a static string from src/lib/curriculum-data.ts
  // (e.g. "M1-G6-T2-0"). Backend cannot import from src/lib so callers pass
  // grade/term/moduleId denormalized for cheaper filtering and display.
  examTopicTagLinks: defineTable({
    tagId: v.id("examTopicTags"),
    unitId: v.string(),
    grade: v.number(),
    term: v.number(),
    moduleId: v.string(),
    createdAt: v.number(),
  })
    .index("by_tag", ["tagId"])
    .index("by_unit", ["unitId"])
    .index("by_tag_unit", ["tagId", "unitId"])
    .index("by_grade", ["grade"]),

  // One row per grade defining the exam paper shape. G10/G11 share an
  // identical national structure; G6-G9 share a default with per-paper
  // overrides via pastPapers.partOverrides.
  paperStructures: defineTable({
    grade: v.number(),
    divisionFactor: v.number(),                  // 1 for G6-G9, 2 for G10-G11
    totalRawMarks: v.number(),                   // sum of (questionCount × marksPerQuestion) across required slots
    scaledTotal: v.number(),                     // totalRawMarks / divisionFactor
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_grade", ["grade"]),

  paperStructureParts: defineTable({
    structureId: v.id("paperStructures"),
    partCode: v.string(),                        // "1A" | "1B" | "2A" | "2B" | "1" | "2"
    partLabel: v.string(),                       // "Part I Section A — MCQ"
    questionCount: v.number(),                   // total slots
    marksPerQuestion: v.number(),
    requiredCount: v.number(),                   // students must answer N — 0..questionCount
    order: v.number(),
    notes: v.optional(v.string()),
  })
    .index("by_structure", ["structureId"])
    .index("by_structure_order", ["structureId", "order"]),

  // Per-slot tag config. mode === "permanent": auto-applied on crop save
  // (one row per slot). mode === "option": surfaced as suggested choices in
  // the crop UI (any number per slot). Absence of any row at a slot ⇒
  // "learned" mode (UI reads questionBank history for suggestions).
  paperStructureSlotTags: defineTable({
    partId: v.id("paperStructureParts"),
    slotNumber: v.number(),                      // 1..questionCount
    tagId: v.id("examTopicTags"),
    mode: v.string(),                            // "permanent" | "option"
    createdAt: v.number(),
  })
    .index("by_part_slot", ["partId", "slotNumber"])
    .index("by_part", ["partId"])
    .index("by_tag", ["tagId"]),

  // ─── Learning engine Phase A.1 ────────────────────────────────────────
  // Per (student, concept) FSRS-lite memory state. One row per pairing,
  // lazily created by A.2's recordAttempt when a student first hits a
  // concept. Mutated only by attempt ingestion; mastery is a *derived*
  // view over this row (see A.3) and is never stored.
  //   D (difficulty) ∈ [1, 10]  — learner-specific difficulty for the concept
  //   S (stability)  ≥ 0 days   — interval at which retrievability R = 0.9
  //   correctWeighted / wrongWeighted accumulate per-attempt difficulty
  //     weight = 0.6 + 0.2 * questionDifficulty   (range 0.8..1.6)
  memoryState: defineTable({
    studentId: v.id("students"),
    conceptExerciseId: v.id("exercises"),     // points at exercises row where type === "concept"
    difficulty: v.number(),                    // 1..10  (FSRS D, init 5.0)
    stability: v.number(),                     // days   (FSRS S, init DEFAULT_INIT_STABILITY = 1.0)
    lastReviewAt: v.number(),                  // ms epoch of the most recent attempt
    lastResponse: v.string(),                  // "good" | "again" | "hard"
    attemptCount: v.number(),
    correctWeighted: v.number(),               // Σ weight(q) on correct attempts
    wrongWeighted: v.number(),                 // Σ weight(q) on wrong attempts
    initializedAt: v.number(),
  })
    .index("by_student", ["studentId"])
    .index("by_student_concept", ["studentId", "conceptExerciseId"])
    .index("by_student_lastReview", ["studentId", "lastReviewAt"]),

  // Append-only log of every scored attempt. Drives A.4 backfill from legacy
  // entries, F.3 calibration replay (snapshot mastery as-of an exam date),
  // and Phase G experiment auditing. Never mutated after insert.
  //   source: "session" | "homework" | "diagnostic" | "exam"
  //           | "backfill" | "legacy-unit-fallback"
  attemptLog: defineTable({
    studentId: v.id("students"),
    conceptExerciseId: v.id("exercises"),
    questionId: v.optional(v.id("questionBank")), // null for legacy attempts pre-question-bank
    exerciseId: v.optional(v.id("exercises")),
    questionKey: v.optional(v.string()),
    response: v.string(),                          // "good" | "again" | "skipped"
    difficulty: v.number(),                        // q.difficulty 1..5, default 3 when unknown
    weight: v.number(),                            // computed weight(q) = 0.6 + 0.2 * difficulty
    occurredAt: v.number(),                        // ms epoch
    source: v.string(),
  })
    .index("by_student_time", ["studentId", "occurredAt"])
    .index("by_student_concept_time", ["studentId", "conceptExerciseId", "occurredAt"]),

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
