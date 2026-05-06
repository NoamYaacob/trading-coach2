import test from "node:test";
import assert from "node:assert/strict";

import {
  PILL_ROW_PRIMARY,
  PILL_ROW_SECONDARY,
  PILL_PRIMARY,
  PILL_SECONDARY,
  PILL_DIALOG_PRIMARY,
  PILL_DIALOG_SECONDARY,
} from "./pill-classes.ts";

const ALIGNMENT_CLASSES = ["inline-flex", "items-center", "justify-center", "whitespace-nowrap"];

function assertAlignment(name: string, cls: string) {
  for (const c of ALIGNMENT_CLASSES) {
    assert.ok(cls.includes(c), `${name} is missing "${c}"`);
  }
}

test("PILL_ROW_PRIMARY has alignment classes", () => assertAlignment("PILL_ROW_PRIMARY", PILL_ROW_PRIMARY));
test("PILL_ROW_SECONDARY has alignment classes", () => assertAlignment("PILL_ROW_SECONDARY", PILL_ROW_SECONDARY));
test("PILL_PRIMARY has alignment classes", () => assertAlignment("PILL_PRIMARY", PILL_PRIMARY));
test("PILL_SECONDARY has alignment classes", () => assertAlignment("PILL_SECONDARY", PILL_SECONDARY));
test("PILL_DIALOG_PRIMARY has alignment classes", () => assertAlignment("PILL_DIALOG_PRIMARY", PILL_DIALOG_PRIMARY));
test("PILL_DIALOG_SECONDARY has alignment classes", () => assertAlignment("PILL_DIALOG_SECONDARY", PILL_DIALOG_SECONDARY));

test("PILL_ROW_PRIMARY has compact text size", () => {
  assert.ok(PILL_ROW_PRIMARY.includes("text-[11px]"), "should use text-[11px] for compact tier");
});

test("PILL_PRIMARY has standard text size", () => {
  assert.ok(PILL_PRIMARY.includes("text-sm"), "should use text-sm for standard tier");
});

test("PILL_DIALOG_PRIMARY has fixed height", () => {
  assert.ok(PILL_DIALOG_PRIMARY.includes("h-10"), "dialog tier should use h-10");
});

test("all constants include rounded-full", () => {
  for (const [name, cls] of [
    ["PILL_ROW_PRIMARY", PILL_ROW_PRIMARY],
    ["PILL_ROW_SECONDARY", PILL_ROW_SECONDARY],
    ["PILL_PRIMARY", PILL_PRIMARY],
    ["PILL_SECONDARY", PILL_SECONDARY],
    ["PILL_DIALOG_PRIMARY", PILL_DIALOG_PRIMARY],
    ["PILL_DIALOG_SECONDARY", PILL_DIALOG_SECONDARY],
  ] as const) {
    assert.ok(cls.includes("rounded-full"), `${name} should include rounded-full`);
  }
});
