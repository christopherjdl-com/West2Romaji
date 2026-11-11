import assert from "node:assert/strict";
import test from "node:test";
import { AppError, mapStatus, redact } from "../www/js/errors.js";

test("maps API failures without repeating the key", () => {
  const key = "xai-super-secret";
  const invalid = mapStatus(401, JSON.stringify({ error: { message: `bad ${key}` } }), key);
  assert.equal(invalid.code, "invalid_key");
  assert.equal(invalid.detail.includes(key), false);

  assert.equal(mapStatus(429, "").code, "rate_limit");
  assert.equal(mapStatus(408, "").code, "timeout");
  assert.equal(mapStatus(503, "").code, "server");
  assert.equal(mapStatus(402, "").code, "payment");
  assert.equal(mapStatus(200, ""), null);
});

test("redacts bearer tokens", () => {
  assert.equal(redact("Authorization Bearer xai-abc"), "Authorization Bearer …");
});

test("AppError carries a code", () => {
  const error = new AppError("offline", "No connection.");
  assert.equal(error.code, "offline");
});
