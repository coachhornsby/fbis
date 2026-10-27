import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = readFileSync(join(root, "scripts/market-history-archive-ops.mjs"), "utf8");
const workflow = readFileSync(join(root, ".github/paused-workflows/market-history-archive-recurring.yml"), "utf8");
const lib = readFileSync(join(root, "functions/lib/marketHistoryVerifiedArchive.js"), "utf8");

test("archive ops script requires 50 columns and keeps deletion gated", () => {
  assert.match(script, /EXPECTED_COLUMNS = 50/);
  assert.match(script, /fullColumnRestore/);
  assert.match(script, /ARCHIVE_MAX_ROUNDS/);
  assert.match(script, /backlogBefore/);
  assert.match(script, /throughputRowsPerSec/);
  assert.match(script, /retentionReleaseAuthorized:\s*false/);
  assert.match(script, /RETENTION_GATE_MUST_STAY_CLOSED/);
  assert.doesNotMatch(script, /sourceRowsDeleted:\s*[1-9]/);
});

test("recurring archive is preserved but cannot run while frozen", () => {
 assert.equal(existsSync(join(root,".github/workflows/market-history-archive-recurring.yml")),false);
 assert.match(workflow,/market-history-archive-late-arrivals/);
 assert.match(lib,/Math.min\(200,/);
 assert.match(lib,/Math.min\(2,/);
 assert.match(lib,/async function countBacklog\(\) \{ return null; \}/);
 assert.match(lib,/LATE_ARRIVAL_REQUIRES_BOUNDED_REDESIGN/);
});

test("verified archive library selects full column set and checkpoint table", () => {
  assert.match(lib, /NORMALIZED_MARKET_OBSERVATION_COLUMNS/);
  assert.match(lib, /fbis_market_history_archive_checkpoint/);
  assert.match(lib, /verifyFullRecordRestore/);
  assert.match(lib, /provider_event_id/);
  assert.match(lib, /model_version/);
  assert.match(lib, /raw_payload_hash/);
  assert.match(lib, /moreRemaining/);
  assert.match(lib, /backlogBefore/);
  assert.match(lib, /tryAcquireArchiveLease/);
  assert.match(lib, /ARCHIVE_LATE_ARRIVAL_KEY/);
  assert.match(lib, /sourceAuthorityPreserved:\s*true/);
});
