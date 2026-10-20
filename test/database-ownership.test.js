import test from "node:test";
import assert from "node:assert/strict";
import {
  capacityAlertLevel,
  ownerForTable,
  primaryGrowthAllowed,
  resolveOperationsDb,
  resolveReadyOperationsDb,
  assertOperationalWriteTarget,
  ownershipManifest,
  DATABASE_OWNERS,
  OPERATIONS_OWNED_TABLES,
} from "../functions/lib/databaseOwnership.js";
import { evaluateRetentionRelease } from "../functions/lib/retentionGate.js";
import { runStaticPerformanceAudit } from "../functions/lib/d1PerformanceAudit.js";
import { validateAllSportPipelines, PIPELINE_VALIDATION_SPORTS } from "../functions/lib/pipelineValidation.js";

test("ownership manifest covers primary, operations, market-history, cold, core, nhl, and 2026q4", () => {
  const m = ownershipManifest();
  assert.equal(m.contract, "fbis-database-ownership-v2");
  assert.ok(m.databases.length >= 4);
  assert.equal(DATABASE_OWNERS.OPERATIONS.databaseId, "2371df3a-17bf-44d6-abf0-d275cf2f331e");
  assert.equal(DATABASE_OWNERS.COLD_HISTORY.databaseId, "6fad1baf-126f-4ab8-9b80-a7d71637d6d4");
  assert.equal(DATABASE_OWNERS.CORE.databaseId, "a5b438fa-eb16-4f03-95d7-1fc58ac72f04");
  assert.equal(DATABASE_OWNERS.NHL.databaseId, "a0aa010c-40d3-4d2f-8109-eca4e74e2a73");
  assert.equal(DATABASE_OWNERS.MARKET_HISTORY_2026Q4.databaseId, "e8b0b65d-90a6-4842-8ee7-0f85d75afb4c");
  assert.ok(OPERATIONS_OWNED_TABLES.includes("fbis_ops_health"));
  assert.ok(OPERATIONS_OWNED_TABLES.includes("fbis_capacity_measurements"));
  assert.ok(OPERATIONS_OWNED_TABLES.includes("learning_monitor_runs"));
  assert.ok(OPERATIONS_OWNED_TABLES.includes("online_learning_shadow"));
});

test("capacity alerts trigger at 80, 85, and 90 percent", () => {
  assert.equal(capacityAlertLevel(7_900_000_000).level, "OK");
  assert.equal(capacityAlertLevel(8_000_000_000).level, "WATCH");
  assert.equal(capacityAlertLevel(8_500_000_000).level, "HIGH");
  assert.equal(capacityAlertLevel(9_000_000_000).level, "CRITICAL");
  assert.equal(capacityAlertLevel(10_000_000_000).level, "OVER_LIMIT");
  const alerts = capacityAlertLevel(9_000_000_000).alerts;
  assert.deepEqual(alerts.map((a) => a.triggered), [true, true, true]);
});

test("operations tables prefer OPERATIONS_DB when bound", () => {
  assert.equal(ownerForTable("fbis_ops_health").key, "OPERATIONS");
  const ops = { prepare() { return {}; } };
  const preferred = resolveOperationsDb({ OPERATIONS_DB: ops, DB: { prepare() { return {}; } } });
  assert.equal(preferred.preferred, true);
  assert.equal(preferred.owner.key, "OPERATIONS");
  const fallback = resolveOperationsDb({ DB: ops });
  assert.equal(fallback.preferred, false);
  assert.equal(assertOperationalWriteTarget({ OPERATIONS_DB: ops }, "fbis_run_manifests").redirected, true);
});

test("ready operations db falls back to primary until operations schema exists", async () => {
  const primary = { prepare() { return { async first() { return { ok: 1 }; } }; } };
  const emptyOps = {
    prepare(sql) {
      assert.match(sql, /fbis_ops_health/);
      return { async first() { return null; } };
    },
  };
  const unboundReady = await resolveReadyOperationsDb({ OPERATIONS_DB: emptyOps, DB: primary });
  assert.equal(unboundReady.preferred, false);
  assert.equal(unboundReady.db, primary);
  assert.equal(unboundReady.warning, "OPERATIONS_SCHEMA_UNAVAILABLE");

  const readyOps = {
    prepare() {
      return { async first() { return { ok: 1 }; } };
    },
  };
  const ready = await resolveReadyOperationsDb({ OPERATIONS_DB: readyOps, DB: primary });
  assert.equal(ready.preferred, true);
  assert.equal(ready.schemaReady, true);
  assert.equal(ready.db, readyOps);
});

test("primary growth guard blocks historical market and archived roster seasons", () => {
  assert.equal(
    primaryGrowthAllowed("normalized_market_observations", { snapshotType: "RESEARCH" }).allowed,
    false
  );
  assert.equal(
    primaryGrowthAllowed("normalized_market_observations", { snapshotType: "CURRENT" }).allowed,
    true
  );
  assert.equal(primaryGrowthAllowed("cfb_roster_observations", { season: 2004 }).allowed, false);
  assert.equal(primaryGrowthAllowed("games_season_identity").allowed, true);
});

test("retention release requires verified recovery copies and explicit authorization", () => {
  const blocked = evaluateRetentionRelease({
    cohortKey: "market-research-pilot",
    r2ArchiveVerified: true,
    r2ReadbackSha256: "a".repeat(64),
    independentRestoreVerified: true,
    consumerAuditComplete: true,
    retentionReleaseAuthorized: false,
    priorManifestAuthorized: false,
  });
  assert.equal(blocked.authorized, false);
  assert.ok(blocked.failedChecks.includes("retention_release_authorized"));

  const allowed = evaluateRetentionRelease({
    cohortKey: "market-research-pilot",
    r2ArchiveVerified: true,
    r2ReadbackSha256: "b".repeat(64),
    independentRestoreVerified: true,
    consumerAuditComplete: true,
    retentionReleaseAuthorized: true,
    newReleaseManifest: true,
    priorManifestAuthorized: false,
    sourceRowsDeleted: 0,
  });
  assert.equal(allowed.authorized, true);
  assert.equal(allowed.canDeleteSourceRows, true);
});

test("performance audit surfaces high-severity primary growth findings", () => {
  const audit = runStaticPerformanceAudit();
  assert.equal(audit.contract, "fbis-d1-performance-audit-v1");
  assert.ok(audit.openHigh >= 2);
  assert.ok(audit.findings.some((f) => f.findingId === "perf:ops-telemetry-on-primary"));
});

test("pipeline validation covers board sports and all five surfaces", async () => {
  assert.ok(PIPELINE_VALIDATION_SPORTS.includes("nfl"));
  assert.ok(PIPELINE_VALIDATION_SPORTS.includes("soccer"));
  assert.ok(PIPELINE_VALIDATION_SPORTS.includes("tennis"));
  const recent = new Date(Date.now() - 3_600_000).toISOString();
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind() { return this; },
          async first() {
            if (/job_runs/i.test(sql)) return { n: 2, last_ok: recent };
            if (/published_projections|prediction_snapshots/i.test(sql)) return { n: 2, last_ok: recent };
            if (/normalized_market_observations|odds_snapshots|prizepicks|source_observations/i.test(sql)) {
              return { n: 2, last_ok: recent };
            }
            return { n: 0, last_ok: null };
          },
        };
      },
    },
  };
  const report = await validateAllSportPipelines(env, { sports: ["nfl", "mlb"] });
  assert.equal(report.overallOk, true);
  assert.equal(report.sportsChecked, 2);
  assert.equal(report.results[0].surfaces.length, 5);
});
