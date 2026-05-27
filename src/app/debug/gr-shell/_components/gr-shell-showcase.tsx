/**
 * GrShellShowcase — client component for the /debug/gr-shell page.
 *
 * Shows the full G2 design-system primitive library inside GrShell.
 * All values are hardcoded mock/preview data.
 */

"use client";

import React, { useState } from "react";
import { GrShell } from "@/components/ui/gr-shell";
import { GrIcon } from "@/components/ui/gr/gr-icon";
import type { GrIconName } from "@/components/ui/gr/gr-icon";
import { GrDot } from "@/components/ui/gr/gr-dot";
import { GrBadge } from "@/components/ui/gr/gr-badge";
import { GrButton } from "@/components/ui/gr/gr-button";
import { GrInput } from "@/components/ui/gr/gr-input";
import { GrChip } from "@/components/ui/gr/gr-chip";
import { GrProgress } from "@/components/ui/gr/gr-progress";
import { GrEnforcementChip } from "@/components/ui/gr/gr-enforcement-chip";
import type { RuleStatusVariant } from "@/app/rules/_components/rule-status-badge-helpers";

// ── Section wrapper ───────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 40 }}>
      <h2
        style={{
          fontSize: "11px",
          fontWeight: 500,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--gr-text-mute)",
          marginBottom: 12,
          paddingBottom: 8,
          borderBottom: "1px solid var(--gr-border)",
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

// ── Icons grid ────────────────────────────────────────────────

const ALL_ICONS: GrIconName[] = [
  "plus", "chevR", "chevD", "chevL", "check", "x",
  "search", "settings", "refresh", "bell", "shield", "clock",
  "user", "chart", "target", "cal", "download", "copy",
  "lock", "bolt", "info", "edit", "more", "home",
  "arrowR", "sparkle", "list", "grid", "pause", "bookmark",
  "menu", "plug", "warn",
];

function IconGrid() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))",
        gap: 8,
      }}
    >
      {ALL_ICONS.map((name) => (
        <div
          key={name}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
            padding: "10px 8px",
            background: "var(--gr-surface)",
            border: "1px solid var(--gr-border)",
            borderRadius: "var(--gr-r-md)",
          }}
        >
          <GrIcon name={name} size="lg" style={{ color: "var(--gr-text-mid)" }} />
          <span
            style={{
              fontSize: "10px",
              color: "var(--gr-text-mute)",
              fontFamily: "monospace",
            }}
          >
            {name}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Token swatches ────────────────────────────────────────────

const SWATCH_GROUPS = [
  {
    label: "Surfaces",
    swatches: [
      { label: "--gr-bg",           var: "--gr-bg" },
      { label: "--gr-bg-elev",      var: "--gr-bg-elev" },
      { label: "--gr-surface",      var: "--gr-surface" },
      { label: "--gr-surface-warm", var: "--gr-surface-warm" },
      { label: "--gr-surface-hi",   var: "--gr-surface-hi" },
    ],
  },
  {
    label: "Ink / Text",
    swatches: [
      { label: "--gr-ink",        var: "--gr-ink" },
      { label: "--gr-text",       var: "--gr-text" },
      { label: "--gr-text-mid",   var: "--gr-text-mid" },
      { label: "--gr-text-mute",  var: "--gr-text-mute" },
      { label: "--gr-text-faint", var: "--gr-text-faint" },
    ],
  },
  {
    label: "Copper",
    swatches: [
      { label: "--gr-copper",    var: "--gr-copper" },
      { label: "--gr-copper-hi", var: "--gr-copper-hi" },
      { label: "--gr-copper-bg", var: "--gr-copper-bg" },
    ],
  },
  {
    label: "Enforcement",
    swatches: [
      { label: "--gr-broker",   var: "--gr-broker" },
      { label: "--gr-lock",     var: "--gr-lock" },
      { label: "--gr-mon",      var: "--gr-mon" },
      { label: "--gr-saved",    var: "--gr-saved" },
      { label: "--gr-plan",     var: "--gr-plan" },
    ],
  },
  {
    label: "State",
    swatches: [
      { label: "--gr-ok",   var: "--gr-ok" },
      { label: "--gr-warn", var: "--gr-warn" },
      { label: "--gr-bad",  var: "--gr-bad" },
    ],
  },
];

function TokenSwatches() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {SWATCH_GROUPS.map((g) => (
        <div key={g.label}>
          <div
            style={{
              fontSize: "11px",
              fontWeight: 500,
              color: "var(--gr-text-mute)",
              marginBottom: 6,
            }}
          >
            {g.label}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {g.swatches.map((s) => (
              <div
                key={s.var}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 10px",
                  background: "var(--gr-surface)",
                  border: "1px solid var(--gr-border)",
                  borderRadius: "var(--gr-r-sm)",
                }}
              >
                <div
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 4,
                    background: `var(${s.var})`,
                    border: "1px solid var(--gr-border)",
                    flexShrink: 0,
                  }}
                />
                <code style={{ fontSize: "10.5px", color: "var(--gr-text-mute)" }}>
                  {s.label}
                </code>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Enforcement chips ─────────────────────────────────────────

const ALL_RULE_VARIANTS: { variant: RuleStatusVariant; label: string }[] = [
  { variant: "broker-eligible",  label: "broker-eligible" },
  { variant: "guardrail-lock",   label: "guardrail-lock" },
  { variant: "monitoring-only",  label: "monitoring-only" },
  { variant: "saved-eval-soon",  label: "saved-eval-soon" },
  { variant: "planned-broker",   label: "planned-broker" },
  { variant: "not-active",       label: "not-active" },
];

// ── Main showcase ─────────────────────────────────────────────

export function GrShellShowcase() {
  const [activeChip, setActiveChip] = useState("All");
  const [inputVal, setInputVal] = useState("");

  return (
    <GrShell breadcrumb={["Debug", "GR2 Shell Preview"]}>
      <div style={{ padding: "32px 40px", maxWidth: 960 }}>
        {/* Header banner */}
        <div
          style={{
            background: "var(--gr-warn-bg)",
            border: "1px solid var(--gr-warn-bd)",
            borderRadius: "var(--gr-r-md)",
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 32,
            color: "var(--gr-warn)",
            fontSize: "13px",
          }}
        >
          <GrIcon name="warn" size="sm" />
          <strong>Design system preview</strong> — not a production page.
          All data is mock. No real accounts, balances, or P&amp;L shown here.
          Not linked from production navigation.
        </div>

        {/* Icons */}
        <Section title="GrIcon — all icons (16×16 viewBox, 4 sizes)">
          <IconGrid />
        </Section>

        {/* Dots */}
        <Section title="GrDot — enforcement + state colours">
          <Row>
            {(["broker", "lock", "mon", "saved", "plan", "ok", "warn", "bad", "copper", "neutral"] as const).map(
              (v) => (
                <div
                  key={v}
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  <GrDot variant={v} />
                  <span
                    style={{ fontSize: "12px", color: "var(--gr-text-mute)" }}
                  >
                    {v}
                  </span>
                </div>
              ),
            )}
          </Row>
          <Row>
            <GrDot variant="warn" pulse />
            <span style={{ fontSize: "12px", color: "var(--gr-text-mute)" }}>
              pulse animation
            </span>
            <GrDot variant="broker" size="lg" />
            <span style={{ fontSize: "12px", color: "var(--gr-text-mute)" }}>
              size lg (8×8)
            </span>
          </Row>
        </Section>

        {/* Badges */}
        <Section title="GrBadge — status + enforcement variants">
          <Row>
            <GrBadge variant="ok">OK</GrBadge>
            <GrBadge variant="warn">Warning</GrBadge>
            <GrBadge variant="bad">Error</GrBadge>
            <GrBadge variant="neutral">Neutral</GrBadge>
            <GrBadge variant="broker">Broker-backed</GrBadge>
            <GrBadge variant="lock">App lock</GrBadge>
            <GrBadge variant="mon">Monitor</GrBadge>
            <GrBadge variant="saved">Saved</GrBadge>
            <GrBadge variant="plan">Planned</GrBadge>
            <GrBadge variant="copper">Copper</GrBadge>
          </Row>
        </Section>

        {/* Enforcement chips */}
        <Section title="GrEnforcementChip — all RuleStatusVariant values">
          <Row>
            {ALL_RULE_VARIANTS.map(({ variant, label }) => (
              <div
                key={variant}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}
              >
                <GrEnforcementChip variant={variant} showIcon />
                <code
                  style={{ fontSize: "9.5px", color: "var(--gr-text-faint)" }}
                >
                  {label}
                </code>
              </div>
            ))}
          </Row>
          <Row>
            {ALL_RULE_VARIANTS.map(({ variant }) => (
              <GrEnforcementChip key={variant} variant={variant} showTooltip />
            ))}
          </Row>
          <p
            style={{
              fontSize: "11px",
              color: "var(--gr-text-mute)",
              marginTop: 4,
            }}
          >
            Row 1: with icon. Row 2: hover to see tooltip.
          </p>
        </Section>

        {/* Buttons */}
        <Section title="GrButton — variants × sizes">
          <Row>
            <GrButton>Default</GrButton>
            <GrButton variant="primary">Primary</GrButton>
            <GrButton variant="ink">Ink</GrButton>
            <GrButton variant="ghost">Ghost</GrButton>
            <GrButton disabled>Disabled</GrButton>
          </Row>
          <Row>
            <GrButton size="sm">Small</GrButton>
            <GrButton size="sm" variant="primary">
              Small primary
            </GrButton>
            <GrButton size="icon" aria-label="Settings">
              <GrIcon name="settings" />
            </GrButton>
            <GrButton size="icon" variant="ghost" aria-label="Bell">
              <GrIcon name="bell" />
            </GrButton>
          </Row>
        </Section>

        {/* Inputs */}
        <Section title="GrInput — plain + affixed">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            <GrInput
              placeholder="Plain input"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
            />
            <GrInput prefix="$" placeholder="1 200" type="number" />
            <GrInput suffix="CT" placeholder="0" type="number" />
            <GrInput
              prefix="$"
              suffix="/ day"
              placeholder="500"
              type="number"
            />
          </div>
        </Section>

        {/* Chips */}
        <Section title="GrChip — filter pills">
          <Row>
            {["All", "Capital", "Discipline", "Sizing", "Schedule", "Alerts"].map(
              (label) => (
                <GrChip
                  key={label}
                  active={activeChip === label}
                  onClick={() => setActiveChip(label)}
                >
                  {label}
                </GrChip>
              ),
            )}
          </Row>
        </Section>

        {/* Progress */}
        <Section title="GrProgress — usage bars">
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 400 }}>
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "11px",
                  color: "var(--gr-text-mute)",
                  marginBottom: 4,
                }}
              >
                <span>default — 30%</span>
              </div>
              <GrProgress value={30} />
            </div>
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "11px",
                  color: "var(--gr-text-mute)",
                  marginBottom: 4,
                }}
              >
                <span>ok — 55%</span>
              </div>
              <GrProgress value={55} variant="ok" />
            </div>
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "11px",
                  color: "var(--gr-text-mute)",
                  marginBottom: 4,
                }}
              >
                <span>warn — 70%</span>
              </div>
              <GrProgress value={70} variant="warn" />
            </div>
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "11px",
                  color: "var(--gr-text-mute)",
                  marginBottom: 4,
                }}
              >
                <span>bad — 92%</span>
              </div>
              <GrProgress value={92} variant="bad" size="thick" />
            </div>
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "11px",
                  color: "var(--gr-text-mute)",
                  marginBottom: 4,
                }}
              >
                <span>copper thin — 45%</span>
              </div>
              <GrProgress value={45} variant="copper" size="thin" />
            </div>
          </div>
        </Section>

        {/* Token swatches */}
        <Section title="CSS tokens — visual reference">
          <TokenSwatches />
        </Section>
      </div>
    </GrShell>
  );
}
