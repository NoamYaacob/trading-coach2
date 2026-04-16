"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { DISPLAY_TIME_ZONE_COOKIE } from "@/lib/timezone";

function getCookieValue(name: string) {
  return document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.split("=")[1];
}

export function BrowserTimeZoneSync() {
  const router = useRouter();

  useEffect(() => {
    const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    if (!browserTimeZone) {
      return;
    }

    const encodedTimeZone = encodeURIComponent(browserTimeZone);

    if (getCookieValue(DISPLAY_TIME_ZONE_COOKIE) === encodedTimeZone) {
      return;
    }

    document.cookie = `${DISPLAY_TIME_ZONE_COOKIE}=${encodedTimeZone}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }, [router]);

  return null;
}
