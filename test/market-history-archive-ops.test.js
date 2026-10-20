import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = readFileSync(join(root, "scripts/market-history-archive-ops.mjs"), "utf8");
const workflow = readFileSync(join(root, ".github/workflows/market-history-archive-recurring.yml"), "utf8");

test("archive ops script never authorizes deletion or wagers", () => {
  assert.match(script, /retention-gate-evaluate/);
  assert.match(script, /retentionReleaseAuthorized:\s*false/);
  assert.match(script, /RETENTION_GATE_MUST_STAY_CLOSED/);
  assert.match(script, /canAuthorizeWager:\s*false/);
  assert.match(script, /market-history-archive-verify/);
  assert.doesNotMatch(script, /sourceRowsDeleted:\s*[1-9]/);
});

test("recurring archive workflow keeps deletion gated and uses harvest secret", () => {
  assert.match(workflow, /ARCHIVE_WRITES:\s*"true"/);
  assert.match(workflow, /VERIFY_READBACK:\s*"true"/);
  assert.match(workflow, /retentionGate\.authorized==false/);
  assert.match(workflow, /NOT_PERFORMED/);
  assert.match(workflow, /HARVEST_SECRET/);
  assert.match(workflow, /ops\/triggers\/market-history-archive/);
  assert.match(workflow, /cron:\s*"11 \*\/2 \* \* \*"/);
});
