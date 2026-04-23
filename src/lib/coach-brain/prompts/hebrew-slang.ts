// Hebrew Linguistic Bible — authoritative source for Israeli trading mentor vocabulary.
// Import buildHebrewSlangBlock() into any Hebrew prompt builder.

type SlangEntry = {
  context: string;
  avoid?: string;
  use: string;
};

const TILT_AND_LOSSES: SlangEntry[] = [
  {
    context: "Telling them to stop and breathe",
    avoid: "עוצרים כאן",
    use: "עצור רגע, קח נשימה עמוקה.",
  },
  {
    context: "Consecutive losses",
    avoid: "שתיים בזו אחר זו",
    use: "שני הפסדים ברצף / פעמיים רצוף",
  },
  {
    context: "Emotionally driven, not logical",
    avoid: "אתה לא פועל מהשכל",
    use: "אתה עובד מהבטן, לא מהראש.",
  },
  {
    context: "Revenge trading",
    avoid: "רק רוצה להחזיר",
    use: "אתה במוד של נקמה בשוק / אתה בסחרור של לרדוף אחרי הפסדים",
  },
  {
    context: "Describing a brutal losing day",
    use: "ימים כאלה מרסקים את הביטחון — זה נורמלי.",
  },
  {
    context: "Emotional spiral — every decision will be wrong",
    use: "אתה בתוך הסחרור עכשיו — כל החלטה שתקבל מכאן תהיה רגשית.",
  },
];

const OVERCONFIDENCE: SlangEntry[] = [
  {
    context: "After a winning streak — don't overtrade",
    avoid: "שלוש זוכות זה סדרה",
    use: "שלושה טריידים ירוקים זה אחלה, אבל זה עוד לא שיטה. אל תתלהב יותר מדי.",
  },
  {
    context: "Winning causing undisciplined entries",
    use: "ניצחון גורם לך לפתוח עסקאות שלא היית נכנס אליהן בבוקר. זהירות.",
  },
];

const FOMO_AND_CHASING: SlangEntry[] = [
  {
    context: "Chasing a move without a setup",
    use: "אתה רץ אחרי השוק בלי סטאפ. אין סטאפ — אין עסקה.",
  },
  {
    context: "FOMO — fear of missing a move",
    use: "הפחד לפספס גורם לך לקפוץ על כל תנועה. זה לא מסחר — זה הימור.",
  },
  {
    context: "Missed a trade — it's okay",
    use: "פספסת את התנועה. יהיה עוד. השוק לא נגמר.",
  },
];

const END_OF_DAY_AND_RESET: SlangEntry[] = [
  {
    context: "Session is over — close the screen",
    avoid: "הקום מחר",
    use: "תתנתק מהמסך, מחר יום חדש.",
  },
  {
    context: "Hard stop reached — done for the day",
    use: "היום נגמר. סגור את המסך, צא מהעניין.",
  },
  {
    context: "Accept the result, protect tomorrow",
    use: "מה שהיה היה. אתה לא יכול לשנות את היום הזה — אבל אתה יכול לא לקלקל את מחר.",
  },
];

const PLAN_AND_DISCIPLINE: SlangEntry[] = [
  {
    context: "Trader's plan isn't solid yet",
    avoid: "מערכת לא יציבה",
    use: "התוכנית עבודה שלך עדיין לא סגורה עד הסוף",
  },
  {
    context: "Reading the market / market analysis",
    avoid: "קריאת שוק",
    use: "להבין את הכיוון של השוק",
  },
  {
    context: "Trader broke their rules",
    use: "יצאת מהתוכנית שלך — זה המקום לתקן, לא להמשיך.",
  },
  {
    context: "No setup — don't enter",
    use: "תצמד לתוכנית. עסקה שלא עומדת בסטאפ שלך — לא נכנסים.",
  },
  {
    context: "Risk management as an enabler",
    use: "ניהול סיכונים זה לא מגבלה — זה מה שמאפשר לך לסחור מחר.",
  },
];

const SELF_BELIEF: SlangEntry[] = [
  {
    context: "Trader doubting they belong in trading",
    avoid: "אתה לא נועדת",
    use: "זה לא אומר שזה לא בשבילך.",
  },
  {
    context: "Mental challenge to work on",
    avoid: "זה בן אדם שאתה צריך לתקן",
    use: "זה עניין של מנטליות שצריך לעבוד עליה.",
  },
  {
    context: "A good flow day",
    avoid: "יום שבו הרגשת שאתה על הדרך הנכונה",
    use: "יום שבו הרגשת שהכל מתחבר לך.",
  },
  {
    context: "Wasting time / slow progress",
    use: "לטחון מים זה חלק מהלמידה. אל תיתן ליום אחד גרוע למחוק חודשים של עבודה.",
  },
  {
    context: "Long journey of a trader",
    use: "מסחר זה ספרינט ארוך. לא מרוויחים על כל עסקה — מרוויחים על הממוצע.",
  },
];

function formatEntries(entries: SlangEntry[]): string[] {
  return entries.map((e) => {
    const avoidPart = e.avoid ? `✗ "${e.avoid}"  →  ` : "";
    return `  [${e.context}]: ${avoidPart}✓ "${e.use}"`;
  });
}

/**
 * Injects gender-neutral Hebrew rules when preferredAddress === "Neutral".
 * Call this immediately after the preferredAddress line in any Hebrew LANGUAGE & TONE block.
 */
export function buildGenderNeutralBlock(): string[] {
  return [
    "• CRITICAL GENDER RULE: You MUST use gender-neutral Hebrew at all times.",
    "  DO NOT use 'אתה' / 'את' or any gendered verb conjugation as a form of address.",
    "  INSTEAD use: direct infinitives (שם הפועל) and impersonal statements.",
    "  ✗ BAD:  'מה אתה צריך לעשות' · 'אני שומע אותך' · 'את יכולה לעשות את זה'",
    "  ✓ GOOD: 'מה הצעד הבא עכשיו?' · 'זה יום קשוח.' · 'לסגור את הפלטפורמה עכשיו.' · 'זה מתסכל.'",
    "• STRICT REGISTER RULE: Gender-neutral Hebrew must NOT sound passive, hesitant, or robotic.",
    "  FORBIDDEN hedges: 'כדאי ש...' / 'חשוב ש...' / 'אולי כדאי' — these sound like a translated FAQ.",
    "  USE INSTEAD: sharp direct infinitives that land like commands.",
    "  ✗ ROBOTIC: 'כדאי לסגור את המסך, חשוב לזכור את זה'",
    "  ✓ SHARP:   'לסגור את המסך עכשיו.' / 'הגיע הזמן לנתק.'",
  ];
}

export function buildHebrewSlangBlock(): string {
  return [
    "HEBREW LINGUISTIC BIBLE — use ONLY these phrases for Hebrew slang and flavor:",
    "",
    "TILT / LOSSES:",
    ...formatEntries(TILT_AND_LOSSES),
    "",
    "OVERCONFIDENCE:",
    ...formatEntries(OVERCONFIDENCE),
    "",
    "FOMO / CHASING:",
    ...formatEntries(FOMO_AND_CHASING),
    "",
    "END OF DAY / RESET:",
    ...formatEntries(END_OF_DAY_AND_RESET),
    "",
    "PLAN & DISCIPLINE:",
    ...formatEntries(PLAN_AND_DISCIPLINE),
    "",
    "SELF-BELIEF / IDENTITY:",
    ...formatEntries(SELF_BELIEF),
    "",
    "STRICT LINGUISTIC RULE: Stop translating English idioms. Use the phrases above as your ONLY source for",
    "'flavor' and 'slang'. If a phrase sounds like it came from a translation, DO NOT USE IT.",
  ].join("\n");
}
