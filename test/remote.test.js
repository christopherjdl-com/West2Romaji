import assert from "node:assert/strict";
import test from "node:test";
import { translateWithFunction } from "../www/js/remote.js";

test("a function URL call is signed and does not carry an API key", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
  const pem = `-----BEGIN PUBLIC KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(spki)))}\n-----END PUBLIC KEY-----\n`;
  const seen = [];
  const key = { privateKey: pair.privateKey, pem, enrolledUrls: [] };
  const result = await translateWithFunction({
    text: "Où est la gare ?",
    baseUrl: "https://www.youtube.com/@CJCloudAI",
    now: () => 1_730_000_000_000,
    keys: {
      load: async () => key,
      markEnrolled: async (base) => {
        key.enrolledUrls = [...(key.enrolledUrls || []), base];
      },
    },
    post: async (request) => {
      seen.push(request);
      if (request.url.endsWith("/enroll")) return { status: 201, body: "{\"enrolled\":true}" };
      return {
        status: 200,
        body: JSON.stringify({
          japanese: "駅はどこですか",
          romaji: "Eki wa doko desu ka",
          source_lang: "French",
          region: "eu-west-3",
        }),
      };
    },
  });

  assert.equal(seen.length, 2);
  assert.equal(seen[0].url, "https://www.youtube.com/@CJCloudAI/enroll");
  assert.equal(seen[1].url, "https://www.youtube.com/@CJCloudAI/translate");
  assert.equal(seen[1].headers["x-west2romaji-timestamp"], "1730000000");
  assert.equal(typeof seen[1].headers["x-west2romaji-signature"], "string");
  assert.equal(JSON.stringify(seen[1]).includes("apiKey"), false);
  assert.equal(JSON.stringify(seen[1].headers).includes("Authorization"), false);
  assert.equal(result.romaji, "Eki wa doko desu ka");
  assert.equal(result.sourceLang, "French");
  assert.equal(result.region, "eu-west-3");
});

async function deviceKey(enrolledUrls = []) {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
  const pem = `-----BEGIN PUBLIC KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(spki)))}\n-----END PUBLIC KEY-----\n`;
  return { privateKey: pair.privateKey, pem, enrolledUrls: [...enrolledUrls] };
}

function translated(region = "eu-west-3") {
  return {
    status: 200,
    body: JSON.stringify({
      japanese: "駅はどこですか",
      romaji: "Eki wa doko desu ka",
      source_lang: "French",
      region,
    }),
  };
}

test("a 401 from a region enrolls that same key there and retries once", async () => {
  const base = "https://www.youtube.com/@CJCloudAI/videos";
  const key = await deviceKey([base]);
  const seen = [];
  const result = await translateWithFunction({
    text: "Où est la gare ?",
    baseUrl: base,
    now: () => 1_730_000_000_000,
    keys: {
      load: async () => key,
      markEnrolled: async (url) => {
        key.enrolledUrls = [...key.enrolledUrls, url];
      },
    },
    post: async (request) => {
      seen.push(request.url);
      if (request.url.endsWith("/enroll")) return { status: 201, body: "{\"enrolled\":true}" };
      if (seen.filter((url) => url.endsWith("/translate")).length === 1) {
        return { status: 401, body: JSON.stringify({ error: "This phone is not enrolled." }) };
      }
      return translated("ap-northeast-1");
    },
  });

  assert.deepEqual(seen, [
    `${base}/translate`,
    `${base}/enroll`,
    `${base}/translate`,
  ]);
  assert.equal(result.region, "ap-northeast-1");
  assert.equal(seen.filter((url) => url.endsWith("/enroll")).length, 1);
});

test("a second not-enrolled response is not enrolled again", async () => {
  const base = "https://www.youtube.com/@CJCloudAI";
  const key = await deviceKey([base]);
  const seen = [];
  await assert.rejects(
    () => translateWithFunction({
      text: "hello",
      baseUrl: base,
      keys: {
        load: async () => key,
        markEnrolled: async (url) => {
          key.enrolledUrls = [...new Set([...key.enrolledUrls, url])];
        },
      },
      post: async (request) => {
        seen.push(request.url);
        if (request.url.endsWith("/enroll")) return { status: 201, body: "{\"enrolled\":true}" };
        return { status: 401, body: JSON.stringify({ error: "This phone is not enrolled." }) };
      },
    }),
    (error) => error.message === "This phone is not enrolled."
  );
  assert.deepEqual(seen, [`${base}/translate`, `${base}/enroll`, `${base}/translate`]);
});

test("a rejected signature does not enroll again", async () => {
  const key = await deviceKey(["https://www.youtube.com/@CJCloudAI"]);
  const seen = [];
  await assert.rejects(
    () => translateWithFunction({
      text: "hello",
      baseUrl: "https://www.youtube.com/@CJCloudAI",
      keys: {
        load: async () => key,
        markEnrolled: async () => { throw new Error("enrolled"); },
      },
      post: async (request) => {
        seen.push(request.url);
        return { status: 401, body: JSON.stringify({ error: "The request signature was rejected." }) };
      },
    }),
    (error) => error.message === "The request signature was rejected."
  );
  assert.deepEqual(seen, ["https://www.youtube.com/@CJCloudAI/translate"]);
});

test("a different key is not retried after enrollment is closed", async () => {
  const key = await deviceKey();
  const seen = [];
  await assert.rejects(
    () => translateWithFunction({
      text: "hello",
      baseUrl: "https://www.youtube.com/@CJCloudAI",
      keys: { load: async () => key, markEnrolled: async () => {} },
      post: async (request) => {
        seen.push(`${request.method || "POST"} ${request.url}`);
        return { status: 409, body: JSON.stringify({ error: "Enrollment is closed." }) };
      },
    }),
    (error) => error.message === "Enrollment is closed."
  );
  assert.deepEqual(seen, ["POST https://www.youtube.com/@CJCloudAI/enroll"]);
});

test("an empty function URL fails before the network", async () => {
  await assert.rejects(
    () => translateWithFunction({
      text: "hello",
      baseUrl: "",
      post: async () => { throw new Error("called"); },
      keys: { load: async () => { throw new Error("key"); }, markEnrolled: async () => {} },
    }),
    (error) => error.message === "The translation address is not set."
  );
});
