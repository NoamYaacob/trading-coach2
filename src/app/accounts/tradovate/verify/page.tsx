import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  runTradovateVerification,
  type AccountCategory,
  type CheckStatus,
  type TokenStatus,
  type TvAccountSummary,
  type VerificationCheck,
  type VerificationReport,
} from "@/lib/brokers/tradovate-verification";

export const metadata: Metadata = {
  title: "Verify Tradovate connection",
};

// Always run on the server with a fresh request — no caching, no static.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const TOKEN_STATUS_COPY: Record<TokenStatus, { label: string; tone: string }> = {
  valid: { label: "Valid", tone: "text-emerald-700" },
  expired: { label: "Expired — refresh failed", tone: "text-orange-700" },
  no_refresh: { label: "Expired — no refresh token", tone: "text-orange-700" },
  load_failed: { label: "Could not load tokens", tone: "text-red-700" },
  config_missing: { label: "Server config missing", tone: "text-red-700" },
  unknown: { label: "Unknown", tone: "text-stone-600" },
};

const CONNECTION_STATUS_COPY: Record<string, { label: string; tone: string }> = {
  connected: { label: "Connected (read-only)", tone: "text-emerald-700" },
  expired: { label: "Token expired — re-authorize", tone: "text-orange-700" },
  error: { label: "Connection error", tone: "text-red-700" },
  disconnected: { label: "Not connected", tone: "text-stone-600" },
  degraded: { label: "Degraded", tone: "text-amber-700" },
};

function CheckIcon({ status }: { status: CheckStatus }) {
  if (status === "pass") {
    return (
      <span
        aria-label="pass"
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"
      >
        ✓
      </span>
    );
  }
  if (status === "fail") {
    return (
      <span
        aria-label="fail"
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-700"
      >
        ✗
      </span>
    );
  }
  return (
    <span
      aria-label="skip"
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-500"
    >
      –
    </span>
  );
}

const CATEGORY_LABELS: Record<AccountCategory, { label: string; tone: string }> = {
  live:    { label: "Live",    tone: "bg-emerald-100 text-emerald-700" },
  demo:    { label: "Demo",    tone: "bg-sky-100 text-sky-700" },
  sim:     { label: "Sim",     tone: "bg-sky-100 text-sky-700" },
  prop:    { label: "Prop",    tone: "bg-purple-100 text-purple-700" },
  unknown: { label: "Unknown", tone: "bg-stone-100 text-stone-500" },
};

function AccountRow({ account }: { account: TvAccountSummary }) {
  const cat = CATEGORY_LABELS[account.category];
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-stone-100 py-3 text-sm last:border-b-0">
      <span className="w-20 shrink-0 tabular-nums text-stone-500">{account.id}</span>
      <span className="flex-1 font-medium text-stone-900">{account.name}</span>
      <span className="text-stone-500">{account.accountType ?? "—"}</span>
      <span className="text-stone-500">{account.status ?? (account.active ? "Active" : "Inactive")}</span>
      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cat.tone}`}>
        {cat.label}
      </span>
      {account.archived && (
        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-500">
          Archived
        </span>
      )}
    </div>
  );
}

function CheckRow({ check }: { check: VerificationCheck }) {
  return (
    <div className="flex items-start gap-3 border-b border-stone-100 py-3 last:border-b-0">
      <CheckIcon status={check.status} />
      <div className="flex-1">
        <p className="text-sm font-medium text-stone-900">{check.label}</p>
        <p className="mt-0.5 text-xs text-stone-600">{check.message}</p>
      </div>
      <p className="shrink-0 text-xs tabular-nums text-stone-400">
        {check.durationMs > 0 ? `${check.durationMs} ms` : "—"}
      </p>
    </div>
  );
}

function summaryTone(report: VerificationReport): {
  border: string;
  bg: string;
  text: string;
  heading: string;
  subheading: string;
} {
  if (report.ok) {
    return {
      border: "border-emerald-200",
      bg: "bg-emerald-50",
      text: "text-emerald-800",
      heading: "All read endpoints passed.",
      subheading:
        "The read pipeline is working against the configured environment. Note that endpoints remain unverified against Tradovate's official spec until reviewed against documentation.",
    };
  }
  if (report.tokenStatus !== "valid") {
    return {
      border: "border-orange-200",
      bg: "bg-orange-50",
      text: "text-orange-800",
      heading: "Token / authorization issue.",
      subheading:
        "The token check failed — re-authorize the Tradovate connection to continue.",
    };
  }
  return {
    border: "border-amber-200",
    bg: "bg-amber-50",
    text: "text-amber-800",
    heading: "Some checks failed.",
    subheading:
      "Tokens loaded but one or more endpoints did not return as expected. Review the failing checks below and verify the Tradovate API documentation.",
  };
}

export default async function VerifyTradovatePage({
  searchParams,
}: {
  searchParams: Promise<{ accountId?: string }>;
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/login");

  const params = await searchParams;
  const accountId = params.accountId;

  if (!accountId) {
    return (
      <AppShell
        eyebrow="Tradovate"
        title="Verify connection"
        description="Provide an accountId query parameter to run the verification."
      >
        <SectionCard title="Missing accountId">
          <p className="text-sm text-stone-700">
            Open this page from the Accounts list — the link includes the
            account id.
          </p>
          <Link
            href="/accounts"
            className="mt-3 inline-flex rounded-full border border-stone-300 px-4 py-2 text-sm text-stone-800"
          >
            Back to accounts
          </Link>
        </SectionCard>
      </AppShell>
    );
  }

  const account = await prisma.connectedAccount.findUnique({
    where: { id: accountId },
    select: { id: true, label: true, userId: true, platform: true, isActive: true },
  });

  if (!account) notFound();
  if (account.userId !== currentUser.id) redirect("/accounts");
  if (account.platform !== "tradovate") redirect("/accounts");

  if (!account.isActive) {
    return (
      <AppShell
        eyebrow="Tradovate"
        title="Account disconnected"
        description="This broker account has been disconnected."
        actions={
          <Link
            href="/accounts"
            className="inline-flex rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-900 transition hover:border-stone-950"
          >
            Back to accounts
          </Link>
        }
      >
        <SectionCard title="Account not active">
          <p className="text-sm text-stone-700">
            This account was disconnected. Your rules, journal entries, and
            journal entries are still saved.
          </p>
          <Link
            href="/accounts/connect/tradovate"
            className="mt-4 inline-flex rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
          >
            Connect a new account
          </Link>
        </SectionCard>
      </AppShell>
    );
  }

  const report = await runTradovateVerification(accountId, currentUser.id);
  const summary = summaryTone(report);
  const tokenCopy = TOKEN_STATUS_COPY[report.tokenStatus];
  const connCopy =
    CONNECTION_STATUS_COPY[report.connectionStatus] ??
    CONNECTION_STATUS_COPY.disconnected;

  const passes = report.checks.filter((c) => c.status === "pass").length;
  const failures = report.checks.filter((c) => c.status === "fail").length;
  const skips = report.checks.filter((c) => c.status === "skip").length;

  return (
    <AppShell
      eyebrow="Tradovate"
      title={`Verify connection — ${account.label}`}
      description="Reads every Tradovate read endpoint and reports pass/fail per check. No tokens or raw payloads are shown."
      actions={
        <Link
          href="/accounts"
          className="inline-flex rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-900 transition hover:border-stone-950"
        >
          Back to accounts
        </Link>
      }
    >
      <div className="grid gap-6">
        {/* Summary */}
        <div className={`rounded-2xl border px-5 py-4 ${summary.border} ${summary.bg}`}>
          <p className={`text-sm font-semibold ${summary.text}`}>{summary.heading}</p>
          <p className="mt-1 text-sm text-stone-700">{summary.subheading}</p>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
            <span className="text-emerald-700">{passes} passed</span>
            <span className="text-red-700">{failures} failed</span>
            <span className="text-stone-500">{skips} skipped</span>
          </div>
        </div>

        {/* Statuses */}
        <SectionCard title="Status">
          <dl className="grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                Connection
              </dt>
              <dd className={`mt-1 text-sm font-medium ${connCopy.tone}`}>
                {connCopy.label}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                Token
              </dt>
              <dd className={`mt-1 text-sm font-medium ${tokenCopy.tone}`}>
                {tokenCopy.label}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                Last sync
              </dt>
              <dd className="mt-1 text-sm font-medium text-stone-800">
                {report.lastSyncAt
                  ? new Date(report.lastSyncAt).toLocaleString()
                  : "—"}
              </dd>
            </div>
          </dl>
          {(report.tokenStatus === "expired" || report.tokenStatus === "no_refresh") && (
            <div className="mt-4">
              <Link
                href="/accounts/connect/tradovate"
                className="inline-flex rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
              >
                Re-authorize Tradovate
              </Link>
            </div>
          )}
        </SectionCard>

        {/* Account list */}
        {report.accountList.length > 0 && (() => {
          const hasSimDemo = report.accountList.some(
            (a) => a.category === "demo" || a.category === "sim",
          );
          return (
            <>
              {hasSimDemo ? (
                <div className="rounded-2xl border border-sky-200 bg-sky-50 px-5 py-3 text-sm">
                  <p className="font-medium text-sky-900">Demo/sim account detected.</p>
                  <p className="mt-0.5 text-stone-700">
                    You can use this account for Guardrail testing.
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl border border-stone-200 bg-stone-50 px-5 py-3 text-sm text-stone-600">
                  No demo/sim account was detected through this OAuth token.
                </div>
              )}
              <SectionCard
                title="Accounts visible via this token"
                description="All accounts returned by account/list. No tokens or secrets shown."
              >
                <div className="grid gap-0">
                  <div className="flex flex-wrap items-center gap-3 border-b border-stone-100 pb-2 text-xs font-semibold uppercase tracking-[0.14em] text-stone-400">
                    <span className="w-20 shrink-0">ID</span>
                    <span className="flex-1">Name</span>
                    <span>Type</span>
                    <span>Status</span>
                    <span>Category</span>
                  </div>
                  {report.accountList.map((a) => (
                    <AccountRow key={a.id} account={a} />
                  ))}
                </div>
              </SectionCard>
            </>
          );
        })()}

        {/* Checks */}
        <SectionCard
          title="Read-endpoint checks"
          description="Each Tradovate read endpoint runs once. A failing endpoint does not abort the others."
        >
          <div>
            {report.checks.map((check) => (
              <CheckRow key={check.name} check={check} />
            ))}
          </div>
        </SectionCard>

        {/* Warnings */}
        {report.warnings.length > 0 && (
          <SectionCard title="Warnings">
            <ul className="grid gap-1 text-sm text-amber-800">
              {report.warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </SectionCard>
        )}

        {/* Developer details (collapsible). No tokens, no raw upstream payloads. */}
        <details className="rounded-2xl border border-stone-200 bg-stone-50 px-5 py-4 text-sm">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
            Developer details
          </summary>
          <div className="mt-3 grid gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                Endpoint timings
              </p>
              <table className="mt-2 w-full text-xs">
                <thead>
                  <tr className="text-left text-stone-500">
                    <th className="py-1 pr-4 font-medium">name</th>
                    <th className="py-1 pr-4 font-medium">status</th>
                    <th className="py-1 pr-4 font-medium">errorCode</th>
                    <th className="py-1 pr-4 font-medium">durationMs</th>
                  </tr>
                </thead>
                <tbody>
                  {report.checks.map((c) => (
                    <tr key={c.name} className="border-t border-stone-200/60">
                      <td className="py-1 pr-4 font-mono">{c.name}</td>
                      <td className="py-1 pr-4">{c.status}</td>
                      <td className="py-1 pr-4 font-mono text-stone-600">
                        {c.errorCode ?? "—"}
                      </td>
                      <td className="py-1 pr-4 tabular-nums">{c.durationMs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                Normalized snapshot summary
              </p>
              <ul className="mt-2 grid gap-1 text-xs text-stone-700">
                <li>
                  account: {report.snapshot.account ? "present" : "—"}
                  {report.snapshot.account &&
                    ` (label ${report.snapshot.account.label}, balance ${
                      report.snapshot.account.balance ?? "n/a"
                    })`}
                </li>
                <li>positions: {report.snapshot.positions?.length ?? "—"}</li>
                <li>orders: {report.snapshot.orders?.length ?? "—"}</li>
                <li>executions: {report.snapshot.executions?.length ?? "—"}</li>
              </ul>
              <p className="mt-2 text-xs text-stone-500">
                Token values and raw upstream payloads are intentionally
                omitted from this view.
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                Raw report (JSON)
              </p>
              <p className="mt-1 text-xs text-stone-600">
                Open the JSON endpoint in a new tab:{" "}
                <a
                  href={`/api/brokers/tradovate/snapshot?accountId=${accountId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-sky-700 underline-offset-2 hover:underline"
                >
                  /api/brokers/tradovate/snapshot?accountId={accountId} ↗
                </a>
              </p>
            </div>
          </div>
        </details>

        {/* Footer caveat */}
        <p className="text-xs text-stone-500">
          ⚠ Tradovate REST endpoints in this build are based on documented
          shapes but are unverified against a real account. Broker data is
          not yet wired into Dashboard or Guardian risk evaluation.
        </p>
      </div>
    </AppShell>
  );
}
