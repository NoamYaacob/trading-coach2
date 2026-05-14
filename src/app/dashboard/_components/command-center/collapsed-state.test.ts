import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  COLLAPSED_GROUPS_STORAGE_KEY,
  parseCollapsedPayload,
  pruneStaleCollapsedIds,
  serializeCollapsedPayload,
  toggleCollapsedId,
} from "./collapsed-state.ts";

describe("COLLAPSED_GROUPS_STORAGE_KEY", () => {
  it("uses the agreed namespaced, versioned key", () => {
    assert.equal(COLLAPSED_GROUPS_STORAGE_KEY, "guardrail:dashboard:collapsed-groups:v1");
  });
});

describe("parseCollapsedPayload", () => {
  it("returns an empty Set when the value is null (no preference yet)", () => {
    const result = parseCollapsedPayload(null);
    assert.equal(result.size, 0);
  });

  it("returns an empty Set when the value is undefined", () => {
    const result = parseCollapsedPayload(undefined);
    assert.equal(result.size, 0);
  });

  it("returns an empty Set for an empty string", () => {
    const result = parseCollapsedPayload("");
    assert.equal(result.size, 0);
  });

  it("parses a JSON array of strings into a Set", () => {
    const result = parseCollapsedPayload('["a","b","c"]');
    assert.deepEqual([...result].sort(), ["a", "b", "c"]);
  });

  it("returns an empty Set for malformed JSON without throwing", () => {
    const result = parseCollapsedPayload("{not json");
    assert.equal(result.size, 0);
  });

  it("returns an empty Set when the JSON is not an array", () => {
    const result = parseCollapsedPayload('{"foo":"bar"}');
    assert.equal(result.size, 0);
  });

  it("filters non-string entries out of the array", () => {
    const result = parseCollapsedPayload('["a", 1, null, true, "b"]');
    assert.deepEqual([...result].sort(), ["a", "b"]);
  });

  it("filters empty-string entries", () => {
    const result = parseCollapsedPayload('["", "a"]');
    assert.deepEqual([...result], ["a"]);
  });

  it("deduplicates repeated ids", () => {
    const result = parseCollapsedPayload('["a","a","a"]');
    assert.equal(result.size, 1);
    assert.ok(result.has("a"));
  });
});

describe("serializeCollapsedPayload", () => {
  it("serialises a Set into a JSON array string", () => {
    const out = serializeCollapsedPayload(new Set(["a", "b"]));
    const parsed = JSON.parse(out);
    assert.ok(Array.isArray(parsed));
    assert.deepEqual([...parsed].sort(), ["a", "b"]);
  });

  it("serialises an empty Set into '[]'", () => {
    assert.equal(serializeCollapsedPayload(new Set()), "[]");
  });

  it("round-trips through parseCollapsedPayload", () => {
    const original = new Set(["__personal_broker__::conn-x", "myfundedfutures::conn-y"]);
    const restored = parseCollapsedPayload(serializeCollapsedPayload(original));
    assert.deepEqual([...restored].sort(), [...original].sort());
  });
});

describe("toggleCollapsedId", () => {
  it("adds a groupId that wasn't present", () => {
    const next = toggleCollapsedId(new Set(), "g1");
    assert.ok(next.has("g1"));
  });

  it("removes a groupId that was present", () => {
    const next = toggleCollapsedId(new Set(["g1"]), "g1");
    assert.ok(!next.has("g1"));
  });

  it("returns a new Set without mutating the input", () => {
    const prev = new Set(["g1"]);
    const next = toggleCollapsedId(prev, "g2");
    assert.notEqual(next, prev);
    assert.ok(prev.has("g1") && !prev.has("g2"));
    assert.ok(next.has("g1") && next.has("g2"));
  });

  it("preserves unrelated ids when adding", () => {
    const next = toggleCollapsedId(new Set(["a", "b"]), "c");
    assert.deepEqual([...next].sort(), ["a", "b", "c"]);
  });

  it("preserves unrelated ids when removing", () => {
    const next = toggleCollapsedId(new Set(["a", "b", "c"]), "b");
    assert.deepEqual([...next].sort(), ["a", "c"]);
  });
});

describe("pruneStaleCollapsedIds", () => {
  it("drops ids whose group no longer exists", () => {
    const next = pruneStaleCollapsedIds(
      new Set(["a", "b", "c"]),
      ["a", "c"],
    );
    assert.deepEqual([...next].sort(), ["a", "c"]);
  });

  it("keeps the Set unchanged when every id is still valid", () => {
    const next = pruneStaleCollapsedIds(new Set(["a", "b"]), ["a", "b", "c"]);
    assert.deepEqual([...next].sort(), ["a", "b"]);
  });

  it("returns an empty Set when no ids are valid (e.g. all connections removed)", () => {
    const next = pruneStaleCollapsedIds(new Set(["a", "b"]), []);
    assert.equal(next.size, 0);
  });

  it("accepts an iterable, not just an array, for validGroupIds", () => {
    const next = pruneStaleCollapsedIds(new Set(["a", "b"]), new Set(["a"]));
    assert.deepEqual([...next], ["a"]);
  });

  it("does not mutate the input Set", () => {
    const prev = new Set(["a", "b", "c"]);
    pruneStaleCollapsedIds(prev, ["a"]);
    assert.deepEqual([...prev].sort(), ["a", "b", "c"]);
  });
});
