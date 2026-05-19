"use client";

import { formatCmeHourLabel, isValidCmeHour } from "./cme-hour-parsing";

/**
 * Controlled dropdown for the Daily cutoff field.
 *
 * Values are stored as a string ("0".."23") to match the rest of the form's
 * string-based field state. The empty string represents "no cutoff selected".
 *
 * Using a select instead of <input type="number"> closes three live bugs:
 *   - "123" being silently accepted
 *   - "12 pm" being parsed as "2" by some browsers on paste
 *   - decimals slipping through despite step=1
 */
export function CmeHourSelect({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel?: string;
}) {
  const numeric = value.trim() === "" ? null : Number(value);
  const safeValue = numeric !== null && isValidCmeHour(numeric) ? String(numeric) : "";

  return (
    <select
      aria-label={ariaLabel}
      value={safeValue}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm focus:border-stone-950 focus:outline-none"
    >
      <option value="">No cutoff (uses default / inherited)</option>
      {Array.from({ length: 24 }, (_, h) => (
        <option key={h} value={String(h)}>
          {formatCmeHourLabel(h)}
          {h === 16 ? " — CME daily break / weekly close" : ""}
        </option>
      ))}
    </select>
  );
}
