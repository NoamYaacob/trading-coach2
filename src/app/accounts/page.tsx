import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTradovateConfig } from "@/lib/brokers/tradovate-env";
import { AccountCard } from "./_components/account-card";

export const metadata: Metadata = {
  title: "Accounts — Guardrail",
};

export default async function AccountsPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect("/login");
  }

  const [accounts, telegramConnection] = await Promise.all([
    prisma.connectedAccount.findMany({
      where: { userId: currentUser.id, isActive: true },
      include: {
        riskRules: true,
        sessionState: true,
        interventions: {
          orderBy: { createdAt: "desc" },
          take: 5,
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.telegramConnection.findUnique({
      where: { userId: currentUser.id },
      select: { telegramChatId: true },
    }),
  ]);

  const telegramReady = Boolean(telegramConnection?.telegramChatId);

  // Fetch last 10 events per account for the live event feed.
  // We over-fetch and group in JS to avoid per-group LIMIT queries.
  const recentEventsRaw =
    accounts.length > 0
      ? await prisma.normalizedTradeEvent.findMany({
          where: { accountId: { in: accounts.map((a) => a.id) } },
          orderBy: { occurredAt: "desc" },
          take: Math.max(accounts.length * 10, 50),
          select: { accountId: true, eventType: true, occurredAt: true, pnl: true, side: true },
        })
      : [];

  // Group events by account, keeping up to 10 per account.
  const eventsByAccount: Record<string, typeof recentEventsRaw> = {};
  for (const ev of recentEventsRaw) {
    const bucket = (eventsByAccount[ev.accountId] ??= []);
    if (bucket.length < 10) bucket.push(ev);
  }

  const hasTradovate = accounts.some((a) => a.platform === "tradovate");
  const tradovateConfigured = getTradovateConfig().state === "ready";

  const ctaHref = hasTradovate
    ? "/accounts/tradovate/verify"
    : "/accounts/connect/tradovate";
  const ctaLabel = hasTradovate
    ? "Verify connection"
    : tradovateConfigured
      ? "Connect Tradovate"
      : "Prepare Tradovate connection";

  return (
    <AppShell
      eyebrow="Accounts"
      title="Connect your broker."
      description="Link Tradovate so Guardrail can verify your account and prepare live risk checks."
      actions={
        <Link
          href={ctaHref}
          className="inline-flex rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
        >
          {ctaLabel}
        </Link>
      }
    >
      <div className="grid gap-6 -mb-6 sm:mb-0">

        {/* Compact status row */}
        <div className="grid gap-3 sm:grid-cols-3">
          <StatusTile
            tone={hasTradovate ? "ok" : "neutral"}
            label="Setup mode"
            value={hasTradovate ? "Broker connected" : "Before broker connection"}
          />
          <StatusTile
            tone={hasTradovate ? "ok" : "pending"}
            label="Tradovate"
            value={hasTradovate ? "Connected" : "Setup needed"}
          />
          <StatusTile
            tone={hasTradovate ? "pending" : "neutral"}
            label="Broker risk checks"
            value={hasTradovate ? "Pending verification" : "Connection not verified yet"}
          />
        </div>

        {accounts.length === 0 ? (
          <SectionCard title="No broker connected yet">
            <p className="text-sm text-stone-600">
              Connect Tradovate to move from setup mode into broker-connected protection.
            </p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href="/accounts/connect/tradovate"
                className="inline-flex rounded-full bg-stone-950 px-5 py-2.5 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
              >
                Connect Tradovate
              </Link>
            </div>
            <p className="mt-4 text-xs text-stone-500">
              You can set rules before connecting, but live broker-based checks require a verified connection.
            </p>
          </SectionCard>
        ) : (
          <>
            {accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                recentEvents={eventsByAccount[account.id] ?? []}
                telegramReady={telegramReady}
              />
            ))}
            {!hasTradovate && (
              <div className="rounded-2xl border border-stone-200 bg-stone-50 px-5 py-4">
                <p className="text-sm text-stone-600">
                  Add Tradovate for live broker-based risk checks.{" "}
                  <Link
                    href="/accounts/connect/tradovate"
                    className="font-medium text-stone-950 underline-offset-2 hover:underline"
                  >
                    Connect Tradovate
                  </Link>
                </p>
              </div>
            )}
          </>
        )}

        {/* Connection status — collapsible */}
        <details className="group rounded-2xl border border-stone-200 bg-white/90 px-5 py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-stone-950">
            Connection status
            <span className="text-xs font-normal text-stone-400 transition-transform group-open:rotate-45">+</span>
          </summary>
          <div className="mt-4">
            <p className="text-sm text-stone-500">
              Manual mode is available now. Broker-connected protection will become available after setup is complete.
            </p>
            <div className="mt-4 grid gap-3">
              <ConnectionStatusRow
                label="Manual mode"
                status="Available"
                statusTone="ok"
                description="Track trades manually and evaluate your rules from journal entries."
              />
              <ConnectionStatusRow
                label="Tradovate connection"
                status="Setup needed"
                statusTone="pending"
                description="Read-only broker data will be available after Tradovate setup is complete."
              />
              <ConnectionStatusRow
                label="Broker-side actions"
                status="Disabled"
                statusTone="neutral"
                description="Cancel, flatten, and lockout actions require separate verification and explicit opt-in."
              />
            </div>
          </div>
        </details>

      </div>
    </AppShell>
  );
}

function ConnectionStatusRow({
  label,
  status,
  statusTone,
  description,
}: {
  label: string;
  status: string;
  statusTone: "ok" | "pending" | "neutral";
  description: string;
}) {
  const pillCls =
    statusTone === "ok"
      ? "bg-emerald-100 text-emerald-700"
      : statusTone === "pending"
        ? "bg-amber-100 text-amber-700"
        : "bg-stone-100 text-stone-500";
  return (
    <div className="rounded-xl border border-stone-100 bg-stone-50 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-stone-950">{label}</p>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${pillCls}`}>
          {status}
        </span>
      </div>
      <p className="mt-1.5 text-xs leading-5 text-stone-600">{description}</p>
    </div>
  );
}

function StatusTile({
  tone,
  label,
  value,
}: {
  tone: "ok" | "pending" | "neutral";
  label: string;
  value: string;
}) {
  const cls =
    tone === "ok"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "pending"
        ? "border-amber-200 bg-amber-50"
        : "border-stone-200 bg-stone-50";
  const valueCls =
    tone === "ok"
      ? "text-emerald-800"
      : tone === "pending"
        ? "text-amber-800"
        : "text-stone-700";
  return (
    <div className={`rounded-2xl border px-4 py-3 ${cls}`}>
      <p className="text-xs font-medium text-stone-600">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${valueCls}`}>{value}</p>
    </div>
  );
}
