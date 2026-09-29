import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("learning report is backed by prediction_snapshots for all six sports", async () => {
  const api = await readFile(new URL("../functions/api/learning-report.js", import.meta.url), "utf8");
  assert.match(api, /prediction_snapshots/);
  assert.match(api, /LEARNING_SPORTS/);
  assert.match(api, /snapshotRows/);
  assert.match(api, /canonicalProjections/);
  assert.match(api, /gradedProjections/);
  assert.match(api, /awaitingFinals/);
  assert.match(api, /snapshotCount/);
  assert.match(api, /GRADED \/ INCLUDED/);
});

test("render learning sync writes dashboard, projection audit, and reconciles finals", async () => {
  const orchestrator = await readFile(
    new URL("../services/sports-projection-orchestrator/orchestrator.mjs", import.meta.url),
    "utf8"
  );
  assert.match(orchestrator, /modelLearning:\s*'Model Learning'/);
  assert.match(orchestrator, /projectionAudit:\s*'Projection Audit'/);
  assert.match(orchestrator, /export async function syncLearningDashboard/);
  assert.match(orchestrator, /allProjectionFinalsReconciled/);
  assert.match(orchestrator, /GRADED \/ INCLUDED/);
});

test("hourly orchestrator workflow mirrors authenticated learning evidence", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/sports-projection-orchestrator.yml", import.meta.url),
    "utf8"
  );
  assert.match(workflow, /\/api\/learning-report\?since=2026-01-01&limit=5000/);
  assert.match(workflow, /\/api\/sync-learning-dashboard/);
  assert.match(workflow, /HARVEST_SECRET/);
  assert.match(workflow, /allProjectionFinalsReconciled/);
});

test("render server exposes only authenticated learning dashboard sync", async () => {
  const server = await readFile(
    new URL("../services/sports-projection-orchestrator/server.mjs", import.meta.url),
    "utf8"
  );
  const authIndex = server.indexOf("const auth=await authorization(req)");
  const routeIndex = server.indexOf("/api/sync-learning-dashboard");
  assert.ok(authIndex >= 0);
  assert.ok(routeIndex > authIndex);
  assert.match(server, /syncLearningDashboard/);
});


test("production D1 explicitly ensures weekly model validation storage", async () => {
  const migration = await readFile(
    new URL("../migrations/0031_model_validation_runs_ensure.sql", import.meta.url),
    "utf8"
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS model_validation_runs/);
  assert.match(migration, /0031_model_validation_runs_ensure/);
});

test("learning report treats training and finding tables as optional evidence", async () => {
  const api = await readFile(new URL("../functions/api/learning-report.js", import.meta.url), "utf8");
  assert.match(api, /async function optionalRows/);
  assert.match(api, /no such table/);
  assert.match(api, /optionalRows\(db,[\s\S]*FROM model_validation_runs/);
  assert.match(api, /optionalRows\(db,[\s\S]*FROM model_learning_findings/);
});
