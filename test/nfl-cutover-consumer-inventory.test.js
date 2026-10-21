import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("NFL consumer inventory enumerates PRIMARY route candidates but never certifies authority", () => {
  const raw = execFileSync(process.execPath, ["scripts/nfl-cutover-consumer-inventory.mjs"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const report = JSON.parse(raw);
  assert.equal(report.contract, "fbis-nfl-cutover-consumer-inventory-v1");
  assert.equal(report.readyForLiveCutover, false);
  assert.equal(report.authorityActivationPerformed, false);
  assert.equal(report.deletionAuthorized, false);
  assert.equal(report.canAuthorizeWager, false);
  for (const path of [
    "functions/api/projections.js",
    "functions/api/published-projections.js",
    "functions/api/nfl-pregame-publish.js",
    "functions/api/nfl-wager-snapshot.js",
  ]) {
    const hit = report.candidates.find(x => x.path === path);
    assert.ok(hit, `missing known production consumer: ${path}`);
    assert.equal(hit.directPrimaryReference, true, path);
    assert.equal(hit.disposition, "UNREVIEWED", path);
  }
});
