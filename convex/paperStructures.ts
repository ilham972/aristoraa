import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// ─── Queries ────────────────────────────────────────────────────────────

export const list = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return await ctx.db.query("paperStructures").collect();
  },
});

export const getByGrade = query({
  args: { grade: v.number() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const structure = await ctx.db
      .query("paperStructures")
      .withIndex("by_grade", (q) => q.eq("grade", args.grade))
      .first();
    if (!structure) return null;

    const parts = await ctx.db
      .query("paperStructureParts")
      .withIndex("by_structure_order", (q) =>
        q.eq("structureId", structure._id),
      )
      .collect();
    parts.sort((a, b) => a.order - b.order);

    const slotTagsByPart = await Promise.all(
      parts.map((p) =>
        ctx.db
          .query("paperStructureSlotTags")
          .withIndex("by_part", (q) => q.eq("partId", p._id))
          .collect(),
      ),
    );
    const slotTags = slotTagsByPart.flat();

    return { structure, parts, slotTags };
  },
});

// ─── Structure mutations ───────────────────────────────────────────────

export const createStructure = mutation({
  args: {
    grade: v.number(),
    divisionFactor: v.number(),
    parts: v.array(
      v.object({
        partCode: v.string(),
        partLabel: v.string(),
        questionCount: v.number(),
        marksPerQuestion: v.number(),
        requiredCount: v.number(),
        order: v.number(),
        notes: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const existing = await ctx.db
      .query("paperStructures")
      .withIndex("by_grade", (q) => q.eq("grade", args.grade))
      .first();
    if (existing) {
      throw new Error(`Paper structure for grade ${args.grade} already exists`);
    }

    const totalRawMarks = args.parts.reduce(
      (sum, p) => sum + p.requiredCount * p.marksPerQuestion,
      0,
    );

    const now = Date.now();
    const structureId = await ctx.db.insert("paperStructures", {
      grade: args.grade,
      divisionFactor: args.divisionFactor,
      totalRawMarks,
      scaledTotal: totalRawMarks / args.divisionFactor,
      createdAt: now,
      updatedAt: now,
    });

    for (const p of args.parts) {
      if (p.requiredCount > p.questionCount) {
        throw new Error(
          `Part ${p.partCode}: requiredCount (${p.requiredCount}) cannot exceed questionCount (${p.questionCount})`,
        );
      }
      await ctx.db.insert("paperStructureParts", {
        structureId,
        ...p,
      });
    }

    return structureId;
  },
});

export const updateStructure = mutation({
  args: {
    id: v.id("paperStructures"),
    divisionFactor: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const { id, ...patch } = args;
    const cur = await ctx.db.get(id);
    if (!cur) throw new Error("Paper structure not found");

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (patch.notes !== undefined) updates.notes = patch.notes;
    if (patch.divisionFactor !== undefined) {
      updates.divisionFactor = patch.divisionFactor;
      updates.scaledTotal = cur.totalRawMarks / patch.divisionFactor;
    }
    await ctx.db.patch(id, updates);
  },
});

// Recompute totalRawMarks/scaledTotal for a structure based on its parts.
async function recomputeTotals(
  ctx: { db: { query: (table: string) => any; get: (id: any) => any; patch: (id: any, p: any) => any } },
  structureId: import("./_generated/dataModel").Id<"paperStructures">,
) {
  const parts = await ctx.db
    .query("paperStructureParts")
    .withIndex("by_structure", (q: any) => q.eq("structureId", structureId))
    .collect();
  const totalRawMarks = parts.reduce(
    (sum: number, p: any) => sum + p.requiredCount * p.marksPerQuestion,
    0,
  );
  const cur = await ctx.db.get(structureId);
  if (!cur) return;
  await ctx.db.patch(structureId, {
    totalRawMarks,
    scaledTotal: totalRawMarks / cur.divisionFactor,
    updatedAt: Date.now(),
  });
}

// ─── Part mutations ────────────────────────────────────────────────────

export const addPart = mutation({
  args: {
    structureId: v.id("paperStructures"),
    partCode: v.string(),
    partLabel: v.string(),
    questionCount: v.number(),
    marksPerQuestion: v.number(),
    requiredCount: v.number(),
    order: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    if (args.requiredCount > args.questionCount) {
      throw new Error("requiredCount cannot exceed questionCount");
    }

    const siblings = await ctx.db
      .query("paperStructureParts")
      .withIndex("by_structure", (q) => q.eq("structureId", args.structureId))
      .collect();
    if (siblings.some((s) => s.partCode === args.partCode)) {
      throw new Error(`Part code "${args.partCode}" already exists`);
    }

    const id = await ctx.db.insert("paperStructureParts", {
      structureId: args.structureId,
      partCode: args.partCode,
      partLabel: args.partLabel,
      questionCount: args.questionCount,
      marksPerQuestion: args.marksPerQuestion,
      requiredCount: args.requiredCount,
      order: args.order,
      notes: args.notes,
    });

    await recomputeTotals(ctx as any, args.structureId);
    return id;
  },
});

export const updatePart = mutation({
  args: {
    id: v.id("paperStructureParts"),
    partLabel: v.optional(v.string()),
    questionCount: v.optional(v.number()),
    marksPerQuestion: v.optional(v.number()),
    requiredCount: v.optional(v.number()),
    order: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const { id, ...patch } = args;
    const cur = await ctx.db.get(id);
    if (!cur) throw new Error("Part not found");

    const nextQc = patch.questionCount ?? cur.questionCount;
    const nextRc = patch.requiredCount ?? cur.requiredCount;
    if (nextRc > nextQc) {
      throw new Error("requiredCount cannot exceed questionCount");
    }

    await ctx.db.patch(id, patch);

    // If questionCount shrunk, cascade-delete slot-tag rows above the new max.
    if (patch.questionCount !== undefined && patch.questionCount < cur.questionCount) {
      const orphan = await ctx.db
        .query("paperStructureSlotTags")
        .withIndex("by_part", (q) => q.eq("partId", id))
        .collect();
      for (const s of orphan) {
        if (s.slotNumber > patch.questionCount) await ctx.db.delete(s._id);
      }
    }

    await recomputeTotals(ctx as any, cur.structureId);
  },
});

export const removePart = mutation({
  args: { id: v.id("paperStructureParts") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const cur = await ctx.db.get(args.id);
    if (!cur) return;
    const slots = await ctx.db
      .query("paperStructureSlotTags")
      .withIndex("by_part", (q) => q.eq("partId", args.id))
      .collect();
    for (const s of slots) await ctx.db.delete(s._id);
    await ctx.db.delete(args.id);
    await recomputeTotals(ctx as any, cur.structureId);
  },
});

// ─── Slot tag mutations ────────────────────────────────────────────────

export const setSlotTag = mutation({
  args: {
    partId: v.id("paperStructureParts"),
    slotNumber: v.number(),
    tagId: v.id("examTopicTags"),
    mode: v.string(), // "permanent" | "option"
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    if (args.mode !== "permanent" && args.mode !== "option") {
      throw new Error('mode must be "permanent" or "option"');
    }
    const part = await ctx.db.get(args.partId);
    if (!part) throw new Error("Part not found");
    if (args.slotNumber < 1 || args.slotNumber > part.questionCount) {
      throw new Error(
        `slotNumber out of range (1..${part.questionCount})`,
      );
    }

    const existingAtSlot = await ctx.db
      .query("paperStructureSlotTags")
      .withIndex("by_part_slot", (q) =>
        q.eq("partId", args.partId).eq("slotNumber", args.slotNumber),
      )
      .collect();

    if (args.mode === "permanent") {
      // Replace any existing permanent row at this slot.
      for (const r of existingAtSlot) {
        if (r.mode === "permanent") await ctx.db.delete(r._id);
      }
    } else {
      // Dedupe options on (partId, slotNumber, tagId).
      const dup = existingAtSlot.find(
        (r) => r.mode === "option" && r.tagId === args.tagId,
      );
      if (dup) return dup._id;
    }

    return await ctx.db.insert("paperStructureSlotTags", {
      partId: args.partId,
      slotNumber: args.slotNumber,
      tagId: args.tagId,
      mode: args.mode,
      createdAt: Date.now(),
    });
  },
});

export const removeSlotTag = mutation({
  args: {
    partId: v.id("paperStructureParts"),
    slotNumber: v.number(),
    tagId: v.id("examTopicTags"),
    mode: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const rows = await ctx.db
      .query("paperStructureSlotTags")
      .withIndex("by_part_slot", (q) =>
        q.eq("partId", args.partId).eq("slotNumber", args.slotNumber),
      )
      .collect();
    for (const r of rows) {
      if (r.tagId === args.tagId && r.mode === args.mode) {
        await ctx.db.delete(r._id);
      }
    }
  },
});

export const clearSlotPermanent = mutation({
  args: {
    partId: v.id("paperStructureParts"),
    slotNumber: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const rows = await ctx.db
      .query("paperStructureSlotTags")
      .withIndex("by_part_slot", (q) =>
        q.eq("partId", args.partId).eq("slotNumber", args.slotNumber),
      )
      .collect();
    for (const r of rows) {
      if (r.mode === "permanent") await ctx.db.delete(r._id);
    }
  },
});

// ─── Per-paper override ───────────────────────────────────────────────

export const setPaperOverrides = mutation({
  args: {
    paperId: v.id("pastPapers"),
    partOverrides: v.optional(
      v.array(
        v.object({
          partCode: v.string(),
          questionCount: v.optional(v.number()),
          marksPerQuestion: v.optional(v.number()),
          requiredCount: v.optional(v.number()),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    await ctx.db.patch(args.paperId, { partOverrides: args.partOverrides });
  },
});
