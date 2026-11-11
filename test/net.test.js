import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../www/js/errors.js";
import { postJson } from "../www/js/net.js";

test("the native HTTP plugin receives the key only as a header", async () => {
  const seen = [];
  const plugin = {
    setDataSerializer(value) {
      seen.push(value);
    },
    setRequestTimeout(value) {
      seen.push(value);
    },
    post(url, body, headers, ok) {
      seen.push({ url, body, headers });
      ok({ status: 200, data: "{\"ok\":true}" });
    },
  };
  const response = await postJson({
    url: "https://api.x.ai/v1/chat/completions",
    headers: { Authorization: "Bearer xai-test", "Content-Type": "application/json" },
    body: { model: "grok-4.7", messages: [] },
    timeoutMs: 25000,
    plugin,
  });
  assert.equal(response.status, 200);
  assert.equal(seen[0], "json");
  assert.equal(seen[1], 25);
  assert.equal(seen[2].headers.Authorization, "Bearer xai-test");
  assert.equal(JSON.stringify(seen[2].body).includes("xai-test"), false);
});

test("a dead network from the plugin is an offline error", async () => {
  const plugin = {
    post(url, body, headers, ok, fail) {
      fail({ status: 0, error: "The Internet connection appears to be offline." });
    },
  };
  await assert.rejects(
    () => postJson({
      url: "https://api.x.ai/v1/chat/completions",
      headers: {},
      body: {},
      plugin,
    }),
    (error) => error instanceof AppError && error.code === "offline"
  );
});

test("an aborted fetch is a timeout", async () => {
  await assert.rejects(
    () => postJson({
      url: "https://api.x.ai/v1/chat/completions",
      headers: {},
      body: {},
      timeoutMs: 15,
      fetchImpl: (url, init) => new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
    }),
    (error) => error instanceof AppError && error.code === "timeout"
  );
});
