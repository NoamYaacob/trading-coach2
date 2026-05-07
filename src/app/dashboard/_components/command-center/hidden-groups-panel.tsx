"use client";

import { useState } from "react";

import type { CommandCenterFirmGroup } from "./types";

type Props = {
  groups: CommandCenterFirmGroup[];
  showHidden: boolean;
  onToggleShow: () => void;
  onUnhide: (groupId: string) => void;
};

export function HiddenGroupsPanel({ groups, showHidden, onToggleShow, onUnhide }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (groups.length === 0) return null;

  return (
    <div className="mt-2 rounded-xl border border-stone-200 bg-stone-50/40 px-3 py-2 text-xs text-stone-600">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1.5 font-medium text-stone-700 hover:text-stone-950"
          aria-expanded={expanded}
        >
          <span aria-hidden>{expanded ? "▾" : "▸"}</span>
          <span>
            Hidden groups ({groups.length})
          </span>
        </button>
        <button
          type="button"
          onClick={onToggleShow}
          className="inline-flex h-7 items-center rounded-full border border-stone-200 bg-white px-3 text-[11px] font-medium text-stone-600 transition hover:border-stone-300 hover:text-stone-950"
        >
          {showHidden ? "Hide hidden" : "Show hidden"}
        </button>
      </div>
      <p className="mt-1 text-[10px] text-stone-400">
        Hidden groups are excluded from this list, not from monitoring. Sync,
        enforcement, and risk tracking continue normally for these accounts.
      </p>
      {expanded && (
        <ul className="mt-2 grid gap-1.5">
          {groups.map((group) => (
            <li
              key={group.groupId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white px-3 py-1.5"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-stone-800">
                  {group.firmLabel}
                </p>
                <p className="text-[10px] text-stone-500">
                  {group.accounts.length}{" "}
                  {group.accounts.length === 1 ? "account" : "accounts"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onUnhide(group.groupId)}
                className="inline-flex h-7 items-center rounded-full bg-stone-900 px-3 text-[11px] font-medium text-stone-50 transition hover:bg-stone-700"
              >
                Unhide group
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
