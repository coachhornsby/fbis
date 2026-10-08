/**
 * Regression: schema health must require the canonical migration tip,
 * not the obsolete 0067 soccer watermark.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPECTED_MIGRATION,
  EXPECTED_MIGRATION_FILE,
  EXPECTED_MIGRATION_ID,
  MIGRATION_STATUS,
  evaluateSchemaMigrationHealth,
} from "../functions/lib/migrationTip.js";
import { schemaVersion, onRequestGet as healthGet } from "../functions/api/health.js";
import { deriveHealthState } from "../functions/lib/healthContract.js";

const root = fileURLToPath(new URL("..", import.meta.url));

function memoryDb({ tipPresent = true, watermarkOnly = false, includeWrangler = true } = {}) {
  const ids = new Set();
  if (watermarkOnly) {
    ids.add("0067_soccer_phase3b_validation_provenance");
    ids.add("0067_cfb_persistent_directory_phase_a");
  } else if (tipPresent) {
    ids.add(EXPECTED_MIGRATION_ID);
    ids.add("0067_soccer_phase3b_validation_provenance");
  }
  const wrangler = new Set(includeWrangler && tipPresent ? [EXPECTED_MIGRATION_FILE] : []);

  return {
    prepare(sql) {
      const s = String(sql);
      return {
        bind(...args) {
          this._args = args;
          return this;
        },
        async first() {
          if (/FROM schema_migrations WHERE id\s*=/i.test(s)) {
            const id = String(this._args?.[0] || "");
            return ids.has(id) ? { id } : null;
          }
          if (/FROM schema_migrations ORDER BY id DESC/i.test(s)) {
            const sorted = [...ids].sort();
            return sorted.length ? { id: sorted[sorted.length - 1] } : null;
          }
          if (/FROM d1_migrations WHERE name\s*=/i.test(s)) {
            if (!includeWrangler) {
              const err = new Error("no such table: d1_migrations");
              throw err;
            }
            const name = String(this._args?.[0] || "");
            return wrangler.has(name) ? { name } : null;
          }
          return null;
        },
        async all() {
          return { results: [] };
        },
        async run() {
          return { success: true };
        },
      };
    },
  };
}

test("canonical tip declaration matches sorted migrations directory tip", () => {
  assert.equal(EXPECTED_MIGRATION, EXPECTED_MIGRATION_ID);
  assert.equal(EXPECTED_MIGRATION_ID, EXPECTED_MIGRATION_FILE.replace(/\.sql$/, ""));
  assert.equal(EXPECTED_MIGRATION_FILE, "0097_apify_acquisition_authority.sql");
  assert.equal(EXPECTED_MIGRATION_ID, "0097_apify_acquisition_authority");
});

test("1: tip present → VERIFIED", async () => {
  const schema = await schemaVersion({ DB: memoryDb({ tipPresent: true }) }, { readOk: true });
  assert.equal(schema.status, MIGRATION_STATUS.VERIFIED);
  assert.equal(schema.version, EXPECTED_MIGRATION_ID);
  assert.equal(schema.expectedMigration, EXPECTED_MIGRATION_ID);
  assert.equal(schema.tipPresent, true);
});

test("2: old 0067 watermark only → not VERIFIED", async () => {
  const schema = await schemaVersion(
    { DB: memoryDb({ tipPresent: false, watermarkOnly: true }) },
    { readOk: true }
  );
  assert.notEqual(schema.status, MIGRATION_STATUS.VERIFIED);
  assert.equal(schema.status, MIGRATION_STATUS.UNVERIFIED);
  assert.equal(schema.tipPresent, false);
  assert.equal(schema.expectedMigration, EXPECTED_MIGRATION_ID);
  // Observed max may surface 0067 for operators, but must not verify.
  assert.match(String(schema.version || ""), /0067/);
});

test("3: tip missing fails required schema-migration check", () => {
  const schema = evaluateSchemaMigrationHealth({
    tipRow: null,
    observedMaxId: "0067_soccer_phase3b_validation_provenance",
    readOk: true,
  });
  assert.equal(schema.status, MIGRATION_STATUS.UNVERIFIED);
  const derived = deriveHealthState({
    hasAuthoritativeData: true,
    requiredChecks: [
      { name: "d1-binding", ok: true, required: true },
      { name: "d1-read", ok: true, required: true },
      {
        name: "schema-migration",
        required: true,
        ok: schema.status === MIGRATION_STATUS.VERIFIED,
        detail: `${schema.status}:${schema.version || "none"} expected=${schema.expectedMigration}`,
      },
      { name: "scheduled-collect", ok: true, required: true, detail: "healthy" },
    ],
  });
  assert.notEqual(derived.state, "HEALTHY");
  assert.ok((derived.failures || []).some((f) => f.name === "schema-migration"));
});

test("4: database unavailable → non-500 health, schema not VERIFIED", async () => {
  const res = await healthGet({
    request: new Request("https://example.com/api/health"),
    env: { CF_PAGES_COMMIT_SHA: "abc123tip" },
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(json.deploymentCommit, "abc123tip");
  assert.equal(json.d1.bound, false);
  const schemaCheck = (json.checks || []).find((c) => c.name === "schema-migration");
  assert.ok(schemaCheck);
  assert.equal(schemaCheck.ok, false);
  assert.match(String(schemaCheck.detail || ""), /UNVERIFIED/);
  assert.match(String(schemaCheck.detail || ""), new RegExp(EXPECTED_MIGRATION_ID));
  assert.notEqual(json.build?.migrationStatus, MIGRATION_STATUS.VERIFIED);
});

test("5: expectedMigration metadata matches canonical declaration", async () => {
  const schema = await schemaVersion({ DB: memoryDb({ tipPresent: true }) }, { readOk: true });
  assert.equal(schema.expectedMigration, EXPECTED_MIGRATION_ID);
  assert.equal(schema.expectedMigrationFile, EXPECTED_MIGRATION_FILE);
  const res = await healthGet({
    request: new Request("https://example.com/api/health"),
    env: {
      CF_PAGES_COMMIT_SHA: "tipmeta",
      DB: memoryDb({ tipPresent: true }),
    },
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  // build.meta fields when durableHealth binds
  if (json.build?.expectedMigration) {
    assert.equal(json.build.expectedMigration, EXPECTED_MIGRATION_ID);
  }
});

test("6: real migration verifier passes aligned tip, rejects drift, and passes repaired declaration", () => {
  const dir = mkdtempSync(join(tmpdir(), "fbis-tip-drift-"));
  try {
    mkdirSync(join(dir, "migrations"));
    mkdirSync(join(dir, "scripts"));
    mkdirSync(join(dir, "functions", "lib"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
    // Copy the actual verifier and its dependency unchanged. Relative imports and
    // import.meta.url resolve inside the fixture, never the live working tree.
    copyFileSync(join(root, "scripts/verify-migrations.mjs"), join(dir, "scripts/verify-migrations.mjs"));
    copyFileSync(join(root, "functions/lib/migrationTip.js"), join(dir, "functions/lib/migrationTip.js"));
    writeFileSync(join(dir, "schema.sql"), "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT);\n");
    writeFileSync(join(dir, "schema.extensions.sql"), "");
    const addMigration = (file) => {
      const id = file.replace(/\.sql$/, "");
      writeFileSync(join(dir, "migrations", file),
        `INSERT OR IGNORE INTO schema_migrations(id,applied_at) VALUES('${id}', datetime('now'));\n`);
    };
    const runVerifier = () => {
      const result = spawnSync(process.execPath, [join(dir, "scripts/verify-migrations.mjs")], {
        cwd: dir, encoding: "utf8", timeout: 10000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.signal, null);
      return result;
    };
    addMigration(EXPECTED_MIGRATION_FILE);
    const aligned = runVerifier();
    assert.equal(aligned.status, 0, aligned.stderr || aligned.stdout);
    assert.match(aligned.stdout, /Verified canonical migration tip/);
    assert.match(aligned.stdout, /Verified 1 migrations against canonical schema bundle \(1 tables\)/);

    // Valid SQL, registered id, known schema, and a unique prefix: the only
    // failing contract is the stale canonical tip declaration.
    const advancedFile = "0098_future_drift_probe.sql";
    addMigration(advancedFile);
    const drifted = runVerifier();
    assert.equal(drifted.status, 1, drifted.stderr || drifted.stdout);
    assert.equal(drifted.stderr.trim(),
      `Canonical migration tip drift: latest=${advancedFile} expected=${EXPECTED_MIGRATION_FILE}`);

    const declarationPath = join(dir, "functions/lib/migrationTip.js");
    const declaration = readFileSync(declarationPath, "utf8");
    writeFileSync(declarationPath, declaration
      .replace(JSON.stringify(EXPECTED_MIGRATION_FILE), JSON.stringify(advancedFile))
      .replace(JSON.stringify(EXPECTED_MIGRATION_ID), JSON.stringify(advancedFile.replace(/\.sql$/, ""))));
    const repaired = runVerifier();
    assert.equal(repaired.status, 0, repaired.stderr || repaired.stdout);
    assert.match(repaired.stdout, /Verified canonical migration tip: 0098_future_drift_probe\.sql/);
    assert.match(repaired.stdout, /Verified 2 migrations against canonical schema bundle \(1 tables\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("7: grandfathered duplicate prefixes remain supported by verifier", () => {
  const verifier = readFileSync(join(root, "scripts/verify-migrations.mjs"), "utf8");
  assert.match(verifier, /0067_cfb_persistent_directory_phase_a\.sql/);
  assert.match(verifier, /0067_soccer_phase3b_validation_provenance\.sql/);
  assert.match(verifier, /0079_cbb_persistent_directory_phase_a\.sql/);
  assert.match(verifier, /0079_soccer_phase3f_research_routing\.sql/);
  const tip = readFileSync(join(root, "functions/lib/migrationTip.js"), "utf8");
  // Tip uses full identity, not numeric prefix alone.
  assert.match(tip, /0097_apify_acquisition_authority/);
  assert.doesNotMatch(tip, /EXPECTED_MIGRATION_ID\s*=\s*["']0097["']/);
  const run = spawnSync("node", ["scripts/verify-migrations.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /grandfathered historical collisions/);
});

test("8: dual-ledger — missing wrangler tip does not false-fail schema VERIFIED", async () => {
  // Documented decision: schema_migrations tip alone is authoritative for VERIFIED.
  const schema = await schemaVersion(
    { DB: memoryDb({ tipPresent: true, includeWrangler: false }) },
    { readOk: true }
  );
  assert.equal(schema.status, MIGRATION_STATUS.VERIFIED);
  assert.equal(schema.wranglerLedgerAvailable, false);
  assert.equal(schema.wranglerTipPresent, null);
});

test("8b: evaluate helper — wrangler mismatch is reported without revoking VERIFIED", () => {
  const schema = evaluateSchemaMigrationHealth({
    tipRow: { id: EXPECTED_MIGRATION_ID },
    wranglerTipName: "0096_cbb_phase_b_future_transfer_leakage.sql",
    wranglerLedgerAvailable: true,
    readOk: true,
  });
  assert.equal(schema.status, MIGRATION_STATUS.VERIFIED);
  assert.equal(schema.wranglerTipPresent, false);
});

test("9: scheduled-collect remains independent of schema tip failure", () => {
  const derived = deriveHealthState({
    hasAuthoritativeData: true,
    requiredChecks: [
      { name: "schema-migration", required: true, ok: false, detail: "UNVERIFIED" },
      {
        name: "scheduled-collect",
        required: true,
        ok: true,
        detail: "healthy",
        lastSuccessAt: "2026-10-08T13:00:00.000Z",
        freshnessMs: 12 * 60 * 60 * 1000,
      },
    ],
  });
  const collectFail = (derived.failures || []).find((f) => f.name === "scheduled-collect");
  assert.equal(collectFail, undefined);
  assert.ok((derived.failures || []).some((f) => f.name === "schema-migration"));
  assert.equal(derived.state, "DEGRADED");
});

test("10: authority surfaces unchanged by tip module", async () => {
  const tip = readFileSync(join(root, "functions/lib/migrationTip.js"), "utf8");
  assert.doesNotMatch(tip, /canQualify|canAuthorizeWager|ACTION_APIFY_ENABLED|prizepicks/i);
  const health = readFileSync(join(root, "functions/api/health.js"), "utf8");
  // Health still imports tip helper; no provider policy mutation added.
  assert.doesNotMatch(health, /UPDATE external_acquisition_policy/);
  assert.doesNotMatch(health, /canAuthorizeWager\s*=\s*true/);
});
