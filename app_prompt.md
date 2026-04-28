# Complete App Specification: Math Tuition Progress Tracker & Leaderboard

## Business Context

A math tutor in Sri Lanka runs personal classes for secondary students (Grade 6 to Grade 11) following the Sri Lankan government syllabus (Tamil medium textbooks). The tutor teaches 6 days a week (Monday–Saturday, Sunday off), with each day dedicated to one of 6 math modules. Students attend class daily and each group has 8–10 students. The tutor wants to scale from 20 students to many more groups over time.

Each student progresses at their own pace through the curriculum — a Grade 8 student might be working on Grade 6 algebra to fill gaps, while another Grade 8 student might be on Grade 9 geometry. The teacher controls what each student works on and decides when to advance them. Students within the same group may be working on completely different grades and exercises at the same time.

The tutor and assistant teachers enter data on a phone during or after class. There is no TV/projector yet — leaderboard images are downloaded and shared to WhatsApp groups (one per grade) where students and parents can see them daily.

---

## Module & Schedule Structure

There are 6 modules, each assigned to a specific day of the week:

| Day       | Module | Name (English)              | Name (Tamil)                          |
|-----------|--------|-----------------------------|---------------------------------------|
| Monday    | M1     | Numbers & Arithmetic        | எண்கள் / எண்கணிதம்                    |
| Tuesday   | M2     | Algebra, Graphs & Matrices  | அட்சரகணிதம், வரைபுகள், தாயங்கள்       |
| Wednesday | M3     | Geometry & Constructions    | கேத்திரகணிதமும் அமைப்புகளும்           |
| Thursday  | M4     | Measurements                | அளவீடுகள்                              |
| Friday    | M5     | Statistics                  | புள்ளியியல்                            |
| Saturday  | M6     | Sets & Probability          | தொடைகள் & நிகழ்தகவு                    |
| Sunday    | —      | No class                    | —                                     |

Each module contains units organized by Grade (6 through 11) and by Term (1st, 2nd, 3rd Term) within each grade. Students progress through the module in order from Grade 6 upward, but the teacher can skip units for specific students if needed.

---

## Curriculum Data

The full curriculum is provided as a JSON structure. on this file( but don't read this right now because those are already embedded as JSON  in the app as the base curriculum structure) - C:\Users\Ilham\aaa projects\math-tracker\curriculum context.md, you can see complete data for all 6 modules.The teacher will then add exercises (with question counts) under each unit through the Curriculum Management page.



## Scoring System

### Points Per Question (Progressive Scoring with Daily Reset)

Each correct answer earns points based on its position in the sequence of correct answers for that day. The formula is: **Question N earns N × 5 points.**

- 1st correct answer = 5 points
- 2nd correct answer = 10 points
- 3rd correct answer = 15 points
- 4th correct answer = 20 points
- ...and so on (Nth correct answer = N × 5 points)

**The sequence resets to 1 at the start of each new class day.** This means every day is a fresh race — no student is permanently behind, and it rewards daily consistency. The progressive scoring means the more correct answers a student gets in a single day, the more valuable each subsequent correct answer becomes. This powerfully motivates students to:
1. Do as many questions as possible each day
2. Get them RIGHT (only correct answers count)
3. Do homework at home (more questions before next reset = exponentially higher score)

**Only correct answers earn points. Wrong answers earn 0 points.** This prevents students from rushing carelessly through questions just for points.

**Day-level total formula:** If a student gets C correct answers in a day, their daily total = 5 × (1 + 2 + 3 + ... + C) = 5 × C × (C+1) / 2.

Examples:
- 5 correct answers in a day = 5 × 5 × 6 / 2 = 75 points
- 10 correct answers = 5 × 10 × 11 / 2 = 275 points
- 15 correct answers = 5 × 15 × 16 / 2 = 600 points
- 20 correct answers = 5 × 20 × 21 / 2 = 1,050 points

The growth is strong enough to motivate ("do 5 more questions and you jump from 275 to 600!") but not so extreme that it feels hopeless for slower students.

---

## Student Data Model

Each student record contains:
- **Name** (text)
- **School Grade** (Grade 6–11 — this is their actual school grade, never changes mid-year)
- **Group** (flexible label — teacher can reassign students between groups anytime)
- **Parent Phone** (text)
- **School Name** (text)
- **Current position per module** (which grade/unit/exercise they are currently on in each of the 6 modules — each module has its own independent progress path)

---

## Group System

- Groups are flexible labels for organizing students (e.g., "Morning Group", "Evening Group", "Advanced Group")
- A group typically has 8–10 students but the app should not enforce a hard limit
- The teacher can move students between groups at any time
- Groups are used ONLY for scheduling/organizing — they do NOT affect the leaderboard
- **The leaderboard ranks students by their school grade** — all Grade 8 students across ALL groups compete together on the same leaderboard, and second leaderboard is for the student who connect with specif center it's like francise so, student can see not only his center leaderboard but also all over the world leaderboard 
---

## App Pages & Features

### 1. Scoring Page



### 2. Student Management Page

- Add new student (Name, School Grade, Group, Parent Phone, School Name)
- Edit student details
- Delete student
- Reassign student to different group
- View all students, filterable by grade and group
- Each student card shows their current position in each of the 6 modules (e.g., "M1: Grade 7, Unit 10" / "M2: Grade 6, Unit 18")

### 3. Curriculum Management Page

This is where the teacher builds out the exercise details for each unit. The base structure (modules → grades → terms → units) comes pre-loaded from the JSON data above. The teacher manually adds exercises under each unit.

- Navigate: Module → Grade → Term → Unit
- Under each unit, teacher can add exercises (e.g., "Ex 3.1") with a question count (e.g., "12 questions")
- Exercises can be edited (rename, change question count) or deleted
- Exercises have an order within a unit (this determines the progression sequence)
- The full curriculum tree is browsable, showing which units have exercises added and which are still empty
- Unit names are displayed in Tamil. All other text (module names, grade labels, term labels, navigation, buttons) is in English.

below score entry page commented because so many things changed now. 

<!-- ### 4. Score Entry Page (Phone-Optimized — This is the Most Critical Page)

This is the page the teacher uses most frequently, on a phone, during or after class. It must be fast and ergonomic for mobile use.

**Flow:**

**Step 1: Select student**
- Show list of students in today's active group (or allow switching groups)
- Show each student's current module position alongside their name
- Students who already have entries for today should be visually distinguished (e.g., checkmark, different color)

**Step 2: Quick-select or browse exercise**
- **Quick-select (default):** Show the student's current/next exercise in today's module. Since the app knows each student's last completed exercise, it can suggest the next one. One tap to confirm.
- **Browse (if needed):** Full curriculum browser — Module → Grade → Term → Unit → Exercise. The teacher uses this when they want to skip ahead or go back.

**Step 3: Mark questions correct/wrong**
- Display the exercise name and total question count (e.g., "Ex 3.1 — 12 questions")
- Show a grid/row of question number buttons (1, 2, 3, ... 12)
- Teacher taps each question to toggle: ✓ (correct, green) or ✗ (wrong, red)
- Default state: unmarked (gray) — teacher marks only what the student attempted
- Show running count: "8 attempted, 6 correct"
- Show running daily points in real-time as questions are marked correct

**Step 4: Save**
- Save button at the bottom
- After saving, show: "6 correct answers → [points earned today so far]"
- Automatically advance the student's current position if they completed the exercise
- Return to student list for the next student, or option to add another exercise entry for the same student (they might do multiple exercises in one class)

**Important behaviors:**
- A student can have multiple exercise entries in a single day (they might finish Ex 3.1 and start Ex 3.2)
- The daily point counter is cumulative across ALL exercises done that day — the Nth correct answer across all exercises earns N × 5 points
- The teacher can edit a previously entered score (in case of mistakes) — this should recalculate points -->

### 5. Student Progress View

A page showing one student's full progress across all 6 modules, from Grade 6 to Grade 11.

- Select a student from a dropdown or search
- Show all 6 modules as sections/tabs
- Within each module, show the progression: Grade → Term → Unit → Exercises
- Each exercise shows status: Not started / In progress (some questions done) / Completed (all questions done) / Revised (teacher marks as revised)
- Show statistics: total exercises completed, total questions correct, accuracy percentage, current position in each module
- Visual progress bar per module showing how far through the Grade 6–11 curriculum the student is

### 6. Leaderboard Page

Displays rankings of students. The primary grouping is by **school grade** (not by group).

**Views:**

**Daily Leaderboard (default):**
- Select date (defaults to today)
- Select school grade (Grade 6–11) or "All Grades"
- Table showing: Rank, Student Name, Correct Answers Today, Daily Score (points), Group
- Sorted by daily score descending
- Visual flourishes for top 3 (gold/silver/bronze badges or colors)

**Weekly Leaderboard:**
- Shows cumulative daily scores for the current week (Monday–Saturday)
- Same columns + a daily breakdown (Mon, Tue, Wed, Thu, Fri, Sat, Total)

**Monthly Leaderboard:**
- Shows cumulative daily scores for the current month
- Same structure as weekly but for the full month

**Shareable Image Generation:**
- A "Download as Image" button on each leaderboard view
- Generates a clean, well-designed image (PNG) suitable for WhatsApp sharing
- The image should include: date/period, school grade, student names, scores, rankings, and the tuition brand/name at the top
- Design should be visually appealing and professional — this is a marketing tool as well as a motivational tool
- One image per grade (not all grades combined)

### 7. Settings / Configuration Page

- Edit group names (create, rename, delete groups)
- App title / tuition name (appears on leaderboard images)
- Export all data as JSON (backup)
- Import data from JSON (restore)

---

## Technical Requirements

This is a prototype/MVP to validate the idea. Build it as a **single-page web application** using:

- **nextjs, typscript, shadcn with tailwindcss** 
- **JSON stored in localStorage** for data persistence — no backend, no database, no authentication
- **Mobile-first responsive design** — the primary device is a phone. Desktop should also work but phone is priority.
- The app should work offline once loaded (all data is local)
- All curriculum data from the JSON above should be pre-loaded into the app

### Data Structure in localStorage

Store these as separate JSON keys:
- `students` — array of student objects
- `groups` — array of group objects
- `curriculum` — the full module/grade/term/unit/exercise tree
- `entries` — array of score entry objects (student ID, date, exercise ID, question results, points earned)
- `settings` — app configuration (tuition name, etc.)

### Key Technical Behaviors

1. **Daily score calculation is cumulative across all exercises in a day.** When saving a new entry, count ALL correct answers the student has gotten today (across all exercises) and recalculate the day's total points using the formula: sum of (N × 5) for each Nth correct answer.

2. **Student progress position** is tracked per module. After completing all exercises in a unit, the student automatically moves to the next unit. The "current position" always shows the next uncompleted exercise.

3. **Leaderboard image generation** should use HTML Canvas to render a professional-looking scoreboard image that can be downloaded as PNG.

4. **Data integrity:** The app should handle edge cases like editing a previously saved entry and recalculating all affected scores.

---

## UI/UX Guidelines

- **English interface** with **Tamil unit names** only
- Clean, modern design — think of apps like Notion, Linear, or Todoist for inspiration
- Large touch targets on mobile (minimum 44px)
- Color coding for the 6 modules should be consistent throughout the app:
  - M1 (Numbers): Dark Blue (#1B4F72)
  - M2 (Algebra): Purple (#6C3483)
  - M3 (Geometry): Green (#1E8449)
  - M4 (Measurements): Amber (#B9770E)
  - M5 (Statistics): Red (#C0392B)
  - M6 (Sets & Probability): Light Blue (#2E86C1)
- The score entry page should be optimizable for speed — minimize taps, show running totals, use swipe or quick-tap patterns
- Leaderboard images should be eye-catching — use gradients, badges for top ranks, and clear typography
- Show the progressive scoring visually during entry — as the teacher marks more correct answers, show the escalating point values (e.g., "+5", "+10", "+15"...) to reinforce the reward system

---

## Summary of Key Design Decisions

1. **Leaderboard is per school grade**, not per group — all Grade 8 students across all groups compete together and also second leader board is for the center
2. **No difficulty adjustment** — a Grade 8 student doing Grade 6 exercises earns the same points as one doing Grade 9 exercises. The teacher controls pacing, so this is fair.
3. **Score resets daily** — fresh race every class day, promoting consistency
4. **Scoring formula: Nth correct answer = N × 5 points** — progressive but not exponentially extreme
5. **Only correct answers earn points** — prevents careless rushing
6. **Groups are flexible organizational labels** — students can be moved freely, groups don't affect scoring or leaderboard
7. **Each student has independent progress paths** through all 6 modules — a student might be on Grade 7 in algebra but Grade 6 in geometry
8. **Exercises are manually added** to the curriculum by the teacher — the app comes with the unit structure pre-loaded, exercises are added over time as classes happen(almost added for grade 10 and 11)
