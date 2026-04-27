// Server-only — do not import in client components

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

type EnvReport = {
  ok: boolean;
  missing: string[];
  warnings: string[];
};

export function validateEnv(): EnvReport {
  // Only DATABASE_URL is required for the app to boot. Telegram and
  // Tradovate are optional surfaces — their absence degrades features
  // but does not block startup. See docs/pre-api-readiness.md.
  const required = ["DATABASE_URL"];
  const missing = required.filter((name) => !process.env[name]);

  const warnings: string[] = [];

  if (process.env.NODE_ENV !== "production") {
    warnings.push(
      "NODE_ENV is not 'production' — session cookies will not be marked Secure",
    );
  }

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    warnings.push(
      "TELEGRAM_BOT_TOKEN is not set — Telegram alerts will be disabled",
    );
  }

  if (process.env.TELEGRAM_BOT_TOKEN && !process.env.TELEGRAM_WEBHOOK_SECRET) {
    warnings.push(
      "TELEGRAM_WEBHOOK_SECRET is not set — webhook calls cannot be authenticated. " +
        "Set the secret in Telegram (setWebhook secret_token) and in this env to enable.",
    );
  }

  const hasBotUsername =
    process.env.TELEGRAM_BOT_USERNAME ||
    process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;

  if (!hasBotUsername) {
    warnings.push(
      "TELEGRAM_BOT_USERNAME is not set — Telegram invite links will not be generated",
    );
  }

  return { ok: missing.length === 0, missing, warnings };
}
