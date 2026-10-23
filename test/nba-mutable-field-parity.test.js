import test from "node:test";
import assert from "node:assert/strict";
import {
  NBA_MUTABLE_FIELD_TABLES,
  verifyNbaMutableFieldParity,
} from "../functions/lib/nbaMutableFieldParity.js";

function db(tables) {
  return { prepare(sql) {
    const match = sql.match(/^SELECT \* FROM (nba_[a-z0-9_]+) ORDER BY ([a-z0-9_]+) (ASC|DESC) LIMIT \?$/);
    assert.ok(match, sql);
    const [, table, key, direction] = match;
    return { bind(limit) { return { async all() {
      const rows = [...(tables[table] || [])].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
      if (direction === "DESC") rows.reverse();
      return { results: rows.slice(0, limit) };
    }}; }};
  }};
}

function fixture() {
  return Object.fromEntries(NBA_MUTABLE_FIELD_TABLES.map(([table, key]) =>
    [table, [{ [key]: "row-1", frozen_value: "old", evidence: null }]]));
}

test("NBA mutable field gate rejects same-count, stale in-place records", async () => {
  const primary = fixture(), shard = fixture();
  primary.nba_player_state_profiles[0].frozen_value = "new";
  const result = await verifyNbaMutableFieldParity({ DB: db(primary), NBA_DB: db(shard) });
  assert.equal(result.ok, false);
  assert.equal(result.status, "SAMPLED_FIELD_PARITY_INCOMPLETE");
  assert.equal(result.mismatches[0].table, "nba_player_state_profiles");
  assert.ok(result.mismatches[0].fields.includes("frozen_value"));
  assert.equal(result.cutoverAuthorized, false);
  assert.equal(result.canAuthorizeWager, false);
});

test("NBA mutable field gate allows exact sampled source equality", async () => {
  const all = fixture();
  const result = await verifyNbaMutableFieldParity({ DB: db(all), NBA_DB: db(all) });
  assert.equal(result.ok, true);
  assert.equal(result.tables.length, NBA_MUTABLE_FIELD_TABLES.length);
  assert.equal(result.mismatches.length, 0);
});

test("NBA mutable field audit is fail-closed when a database binding is missing", async () => {
  const result = await verifyNbaMutableFieldParity({ DB: db(fixture()) });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "NBA_MUTABLE_FIELD_DB_UNBOUND");
});
