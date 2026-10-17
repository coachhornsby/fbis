import test from "node:test";
import assert from "node:assert/strict";
import {
  withOperationsWrite,
  clearOperationsSchemaCache,
  verifyOperationsRouting,
} from "../functions/lib/operationsDb.js";
import { upsertOpsHealth, recordRunManifest } from "../functions/lib/opsHealthLedger.js";

function memoryDb(tables = {}) {
  const store = new Map(Object.entries(tables).map(([k, v]) => [k, [...v]]));
  return {
    label: "mock",
    prepare(sql) {
      const binds = [];
      const statement = {
        bind(...args) {
          binds.push(...args);
          return statement;
        },
        async first() {
          if (/sqlite_master/.test(sql) && /fbis_ops_health/.test(sql)) {
            return store.has("fbis_ops_health") ? { ok: 1 } : null;
          }
          if (/COUNT\(\*\)/.test(sql)) {
            const table = /FROM\s+(\w+)/i.exec(sql)?.[1];
            if (!store.has(table)) throw Error(`no such table: ${table}`);
            return { n: store.get(table).length, last_at: store.get(table).at(-1)?.updated_at || null };
          }
          return null;
        },
        async run() {
          if (/INSERT INTO fbis_ops_health/.test(sql)) {
            if (!store.has("fbis_ops_health")) throw Error("no such table: fbis_ops_health");
            const componentId = binds[0];
            const rows = store.get("fbis_ops_health");
            const existing = rows.findIndex((r) => r.component_id === componentId);
            const row = { component_id: componentId, updated_at: binds.at(-1), status: binds[13] };
            if (existing >= 0) rows[existing] = row;
            else rows.push(row);
            return { success: true };
          }
          if (/INSERT OR REPLACE INTO fbis_run_manifests/.test(sql)) {
            if (!store.has("fbis_run_manifests")) throw Error("no such table: fbis_run_manifests");
            store.get("fbis_run_manifests").push({ run_id: binds[0], component_id: binds[1] });
            return { success: true };
          }
          if (/INSERT/.test(sql)) {
            const table = /INTO\s+(\w+)/i.exec(sql)?.[1];
            if (!store.has(table)) throw Error(`no such table: ${table}`);
            return { success: true };
          }
          return { success: true };
        },
        async all() {
          return { results: [] };
        },
      };
      return statement;
    },
  };
}

test("withOperationsWrite prefers ready OPERATIONS_DB", async () => {
  clearOperationsSchemaCache();
  const ops = memoryDb({ fbis_ops_health: [], fbis_run_manifests: [] });
  const primary = memoryDb({ fbis_ops_health: [{ component_id: "legacy" }] });
  const result = await withOperationsWrite(
    { OPERATIONS_DB: ops, DB: primary },
    async (db) => {
      assert.equal(db, ops);
      return { ok: true, wrote: true };
    }
  );
  assert.equal(result.preferred, true);
  assert.equal(result.binding, "OPERATIONS_DB");
});

test("withOperationsWrite falls back when ops schema missing", async () => {
  clearOperationsSchemaCache();
  const ops = memoryDb({}); // no tables
  const primary = memoryDb({ fbis_ops_health: [], fbis_run_manifests: [] });
  const result = await upsertOpsHealth(
    { OPERATIONS_DB: ops, DB: primary },
    { componentId: "github-schedules", status: "HEALTHY", severity: "INFO" }
  );
  assert.equal(result.ok, true);
  assert.equal(result.binding, "DB");
  assert.equal(result.preferred, false);
  assert.match(result.warning || "", /OPERATIONS_SCHEMA_UNAVAILABLE/);
});

test("withOperationsWrite retries primary after ops no-such-table write failure", async () => {
  clearOperationsSchemaCache();
  // Probe reports ready (sqlite_master hit) but write table missing — stale/partial schema.
  const ops = {
    prepare(sql) {
      if (/sqlite_master/.test(sql)) {
        return { bind() { return this; }, async first() { return { ok: 1 }; }, async run() { return {}; }, async all() { return { results: [] }; } };
      }
      return {
        bind() { return this; },
        async first() { return null; },
        async run() { throw Error("no such table: fbis_ops_health"); },
        async all() { return { results: [] }; },
      };
    },
  };
  const primary = memoryDb({ fbis_ops_health: [], fbis_run_manifests: [] });
  const result = await upsertOpsHealth(
    { OPERATIONS_DB: ops, DB: primary },
    { componentId: "projection-publication", status: "HEALTHY" }
  );
  assert.equal(result.ok, true);
  assert.equal(result.binding, "DB");
  assert.equal(result.fallbackFrom, "OPERATIONS_DB");
});

test("verifyOperationsRouting reports PRIMARY_FALLBACK when ops empty", async () => {
  clearOperationsSchemaCache();
  const report = await verifyOperationsRouting({
    OPERATIONS_DB: memoryDb({}),
    DB: memoryDb({ fbis_ops_health: [{ component_id: "x", updated_at: "2026-10-17" }] }),
  });
  assert.equal(report.routing, "PRIMARY_FALLBACK");
  assert.equal(report.writeTarget.preferred, false);
});

test("verifyOperationsRouting reports OPERATIONS_DB_ACTIVE when ops has health rows", async () => {
  clearOperationsSchemaCache();
  const ops = memoryDb({
    fbis_ops_health: [{ component_id: "capacity-monitor", updated_at: "2026-10-17T12:00:00Z" }],
    fbis_run_manifests: [],
    fbis_watchdog_metrics: [],
    fbis_capacity_measurements: [],
    fbis_pipeline_validation_runs: [],
    fbis_d1_performance_findings: [],
    fbis_retention_release_gates: [],
  });
  const report = await verifyOperationsRouting({ OPERATIONS_DB: ops, DB: memoryDb({ fbis_ops_health: [] }) });
  assert.equal(report.routing, "OPERATIONS_DB_ACTIVE");
  assert.equal(report.writeTarget.preferred, true);
});

test("recordRunManifest reports binding used", async () => {
  clearOperationsSchemaCache();
  const ops = memoryDb({ fbis_ops_health: [], fbis_run_manifests: [] });
  const result = await recordRunManifest(
    { OPERATIONS_DB: ops, DB: memoryDb({ fbis_ops_health: [], fbis_run_manifests: [] }) },
    { runId: "run-1", componentId: "github-schedules", status: "success" }
  );
  assert.equal(result.ok, true);
  assert.equal(result.binding, "OPERATIONS_DB");
});
