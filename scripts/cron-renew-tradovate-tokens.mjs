#!/usr/bin/env node
/**
 * Trigger the Tradovate token renewal cron endpoint.
 *
 * Proactively renews Tradovate access tokens for active BrokerConnections
 * whose tokens are expiring within the next 25 minutes. Decoupled from the
 * account-sync cron so tokens are always renewed even when no sync is needed.
 *
 * Usage (Railway Cron service start command):
 *   node scripts/cron-renew-tradovate-tokens.mjs
 *
 * Or via npm:
 *   npm run cron:renew-tokens
 *
 * Suggested cadence: every 10 minutes.
 *   Railway cron expression: *\/10 * * * *
 *
 * Required environment variables:
 *   APP_URL      — public origin, e.g. https://guardrail-trade.com
 *   CRON_SECRET  — matches the CRON_SECRET set on the app service
 *
 * Exits 0 on success or when all failures are transient (connection NOT marked
 * expired). Exits 1 only when the HTTP request itself fails, so Railway marks
 * the cron run as failed and includes it in the failure alert.
 *
 * Railway setup:
 *   1. In your Railway project, add a new Cron service.
 *   2. Set the start command to: node scripts/cron-renew-tradovate-tokens.mjs
 *   3. Set the schedule to: *\/10 * * * *  (every 10 minutes)
 *   4. Add env vars: APP_URL, CRON_SECRET
 *
 * Alternatively, configure as an HTTP cron in railway.toml:
 *   [[crons]]
 *   name    = "renew-tradovate-tokens"
 *   schedule = "*\/10 * * * *"
 *   [crons.http]
 *   method  = "POST"
 *   path    = "/api/cron/renew-tradovate-tokens"
 *   headers = { x-cron-secret = "$CRON_SECRET" }
 */

const url = process.env.APP_URL;
const secret = process.env.CRON_SECRET;

if (!url) {
  console.error("[cron/renew-tradovate-tokens] APP_URL is not set");
  process.exit(1);
}
if (!secret) {
  console.error("[cron/renew-tradovate-tokens] CRON_SECRET is not set");
  process.exit(1);
}

const endpoint = `${url.replace(/\/$/, "")}/api/cron/renew-tradovate-tokens`;
console.log(`[cron/renew-tradovate-tokens] POST ${endpoint}`);

let res;
try {
  res = await fetch(endpoint, {
    method: "POST",
    headers: { "x-cron-secret": secret, "Content-Type": "application/json" },
  });
} catch (err) {
  console.error(
    "[cron/renew-tradovate-tokens] Network error:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
}

let body;
try {
  body = await res.json();
} catch {
  console.error(
    "[cron/renew-tradovate-tokens] Could not parse response (status",
    res.status,
    ")",
  );
  process.exit(1);
}

console.log("[cron/renew-tradovate-tokens] Response:", JSON.stringify(body));

if (!res.ok) {
  console.error("[cron/renew-tradovate-tokens] Failed with HTTP", res.status);
  process.exit(1);
}

const { checked = 0, renewed = 0, skipped = 0, failed = 0, errors = [] } = body;
console.log(
  `[cron/renew-tradovate-tokens] Done — checked: ${checked}`,
  `renewed: ${renewed}`,
  `skipped: ${skipped}`,
  `failed: ${failed}`,
);

if (errors.length > 0) {
  for (const e of errors) {
    console.warn(
      `[cron/renew-tradovate-tokens]   error connectionId=${e.connectionId}`,
      `code=${e.errorCode} message=${e.errorMessage}`,
    );
  }
  // Transient renewal errors are logged but do NOT cause exit 1 — the next
  // cron run will retry. Only auth_invalid failures are unrecoverable, and
  // those are handled server-side (connection marked expired, user sees
  // Reconnect on Dashboard). Exit 0 so Railway does not spam failure alerts
  // for recoverable transient network errors.
  console.warn(
    "[cron/renew-tradovate-tokens] Some renewals failed (see errors above).",
    "Transient failures will be retried on the next run.",
  );
}
