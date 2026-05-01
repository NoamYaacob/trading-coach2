/**
 * Tradovate connection verification.
 *
 * Runs every read endpoint, captures pass/fail + duration per check, and
 * returns a structured report safe to render in a UI or return as JSON.
 *
 * No tokens or raw API payloads are included in the output. Errors are
 * sanitised to error codes and short messages.
 *
 * Token / auth failures short-circuit the rest of the checks. Endpoint
 * failures are isolated — one failing endpoint does not abort the others.
 */

import { prisma } from "@/lib/db";
import { TradovateClient } from "./tradovate-client";
import { TradovateClientError } from "./tradovate-client-helpers";
import {
  CHECK_LABELS,
  SKIP_NAMES,
  categorizeTvAccount,
  describeError,
  hasUnresolvedContracts,
  tokenStatusFromErr,
  type AccountCategory,
  type CheckName,
  type CheckStatus,
  type TokenStatus,
  type TvAccountSummary,
} from "./tradovate-verification-helpers";
import type {
  BrokerAccountSnapshot,
  BrokerConnectionStatus,
  BrokerExecution,
  BrokerOrder,
  BrokerPosition,
} from "./types";

export type {
  AccountCategory,
  CheckStatus,
  CheckName,
  TokenStatus,
  TvAccountSummary,
} from "./tradovate-verification-helpers";

// ── Public report shape ───────────────────────────────────────────────────────

export type VerificationCheck = {
  name: CheckName;
  label: string;
  status: CheckStatus;
  message: string;
  durationMs: number;
  errorCode?: string;
};

export type VerificationReport = {
  ok: boolean;
  connectionStatus: BrokerConnectionStatus;
  tokenStatus: TokenStatus;
  checks: VerificationCheck[];
  /** Safe summary of every account returned by account/list. No tokens. */
  accountList: TvAccountSummary[];
  snapshot: {
    account: BrokerAccountSnapshot | null;
    positions: BrokerPosition[] | null;
    orders: BrokerOrder[] | null;
    executions: BrokerExecution[] | null;
  };
  warnings: string[];
  lastSyncAt: string | null;
};

// ── Internals ─────────────────────────────────────────────────────────────────

type Timed<T> =
  | { ok: true; value: T; durationMs: number }
  | { ok: false; error: unknown; durationMs: number };

async function timed<T>(fn: () => Promise<T>): Promise<Timed<T>> {
  const start = Date.now();
  try {
    const value = await fn();
    return { ok: true, value, durationMs: Date.now() - start };
  } catch (error) {
    return { ok: false, error, durationMs: Date.now() - start };
  }
}

function pass(name: CheckName, durationMs: number, message = "OK"): VerificationCheck {
  return { name, label: CHECK_LABELS[name], status: "pass", message, durationMs };
}

function fail(
  name: CheckName,
  durationMs: number,
  err: unknown,
): VerificationCheck {
  const { code, message } = describeError(err);
  return {
    name,
    label: CHECK_LABELS[name],
    status: "fail",
    message,
    errorCode: code,
    durationMs,
  };
}

function skip(name: CheckName, message: string): VerificationCheck {
  return { name, label: CHECK_LABELS[name], status: "skip", message, durationMs: 0 };
}

// ── Connection status (read-back from DB after side-effects) ──────────────────

async function readConnectionStatus(accountId: string): Promise<{
  connectionStatus: BrokerConnectionStatus;
  lastSyncAt: string | null;
}> {
  const row = await prisma.connectedAccount.findUnique({
    where: { id: accountId },
    select: { connectionStatus: true, lastSyncAt: true },
  });
  // Map our string lifecycle to the BrokerConnectionStatus union.
  const status = row?.connectionStatus ?? "not_connected";
  const broker: BrokerConnectionStatus =
    status === "expired"
      ? "expired"
      : status === "connection_error"
        ? "error"
        : status === "connected_live" || status === "connected_readonly"
          ? "connected"
          : "disconnected";
  return {
    connectionStatus: broker,
    lastSyncAt: row?.lastSyncAt ? row.lastSyncAt.toISOString() : null,
  };
}

// ── Public entry ──────────────────────────────────────────────────────────────

/**
 * Run the full Tradovate read-only verification flow against an account.
 *
 * Caller is responsible for confirming `userId` matches the authenticated
 * session before calling — TradovateClient will additionally enforce
 * ownership when loading tokens.
 */
export async function runTradovateVerification(
  accountId: string,
  userId: string,
): Promise<VerificationReport> {
  const checks: VerificationCheck[] = [];
  const warnings: string[] = [];
  const accountList: TvAccountSummary[] = [];
  const snapshot: VerificationReport["snapshot"] = {
    account: null,
    positions: null,
    orders: null,
    executions: null,
  };

  const client = new TradovateClient(accountId, userId);

  // ── 1. Token load and refresh ─────────────────────────────────────────────
  const init = await timed(() => client.initialize());

  if (!init.ok) {
    checks.push(fail("tokens", init.durationMs, init.error));
    for (const name of SKIP_NAMES) {
      checks.push(skip(name, "Skipped — token check failed."));
    }
    const tokenStatus = tokenStatusFromErr(init.error);
    const conn = await readConnectionStatus(accountId);
    return {
      ok: false,
      connectionStatus: conn.connectionStatus,
      tokenStatus,
      checks,
      accountList,
      snapshot,
      warnings,
      lastSyncAt: conn.lastSyncAt,
    };
  }

  checks.push(pass("tokens", init.durationMs, "Tokens loaded; refreshed if near expiry."));

  // ── 2. Account discovery ──────────────────────────────────────────────────
  const accountsResult = await timed(() => client.getAccounts());
  let tvAccountId: number | null = null;

  if (accountsResult.ok) {
    const list = accountsResult.value;

    // Map to safe summaries (no tokens, no raw payloads).
    for (const a of list) {
      accountList.push({
        id: a.id,
        name: a.name,
        accountType: a.accountType ?? null,
        status: a.status ?? null,
        active: a.active,
        archived: a.archived ?? false,
        category: categorizeTvAccount({ name: a.name, accountType: a.accountType }),
      });
    }

    // Safe server log — counts and categories only, never names or IDs.
    const categoryCounts = accountList.reduce<Record<AccountCategory, number>>(
      (acc, s) => { acc[s.category] = (acc[s.category] ?? 0) + 1; return acc; },
      {} as Record<AccountCategory, number>,
    );
    console.info("[tradovate/verify] account/list succeeded", {
      total: list.length,
      categoryCounts,
      hasDemo: categoryCounts.demo > 0,
      hasSim: categoryCounts.sim > 0,
    });

    const first = list.find((a) => a.active) ?? list[0];
    if (first) {
      tvAccountId = first.id;
      const existing = await prisma.connectedAccount.findUnique({
        where: { id: accountId },
        select: { externalAccountId: true },
      });
      if (existing && !existing.externalAccountId) {
        await prisma.connectedAccount.update({
          where: { id: accountId },
          data: { externalAccountId: String(first.id) },
        });
      }
      checks.push(
        pass(
          "account_discovery",
          accountsResult.durationMs,
          `Found ${list.length} account(s); using id ${first.id}.`,
        ),
      );
    } else {
      checks.push({
        name: "account_discovery",
        label: CHECK_LABELS.account_discovery,
        status: "fail",
        message: "No accounts returned for this OAuth token.",
        errorCode: "EMPTY_LIST",
        durationMs: accountsResult.durationMs,
      });
    }
  } else {
    console.warn("[tradovate/verify] account/list failed", {
      error: accountsResult.error instanceof Error
        ? accountsResult.error.message
        : "unknown",
    });
    checks.push(fail("account_discovery", accountsResult.durationMs, accountsResult.error));
  }

  // ── 3-6. Parallel reads (balance + positions + orders + executions) ──────
  const balancePromise: Promise<Timed<{ amount: number; realizedPnl: number | null } | null>> =
    tvAccountId !== null
      ? timed(async () => {
          const snap = await client.getCashBalanceSnapshot(tvAccountId!);
          return snap
            ? { amount: snap.amount, realizedPnl: snap.realizedPnl }
            : null;
        })
      : Promise.resolve({
          ok: false,
          error: new TradovateClientError(
            "API_ERROR",
            "Skipped — no Tradovate account ID available.",
          ),
          durationMs: 0,
        } satisfies Timed<{ amount: number; realizedPnl: number | null } | null>);

  const [balanceResult, positionsResult, ordersResult, executionsResult] =
    await Promise.all([
      balancePromise,
      timed(() => client.toPositions()),
      timed(() => client.toOrders()),
      timed(() => client.toExecutions()),
    ]);

  // Balance check + snapshot.account assembly
  if (balanceResult.ok) {
    checks.push(
      pass(
        "balance",
        balanceResult.durationMs,
        balanceResult.value
          ? `Balance ${balanceResult.value.amount}.`
          : "No balance snapshot returned.",
      ),
    );
    if (tvAccountId !== null) {
      snapshot.account = {
        accountId,
        label: String(tvAccountId),
        currency: "USD",
        balance: balanceResult.value?.amount ?? null,
        equity: null,
        todayPnL: balanceResult.value?.realizedPnl ?? null,
        asOf: new Date(),
      };
    }
  } else {
    checks.push(fail("balance", balanceResult.durationMs, balanceResult.error));
  }

  if (positionsResult.ok) {
    checks.push(
      pass(
        "positions",
        positionsResult.durationMs,
        `${positionsResult.value.length} open position(s).`,
      ),
    );
    snapshot.positions = positionsResult.value;
  } else {
    checks.push(fail("positions", positionsResult.durationMs, positionsResult.error));
  }

  if (ordersResult.ok) {
    checks.push(
      pass(
        "orders",
        ordersResult.durationMs,
        `${ordersResult.value.length} working order(s).`,
      ),
    );
    snapshot.orders = ordersResult.value;
  } else {
    checks.push(fail("orders", ordersResult.durationMs, ordersResult.error));
  }

  if (executionsResult.ok) {
    checks.push(
      pass(
        "executions",
        executionsResult.durationMs,
        `${executionsResult.value.length} fill(s) today (UTC).`,
      ),
    );
    snapshot.executions = executionsResult.value;
  } else {
    checks.push(fail("executions", executionsResult.durationMs, executionsResult.error));
  }

  // ── 7. Contract resolution ────────────────────────────────────────────────
  // Detected post-hoc: if any normalized symbol is purely numeric, contract
  // resolution silently fell back to contractId. Mark as fail (or skip if
  // there were no contracts to resolve).
  const positions = snapshot.positions ?? [];
  const orders = snapshot.orders ?? [];
  const executions = snapshot.executions ?? [];
  const totalContracts =
    positions.length + orders.length + executions.length;

  if (totalContracts === 0) {
    checks.push(
      skip("contracts", "No contracts to resolve (no open positions / orders / fills)."),
    );
  } else if (hasUnresolvedContracts(positions, orders, executions)) {
    checks.push({
      name: "contracts",
      label: CHECK_LABELS.contracts,
      status: "fail",
      message: "Some symbols fell back to numeric contract IDs.",
      errorCode: "UNRESOLVED",
      durationMs: 0,
    });
    warnings.push(
      "Contract symbol resolution failed for at least one contract — symbols shown as numeric IDs.",
    );
  } else {
    checks.push(pass("contracts", 0, "All contract IDs resolved to symbols."));
  }

  // ── Update lastSyncAt only if SOMETHING succeeded post-tokens ────────────
  const anyEndpointPassed = checks
    .filter((c) => c.name !== "tokens" && c.name !== "contracts")
    .some((c) => c.status === "pass");

  if (anyEndpointPassed) {
    await prisma.connectedAccount.update({
      where: { id: accountId },
      data: { lastSyncAt: new Date() },
    });
  }

  const ok = checks.every(
    (c) => c.status === "pass" || c.status === "skip",
  );

  const conn = await readConnectionStatus(accountId);

  return {
    ok,
    connectionStatus: conn.connectionStatus,
    tokenStatus: "valid",
    checks,
    accountList,
    snapshot,
    warnings,
    lastSyncAt: conn.lastSyncAt,
  };
}
