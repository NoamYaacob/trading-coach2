import test from "node:test";
import assert from "node:assert/strict";

import { buildArchiveRequest } from "./archive-account-helpers.ts";

test("archive request targets the protection endpoint, not the edit route", () => {
  const { url } = buildArchiveRequest("abc-123");
  assert.equal(url, "/api/accounts/abc-123/protection");
  assert.ok(!url.endsWith("/edit"), "must not link to the edit page");
  assert.ok(url.endsWith("/protection"), "must use the protection route");
});

test("archive request uses POST method", () => {
  const { method } = buildArchiveRequest("abc-123");
  assert.equal(method, "POST");
});

test("archive request body sets protectionStatus to archived", () => {
  const { body } = buildArchiveRequest("abc-123");
  assert.equal(body.protectionStatus, "archived");
});

test("archive endpoint embeds the correct accountId", () => {
  const id = "cm_xkqp9z7w00001234";
  const { url } = buildArchiveRequest(id);
  assert.ok(url.includes(id), "URL must contain the account ID");
  assert.equal(url, `/api/accounts/${id}/protection`);
});
