/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as attendance from "../attendance.js";
import type * as centers from "../centers.js";
import type * as currentAssignments from "../currentAssignments.js";
import type * as doubts from "../doubts.js";
import type * as entries from "../entries.js";
import type * as exercises from "../exercises.js";
import type * as lead from "../lead.js";
import type * as migrations from "../migrations.js";
import type * as questionBank from "../questionBank.js";
import type * as rooms from "../rooms.js";
import type * as scheduleSlots from "../scheduleSlots.js";
import type * as seed from "../seed.js";
import type * as sessionSubmissions from "../sessionSubmissions.js";
import type * as settings from "../settings.js";
import type * as slotStudents from "../slotStudents.js";
import type * as slotTeachers from "../slotTeachers.js";
import type * as studentModulePositions from "../studentModulePositions.js";
import type * as students from "../students.js";
import type * as teachers from "../teachers.js";
import type * as textbookPages from "../textbookPages.js";
import type * as textbooks from "../textbooks.js";
import type * as timeline from "../timeline.js";
import type * as unitMetadata from "../unitMetadata.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  attendance: typeof attendance;
  centers: typeof centers;
  currentAssignments: typeof currentAssignments;
  doubts: typeof doubts;
  entries: typeof entries;
  exercises: typeof exercises;
  lead: typeof lead;
  migrations: typeof migrations;
  questionBank: typeof questionBank;
  rooms: typeof rooms;
  scheduleSlots: typeof scheduleSlots;
  seed: typeof seed;
  sessionSubmissions: typeof sessionSubmissions;
  settings: typeof settings;
  slotStudents: typeof slotStudents;
  slotTeachers: typeof slotTeachers;
  studentModulePositions: typeof studentModulePositions;
  students: typeof students;
  teachers: typeof teachers;
  textbookPages: typeof textbookPages;
  textbooks: typeof textbooks;
  timeline: typeof timeline;
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
