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
import type * as http from "../http.js";
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
import type * as learningEngine_path from "../learningEngine/path.js";
import type * as learningEngine_pdf from "../learningEngine/pdf.js";
import type * as learningEngine_pdfHelpers from "../learningEngine/pdfHelpers.js";
import type * as learningEngine_planner from "../learningEngine/planner.js";
import type * as learningEngine_profile from "../learningEngine/profile.js";
import type * as learningEngine_sheets from "../learningEngine/sheets.js";
import type * as learningEngine_studentDashboard from "../learningEngine/studentDashboard.js";
import type * as lib_naming from "../lib/naming.js";
import type * as lib_phone from "../lib/phone.js";
import type * as lib_roster from "../lib/roster.js";
import type * as messaging_absenceAlerts from "../messaging/absenceAlerts.js";
import type * as messaging_broadcasts from "../messaging/broadcasts.js";
import type * as messaging_connectWebhook from "../messaging/connectWebhook.js";
import type * as messaging_contacts from "../messaging/contacts.js";
import type * as messaging_groupsWa from "../messaging/groupsWa.js";
import type * as messaging_inbound from "../messaging/inbound.js";
import type * as messaging_inbox from "../messaging/inbox.js";
import type * as messaging_outbox from "../messaging/outbox.js";
import type * as messaging_policy from "../messaging/policy.js";
import type * as messaging_provider from "../messaging/provider.js";
import type * as messaging_queue from "../messaging/queue.js";
import type * as messaging_recipients from "../messaging/recipients.js";
import type * as messaging_seedTemplates from "../messaging/seedTemplates.js";
import type * as messaging_sendTest from "../messaging/sendTest.js";
import type * as messaging_sessionStatus from "../messaging/sessionStatus.js";
import type * as messaging_settings from "../messaging/settings.js";
import type * as messaging_templates from "../messaging/templates.js";
import type * as messaging_templatesAdmin from "../messaging/templatesAdmin.js";
import type * as messaging_testSend from "../messaging/testSend.js";
import type * as messaging_tomorrowReminders from "../messaging/tomorrowReminders.js";
import type * as messaging_weeklyCards from "../messaging/weeklyCards.js";
import type * as migrations from "../migrations.js";
import type * as notifications from "../notifications.js";
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
  http: typeof http;
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
  "learningEngine/path": typeof learningEngine_path;
  "learningEngine/pdf": typeof learningEngine_pdf;
  "learningEngine/pdfHelpers": typeof learningEngine_pdfHelpers;
  "learningEngine/planner": typeof learningEngine_planner;
  "learningEngine/profile": typeof learningEngine_profile;
  "learningEngine/sheets": typeof learningEngine_sheets;
  "learningEngine/studentDashboard": typeof learningEngine_studentDashboard;
  "lib/naming": typeof lib_naming;
  "lib/phone": typeof lib_phone;
  "lib/roster": typeof lib_roster;
  "messaging/absenceAlerts": typeof messaging_absenceAlerts;
  "messaging/broadcasts": typeof messaging_broadcasts;
  "messaging/connectWebhook": typeof messaging_connectWebhook;
  "messaging/contacts": typeof messaging_contacts;
  "messaging/groupsWa": typeof messaging_groupsWa;
  "messaging/inbound": typeof messaging_inbound;
  "messaging/inbox": typeof messaging_inbox;
  "messaging/outbox": typeof messaging_outbox;
  "messaging/policy": typeof messaging_policy;
  "messaging/provider": typeof messaging_provider;
  "messaging/queue": typeof messaging_queue;
  "messaging/recipients": typeof messaging_recipients;
  "messaging/seedTemplates": typeof messaging_seedTemplates;
  "messaging/sendTest": typeof messaging_sendTest;
  "messaging/sessionStatus": typeof messaging_sessionStatus;
  "messaging/settings": typeof messaging_settings;
  "messaging/templates": typeof messaging_templates;
  "messaging/templatesAdmin": typeof messaging_templatesAdmin;
  "messaging/testSend": typeof messaging_testSend;
  "messaging/tomorrowReminders": typeof messaging_tomorrowReminders;
  "messaging/weeklyCards": typeof messaging_weeklyCards;
  migrations: typeof migrations;
  notifications: typeof notifications;
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
