/**
 * GrAccountSelector — broker-grouped account switcher for the G2 shell.
 *
 * PRESENTATIONAL ONLY. All data is mock — this component renders no real
 * account information and must never be connected to live account data.
 * It is used exclusively in the /debug/gr-shell design-system showcase.
 *
 * Source: /tmp/guardrail-2/project/gr-shell.jsx  AccountSelector component.
 *
 * In a future phase this will accept real account data as props.
 * The mock data is clearly labelled "Preview — not real account data".
 */

"use client";

import React, { useState } from "react";
import { GrIcon } from "./gr-icon";
import { GrBadge } from "./gr-badge";
import { GrButton } from "./gr-button";

// ── Mock data ─────────────────────────────────────────────────
// These values are PREVIEW / MOCK ONLY.
// Never substitute real balance, P&L, or account references here.
type AccountState = "live" | "demo" | "expired";

type MockAccount = {
  id: string;
  name: string;
  ref: string;
  state: AccountState;
  balance: number;
};

type MockGroup = {
  broker: string;
  short: string;
  accounts: MockAccount[];
};

const MOCK_GROUPS: MockGroup[] = [
  {
    broker: "Apex Trader Funding",
    short: "Apex",
    accounts: [
      { id: "apex-1", name: "Eval $50K",  ref: "APEX-50-PREVIEW",  state: "live",    balance: 49160 },
      { id: "apex-2", name: "PA $100K",   ref: "APEX-100-PREVIEW", state: "live",    balance: 103420 },
    ],
  },
  {
    broker: "TopStep",
    short: "TopStep",
    accounts: [
      { id: "ts-1", name: "Combine $50K", ref: "TS-PREVIEW",      state: "live",    balance: 51200 },
    ],
  },
  {
    broker: "Tradovate",
    short: "Tradovate",
    accounts: [
      { id: "tv-1", name: "Personal · Demo", ref: "TV-DEMO-PREVIEW", state: "demo",    balance: 100000 },
      { id: "tv-2", name: "Sim Old",         ref: "TV-OLD-PREVIEW",  state: "expired", balance: 0 },
    ],
  },
];

// ── Component ─────────────────────────────────────────────────

export function GrAccountSelector() {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("apex-1");
  const [query, setQuery] = useState("");

  const allAccounts = MOCK_GROUPS.flatMap((g) => g.accounts);
  const selected = allAccounts.find((a) => a.id === selectedId) ?? allAccounts[0];
  const brokerShort = MOCK_GROUPS.find((g) =>
    g.accounts.some((a) => a.id === selected.id),
  )?.short ?? "";

  const filteredGroups = MOCK_GROUPS.map((g) => ({
    ...g,
    accounts: g.accounts.filter(
      (a) =>
        !query ||
        a.name.toLowerCase().includes(query.toLowerCase()) ||
        a.ref.toLowerCase().includes(query.toLowerCase()),
    ),
  })).filter((g) => g.accounts.length > 0);

  return (
    <div style={{ position: "relative" }}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Select account"
        style={{
          width: "100%",
          textAlign: "left",
          padding: "10px 12px",
          background: "var(--gr-surface)",
          border: "1px solid var(--gr-border)",
          borderRadius: "var(--gr-r-md)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 10,
          font: "inherit",
          color: "var(--gr-ink)",
        }}
      >
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            background: "var(--gr-copper-bg)",
            color: "var(--gr-copper)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            flexShrink: 0,
          }}
        >
          {brokerShort.slice(0, 2).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: "13.5px", fontWeight: 500, color: "var(--gr-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {brokerShort} · {selected.name}
            </span>
            <GrBadge variant={selected.state === "live" ? "ok" : selected.state === "demo" ? "neutral" : "bad"}>
              {selected.state}
            </GrBadge>
          </div>
          <span style={{ fontSize: "11px", fontFamily: "var(--font-ibm-plex-mono, monospace)", color: "var(--gr-text-mute)" }}>
            {selected.ref}
          </span>
        </div>
        <GrIcon name="chevD" size="sm" style={{ color: "var(--gr-text-mute)", flexShrink: 0 }} />
      </button>

      {/* Popover */}
      {open && (
        <>
          {/* Click-away */}
          <div
            aria-hidden
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 29 }}
          />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: 0,
              right: 0,
              background: "var(--gr-surface)",
              border: "1px solid var(--gr-border)",
              borderRadius: 11,
              boxShadow: "0 12px 32px -8px rgba(40,30,15,0.18), 0 2px 6px -2px rgba(40,30,15,0.10)",
              padding: 8,
              zIndex: 30,
              maxHeight: 360,
              overflowY: "auto",
            }}
          >
            {/* Preview label */}
            <div
              style={{
                fontSize: "10px",
                fontWeight: 500,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--gr-text-mute)",
                padding: "4px 10px 6px",
              }}
            >
              Preview — not real account data
            </div>

            {/* Search */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 0,
                background: "var(--gr-surface)",
                border: "1px solid var(--gr-border)",
                borderRadius: "var(--gr-r-md)",
                overflow: "hidden",
                marginBottom: 6,
              }}
            >
              <span
                style={{
                  padding: "0 8px",
                  color: "var(--gr-text-mute)",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <GrIcon name="search" size="sm" />
              </span>
              <input
                type="text"
                placeholder="Search accounts…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{
                  flex: 1,
                  border: "none",
                  outline: "none",
                  padding: "7px 10px 7px 0",
                  fontSize: 13,
                  fontFamily: "inherit",
                  background: "transparent",
                  color: "var(--gr-ink)",
                }}
              />
            </div>

            {/* Groups */}
            {filteredGroups.map((grp) => (
              <div key={grp.broker} style={{ marginTop: 4 }}>
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 500,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--gr-text-mute)",
                    padding: "8px 10px 4px",
                  }}
                >
                  {grp.broker}
                </div>
                {grp.accounts.map((a) => (
                  <div
                    key={a.id}
                    role="option"
                    aria-selected={a.id === selectedId}
                    onClick={() => {
                      setSelectedId(a.id);
                      setOpen(false);
                    }}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 7,
                      background: a.id === selectedId ? "var(--gr-surface-warm)" : "transparent",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      cursor: "pointer",
                      opacity: a.state === "expired" ? 0.6 : 1,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: a.id === selectedId ? 600 : 500, color: "var(--gr-ink)" }}>
                          {a.name}
                        </span>
                        {a.state === "live" && <GrBadge variant="ok">{a.state}</GrBadge>}
                        {a.state === "demo" && <GrBadge variant="neutral">{a.state}</GrBadge>}
                        {a.state === "expired" && <GrBadge variant="bad">reconnect</GrBadge>}
                      </div>
                      <span style={{ fontSize: "11px", fontFamily: "var(--font-ibm-plex-mono, monospace)", color: "var(--gr-text-mute)" }}>
                        {a.ref}
                      </span>
                    </div>
                    {a.state !== "expired" && a.balance > 0 && (
                      <span style={{ fontSize: "13px", fontFamily: "var(--font-ibm-plex-mono, monospace)", color: "var(--gr-text-mid)", fontVariantNumeric: "tabular-nums" }}>
                        ${a.balance.toLocaleString()}
                      </span>
                    )}
                    {a.state === "expired" && (
                      <GrButton size="sm" variant="ghost" style={{ color: "var(--gr-copper)" }}>
                        Reconnect
                      </GrButton>
                    )}
                    {a.id === selectedId && (
                      <GrIcon name="check" size="sm" style={{ color: "var(--gr-copper)" }} />
                    )}
                  </div>
                ))}
              </div>
            ))}

            <div style={{ borderTop: "1px solid var(--gr-border)", marginTop: 8, paddingTop: 8 }}>
              <GrButton
                variant="ghost"
                size="sm"
                style={{ width: "100%", justifyContent: "flex-start", color: "var(--gr-copper)" }}
              >
                <GrIcon name="plus" size="sm" />
                Connect another account
              </GrButton>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
