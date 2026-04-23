// Conservative sign-off detection — exact match after stripping trailing punctuation.
// Add new phrases here; no other file needs to change.

const SIGN_OFF_PHRASES = new Set([
  // Hebrew — night / sleep
  "לילה טוב",
  "לילה",
  "לילה אחי",
  "לילה חבר",
  "אני הולך לישון",
  "הולך לישון",

  // Hebrew — done for today
  "סיימתי להיום",
  "סיימתי",
  "גמרתי להיום",
  "גמרתי",
  "פרשתי",
  "פורש",
  "סוגר להיום",
  "סגרתי להיום",

  // Hebrew — farewell
  "ביי",
  "שב שיר",
  "להתראות",

  // English — night / sleep
  "good night",
  "night",
  "going to sleep",

  // English — done
  "done for today",
  "done trading",
  "done for the day",
  "calling it",
  "calling it a day",
  "signing off",
  "wrapping up",
  "wrapping it up",
  "cya",
  "see ya",
  "bye",
  "goodbye",
]);

function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[״׳.!?,؟،]+$/u, ""); // strip trailing punctuation (incl. Hebrew)
}

export function isSignOffMessage(text: string): boolean {
  const n = normalize(text);
  return SIGN_OFF_PHRASES.has(n);
}
