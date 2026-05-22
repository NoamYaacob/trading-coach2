/**
 * Pre-beta runtime env-posture evaluation (pure, side-effect-free).
 *
 * `buildRuntimePosture` takes an env source (normally `process.env`) and
 * returns a safe, serialisable snapshot of the web/app service's runtime
 * posture plus a GO / NO_GO verdict for the guided beta.
 *
 * Safety contract:
 *   - Pure function — never reads global state, never mutates the env source.
 *   - Interpreted flags are returned as plain booleans.
 *   - Secret-bearing vars are reported as presence-only booleans. Raw values
 *     are NEVER copied into the result.
 *   - No imports — keeps the module dynamically importable by the
 *     `node --experimental-strip-types` test runner with no path-alias setup.
 */

export type EnvSource = Record<string, string | undefined>;

/** Operational feature flags, reported as interpreted booleans. */
export const INTERPRETED_FLAGS = [
  "BROKER_ENFORCEMENT_ENABLED",
  "ENFORCEMENT_DRY_RUN",
  "BROKER_ENFORCEMENT_SIMULATION_ENABLED",
  "ENABLE_TRADOVATE_ORDER_ACTIONS",
  "TRADOVATE_LISTENER_ENABLE_LIVE",
  "GUARDRAIL_INTERNAL_LOCK_ENABLED",
  "BILLING_ENABLED",
] as const;

/** Secret-bearing vars — reported presence-only, never by value. */
export const PRESENCE_KEYS = [
  "TELEGRAM_BOT_USERNAME",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "TRADOVATE_TOKEN_ENCRYPTION_KEY",
  "TRADOVATE_CLIENT_ID",
  "TRADOVATE_CLIENT_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "NEXT_PUBLIC_STRIPE_PRICE_ID",
] as const;

/**
 * Flags that MUST be false/unset for the guided beta. A `true` value here is
 * a hard NO_GO — it would let real broker enforcement, order placement, live
 * listeners, internal locks, or billing run during a monitoring-only beta.
 */
export const MUST_BE_FALSE_FLAGS = [
  "BROKER_ENFORCEMENT_ENABLED",
  "ENABLE_TRADOVATE_ORDER_ACTIONS",
  "TRADOVATE_LISTENER_ENABLE_LIVE",
  "GUARDRAIL_INTERNAL_LOCK_ENABLED",
  "BILLING_ENABLED",
] as const;

/** Tradovate OAuth + token-encryption env required for the broker-connect flow. */
export const REQUIRED_FOR_BETA_KEYS = [
  "TRADOVATE_CLIENT_ID",
  "TRADOVATE_CLIENT_SECRET",
  "TRADOVATE_TOKEN_ENCRYPTION_KEY",
] as const;

const TELEGRAM_KEYS = [
  "TELEGRAM_BOT_USERNAME",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
] as const;

const STRIPE_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "NEXT_PUBLIC_STRIPE_PRICE_ID",
] as const;

export type Verdict = {
  status: "GO" | "NO_GO";
  reasons: string[];
  dangerousFlags: string[];
  missingRequiredForBeta: string[];
  notes: string[];
};

export type RuntimePosture = {
  service: "web";
  flags: Record<string, boolean>;
  secretsPresent: Record<string, boolean>;
  services: {
    listenerWorker: "unknown_from_web_runtime";
    cron: "unknown_from_web_runtime";
    note: string;
  };
  verdict: Verdict;
};

/** A flag is `true` only when explicitly set to the string "true". */
function asBool(value: string | undefined): boolean {
  return value === "true";
}

/** A var is present only when it is a non-empty (trimmed) string. */
function isPresent(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Evaluate the web/app service's pre-beta runtime posture.
 *
 * Listener-worker and cron run as separate Railway services; their env is not
 * observable here, so they are reported as `unknown_from_web_runtime`.
 */
export function buildRuntimePosture(env: EnvSource): RuntimePosture {
  const flags: Record<string, boolean> = {};
  for (const key of INTERPRETED_FLAGS) {
    flags[key] = asBool(env[key]);
  }

  const secretsPresent: Record<string, boolean> = {};
  for (const key of PRESENCE_KEYS) {
    secretsPresent[key] = isPresent(env[key]);
  }

  const reasons: string[] = [];
  const notes: string[] = [];

  // ── Hard NO_GO: flags that must be false for a monitoring-only beta ───────
  const dangerousFlags: string[] = [];
  for (const key of MUST_BE_FALSE_FLAGS) {
    if (flags[key]) {
      dangerousFlags.push(key);
      reasons.push(`${key} is true — must be false/unset for the guided beta.`);
    }
  }

  // ── Hard NO_GO: Tradovate OAuth/encryption env required for connect flow ──
  const missingRequiredForBeta: string[] = [];
  for (const key of REQUIRED_FOR_BETA_KEYS) {
    if (!secretsPresent[key]) {
      missingRequiredForBeta.push(key);
      reasons.push(
        `${key} is not set — required for the Tradovate OAuth/connect beta flow.`,
      );
    }
  }

  // ── Advisory notes (do not affect the verdict) ───────────────────────────
  if (!flags.ENFORCEMENT_DRY_RUN) {
    notes.push(
      "ENFORCEMENT_DRY_RUN is not true — confirm this is intentional; dry-run is the expected posture wherever enforcement evaluation runs.",
    );
  }
  if (flags.BROKER_ENFORCEMENT_SIMULATION_ENABLED) {
    notes.push(
      "BROKER_ENFORCEMENT_SIMULATION_ENABLED is true — simulation is observe-only and places no broker orders, but confirm it is expected.",
    );
  }
  if (TELEGRAM_KEYS.some((key) => !secretsPresent[key])) {
    notes.push(
      "One or more Telegram env vars are missing — acceptable only if Telegram is scoped out of the guided beta.",
    );
  }
  if (STRIPE_KEYS.some((key) => secretsPresent[key]) && !flags.BILLING_ENABLED) {
    notes.push(
      "Stripe env vars are present while BILLING_ENABLED is false — billing is inert; this is the expected guided-beta posture.",
    );
  }
  notes.push(
    "Listener-worker and cron run as separate Railway services; their env posture is not visible from the web runtime — verify those services separately in Railway.",
  );

  const status: "GO" | "NO_GO" =
    dangerousFlags.length === 0 && missingRequiredForBeta.length === 0
      ? "GO"
      : "NO_GO";

  if (status === "GO") {
    reasons.push(
      "All guarded flags are false/unset and the required Tradovate beta env is present.",
    );
  }

  return {
    service: "web",
    flags,
    secretsPresent,
    services: {
      listenerWorker: "unknown_from_web_runtime",
      cron: "unknown_from_web_runtime",
      note: "Listener-worker and cron are separate Railway services. This endpoint only observes the web/app service runtime. Verify those services' env posture separately in the Railway dashboard.",
    },
    verdict: { status, reasons, dangerousFlags, missingRequiredForBeta, notes },
  };
}
