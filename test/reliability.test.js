import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { onRequestGet as healthGet } from "../functions/api/health.js";

describe("read-only serving boundaries", () => {
  it("slate endpoint does not trigger freeze or harvest side effects", async () => {
    const src = await readFile(new URL("../functions/api/slate.js", import.meta.url), "utf8");
    assert.equal(src.includes("context.waitUntil("), false);
    assert.equal(src.includes("freezeSlate("), false);
    assert.equal(src.includes("harvestSport("), false);
  });
});

describe("health endpoint", () => {
  it("returns deployment and pipeline health without DB binding", async () => {
    const req = new Request("https://example.com/api/health");
    const res = await healthGet({
      request: req,
      env: { CF_PAGES_COMMIT_SHA: "abc123" },
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.deploymentCommit, "abc123");
    assert.equal(json.d1.bound, false);
    assert.equal(typeof json.pipeline.schedule, "object");
  });
});
