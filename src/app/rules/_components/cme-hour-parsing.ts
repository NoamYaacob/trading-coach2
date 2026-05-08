/**
 * Safe parser for the Daily cutoff input.
 *
 * Accepts a small, explicit set of canonical input shapes and normalises them
 * to a CME hour integer in the range 0..23. Anything else returns an error.
 *
 * This exists because <input type="number"> has known holes:
 *   - browsers happily accept out-of-range values (e.g. 123)
 *   - pasting "12 pm" can yield "2" or "12" depending on the browser
 *   - decimals slip through even with step=1 in some browsers
 *
 * The parser is the single source of truth for what counts as a valid cutoff
 * input. UI components MUST normalise through this before saving, and server
 * routes MUST re-validate the resulting integer is in 0..23.
 */

export type ParsedCmeHour =
  | { ok: true; hour: number }
  | { ok: false; error: string };

const HOUR_INT_REGEX = /^(?:[01]?\d|2[0-4])$/; // 0..24, no leading 00 weirdness allowed beyond [01]?\d
const TIME_AMPM_REGEX = /^(1[0-2]|[1-9])(?::00)?\s*(am|pm)$/i;

/**
 * Parse a free-form cutoff input into a canonical CME hour (0..23).
 *
 * Accepted shapes:
 *   - integer string "0".."23"           → that integer
 *   - "24"                                → 0 (midnight, normalised)
 *   - "12am" / "12 am" / "12:00am"        → 0
 *   - "12pm" / "12 pm" / "12:00pm"        → 12
 *   - "1pm" / "1 pm" / "1:00 pm"          → 13
 *   - "11pm" / "11 pm"                    → 23
 *   - "1am" / "1 am"                      → 1
 *
 * Rejected:
 *   - empty string                        → { ok:false, error:"required" }
 *   - "123", "-1", "0.5", "1.5pm"         → invalid
 *   - random text                         → invalid
 *   - "13pm", "0am", "0pm"                → invalid (ambiguous / out of clock face)
 */
export function parseCmeHour(raw: string): ParsedCmeHour {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return { ok: false, error: "Cutoff hour is required." };

  // Pure integer path
  if (HOUR_INT_REGEX.test(trimmed)) {
    const n = Number(trimmed);
    if (n === 24) return { ok: true, hour: 0 };
    if (n >= 0 && n <= 23) return { ok: true, hour: n };
    return { ok: false, error: "Cutoff hour must be between 0 and 23." };
  }

  // 12-hour clock with am/pm
  const m = trimmed.match(TIME_AMPM_REGEX);
  if (m) {
    const h12 = Number(m[1]);
    const period = m[2].toLowerCase();
    if (h12 < 1 || h12 > 12) return { ok: false, error: "Hour must be 1–12 with AM/PM." };
    if (period === "am") return { ok: true, hour: h12 === 12 ? 0 : h12 };
    return { ok: true, hour: h12 === 12 ? 12 : h12 + 12 };
  }

  return { ok: false, error: "Enter an hour 0–23, or a time like 1pm, 4pm, 12am." };
}

/**
 * True when the integer is a valid CME hour (0..23).
 * Use after parseCmeHour() succeeds, or to validate a number that arrived
 * through some other path (e.g. an API request body).
 */
export function isValidCmeHour(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 23;
}

/**
 * Human-readable "1:00 PM CT" / "12:00 AM CT" label for an hour 0..23.
 * Returns an empty string for invalid input.
 */
export function formatCmeHourLabel(hour: number): string {
  if (!isValidCmeHour(hour)) return "";
  const period = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:00 ${period} CT`;
}

/**
 * Helper text for hours that fall on the CME daily/weekly boundary.
 * Returns null when no special note applies.
 *
 * 16:00 CT (4:00 PM) is the daily Globex maintenance break boundary
 * Mon–Thu and the weekly close on Friday. We don't know the user's intent
 * day-of-week here, so we surface both meanings so they can choose
 * deliberately.
 */
export function cmeHourBoundaryNote(hour: number): string | null {
  if (hour === 16) {
    return "4:00 PM CT is the CME daily break (Mon–Thu) and weekly close (Fri). Automatic cutoff enforcement is not active yet — this is saved configuration only.";
  }
  if (hour === 17) {
    return "5:00 PM CT is the CME session reopen (Sun–Thu). Trades before this reopens the market may not execute.";
  }
  return null;
}
