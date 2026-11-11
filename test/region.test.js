import assert from "node:assert/strict";
import test from "node:test";
import { functionUrlForZone } from "../www/js/region.js";

const urls = {
  paris: "https://www.youtube.com/@CJCloudAI",
  tokyo: "https://www.youtube.com/@CJCloudAI/videos",
};

test("Asia/Tokyo uses the Tokyo function URL", () => {
  assert.equal(functionUrlForZone("Asia/Tokyo", urls), "https://www.youtube.com/@CJCloudAI/videos");
});

test("any other timezone uses Paris", () => {
  assert.equal(functionUrlForZone("Europe/Paris", urls), "https://www.youtube.com/@CJCloudAI");
  assert.equal(functionUrlForZone("America/Los_Angeles", urls), "https://www.youtube.com/@CJCloudAI");
  assert.equal(functionUrlForZone(undefined, urls), "https://www.youtube.com/@CJCloudAI");
});
