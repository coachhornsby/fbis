import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("published projection migration is registered", async () => {
  const migration = await readFile(new URL("../migrations/0016_published_projections.sql", import.meta.url), "utf8");
  assert.match(migration, /schema_migrations[\s\S]*0016_published_projections/i);
});

test("latest CFBD audit migration is registered and health expects it", async () => {
  const migration = await readFile(new URL("../migrations/0017_cfbd_endpoint_audit.sql", import.meta.url), "utf8");
  const health = await readFile(new URL("../functions/api/health.js", import.meta.url), "utf8");
  assert.match(migration, /schema_migrations[\s\S]*0017_cfbd_endpoint_audit/i);
  assert.match(health, /EXPECTED_MIGRATION\s*=\s*["']0017_cfbd_endpoint_audit["']/);
  assert.match(health, /WHERE id = \?/);
});
