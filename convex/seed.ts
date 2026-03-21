import { mutation } from "./_generated/server";

// Seed Grade 11 Term 1 — run via `npx convex run seed:seedGrade11Term1`
// Replaces existing data for these units
export const seedGrade11Term1 = mutation({
  handler: async (ctx) => {
    const items: Array<{
      unitId: string;
      name: string;
      questionCount: number;
      order: number;
      type: string;
      pageNumber: number;
    }> = [];

    // ─── M1: Numbers & Arithmetic ─── Grade 11, Term 1

    // Unit 1: மெய்யெண்கள் (Real Numbers)
    items.push({ unitId: "M1-G11-T1-0", name: "இயல்எண்களும் முழுஎண்களும்", questionCount: 0, order: 0, type: "concept", pageNumber: 1 });
    items.push({ unitId: "M1-G11-T1-0", name: "1.1", questionCount: 15, order: 1, type: "exercise", pageNumber: 4 });
    items.push({ unitId: "M1-G11-T1-0", name: "விகிதமுறு எண்கள்", questionCount: 0, order: 2, type: "concept", pageNumber: 7 });
    items.push({ unitId: "M1-G11-T1-0", name: "1.2", questionCount: 12, order: 3, type: "exercise", pageNumber: 9 });
    items.push({ unitId: "M1-G11-T1-0", name: "விகிதமுறா எண்கள்", questionCount: 0, order: 4, type: "concept", pageNumber: 12 });
    items.push({ unitId: "M1-G11-T1-0", name: "1.3", questionCount: 10, order: 5, type: "exercise", pageNumber: 14 });
    items.push({ unitId: "M1-G11-T1-0", name: "மெய்யெண் நேர்க்கோடு", questionCount: 0, order: 6, type: "concept", pageNumber: 17 });
    items.push({ unitId: "M1-G11-T1-0", name: "1.4", questionCount: 8, order: 7, type: "exercise", pageNumber: 19 });
    items.push({ unitId: "M1-G11-T1-0", name: "1.5", questionCount: 20, order: 8, type: "exercise", pageNumber: 22 });

    // Unit 2: சுட்டிகளும் மடக்கைகளும் I (Indices & Logarithms I)
    items.push({ unitId: "M1-G11-T1-1", name: "சுட்டி விதிகள்", questionCount: 0, order: 0, type: "concept", pageNumber: 26 });
    items.push({ unitId: "M1-G11-T1-1", name: "2.1", questionCount: 15, order: 1, type: "exercise", pageNumber: 29 });
    items.push({ unitId: "M1-G11-T1-1", name: "எதிர்மறை சுட்டிகள்", questionCount: 0, order: 2, type: "concept", pageNumber: 32 });
    items.push({ unitId: "M1-G11-T1-1", name: "2.2", questionCount: 10, order: 3, type: "exercise", pageNumber: 34 });
    items.push({ unitId: "M1-G11-T1-1", name: "பின்னச் சுட்டிகள்", questionCount: 0, order: 4, type: "concept", pageNumber: 37 });
    items.push({ unitId: "M1-G11-T1-1", name: "2.3", questionCount: 12, order: 5, type: "exercise", pageNumber: 39 });
    items.push({ unitId: "M1-G11-T1-1", name: "மடக்கை அறிமுகம்", questionCount: 0, order: 6, type: "concept", pageNumber: 42 });
    items.push({ unitId: "M1-G11-T1-1", name: "2.4", questionCount: 10, order: 7, type: "exercise", pageNumber: 45 });
    items.push({ unitId: "M1-G11-T1-1", name: "மடக்கை விதிகள்", questionCount: 0, order: 8, type: "concept", pageNumber: 48 });
    items.push({ unitId: "M1-G11-T1-1", name: "2.5", questionCount: 15, order: 9, type: "exercise", pageNumber: 50 });
    items.push({ unitId: "M1-G11-T1-1", name: "2.6", questionCount: 8, order: 10, type: "exercise", pageNumber: 54 });

    // Unit 3: சுட்டிகளும் மடக்கைகளும் II (Indices & Logarithms II)
    items.push({ unitId: "M1-G11-T1-2", name: "மடக்கை சமன்பாடுகள்", questionCount: 0, order: 0, type: "concept", pageNumber: 57 });
    items.push({ unitId: "M1-G11-T1-2", name: "3.1", questionCount: 12, order: 1, type: "exercise", pageNumber: 59 });
    items.push({ unitId: "M1-G11-T1-2", name: "அடிமாற்ற விதி", questionCount: 0, order: 2, type: "concept", pageNumber: 62 });
    items.push({ unitId: "M1-G11-T1-2", name: "3.2", questionCount: 10, order: 3, type: "exercise", pageNumber: 64 });
    items.push({ unitId: "M1-G11-T1-2", name: "சுட்டி சமன்பாடுகள்", questionCount: 0, order: 4, type: "concept", pageNumber: 67 });
    items.push({ unitId: "M1-G11-T1-2", name: "3.3", questionCount: 15, order: 5, type: "exercise", pageNumber: 69 });
    items.push({ unitId: "M1-G11-T1-2", name: "3.4", questionCount: 8, order: 6, type: "exercise", pageNumber: 73 });
    items.push({ unitId: "M1-G11-T1-2", name: "3.5", questionCount: 20, order: 7, type: "exercise", pageNumber: 76 });

    // ─── M2: Algebra, Graphs & Matrices ─── Grade 11, Term 1

    // Unit 6: ஈருறுப்புக் கோவைகள் (Binomial Expressions)
    items.push({ unitId: "M2-G11-T1-0", name: "ஈருறுப்பு விரிவாக்கம்", questionCount: 0, order: 0, type: "concept", pageNumber: 80 });
    items.push({ unitId: "M2-G11-T1-0", name: "6.1", questionCount: 12, order: 1, type: "exercise", pageNumber: 83 });
    items.push({ unitId: "M2-G11-T1-0", name: "பாஸ்கல் முக்கோணம்", questionCount: 0, order: 2, type: "concept", pageNumber: 86 });
    items.push({ unitId: "M2-G11-T1-0", name: "6.2", questionCount: 10, order: 3, type: "exercise", pageNumber: 88 });
    items.push({ unitId: "M2-G11-T1-0", name: "ஈருறுப்புத் தேற்றம்", questionCount: 0, order: 4, type: "concept", pageNumber: 91 });
    items.push({ unitId: "M2-G11-T1-0", name: "6.3", questionCount: 15, order: 5, type: "exercise", pageNumber: 94 });
    items.push({ unitId: "M2-G11-T1-0", name: "பொதுப்படுத்தப்பட்ட உறுப்பு", questionCount: 0, order: 6, type: "concept", pageNumber: 98 });
    items.push({ unitId: "M2-G11-T1-0", name: "6.4", questionCount: 10, order: 7, type: "exercise", pageNumber: 100 });
    items.push({ unitId: "M2-G11-T1-0", name: "6.5", questionCount: 8, order: 8, type: "exercise", pageNumber: 103 });
    items.push({ unitId: "M2-G11-T1-0", name: "6.6", questionCount: 20, order: 9, type: "exercise", pageNumber: 106 });

    // Unit 7: அட்சரகணிதப் பின்னங்கள் (Algebraic Fractions)
    items.push({ unitId: "M2-G11-T1-1", name: "அட்சரகணிதப் பின்னங்கள் அறிமுகம்", questionCount: 0, order: 0, type: "concept", pageNumber: 110 });
    items.push({ unitId: "M2-G11-T1-1", name: "7.1", questionCount: 12, order: 1, type: "exercise", pageNumber: 113 });
    items.push({ unitId: "M2-G11-T1-1", name: "பின்னங்களைச் சுருக்குதல்", questionCount: 0, order: 2, type: "concept", pageNumber: 116 });
    items.push({ unitId: "M2-G11-T1-1", name: "7.2", questionCount: 10, order: 3, type: "exercise", pageNumber: 118 });
    items.push({ unitId: "M2-G11-T1-1", name: "பகுதிப் பின்னங்கள்", questionCount: 0, order: 4, type: "concept", pageNumber: 121 });
    items.push({ unitId: "M2-G11-T1-1", name: "7.3", questionCount: 15, order: 5, type: "exercise", pageNumber: 124 });
    items.push({ unitId: "M2-G11-T1-1", name: "மீண்டும் பகுதிப் பின்னங்கள்", questionCount: 0, order: 6, type: "concept", pageNumber: 128 });
    items.push({ unitId: "M2-G11-T1-1", name: "7.4", questionCount: 10, order: 7, type: "exercise", pageNumber: 130 });
    items.push({ unitId: "M2-G11-T1-1", name: "7.5", questionCount: 8, order: 8, type: "exercise", pageNumber: 133 });
    items.push({ unitId: "M2-G11-T1-1", name: "7.6", questionCount: 20, order: 9, type: "exercise", pageNumber: 136 });

    // ─── M4: Measurements ─── Grade 11, Term 1

    // Unit 4: திண்மங்களின் மேற்பரப்பின் பரப்பளவு (Surface Area of Solids)
    items.push({ unitId: "M4-G11-T1-0", name: "உருளை மேற்பரப்பு", questionCount: 0, order: 0, type: "concept", pageNumber: 140 });
    items.push({ unitId: "M4-G11-T1-0", name: "4.1", questionCount: 10, order: 1, type: "exercise", pageNumber: 143 });
    items.push({ unitId: "M4-G11-T1-0", name: "கூம்பு மேற்பரப்பு", questionCount: 0, order: 2, type: "concept", pageNumber: 146 });
    items.push({ unitId: "M4-G11-T1-0", name: "4.2", questionCount: 12, order: 3, type: "exercise", pageNumber: 148 });
    items.push({ unitId: "M4-G11-T1-0", name: "கோளம் மேற்பரப்பு", questionCount: 0, order: 4, type: "concept", pageNumber: 151 });
    items.push({ unitId: "M4-G11-T1-0", name: "4.3", questionCount: 10, order: 5, type: "exercise", pageNumber: 153 });
    items.push({ unitId: "M4-G11-T1-0", name: "கூட்டுத் திண்மங்கள்", questionCount: 0, order: 6, type: "concept", pageNumber: 156 });
    items.push({ unitId: "M4-G11-T1-0", name: "4.4", questionCount: 15, order: 7, type: "exercise", pageNumber: 158 });
    items.push({ unitId: "M4-G11-T1-0", name: "4.5", questionCount: 8, order: 8, type: "exercise", pageNumber: 162 });
    items.push({ unitId: "M4-G11-T1-0", name: "4.6", questionCount: 20, order: 9, type: "exercise", pageNumber: 165 });

    // Unit 5: திண்மங்களின் கனவளவு (Volume of Solids)
    items.push({ unitId: "M4-G11-T1-1", name: "உருளை கனவளவு", questionCount: 0, order: 0, type: "concept", pageNumber: 170 });
    items.push({ unitId: "M4-G11-T1-1", name: "5.1", questionCount: 12, order: 1, type: "exercise", pageNumber: 173 });
    items.push({ unitId: "M4-G11-T1-1", name: "கூம்பு கனவளவு", questionCount: 0, order: 2, type: "concept", pageNumber: 176 });
    items.push({ unitId: "M4-G11-T1-1", name: "5.2", questionCount: 10, order: 3, type: "exercise", pageNumber: 178 });
    items.push({ unitId: "M4-G11-T1-1", name: "கோளம் கனவளவு", questionCount: 0, order: 4, type: "concept", pageNumber: 181 });
    items.push({ unitId: "M4-G11-T1-1", name: "5.3", questionCount: 15, order: 5, type: "exercise", pageNumber: 183 });
    items.push({ unitId: "M4-G11-T1-1", name: "கூட்டுத் திண்மங்கள் கனவளவு", questionCount: 0, order: 6, type: "concept", pageNumber: 187 });
    items.push({ unitId: "M4-G11-T1-1", name: "5.4", questionCount: 10, order: 7, type: "exercise", pageNumber: 189 });
    items.push({ unitId: "M4-G11-T1-1", name: "5.5", questionCount: 8, order: 8, type: "exercise", pageNumber: 192 });
    items.push({ unitId: "M4-G11-T1-1", name: "5.6", questionCount: 20, order: 9, type: "exercise", pageNumber: 195 });

    // Unit 8: சமாந்தரக் கோடுகளுக்கிடையில் உள்ள தளவுருவங்களின் பரப்பளவு (Area between parallel lines)
    items.push({ unitId: "M4-G11-T1-2", name: "சமாந்தர கோடுகள் அறிமுகம்", questionCount: 0, order: 0, type: "concept", pageNumber: 200 });
    items.push({ unitId: "M4-G11-T1-2", name: "8.1", questionCount: 10, order: 1, type: "exercise", pageNumber: 203 });
    items.push({ unitId: "M4-G11-T1-2", name: "சரிவகம் பரப்பளவு", questionCount: 0, order: 2, type: "concept", pageNumber: 206 });
    items.push({ unitId: "M4-G11-T1-2", name: "8.2", questionCount: 12, order: 3, type: "exercise", pageNumber: 208 });
    items.push({ unitId: "M4-G11-T1-2", name: "இணைகரம் பரப்பளவு", questionCount: 0, order: 4, type: "concept", pageNumber: 211 });
    items.push({ unitId: "M4-G11-T1-2", name: "8.3", questionCount: 15, order: 5, type: "exercise", pageNumber: 213 });
    items.push({ unitId: "M4-G11-T1-2", name: "முக்கோணம் பரப்பளவு", questionCount: 0, order: 6, type: "concept", pageNumber: 217 });
    items.push({ unitId: "M4-G11-T1-2", name: "8.4", questionCount: 10, order: 7, type: "exercise", pageNumber: 219 });
    items.push({ unitId: "M4-G11-T1-2", name: "8.5", questionCount: 8, order: 8, type: "exercise", pageNumber: 222 });
    items.push({ unitId: "M4-G11-T1-2", name: "8.6", questionCount: 20, order: 9, type: "exercise", pageNumber: 225 });

    // Delete existing data for these units first
    const unitIds = Array.from(new Set(items.map(i => i.unitId)));
    let deleted = 0;
    for (const uid of unitIds) {
      const existing = await ctx.db
        .query("exercises")
        .withIndex("by_unit", (q) => q.eq("unitId", uid))
        .collect();
      for (const doc of existing) {
        await ctx.db.delete(doc._id);
        deleted++;
      }
    }

    // Insert new data
    for (const item of items) {
      await ctx.db.insert("exercises", item);
    }

    return `Deleted ${deleted} old items, seeded ${items.length} new items across ${unitIds.length} units`;
  },
});

// Seed M5 Grade 11 Term 2 — run via `npx convex run seed:seedM5Grade11Term2`
export const seedM5Grade11Term2 = mutation({
  handler: async (ctx) => {
    const items: Array<{
      unitId: string;
      name: string;
      questionCount: number;
      order: number;
      type: string;
      pageNumber: number;
    }> = [];

    // ─── M5: Statistics ─── Grade 11, Term 2

    // Unit 15: தரவுகளை வகைப்படுத்தலும் விளக்கம் கூறலும் (Classifying & Interpreting Data)
    items.push({ unitId: "M5-G11-T2-0", name: "தரவு வகைகள்", questionCount: 0, order: 0, type: "concept", pageNumber: 1 });
    items.push({ unitId: "M5-G11-T2-0", name: "15.1", questionCount: 10, order: 1, type: "exercise", pageNumber: 3 });
    items.push({ unitId: "M5-G11-T2-0", name: "நிகழ்வெண் பரவல் அட்டவணை", questionCount: 0, order: 2, type: "concept", pageNumber: 6 });
    items.push({ unitId: "M5-G11-T2-0", name: "15.2", questionCount: 12, order: 3, type: "exercise", pageNumber: 8 });
    items.push({ unitId: "M5-G11-T2-0", name: "திரள் நிகழ்வெண் வளைகோடு", questionCount: 0, order: 4, type: "concept", pageNumber: 11 });
    items.push({ unitId: "M5-G11-T2-0", name: "15.3", questionCount: 10, order: 5, type: "exercise", pageNumber: 13 });
    items.push({ unitId: "M5-G11-T2-0", name: "சராசரி", questionCount: 0, order: 6, type: "concept", pageNumber: 16 });
    items.push({ unitId: "M5-G11-T2-0", name: "15.4", questionCount: 15, order: 7, type: "exercise", pageNumber: 18 });
    items.push({ unitId: "M5-G11-T2-0", name: "இடைநிலை", questionCount: 0, order: 8, type: "concept", pageNumber: 22 });
    items.push({ unitId: "M5-G11-T2-0", name: "15.5", questionCount: 12, order: 9, type: "exercise", pageNumber: 24 });
    items.push({ unitId: "M5-G11-T2-0", name: "முகடு", questionCount: 0, order: 10, type: "concept", pageNumber: 27 });
    items.push({ unitId: "M5-G11-T2-0", name: "15.6", questionCount: 10, order: 11, type: "exercise", pageNumber: 29 });
    items.push({ unitId: "M5-G11-T2-0", name: "நிலையான விலக்கம்", questionCount: 0, order: 12, type: "concept", pageNumber: 32 });
    items.push({ unitId: "M5-G11-T2-0", name: "15.7", questionCount: 15, order: 13, type: "exercise", pageNumber: 34 });
    items.push({ unitId: "M5-G11-T2-0", name: "15.8", questionCount: 8, order: 14, type: "exercise", pageNumber: 38 });
    items.push({ unitId: "M5-G11-T2-0", name: "15.9", questionCount: 20, order: 15, type: "exercise", pageNumber: 41 });

    // Delete existing data for these units first
    const unitIds = Array.from(new Set(items.map(i => i.unitId)));
    let deleted = 0;
    for (const uid of unitIds) {
      const existing = await ctx.db
        .query("exercises")
        .withIndex("by_unit", (q) => q.eq("unitId", uid))
        .collect();
      for (const doc of existing) {
        await ctx.db.delete(doc._id);
        deleted++;
      }
    }

    // Insert new data
    for (const item of items) {
      await ctx.db.insert("exercises", item);
    }

    return `Deleted ${deleted} old items, seeded ${items.length} new items across ${unitIds.length} units`;
  },
});
