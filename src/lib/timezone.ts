export const DISPLAY_TIME_ZONE_COOKIE = "tc_display_timezone";
export const DEFAULT_DISPLAY_TIME_ZONE = "UTC";

export function isValidTimeZone(timeZone: string | null | undefined) {
  if (!timeZone) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function resolveDisplayTimeZone(input: {
  onboardingTimeZone?: string | null;
  browserTimeZone?: string | null;
  fallbackTimeZone?: string | null;
}) {
  if (isValidTimeZone(input.onboardingTimeZone)) {
    return input.onboardingTimeZone as string;
  }

  if (isValidTimeZone(input.browserTimeZone)) {
    return input.browserTimeZone as string;
  }

  if (isValidTimeZone(input.fallbackTimeZone)) {
    return input.fallbackTimeZone as string;
  }

  return DEFAULT_DISPLAY_TIME_ZONE;
}
