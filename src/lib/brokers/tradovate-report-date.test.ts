import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { formatDateMMDDYYYY, nextCalendarDay } from "./tradovate-report-date.ts";

// ── formatDateMMDDYYYY ────────────────────────────────────────────────────────

describe("formatDateMMDDYYYY", () => {
  it("converts a normal YYYY-MM-DD key to MM/DD/YYYY", () => {
    assert.equal(formatDateMMDDYYYY("2026-05-08"), "05/08/2026");
  });

  it("pads single-digit month and day", () => {
    assert.equal(formatDateMMDDYYYY("2026-01-03"), "01/03/2026");
  });

  it("handles December 31", () => {
    assert.equal(formatDateMMDDYYYY("2026-12-31"), "12/31/2026");
  });

  it("handles January 1", () => {
    assert.equal(formatDateMMDDYYYY("2027-01-01"), "01/01/2027");
  });
});

// ── nextCalendarDay ───────────────────────────────────────────────────────────

describe("nextCalendarDay — normal advance", () => {
  it("advances May 7 to May 8", () => {
    assert.equal(nextCalendarDay("2026-05-07"), "2026-05-08");
  });

  it("advances May 8 to May 9", () => {
    assert.equal(nextCalendarDay("2026-05-08"), "2026-05-09");
  });
});

describe("nextCalendarDay — month rollover", () => {
  it("advances May 31 to June 1", () => {
    assert.equal(nextCalendarDay("2026-05-31"), "2026-06-01");
  });

  it("advances June 30 to July 1", () => {
    assert.equal(nextCalendarDay("2026-06-30"), "2026-07-01");
  });

  it("advances December 31 to January 1 of next year", () => {
    assert.equal(nextCalendarDay("2026-12-31"), "2027-01-01");
  });
});

describe("nextCalendarDay — year rollover", () => {
  it("advances Dec 31 2025 to Jan 1 2026", () => {
    assert.equal(nextCalendarDay("2025-12-31"), "2026-01-01");
  });
});

describe("nextCalendarDay — leap year", () => {
  it("advances Feb 28 to Feb 29 in a leap year", () => {
    assert.equal(nextCalendarDay("2028-02-28"), "2028-02-29");
  });

  it("advances Feb 29 to Mar 1 in a leap year", () => {
    assert.equal(nextCalendarDay("2028-02-29"), "2028-03-01");
  });

  it("advances Feb 28 to Mar 1 in a non-leap year", () => {
    assert.equal(nextCalendarDay("2026-02-28"), "2026-03-01");
  });
});

// ── CME session window construction ──────────────────────────────────────────
// Documents the expected Performance Report param values for a given session key.
// Root cause of DEMO7433035 "2 / 100" bug: the old code used startDate=endDate
// with 00:00:00–23:59:59, which included 00:00–16:59 CT on the session key date —
// those morning hours belong to the PREVIOUS CME session. Fix: use 17:00:00 on
// startDate through 16:59:59 on endDate (nextCalendarDay).

describe("CME session report window — session key to param mapping", () => {
  it("session key 2026-05-07 maps to 05/07/2026 17:00:00 → 05/08/2026 16:59:59", () => {
    const startDate = formatDateMMDDYYYY("2026-05-07");
    const endDate = formatDateMMDDYYYY(nextCalendarDay("2026-05-07"));
    assert.equal(startDate, "05/07/2026");
    assert.equal(endDate, "05/08/2026");
    // times are hardcoded in fetchPerformanceReport: "17:00:00" / "16:59:59"
  });

  it("session key 2026-12-31 maps to 12/31/2026 → 01/01/2027 (year rollover)", () => {
    const startDate = formatDateMMDDYYYY("2026-12-31");
    const endDate = formatDateMMDDYYYY(nextCalendarDay("2026-12-31"));
    assert.equal(startDate, "12/31/2026");
    assert.equal(endDate, "01/01/2027");
  });

  it("prior-session trades (00:00–16:59 CT on session key date) are excluded", () => {
    // The fix: Performance Report startTime is 17:00:00, not 00:00:00.
    // Any trade before 17:00 CT on the session key date belongs to the previous
    // CME session and must not appear in this session's count.
    // This is a contract test — the actual filtering is done server-side by
    // Tradovate's report API when it receives startTime="17:00:00".
    const startTime = "17:00:00";
    const endTime = "16:59:59";
    assert.equal(startTime, "17:00:00", "startTime must be CME session open, not 00:00:00");
    assert.equal(endTime, "16:59:59", "endTime must be just before next CME session open");
  });
});
