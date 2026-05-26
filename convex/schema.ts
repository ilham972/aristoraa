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
    // ─── Phase D.3: sheet-planner per-student knobs ────────────────────────
    // Off-days for THIS student. Lowercase weekday names: "sunday", "monday",
    // … "saturday". Different students may have different off-days (e.g.
    // homeschooled student rests Wednesday; centre student rests Sunday).
    // When unset, defaults to ["sunday"] inside the planner.
    offDays: v.optional(v.array(v.string())),
    // Manual override of the daily sheet's question count. When set, takes
    // precedence over the auto-tuned budget (which reads recent completion
    // history). Range enforced in the planner: clamped to [3, 20].
    sheetLengthOverride: v.optional(v.number()),
    // Manual override of the daily sheet's TIME budget in minutes. When set,
    // takes precedence over the auto-tuned time budget. The slot allocator
    // packs questions by summing expectedTimeMin until budget fills, then
    // caps at sheetLengthOverride if also set. Range clamped to [10, 180].
    sessionMinutesOverride: v.optional(v.number()),
    // ─── Phase F: per-student hourly fee in LKR ───────────────────────────
    // Used by /groups revenue helper. Falls back to RATE_DEFAULT_LKR (250)
    // when unset so existing rows need no backfill.
    hourlyRate: v.optional(v.number()),
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
    // Default centre used as the starting value for new groups.
    defaultCenterId: v.optional(v.id("centers")),
  }),

  centers: defineTable({
    name: v.string(),
    city: v.string(),
    district: v.string(),
    road: v.string(),
    // Per-centre default room. Used to prefill a new group's room when the
    // group is created with this centre.
    defaultRoomId: v.optional(v.id("rooms")),
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
    // ─── Phase F: owning group ────────────────────────────────────────────
    // A slot hosts exactly one group at a time (a room can only hold one
    // class). When set, the slot's roster is derived from groupMembers, not
    // from slotStudents. Optional during migration; required for new slots
    // created via /groups after cutover.
    groupId: v.optional(v.id("groups")),
  })
    .index("by_room", ["roomId"])
    .index("by_day", ["dayOfWeek"])
    .index("by_group", ["groupId"]),

  // ─── Phase F: Groups ─────────────────────────────────────────────────────
  // A group is a stable roster of students that meets repeatedly in one or
  // more weekly sessions (each session = one scheduleSlots row, linked back
  // via scheduleSlots.groupId). Replaces the slot-centric edit model of the
  // old Schedule tab. Naming auto-derives from member first names unless the
  // user edits it (autoName=false then). Color is deterministic from _id.
  //
  // Cross-centre / cross-grade members raise *warnings* (not blocks); the
  // group's centerId/grade represent the dominant intent.
  groups: defineTable({
    name: v.string(),
    autoName: v.boolean(),                       // true → regenerate on member change
    centerId: v.optional(v.id("centers")),
    grade: v.optional(v.number()),               // primary grade
    // Phase F (extension): up to 2 extra grades that this group also accepts.
    // Members must belong to (grade ∪ additionalGrades). Server enforces this
    // strictly in addMember; existing soft-warning UX is retired.
    additionalGrades: v.optional(v.array(v.number())),
    mentorId: v.optional(v.id("teachers")),
    defaultRoomId: v.optional(v.id("rooms")),    // used when toggling a new cell in the weekly grid
    type: v.optional(v.string()),                // "small" | "medium" | "large" | "private"
    maxSize: v.optional(v.number()),
    targetMarksMin: v.optional(v.number()),
    targetMarksMax: v.optional(v.number()),
    archived: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_center", ["centerId"])
    .index("by_archived", ["archived"])
    .index("by_mentor", ["mentorId"]),

  // Many-to-many between groups and students. A student typically belongs to
  // one group at a time, but the schema allows multiple (e.g. a student who
  // joins a second small-group for catch-up). joinedAt drives "since when".
  groupMembers: defineTable({
    groupId: v.id("groups"),
    studentId: v.id("students"),
    joinedAt: v.number(),
    // ─── Phase F: per-group fee in LKR ─────────────────────────────────────
    // Overrides students.hourlyRate for THIS group only. Lets the tutor give
    // a discount or free seat for a poor student in a specific group while
    // keeping the student's regular fee in other groups they attend.
    // Resolution order: groupMembers.hourlyRate → students.hourlyRate →
    // RATE_DEFAULT_LKR (250). Use 0 for "free".
    hourlyRate: v.optional(v.number()),
  })
    .index("by_group", ["groupId"])
    .index("by_student", ["studentId"])
    .index("by_group_student", ["groupId", "studentId"]),

  // ── Legacy slot-roster tables (frozen post Phase F migration) ────────────
  // Kept for historical reads only. /groups is the write surface going
  // forward. Reader migration: convex helpers resolve scheduleSlots.groupId
  // → groupMembers; old slotStudents rows remain as archive but are no
  // longer source-of-truth.
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

  // ─── Phase F: per-occurrence session log ────────────────────────────────
  // A row appears here the moment the tutor saves the Day-view SessionDialog
  // for a (slotId, date). Its mere existence means "this session has been
  // logged" — the Day view uses this to switch a card from a red 'missing
  // entry' ring to a green 'logged' one. status='cancelled_by_tutor' marks
  // sessions the tutor called off (poya / fever / travel) for that one date
  // only; no attendance or payment is expected.
  sessionLogs: defineTable({
    slotId: v.id("scheduleSlots"),
    date: v.string(),
    status: v.string(), // "held" | "cancelled_by_tutor"
    note: v.optional(v.string()),
    loggedByTeacherId: v.optional(v.id("teachers")),
    loggedAt: v.number(),
  })
    .index("by_slot_date", ["slotId", "date"])
    .index("by_date", ["date"]),

  // ─── Phase F: cash collected for a specific session occurrence ──────────
  // One row per cash hand-off. Multiple rows for the same (slot, date,
  // student) are allowed — a student might pay 100 mid-class and 150 later;
  // both are recorded. Credit for a session = expected − Σ amount; positive
  // value means the student still owes. amount=0 is permitted as a
  // 'recorded zero' (use the note field if you want a reason).
  sessionPayments: defineTable({
    slotId: v.id("scheduleSlots"),
    date: v.string(),
    studentId: v.id("students"),
    amount: v.number(),
    paidAt: v.number(),
    note: v.optional(v.string()),
  })
    .index("by_slot_date", ["slotId", "date"])
    .index("by_slot_date_student", ["slotId", "date", "studentId"])
    .index("by_student_date", ["studentId", "date"]),

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

  // ─── Phase B: concept importance (exam blueprint) ────────────────────────
  // Normalized exam-paper emphasis per (grade, term, concept). Recomputed on
  // demand by the recomputeForGradeTerm mutation in
  // convex/learningEngine/importance.ts when a paper is added / edited / its
  // tags change. Cumulative term semantics: a Term 2 paper question testing a
  // Term 1 concept pushes that concept's importance under (grade, term=2),
  // separately from the same concept's (grade, term=1) row driven by Term 1
  // papers. Holdout papers are NEVER included (filter on isHoldout=false +
  // useAsTrainingSignal=true).
  //   source: "data" if any training-paper marks contributed; "prior" if the
  //           fallback (count-of-unit-exercises) was used because no tagged
  //           training papers exist yet for (grade, term).
  conceptImportance: defineTable({
    grade: v.number(),
    term: v.number(),                          // 1 | 2 | 3
    conceptExerciseId: v.id("exercises"),      // concept-type exercises row
    importance: v.number(),                    // 0..1, Σ importance = 1.0 within (grade, term)
    rawMarks: v.number(),                      // sum of marks across training papers
    paperCount: v.number(),                    // number of training papers that contributed marks
    source: v.string(),                        // "data" | "prior"
    computedAt: v.number(),
  })
    .index("by_grade_term_concept", ["grade", "term", "conceptExerciseId"])
    .index("by_grade_term", ["grade", "term"]),

  // ─── Phase C.3: exam calendar ─────────────────────────────────────────────
  // Scheduled term-exam dates per (grade, term, year). Drives the SR exam-date
  // backstop (Phase D.5), retention-debt "marks at risk in upcoming exam"
  // (Phase C.2), and the predictor (Phase G.1). One row per (grade, term, year)
  // — composite key enforced in the upsert mutation, not via DB constraint.
  //   examDate stored as YYYY-MM-DD string for cheap lexicographic ordering.
  //   totalMarks is preferred by C.2 retention-debt over the most-recent past
  //   paper's totalMarks; both are optional and the consumer falls back to 100.
  examCalendar: defineTable({
    grade: v.number(),
    term: v.number(), // 1 | 2 | 3
    year: v.number(),
    examDate: v.string(), // YYYY-MM-DD
    totalMarks: v.optional(v.number()),
    notes: v.optional(v.string()),
  })
    .index("by_grade_term_year", ["grade", "term", "year"])
    .index("by_examDate", ["examDate"])
    .index("by_grade", ["grade"]),

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

  // ─── Phase D.1 / D.6: per-student daily sheet record ─────────────────────
  // One row per (student, date). Persists the three-strip sheet a student is
  // expected to do today: warm-up (cross-module SR), main block (today's
  // module, interleaved), exam-prep (past-paper mixed). D.1 only used the
  // question id arrays — they're the input to the novelty cooldown filter
  // (today's candidate pool excludes any question used in the last
  // NOVELTY_COOLDOWN_DAYS days). D.6 added status / alerts / scoringSnapshot
  // / slot + teacher provenance / printedAt / completedAt — all optional so
  // D.1-shape rows remain valid. Phase E will populate pdfStorageId.
  //   status: undefined | "draft" — Lead can re-plan / overwrite freely
  //           "printed"           — frozen; matches the paper sheet given out
  //           "completed"         — submission done, locked
  //           "skipped"           — student absent / off-day reclassified
  generatedSheets: defineTable({
    studentId: v.id("students"),
    date: v.string(),                                 // YYYY-MM-DD
    generatedAt: v.number(),                          // ms epoch
    warmupQuestionIds: v.array(v.id("questionBank")),
    mainQuestionIds: v.array(v.id("questionBank")),
    examPrepQuestionIds: v.array(v.id("questionBank")),
    // D.6 additions — all optional for forward compatibility with D.1 rows.
    status: v.optional(v.string()),
    slotId: v.optional(v.id("scheduleSlots")),
    generatedByTeacherId: v.optional(v.id("teachers")),
    // D.4 prereq alerts surfaced at sheet save. Each entry =
    //   { type: "prereqUnmet", questionId, conceptId, conceptName,
    //     prereqId, prereqName, prereqMastery }
    alerts: v.optional(v.any()),
    // D.6 audit snapshot. Per-picked-Q score factors at gen time so the
    // Lead "why this question?" tooltip + Phase F calibration replay can
    // read the same numbers without re-deriving. Picked Qs only (8–12
    // rows), not the full scored pool.
    scoringSnapshot: v.optional(v.any()),
    pdfStorageId: v.optional(v.id("_storage")),
    printedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_student_date", ["studentId", "date"])
    .index("by_date", ["date"])
    .index("by_status", ["status"])
    .index("by_slot_date", ["slotId", "date"]),

  // ─── Phase D.6: sheet-override journal ────────────────────────────────────
  // Append-only audit trail of Lead's manual swaps on a generated sheet.
  // Action vocabulary:
  //   "swap"   — replaced questionIdBefore with questionIdAfter (same slot)
  //   "remove" — removed questionIdBefore from the sheet
  //   "add"    — added questionIdAfter (manual insert, no original)
  // The mutating action also rewrites the corresponding question id array
  // on the generatedSheets row in the same transaction.
  sheetOverrides: defineTable({
    sheetId: v.id("generatedSheets"),
    action: v.string(),
    slotName: v.optional(v.string()),                 // "warmup" | "main" | "examPrep"
    questionIdBefore: v.optional(v.id("questionBank")),
    questionIdAfter: v.optional(v.id("questionBank")),
    byTeacherId: v.id("teachers"),
    reason: v.optional(v.string()),
    at: v.number(),
  }).index("by_sheet", ["sheetId"]),
});
