/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as _assets_notoSansTamil from "../_assets/notoSansTamil.js";
import type * as analytics from "../analytics.js";
import type * as attendance from "../attendance.js";
import type * as centers from "../centers.js";
import type * as currentAssignments from "../currentAssignments.js";
import type * as doubts from "../doubts.js";
import type * as entries from "../entries.js";
import type * as exercises from "../exercises.js";
import type * as groupMigration from "../groupMigration.js";
import type * as groups from "../groups.js";
import type * as lead from "../lead.js";
import type * as learningEngine_backfill from "../learningEngine/backfill.js";
import type * as learningEngine_calendar from "../learningEngine/calendar.js";
import type * as learningEngine_config from "../learningEngine/config.js";
import type * as learningEngine_coverage from "../learningEngine/coverage.js";
import type * as learningEngine_cropIntegrity from "../learningEngine/cropIntegrity.js";
import type * as learningEngine_derivedConcepts from "../learningEngine/derivedConcepts.js";
import type * as learningEngine_difficultyTab from "../learningEngine/difficultyTab.js";
import type * as learningEngine_importance from "../learningEngine/importance.js";
import type * as learningEngine_mastery from "../learningEngine/mastery.js";
import type * as learningEngine_memory from "../learningEngine/memory.js";
import type * as learningEngine_pdf from "../learningEngine/pdf.js";
import type * as learningEngine_pdfHelpers from "../learningEngine/pdfHelpers.js";
import type * as learningEngine_planner from "../learningEngine/planner.js";
import type * as learningEngine_profile from "../learningEngine/profile.js";
import type * as learningEngine_sheets from "../learningEngine/sheets.js";
import type * as learningEngine_studentDashboard from "../learningEngine/studentDashboard.js";
import type * as lib_naming from "../lib/naming.js";
import type * as lib_roster from "../lib/roster.js";
import type * as migrations from "../migrations.js";
import type * as paperStructures from "../paperStructures.js";
import type * as pastPaperPages from "../pastPaperPages.js";
import type * as pastPapers from "../pastPapers.js";
import type * as questionBank from "../questionBank.js";
import type * as rooms from "../rooms.js";
import type * as scheduleSlots from "../scheduleSlots.js";
import type * as seed from "../seed.js";
import type * as seeds_paperStructures from "../seeds/paperStructures.js";
import type * as seeds_topicTags from "../seeds/topicTags.js";
import type * as sessionRecords from "../sessionRecords.js";
import type * as sessionSubmissions from "../sessionSubmissions.js";
import type * as settings from "../settings.js";
import type * as slotTeachers from "../slotTeachers.js";
import type * as studentModulePositions from "../studentModulePositions.js";
import type * as students from "../students.js";
import type * as teachers from "../teachers.js";
import type * as textbookPages from "../textbookPages.js";
import type * as textbooks from "../textbooks.js";
import type * as timeline from "../timeline.js";
import type * as topicTags from "../topicTags.js";
import type * as unitMetadata from "../unitMetadata.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "_assets/notoSansTamil": typeof _assets_notoSansTamil;
  analytics: typeof analytics;
  attendance: typeof attendance;
  centers: typeof centers;
  currentAssignments: typeof currentAssignments;
  doubts: typeof doubts;
  entries: typeof entries;
  exercises: typeof exercises;
  groupMigration: typeof groupMigration;
  groups: typeof groups;
  lead: typeof lead;
  "learningEngine/backfill": typeof learningEngine_backfill;
  "learningEngine/calendar": typeof learningEngine_calendar;
  "learningEngine/config": typeof learningEngine_config;
  "learningEngine/coverage": typeof learningEngine_coverage;
  "learningEngine/cropIntegrity": typeof learningEngine_cropIntegrity;
  "learningEngine/derivedConcepts": typeof learningEngine_derivedConcepts;
  "learningEngine/difficultyTab": typeof learningEngine_difficultyTab;
  "learningEngine/importance": typeof learningEngine_importance;
  "learningEngine/mastery": typeof learningEngine_mastery;
  "learningEngine/memory": typeof learningEngine_memory;
  "learningEngine/pdf": typeof learningEngine_pdf;
  "learningEngine/pdfHelpers": typeof learningEngine_pdfHelpers;
  "learningEngine/planner": typeof learningEngine_planner;
  "learningEngine/profile": typeof learningEngine_profile;
  "learningEngine/sheets": typeof learningEngine_sheets;
  "learningEngine/studentDashboard": typeof learningEngine_studentDashboard;
  "lib/naming": typeof lib_naming;
  "lib/roster": typeof lib_roster;
  migrations: typeof migrations;
  paperStructures: typeof paperStructures;
  pastPaperPages: typeof pastPaperPages;
  pastPapers: typeof pastPapers;
  questionBank: typeof questionBank;
  rooms: typeof rooms;
  scheduleSlots: typeof scheduleSlots;
  seed: typeof seed;
  "seeds/paperStructures": typeof seeds_paperStructures;
  "seeds/topicTags": typeof seeds_topicTags;
  sessionRecords: typeof sessionRecords;
  sessionSubmissions: typeof sessionSubmissions;
  settings: typeof settings;
  slotTeachers: typeof slotTeachers;
  studentModulePositions: typeof studentModulePositions;
  students: typeof students;
  teachers: typeof teachers;
  textbookPages: typeof textbookPages;
  textbooks: typeof textbooks;
  timeline: typeof timeline;
  topicTags: typeof topicTags;
  unitMetadata: typeof unitMetadata;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
