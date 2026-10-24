import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCfbCoreShadowRecord,
  freezeCfbCoreShadowRecords,
} from "../functions/lib/cfbCoreShadowLedger.js";

test("CFB CORE shadow freeze has one SQL value per column and one bind per placeholder", async () => {
  let prepared = 0;
  let batched = 0;
  const db = {
    prepare(sql) {
      prepared++;
      const match = sql.match(/INSERT OR IGNORE INTO cfb_core_shadow_predictions\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)/i);
      assert.ok(match, "must insert into the research-only CORE shadow ledger");
      const columns = match[1].split(",").map(x => x.trim());
      const values = match[2].split(",").map(x => x.trim());
      assert.equal(columns.length, 61, "schema column count");
      assert.equal(values.length, columns.length, "SQLite INSERT column/value arity");
      assert.deepEqual(values.slice(-4), ["0", "0", "0", "?"]);
      for (const field of ["can_qualify", "can_authorize_wager", "can_influence_production"]) {
        assert.ok(columns.includes(field), "research authority column missing: " + field);
      }
      return {
        bind(...args) {
          assert.equal(values.filter(x => x === "?").length, args.length, "SQL placeholder/bind arity");
          assert.ok(args.every(x => x !== undefined), "undefined D1 bindings are forbidden");
          return { sql, args };
        },
      };
    },
    async batch(statements) {
      batched++;
      assert.equal(statements.length, 1);
      return [{ meta: { changes: 1 } }];
    },
  };
  const row = buildCfbCoreShadowRecord({
    gameId: "cfb-arity-fixture",
    season: 2026,
    week: 9,
    kickoff: "2026-10-25T20:00:00.000Z",
    homeTeam: "Fixture Home",
    awayTeam: "Fixture Away",
    championHome: 27,
    championAway: 20,
    homeFeatures: {},
    awayFeatures: {},
  }, { now: "2026-10-24T19:00:00.000Z" });
  assert.equal(row.corePHomeWin, null, "margin-only/no-head probability stays SQL NULL");
  const result = await freezeCfbCoreShadowRecords({ TIER3_DB: db }, [row]);
  assert.equal(result.ok, true);
  assert.equal(result.inserted, 1);
  assert.equal(result.canAuthorizeWager, false);
  assert.equal(prepared, 1);
  assert.equal(batched, 1);
});
