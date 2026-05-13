/**
 * Backward-compatibility shim: re-exports the equivalent helpers from the
 * central futures contract registry at src/lib/futures/contracts.ts.
 *
 * New code should import from "@/lib/futures/contracts" directly.
 */

import {
  getExposureRatioToParent,
  toRawContractLimit as registryToRawContractLimit,
  getSupportedRoots,
  effectiveSupportedRawLimits,
} from "../futures/contracts.ts";

const SUPPORTED_SET = new Set(getSupportedRoots());

export function getMiniEquivalentMultiplier(symbolRoot: string): number {
  return getExposureRatioToParent(symbolRoot);
}

export function toRawContractLimit(maxMiniEquivalent: number, symbolRoot: string): number {
  return registryToRawContractLimit(maxMiniEquivalent, symbolRoot);
}

export function isSupportedSymbolRoot(symbolRoot: string): boolean {
  return SUPPORTED_SET.has(symbolRoot.toUpperCase());
}

export function getSupportedSymbolRoots(): string[] {
  return getSupportedRoots();
}

export { effectiveSupportedRawLimits as effectiveRawLimits };
