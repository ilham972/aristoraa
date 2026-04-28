 please read the lead page and scoring page and understand the page. lead page is for lead teacher in the class room who want to know all the activity or
   status or
    position of the student. and he is the accountability system for each student individually. the goal is no one sit without doing anything in the class
  room, they need to do the correction from correction teacher (scoring page we already builded) or clearing the doubt from lead teacher(lead page we build
   partially)  or do their own work that assigned. please read these files first - C:\Users\Ilham\aaa projects\math-tracker\new_change.md,
  C:\Users\Ilham\aaa projects\math-tracker\app_prompt.md, C:\Users\Ilham\aaa projects\math-tracker\business_strategy.txt, whatever build so far is
  operational side but, service side it's not bullet proof, is this works or not, because we don't have any order for teach. but we already split into 6
  modules, but still we don't have any order, and it's not give you resalt for student, because we don't have standard sop for service delivery, we have to
   implement space repetition, active recall and interleaving methods in our app, and this is the big going to be the big innovation in our app, so for
  student instead of telling page number and exercise number, we can directly we can give the sheet for that specific student, for that we have to have
  printer in our class room, if the student in home, we can send the pdf to them, so that contain interleaving methods, spaced repetition and active
  recall. this is difficult to build, because there are concept videos they have to watch before do the questions and some time student not finished single
   units and there are so much edge cases we have to nail, but if we implemented these three methods for maths with our spoon feeding and accountability
  system , it's going to revolutionize i think, no one can beat us, what do you think, is this possible, i already seed our text book of government
  syllabus, please understand the app, and tell me, how to build the robust system that every one get good result in maths, from weak student to smart
  students, if you have any questions or doubts please ask me, please think, use your maximum brain power from your experience, and find the solutions and
  help me to brainstorm, how to make this impossible into possible. i need your powerful thinking

  Searched for 3 patterns, read 5 files, recalled 2 memories (ctrl+o to expand)

● I've read the lead page, scoring flow (via new_change.md), the app spec, business strategy, and the curriculum. Now let me think through your real
  question — the pedagogical engine — with full honesty.

  ---
  The honest answer first

  Yes, this is possible. It is also genuinely defensible as a moat. But the hard part is not the code. The code is ~2–3 months of focused work. The hard
  part is the content graph (concept prerequisites + tagged problem bank + answer keys). That work is what competitors will not do — which is exactly why it
   becomes unbeatable if you do do it.

  I also want to challenge one framing before going deeper: you said "operational side is built but service side isn't bulletproof." I'd reframe it — the
  current app is a progress tracker, not a learning system. That's not a failure; it's a stage. What you're describing is the real pedagogical engine on top
   of the tracker.

  ---
  What these three methods actually mean for math (not generic flashcards)

  This matters because applying them naively will hurt weak students.

  Active recall in math isn't "hide the answer and try to remember." Every exercise already does retrieval. The real lever is retrieval under uncertainty —
  problems where the student must first recognize which technique applies. Current textbook exercises kill this: Ex 3.1 is fractions, so the student doesn't
   have to decide it's a fractions problem.

  Spaced repetition in math cannot be flashcards. A skill is not a fact. You can't "see the same problem again in 3 days" — they'd just remember the answer.
   SR for math = fresh instances of a previously-learned problem type, scheduled at expanding intervals, recalibrated by performance. This is why you need a
   tagged problem bank, not just a repeat flag.

  Interleaving is the strongest of the three and the most counterintuitive. Research is unambiguous: students learning by blocked practice feel more
  confident, score higher during training, and score much worse on delayed tests. Students learning by interleaved practice feel worse day-to-day but learn
  what discrimination each technique is for. For math this is decisive — most exam failures aren't "couldn't execute the technique"; they're "didn't
  recognize which technique to use."

  The synergy: interleaving is what makes spaced repetition non-trivial for math. Active recall is what makes interleaving work. Build any one in isolation
  and it's weak.

  ---
  The fundamental shift your app needs

  Today, a student's position is a pointer: "Ex 3.1 in Unit 10." Progress = pointer moves forward. This is the blocked-practice assumption baked into your
  data model.

  The shift you need: a student's state is a mastery distribution over concepts, not a pointer.

  BEFORE: Rahul is on Ex 3.1 of Grade 7 Algebra Unit 10.
  AFTER:  Rahul's mastery — fractions: 0.82, linear equations: 0.41,
          factoring: 0.12, percentages: 0.67, ... 80 concepts total.
          Last practiced fractions 4 days ago (due for review).
          Has prerequisite gap blocking quadratic factoring (needs factoring ≥ 0.7).

  Every consequence follows from this shift: the sheet generator, the lead dashboard view, the parent report, the leaderboard redesign, even the "what does
  the student see at home." Once mastery is the unit of truth, the current studentModulePositions table becomes a derived view, not a source of truth.

  This is a real refactor, but it's the correct one.

  ---
  Concrete architecture — the Sheet Generator

  This is the single new component that delivers all three methods in one artifact.

  New data model:
  - concepts table — id, name, moduleId, description, videoUrl?, prerequisiteIds[]
  - exercises.conceptIds[] and, ideally, per-question concept tags
  - questionBank table — every question tagged with conceptIds[], difficulty (1–5), expectedTimeMin, answerKey
  - masteryByStudentConcept — studentId, conceptId, mastery (0–1), lastAttemptAt, nextReviewAt, interval
  - Mastery updated by a BKT-lite rule (correct → rises; wrong → falls; time-decay between sessions)

  Generator algorithm (for an 8-question sheet):
  1. Pick 3 "due review" concepts (SR) — overdue first, interleave different concepts
  2. Pick 1 "new learning target" — the lowest-difficulty concept whose prerequisites are all ≥ 0.7 mastery
  3. Pick 2 "weakness reinforcement" — concepts in the 0.3–0.6 range
  4. Pick 1 "stretch challenge" — one difficulty notch above student's current ceiling
  5. Pick 1 "confidence builder" — a concept they're at 0.8+ on (placed first to start warm)
  6. Shuffle so consecutive questions differ in concept (this is interleaving)
  7. Render to PDF with their name, date, and today's module badge

  Pure weekday discipline vs. mixed sheets — I recommend: main sheet respects the weekday module (Tuesday = algebra), but a 2-question warm-up strip at the
  top pulls from any module that's overdue. You get weekly cycling and daily SR without breaking "Tuesdays are algebra" in the parent/student mental model.

  ---
  The edge cases you named — how each gets handled

  ┌───────────────────────────────┬─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
  │           Edge case           │                                                      Mechanism                                                      │
  ├───────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ "Concept needs video watched  │ Generator emits a WATCH row for new concepts with videoUrl + mastery=0. Practice problems gated until student taps  │
  │ before questions"             │ "watched." If they lie and fail the first problem, next sheet re-surfaces the video as remediation.                 │
  ├───────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ "Student hasn't finished a    │ Unit completion stops being a gate. A student can have 40% mastery on 10 concepts across 4 units and that's fine —  │
  │ single unit"                  │ the system spirals back. This is actually how real learning works.                                                  │
  ├───────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │                               │ Same algorithm, different knob settings. Weak: 5-question sheet, 50% review, 40% new at low difficulty, 10%         │
  │ Weak vs. strong student       │ challenge. Strong: 12-question sheet, 20% review, 60% new at high difficulty, 20% challenge. One engine, two        │
  │                               │ profiles.                                                                                                           │
  ├───────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Prerequisite gap (e.g. Grade  │ Prerequisite graph prevents the generator from assigning the Grade 10 topic. Instead it emits a "prerequisite gap   │
  │ 10 topic, Grade 8 gap)        │ detected" entry — Lead sees this on dashboard, assigns the Grade 8 remediation explicitly.                          │
  ├───────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Printer jams / offline        │ Generator runs the night before. Morning: Lead has a pre-printed pile, one sheet per expected attendee. Student     │
  │                               │ absent → sheet recycles for tomorrow. Attendance-triggered same-day reprints are rare.                              │
  └───────────────────────────────┴─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

  ---
  Why the current daily-score system needs rethinking (this is where I disagree with the current design)

  Nth correct = N × 5 is a beautiful motivator for volume. But under SR + interleaving, more questions doesn't mean more learning — harder,
  correctly-differentiated questions do. A student who correctly solves 5 interleaved-difficult problems has learned more than one who blasts 15
  blocked-easy ones.

  Two options, pick one consciously:

  Option A — keep it. Accept that points reward effort and attendance, not learning depth. Parents and students love it, don't touch it. Use a separate
  "mastery progress" metric for the learning story.

  Option B — upgrade to difficulty-weighted. Nth correct × difficulty (1–5) × 5. A Q5-difficulty question earns 25× the base. Much more honest but much more
   complex.

  I lean toward A for now. Your gamification engine is already working. Don't destabilize it during the pedagogical pivot. Add a second metric ("mastery
  stars" or similar) that visualizes real learning depth. Parents will come to trust the second metric after seeing results.

  ---
  The moat — why content is what makes this unbeatable

  Everyone can copy your UI. Nobody will copy this easily:

  - ~500 unit-level concepts across 6 modules × 6 grades, each with tagged prerequisites → weeks of curriculum expert time
  - ~5,000 questions tagged with concepts + difficulty + answer keys → months of work
  - Recalibration of difficulty based on real student response distributions → only you will have this data

  If you do the content work for the Sri Lankan Tamil-medium syllabus — which is a fixed, finite target, protected by language — nobody will out-invest you.
   This is a localization-protected niche, not a venture-hot category.

  ---
  Staged MVP — ship value in 6 weeks, full system in 4 months

  Phase A (4–6 weeks) — SR layer on existing exercises, no content work yet:
  - Tag each existing exercises row with 1–3 conceptIds (teacher clicks during normal curriculum work — takes hours, not weeks, since you already have the
  structure)
  - Add masteryByStudentConcept with simple rolling-average math
  - Add a "Today's plan" view on the Lead dashboard that auto-proposes: 1 review exercise + 1 new exercise, per student. No PDFs yet — just better
  assignment suggestions.
  - Validate: do weak students retain more across the weekly cycle? Measure by re-assigning a previously-done concept 2 weeks later and comparing correct
  rate to baseline.

  Phase B (4–6 weeks) — interleaving + sheets:
  - Question bank UI + tagging. Start with Grade 10 + 11 only (exam years = highest value).
  - Sheet generator + PDF export.
  - Printer flow or PDF-to-WhatsApp for home.
  - Challenge: digitizing questions. Propose: existing textbook questions photographed, OCR'd, teacher verifies. Or: Claude-assisted tagging of your
  existing question bank if you have one digital.

  Phase C (4–8 weeks) — scale & polish:
  - Mastery-based parent reports (the marketing artifact)
  - Difficulty calibration from real response data
  - Prerequisite DAG editor for curriculum team
  - Franchise SOP playbook

  ---
  Questions I need you to answer before we plan implementation

  These genuinely change the design. Ranking by how load-bearing they are:

  1. Do you have a digital question bank with answer keys today? If yes, huge accelerator. If no, who's going to digitize textbook questions — you alone?
  With students? With AI-assisted OCR?
  2. Question-level vs. exercise-level concept tagging? Question-level gives real interleaving; exercise-level is weaker but 10× less tagging work. For MVP
  I'd say exercise-level; for Phase B question-level. But this is a big call.
  3. Who builds the prerequisite graph? This is the deepest pedagogical work. Is it you, or can you recruit 1-2 experienced Sri Lankan math teachers?
  4. What's the printer reality in the classroom right now? Is there a printer? What's its speed? What's the fallback when it fails?
  5. Live theory teaching — fully replaced by video? Your new_change.md says "no live theory." I'd push back slightly — for weak students, video is not
  enough. Even 10 minutes of live whiteboard per week per cohort may be irreplaceable. Willing to keep a small live component?
  6. Mastery threshold for "move on" — BKT labs use 0.95. For your students, 0.75 may be enough. Strong prior, tunable later.
  7. Scoring — A or B from above? I lean A. Your call.
  8. Validation plan — how do we know this is working? Daily points already motivate, but learning outcomes are what justify the extra build. Is there an
  upcoming term test where we can A/B compare a sheet-based cohort against a traditional cohort?

  ---
  Bottom line

  Your instinct is right. The factory model made the classroom operationally lean. Now you need a learning engine on top of it, and the three methods you
  named are the right choice — they're also the only methods with strong replicated evidence in math pedagogy.

  What I'd do: start Phase A next. It's low risk, ships in a month, and the measurement it produces (real retention data) will tell us how aggressive to be
  in Phase B. Don't build sheets yet. Build the mastery layer, see the numbers, then commit to the bigger move with evidence.

  Answer the 8 questions above when you have time — especially 1, 3, and 5 — and I'll sketch the Phase A implementation plan against the actual codebase.

✻ Cogitated for 3m 15s

※ recap: Goal: add spaced repetition, active recall, and interleaving to the Aristora math app via a personalized sheet generator. Next action: you answer
  the 8 open questions (especially the question bank, prerequisite graph, and live-theory ones) so I can scope Phase A. (disable recaps in /config)

❯ 1 - partially yes, because i allready seaded text book inside the app with page numbers and exericse numbers now i have to build cropping mechanism in
  the settins for each questions, so we can get the quetion's image that exactly match the questions number, so we can get the questions induvidually but
  right now we have page number range for the exercise , so here we have even crop to specific questions and this is how i have to get the image as images
  because ocr not work here , this is the best strategy i think from my best of knowledge, because this book have tamil encoding problem that's why i
  choose this strategy, and still i didn't add answers for the quetions but i will add the answers for the quetions in feature so you don't worry i will
  do, i will do these things in data entry tab, but to add these - mechanism not build yet but after build, this is possible. if you have any doubts please
   ask me. 2 - question-level. 3 - good quetion, it's like a live tuning in the class room, please go to the student page so you can see, we have downgrade
   option for any students, for example if the students is grade 10 we start from grade 10 syllabus, but if we find weak we downgrade to grade 9, so that's
   mean we assigning grade 9 syllabus also. and this is flexible for each module. so here the sheet going to be different for him. here we have more edge
  cases but we can solve. if you have any doubts please ask me and get cristal clear clarity for this question. 4 - right now i don't have, but i will buy
  in feature but now i will print before the class, 5 - yes you right. 6 - okay. 7 - b. 8 - it's very important question, because i have term exam papers,
  so after finishing the syllabus of the terms, system will tell time to do term exam, and each term exam is going to be the goal of the alogrithem. if you
   have doubts please ask me, and above you mentioned each day have each module, that
  ⎿  Interrupted · What should Claude do instead?

❯ continuation of previous message - but that each module for each day is not work anymore i think, because now we are building spaced repetion, active
  recall and interleaving, still we need module based structure in whole app, but for dedicating for each day is not good idea what you think. and i
  appriciate your understanding, ideas and suggetions. please tell me if you have any suggetions or ideas.

● Great answers. #8 especially — term exam papers as the optimization target changes the shape of this entire system. Let me think through your new question
   and a few things your answers surfaced.

  ---
  On the weekday-module question — don't abandon it, hybridize it

  You're half-right but I'd push back on "fully abandon per-day modules." The research on SR+interleaving is actually clearer than people summarize: initial
   acquisition benefits from blocked practice; consolidation and transfer benefit from interleaving. It's not a war between the two — it's a question of
  when to transition.

  Here's what I'd recommend instead — and it respects both pedagogy and your operational reality:

  Daily sheet structure (same template every day):

  ┌──────────────┬───────┬────────────────────────────────────────────────────────────┬────────────────────────────────────────────────────────────────┐
  │    Strip     │ Size  │                          Content                           │                            Purpose                             │
  ├──────────────┼───────┼────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
  │ Warm-up      │ 2–3   │ Cross-module SR — whatever concepts are overdue across any │ Daily SR across all 6 modules → no more 7-day gap              │
  │              │ Qs    │  module                                                    │                                                                │
  ├──────────────┼───────┼────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
  │ Main block   │ 70%   │ Today's module, interleaved across sub-topics within the   │ Blocked-at-module, interleaved-within — initial acquisition +  │
  │              │       │ module                                                     │ within-module discrimination                                   │
  ├──────────────┼───────┼────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
  │ Exam-prep    │ 1–2   │ Mixed-module questions pulled from past term papers,       │ Trains the "which technique is this?" skill the exam actually  │
  │ strip        │ Qs    │ difficulty ramps as term progresses                        │ tests                                                          │
  └──────────────┴───────┴────────────────────────────────────────────────────────────┴────────────────────────────────────────────────────────────────┘

  Weekly/term rhythm on top:
  - First 4 weeks of term → mostly blocked + warm-up (learning phase)
  - Weeks 5–8 → main block shrinks, exam-prep strip grows (consolidation)
  - Last 2 weeks before term exam → fully mixed, past-paper-shaped sheets (rehearsal)

  Result: parent still sees "Tuesday is algebra" · teacher still mostly preps one module's answer keys · but student gets daily SR, cross-module
  discrimination, and an exam-shape-matching curve that peaks exactly when it needs to.

  This is strictly stronger than both the current "Tuesday = algebra only" and a fully mixed schedule.

  ---
  Term exam papers are your goal function — this is the key insight

  Once you tag past term exam questions with conceptIds, you unlock a concrete optimization target. The algorithm's job becomes:

  expected_exam_score(student) = Σ over concepts c:
    mastery(student, c) × marks_per_exam(c)

  Sheet generator picks questions that maximize:
    Δ expected_exam_score / practice_minute

  This is no longer vibes-based pedagogy. It's a quantifiable objective. Every sheet is literally trying to move this number up, subject to prerequisite
  constraints and time budget.

  Even better: after every term exam, feed the student's actual exam performance back into the model. The algorithm learns which concepts it
  under-prioritized (where predicted mastery was high but exam marks were low — those concepts need higher SR weight or more interleaving). The system gets
  smarter each term.

  This is a real learning algorithm. Most ed-tech doesn't have this because most ed-tech doesn't have a fixed, graded, graded-by-humans, rich ground-truth
  signal like a term exam paper. You do.

  Ask yourself: do you have 3-5 past term exam papers per grade digitized/photographed? If yes, we can tag them in the same cropping tool and the system has
   a training set from day one. If no, getting them is priority #1 — more important than building the cropping UI.

  ---
  On the cropping mechanism — smart strategy, one gap to watch

  Your approach (crop per-question images, skip OCR entirely) is exactly right for Tamil. Two implementation notes:

  1. Store crop coordinates, not cropped files. Keep {pageImageId, x, y, w, h} per question. Re-crop is free, and you can change padding/margins globally
  later without re-cropping 5000 images.
  2. Auto-suggest boundaries. A simple horizontal-whitespace detector on each page gives you candidate Q-boundaries automatically; admin just confirms or
  adjusts. Turns 15-sec/question into 3-sec/question. Worth the ~2 days of engineering.

  The gap to watch — question density per concept. For SR to actually work, a student shouldn't see the same question on each review (they'd just memorize
  the answer). They need a fresh instance of the same concept. So for a concept like "solving linear equations in one variable" at difficulty 3, you need at
   least 5–8 different questions to rotate through.

  The textbook alone probably gives you 2–3 per concept in most cases — not enough for SR to run long-term. Sources to fill the gap, roughly in order of
  effort:
  - Past term exam papers (you have these) → cropped questions double as SR content
  - Other grades' textbooks from the same syllabus for the same concept
  - Teacher-authored variants — later, lower priority
  - Parametric templates (e.g. solve ax + b = c with random a, b, c) — much later, but cheap once built

  For MVP, plan on textbook + past exam papers being enough. You'll hit density issues on ~10-15% of concepts; those can be flagged for the teacher to fill
  in manually.

  ---
  On difficulty-weighted scoring (your answer B)

  I support it, but I'd de-risk it: run both scoring engines in parallel for one full term. Show students both numbers in the app ("Today's points: 275
  (flat) / 410 (weighted)"). If engagement stays strong or improves under weighted, switch fully. If it drops, you have the flat number to fall back on with
   zero drama.

  Changing the point system mid-way is risky because your current system is already working as motivation. Don't blow it up — A/B it first.

  ---
  Two new things you haven't mentioned that I'd consider

  1. "Struggle window" detection. Current app infers idle from timestamps. Once you have mastery + difficulty data, you get a much stronger signal: if
  student Rahul just spent 15 minutes on a difficulty-3 question he should handle at his mastery level, he's probably stuck, not idle. Lead gets a different
   alert color — "stuck on hard question," not "idle." Different intervention. This is more surgical than time-based idle.

  2. Per-student sheet variant at question level. Two Grade-10 students in the same class can get structurally identical sheets (same concept mix, same
  difficulty ramp) but different actual questions. Prevents copying between neighbors and gives you natural A/B data on question difficulty. Costs nothing —
   the generator picks from a pool anyway.

  ---
  Concrete next step I'd recommend

  Before writing any algorithm code, I'd build the cropping + tagging + concept-graph admin tool as its own Phase 0. Everything downstream depends on this
  data existing. Specifically:

  1. Cropping UI (with auto-suggest boundaries) on pages you've already seeded
  2. Concept CRUD (with prerequisite links)
  3. Question tagging UI — crop a question, tag concepts + difficulty + answer key, done
  4. Same tool handles textbook questions and past term exam papers (same schema)
  5. Keep a "coverage dashboard" — shows which concepts have < 5 tagged questions so you know where the gaps are

  Once this tool exists and you've tagged, say, one grade's worth of one module (a few hundred questions), we can build the mastery tracking + sheet
  generator against real data. Building the generator without the data is working blind.

  My clarifying question back to you before I write an implementation plan: how many past term exam papers do you have in photo/scan form, across which
  grades? Because if you have even 3 papers × 6 grades = 18 papers, tagged with concepts, that's your entire optimization target signal. It's worth knowing
  the scope of this before we scope the tool.

✻ Baked for 1m 52s

※ recap: Building a personalized math-practice engine (spaced repetition, active recall, interleaving) on top of your existing Aristora tracker, with term
  exam scores as the optimization target. Next: tell me how many past term exam papers you have digitized so I can scope the cropping/tagging tool. (disable
   recaps in /config)

❯ super, i agree your recommendation. but one thing you not understand clearly that, why i want to upload the term paper in the system, for example the
  system knows what are the units of first for each module, then system will use our learning methods and algorithem to prepare for that units. so the
  quetions will splits, and we have more quetions for each sheet we have enoght quetions, after prepaing for all the units of first term, i can see how
  much prepared for each term, once preparation complete by our system, i will my term paper to my student, the system don't know this paper, so i can see
  how the system performs for each module and units, based on that feedback we can tune the system. and even though we building robust algorithem, i can
  see visually how our algorithem works and tune. for each term preparetion engine will become stronger. am i right? still i am brainstorming, what do you
  think.

● You're absolutely right — and I was conflating two things that should be separate. Let me correct myself:

  What I said: use term papers as training signal (tag them with concepts, feed into optimization target).

  What you're saying: keep the term paper as a clean holdout test, never seen by the algorithm. The algorithm prepares based on syllabus units. After the
  exam, compare predicted mastery vs. actual exam performance → tune.

  Your version is stronger. Here's why I wish I'd said this first.

  ---
  Why your framing is actually the correct ML approach

  What you're describing is textbook honest evaluation, the kind most edtech never does:

  ┌──────────────────────────────────────────────────────┬──────────────────────────────────────────────────────────────────────────────────────────────┐
  │                         Role                         │                                            Signal                                            │
  ├──────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Training signal (what the algorithm sees)            │ Syllabus units · concept graph · prerequisites · student's ongoing practice responses        │
  ├──────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Holdout / validation (what the algorithm must NOT    │ The actual term exam paper the student is about to sit                                       │
  │ see)                                                 │                                                                                              │
  ├──────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Feedback (after the exam)                            │ Per-concept: predicted mastery vs. actual exam marks → gap analysis → tune weights for next  │
  │                                                      │ term                                                                                         │
  └──────────────────────────────────────────────────────┴──────────────────────────────────────────────────────────────────────────────────────────────┘

  If I had tagged the term paper and fed it in, I'd have built a system that's great at "pass this specific paper" but fragile to any variation. Your
  approach builds a system that's genuinely good at the concepts, validated against an unseen paper. The difference matters.

  And — critically — every term is now an experiment. Term 1 baseline → tune → Term 2 measurement → tune → Term 3. By Term 4 or 5 the system is genuinely
  calibrated to your students, your center, your style. This feedback loop is rare in education because nobody else has a fixed curriculum + graded exams +
  per-concept tracking all in one system. You do.

  ---
  One refinement — past papers aren't all holdout

  Purity has a cost: if the algorithm only sees "syllabus units, all weighted equally," it doesn't know that examiners consistently emphasize percentages
  over logarithms (or whatever the actual pattern is). It'll waste practice on low-weighted units.

  The clean way to get emphasis data without polluting the holdout:

  - Old papers (3+ years ago, or from other schools) → OK to tag and use as training signal for concept emphasis weighting. They're representative of "what
  examiners emphasize" without being the specific paper the student will sit.
  - Current term's paper → strict holdout. Never seen by the algorithm, never by any teacher interacting with the system during prep.
  - After the current term's exam → that paper joins the "old" pool and becomes training data for next year's students.

  This way the algorithm knows that logarithms are worth ~8 marks/paper on average (from old papers), but doesn't know that this year's paper asks
  specifically about change-of-base formula. That's the honest balance.

  ---
  What to build to make this visible

  The feedback loop is only as good as the instrumentation. Three things I'd put in the admin dashboard:

  1. Per-concept calibration plot. After each term exam, for every concept: predicted mastery (x-axis) vs. actual score on concept's questions (y-axis).
  Dots on the diagonal = calibrated. Dots above diagonal = system underestimated (student knew it better than we thought — reduce SR weight). Dots below
  diagonal = system overestimated (student didn't actually learn it — increase SR weight, more practice earlier). This one chart is the whole tuning story.
  2. Per-unit prep coverage vs. exam weight. Bars showing how many practice-minutes the system allocated to each unit vs. how many marks that unit was
  actually worth in the exam. Reveals systematic over/under-preparation.
  3. Term-over-term improvement metric. Average absolute calibration error per student, plotted over terms. Should drop over time. This is your
  proof-of-concept to yourself (and later, to franchisees and investors).

  These aren't fancy — they're just bar charts and scatter plots. But they turn the system from "trust me it works" into "here's the measurement."

  ---
  The business implication you may not have articulated yet

  This feedback loop isn't just pedagogically clean — it's a marketing artifact. Imagine showing a parent:

  ▎ "Our system predicted Rahul would score 74% in algebra. Actual: 71%. For geometry, we predicted 62%, actual 58%. Across all six modules, our prediction
  ▎ was accurate within 5 points. Based on this exam, we've adjusted his practice schedule — he needs more work on logarithms and less on basic arithmetic."

  No other tuition can say this. Not because they can't do it, but because they don't have (a) the tracker, (b) the concept graph, (c) the exam ground truth
   in one system. This becomes your differentiator in every parent conversation.

  It also makes franchisee onboarding much more defensible — "the algorithm gets better each term, here's the data from our flagship center, your center
  inherits this calibration from day one."

  ---
  Small practical note on cadence

  Don't expect miracles in Term 1. The first term is a baseline — the system makes its best guesses, the exam gives the first real signal. Term 2 applies
  the first tune. Term 3 is the first term where you can reasonably say "this is calibrated." Be patient and set this expectation with yourself — the system
   will look mediocre for 4-6 months before the feedback loop's effect is visible. This is normal for this kind of system.

  ---
  Short answer to "am I right?": yes, strongly. I'd only add: use older papers to signal emphasis (train), keep the current paper as holdout (test), and
  build the calibration dashboard from day one so the feedback loop is visible and trustable.

  What would help me next: do you have any previous term papers already digitized, or are they all on paper? Because tagging even 3-4 old papers per grade
  gives the algorithm a usable emphasis prior, and it's a concrete task the cropping tool can double for.

✻ Brewed for 1m 16s

❯ perfect you nailed it, you understand well, and i have past term papers so we can tag as you said. and one thing i want to say, you know i think, but i
  have to tell, each grade have 3 term exams, each term have set of units. ther first term exam will have quetions from all modules, actually from all the
  units of first term, and second term have quetions from first term and second term of that grade, 3 rd term have quetions from all the units of that
  grade, i think you understood.

● Yes, I understand clearly — Sri Lankan cumulative term structure:

  - Term 1 exam → only Term 1 units of that grade
  - Term 2 exam → Term 1 + Term 2 units (cumulative)
  - Term 3 exam → all three terms of the year (fully cumulative)

  This is actually the best possible exam structure for a SR-based system to prove itself in. Here's why, and the specific implications.

  ---
  Why cumulative exams are perfect for you

  Traditional tuition fails at cumulative exams because they teach Term 1, move to Term 2, and the Term 1 content fades by the time the Term 2 exam arrives.
   This is exactly the retention failure that SR is designed to prevent.

  Your system is pointed directly at this weakness of traditional tuition. Term 1 exam is mostly a test of whether students learned recent content — any
  decent tuition can do that. Term 2 exam is where retention starts to matter. Term 3 exam is a full-year retention test — this is where your system will
  dominate and traditional tuition will collapse.

  This is your strongest demo. By the time you have 2 years of data, you can say: "Our students' Term 3 scores are X% higher than Term 1 scores relative to
  the control group, because we prevented forgetting." Nobody else will have that story.

  ---
  Practice budget must shift through the year

  Because the exam scope expands cumulatively, the practice mix has to rebalance. Rough proposal:

  ┌──────────────┬─────────────────┬──────────────────────────────────┬───────────────────────────────────────┐
  │    Phase     │ New acquisition │          Prior-term SR           │            Mixed exam-prep            │
  ├──────────────┼─────────────────┼──────────────────────────────────┼───────────────────────────────────────┤
  │ Early Term 1 │ ~90%            │ ~0% (nothing to review yet)      │ ~10% (from past grade, if downgraded) │
  ├──────────────┼─────────────────┼──────────────────────────────────┼───────────────────────────────────────┤
  │ Late Term 1  │ ~75%            │ ~15% (within-term)               │ ~10%                                  │
  ├──────────────┼─────────────────┼──────────────────────────────────┼───────────────────────────────────────┤
  │ Early Term 2 │ ~60% Term 2 new │ ~35% Term 1 review               │ ~5%                                   │
  ├──────────────┼─────────────────┼──────────────────────────────────┼───────────────────────────────────────┤
  │ Late Term 2  │ ~50% Term 2 new │ ~30% Term 1 review               │ ~20% mixed past-paper                 │
  ├──────────────┼─────────────────┼──────────────────────────────────┼───────────────────────────────────────┤
  │ Early Term 3 │ ~50% Term 3 new │ ~20% Term 2 + ~20% Term 1 review │ ~10%                                  │
  ├──────────────┼─────────────────┼──────────────────────────────────┼───────────────────────────────────────┤
  │ Late Term 3  │ ~25% Term 3 new │ ~60% comprehensive review        │ ~15% full-paper simulation            │
  └──────────────┴─────────────────┴──────────────────────────────────┴───────────────────────────────────────┘

  The algorithm reads the current date, the student's grade, and the known exam calendar, then computes the mix automatically. No manual teacher
  intervention per term.

  ---
  The "debt" concept — this is where the Lead dashboard earns its keep

  Cumulative exams create a compounding risk. A student weak on Term 1 percentages carries that debt into Term 2 (will hurt their Term 2 exam) AND into Term
   3 (will hurt their Term 3 exam even worse). Three exposures, three hits.

  The Lead dashboard should surface this as "Retention debt: 4 Term 1 concepts below threshold" per student. Tapping shows which ones, with estimated
  marks-at-risk in each upcoming exam. This is actionable: Lead schedules remediation now, not during exam week when it's too late.

  Business angle: showing parents a "retention debt = LKR 0 marks at risk" dashboard is powerful. Showing traditional tuition's lack of this is even more
  powerful.

  ---
  SR intervals need to be exam-anchored, not generic

  Standard SM-2 spacing (1d, 3d, 7d, 16d, 35d...) is tuned for long-term general retention. Yours is different: you need every concept to be freshly
  reviewed within ~2-3 weeks of its relevant exam, regardless of where the natural SR interval would have placed it.

  So the algorithm has two scheduling rules:
  1. Natural SR interval (standard expansion based on performance)
  2. Exam-date backstop: if the next interval would push review past (exam date − 21 days), clip it to land inside that window

  This ensures Term 1 concepts are always freshly cycled before Term 2 exam, even if natural spacing says "this concept is so well-learned it could wait 3
  months."

  ---
  The edge case you haven't named — mid-year joiners

  A student joining at start of Term 2 has a problem: they haven't learned Term 1 units, but Term 2 exam will test them. The system needs a policy:

  - Option A (catch-up mode): Compress Term 1 acquisition into their first 4-6 weeks, while others are starting Term 2. Their sheet is mostly Term 1 until
  they're caught up, then they join the normal flow.
  - Option B (partial scope): Accept that Term 1 is lost, focus on Term 2, expect lower marks on Term 2 exam but solid Term 3.
  - Option C (teacher decides, per student): The Lead has a switch per student — which mode this student is in.

  I'd default to C. The teacher knows whether the kid is a hard worker who can catch up, or a weaker student who'd drown under double workload. Make it
  explicit.

  ---
  Implication for your MVP sequence

  Here's where it tightens. If you enroll a new cohort in Term 1 (cleanest scenario), you get:

  - Months 1–3: Build + tag content, collect Term 1 practice data, Term 1 exam happens → first calibration signal
  - Months 4–6: System tunes, Term 2 practice, Term 2 exam → second calibration signal (this one measures retention — the key metric)
  - Months 7–9: Term 3 practice, Term 3 exam → the big one, full-year retention test

  Start the real build with a Term 1 cohort. Don't start mid-year or you lose the clean Term 1 baseline and the retention story gets muddled. This means
  your build timeline should target readiness for the next Term 1 start — plan backward from that date.

  What are the actual Term 1 start dates in the Sri Lankan calendar for the next cycle? That's your hard deadline. Everything works backward from there.

  ---
  Tiny thing I want to flag

  You now have a system with three interlocking feedback signals (Term 1, Term 2, Term 3), each probing a different thing (acquisition, short retention,
  long retention). Most edtech companies have zero feedback signals. You have three per year per student. Take this seriously in how you instrument the
  system — every exam is a scientific instrument reading. The data you collect over 2-3 years here becomes your defining asset and cannot be replicated by a
   competitor without waiting 2-3 years themselves.

  Next question I'd put to you: when's the next Term 1 start date on the academic calendar? That anchors everything else.