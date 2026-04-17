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
  const required = ["DATABASE_URL", "TELEGRAM_BOT_TOKEN"];
  const missing = required.filter((name) => !process.env[name]);

  const warnings: string[] = [];

  if (process.env.NODE_ENV !== "production") {
    warnings.push(
      "NODE_ENV is not 'production' — session cookies will not be marked Secure",
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
