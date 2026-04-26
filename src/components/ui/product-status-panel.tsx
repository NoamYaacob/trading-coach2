/**
 * Current product status panel.
 *
 * Server component. Reads real configuration state (env vars, encryption
 * key) and renders an explicit, honest state-of-the-product panel that
 * can be embedded on Accounts or Settings.
 *
 * Important: this component never claims a capability is available
 * unless it actually is. It surfaces the gap between "what we have
 * built" and "what we can promise the user", which is the bar for
 * trustworthy risk-enforcement claims.
 */

import { isTokenEncryptionKeyValid } from "@/lib/security/token-crypto";
import { getTradovateConfig } from "@/lib/brokers/tradovate-env";

export type ItemStatus = "ready" | "prepared" | "pending" | "disabled" | "optional";

const STATUS_STYLE: Record<
  ItemStatus,
  { label: string; pill: string; pillText: string; dot: string }
> = {
  ready: {
    label: "Available",
    pill: "bg-emerald-100",
    pillText: "text-emerald-700",
    dot: "bg-emerald-500",
  },
  prepared: {
    label: "Prepared",
    pill: "bg-sky-100",
    pillText: "text-sky-700",
    dot: "bg-sky-500",
  },
  pending: {
    label: "Pending API access",
    pill: "bg-amber-100",
    pillText: "text-amber-700",
    dot: "bg-amber-500",
  },
  disabled: {
    label: "Disabled",
    pill: "bg-stone-200",
    pillText: "text-stone-700",
    dot: "bg-stone-500",
  },
  optional: {
    label: "Optional",
    pill: "bg-stone-100",
    pillText: "text-stone-600",
    dot: "bg-stone-400",
  },
};

type Item = {
  key: string;
  title: string;
  status: ItemStatus;
  detail: string;
};

function buildItems(opts: {
  oauthConfigured: boolean;
  encryptionConfigured: boolean;
  missingKeys: string[];
}): Item[] {
  const { oauthConfigured, encryptionConfigured, missingKeys } = opts;

  return [
    {
      key: "manual",
      title: "Manual Mode",
      status: "ready",
      detail:
        "Journal-driven risk state. Define your rules, log trades, and Guardrail evaluates Safe / Warning / Locked from the journal. Available today; does not block trades at the broker.",
    },
    {
      key: "telegram",
      title: "Telegram alerts",
      status: "optional",
      detail:
        "Connect Telegram to receive Guardian state and lockout messages. Optional — Manual Mode and the dashboard work without it.",
    },
    {
      key: "encryption",
      title: "Token encryption (AES-256-GCM)",
      status: encryptionConfigured ? "ready" : "pending",
      detail: encryptionConfigured
        ? "Encryption key configured. Tokens are encrypted at rest before any DB write."
        : "TRADOVATE_TOKEN_ENCRYPTION_KEY not configured. The OAuth flow refuses to start until this is set.",
    },
    {
      key: "oauth",
      title: "Tradovate OAuth (read-only)",
      status: oauthConfigured ? "prepared" : "pending",
      detail: oauthConfigured
        ? "OAuth credentials configured. Read scope only — does not request order-write permissions. Connection lifecycle: not_connected → connected_readonly → expired."
        : `Missing env vars: ${missingKeys.join(", ")}. The connect flow displays a "not configured" state and Manual Mode remains the only path until set.`,
    },
    {
      key: "endpoints",
      title: "Tradovate read endpoints",
      status: "pending",
      detail:
        "Client implemented for account discovery, balance, positions, orders, fills, and contract resolution — but endpoint shapes are unverified against a real Tradovate account. The verification page (Accounts → Verify read-only connection) confirms each endpoint when API access is available.",
    },
    {
      key: "risk_state",
      title: "Broker-driven risk state",
      status: "pending",
      detail:
        "Dashboard and Guardian evaluate from the manual journal today. They will switch to broker-driven evaluation only after the read endpoints are verified.",
    },
    {
      key: "cancel_flatten",
      title: "Cancel orders / flatten positions",
      status: "disabled",
      detail:
        "Not implemented. Will require explicit user opt-in in Rules → On-breach actions, an audit log entry per action, and end-to-end verification against the live broker.",
    },
    {
      key: "lockout",
      title: "Broker-level lockout",
      status: "disabled",
      detail:
        "Not implemented. Tradovate API support for true server-side order blocking is unverified. If unsupported, this remains a 'not_supported' capability and is not offered.",
    },
  ];
}

export function ProductStatusPanel({
  variant = "full",
}: {
  /** "full" includes detail copy. "compact" shows status only. */
  variant?: "full" | "compact";
}) {
  const oauth = getTradovateConfig();
  const oauthConfigured = oauth.state === "ready";
  const missingKeys = oauth.state === "not_configured" ? oauth.missing : [];
  const encryptionConfigured = isTokenEncryptionKeyValid();

  const items = buildItems({
    oauthConfigured,
    encryptionConfigured,
    missingKeys,
  });

  return (
    <div className="grid gap-3">
      {items.map((item) => {
        const style = STATUS_STYLE[item.status];
        return (
          <div
            key={item.key}
            className="grid gap-2 rounded-2xl border border-stone-200 bg-white px-4 py-3 sm:flex sm:items-start sm:justify-between sm:gap-4"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
                <p className="text-sm font-medium text-stone-950">{item.title}</p>
              </div>
              {variant === "full" && (
                <p className="mt-1 text-xs leading-5 text-stone-600">
                  {item.detail}
                </p>
              )}
            </div>
            <span
              className={`shrink-0 self-start rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${style.pill} ${style.pillText}`}
            >
              {style.label}
            </span>
          </div>
        );
      })}
      <p className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-xs leading-5 text-stone-600">
        Read-only first. Broker-side cancel, flatten, and lockout actions
        will not be enabled until verified end-to-end against the live
        broker — and only behind explicit user opt-in.
      </p>
    </div>
  );
}
