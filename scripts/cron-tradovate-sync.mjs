#!/usr/bin/env node
/**
 * Trigger the Tradovate background sync cron endpoint.
 *
 * Usage (Railway Cron service start command):
 *   node scripts/cron-tradovate-sync.mjs
 *
 * Required environment variables:
 *   APP_URL      — public origin, e.g. https://guardrail-trade.com
 *   CRON_SECRET  — matches the CRON_SECRET set on the app service
 *
 * Exits 0 on success, 1 on any failure so Railway marks the cron run as
 * failed and includes it in the failure alert.
 */

const url = process.env.APP_URL;
const secret = process.env.CRON_SECRET;

if (!url) {
  console.error("[cron] APP_URL is not set");
  process.exit(1);
}
if (!secret) {
  console.error("[cron] CRON_SECRET is not set");
  process.exit(1);
}

const endpoint = `${url.replace(/\/$/, "")}/api/cron/tradovate-sync`;
console.log(`[cron] POST ${endpoint}`);

let res;
try {
  res = await fetch(endpoint, {
    method: "POST",
    headers: { "x-cron-secret": secret, "Content-Type": "application/json" },
  });
} catch (err) {
  console.error("[cron] Network error:", err instanceof Error ? err.message : err);
  process.exit(1);
}

let body;
try {
  body = await res.json();
} catch {
  console.error("[cron] Could not parse response (status", res.status, ")");
  process.exit(1);
}

console.log("[cron] Response:", JSON.stringify(body));

if (!res.ok) {
  console.error("[cron] Failed with HTTP", res.status);
  process.exit(1);
}

console.log("[cron] Done — synced:", body.synced, "skipped:", body.skipped, "failed:", body.failed);
