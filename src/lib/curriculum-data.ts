import { CurriculumModule } from './types';

function buildUnits(moduleId: string, grade: number, term: number, names: string[]) {
  return names.map((name, i) => ({
    id: `${moduleId}-G${grade}-T${term}-${i}`,
    name,
  }));
}

export const CURRICULUM_MODULES: CurriculumModule[] = [
  {
    id: 'M1',
    name: 'Numbers & Arithmetic',
    tamilName: 'எண்கள் / எண்கணிதம்',
    day: 'Monday',
    dayIndex: 1,
    color: '#1B4F72',
    grades: [
      {
        grade: 6,
        terms: [
          { term: 1, units: buildUnits('M1', 6, 1, ['2. இடப் பெறுமானம்', '3. முழு எண்களில் கணிதச் செய்கைகள்', '6. மதிப்பிடலும் மட்டந்தட்டலும்']) },
          { term: 2, units: buildUnits('M1', 6, 2, ['9. பின்னங்கள்', '11. காரணிகளும் மடங்குகளும்', '13. தசமங்கள்', '14. எண் வகைகளும் எண் கோலங்களும்']) },
          { term: 3, units: buildUnits('M1', 6, 3, ['21. விகிதம்', '24. சுட்டிகள்']) },
        ],
      },
      {
        grade: 7,
        terms: [
          { term: 1, units: buildUnits('M1', 7, 1, ['3. முழு எண்களில் கணிதச் செய்கைகள்', '4. காரணிகளும் மடங்குகளும்', '5. சுட்டிகள்', '8. திசைகொண்ட எண்கள்']) },
          { term: 2, units: buildUnits('M1', 7, 2, ['10. பின்னங்கள்', '11. தசமங்கள்']) },
          { term: 3, units: buildUnits('M1', 7, 3, ['21. விகிதம்', '22. சதவீதம்']) },
        ],
      },
      {
        grade: 8,
        terms: [
          { term: 1, units: buildUnits('M1', 8, 1, ['1. எண் கோலங்கள்', '4. திசைகொண்ட எண்கள்', '7. காரணிகள்', '8. வர்க்கமூலம்', '10. சுட்டிகள்']) },
          { term: 2, units: buildUnits('M1', 8, 2, ['13. பின்னங்கள்', '14. பின்னங்கள்', '15. தசமஎண்', '16. விகிதம்', '18. சதவீதம்']) },
        ],
      },
      {
        grade: 9,
        terms: [
          { term: 1, units: buildUnits('M1', 9, 1, ['1. எண் கோலங்கள்', '2. துவித எண்கள்', '3. பின்னங்கள்', '4. சதவீதம்']) },
          { term: 2, units: buildUnits('M1', 9, 2, ['10. நேர் விகிதசமன்', '11. கணி கருவி', '12. சுட்டிகள்', '13. மட்டந்தட்டலும் விஞ்ஞானமுறைக் குறிப்பீடும்']) },
        ],
      },
      {
        grade: 10,
        terms: [
          { term: 1, units: buildUnits('M1', 10, 1, ['2. வர்க்கமூலம்', '3. பின்னங்கள்', '10. நேர்மாறு விகிதசமன்']) },
          { term: 2, units: buildUnits('M1', 10, 2, ['14. சதவீதம்', '19. மடக்கை I', '20. மடக்கை II', '22. வீதம்']) },
        ],
      },
      {
        grade: 11,
        terms: [
          { term: 1, units: buildUnits('M1', 11, 1, ['1. மெய்யெண்கள்', '2. சுட்டிகளும் மடக்கைகளும் I', '3. சுட்டிகளும் மடக்கைகளும் II']) },
          { term: 2, units: buildUnits('M1', 11, 2, ['09. சதவீதம்', '10. பங்குகள்']) },
        ],
      },
    ],
  },
  {
    id: 'M2',
    name: 'Algebra, Graphs & Matrices',
    tamilName: 'அட்சரகணிதம், வரைபுகள், தாயங்கள்',
    day: 'Tuesday',
    dayIndex: 2,
    color: '#6C3483',
    grades: [
      {
        grade: 6,
        terms: [
          { term: 1, units: buildUnits('M2', 6, 1, ['5. எண் கோடு']) },
          { term: 3, units: buildUnits('M2', 6, 3, ['18. அட்சரகணிதக் குறியீடுகள்', '19. அட்சரகணிதக் கோவைகள் உருவாக்கலும் பிரதியிடுதலும்']) },
        ],
      },
      {
        grade: 7,
        terms: [
          { term: 2, units: buildUnits('M2', 7, 2, ['12. அட்சரகணிதக் கோவைகள்', '15. சமன்பாடுகளும் சூத்திரங்களும்']) },
          { term: 3, units: buildUnits('M2', 7, 3, ['23. தெக்காட்டின் தளம்']) },
        ],
      },
      {
        grade: 8,
        terms: [
          { term: 1, units: buildUnits('M2', 8, 1, ['5. அட்சரகணிதக் கோவைகள்']) },
          { term: 2, units: buildUnits('M2', 8, 2, ['17. சமன்பாடுகள்']) },
          { term: 3, units: buildUnits('M2', 8, 3, ['25. எண்கோடு, தெக்காட்டின் தளம்', '29. சமனிலிகள்']) },
        ],
      },
      {
        grade: 9,
        terms: [
          { term: 1, units: buildUnits('M2', 9, 1, ['5. அட்சரகணிதக் கோவைகள்', '6. அட்சரகணிதக் கோவைகளின் காரணிகள்']) },
          { term: 2, units: buildUnits('M2', 9, 2, ['15. சமன்பாடுகள்', '17. சூத்திரங்கள்', '20. வரைபுகள்']) },
          { term: 3, units: buildUnits('M2', 9, 3, ['21. சமனிலிகள்', '26. அட்சரகணிதப் பின்னங்கள்']) },
        ],
      },
      {
        grade: 10,
        terms: [
          { term: 1, units: buildUnits('M2', 10, 1, ['4. ஈருறுப்புக் கோவைகள்', '7. இருபடிக் கோவைகளின் காரணிகள்', '12. அட்சரகணிதக் கோவைகளின் பொது மடங்குகளுட் சிறியது']) },
          { term: 2, units: buildUnits('M2', 10, 2, ['13. அட்சரகணிதப் பின்னங்கள்', '15. சமன்பாடுகள்', '21. வரைபுகள்', '23. சூத்திரங்கள்']) },
          { term: 3, units: buildUnits('M2', 10, 3, ['24. கூட்டல் விருத்தி', '25. அட்சரகணிதச் சமனிலிகள்']) },
        ],
      },
      {
        grade: 11,
        terms: [
          { term: 1, units: buildUnits('M2', 11, 1, ['6. ஈருறுப்புக் கோவைகள்', '7. அட்சரகணிதப் பின்னங்கள்']) },
          { term: 2, units: buildUnits('M2', 11, 2, ['12. வரைபுகள்', '13. சமன்பாடுகள்', '16. பெருக்கல் விருத்தி']) },
          { term: 3, units: buildUnits('M2', 11, 3, ['19. தாயங்கள்', '20. சமனிலிகள்']) },
        ],
      },
    ],
  },
  {
    id: 'M3',
    name: 'Geometry & Constructions',
    tamilName: 'கேத்திரகணிதமும் அமைப்புகளும்',
    day: 'Wednesday',
    dayIndex: 3,
    color: '#1E8449',
    grades: [
      {
        grade: 6,
        terms: [
          { term: 1, units: buildUnits('M3', 6, 1, ['1. வட்டங்கள்', '7. கோணங்கள்', '8. திசைகள்']) },
          { term: 2, units: buildUnits('M3', 6, 2, ['10. தெரிதல்', '12. நேர்கோட்டுத் தளவுருவங்கள்', '17. திண்மங்கள்']) },
        ],
      },
      {
        grade: 7,
        terms: [
          { term: 1, units: buildUnits('M3', 7, 1, ['1. இருபக்கச் சமச்சீர்', '7. சமாந்தர நேர்கோடுகள்', '9. கோணங்கள்']) },
          { term: 2, units: buildUnits('M3', 7, 2, ['14. நேர்கோட்டுத் தளவுருவங்கள்', '18. வட்டங்கள்']) },
          { term: 3, units: buildUnits('M3', 7, 3, ['24. தளவுருவங்களை அமைத்தல்', '25. திண்மங்கள்', '27. அளவிடைப் படங்கள்', '28. தெசலாக்கம்']) },
        ],
      },
      {
        grade: 8,
        terms: [
          { term: 1, units: buildUnits('M3', 8, 1, ['3. கோணம்', '6. திண்மங்கள்']) },
          { term: 2, units: buildUnits('M3', 8, 2, ['11. சமச்சீர்', '12. முக்கோணிகள்']) },
          { term: 3, units: buildUnits('M3', 8, 3, ['23. வட்டம்', '24. திசைகோள்', '26. ஒழுக்குகளும் அமைப்புகளும்', '28. அளவிடைப்படம்']) },
        ],
      },
      {
        grade: 9,
        terms: [
          { term: 1, units: buildUnits('M3', 9, 1, ['7. வெளிப்படையுண்மைகள்', '8. நேர்கோடுகள், சமாந்தரக்கோடுகள் தொடர்பான கோணங்கள்']) },
          { term: 2, units: buildUnits('M3', 9, 2, ['14. ஒழுக்குகளும் அமைப்புகளும்', '16. முக்கோணியொன்றின் கோணங்கள்', '18. வட்டமொன்றின் பரிதி', '19. பைதகரசின் தொடர்பு']) },
          { term: 3, units: buildUnits('M3', 9, 3, ['25. பல்கோணிகளின் கோணங்கள்', '27. அளவிடைப் படங்கள்']) },
        ],
      },
      {
        grade: 10,
        terms: [
          { term: 1, units: buildUnits('M3', 10, 1, ['5. முக்கோணிகளின் ஒருங்கிசைவு', '8. முக்கோணிகள் I', '9. முக்கோணிகள் II']) },
          { term: 2, units: buildUnits('M3', 10, 2, ['16. இணைகரங்கள் I', '17. இணைகரங்கள் II']) },
          { term: 3, units: buildUnits('M3', 10, 3, ['27. வட்டத்தின் நாண்கள்', '28. அமைப்புகள்', '31. வட்டத்தின் கோணங்கள்', '32. அளவிடைப் படம்']) },
        ],
      },
      {
        grade: 11,
        terms: [
          { term: 2, units: buildUnits('M3', 11, 2, ['11. நடுப்புள்ளித் தேற்றம்', '14. சமகோண முக்கோணிகள்']) },
          { term: 3, units: buildUnits('M3', 11, 3, ['17. பைதகரஸ் தேற்றம்', '18. திரிகோணகணிதம்', '21. வட்ட நாற்பக்கல்', '22. தொடலிகள்', '23. அமைப்புகள்']) },
        ],
      },
    ],
  },
  {
    id: 'M4',
    name: 'Measurements',
    tamilName: 'அளவீடுகள்',
    day: 'Thursday',
    dayIndex: 4,
    color: '#B9770E',
    grades: [
      {
        grade: 6,
        terms: [
          { term: 1, units: buildUnits('M4', 6, 1, ['4. காலம்']) },
          { term: 2, units: buildUnits('M4', 6, 2, ['15. நீளம்', '16. திரவ அளவீடு']) },
          { term: 3, units: buildUnits('M4', 6, 3, ['20. திணிவு', '25. பரப்பளவு']) },
        ],
      },
      {
        grade: 7,
        terms: [
          { term: 1, units: buildUnits('M4', 7, 1, ['6. காலம்']) },
          { term: 2, units: buildUnits('M4', 7, 2, ['13. திணிவு', '16. நீளம்', '17. பரப்பளவு', '19. கனவளவு', '20. திரவ அளவீடு']) },
        ],
      },
      {
        grade: 8,
        terms: [
          { term: 1, units: buildUnits('M4', 8, 1, ['2. சுற்றளவு', '9. திணிவு']) },
          { term: 2, units: buildUnits('M4', 8, 2, ['20. பரப்பளவு', '21. காலம்']) },
          { term: 3, units: buildUnits('M4', 8, 3, ['22. கனவளவு, கொள்ளளவு']) },
        ],
      },
      {
        grade: 9,
        terms: [
          { term: 1, units: buildUnits('M4', 9, 1, ['9. திரவ அளவீடு']) },
          { term: 3, units: buildUnits('M4', 9, 3, ['23. பரப்பளவு']) },
        ],
      },
      {
        grade: 10,
        terms: [
          { term: 1, units: buildUnits('M4', 10, 1, ['1. சுற்றளவு', '6. பரப்பளவு']) },
          { term: 3, units: buildUnits('M4', 10, 3, ['29. மேற்பரப்பளவும் கனவளவும்']) },
        ],
      },
      {
        grade: 11,
        terms: [
          { term: 1, units: buildUnits('M4', 11, 1, ['4. திண்மங்களின் மேற்பரப்பின் பரப்பளவு', '5. திண்மங்களின் கனவளவு', '8. சமாந்தரக் கோடுகளுக்கிடையில் உள்ள தளவுருவங்களின் பரப்பளவு']) },
        ],
      },
    ],
  },
  {
    id: 'M5',
    name: 'Statistics',
    tamilName: 'புள்ளியியல்',
    day: 'Friday',
    dayIndex: 5,
    color: '#C0392B',
    grades: [
      {
        grade: 6,
        terms: [
          { term: 3, units: buildUnits('M5', 6, 3, ['22. தரவுகளைச் சேகரித்தலும் வகைப்படுத்தலும்', '23. தரவுகளுக்கு விளக்கம் கூறல்']) },
        ],
      },
      {
        grade: 7,
        terms: [
          { term: 3, units: buildUnits('M5', 7, 3, ['26. தரவுகளை வகைப்படுத்தலும் விளக்கம் கூறலும்']) },
        ],
      },
      {
        grade: 8,
        terms: [
          { term: 3, units: buildUnits('M5', 8, 3, ['27. தரவுகளை வகைப்படுத்தலும் மைய நாட்ட அளவைகளும்']) },
        ],
      },
      {
        grade: 9,
        terms: [
          { term: 3, units: buildUnits('M5', 9, 3, ['28. தரவுகளை வகைப்படுத்தலும் விளக்கம் கூறலும்']) },
        ],
      },
      {
        grade: 10,
        terms: [
          { term: 1, units: buildUnits('M5', 10, 1, ['11. தரவுகளை வகைப்படுத்தல்']) },
          { term: 3, units: buildUnits('M5', 10, 3, ['26. எண் பரம்பல்']) },
        ],
      },
      {
        grade: 11,
        terms: [
          { term: 2, units: buildUnits('M5', 11, 2, ['15. தரவுகளை வகைப்படுத்தலும் விளக்கம் கூறலும்']) },
        ],
      },
    ],
  },
  {
    id: 'M6',
    name: 'Sets & Probability',
    tamilName: 'தொடைகள் & நிகழ்தகவு',
    day: 'Saturday',
    dayIndex: 6,
    color: '#2E86C1',
    grades: [
      {
        grade: 6,
        terms: [],
      },
      {
        grade: 7,
        terms: [
          { term: 1, units: buildUnits('M6', 7, 1, ['2. தொடைகள்']) },
          { term: 3, units: buildUnits('M6', 7, 3, ['29. நிகழ்வொன்றின் தகுதகவு']) },
        ],
      },
      {
        grade: 8,
        terms: [
          { term: 2, units: buildUnits('M6', 8, 2, ['19. தொடைகள்']) },
          { term: 3, units: buildUnits('M6', 8, 3, ['30. நிகழ்தகவு']) },
        ],
      },
      {
        grade: 9,
        terms: [
          { term: 3, units: buildUnits('M6', 9, 3, ['22. தொடைகள்', '24. நிகழ்தகவு']) },
        ],
      },
      {
        grade: 10,
        terms: [
          { term: 2, units: buildUnits('M6', 10, 2, ['18. தொடைகள்']) },
          { term: 3, units: buildUnits('M6', 10, 3, ['30. நிகழ்தகவு']) },
        ],
      },
      {
        grade: 11,
        terms: [
          { term: 3, units: buildUnits('M6', 11, 3, ['24. தொடைகள்', '25. நிகழ்தகவு']) },
        ],
      },
    ],
  },
];

export function getModuleById(id: string): CurriculumModule | undefined {
  return CURRICULUM_MODULES.find(m => m.id === id);
}

export function getModuleForDay(dayIndex: number): CurriculumModule | undefined {
  return CURRICULUM_MODULES.find(m => m.dayIndex === dayIndex);
}

export function getAllUnitIds(): string[] {
  const ids: string[] = [];
  for (const mod of CURRICULUM_MODULES) {
    for (const grade of mod.grades) {
      for (const term of grade.terms) {
        for (const unit of term.units) {
          ids.push(unit.id);
        }
      }
    }
  }
  return ids;
}

export function extractUnitNumber(name: string): number {
  const match = name.match(/^(\d+)\./);
  return match ? parseInt(match[1]) : 0;
}

export function getUnitsForBook(grade: number, startUnit: number, endUnit: number) {
  const units: { id: string; name: string; number: number; moduleId: string; term: number }[] = [];
  for (const mod of CURRICULUM_MODULES) {
    const gradeData = mod.grades.find(g => g.grade === grade);
    if (!gradeData) continue;
    for (const term of gradeData.terms) {
      for (const unit of term.units) {
        const num = extractUnitNumber(unit.name);
        if (num >= startUnit && num <= endUnit) {
          units.push({ id: unit.id, name: unit.name, number: num, moduleId: mod.id, term: term.term });
        }
      }
    }
  }
  return units.sort((a, b) => a.number - b.number);
}

export function findUnit(unitId: string): { module: CurriculumModule; grade: number; term: number; unit: { id: string; name: string } } | null {
  for (const mod of CURRICULUM_MODULES) {
    for (const grade of mod.grades) {
      for (const term of grade.terms) {
        for (const unit of term.units) {
          if (unit.id === unitId) {
            return { module: mod, grade: grade.grade, term: term.term, unit };
          }
        }
      }
    }
  }
  return null;
}

// Get all units for a module in order (G6T1 -> G6T2 -> G6T3 -> G7T1 -> ...)
export function getOrderedUnits(moduleId: string): { id: string; name: string; grade: number; term: number }[] {
  const mod = getModuleById(moduleId);
  if (!mod) return [];
  const units: { id: string; name: string; grade: number; term: number }[] = [];
  for (const grade of mod.grades) {
    for (const term of grade.terms) {
      for (const unit of term.units) {
        units.push({ ...unit, grade: grade.grade, term: term.term });
      }
    }
  }
  return units;
}
