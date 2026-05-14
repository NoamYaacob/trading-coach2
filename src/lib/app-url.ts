import type { NextRequest } from "next/server";

/**
 * Returns the public-facing base URL of the app, without a trailing slash.
 *
 * On Railway (and any reverse-proxy deployment), request.url reflects the
 * internal address (e.g. https://localhost:8080) rather than the public
 * hostname.  NEXT_PUBLIC_APP_URL is the authoritative source for the
 * deployed origin and must be set in production.
 *
 * Falls back to the incoming request's own origin only when
 * NEXT_PUBLIC_APP_URL is absent — useful for local development where the
 * app is accessed directly without a proxy.
 */
export function getAppBaseUrl(request: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_APP_URL;
  if (env) return env.replace(/\/$/, "");
  return request.nextUrl.origin;
}
