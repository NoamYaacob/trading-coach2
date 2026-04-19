"use client";

import { Fragment, useState } from "react";

type Option = {
  label: string;
  value: string;
};

type NumericPresetField = {
  mode: string;
  custom: string;
};

type MultiValueField =
  | "tradingDays"
  | "tradingSession"
  | "primaryChallenge"
  | "tiltTrigger"
  | "reviewFocus";

type BooleanField =
  | "premarketCheckinEnabled"
  | "postmarketReviewEnabled"
  | "newsAlertsEnabled"
  | "highImpactOnly";

type NumericPresetName = "accountSize" | "maxDailyLoss" | "riskPerTrade";

type TextFieldName =
  | "primaryMarket"
  | "tradingStyle"
  | "experienceYears"
  | "timezone"
  | "maxTradesPerDay"
  | "stopAfterLosses"
  | "primaryChallengeOther"
  | "tiltTriggerOther"
  | "tiltThought"
  | "tiltThoughtOther"
  | "coachingTone"
  | "interruptionStyle"
  | "responseStyle"
  | "preferredAddress"
  | "checkinFormat"
  | "reviewFocusOther"
  | "preNewsMinutes"
  | "economicCalendarProviderKey"
  | "economicCalendarStubScenario"
  | "preferredLanguage"
  | "tradingWhy"
  | "tradingGoal"
  | "groundingReminder";

type OnboardingFormState = {
  primaryMarket: string;
  tradingStyle: string;
  experienceYears: string;
  tradingDays: string[];
  tradingSession: string[];
  timezone: string;
  accountSize: NumericPresetField;
  maxDailyLoss: NumericPresetField;
  riskPerTrade: NumericPresetField;
  maxTradesPerDay: string;
  stopAfterLosses: string;
  primaryChallenge: string[];
  primaryChallengeOther: string;
  tiltTrigger: string[];
  tiltTriggerOther: string;
  tiltThought: string;
  tiltThoughtOther: string;
  coachingTone: string;
  interruptionStyle: string;
  responseStyle: string;
  preferredAddress: string;
  premarketCheckinEnabled: boolean;
  postmarketReviewEnabled: boolean;
  checkinFormat: string;
  reviewFocus: string[];
  reviewFocusOther: string;
  newsAlertsEnabled: boolean;
  preNewsMinutes: string;
  highImpactOnly: boolean;
  economicCalendarProviderKey: string;
  economicCalendarStubScenario: string;
  preferredLanguage: string;
  tradingWhy: string;
  tradingGoal: string;
  groundingReminder: string;
};

type Notice = {
  kind: "success" | "error";
  message: string;
};

const marketOptions: Option[] = [
  { label: "Futures", value: "FUTURES" },
  { label: "US Equities", value: "US_EQUITIES" },
  { label: "Forex", value: "FOREX" },
  { label: "Crypto", value: "CRYPTO" },
];

const tradingStyleOptions: Option[] = [
  { label: "Scalping", value: "scalping" },
  { label: "Momentum", value: "momentum" },
  { label: "Intraday", value: "intraday" },
  { label: "Swing", value: "swing" },
  { label: "Breakout", value: "breakout" },
];

const experienceOptions: Option[] = [
  { label: "Under 1 year", value: "0" },
  { label: "1-2 years", value: "1" },
  { label: "3-5 years", value: "3" },
  { label: "6-10 years", value: "6" },
  { label: "10+ years", value: "10" },
];

const tradingDayOptions: Option[] = [
  { label: "Monday", value: "Monday" },
  { label: "Tuesday", value: "Tuesday" },
  { label: "Wednesday", value: "Wednesday" },
  { label: "Thursday", value: "Thursday" },
  { label: "Friday", value: "Friday" },
];

const sessionOptions: Option[] = [
  { label: "Asia", value: "ASIA" },
  { label: "Overnight", value: "OVERNIGHT" },
  { label: "London", value: "LONDON" },
  { label: "Pre-market", value: "PREMARKET" },
  { label: "Europe / NY overlap", value: "EU_US_OVERLAP" },
  { label: "New York open", value: "NY_OPEN" },
  { label: "New York afternoon", value: "NY_AFTERNOON" },
  { label: "Midday", value: "MIDDAY" },
  { label: "Power hour", value: "POWER_HOUR" },
  { label: "After-hours", value: "AFTER_HOURS" },
  { label: "Late US", value: "LATE_US" },
];

const sessionVisibilityByMarket: Record<string, string[]> = {
  FUTURES: [
    "ASIA",
    "OVERNIGHT",
    "LONDON",
    "EU_US_OVERLAP",
    "NY_OPEN",
    "MIDDAY",
    "POWER_HOUR",
  ],
  US_EQUITIES: ["PREMARKET", "NY_OPEN", "MIDDAY", "POWER_HOUR", "AFTER_HOURS"],
  FOREX: ["ASIA", "LONDON", "NY_OPEN", "NY_AFTERNOON"],
  CRYPTO: ["ASIA", "LONDON", "NY_OPEN", "MIDDAY", "POWER_HOUR", "LATE_US"],
};

const sessionDefinitionsByMarket: Record<
  string,
  Record<string, { start: string; end: string }>
> = {
  FUTURES: {
    ASIA: { start: "18:00", end: "00:00" },
    OVERNIGHT: { start: "00:00", end: "02:00" },
    LONDON: { start: "02:00", end: "08:00" },
    EU_US_OVERLAP: { start: "08:00", end: "09:30" },
    NY_OPEN: { start: "09:30", end: "11:00" },
    MIDDAY: { start: "11:00", end: "14:00" },
    POWER_HOUR: { start: "14:00", end: "16:00" },
  },
  US_EQUITIES: {
    PREMARKET: { start: "04:00", end: "09:30" },
    NY_OPEN: { start: "09:30", end: "11:00" },
    MIDDAY: { start: "11:00", end: "15:00" },
    POWER_HOUR: { start: "15:00", end: "16:00" },
    AFTER_HOURS: { start: "16:00", end: "20:00" },
  },
  FOREX: {
    ASIA: { start: "19:00", end: "04:00" },
    LONDON: { start: "03:00", end: "12:00" },
    NY_OPEN: { start: "08:00", end: "12:00" },
    NY_AFTERNOON: { start: "12:00", end: "17:00" },
  },
  CRYPTO: {
    ASIA: { start: "00:00", end: "08:00" },
    LONDON: { start: "08:00", end: "12:00" },
    NY_OPEN: { start: "12:00", end: "16:00" },
    MIDDAY: { start: "16:00", end: "20:00" },
    POWER_HOUR: { start: "20:00", end: "22:00" },
    LATE_US: { start: "22:00", end: "00:00" },
  },
};

const timezoneOptions: Option[] = [
  { label: "UTC", value: "UTC" },
  { label: "Africa/Casablanca", value: "Africa/Casablanca" },
  { label: "Africa/Cairo", value: "Africa/Cairo" },
  { label: "Africa/Lagos", value: "Africa/Lagos" },
  { label: "Africa/Nairobi", value: "Africa/Nairobi" },
  { label: "Africa/Johannesburg", value: "Africa/Johannesburg" },
  { label: "America/Anchorage", value: "America/Anchorage" },
  { label: "America/Argentina/Buenos_Aires", value: "America/Argentina/Buenos_Aires" },
  { label: "America/Bogota", value: "America/Bogota" },
  { label: "America/Caracas", value: "America/Caracas" },
  { label: "America/Chicago", value: "America/Chicago" },
  { label: "America/Edmonton", value: "America/Edmonton" },
  { label: "America/Denver", value: "America/Denver" },
  { label: "America/Halifax", value: "America/Halifax" },
  { label: "America/Lima", value: "America/Lima" },
  { label: "America/Los_Angeles", value: "America/Los_Angeles" },
  { label: "America/Montevideo", value: "America/Montevideo" },
  { label: "America/Mexico_City", value: "America/Mexico_City" },
  { label: "America/New_York", value: "America/New_York" },
  { label: "America/Panama", value: "America/Panama" },
  { label: "America/Phoenix", value: "America/Phoenix" },
  { label: "America/Santiago", value: "America/Santiago" },
  { label: "America/Sao_Paulo", value: "America/Sao_Paulo" },
  { label: "America/Toronto", value: "America/Toronto" },
  { label: "America/Vancouver", value: "America/Vancouver" },
  { label: "Asia/Bangkok", value: "Asia/Bangkok" },
  { label: "Asia/Colombo", value: "Asia/Colombo" },
  { label: "Asia/Dubai", value: "Asia/Dubai" },
  { label: "Asia/Ho_Chi_Minh", value: "Asia/Ho_Chi_Minh" },
  { label: "Asia/Hong_Kong", value: "Asia/Hong_Kong" },
  { label: "Asia/Jakarta", value: "Asia/Jakarta" },
  { label: "Asia/Jerusalem", value: "Asia/Jerusalem" },
  { label: "Asia/Kolkata", value: "Asia/Kolkata" },
  { label: "Asia/Kuala_Lumpur", value: "Asia/Kuala_Lumpur" },
  { label: "Asia/Manila", value: "Asia/Manila" },
  { label: "Asia/Riyadh", value: "Asia/Riyadh" },
  { label: "Asia/Seoul", value: "Asia/Seoul" },
  { label: "Asia/Shanghai", value: "Asia/Shanghai" },
  { label: "Asia/Singapore", value: "Asia/Singapore" },
  { label: "Asia/Tokyo", value: "Asia/Tokyo" },
  { label: "Australia/Adelaide", value: "Australia/Adelaide" },
  { label: "Australia/Brisbane", value: "Australia/Brisbane" },
  { label: "Australia/Melbourne", value: "Australia/Melbourne" },
  { label: "Australia/Perth", value: "Australia/Perth" },
  { label: "Australia/Sydney", value: "Australia/Sydney" },
  { label: "Europe/Amsterdam", value: "Europe/Amsterdam" },
  { label: "Europe/Athens", value: "Europe/Athens" },
  { label: "Europe/Berlin", value: "Europe/Berlin" },
  { label: "Europe/Brussels", value: "Europe/Brussels" },
  { label: "Europe/Bucharest", value: "Europe/Bucharest" },
  { label: "Europe/Copenhagen", value: "Europe/Copenhagen" },
  { label: "Europe/Dublin", value: "Europe/Dublin" },
  { label: "Europe/Helsinki", value: "Europe/Helsinki" },
  { label: "Europe/Lisbon", value: "Europe/Lisbon" },
  { label: "Europe/London", value: "Europe/London" },
  { label: "Europe/Madrid", value: "Europe/Madrid" },
  { label: "Europe/Moscow", value: "Europe/Moscow" },
  { label: "Europe/Oslo", value: "Europe/Oslo" },
  { label: "Europe/Paris", value: "Europe/Paris" },
  { label: "Europe/Prague", value: "Europe/Prague" },
  { label: "Europe/Rome", value: "Europe/Rome" },
  { label: "Europe/Stockholm", value: "Europe/Stockholm" },
  { label: "Europe/Vienna", value: "Europe/Vienna" },
  { label: "Pacific/Fiji", value: "Pacific/Fiji" },
  { label: "Pacific/Auckland", value: "Pacific/Auckland" },
  { label: "Pacific/Guam", value: "Pacific/Guam" },
  { label: "Pacific/Honolulu", value: "Pacific/Honolulu" },
  { label: "Pacific/Port_Moresby", value: "Pacific/Port_Moresby" },
];

const accountSizeOptions: Option[] = [
  { label: "$5k", value: "5000" },
  { label: "$10k", value: "10000" },
  { label: "$25k", value: "25000" },
  { label: "$50k", value: "50000" },
  { label: "$100k", value: "100000" },
  { label: "Custom", value: "custom" },
];

const dailyLossOptions: Option[] = [
  { label: "$100", value: "100" },
  { label: "$250", value: "250" },
  { label: "$500", value: "500" },
  { label: "$750", value: "750" },
  { label: "$1,000", value: "1000" },
  { label: "Custom", value: "custom" },
];

const riskPerTradeOptions: Option[] = [
  { label: "$25", value: "25" },
  { label: "$50", value: "50" },
  { label: "$100", value: "100" },
  { label: "$150", value: "150" },
  { label: "$200", value: "200" },
  { label: "Custom", value: "custom" },
];

const maxTradesOptions: Option[] = [
  { label: "1", value: "1" },
  { label: "2", value: "2" },
  { label: "3", value: "3" },
  { label: "4", value: "4" },
  { label: "5", value: "5" },
  { label: "6+", value: "6" },
];

const stopAfterLossesOptions: Option[] = [
  { label: "1 loss", value: "1" },
  { label: "2 losses", value: "2" },
  { label: "3 losses", value: "3" },
  { label: "4 losses", value: "4" },
];

const primaryChallengeOptions: Option[] = [
  { label: "Revenge trading", value: "Revenge trading" },
  { label: "Overtrading", value: "Overtrading" },
  { label: "FOMO", value: "FOMO" },
  { label: "Cutting winners early", value: "Cutting winners early" },
  { label: "Holding losers too long", value: "Holding losers too long" },
  { label: "Hesitation", value: "Hesitation" },
  { label: "Other", value: "Other" },
];

const tiltTriggerOptions: Option[] = [
  { label: "Two losses in a row", value: "Two losses in a row" },
  { label: "Missing a move", value: "Missing a move" },
  { label: "Giving back profits", value: "Giving back profits" },
  { label: "News volatility", value: "News volatility" },
  { label: "Choppy market", value: "Choppy market" },
  { label: "External stress", value: "External stress" },
  { label: "Other", value: "Other" },
];

const tiltThoughtOptions: Option[] = [
  { label: "I need to make it back now", value: "I need to make it back now" },
  { label: "I can’t miss this move", value: "I can’t miss this move" },
  { label: "One more trade will fix it", value: "One more trade will fix it" },
  { label: "I’m trading badly today", value: "I’m trading badly today" },
  { label: "I need to prove I’m right", value: "I need to prove I’m right" },
  { label: "Other", value: "Other" },
];

const coachingToneOptions: Option[] = [
  { label: "Calm", value: "Calm" },
  { label: "Direct", value: "Direct" },
  { label: "Supportive", value: "Supportive" },
  { label: "Tough-love", value: "Tough-love" },
];

const interruptionStyleOptions: Option[] = [
  { label: "Gentle pause", value: "Gentle pause" },
  { label: "Pattern interrupt", value: "Pattern interrupt" },
  { label: "Ask a question", value: "Ask a question" },
  { label: "Hard stop reminder", value: "Hard stop reminder" },
];

const responseStyleOptions: Option[] = [
  { label: "One-line prompts", value: "One-line prompts" },
  { label: "Short bullets", value: "Short bullets" },
  { label: "Reflective questions", value: "Reflective questions" },
  { label: "Action checklist", value: "Action checklist" },
];

const checkinFormatOptions: Option[] = [
  { label: "Bullet prompts", value: "Bullet prompts" },
  { label: "Quick checklist", value: "Quick checklist" },
  { label: "Short conversation", value: "Short conversation" },
];

const reviewFocusOptions: Option[] = [
  { label: "Execution quality", value: "Execution quality" },
  { label: "Rule adherence", value: "Rule adherence" },
  { label: "Emotional control", value: "Emotional control" },
  { label: "Risk discipline", value: "Risk discipline" },
  { label: "Missed opportunities", value: "Missed opportunities" },
  { label: "Other", value: "Other" },
];

const preNewsMinutesOptions: Option[] = [
  { label: "5 minutes", value: "5" },
  { label: "10 minutes", value: "10" },
  { label: "15 minutes", value: "15" },
  { label: "30 minutes", value: "30" },
  { label: "60 minutes", value: "60" },
];

const economicCalendarProviderOptions: Option[] = [
  { label: "Demo calendar feed", value: "mock" },
  { label: "TradingEconomics-ready feed", value: "tradingeconomics_stub" },
];

const economicCalendarStubScenarioOptions: Option[] = [
  { label: "Mixed session day", value: "mixed_day" },
  { label: "Quiet news day", value: "quiet" },
  { label: "Major event later", value: "upcoming_high_impact" },
  { label: "Pre-news caution window", value: "caution_window" },
  { label: "Start blocked by major event", value: "blocked_major_event" },
  { label: "Post-event discipline window", value: "passed_event" },
];

const languageOptions: Option[] = [
  { label: "עברית (Hebrew)", value: "he" },
  { label: "English", value: "en" },
  { label: "Español", value: "es" },
  { label: "Français", value: "fr" },
  { label: "Deutsch", value: "de" },
  { label: "Русский", value: "ru" },
  { label: "العربية (Arabic)", value: "ar" },
];

const preferredAddressOptions: Option[] = [
  { label: "Masculine", value: "MASCULINE" },
  { label: "Feminine", value: "FEMININE" },
  { label: "Neutral", value: "NEUTRAL" },
  { label: "No preference", value: "NO_PREFERENCE" },
];

const newUserDefaults: OnboardingFormState = {
  primaryMarket: "FUTURES",
  tradingStyle: "",
  experienceYears: "",
  tradingDays: [],
  tradingSession: [],
  timezone: "UTC",
  accountSize: { mode: "50000", custom: "" },
  maxDailyLoss: { mode: "500", custom: "" },
  riskPerTrade: { mode: "100", custom: "" },
  maxTradesPerDay: "3",
  stopAfterLosses: "2",
  primaryChallenge: [],
  primaryChallengeOther: "",
  tiltTrigger: [],
  tiltTriggerOther: "",
  tiltThought: "",
  tiltThoughtOther: "",
  coachingTone: "Direct",
  interruptionStyle: "",
  responseStyle: "",
  preferredAddress: "",
  premarketCheckinEnabled: false,
  postmarketReviewEnabled: false,
  checkinFormat: "",
  reviewFocus: [],
  reviewFocusOther: "",
  newsAlertsEnabled: false,
  preNewsMinutes: "",
  highImpactOnly: false,
  economicCalendarProviderKey: "mock",
  economicCalendarStubScenario: "mixed_day",
  preferredLanguage: "he",
  tradingWhy: "",
  tradingGoal: "",
  groundingReminder: "",
};

export type SavedOnboardingData = {
  traderProfile: {
    primaryMarket: string | null;
    tradingStyle: string | null;
    experienceYears: number | null;
    tradingDays: string | null;
    tradingSession: string | null;
    timezone: string | null;
  } | null;
  riskRules: {
    accountSize: string | null;
    maxDailyLoss: string | null;
    riskPerTrade: string | null;
    maxTradesPerDay: number | null;
    stopAfterLosses: number | null;
  } | null;
  mentalProfile: {
    primaryChallenge: string | null;
    tiltTrigger: string | null;
    tiltThought: string | null;
    coachingTone: string | null;
    interruptionStyle: string | null;
    responseStyle: string | null;
    tradingWhy: string | null;
    tradingGoal: string | null;
    groundingReminder: string | null;
    preferredAddress: string | null;
  } | null;
  coachingPreferences: {
    premarketCheckinEnabled: boolean;
    postmarketReviewEnabled: boolean;
    checkinFormat: string | null;
    reviewFocus: string | null;
    newsAlertsEnabled: boolean;
    preNewsMinutes: number | null;
    highImpactOnly: boolean;
    economicCalendarProviderKey: string | null;
    economicCalendarStubScenario: string | null;
    preferredLanguage: string | null;
  } | null;
};

function splitPipeDelimited(value: string | null | undefined): string[] {
  if (!value) return [];
  return value.split(" | ").map((s) => s.trim()).filter(Boolean);
}

function toNumericPreset(value: string | null | undefined, options: Option[]): NumericPresetField {
  if (!value) return { mode: "", custom: "" };
  const presetValues = options.filter((o) => o.value !== "custom").map((o) => o.value);
  if (presetValues.includes(value)) return { mode: value, custom: "" };
  return { mode: "custom", custom: value };
}

function splitChipsAndOther(
  value: string | null | undefined,
  options: Option[],
): { chips: string[]; other: string } {
  const parts = splitPipeDelimited(value);
  const knownValues = new Set(options.filter((o) => o.value !== "Other").map((o) => o.value));
  const chips: string[] = [];
  const otherParts: string[] = [];

  for (const part of parts) {
    if (knownValues.has(part)) {
      chips.push(part);
    } else {
      otherParts.push(part);
    }
  }

  if (otherParts.length > 0) chips.push("Other");
  return { chips, other: otherParts.join(", ") };
}

function resolveSelectWithOther(
  value: string | null | undefined,
  options: Option[],
): { selected: string; other: string } {
  if (!value) return { selected: "", other: "" };
  const knownValues = new Set(options.filter((o) => o.value !== "Other").map((o) => o.value));
  if (knownValues.has(value)) return { selected: value, other: "" };
  return { selected: "Other", other: value };
}

function buildInitialState(saved?: SavedOnboardingData): OnboardingFormState {
  if (!saved) return newUserDefaults;

  const tp = saved.traderProfile;
  const rr = saved.riskRules;
  const mp = saved.mentalProfile;
  const cp = saved.coachingPreferences;

  const primaryChallenge = splitChipsAndOther(mp?.primaryChallenge, primaryChallengeOptions);
  const tiltTrigger = splitChipsAndOther(mp?.tiltTrigger, tiltTriggerOptions);
  const tiltThought = resolveSelectWithOther(mp?.tiltThought, tiltThoughtOptions);
  const reviewFocus = splitChipsAndOther(cp?.reviewFocus, reviewFocusOptions);

  return {
    primaryMarket: tp?.primaryMarket ?? "",
    tradingStyle: tp?.tradingStyle ?? "",
    experienceYears: tp?.experienceYears != null ? String(tp.experienceYears) : "",
    tradingDays: splitPipeDelimited(tp?.tradingDays),
    tradingSession: splitPipeDelimited(tp?.tradingSession),
    timezone: tp?.timezone ?? "UTC",
    accountSize: toNumericPreset(rr?.accountSize, accountSizeOptions),
    maxDailyLoss: toNumericPreset(rr?.maxDailyLoss, dailyLossOptions),
    riskPerTrade: toNumericPreset(rr?.riskPerTrade, riskPerTradeOptions),
    maxTradesPerDay: rr?.maxTradesPerDay != null ? String(rr.maxTradesPerDay) : "",
    stopAfterLosses: rr?.stopAfterLosses != null ? String(rr.stopAfterLosses) : "",
    primaryChallenge: primaryChallenge.chips,
    primaryChallengeOther: primaryChallenge.other,
    tiltTrigger: tiltTrigger.chips,
    tiltTriggerOther: tiltTrigger.other,
    tiltThought: tiltThought.selected,
    tiltThoughtOther: tiltThought.other,
    coachingTone: mp?.coachingTone ?? "",
    interruptionStyle: mp?.interruptionStyle ?? "",
    responseStyle: mp?.responseStyle ?? "",
    preferredAddress: mp?.preferredAddress ?? "",
    premarketCheckinEnabled: cp?.premarketCheckinEnabled ?? false,
    postmarketReviewEnabled: cp?.postmarketReviewEnabled ?? false,
    checkinFormat: cp?.checkinFormat ?? "",
    reviewFocus: reviewFocus.chips,
    reviewFocusOther: reviewFocus.other,
    newsAlertsEnabled: cp?.newsAlertsEnabled ?? false,
    preNewsMinutes: cp?.preNewsMinutes != null ? String(cp.preNewsMinutes) : "",
    highImpactOnly: cp?.highImpactOnly ?? false,
    economicCalendarProviderKey: cp?.economicCalendarProviderKey ?? "mock",
    economicCalendarStubScenario: cp?.economicCalendarStubScenario ?? "mixed_day",
    preferredLanguage: cp?.preferredLanguage ?? "he",
    tradingWhy: mp?.tradingWhy ?? "",
    tradingGoal: mp?.tradingGoal ?? "",
    groundingReminder: mp?.groundingReminder ?? "",
  };
}

function ensureArray(values: unknown): string[] {
  return Array.isArray(values)
    ? values.filter((value): value is string => typeof value === "string")
    : [];
}

function parseTimeToUtcDate(time: string, dayOffset = 0) {
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(Date.UTC(2024, 0, 15 + dayOffset, hours + 5, minutes));
}

function formatTimeInTimezone(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(date);
}

function getSessionDescription(
  market: string,
  sessionKey: string,
  timezone: string,
) {
  const session = sessionDefinitionsByMarket[market]?.[sessionKey];

  if (!session) {
    return null;
  }

  const [startHours, startMinutes] = session.start.split(":").map(Number);
  const [endHours, endMinutes] = session.end.split(":").map(Number);
  const endDayOffset =
    endHours < startHours || (endHours === startHours && endMinutes <= startMinutes)
      ? 1
      : 0;

  const startDate = parseTimeToUtcDate(session.start);
  const endDate = parseTimeToUtcDate(session.end, endDayOffset);

  return `${formatTimeInTimezone(startDate, timezone)}-${formatTimeInTimezone(
    endDate,
    timezone,
  )} local time`;
}

function getVisibleSessionOptions(market: string, timezone: string) {
  const visibleKeys = sessionVisibilityByMarket[market] ?? [];
  const marketSpecificLabels: Record<string, Record<string, string>> = {
    US_EQUITIES: {
      PREMARKET: "US pre-market",
      NY_OPEN: "New York open",
      MIDDAY: "US midday",
      POWER_HOUR: "US power hour",
      AFTER_HOURS: "US after-hours",
    },
    FUTURES: {
      ASIA: "Asia",
      OVERNIGHT: "US overnight",
      LONDON: "London",
      EU_US_OVERLAP: "Europe / NY overlap",
      NY_OPEN: "New York open",
      MIDDAY: "US midday",
      POWER_HOUR: "US power hour",
    },
    FOREX: {
      ASIA: "Asia",
      LONDON: "London",
      NY_OPEN: "New York open",
      NY_AFTERNOON: "New York afternoon",
    },
    CRYPTO: {
      ASIA: "Asia",
      LONDON: "London",
      NY_OPEN: "New York open",
      MIDDAY: "US midday",
      POWER_HOUR: "US power hour",
      LATE_US: "Late US",
    },
  };

  return sessionOptions
    .filter((option) => visibleKeys.includes(option.value))
    .map((option) => ({
      ...option,
      label: marketSpecificLabels[market]?.[option.value] ?? option.label,
      description: getSessionDescription(market, option.value, timezone),
    }));
}

function parseOptionalNumber(value: string) {
  if (!value.trim()) {
    return undefined;
  }

  return Number(value);
}

function serializeMultiValue(values: unknown, other?: string) {
  const normalized = ensureArray(values).filter(
    (value) => value.trim() && value !== "Other",
  );
  const withOther = other?.trim() ? [...normalized, other.trim()] : normalized;
  return withOther.join(" | ");
}

function getNumericValue(field: NumericPresetField) {
  return parseOptionalNumber(field.mode === "custom" ? field.custom : field.mode);
}

type TextFieldProps = {
  label: string;
  name: TextFieldName;
  value: string;
  onChange: (name: TextFieldName, value: string) => void;
  type?: "text" | "email" | "number";
  placeholder?: string;
  disabled?: boolean;
};

function TextField({
  label,
  name,
  value,
  onChange,
  type = "text",
  placeholder,
  disabled = false,
}: TextFieldProps) {
  return (
    <label className={`grid gap-2 ${disabled ? "opacity-50" : ""}`}>
      <span className="text-sm font-medium text-stone-800">{label}</span>
      <input
        type={type}
        name={name}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(name, event.target.value)}
        className="h-11 rounded-xl border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-200 disabled:cursor-not-allowed"
      />
    </label>
  );
}

function TextareaField({
  label,
  name,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  name: TextFieldName;
  value: string;
  onChange: (name: TextFieldName, value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium text-stone-800">{label}</span>
      <textarea
        name={name}
        value={value}
        rows={2}
        placeholder={placeholder}
        onChange={(e) => onChange(name, e.target.value)}
        className="rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-200 resize-none"
      />
    </label>
  );
}

type SelectFieldProps = {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
  helperText?: string;
};

function SelectField({
  label,
  value,
  options,
  onChange,
  disabled = false,
  helperText,
}: SelectFieldProps) {
  const safeOptions = Array.isArray(options) ? options : [];

  return (
    <label className={`grid gap-2 ${disabled ? "opacity-50" : ""}`}>
      <span className="text-sm font-medium text-stone-800">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 rounded-xl border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-200 disabled:cursor-not-allowed"
      >
        {safeOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {helperText ? (
        <span className="text-xs leading-5 text-stone-500">{helperText}</span>
      ) : null}
    </label>
  );
}

type ToggleFieldProps = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
};

function ToggleField({
  label,
  checked,
  onChange,
  disabled = false,
}: ToggleFieldProps) {
  return (
    <label
      className={`flex items-center justify-between gap-4 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 ${
        disabled ? "opacity-50" : ""
      }`}
    >
      <span className="text-sm font-medium text-stone-800">{label}</span>
      <button
        type="button"
        aria-pressed={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-7 w-12 items-center rounded-full transition ${
          checked ? "bg-amber-600" : "bg-stone-300"
        } ${disabled ? "cursor-not-allowed" : ""}`}
      >
        <span
          className={`ml-1 h-5 w-5 rounded-full bg-white transition ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </label>
  );
}

type ChipGroupProps = {
  label: string;
  options: Array<Option & { description?: string | null }>;
  selected: string[];
  onToggle: (value: string) => void;
  disabled?: boolean;
};

function ChipGroup({
  label,
  options,
  selected,
  onToggle,
  disabled = false,
}: ChipGroupProps) {
  const safeSelected = ensureArray(selected);

  return (
    <div className={`grid gap-2 ${disabled ? "opacity-50" : ""}`}>
      <span className="text-sm font-medium text-stone-800">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = safeSelected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              onClick={() => onToggle(option.value)}
              className={`rounded-full border px-3 py-2 text-sm transition ${
                active
                  ? "border-stone-950 bg-stone-950 text-white"
                  : "border-stone-300 bg-white text-stone-700 hover:border-stone-400"
              } ${disabled ? "cursor-not-allowed" : ""}`}
            >
              <span>{option.label}</span>
              {option.description ? (
                <span className="ml-2 text-xs opacity-75">{option.description}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type SegmentedControlProps = {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
};

function SegmentedControl({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: SegmentedControlProps) {
  return (
    <div className={`grid gap-2 ${disabled ? "opacity-50" : ""}`}>
      <span className="text-sm font-medium text-stone-800">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={`rounded-full border px-3 py-2 text-sm transition ${
                active
                  ? "border-amber-600 bg-amber-50 text-amber-900"
                  : "border-stone-300 bg-white text-stone-700 hover:border-stone-400"
              } ${disabled ? "cursor-not-allowed" : ""}`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type NumericPresetProps = {
  label: string;
  field: NumericPresetField;
  options: Option[];
  onModeChange: (value: string) => void;
  onCustomChange: (value: string) => void;
  placeholder: string;
};

function NumericPresetFieldControl({
  label,
  field,
  options,
  onModeChange,
  onCustomChange,
  placeholder,
}: NumericPresetProps) {
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium text-stone-800">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = field.mode === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onModeChange(option.value)}
              className={`rounded-full border px-3 py-2 text-sm transition ${
                active
                  ? "border-stone-950 bg-stone-950 text-white"
                  : "border-stone-300 bg-white text-stone-700 hover:border-stone-400"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {field.mode === "custom" ? (
        <input
          type="number"
          value={field.custom}
          onChange={(event) => onCustomChange(event.target.value)}
          placeholder={placeholder}
          className="h-11 rounded-xl border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-200"
        />
      ) : null}
    </div>
  );
}

const STEP_TITLES = [
  "Trader identity",
  "Discipline profile",
  "Motivation",
  "Protection rules",
  "Advanced & coaching",
] as const;

type OnboardingFormProps = {
  userEmail: string;
  savedData?: SavedOnboardingData;
};

export function OnboardingForm({ userEmail, savedData }: OnboardingFormProps) {
  const [form, setForm] = useState<OnboardingFormState>(() => buildInitialState(savedData));
  const [notice, setNotice] = useState<Notice | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLinkingTelegram, setIsLinkingTelegram] = useState(false);
  const [didSave, setDidSave] = useState(false);
  const [telegramLink, setTelegramLink] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const visibleSessionOptions = getVisibleSessionOptions(
    form.primaryMarket,
    form.timezone,
  );

  function goNext() {
    setCurrentStep((s) => Math.min(s + 1, STEP_TITLES.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goBack() {
    setCurrentStep((s) => Math.max(s - 1, 0));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateTextField(name: TextFieldName, value: string) {
    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function updatePrimaryMarket(value: string) {
    setForm((current) => {
      const allowedSessions = sessionVisibilityByMarket[value] ?? [];
      const currentSessions = ensureArray(current.tradingSession);

      return {
        ...current,
        primaryMarket: value,
        tradingSession: currentSessions.filter((session) =>
          allowedSessions.includes(session),
        ),
      };
    });
  }

  function updateBooleanField(name: BooleanField, checked: boolean) {
    setForm((current) => ({
      ...current,
      [name]: checked,
    }));
  }

  function updateNumericField(name: NumericPresetName, patch: Partial<NumericPresetField>) {
    setForm((current) => ({
      ...current,
      [name]: {
        ...current[name],
        ...patch,
      },
    }));
  }

  function toggleMultiValue(name: MultiValueField, value: string) {
    setForm((current) => {
      const values = ensureArray(current[name]);
      const nextValues = values.includes(value)
        ? values.filter((item) => item !== value)
        : [...values, value];

      const patch: Partial<OnboardingFormState> = {
        [name]: nextValues,
      };

      if (name === "primaryChallenge" && !nextValues.includes("Other")) {
        patch.primaryChallengeOther = "";
      }

      if (name === "tiltTrigger" && !nextValues.includes("Other")) {
        patch.tiltTriggerOther = "";
      }

      if (name === "reviewFocus" && !nextValues.includes("Other")) {
        patch.reviewFocusOther = "";
      }

      return {
        ...current,
        ...patch,
      };
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setNotice(null);
    setDidSave(false);
    setTelegramLink(null);

    const payload = {
      traderProfile: {
        primaryMarket: form.primaryMarket,
        tradingStyle: form.tradingStyle,
        experienceYears: parseOptionalNumber(form.experienceYears),
        tradingDays: serializeMultiValue(form.tradingDays),
        tradingSession: serializeMultiValue(form.tradingSession),
        timezone: timezoneOptions.some((option) => option.value === form.timezone)
          ? form.timezone
          : "UTC",
      },
      riskRules: {
        accountSize: getNumericValue(form.accountSize),
        maxDailyLoss: getNumericValue(form.maxDailyLoss),
        riskPerTrade: getNumericValue(form.riskPerTrade),
        maxTradesPerDay: parseOptionalNumber(form.maxTradesPerDay),
        stopAfterLosses: parseOptionalNumber(form.stopAfterLosses),
      },
      mentalProfile: {
        primaryChallenge: serializeMultiValue(
          form.primaryChallenge,
          form.primaryChallengeOther,
        ),
        tiltTrigger: serializeMultiValue(form.tiltTrigger, form.tiltTriggerOther),
        tiltThought:
          form.tiltThought === "Other"
            ? form.tiltThoughtOther.trim()
            : form.tiltThought,
        coachingTone: form.coachingTone,
        interruptionStyle: form.interruptionStyle,
        responseStyle: form.responseStyle,
        preferredAddress: form.preferredAddress || undefined,
        tradingWhy: form.tradingWhy.trim() || undefined,
        tradingGoal: form.tradingGoal.trim() || undefined,
        groundingReminder: form.groundingReminder.trim() || undefined,
      },
      coachingPreferences: {
        premarketCheckinEnabled: form.premarketCheckinEnabled,
        postmarketReviewEnabled: form.postmarketReviewEnabled,
        checkinFormat: form.checkinFormat,
        reviewFocus: serializeMultiValue(form.reviewFocus, form.reviewFocusOther),
        newsAlertsEnabled: form.newsAlertsEnabled,
        preNewsMinutes: parseOptionalNumber(form.preNewsMinutes),
        highImpactOnly: form.highImpactOnly,
        economicCalendarProviderKey: form.economicCalendarProviderKey,
        economicCalendarStubScenario: form.economicCalendarStubScenario,
        preferredLanguage: form.preferredLanguage,
      },
    };

    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(result.error ?? "Failed to save onboarding.");
      }

      setDidSave(true);
      setNotice({
        kind: "success",
        message: "Onboarding saved successfully. You can now connect Telegram.",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Failed to save onboarding.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleConnectTelegram() {
    setIsLinkingTelegram(true);
    setNotice(null);

    try {
      const response = await fetch("/api/telegram/link-token", {
        method: "POST",
      });

      const result = (await response.json()) as {
        error?: string;
        telegramLink?: string | null;
      };

      if (!response.ok) {
        throw new Error(result.error ?? "Failed to create Telegram link.");
      }

      if (!result.telegramLink) {
        throw new Error(
          "Telegram bot username is not configured yet. Set TELEGRAM_BOT_USERNAME and try again.",
        );
      }

      setTelegramLink(result.telegramLink);
      setNotice({
        kind: "success",
        message: "Telegram link is ready. Open the bot to complete the connection.",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to create Telegram link.",
      });
    } finally {
      setIsLinkingTelegram(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">

      {/* ── Stepper ── */}
      <div>
        <div className="flex items-center">
          {STEP_TITLES.map((_, i) => (
            <Fragment key={i}>
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                  i < currentStep
                    ? "bg-amber-600 text-white"
                    : i === currentStep
                      ? "bg-stone-950 text-white"
                      : "bg-stone-100 text-stone-400"
                }`}
              >
                {i < currentStep ? "✓" : i + 1}
              </div>
              {i < STEP_TITLES.length - 1 && (
                <div
                  className={`h-px flex-1 transition-colors ${
                    i < currentStep ? "bg-amber-600" : "bg-stone-200"
                  }`}
                />
              )}
            </Fragment>
          ))}
        </div>
        <div className="mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-400">
            Step {currentStep + 1} of {STEP_TITLES.length}
          </p>
          <p className="mt-0.5 text-lg font-semibold text-stone-950">
            {STEP_TITLES[currentStep]}
          </p>
        </div>
      </div>

      {/* ── Step content card ── */}
      <div className="rounded-2xl border border-stone-200 bg-white p-5 sm:p-6">
        <div className="mb-5 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
          Signed in as <span className="font-medium text-stone-950">{userEmail}</span>
        </div>

        {/* Step 1: Trader identity */}
        {currentStep === 0 && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Preferred language"
                value={form.preferredLanguage}
                options={languageOptions}
                onChange={(value) => updateTextField("preferredLanguage", value)}
              />
              <SelectField
                label="Primary market"
                value={form.primaryMarket}
                options={marketOptions}
                onChange={updatePrimaryMarket}
              />
              <SelectField
                label="Trading style"
                value={form.tradingStyle}
                options={tradingStyleOptions}
                onChange={(value) => updateTextField("tradingStyle", value)}
              />
            </div>
            <div className="grid gap-4">
              <SegmentedControl
                label="Coaching tone"
                value={form.coachingTone}
                options={coachingToneOptions}
                onChange={(value) => updateTextField("coachingTone", value)}
              />
              <SegmentedControl
                label="Interruption style"
                value={form.interruptionStyle}
                options={interruptionStyleOptions}
                onChange={(value) => updateTextField("interruptionStyle", value)}
              />
              <SegmentedControl
                label="Response style"
                value={form.responseStyle}
                options={responseStyleOptions}
                onChange={(value) => updateTextField("responseStyle", value)}
              />
              <SegmentedControl
                label="Preferred form of address"
                value={form.preferredAddress}
                options={preferredAddressOptions}
                onChange={(value) => updateTextField("preferredAddress", value)}
              />
            </div>
          </div>
        )}

        {/* Step 2: Discipline profile */}
        {currentStep === 1 && (
          <div className="space-y-4">
            <ChipGroup
              label="Primary challenge"
              options={primaryChallengeOptions}
              selected={ensureArray(form.primaryChallenge)}
              onToggle={(value) => toggleMultiValue("primaryChallenge", value)}
            />
            {ensureArray(form.primaryChallenge).includes("Other") && (
              <TextField
                label="Other primary challenge"
                name="primaryChallengeOther"
                value={form.primaryChallengeOther}
                onChange={updateTextField}
                placeholder="Optional"
              />
            )}
            <ChipGroup
              label="Tilt trigger"
              options={tiltTriggerOptions}
              selected={ensureArray(form.tiltTrigger)}
              onToggle={(value) => toggleMultiValue("tiltTrigger", value)}
            />
            {ensureArray(form.tiltTrigger).includes("Other") && (
              <TextField
                label="Other tilt trigger"
                name="tiltTriggerOther"
                value={form.tiltTriggerOther}
                onChange={updateTextField}
                placeholder="Optional"
              />
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Tilt thought"
                value={form.tiltThought}
                options={tiltThoughtOptions}
                onChange={(value) => updateTextField("tiltThought", value)}
              />
              {form.tiltThought === "Other" && (
                <TextField
                  label="Other tilt thought"
                  name="tiltThoughtOther"
                  value={form.tiltThoughtOther}
                  onChange={updateTextField}
                  placeholder="Optional"
                />
              )}
            </div>
          </div>
        )}

        {/* Step 3: Motivation */}
        {currentStep === 2 && (
          <div className="space-y-4">
            <TextareaField
              label="Why do you trade?"
              name="tradingWhy"
              value={form.tradingWhy}
              onChange={updateTextField}
              placeholder="e.g. financial freedom, replace my salary, passion for markets…"
            />
            <TextareaField
              label="What are you building toward?"
              name="tradingGoal"
              value={form.tradingGoal}
              onChange={updateTextField}
              placeholder="e.g. leave my job in 2 years, support my family, grow a prop account…"
            />
            <TextareaField
              label="What helps you refocus under pressure?"
              name="groundingReminder"
              value={form.groundingReminder}
              onChange={updateTextField}
              placeholder="e.g. remember my rules, step away for 5 minutes… (optional)"
            />
          </div>
        )}

        {/* Step 4: Protection rules */}
        {currentStep === 3 && (
          <div className="space-y-4">
            <NumericPresetFieldControl
              label="Account size"
              field={form.accountSize}
              options={accountSizeOptions}
              onModeChange={(value) => updateNumericField("accountSize", { mode: value })}
              onCustomChange={(value) => updateNumericField("accountSize", { custom: value })}
              placeholder="Enter account size"
            />
            <NumericPresetFieldControl
              label="Max daily loss"
              field={form.maxDailyLoss}
              options={dailyLossOptions}
              onModeChange={(value) => updateNumericField("maxDailyLoss", { mode: value })}
              onCustomChange={(value) => updateNumericField("maxDailyLoss", { custom: value })}
              placeholder="Enter max daily loss"
            />
            <NumericPresetFieldControl
              label="Risk per trade"
              field={form.riskPerTrade}
              options={riskPerTradeOptions}
              onModeChange={(value) => updateNumericField("riskPerTrade", { mode: value })}
              onCustomChange={(value) => updateNumericField("riskPerTrade", { custom: value })}
              placeholder="Enter risk per trade"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Max trades per day"
                value={form.maxTradesPerDay}
                options={maxTradesOptions}
                onChange={(value) => updateTextField("maxTradesPerDay", value)}
              />
              <SelectField
                label="Stop after losses"
                value={form.stopAfterLosses}
                options={stopAfterLossesOptions}
                onChange={(value) => updateTextField("stopAfterLosses", value)}
              />
            </div>
          </div>
        )}

        {/* Step 5: Advanced & coaching */}
        {currentStep === 4 && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Experience years"
                value={form.experienceYears}
                options={experienceOptions}
                onChange={(value) => updateTextField("experienceYears", value)}
              />
              <SelectField
                label="Timezone"
                value={form.timezone}
                options={timezoneOptions}
                onChange={(value) => updateTextField("timezone", value)}
              />
            </div>
            <ChipGroup
              label="Trading days"
              options={tradingDayOptions}
              selected={ensureArray(form.tradingDays)}
              onToggle={(value) => toggleMultiValue("tradingDays", value)}
            />
            <ChipGroup
              label="Trading session"
              options={visibleSessionOptions}
              selected={ensureArray(form.tradingSession)}
              onToggle={(value) => toggleMultiValue("tradingSession", value)}
            />
            <div className="grid gap-4">
              <ToggleField
                label="Enable premarket check-in"
                checked={form.premarketCheckinEnabled}
                onChange={(checked) => updateBooleanField("premarketCheckinEnabled", checked)}
              />
              <ToggleField
                label="Enable postmarket review"
                checked={form.postmarketReviewEnabled}
                onChange={(checked) => updateBooleanField("postmarketReviewEnabled", checked)}
              />
              <ToggleField
                label="Enable news alerts"
                checked={form.newsAlertsEnabled}
                onChange={(checked) => updateBooleanField("newsAlertsEnabled", checked)}
              />
              <ToggleField
                label="Only high-impact news"
                checked={form.highImpactOnly}
                onChange={(checked) => updateBooleanField("highImpactOnly", checked)}
                disabled={!form.newsAlertsEnabled}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <SegmentedControl
                label="Check-in format"
                value={form.checkinFormat}
                options={checkinFormatOptions}
                onChange={(value) => updateTextField("checkinFormat", value)}
                disabled={!form.premarketCheckinEnabled}
              />
              <SelectField
                label="Pre-news minutes"
                value={form.preNewsMinutes}
                options={preNewsMinutesOptions}
                onChange={(value) => updateTextField("preNewsMinutes", value)}
                disabled={!form.newsAlertsEnabled}
              />
              <SelectField
                label="Economic calendar source"
                value={form.economicCalendarProviderKey}
                options={economicCalendarProviderOptions}
                onChange={(value) => updateTextField("economicCalendarProviderKey", value)}
                helperText={
                  form.economicCalendarProviderKey === "tradingeconomics_stub"
                    ? "Uses realistic TradingEconomics-style test data. Live sync is not connected yet."
                    : "Uses the internal demo feed for standard news-awareness behavior."
                }
              />
              <SelectField
                label="News scenario for demo testing"
                value={form.economicCalendarStubScenario}
                options={economicCalendarStubScenarioOptions}
                onChange={(value) => updateTextField("economicCalendarStubScenario", value)}
                disabled={form.economicCalendarProviderKey !== "tradingeconomics_stub"}
                helperText={
                  form.economicCalendarProviderKey === "tradingeconomics_stub"
                    ? "Choose the market-news condition you want the product to simulate."
                    : "Scenario selection becomes available when the TradingEconomics-ready feed is selected."
                }
              />
            </div>
            <ChipGroup
              label="Review focus"
              options={reviewFocusOptions}
              selected={ensureArray(form.reviewFocus)}
              onToggle={(value) => toggleMultiValue("reviewFocus", value)}
              disabled={!form.postmarketReviewEnabled}
            />
            {ensureArray(form.reviewFocus).includes("Other") && (
              <TextField
                label="Other review focus"
                name="reviewFocusOther"
                value={form.reviewFocusOther}
                onChange={updateTextField}
                placeholder="Optional"
                disabled={!form.postmarketReviewEnabled}
              />
            )}
          </div>
        )}
      </div>

      {/* ── Notice ── */}
      {notice && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            notice.kind === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {notice.message}
        </div>
      )}

      {/* ── Navigation ── */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={goBack}
          disabled={currentStep === 0}
          className="inline-flex h-10 items-center gap-1.5 rounded-full border border-stone-300 px-5 text-sm font-medium text-stone-700 transition hover:border-stone-950 hover:text-stone-950 disabled:pointer-events-none disabled:opacity-30"
        >
          ← Back
        </button>

        {currentStep < STEP_TITLES.length - 1 ? (
          <button
            type="button"
            onClick={goNext}
            className="inline-flex h-10 items-center gap-1.5 rounded-full bg-stone-950 px-5 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
          >
            Continue →
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex h-10 items-center justify-center rounded-full bg-amber-600 px-5 text-sm font-medium text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? "Saving…" : "Save profile"}
            </button>
            {didSave && (
              <button
                type="button"
                onClick={handleConnectTelegram}
                disabled={isLinkingTelegram}
                className="inline-flex h-10 items-center justify-center rounded-full border border-stone-300 px-5 text-sm font-medium text-stone-800 transition hover:border-stone-950 hover:text-stone-950 disabled:cursor-not-allowed disabled:border-stone-200 disabled:text-stone-400"
              >
                {isLinkingTelegram ? "Generating link…" : "Connect Telegram"}
              </button>
            )}
            {telegramLink && (
              <a
                href={telegramLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center justify-center rounded-full bg-stone-950 px-5 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
              >
                Open Telegram Bot
              </a>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
