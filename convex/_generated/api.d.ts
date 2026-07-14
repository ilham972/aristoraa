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
import type * as crons from "../crons.js";
import type * as currentAssignments from "../currentAssignments.js";
import type * as doubts from "../doubts.js";
import type * as engineAlerts from "../engineAlerts.js";
import type * as entries from "../entries.js";
import type * as examAlerts from "../examAlerts.js";
import type * as exercises from "../exercises.js";
import type * as groupMigration from "../groupMigration.js";
import type * as groups from "../groups.js";
import type * as http from "../http.js";
import type * as lead from "../lead.js";
import type * as learningEngine_backfill from "../learningEngine/backfill.js";
import type * as learningEngine_calendar from "../learningEngine/calendar.js";
import type * as learningEngine_config from "../learningEngine/config.js";
import type * as learningEngine_coverage from "../learningEngine/coverage.js";
import type * as learningEngine_coverageForecast from "../learningEngine/coverageForecast.js";
import type * as learningEngine_coverageMode from "../learningEngine/coverageMode.js";
import type * as learningEngine_cropIntegrity from "../learningEngine/cropIntegrity.js";
import type * as learningEngine_derivedConcepts from "../learningEngine/derivedConcepts.js";
import type * as learningEngine_difficultyTab from "../learningEngine/difficultyTab.js";
import type * as learningEngine_groupPlan from "../learningEngine/groupPlan.js";
import type * as learningEngine_importance from "../learningEngine/importance.js";
import type * as learningEngine_leagues from "../learningEngine/leagues.js";
import type * as learningEngine_lessonSets from "../learningEngine/lessonSets.js";
import type * as learningEngine_map from "../learningEngine/map.js";
import type * as learningEngine_mastery from "../learningEngine/mastery.js";
import type * as learningEngine_memory from "../learningEngine/memory.js";
import type * as learningEngine_overrides from "../learningEngine/overrides.js";
import type * as learningEngine_path from "../learningEngine/path.js";
import type * as learningEngine_pdf from "../learningEngine/pdf.js";
import type * as learningEngine_pdfHelpers from "../learningEngine/pdfHelpers.js";
import type * as learningEngine_planner from "../learningEngine/planner.js";
import type * as learningEngine_profile from "../learningEngine/profile.js";
import type * as learningEngine_scoring from "../learningEngine/scoring.js";
import type * as learningEngine_sheets from "../learningEngine/sheets.js";
import type * as learningEngine_studentDashboard from "../learningEngine/studentDashboard.js";
import type * as learningEngine_trackProgress from "../learningEngine/trackProgress.js";
import type * as learningEngine_tracks from "../learningEngine/tracks.js";
import type * as lib_consolidationCore from "../lib/consolidationCore.js";
import type * as lib_coverageForecastCore from "../lib/coverageForecastCore.js";
import type * as lib_draftReconcile from "../lib/draftReconcile.js";
import type * as lib_groupPlanCore from "../lib/groupPlanCore.js";
import type * as lib_naming from "../lib/naming.js";
import type * as lib_offDays from "../lib/offDays.js";
import type * as lib_paperClasses from "../lib/paperClasses.js";
import type * as lib_phone from "../lib/phone.js";
import type * as lib_roster from "../lib/roster.js";
import type * as lib_rosterMoves from "../lib/rosterMoves.js";
import type * as lib_slotMerge from "../lib/slotMerge.js";
import type * as lib_slotNormalize from "../lib/slotNormalize.js";
import type * as lib_trackProgressCore from "../lib/trackProgressCore.js";
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
import type * as pageThumbnails from "../pageThumbnails.js";
import type * as paperClasses from "../paperClasses.js";
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
import type * as studentAvailability from "../studentAvailability.js";
import type * as studentModulePositions from "../studentModulePositions.js";
import type * as students from "../students.js";
import type * as teachers from "../teachers.js";
import type * as textbookPages from "../textbookPages.js";
import type * as textbooks from "../textbooks.js";
import type * as timeline from "../timeline.js";
import type * as timetableDraft from "../timetableDraft.js";
import type * as timetableDraftEdit from "../timetableDraftEdit.js";
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
  crons: typeof crons;
  currentAssignments: typeof currentAssignments;
  doubts: typeof doubts;
  engineAlerts: typeof engineAlerts;
  entries: typeof entries;
  examAlerts: typeof examAlerts;
  exercises: typeof exercises;
  groupMigration: typeof groupMigration;
  groups: typeof groups;
  http: typeof http;
  lead: typeof lead;
  "learningEngine/backfill": typeof learningEngine_backfill;
  "learningEngine/calendar": typeof learningEngine_calendar;
  "learningEngine/config": typeof learningEngine_config;
  "learningEngine/coverage": typeof learningEngine_coverage;
  "learningEngine/coverageForecast": typeof learningEngine_coverageForecast;
  "learningEngine/coverageMode": typeof learningEngine_coverageMode;
  "learningEngine/cropIntegrity": typeof learningEngine_cropIntegrity;
  "learningEngine/derivedConcepts": typeof learningEngine_derivedConcepts;
  "learningEngine/difficultyTab": typeof learningEngine_difficultyTab;
  "learningEngine/groupPlan": typeof learningEngine_groupPlan;
  "learningEngine/importance": typeof learningEngine_importance;
  "learningEngine/leagues": typeof learningEngine_leagues;
  "learningEngine/lessonSets": typeof learningEngine_lessonSets;
  "learningEngine/map": typeof learningEngine_map;
  "learningEngine/mastery": typeof learningEngine_mastery;
  "learningEngine/memory": typeof learningEngine_memory;
  "learningEngine/overrides": typeof learningEngine_overrides;
  "learningEngine/path": typeof learningEngine_path;
  "learningEngine/pdf": typeof learningEngine_pdf;
  "learningEngine/pdfHelpers": typeof learningEngine_pdfHelpers;
  "learningEngine/planner": typeof learningEngine_planner;
  "learningEngine/profile": typeof learningEngine_profile;
  "learningEngine/scoring": typeof learningEngine_scoring;
  "learningEngine/sheets": typeof learningEngine_sheets;
  "learningEngine/studentDashboard": typeof learningEngine_studentDashboard;
  "learningEngine/trackProgress": typeof learningEngine_trackProgress;
  "learningEngine/tracks": typeof learningEngine_tracks;
  "lib/consolidationCore": typeof lib_consolidationCore;
  "lib/coverageForecastCore": typeof lib_coverageForecastCore;
  "lib/draftReconcile": typeof lib_draftReconcile;
  "lib/groupPlanCore": typeof lib_groupPlanCore;
  "lib/naming": typeof lib_naming;
  "lib/offDays": typeof lib_offDays;
  "lib/paperClasses": typeof lib_paperClasses;
  "lib/phone": typeof lib_phone;
  "lib/roster": typeof lib_roster;
  "lib/rosterMoves": typeof lib_rosterMoves;
  "lib/slotMerge": typeof lib_slotMerge;
  "lib/slotNormalize": typeof lib_slotNormalize;
  "lib/trackProgressCore": typeof lib_trackProgressCore;
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
  pageThumbnails: typeof pageThumbnails;
  paperClasses: typeof paperClasses;
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
  studentAvailability: typeof studentAvailability;
  studentModulePositions: typeof studentModulePositions;
  students: typeof students;
  teachers: typeof teachers;
  textbookPages: typeof textbookPages;
  textbooks: typeof textbooks;
  timeline: typeof timeline;
  timetableDraft: typeof timetableDraft;
  timetableDraftEdit: typeof timetableDraftEdit;
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
