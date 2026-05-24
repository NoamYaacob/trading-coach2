/**
 * Pure verdict logic for the pre-beta env-posture diagnostic.
 *
 * Decides whether the runtime environment matches the guided monitoring-only
 * beta posture documented in docs/GUIDED_BETA_RUNBOOK.md.
 *
 * No I/O, no process.env access, no framework imports — the route handler
 * reads process.env, interprets it into the structs below, and passes them in.
 * That keeps this fully unit-testable.
 *
 * Inputs are already-interpreted booleans (flags = `process.env.X === "true"`,
 * presence = `Boolean(process.env.X)`). No secret values ever reach this code.
 */

export type EnvFlags = {
  brokerEnforcementEnabled: boolean;
  enforcementDryRun: boolean;
  brokerEnforcementSimulationEnabled: boolean;
  enableTradovateOrderActions: boolean;
  tradovateListenerEnableLive: boolean;
  guardrailInternalLockEnabled: boolean;
  billingEnabled: boolean;
};

export type EnvPresence = {
  telegramBotUsername: boolean;
  telegramBotToken: boolean;
  telegramWebhookSecret: boolean;
  tradovateTokenEncryptionKey: boolean;
  tradovateClientId: boolean;
  tradovateClientSecret: boolean;
  stripeSecretKey: boolean;
  stripeWebhookSecret: boolean;
  stripePriceId: boolean;
};

export type PreBetaEnvVerdict = {
  status: "GO" | "NO_GO";
  reasons: string[];
  dangerousFlags: string[];
  missingRequiredForBeta: string[];
  notes: string[];
};

/**
 * Evaluates the guided-beta env posture. NO_GO when any dangerous flag is on or
 * a beta-required var is missing. Telegram and Stripe are non-blocking notes —
 * Telegram may be scoped out, Stripe is inert while billing is off.
 */
export function derivePreBetaEnvVerdict(input: {
  flags: EnvFlags;
  presence: EnvPresence;
  telegramScopedOut: boolean;
}): PreBetaEnvVerdict {
  const { flags, presence, telegramScopedOut } = input;
  const reasons: string[] = [];
  const dangerousFlags: string[] = [];
  const missingRequiredForBeta: string[] = [];
  const notes: string[] = [];

  // ── Dangerous flags — any one true blocks the guided monitoring-only beta ──
  if (flags.brokerEnforcementEnabled) {
    dangerousFlags.push("BROKER_ENFORCEMENT_ENABLED");
    reasons.push(
      "BROKER_ENFORCEMENT_ENABLED is true — broker-side enforcement must be off for the guided monitoring-only beta.",
    );
  }
  if (flags.enableTradovateOrderActions) {
    dangerousFlags.push("ENABLE_TRADOVATE_ORDER_ACTIONS");
    reasons.push(
      "ENABLE_TRADOVATE_ORDER_ACTIONS is true — Tradovate order writes must be off for the guided beta.",
    );
  }
  if (flags.tradovateListenerEnableLive) {
    dangerousFlags.push("TRADOVATE_LISTENER_ENABLE_LIVE");
    reasons.push(
      "TRADOVATE_LISTENER_ENABLE_LIVE is true — the live listener must be off for the guided beta.",
    );
  }
  if (flags.guardrailInternalLockEnabled) {
    dangerousFlags.push("GUARDRAIL_INTERNAL_LOCK_ENABLED");
    reasons.push(
      "GUARDRAIL_INTERNAL_LOCK_ENABLED is true — internal lock must be disabled for the guided beta.",
    );
  }
  if (flags.billingEnabled) {
    dangerousFlags.push("BILLING_ENABLED");
    reasons.push("BILLING_ENABLED is true — billing must be false for the guided beta.");
  }

  // ── Non-blocking notes ──────────────────────────────────────────────────────
  if (!flags.enforcementDryRun) {
    notes.push(
      "ENFORCEMENT_DRY_RUN is not true — recommended true for defense-in-depth " +
        "(broker enforcement is gated off by BROKER_ENFORCEMENT_ENABLED regardless).",
    );
  }
  if (flags.brokerEnforcementSimulationEnabled) {
    notes.push(
      "BROKER_ENFORCEMENT_SIMULATION_ENABLED is true — simulation only, no broker writes; confirm intended.",
    );
  }

  // ── Tradovate OAuth — required for the beta broker-connect flow ─────────────
  const missingTradovate: string[] = [];
  if (!presence.tradovateTokenEncryptionKey) missingTradovate.push("TRADOVATE_TOKEN_ENCRYPTION_KEY");
  if (!presence.tradovateClientId) missingTradovate.push("TRADOVATE_CLIENT_ID");
  if (!presence.tradovateClientSecret) missingTradovate.push("TRADOVATE_CLIENT_SECRET");
  if (missingTradovate.length > 0) {
    missingRequiredForBeta.push(...missingTradovate);
    reasons.push(
      "Tradovate OAuth/encryption env is incomplete — required for the beta broker-connect flow.",
    );
  }

  // ── Telegram — optional; missing env is acceptable only if scoped out ──────
  const telegramComplete =
    presence.telegramBotUsername && presence.telegramBotToken && presence.telegramWebhookSecret;
  if (!telegramComplete) {
    notes.push(
      telegramScopedOut
        ? "Telegram env is incomplete and Telegram is explicitly scoped out of this beta — acceptable."
        : "Telegram env is incomplete — Telegram features will show 'Coming soon'. Acceptable only if " +
          "Telegram is explicitly scoped out of the beta (pass ?telegramScopedOut=true to confirm).",
    );
  }

  // ── Stripe — inert while billing is off ─────────────────────────────────────
  if (!flags.billingEnabled) {
    notes.push(
      "BILLING_ENABLED is false — Stripe env is inert (checkout returns 503). Expected for the guided beta.",
    );
  }

  // ── Listener / cron caveat ──────────────────────────────────────────────────
  notes.push(
    "TRADOVATE_LISTENER_ENABLE_LIVE and GUARDRAIL_INTERNAL_LOCK_ENABLED reflect the WEB runtime's " +
      "process.env only. The listener-worker and cron run as separate Railway services — confirm " +
      "their env with `railway variables -s <service>`.",
  );

  const status: "GO" | "NO_GO" =
    dangerousFlags.length === 0 && missingRequiredForBeta.length === 0 ? "GO" : "NO_GO";

  return { status, reasons, dangerousFlags, missingRequiredForBeta, notes };
}
