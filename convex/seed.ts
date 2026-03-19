import { mutation } from "./_generated/server";

// Temporary seed function — no auth needed, run via `npx convex run seed:seedGrade11Term1`
export const seedGrade11Term1 = mutation({
  handler: async (ctx) => {
    const items: Array<{
      unitId: string;
      name: string;
      questionCount: number;
      order: number;
      type: string;
      pageNumber?: number;
    }> = [];

    // ─── M1: Numbers & Arithmetic ─── Grade 11, Term 1

    // Unit: 1. மெய்யெண்கள் (Real Numbers)
    items.push({ unitId: "M1-G11-T1-0", name: "Real Numbers - Theory", questionCount: 0, order: 0, type: "concept", pageNumber: 1 });
    items.push({ unitId: "M1-G11-T1-0", name: "1.1", questionCount: 10, order: 1, type: "exercise", pageNumber: 3 });
    items.push({ unitId: "M1-G11-T1-0", name: "1.2", questionCount: 8, order: 2, type: "exercise", pageNumber: 5 });
    items.push({ unitId: "M1-G11-T1-0", name: "1.3", questionCount: 12, order: 3, type: "exercise", pageNumber: 8 });
    items.push({ unitId: "M1-G11-T1-0", name: "1.4", questionCount: 10, order: 4, type: "exercise", pageNumber: 11 });

    // Unit: 2. சுட்டிகளும் மடக்கைகளும் I (Indices & Logarithms I)
    items.push({ unitId: "M1-G11-T1-1", name: "Indices - Theory", questionCount: 0, order: 0, type: "concept", pageNumber: 14 });
    items.push({ unitId: "M1-G11-T1-1", name: "2.1", questionCount: 10, order: 1, type: "exercise", pageNumber: 16 });
    items.push({ unitId: "M1-G11-T1-1", name: "2.2", questionCount: 8, order: 2, type: "exercise", pageNumber: 19 });
    items.push({ unitId: "M1-G11-T1-1", name: "Logarithms - Theory", questionCount: 0, order: 3, type: "concept", pageNumber: 22 });
    items.push({ unitId: "M1-G11-T1-1", name: "2.3", questionCount: 12, order: 4, type: "exercise", pageNumber: 24 });
    items.push({ unitId: "M1-G11-T1-1", name: "2.4", questionCount: 10, order: 5, type: "exercise", pageNumber: 27 });

    // Unit: 3. சுட்டிகளும் மடக்கைகளும் II (Indices & Logarithms II)
    items.push({ unitId: "M1-G11-T1-2", name: "Advanced Logarithms - Theory", questionCount: 0, order: 0, type: "concept", pageNumber: 30 });
    items.push({ unitId: "M1-G11-T1-2", name: "3.1", questionCount: 8, order: 1, type: "exercise", pageNumber: 32 });
    items.push({ unitId: "M1-G11-T1-2", name: "3.2", questionCount: 10, order: 2, type: "exercise", pageNumber: 35 });
    items.push({ unitId: "M1-G11-T1-2", name: "3.3", questionCount: 12, order: 3, type: "exercise", pageNumber: 38 });

    // ─── M2: Algebra, Graphs & Matrices ─── Grade 11, Term 1

    // Unit: 6. ஈருறுப்புக் கோவைகள் (Binomial Expressions)
    items.push({ unitId: "M2-G11-T1-0", name: "Binomial Theorem - Theory", questionCount: 0, order: 0, type: "concept", pageNumber: 42 });
    items.push({ unitId: "M2-G11-T1-0", name: "6.1", questionCount: 10, order: 1, type: "exercise", pageNumber: 44 });
    items.push({ unitId: "M2-G11-T1-0", name: "6.2", questionCount: 8, order: 2, type: "exercise", pageNumber: 47 });
    items.push({ unitId: "M2-G11-T1-0", name: "6.3", questionCount: 12, order: 3, type: "exercise", pageNumber: 50 });
    items.push({ unitId: "M2-G11-T1-0", name: "6.4", questionCount: 10, order: 4, type: "exercise", pageNumber: 53 });

    // Unit: 7. அட்சரகணிதப் பின்னங்கள் (Algebraic Fractions)
    items.push({ unitId: "M2-G11-T1-1", name: "Algebraic Fractions - Theory", questionCount: 0, order: 0, type: "concept", pageNumber: 56 });
    items.push({ unitId: "M2-G11-T1-1", name: "7.1", questionCount: 10, order: 1, type: "exercise", pageNumber: 58 });
    items.push({ unitId: "M2-G11-T1-1", name: "Partial Fractions - Theory", questionCount: 0, order: 2, type: "concept", pageNumber: 61 });
    items.push({ unitId: "M2-G11-T1-1", name: "7.2", questionCount: 8, order: 3, type: "exercise", pageNumber: 63 });
    items.push({ unitId: "M2-G11-T1-1", name: "7.3", questionCount: 12, order: 4, type: "exercise", pageNumber: 66 });

    // ─── M4: Measurements ─── Grade 11, Term 1

    // Unit: 4. திண்மங்களின் மேற்பரப்பின் பரப்பளவு (Surface Area of Solids)
    items.push({ unitId: "M4-G11-T1-0", name: "Surface Area - Theory", questionCount: 0, order: 0, type: "concept", pageNumber: 70 });
    items.push({ unitId: "M4-G11-T1-0", name: "4.1", questionCount: 8, order: 1, type: "exercise", pageNumber: 72 });
    items.push({ unitId: "M4-G11-T1-0", name: "4.2", questionCount: 10, order: 2, type: "exercise", pageNumber: 75 });
    items.push({ unitId: "M4-G11-T1-0", name: "Composite Solids - Theory", questionCount: 0, order: 3, type: "concept", pageNumber: 78 });
    items.push({ unitId: "M4-G11-T1-0", name: "4.3", questionCount: 12, order: 4, type: "exercise", pageNumber: 80 });

    // Unit: 5. திண்மங்களின் கனவளவு (Volume of Solids)
    items.push({ unitId: "M4-G11-T1-1", name: "Volume - Theory", questionCount: 0, order: 0, type: "concept", pageNumber: 84 });
    items.push({ unitId: "M4-G11-T1-1", name: "5.1", questionCount: 10, order: 1, type: "exercise", pageNumber: 86 });
    items.push({ unitId: "M4-G11-T1-1", name: "5.2", questionCount: 8, order: 2, type: "exercise", pageNumber: 89 });
    items.push({ unitId: "M4-G11-T1-1", name: "5.3", questionCount: 10, order: 3, type: "exercise", pageNumber: 92 });

    // Unit: 8. சமாந்தரக் கோடுகளுக்கிடையில் உள்ள தளவுருவங்களின் பரப்பளவு (Area between parallel lines)
    items.push({ unitId: "M4-G11-T1-2", name: "Parallel Lines Area - Theory", questionCount: 0, order: 0, type: "concept", pageNumber: 96 });
    items.push({ unitId: "M4-G11-T1-2", name: "8.1", questionCount: 10, order: 1, type: "exercise", pageNumber: 98 });
    items.push({ unitId: "M4-G11-T1-2", name: "8.2", questionCount: 12, order: 2, type: "exercise", pageNumber: 101 });
    items.push({ unitId: "M4-G11-T1-2", name: "8.3", questionCount: 8, order: 3, type: "exercise", pageNumber: 104 });

    // Find which units already have data
    const unitIds = Array.from(new Set(items.map(i => i.unitId)));
    const skipUnits = new Set<string>();
    for (const uid of unitIds) {
      const existing = await ctx.db
        .query("exercises")
        .withIndex("by_unit", (q) => q.eq("unitId", uid))
        .first();
      if (existing) skipUnits.add(uid);
    }

    // Insert only items for empty units
    let inserted = 0;
    for (const item of items) {
      if (skipUnits.has(item.unitId)) continue;
      await ctx.db.insert("exercises", item);
      inserted++;
    }

    return `Seeded ${inserted} new items (skipped ${skipUnits.size} units with existing data)`;
  },
});

