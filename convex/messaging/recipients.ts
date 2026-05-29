// Phase W: resolves the set of Clerk user ids that should receive an in-app
// notification for a given inbound or system event.
//
// Lead clerkIds: every teacher with role === "lead".
// Mentor clerkIds for a set of matched students: every teacher who mentors
// at least one of the students' groups (via groupMembers → groups.mentorId).
//
// All helpers are pure (read-only). Callers are internal mutations / actions
// in convex/messaging/* and convex/notifications.ts.

import type { Doc, Id } from "../_generated/dataModel";
import type { GenericDatabaseReader } from "convex/server";
import type { DataModel } from "../_generated/dataModel";

type DBR = GenericDatabaseReader<DataModel>;

export async function getLeadClerkIds(db: DBR): Promise<string[]> {
  const teachers = await db.query("teachers").collect();
  const leads = teachers.filter((t) => t.role === "lead");
  return Array.from(new Set(leads.map((t) => t.clerkUserId)));
}

export async function getLeadTeachers(db: DBR): Promise<Doc<"teachers">[]> {
  const teachers = await db.query("teachers").collect();
  return teachers.filter((t) => t.role === "lead");
}

// For a list of student ids, find every distinct mentor (teacher) of any
// group those students belong to. Returns the full teacher docs so callers
// can read both clerkUserId and personalWhatsappPhone in one pass.
export async function getMentorTeachersForStudents(
  db: DBR,
  studentIds: Id<"students">[],
): Promise<Doc<"teachers">[]> {
  if (studentIds.length === 0) return [];
  const groupIdSet = new Set<string>();
  for (const studentId of studentIds) {
    const memberships = await db
      .query("groupMembers")
      .withIndex("by_student", (q) => q.eq("studentId", studentId))
      .collect();
    for (const m of memberships) groupIdSet.add(m.groupId);
  }
  if (groupIdSet.size === 0) return [];
  const mentorIdSet = new Set<string>();
  for (const groupIdStr of Array.from(groupIdSet)) {
    const group = await db.get(groupIdStr as Id<"groups">);
    if (group?.mentorId) mentorIdSet.add(group.mentorId);
  }
  if (mentorIdSet.size === 0) return [];
  const teachers: Doc<"teachers">[] = [];
  for (const mentorIdStr of Array.from(mentorIdSet)) {
    const t = await db.get(mentorIdStr as Id<"teachers">);
    if (t) teachers.push(t);
  }
  return teachers;
}

export async function getMentorClerkIdsForStudents(
  db: DBR,
  studentIds: Id<"students">[],
): Promise<string[]> {
  const mentors = await getMentorTeachersForStudents(db, studentIds);
  return Array.from(new Set(mentors.map((t) => t.clerkUserId)));
}
