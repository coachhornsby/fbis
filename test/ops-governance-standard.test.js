import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("FBIS standard requires bounded restartable production work", async () => {
  const doc = await readFile(new URL("../docs/FBIS-MODEL-SYSTEM-STANDARD.md", import.meta.url), "utf8");
  assert.match(doc, /Bounded and restartable production work/);
  assert.match(doc, /deterministic shards or date\/range partitions/);
  assert.match(doc, /explicit per-call and per-job time bounds/);
  assert.match(doc, /persist completed work durably/);
  assert.match(doc, /idempotent and safe to retry/);
  assert.match(doc, /leases, claim\/complete semantics, or equivalent contention protection/);
  assert.match(doc, /resume from durable state after interruption/);
  assert.match(doc, /Monolithic workflows are prohibited/);
});
