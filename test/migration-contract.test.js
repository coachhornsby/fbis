import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("published projection migration is registered", async () => {
  const migration = await readFile(new URL("../migrations/0016_published_projections.sql", import.meta.url), "utf8");
  assert.match(migration, /schema_migrations[\s\S]*0016_published_projections/i);
});

test("CFBD audit migrations are registered and health expects latest", async () => {
  const m17 = await readFile(new URL("../migrations/0017_cfbd_endpoint_audit.sql", import.meta.url), "utf8");
  const m18 = await readFile(new URL("../migrations/0018_cfbd_audit_tables_ensure.sql", import.meta.url), "utf8");
  const health = await readFile(new URL("../functions/api/health.js", import.meta.url), "utf8");
  assert.match(m17, /schema_migrations[\s\S]*0017_cfbd_endpoint_audit/i);
  assert.match(m18, /schema_migrations[\s\S]*0018_cfbd_audit_tables_ensure/i);
  assert.match(health, /EXPECTED_MIGRATION\s*=\s*["']0018_cfbd_audit_tables_ensure["']/);
  assert.match(health, /WHERE id = \?/);
});

test("live CFBD audit artifact is checked in without secrets", async () => {
  const raw = await readFile(new URL("../data/cfbd/audits/live-23530f6.json", import.meta.url), "utf8");
  assert.equal(raw.includes("Bearer"), false);
  assert.equal(/CFBD_API_KEY[=:]\s*\S+/.test(raw), false);
  const audit = JSON.parse(raw);
  assert.equal(audit.job, "cfbd-endpoint-audit");
  assert.equal(audit.summary?.configured, true);
  assert.ok((audit.summary?.available || []).includes("/ppa/teams"));
  assert.ok((audit.summary?.available || []).includes("/games/weather"));
  assert.ok((audit.summary?.available || []).includes("/ratings/core"));
  assert.equal((audit.summary?.notEntitled || []).length, 0);
});
