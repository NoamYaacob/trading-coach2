#!/usr/bin/env node
/**
 * Trigger the pending-rule promoter cron endpoint.
 *
 * Designed for use with any HTTP-capable cron runner (external service,
 * GitHub Actions, etc.). Exits 0 on success, 1 on any failure so the
 * runner can report the job as failed.
 *
 * Required environment variables:
 *   APP_URL      — public origin, e.g. https://guardrail-trade.com
 *   CRON_SECRET  — matches the CRON_SECRET set on the app service
 *
 * Usage:
 *   node scripts/cron-promote-pending-rules.mjs
 *   # or via npm:
 *   npm run cron:promote
 */

const url = process.env.APP_URL;
const secret = process.env.CRON_SECRET;

if (!url) {
  console.error("[cron/promote-pending-rules] APP_URL is not set");
  process.exit(1);
}
if (!secret) {
  console.error("[cron/promote-pending-rules] CRON_SECRET is not set");
  process.exit(1);
}

const endpoint = `${url.replace(/\/$/, "")}/api/cron/promote-pending-rules`;
console.log(`[cron/promote-pending-rules] POST ${endpoint}`);

let res;
try {
  res = await fetch(endpoint, {
    method: "POST",
    headers: { "x-cron-secret": secret, "Content-Type": "application/json" },
  });
} catch (err) {
  console.error("[cron/promote-pending-rules] Network error:", err instanceof Error ? err.message : err);
  process.exit(1);
}

let body;
try {
  body = await res.json();
} catch {
  console.error("[cron/promote-pending-rules] Could not parse response (status", res.status, ")");
  process.exit(1);
}

console.log("[cron/promote-pending-rules] Response:", JSON.stringify(body));

if (!res.ok) {
  console.error("[cron/promote-pending-rules] Failed with HTTP", res.status);
  process.exit(1);
}

const { promotedDefaultCount = 0, promotedAccountCount = 0, skippedNotSafeCount = 0, failedCount = 0 } = body;
console.log(
  `[cron/promote-pending-rules] Done — promoted: ${promotedDefaultCount + promotedAccountCount}`,
  `skipped-not-safe: ${skippedNotSafeCount}`,
  `failed: ${failedCount}`,
);

if (body.skippedRows?.length > 0) {
  for (const row of body.skippedRows) {
    console.log(
      `[cron/promote-pending-rules]   skipped scope=${row.scope} id=${row.id}`,
      `effectiveDate=${row.pendingEffectiveDate} reason=${row.skipReason}`,
    );
  }
}
