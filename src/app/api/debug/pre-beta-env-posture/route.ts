/**
 * GET /api/debug/pre-beta-env-posture
 *
 * Read-only pre-beta environment-posture diagnostic.
 *
 * Reports the live WEB runtime env posture against the guided monitoring-only
 * beta posture (docs/GUIDED_BETA_RUNBOOK.md) so the pre-beta env check can be
 * completed from a deployed environment instead of a code-only checkout.
 *
 * Safety:
 *   - Read-only — reads process.env only; no DB, no broker calls, no writes
 *   - NEVER exposes secret values — flags are interpreted booleans
 *     (`process.env.X === "true"`), secrets are presence booleans only
 *     (`Boolean(process.env.X)`)
 *   - Auth: authenticated session + x-cron-secret header (same pattern as the
 *     other /api/debug diagnostic endpoints)
 *
 * Query params:
 *   - telegramScopedOut=true — declare that Telegram is intentionally not part
 *     of this beta, so incomplete Telegram env is reported as acceptable.
 *
 * The listener-worker and cron run as separate Railway services; their env is
 * not visible from the web runtime and is reported as "unknown_from_web_runtime".
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { derivePreBetaEnvVerdict } from "./posture";

/** Interpreted boolean flag — `process.env.X === "true"`. Never the raw value. */
function flag(name: string): boolean {
  return process.env[name] === "true";
}

/** Presence only — `Boolean(process.env.X)`. Never the raw value. */
function present(name: string): boolean {
  return Boolean(process.env[name]);
}

export async function GET(request: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const secret = request.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const telegramScopedOut =
    request.nextUrl.searchParams.get("telegramScopedOut") === "true";

  // Interpreted booleans only — no secret value is ever read into the response.
  const flags = {
    brokerEnforcementEnabled: flag("BROKER_ENFORCEMENT_ENABLED"),
    enforcementDryRun: flag("ENFORCEMENT_DRY_RUN"),
    brokerEnforcementSimulationEnabled: flag("BROKER_ENFORCEMENT_SIMULATION_ENABLED"),
    enableTradovateOrderActions: flag("ENABLE_TRADOVATE_ORDER_ACTIONS"),
    tradovateListenerEnableLive: flag("TRADOVATE_LISTENER_ENABLE_LIVE"),
    guardrailInternalLockEnabled: flag("GUARDRAIL_INTERNAL_LOCK_ENABLED"),
    billingEnabled: flag("BILLING_ENABLED"),
  };
  const presence = {
    telegramBotUsername: present("TELEGRAM_BOT_USERNAME"),
    telegramBotToken: present("TELEGRAM_BOT_TOKEN"),
    telegramWebhookSecret: present("TELEGRAM_WEBHOOK_SECRET"),
    tradovateTokenEncryptionKey: present("TRADOVATE_TOKEN_ENCRYPTION_KEY"),
    tradovateClientId: present("TRADOVATE_CLIENT_ID"),
    tradovateClientSecret: present("TRADOVATE_CLIENT_SECRET"),
    stripeSecretKey: present("STRIPE_SECRET_KEY"),
    stripeWebhookSecret: present("STRIPE_WEBHOOK_SECRET"),
    stripePriceId: present("STRIPE_PRICE_ID"),
  };

  const verdict = derivePreBetaEnvVerdict({ flags, presence, telegramScopedOut });

  return NextResponse.json({
    ok: true,
    now: new Date().toISOString(),
    note:
      "Read-only env posture — reports the WEB runtime's process.env as interpreted " +
      "booleans / presence only. No secret values are exposed. The listener-worker and " +
      "cron run as separate Railway services and are not visible from the web runtime.",
    webRuntime: { flags, presence },
    listenerWorker: "unknown_from_web_runtime",
    cron: "unknown_from_web_runtime",
    expectedPosture: {
      brokerEnforcementEnabled: false,
      enableTradovateOrderActions: false,
      tradovateListenerEnableLive: false,
      guardrailInternalLockEnabled: false,
      billingEnabled: false,
      enforcementDryRun: true,
    },
    verdict,
  });
}
