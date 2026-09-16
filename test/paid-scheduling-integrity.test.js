import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const exists = (p) => fs.existsSync(path.join(root, p));

function hasSchedule(yaml) {
  return /(^|\n)\s*schedule\s*:/m.test(yaml);
}

test("ACTION has exactly one automatic paid scheduler", () => {
  const workflowDir = path.join(root, ".github/workflows");
  const actionFiles = fs.readdirSync(workflowDir)
    .filter((name) => name.startsWith("action-") && name.endsWith(".yml"));

  const scheduled = actionFiles.filter((name) => hasSchedule(
    fs.readFileSync(path.join(workflowDir, name), "utf8"),
  ));

  assert.deepEqual(scheduled, ["action-orchestrator.yml"]);

  const orchestrator = read(".github/workflows/action-orchestrator.yml");
  assert.match(orchestrator, /x-fbis-action-execution:\s*orchestrator-v2/);
  assert.match(orchestrator, /api\/action-apify-collect\?execute=1/);
});

test("manual ACTION workflows cannot wake up from push or cron", () => {
  const smoke = read(".github/workflows/action-apify-smoke.yml");
  const props = read(".github/workflows/action-player-props.yml");

  for (const [name, yaml] of [["smoke", smoke], ["props", props]]) {
    assert.doesNotMatch(yaml, /(^|\n)\s*schedule\s*:/m, `${name} must not have schedule trigger`);
    assert.doesNotMatch(yaml, /(^|\n)\s*push\s*:/m, `${name} must not have push trigger`);
    assert.match(yaml, /workflow_dispatch\s*:/, `${name} must remain explicit manual-only`);
    assert.match(yaml, /x-fbis-action-execution:\s*manual-confirmed/);
  }

  assert.equal(exists(".github/workflows/action-apify-capability-audit.yml"), false);
  assert.equal(exists(".github/workflows/action-apify-post-repair-verify.yml"), false);
});

test("paid ACTION API fails closed for stale schedulers", () => {
  const middleware = read("functions/api/_middleware.js");
  assert.match(middleware, /x-fbis-action-execution/);
  assert.match(middleware, /orchestrator-v2/);
  assert.match(middleware, /manual-confirmed/);
  assert.match(middleware, /stale_scheduler_blocked/);
});

test("legacy Cloudflare scheduler hook and paid odds credentials are disconnected", () => {
  assert.equal(exists("functions/_scheduled.js"), false);

  const collect = read("functions/api/collect.js");
  assert.doesNotMatch(collect, /PARLAY_API_KEY:\s*context\.env\.PARLAY_API_KEY/);
  assert.doesNotMatch(collect, /THEODDS_API_KEY:\s*context\.env\.THEODDS_API_KEY/);
  assert.doesNotMatch(collect, /SHARPAPI_API_KEY:\s*context\.env\.SHARPAPI_API_KEY/);
  assert.doesNotMatch(collect, /THERUNDOWN_API_KEY:\s*context\.env\.THERUNDOWN_API_KEY/);
});
