// Program/prop-firm profile rules. Models structural constraints (allowed
// products, hard daily cutoff, no-swing) so multiple firms can be added
// later. Topstep is the first profile, but no Topstep-specific copy is
// hard-coded — UI copy lives in product-validation.ts and uses the profile's
// `displayName`.

import {
  type ProductCategory,
  type ProductMetadata,
  type TimeOfDayCT,
  PRODUCTS,
} from "./trading-products.ts";

export type ProgramProfileId = "generic_futures" | "topstep_style";

export type ProgramProfile = {
  id: ProgramProfileId;
  displayName: string;
  /** Set of allowed product symbols. `null` means "any known futures product". */
  allowedSymbols: Set<string> | null;
  /** Hard flat-by time in Chicago time. `null` means no daily cutoff. */
  hardCutoffCT: TimeOfDayCT | null;
  /** Daily resume in Chicago time (when trading reopens after the cutoff). */
  resumeCT: TimeOfDayCT | null;
  /** Sunday session open (in Chicago time). `null` means no Sunday session. */
  sundayOpenCT: TimeOfDayCT | null;
  /** Categories that are disallowed regardless of symbol coverage. */
  blockedCategories: Set<ProductCategory>;
  /** Disallow holding positions overnight. */
  noSwing: boolean;
  /** "warn" surfaces issues without blocking save; "strict" can block. */
  blockingMode: "warn" | "strict";
};

// Topstep-allowed symbol set is the union of every product currently in the
// product catalog (catalog itself is built from the Topstep article).
const TOPSTEP_ALLOWED = new Set(Object.keys(PRODUCTS));

export const TOPSTEP_PROFILE: ProgramProfile = {
  id: "topstep_style",
  displayName: "Topstep-style",
  allowedSymbols: TOPSTEP_ALLOWED,
  hardCutoffCT: { hour: 15, minute: 10 },
  resumeCT: { hour: 17, minute: 0 },
  sundayOpenCT: { hour: 17, minute: 0 },
  blockedCategories: new Set<ProductCategory>(["forex_spot", "stock", "crypto"]),
  noSwing: true,
  blockingMode: "warn",
};

export const GENERIC_FUTURES_PROFILE: ProgramProfile = {
  id: "generic_futures",
  displayName: "Generic futures",
  allowedSymbols: null,
  hardCutoffCT: null,
  resumeCT: null,
  sundayOpenCT: null,
  blockedCategories: new Set<ProductCategory>(),
  noSwing: false,
  blockingMode: "warn",
};

export const PROFILES: Record<ProgramProfileId, ProgramProfile> = {
  generic_futures: GENERIC_FUTURES_PROFILE,
  topstep_style: TOPSTEP_PROFILE,
};

export const DEFAULT_PROGRAM_PROFILE: ProgramProfileId = "generic_futures";

export function getProfile(id: ProgramProfileId | null | undefined): ProgramProfile {
  if (!id) return PROFILES[DEFAULT_PROGRAM_PROFILE];
  return PROFILES[id] ?? PROFILES[DEFAULT_PROGRAM_PROFILE];
}

export function isSymbolAllowed(profile: ProgramProfile, symbol: string): boolean {
  if (profile.allowedSymbols === null) return true;
  return profile.allowedSymbols.has(symbol);
}

/**
 * Returns the effective daily cutoff for a (profile, product) combo: the
 * earlier of the program's hard cutoff and the product's known early close.
 */
export function getEffectiveCutoffCT(
  profile: ProgramProfile,
  product: ProductMetadata | null,
): TimeOfDayCT | null {
  const programCutoff = profile.hardCutoffCT;
  const productCutoff = product?.earlyCloseCT;
  if (!programCutoff && !productCutoff) return null;
  if (!programCutoff) return productCutoff!;
  if (!productCutoff) return programCutoff;
  return earlier(programCutoff, productCutoff);
}

/**
 * Returns the effective Sunday open for a (profile, product) combo: the later
 * of the program's Sunday open and the product's known Sunday open.
 */
export function getEffectiveSundayOpenCT(
  profile: ProgramProfile,
  product: ProductMetadata | null,
): TimeOfDayCT | null {
  const programOpen = profile.sundayOpenCT;
  const productOpen = product?.sundayOpenCT;
  if (!programOpen && !productOpen) return null;
  if (!programOpen) return productOpen!;
  if (!productOpen) return programOpen;
  return later(programOpen, productOpen);
}

// ── Time helpers (Chicago time) ─────────────────────────────────────────────

export function minutesFromMidnight(t: TimeOfDayCT): number {
  return t.hour * 60 + t.minute;
}

function earlier(a: TimeOfDayCT, b: TimeOfDayCT): TimeOfDayCT {
  return minutesFromMidnight(a) <= minutesFromMidnight(b) ? a : b;
}

function later(a: TimeOfDayCT, b: TimeOfDayCT): TimeOfDayCT {
  return minutesFromMidnight(a) >= minutesFromMidnight(b) ? a : b;
}

/**
 * Returns the Chicago-time view of a UTC date as `{ hour, minute, weekday }`.
 * Weekday is 0 (Sunday) through 6 (Saturday).
 */
export function toChicagoTime(date: Date): {
  hour: number;
  minute: number;
  weekday: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(date);

  const find = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  // hour can be "24" at midnight in en-US with hour12:false; normalize to 0.
  const rawHour = parseInt(find("hour"), 10);
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = parseInt(find("minute"), 10);
  const weekdayShort = find("weekday");
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return { hour, minute, weekday: weekdayMap[weekdayShort] ?? 0 };
}

export function formatTimeOfDayCT(t: TimeOfDayCT): string {
  const h12 = ((t.hour + 11) % 12) + 1;
  const ampm = t.hour < 12 ? "AM" : "PM";
  const mm = t.minute.toString().padStart(2, "0");
  return `${h12}:${mm} ${ampm} CT`;
}
