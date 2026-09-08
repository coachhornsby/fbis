import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("D1 migration sync script is non-destructive and gates on live schema evidence", async () => {
  const body = await readFile(new URL("../scripts/sync-d1-migrations.mjs", import.meta.url), "utf8");
  assert.match(body, /INSERT OR IGNORE INTO d1_migrations/);
  assert.match(body, /PRAGMA table_info\(strategy_tickets\)/);
  assert.match(body, /published_projections/);
  assert.doesNotMatch(body, /\bDROP\b/i);
  assert.doesNotMatch(body, /\bDELETE FROM\b/i);
  assert.match(body, /files\.slice\(0, -1\)/);
});
