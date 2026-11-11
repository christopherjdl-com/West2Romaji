import assert from "node:assert/strict";
import test from "node:test";
import { chooseDebugKey, envValue, handleDebugKey, isLoopbackHost, setEnvValue } from "../scripts/debug-server.mjs";

function response() {
  return {
    status: 0,
    body: "",
    writeHead(status) {
      this.status = status;
    },
    end(body) {
      this.body = body;
    },
  };
}

function request(method, host, raw) {
  return {
    method,
    headers: { host },
    on(event, fn) {
      if (event === "data" && raw) fn(Buffer.from(raw));
      if (event === "end") fn();
    },
  };
}

test("only a loopback Host may ask for the debug key", () => {
  assert.equal(isLoopbackHost("127.0.0.1:4173"), true);
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isLoopbackHost("[::1]:4173"), true);
  assert.equal(isLoopbackHost("example.com"), false);
});

test("XAI_API_KEY is read from .env and a Bearer prefix is dropped", () => {
  const text = "# local\nOTHER=keep\nXAI_API_KEY=\"Bearer xai-local\"\n";
  assert.equal(envValue(text), "xai-local");
  assert.equal(envValue("XAI_API_KEY=\n"), "");
});

test("an empty xAI key selects Gemini and hides the other key", () => {
  const chosen = chooseDebugKey("XAI_API_KEY=\nGEMINI_API_KEY=gemini-secret\n");
  assert.deepEqual(chosen, { provider: "gemini", apiKey: "gemini-secret" });
  assert.equal(chooseDebugKey("XAI_API_KEY=xai-secret\nGEMINI_API_KEY=gemini-secret\n").provider, "xai");
  assert.deepEqual(chooseDebugKey("XAI_API_KEY=null\nGEMINI_API_KEY=undefined\n"), {
    provider: "",
    apiKey: "",
  });
});

test("writing the key keeps the other lines", () => {
  const next = setEnvValue("OTHER=keep\nXAI_API_KEY=old\n", "XAI_API_KEY", "xai-new");
  assert.equal(next, "OTHER=keep\nXAI_API_KEY=xai-new\n");
  assert.equal(setEnvValue(next, "XAI_API_KEY", ""), "OTHER=keep\n");
});

test("a failed read does not echo the key", async () => {
  const secret = "xai-super-secret";
  const res = response();
  await handleDebugKey(request("GET", "127.0.0.1:4173"), res, {
    read: async () => {
      throw new Error(`cannot read ${secret}`);
    },
    write: async () => {},
  });
  assert.equal(res.status, 500);
  assert.equal(res.body.includes(secret), false);
});

test("a short key is refused before .env is written", async () => {
  let written = false;
  const res = response();
  await handleDebugKey(
    request("PUT", "127.0.0.1:4173", JSON.stringify({ apiKey: "short" })),
    res,
    {
      read: async () => "",
      write: async () => {
        written = true;
      },
    },
  );
  assert.equal(res.status, 400);
  assert.equal(written, false);
});
