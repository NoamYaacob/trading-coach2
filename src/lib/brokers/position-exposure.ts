/**
 * Pure helper for computing mini-equivalent position exposure.
 *
 * Tradovate's risk system can express per-product position limits
 * (UserAccountPositionLimit) but cannot express the equivalence
 * between mini and micro contracts (e.g. 1 NQ = 10 MNQ counting toward
 * the same shared limit). This helper does that computation
 * Guardrail-side so a single "max position size" rule can be evaluated
 * against the user's full mini-equivalent exposure.
 *
 * No I/O. No broker calls. No DB. Pure and deterministic.
 *
 * Internally, exposure is tracked in integer "tenths of a mini" to
 * avoid floating-point drift at the breach boundary:
 *   1 mini  = 10 tenths
 *   1 micro = 1 tenth
 * Public values are divided by 10 only for display.
 */

export type PositionExposureInput = {
  symbol: string;
  netPos: number;
};

export type ExposureResult = {
  totalMiniEquivalent: number;
  byRoot: Array<{
    root: string;
    positions: Array<{
      symbol: string;
      netPos: number;
      miniEquivalent: number;
    }>;
    totalMiniEquivalent: number;
  }>;
  unsupported: Array<{
    symbol: string;
    netPos: number;
    reason: string;
  }>;
};

const TENTHS_PER_MINI = 10;

// Map of contract root → tenths-per-contract and the shared group key
// under which mini and its micro pair are summed.
//
// Pairs encoded:
//   NQ  ↔ MNQ  (1:10)
//   ES  ↔ MES  (1:10)
//   YM  ↔ MYM  (1:10)
//   RTY ↔ M2K  (1:10)   — note: micro root is M2K, not MRTY
//   GC  ↔ MGC  (1:10)
//   CL  ↔ MCL  (1:10)
const KNOWN_ROOTS = {
  NQ:  { tenths: 10, group: "NQ"  },
  MNQ: { tenths: 1,  group: "NQ"  },
  ES:  { tenths: 10, group: "ES"  },
  MES: { tenths: 1,  group: "ES"  },
  YM:  { tenths: 10, group: "YM"  },
  MYM: { tenths: 1,  group: "YM"  },
  RTY: { tenths: 10, group: "RTY" },
  M2K: { tenths: 1,  group: "RTY" },
  GC:  { tenths: 10, group: "GC"  },
  MGC: { tenths: 1,  group: "GC"  },
  CL:  { tenths: 10, group: "CL"  },
  MCL: { tenths: 1,  group: "CL"  },
} as const;

type KnownRoot = keyof typeof KNOWN_ROOTS;

// Sorted longest-first so prefix matching prefers MNQ over NQ.
const ROOT_KEYS_LONGEST_FIRST = Object.keys(KNOWN_ROOTS).sort(
  (a, b) => b.length - a.length,
) as KnownRoot[];

function extractRoot(symbol: string): KnownRoot | null {
  const upper = symbol.toUpperCase();
  for (const root of ROOT_KEYS_LONGEST_FIRST) {
    if (upper === root || upper.startsWith(root)) return root;
  }
  return null;
}

export function computeMiniEquivalentExposure(
  positions: PositionExposureInput[],
): ExposureResult {
  const groupBuckets = new Map<
    string,
    {
      root: string;
      positions: Array<{ symbol: string; netPos: number; miniEquivalent: number }>;
      totalTenths: number;
    }
  >();
  const unsupported: ExposureResult["unsupported"] = [];
  let totalTenths = 0;

  for (const pos of positions) {
    if (pos.netPos === 0) continue;

    const root = extractRoot(pos.symbol);
    if (root === null) {
      unsupported.push({
        symbol: pos.symbol,
        netPos: pos.netPos,
        reason: "Unknown root — not in known mini/micro pair table",
      });
      continue;
    }

    const { tenths, group } = KNOWN_ROOTS[root];
    const exposureTenths = Math.abs(pos.netPos) * tenths;
    totalTenths += exposureTenths;

    let bucket = groupBuckets.get(group);
    if (!bucket) {
      bucket = { root: group, positions: [], totalTenths: 0 };
      groupBuckets.set(group, bucket);
    }
    bucket.positions.push({
      symbol: pos.symbol,
      netPos: pos.netPos,
      miniEquivalent: exposureTenths / TENTHS_PER_MINI,
    });
    bucket.totalTenths += exposureTenths;
  }

  return {
    totalMiniEquivalent: totalTenths / TENTHS_PER_MINI,
    byRoot: Array.from(groupBuckets.values()).map((b) => ({
      root: b.root,
      positions: b.positions,
      totalMiniEquivalent: b.totalTenths / TENTHS_PER_MINI,
    })),
    unsupported,
  };
}

/**
 * Returns true if total mini-equivalent exposure strictly exceeds the
 * configured limit. Equality is allowed.
 *
 * - maxPositionSize === null → no rule configured, never breaches.
 * - maxPositionSize === 0    → any non-zero exposure breaches.
 * - maxPositionSize  <  0    → invalid, treated as no rule (never breaches).
 *
 * Comparison is performed in integer tenths-of-a-mini to neutralize
 * IEEE-754 drift at the boundary (e.g. 11 * 0.1 === 1.1000000000000001).
 */
export function isMaxPositionSizeBreached(
  totalMiniEquivalent: number,
  maxPositionSize: number | null,
): boolean {
  if (maxPositionSize === null) return false;
  if (maxPositionSize < 0) return false;
  const totalTenths = Math.round(totalMiniEquivalent * TENTHS_PER_MINI);
  const limitTenths = Math.round(maxPositionSize * TENTHS_PER_MINI);
  return totalTenths > limitTenths;
}
