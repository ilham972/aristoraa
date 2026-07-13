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
    // Phase 1 (track model): the single track this student rides, spanning all
    // six modules. Optional — a student with no trackId falls back to the
    // legacy schoolGrade + teachingPath behaviour in the planner.
    trackId: v.optional(v.id("tracks")),
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
    subQuestions: v.optional(v.any()), // Record<string, { count: number; type: 'letter' | 'roman'; subSub?: Record<string, { count: number; type: 'letter' | 'roman' }> }>. Outer key = main-Q number; subSub key = 0-based sub-index ("0" = first sub like "a" or "i"). See src/lib/sub-questions.ts.
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
    .index("by_center", ["centerId"])
    .index("by_slot", ["slotId"]),

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
    // Paper-class capacity: max students a paper (library) block in this room
    // can hold. Per-room because some rooms are small (6) and some big (10+).
    // Optional/undefined ⇒ no cap enforced. Personal classes ignore this (they
    // keep the ≤10 group cap elsewhere).
    capacity: v.optional(v.number()),
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
    // Explicit colour palette index, set when the user taps the dialog's colour
    // dot to cycle it. Unset ⇒ colour falls back to a hash of the group id (see
    // src/lib/groups/color.ts). Mirrored on draftGroups so planning edits it.
    colorIndex: v.optional(v.number()),
    // Legacy: pre-removal of the archive feature. Kept in the schema as
    // optional so existing rows still validate; new code never sets or
    // reads it. Hard delete is the only "remove" path now.
    archived: v.optional(v.boolean()),
    // First date this group's sessions count for analytics + Day-view ring
    // state. Sessions strictly before this date are "pre-tracking": they
    // render as muted on the Day view (no red 'needs entry' urgency) and are
    // excluded from every analytics aggregate. Used when a group existed
    // before the tutor started logging into the app, so historical schedule
    // shadows don't pollute revenue/attendance numbers. YYYY-MM-DD.
    loggingStartDate: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_center", ["centerId"])
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
    // ─── Phase W: forward target for inbound parent replies ─────────────────
    // Lead's (or mentor's) personal WhatsApp number in E.164. When set,
    // convex/messaging/inbound.ts pushes a "forward" outbound onto the queue
    // so this person sees the parent message on their own phone too. If
    // unset, only the in-app Parent Inbox notification fires.
    personalWhatsappPhone: v.optional(v.string()),
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

  // ─── Planning mode: the draft timetable "branch" ─────────────────────────
  // A private, saved copy of ONLY the four structural tables (groups, slots,
  // memberships, session-teachers). Edited through the same week view while
  // the Planning-mode toggle is on; never touched by the live app, analytics,
  // messaging or the engine. `sourceId` points back at the live row this was
  // copied from (absent ⇒ created fresh in the draft). Internal foreign keys
  // (slot→group, member→group, teacher→slot) point at DRAFT ids so the draft
  // is internally consistent; Merge remaps them to live ids. Pull/Merge logic
  // lives in convex/lib/draftReconcile.ts (pure, tested). One draft at a time.
  draftMeta: defineTable({
    status: v.string(), // "active" — a row's existence means a draft exists.
    createdAt: v.number(),
    lastPullAt: v.number(),
    // liveId → fingerprint captured at fork / last Pull, per table. Used to
    // tell "edited/deleted in the draft" apart from "live drifted".
    baseGroups: v.any(),
    baseSlots: v.any(),
    baseMembers: v.any(),
    baseTeachers: v.any(),
  }),
  draftGroups: defineTable({
    sourceId: v.optional(v.id("groups")),
    name: v.string(),
    autoName: v.boolean(),
    centerId: v.optional(v.id("centers")),
    grade: v.optional(v.number()),
    additionalGrades: v.optional(v.array(v.number())),
    mentorId: v.optional(v.id("teachers")),
    defaultRoomId: v.optional(v.id("rooms")),
    type: v.optional(v.string()),
    maxSize: v.optional(v.number()),
    targetMarksMin: v.optional(v.number()),
    targetMarksMax: v.optional(v.number()),
    colorIndex: v.optional(v.number()),
    // Mirror the legacy optional field on `groups` so forking a row that still
    // carries it validates (copy is field-for-field).
    archived: v.optional(v.boolean()),
    loggingStartDate: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_source", ["sourceId"]),
  draftSlots: defineTable({
    sourceId: v.optional(v.id("scheduleSlots")),
    dayOfWeek: v.number(),
    startTime: v.string(),
    endTime: v.string(),
    roomId: v.id("rooms"),
    groupId: v.optional(v.id("draftGroups")), // draft-space FK
  })
    .index("by_source", ["sourceId"])
    .index("by_group", ["groupId"]),
  draftGroupMembers: defineTable({
    sourceId: v.optional(v.id("groupMembers")),
    groupId: v.id("draftGroups"), // draft-space FK
    studentId: v.id("students"),
    joinedAt: v.number(),
    hourlyRate: v.optional(v.number()),
  })
    .index("by_source", ["sourceId"])
    .index("by_group", ["groupId"])
    .index("by_group_student", ["groupId", "studentId"]),
  draftSlotTeachers: defineTable({
    sourceId: v.optional(v.id("slotTeachers")),
    slotId: v.id("draftSlots"), // draft-space FK
    teacherId: v.id("teachers"),
  })
    .index("by_source", ["sourceId"])
    .index("by_slot", ["slotId"]),

  // ─── Paper classes (the "Library" feature) ──────────────────────────────
  // STUDENT-CENTRIC redesign (2026-06-18). The unit is no longer a room+teacher
  // "block" — it's a per-student assignment to a 1-hour time slot. The Library
  // grid is built by tap-and-dropping student pills onto hour slots; rooms +
  // teachers are assigned LATER, inside a slot's dialog, and are optional.
  // Deliberately SEPARATE from scheduleSlots so paper classes never touch
  // sheets / scoring / learning-engine / leaderboard. Scope = attendance +
  // billing only (flat 100 LKR / student / DAY).
  //
  // One row = "this student sits in paper class on this weekday + hour". The
  // grid cell is a 1-hour atom (startTime "15:00", endTime "16:00"); assigned
  // hours for a student = count of their rows. roomId is OPTIONAL physical
  // placement, set in the slot dialog; capacity (rooms.capacity) only WARNS.
  // Uniqueness (one row per student+day+start) is enforced in the mutation.
  paperAssignments: defineTable({
    studentId: v.id("students"),
    dayOfWeek: v.number(), // 1=Mon..7=Sun, same convention as scheduleSlots
    startTime: v.string(), // "HH:MM" (1-hour atom)
    endTime: v.string(),
    roomId: v.optional(v.id("rooms")), // where they physically sit; optional
  })
    .index("by_student", ["studentId"])
    .index("by_slot", ["dayOfWeek", "startTime"])
    .index("by_day", ["dayOfWeek"]),

  // Optional supervising teacher for a (slot, room). A row exists only when a
  // teacher is assigned to a specific room within a specific weekly hour slot.
  paperSlotTeachers: defineTable({
    dayOfWeek: v.number(),
    startTime: v.string(),
    roomId: v.id("rooms"),
    teacherId: v.id("teachers"),
  }).index("by_slot", ["dayOfWeek", "startTime"]),

  // Per-DATE daily roll-call. One row per (student, date). status
  // "present" | "absent". Drives billing: a present row = 100 LKR for that
  // day, regardless of how many hours / rooms the student sat in. Decoupled
  // from slots entirely — paper attendance is a single daily Library list.
  paperAttendance: defineTable({
    studentId: v.id("students"),
    date: v.string(),
    status: v.string(),
  })
    .index("by_student_date", ["studentId", "date"])
    .index("by_date", ["date"]),

  // Per-student weekly availability: the OUTSIDE commitments (e.g. night
  // classes) that make a student busy. One doc per student holding all their
  // busy windows. Personal-class times are NOT stored here — they're derived
  // live from the student's group slots when checking availability.
  studentAvailability: defineTable({
    studentId: v.id("students"),
    busy: v.array(
      v.object({
        dayOfWeek: v.number(), // 1=Mon..7=Sun
        startTime: v.string(), // "HH:MM"
        endTime: v.string(),
        label: v.optional(v.string()), // e.g. "Physics tuition"
      }),
    ),
  }).index("by_student", ["studentId"]),

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
    // Structured cancellation reason. Only meaningful when status =
    // "cancelled_by_tutor". One of: "sick" | "poya" | "festival" |
    // "students_unavailable" | "personal" | "other". The free-text `note`
    // field is still available for extra context on top of the reason.
    reason: v.optional(v.string()),
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
    // Downscaled (~900px wide JPEG) variant for thumbnails/inline views.
    // Generated client-side by the Settings "Optimize images" backfill
    // (convex/pageThumbnails.ts). Full-res storageId stays untouched and is
    // ALWAYS what the PDF renderer and crop workbenches use.
    smallStorageId: v.optional(v.id("_storage")),
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
    // Downscaled thumbnail variant — see textbookPages.smallStorageId.
    smallStorageId: v.optional(v.id("_storage")),
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
    // Exact position within its concept's Lesson Builder list (2026-07-13).
    // Written by drag-reorder (which also rewrites difficulty by position);
    // the catalog sort tie-breaks on it so the teacher's dragged order is
    // reproduced exactly (difficulty alone has only 5 buckets).
    pickerOrder: v.optional(v.number()),
    answerKey: v.optional(v.string()), // added later
    expectedTimeMin: v.optional(v.number()),
    // TEMPORARY-REMEDY repeat multiplier (Coverage drawer). Default 1 (== unset).
    // A pure scheduling/coverage construct — does NOT touch FSRS/mastery/
    // importance/calibration. Coverage gate reads effective count = Σ repeatCount
    // across a concept's leaves; the planner lets a question recirculate up to
    // repeatCount times within the novelty window before it rests. Reset to 1
    // once real questions are cropped to replace the stopgap.
    repeatCount: v.optional(v.number()),
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
    // Typed override ("digitalize as you go", 2026-06-12). When set, sheets
    // render the typed version instead of the page crop. overrideText is the
    // editable source (Tamil/English + $TeX$ math); overrideRender is the
    // browser-typeset PNG snapshot with its physical print size. Both are
    // set/cleared together via learningEngine/overrides.ts — never patch
    // one without the other.
    overrideText: v.optional(v.string()),
    overrideRender: v.optional(v.object({
      storageId: v.id("_storage"),
      widthMm: v.number(),
      heightMm: v.number(),
    })),
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
    // Manual "exam mode" switch (Founder, 2026-06-11). When true, the sheet
    // planner enters exam-week mode for this exam's term (Main block locks to
    // the exam term). Absent/false = off — exam-week is NEVER auto-triggered by
    // proximity anymore. See determinePhase in learningEngine/planner.ts.
    examModeActive: v.optional(v.boolean()),
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
    // ─── Sheet redesign (Phase 3): Revision section ────────────────────────
    // Spaced-repetition body — concepts due / about to be forgotten. Optional
    // for back-compat: pre-redesign rows have no array and render with no
    // Revision section. Print order: Warm-up → Main → Revision → Exam-prep.
    // NOTE the 4-section model (founder, 2026-06-04): the Warm-up section's
    // CONTENT becomes "recent mistakes" (Phase 4) — its field name stays
    // `warmupQuestionIds` to avoid a live-DB rename. No separate mistakes
    // array is created.
    revisionQuestionIds: v.optional(v.array(v.id("questionBank"))),
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
    // ─── Phase 2 (sheet-synced scoring): per-sheet marking state ────────────
    // Live marks the teacher enters on the scoring drawer, keyed by
    // questionBank id (as string) → "correct" | "wrong" | "skipped". Old
    // sheets have neither field; readers treat absence as {}.
    results: v.optional(v.record(v.string(), v.string())),
    // What finalize has already pushed to the engine (memoryState), so
    // re-finalizing is idempotent: applyAttempt fires only for questions
    // whose mark differs from committedMarks. questionId(string) → last mark.
    committedMarks: v.optional(v.record(v.string(), v.string())),
    // When the sheet was last finalized (committed to the engine).
    scoredAt: v.optional(v.number()),
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

  // ─── Phase 2 (sheet-synced scoring): per-session points, dual-tracked ─────
  // One row per finalized sheet. Both the legacy triangular points (pointsOld =
  // 5·C·(C+1)/2) and the new difficulty×section weighted points (pointsNew) are
  // computed from the SAME sheet marks and stored side by side, so the founder
  // can compare them in the admin scoring view before flipping the public
  // board. This table is NOT read by the live leaderboard/position — it is the
  // parallel-run surface only (see sheet_scoring_plan.md / Phase 2 spec §7).
  // Upserted by sheetId on every finalizeSheetScoring (recomputed wholesale).
  sessionPoints: defineTable({
    studentId: v.id("students"),
    sheetId: v.id("generatedSheets"),
    date: v.string(),                                 // YYYY-MM-DD (the sheet's practice day)
    slotId: v.optional(v.id("scheduleSlots")),
    correctCount: v.number(),
    totalQuestions: v.number(),
    pointsOld: v.number(),                            // legacy triangular: 5·C·(C+1)/2
    pointsNew: v.number(),                            // Σ BASE_POINTS·diffMult(d)·SECTION_MULT[section] + streak
    computedAt: v.number(),
  })
    .index("by_student_date", ["studentId", "date"])
    .index("by_sheet", ["sheetId"])
    .index("by_date", ["date"]),

  // ─── Sheet redesign (Phase 1): teacher-curated teaching path ─────────────
  // The teacher's chosen order of units to TEACH within a (grade, term),
  // across all six modules. Replaces the old weekday→module rule as the driver
  // of the Main block: the planner walks each student to the next not-yet-
  // introduced concept along this path (prereqs permitting). One row per
  // (grade, term); orderedUnitIds holds curriculum unit ids
  // ("M{n}-G{grade}-T{term}-{i}") in teaching order. Units missing from the
  // saved order are appended in natural curriculum order by readers, and stale
  // ids (units that no longer exist) are dropped at read time — so the row is
  // always tolerant of syllabus edits. No saved row ⇒ natural curriculum order.
  teachingPath: defineTable({
    grade: v.number(), // 6..11
    term: v.number(), // 1 | 2 | 3
    orderedUnitIds: v.array(v.string()),
    updatedAt: v.number(),
    updatedByTeacherId: v.optional(v.id("teachers")),
  }).index("by_grade_term", ["grade", "term"]),

  // ─── Phase 1 (track model): named cross-grade learning tracks (levels) ───
  // A track is a flat, teacher-curated, importance-filtered route through the
  // curriculum. `orderedUnitIds` may span multiple grades (e.g. a remedial
  // G7→G9 track). A unit is "skipped" for the track simply by being ABSENT
  // from orderedUnitIds. One track per student (students.trackId). The planner
  // walks this list for the Main block; ranking/promotion/map are later phases.
  tracks: defineTable({
    name: v.string(),                              // "On-level G9", "Remedial G7→G9 (core)"
    targetGrade: v.number(),                       // 6..11 — the exam this track aims at
    targetTerm: v.number(),                        // 1 | 2 | 3 — current target term
    orderedUnitIds: v.array(v.string()),           // cross-grade route, teaching order; ids "M{n}-G{g}-T{t}-{i}"
    level: v.number(),                             // promotion rank (lower = more remedial); used by Phase 3
    mergesIntoTrackId: v.optional(v.id("tracks")), // promote-into pointer; stored now, used by Phase 3/4
    active: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
    updatedByTeacherId: v.optional(v.id("teachers")),
  })
    .index("by_target_grade_term", ["targetGrade", "targetTerm"])
    .index("by_level", ["level"]),

  // ─── Phase 3 (cohort leagues): promotion audit log ───────────────────────
  // Append-only record of every track promotion. A row is written when a
  // student completes their track (all units cleared) and a teacher promotes
  // them into track.mergesIntoTrackId, OR when a teacher manually reassigns a
  // track. Drives the Phase 4 parent-share "promotion history" line and the
  // Leagues board audit. Never mutated after insert.
  //   reason: "completed-track" | "manual"
  promotions: defineTable({
    studentId: v.id("students"),
    fromTrackId: v.optional(v.id("tracks")),
    toTrackId: v.id("tracks"),
    reason: v.string(),                 // "completed-track" | "manual"
    byTeacherId: v.optional(v.id("teachers")),
    at: v.number(),
  })
    .index("by_student", ["studentId"])
    .index("by_track", ["toTrackId"]),

  // ─── Sheet redesign (Phase 7): per-unit teaching pace ────────────────────
  // Teacher's estimate of how many NEW concepts fit per session-hour for a
  // given unit. The Main-block planner uses this (when set) to size how many
  // new concepts to introduce: round(conceptsPerHour * sessionHours). When
  // absent it falls back to the global session-length heuristic
  // (MINUTES_PER_NEW_CONCEPT). Auto-maturation from observed completion is
  // explicitly out of scope for now (see TODO(maturity) in planner.ts).
  // Named Main-block "lesson sets" (Lesson Builder, 2026-07-11). A saved
  // tick-set of question ids for ONE unit — the teacher's reusable worksheet
  // ("Fractions — Layer 1") offered as a preset whenever a sheet's Main block
  // teaches that unit, for any student/group. Main-block only BY DESIGN:
  // warm-up/revision/exam-prep stay personal per student (the moat).
  unitLessonSets: defineTable({
    unitId: v.string(),
    name: v.string(),
    questionIds: v.array(v.id("questionBank")),
    createdAt: v.number(),
    updatedAt: v.number(),
    updatedByTeacherId: v.optional(v.id("teachers")),
  }).index("by_unit", ["unitId"]),

  unitPacing: defineTable({
    grade: v.number(),
    term: v.number(),
    unitId: v.string(),
    conceptsPerHour: v.number(),
    // Per-unit saved Main-block size (Founder, 2026-06-12). When set, the
    // sheet planner uses this as the Main section's question target for sheets
    // whose next new concept is in this unit — the "save for this unit" lever
    // from the generate-time control panel. A one-off sectionTargets.main from
    // the panel still wins for that single sheet.
    mainQuestions: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_grade_term_unit", ["grade", "term", "unitId"]),

  // ═══════════════════════════════════════════════════════════════════════
  // Phase W — WhatsApp integration (Open-WA provider, swappable to Meta API)
  // Full spec: whatsapp_integration_plan.md (gitignored). All outbound goes
  // through convex/messaging/provider.ts. NO cron jobs — every batch is
  // human-initiated. Inside a batch, sender self-chains with
  // ctx.scheduler.runAfter to enforce human-mimic spacing.
  // ═══════════════════════════════════════════════════════════════════════

  // One row per parent phone. Stores language preference + opt-out switch
  // independent of any student record, so siblings sharing a phone resolve
  // cleanly. The phone string IS the identity (UNIQUE enforced in the
  // upsertParentContact mutation, not via a DB constraint). students.parentPhone
  // remains the canonical phone column on the student side; both stores
  // hold the same E.164 string and writes normalize via src/lib/phone.ts.
  parentContacts: defineTable({
    phoneE164: v.string(),               // "+9477xxxxxxx"
    displayName: v.optional(v.string()), // "Mr. Sharma" — what the Lead types
    language: v.string(),                // "ta" | "en" — defaults to "ta"
    optedOut: v.boolean(),               // hard switch; sender always honours
    optedOutAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_phone", ["phoneE164"]),

  // Per-student override of which parentContact represents them. When unset,
  // the resolver falls back to lookup-by-students.parentPhone. Used for the
  // (rare) case where a student's "primary parent" is a different person to
  // whoever happens to be on the phone column.
  studentParents: defineTable({
    studentId: v.id("students"),
    parentContactId: v.id("parentContacts"),
    relationship: v.optional(v.string()), // "father" | "mother" | "guardian"
  })
    .index("by_student", ["studentId"])
    .index("by_parent", ["parentContactId"]),

  // WhatsApp groups the bot is a member of. groupScope lets the Broadcast UI
  // resolve "send to all Grade 8 Colombo groups" → matching rows. Bot must
  // already be a member of the WA group to post; sync action pulls from the
  // Open-WA REST groups endpoint.
  whatsappGroups: defineTable({
    whatsappGroupId: v.string(),          // Open-WA group id, e.g. "120363xxxxxxx@g.us"
    displayName: v.string(),
    scope: v.optional(v.object({
      grade: v.optional(v.number()),
      centerId: v.optional(v.id("centers")),
      moduleId: v.optional(v.string()),    // "M1".."M6"
      groupId: v.optional(v.id("groups")), // links a WA group to an internal teaching group
    })),
    syncedAt: v.optional(v.number()),
    active: v.boolean(),                   // false = soft-removed, hidden in pickers
    createdAt: v.number(),
  })
    .index("by_wa_id", ["whatsappGroupId"])
    .index("by_active", ["active"]),

  // Editable message templates. body uses {{var}} placeholders; the variable
  // contract per key lives in convex/messaging/templates.ts (in code, not DB)
  // so the renderer can fail loudly on missing vars. Seeded idempotently in
  // W.1; Lead edits body text from the /messaging/templates UI without a deploy.
  messageTemplates: defineTable({
    key: v.string(),                       // "absence_alert" | "weekly_card" | ...
    language: v.string(),                  // "ta" | "en"
    body: v.string(),
    active: v.boolean(),
    updatedByTeacherId: v.optional(v.id("teachers")),
    updatedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_key_lang", ["key", "language"])
    .index("by_active", ["active"]),

  // The outbox. Sender mutates `status` field-by-field; never deletes. One
  // row per message attempt (text or media), regardless of which batch
  // spawned it. Inbound forwarding to Lead/mentor also goes through here so
  // pacing rules apply uniformly.
  messageQueue: defineTable({
    // Routing
    templateKey: v.optional(v.string()),
    language: v.optional(v.string()),                // "ta" | "en"
    toType: v.string(),                              // "contact" | "group"
    toPhone: v.optional(v.string()),                 // E.164 when toType === "contact"
    toWhatsappGroupId: v.optional(v.string()),       // when toType === "group"
    // Context
    studentId: v.optional(v.id("students")),         // primary student this message is about
    conversationId: v.optional(v.id("conversations")),
    // Payload
    body: v.string(),                                // final rendered text (templates resolved)
    mediaStorageId: v.optional(v.id("_storage")),    // for image/PDF attachments
    mediaType: v.optional(v.string()),               // "image" | "document"
    mediaCaption: v.optional(v.string()),
    // Scheduling + state
    status: v.string(),                              // "draft" | "queued" | "sending" | "sent" | "failed" | "cancelled"
    priority: v.string(),                            // "low" | "normal" | "high"
    scheduledNotBefore: v.number(),                  // ms epoch; sender ignores until past
    attempts: v.number(),
    lastError: v.optional(v.string()),
    providerMessageId: v.optional(v.string()),       // returned by Open-WA on success
    // Provenance
    batchId: v.optional(v.string()),                 // shared by all msgs in one Lead-approved batch
    createdByTeacherId: v.optional(v.id("teachers")),
    approvedByTeacherId: v.optional(v.id("teachers")),
    approvedAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_status_priority", ["status", "priority", "scheduledNotBefore"])
    .index("by_batch", ["batchId"])
    .index("by_conversation", ["conversationId"])
    .index("by_student", ["studentId"])
    .index("by_status", ["status"]),

  // Append-only audit. Outbound writes here after each send attempt (success
  // or fail); inbound writes here on webhook ingest. Never mutated after
  // insert. Archival/truncation deferred until ~100k rows.
  messageLog: defineTable({
    direction: v.string(),                           // "in" | "out"
    phoneE164: v.optional(v.string()),               // counterparty phone
    whatsappGroupId: v.optional(v.string()),         // counterparty group
    studentId: v.optional(v.id("students")),
    queueId: v.optional(v.id("messageQueue")),       // outbound: source queue row
    conversationId: v.optional(v.id("conversations")),
    body: v.string(),
    mediaUrls: v.optional(v.array(v.string())),
    providerMessageId: v.optional(v.string()),
    status: v.string(),                              // out: "sent" | "failed"; in: "received"
    errorMessage: v.optional(v.string()),
    occurredAt: v.number(),
  })
    .index("by_phone_time", ["phoneE164", "occurredAt"])
    .index("by_student_time", ["studentId", "occurredAt"])
    .index("by_conversation_time", ["conversationId", "occurredAt"])
    .index("by_direction_time", ["direction", "occurredAt"]),

  // One row per (phoneE164) conversation thread. Inbox lists these sorted by
  // lastInboundAt. unreadCount is decremented when Lead opens the thread.
  conversations: defineTable({
    phoneE164: v.string(),
    parentContactId: v.optional(v.id("parentContacts")),
    primaryStudentId: v.optional(v.id("students")),  // resolved at create; siblings reachable via studentParents
    lastInboundAt: v.optional(v.number()),
    lastOutboundAt: v.optional(v.number()),
    unreadCount: v.number(),
    archived: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_phone", ["phoneE164"])
    .index("by_lastInbound", ["lastInboundAt"])
    .index("by_archived_lastInbound", ["archived", "lastInboundAt"]),

  // In-app notifications. Polled by the bell-icon component via useQuery; no
  // push, no service worker. Per-user via Clerk id. For Phase W: Lead gets
  // everything, mentors get whatsapp_parent_reply for matched students in
  // their groups (per W.1 brainstorm decision Q4).
  notifications: defineTable({
    userClerkId: v.string(),                         // recipient (Lead or mentor)
    type: v.string(),
    title: v.string(),
    body: v.optional(v.string()),
    priority: v.string(),                            // "low" | "normal" | "high" | "critical"
    actionUrl: v.optional(v.string()),
    payload: v.optional(v.any()),                    // freeform context
    seenAt: v.optional(v.number()),
    actionedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_user_seen_created", ["userClerkId", "seenAt", "createdAt"])
    .index("by_user_created", ["userClerkId", "createdAt"]),
});
