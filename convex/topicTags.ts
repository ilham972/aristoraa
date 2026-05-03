import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Normalize a tag name for soft-uniqueness checks. Convex doesn't enforce
// unique indexes, so we lowercase + trim before comparing.
function norm(name: string): string {
  return name.trim().toLowerCase();
}

export const list = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const tags = await ctx.db.query("examTopicTags").collect();
    return tags.sort((a, b) => {
      const am = a.moduleId ?? "ZZ";
      const bm = b.moduleId ?? "ZZ";
      if (am !== bm) return am.localeCompare(bm);
      return a.name.localeCompare(b.name);
    });
  },
});

export const getById = query({
  args: { id: v.id("examTopicTags") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const tag = await ctx.db.get(args.id);
    if (!tag) return null;
    const links = await ctx.db
      .query("examTopicTagLinks")
      .withIndex("by_tag", (q) => q.eq("tagId", args.id))
      .collect();
    return { tag, links };
  },
});

// Concept-type exercises living inside any unit linked to this tag, grouped
// by (grade, term, unitId). Powers the tag detail page's derived-concepts
// section. The order within each unit is by exercise.order; groups are sorted
// by grade ↑ then term ↑.
export const getLinkedConcepts = query({
  args: { tagId: v.id("examTopicTags") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const links = await ctx.db
      .query("examTopicTagLinks")
      .withIndex("by_tag", (q) => q.eq("tagId", args.tagId))
      .collect();

    const groups = await Promise.all(
      links.map(async (link) => {
        const exercises = await ctx.db
          .query("exercises")
          .withIndex("by_unit", (q) => q.eq("unitId", link.unitId))
          .collect();
        const concepts = exercises
          .filter((e) => e.type === "concept")
          .sort((a, b) => a.order - b.order);
        return {
          unitId: link.unitId,
          grade: link.grade,
          term: link.term,
          moduleId: link.moduleId,
          concepts,
        };
      }),
    );

    return groups.sort((a, b) => {
      if (a.grade !== b.grade) return a.grade - b.grade;
      if (a.term !== b.term) return a.term - b.term;
      return a.moduleId.localeCompare(b.moduleId);
    });
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    moduleId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const trimmed = args.name.trim();
    if (!trimmed) throw new Error("Tag name required");
    const target = norm(trimmed);
    const all = await ctx.db.query("examTopicTags").collect();
    if (all.some((t) => norm(t.name) === target)) {
      throw new Error("Tag name already exists");
    }
    return await ctx.db.insert("examTopicTags", {
      name: trimmed,
      description: args.description,
      color: args.color,
      moduleId: args.moduleId,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("examTopicTags"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    moduleId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const { id, ...patch } = args;
    if (patch.name !== undefined) {
      const trimmed = patch.name.trim();
      if (!trimmed) throw new Error("Tag name required");
      const target = norm(trimmed);
      const all = await ctx.db.query("examTopicTags").collect();
      if (all.some((t) => t._id !== id && norm(t.name) === target)) {
        throw new Error("Tag name already exists");
      }
      patch.name = trimmed;
    }
    await ctx.db.patch(id, patch);
  },
});

// Cascade delete: remove all unit links + slot-tag rows + clear topicTagId
// on every questionBank row referencing this tag. Caller (UI) confirms first.
export const remove = mutation({
  args: { id: v.id("examTopicTags") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const links = await ctx.db
      .query("examTopicTagLinks")
      .withIndex("by_tag", (q) => q.eq("tagId", args.id))
      .collect();
    for (const l of links) await ctx.db.delete(l._id);

    const slotTags = await ctx.db
      .query("paperStructureSlotTags")
      .withIndex("by_tag", (q) => q.eq("tagId", args.id))
      .collect();
    for (const s of slotTags) await ctx.db.delete(s._id);

    const tagged = await ctx.db
      .query("questionBank")
      .withIndex("by_topic_tag", (q) => q.eq("topicTagId", args.id))
      .collect();
    for (const q of tagged) {
      await ctx.db.patch(q._id, { topicTagId: undefined });
    }

    await ctx.db.delete(args.id);
  },
});

export const addUnitLink = mutation({
  args: {
    tagId: v.id("examTopicTags"),
    unitId: v.string(),
    grade: v.number(),
    term: v.number(),
    moduleId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const existing = await ctx.db
      .query("examTopicTagLinks")
      .withIndex("by_tag_unit", (q) =>
        q.eq("tagId", args.tagId).eq("unitId", args.unitId),
      )
      .first();
    if (existing) return existing._id;
    return await ctx.db.insert("examTopicTagLinks", {
      tagId: args.tagId,
      unitId: args.unitId,
      grade: args.grade,
      term: args.term,
      moduleId: args.moduleId,
      createdAt: Date.now(),
    });
  },
});

export const removeUnitLink = mutation({
  args: { tagId: v.id("examTopicTags"), unitId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const rows = await ctx.db
      .query("examTopicTagLinks")
      .withIndex("by_tag_unit", (q) =>
        q.eq("tagId", args.tagId).eq("unitId", args.unitId),
      )
      .collect();
    for (const r of rows) await ctx.db.delete(r._id);
  },
});

// Replace-all: deletes every existing link not in `units` and inserts every
// missing one. Used by the unit-link picker's Save action.
export const setUnitLinks = mutation({
  args: {
    tagId: v.id("examTopicTags"),
    units: v.array(
      v.object({
        unitId: v.string(),
        grade: v.number(),
        term: v.number(),
        moduleId: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const existing = await ctx.db
      .query("examTopicTagLinks")
      .withIndex("by_tag", (q) => q.eq("tagId", args.tagId))
      .collect();

    const desired = new Set(args.units.map((u) => u.unitId));
    const existingByUnit = new Map(existing.map((e) => [e.unitId, e]));

    for (const e of existing) {
      if (!desired.has(e.unitId)) await ctx.db.delete(e._id);
    }
    for (const u of args.units) {
      if (existingByUnit.has(u.unitId)) continue;
      await ctx.db.insert("examTopicTagLinks", {
        tagId: args.tagId,
        unitId: u.unitId,
        grade: u.grade,
        term: u.term,
        moduleId: u.moduleId,
        createdAt: Date.now(),
      });
    }
  },
});

// Counts of questionBank rows per tag — used by the tag list view's badge.
export const getQuestionCounts = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return {} as Record<string, number>;
    const rows = await ctx.db.query("questionBank").collect();
    const counts: Record<string, number> = {};
    for (const r of rows) {
      if (!r.topicTagId) continue;
      counts[r.topicTagId] = (counts[r.topicTagId] ?? 0) + 1;
    }
    return counts;
  },
});
