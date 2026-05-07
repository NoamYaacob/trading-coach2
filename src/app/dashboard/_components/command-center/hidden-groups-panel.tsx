"use client";

import { useId, useState } from "react";

import type { CommandCenterFirmGroup } from "./types";

type Props = {
  groups: CommandCenterFirmGroup[];
  onUnhide: (groupId: string) => void;
};

export function HiddenGroupsPanel({ groups, onUnhide }: Props) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  if (groups.length === 0) return null;

  return (
    <div className="mt-2 rounded-xl border border-stone-200 bg-white">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        aria-expanded={expanded}
        aria-controls={panelId}
      >
        <span className="text-xs font-medium text-stone-700">
          Hidden groups ({groups.length})
        </span>
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-stone-200 text-[11px] text-stone-500 transition"
          aria-hidden
        >
          {expanded ? "×" : "+"}
        </span>
      </button>

      {expanded && (
        <div id={panelId} className="border-t border-stone-100 px-4 pb-4 pt-3">
          <p className="text-[11px] leading-relaxed text-stone-400">
            Hidden groups are excluded from this view but remain fully monitored.
            Sync, enforcement, and risk tracking continue normally.
          </p>
          <ul className="mt-3 grid gap-2">
            {groups.map((group) => (
              <li
                key={group.groupId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-100 bg-stone-50/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-stone-800">
                    {group.firmLabel}
                  </p>
                  <p className="text-[10px] text-stone-400">
                    {group.accounts.length}{" "}
                    {group.accounts.length === 1 ? "account" : "accounts"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onUnhide(group.groupId)}
                  className="inline-flex h-7 items-center rounded-full bg-stone-900 px-3 text-[11px] font-medium text-stone-50 transition hover:bg-stone-700"
                >
                  Unhide
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
