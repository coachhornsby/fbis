import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = readFileSync(join(root, "scripts/market-history-archive-ops.mjs"), "utf8");
const workflow = readFileSync(join(root, ".github/workflows/market-history-archive-recurring.yml"), "utf8");
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

test("recurring archive workflow is high-throughput and checkpointed", () => {
  assert.match(workflow, /ARCHIVE_LIMIT:\s*"1000"/);
  assert.match(workflow, /ARCHIVE_MAX_ROUNDS:\s*"20"/);
  assert.match(workflow, /ARCHIVE_ELIGIBILITY_MS:\s*"3600000"/);
  assert.match(workflow, /columnCount==50/);
  assert.match(workflow, /retentionGate\.authorized==false/);
  assert.match(workflow, /NOT_PERFORMED/);
  assert.match(workflow, /cron:\s*"8,23,38,53 \* \* \* \*"/);
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
});
