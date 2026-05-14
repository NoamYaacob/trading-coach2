import { Resend } from "resend";

const EXPIRY_MINUTES = 30;

const SANDBOX_RESTRICTION_PHRASE =
  "You can only send testing emails to your own email address";

export class EmailNotSentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailNotSentError";
  }
}

function getClient(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

function fromAddress(): string {
  return process.env.PASSWORD_RESET_FROM_EMAIL ?? "noreply@example.com";
}

function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    "http://localhost:3000"
  );
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  token: string;
}): Promise<void> {
  const client = getClient();

  if (!client) {
    if (process.env.NODE_ENV !== "production") {
      console.log(
        "[email] RESEND_API_KEY not configured — password reset email not sent (dev mode).",
      );
    } else {
      console.error("[email] RESEND_API_KEY not configured — password reset email not sent.");
    }
    throw new EmailNotSentError("Email provider not configured.");
  }

  const resetUrl = `${appUrl()}/reset-password?token=${opts.token}`;

  const result = await client.emails.send({
    from: fromAddress(),
    to: opts.to,
    subject: "Reset your Guardrail password",
    html: htmlBody(resetUrl),
    text: textBody(resetUrl),
  });

  if (result.error) {
    if (result.error.message?.includes(SANDBOX_RESTRICTION_PHRASE)) {
      console.error(
        "[email] Resend sandbox restriction: you can only send test emails to your own email address." +
          " Verify your sender domain or add the recipient as an authorized tester in Resend.",
      );
    } else {
      console.error("[email] Failed to send password reset email:", result.error.message);
    }
    throw new EmailNotSentError(result.error.message ?? "Unknown email provider error.");
  }
}

function htmlBody(resetUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1c1917;background:#fafaf9;margin:0;padding:40px 20px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e7e5e4;border-radius:12px;padding:40px;">
    <p style="font-size:10px;font-weight:600;letter-spacing:0.32em;text-transform:uppercase;color:#78716c;margin:0 0 24px;">Guardrail</p>
    <h1 style="font-size:22px;font-weight:600;margin:0 0 12px;color:#0c0a09;">Reset your password</h1>
    <p style="font-size:14px;line-height:1.6;color:#57534e;margin:0 0 24px;">
      Someone requested a password reset for your Guardrail account. Click the button below to set a new password.
      This link expires in ${EXPIRY_MINUTES} minutes.
    </p>
    <a href="${resetUrl}" style="display:inline-block;background:#0c0a09;color:#fafaf9;text-decoration:none;font-size:14px;font-weight:500;padding:12px 24px;border-radius:9999px;margin-bottom:24px;">
      Reset password
    </a>
    <p style="font-size:12px;color:#78716c;margin:0;line-height:1.6;">
      If you didn&apos;t request a password reset, you can safely ignore this email. Your password will not change.
    </p>
  </div>
</body>
</html>`;
}

function textBody(resetUrl: string): string {
  return [
    "Reset your Guardrail password",
    "",
    "Someone requested a password reset for your Guardrail account.",
    `This link expires in ${EXPIRY_MINUTES} minutes.`,
    "",
    `Reset password: ${resetUrl}`,
    "",
    "If you didn't request a password reset, you can safely ignore this email.",
    "Your password will not change.",
  ].join("\n");
}
