/**
 * Pure step-value helper for NumberStepperInput.
 * Lives in its own .ts file (no JSX) so it can be imported directly by
 * node:test without loading the React/JSX context of field-primitives.tsx.
 *
 * Behaviour:
 *   - blank + delta > 0  → String(min ?? 1)   (first click sets to minimum)
 *   - blank + delta < 0  → ""                  (no-op, can't decrement nothing)
 *   - at min boundary    → returns current     (clamps, no-op)
 *   - at max boundary    → returns current     (clamps, no-op)
 *   - non-numeric string → returns current     (no-op)
 */
export function stepValue(
  current: string,
  delta: number,
  min: number | undefined,
  max: number | undefined,
): string {
  if (current.trim() === "") {
    return delta > 0 ? String(min ?? 1) : current;
  }
  const n = parseInt(current, 10);
  if (!Number.isFinite(n)) return current;
  const next = n + delta;
  if (min !== undefined && next < min) return current;
  if (max !== undefined && next > max) return current;
  return String(next);
}
