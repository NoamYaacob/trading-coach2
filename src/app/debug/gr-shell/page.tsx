/**
 * /debug/gr-shell — Guardrail 2 design-system showcase.
 *
 * GATED DEBUG PREVIEW — not linked from any production navigation.
 * URL: /debug/gr-shell
 *
 * Shows:
 *   1. GrShell layout (sidebar + header) with mock data
 *   2. All G2 primitives: GrIcon, GrDot, GrBadge, GrButton, GrInput,
 *      GrChip, GrProgress, GrEnforcementChip
 *   3. Enforcement chip for every RuleStatusVariant
 *   4. Token swatches for the full GR CSS token set
 *
 * SAFETY CONSTRAINTS (must be preserved in all edits):
 *   - No real account data, no real P&L, no real balances
 *   - No fake metrics presented as live or authoritative
 *   - No broker writes, no rule evaluation, no API calls
 *   - Clearly labelled as "Preview" / "Design system showcase"
 *   - Does not import or modify AppShell, Trading Plan, or any
 *     production rule evaluation code
 */

import type { Metadata } from "next";
import { GrShellShowcase } from "./_components/gr-shell-showcase";

export const metadata: Metadata = {
  title: "GR2 Shell Preview",
  robots: { index: false, follow: false },
};

export default function GrShellDebugPage() {
  return <GrShellShowcase />;
}
