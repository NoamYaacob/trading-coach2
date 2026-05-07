/**
 * Pure utility functions for trading session display.
 * Extracted into a .ts file so they can be unit-tested without JSX/tsx support.
 */

/** Converts "HH:mm" (24-hour) to "h:mm AM/PM" (12-hour) for display. */
export function fmt12h(hhmm: string): string {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return hhmm;
  let h = Number(m[1]);
  const min = m[2];
  const period = h < 12 ? "AM" : "PM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${min} ${period}`;
}

export function lockBufferStart12h(sessionStart: string, bufferMin: number): string {
  const m = sessionStart.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return sessionStart;
  const totalMin = Number(m[1]) * 60 + Number(m[2]) - bufferMin;
  const clamped = ((totalMin % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(clamped / 60);
  const min = String(clamped % 60).padStart(2, "0");
  return fmt12h(`${String(h).padStart(2, "0")}:${min}`);
}
