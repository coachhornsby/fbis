import test from "node:test";
import assert from "node:assert/strict";
import { shadowCompareNhlSportDb, shadowCompareSportDb } from "../functions/lib/sportDbShadow.js";

test("shadow compare reports unbound sport DB without inventing authority", async () => {
  const report = await shadowCompareNhlSportDb({
    DB: { prepare() { return { async first() { return { n: 1 }; } }; } },
  });
  assert.equal(report.ok, false);
  assert.equal(report.canAuthorizeWager, false);
  assert.match(report.reason, /UNBOUND|NOT_PROVISIONED/);
});

test("shadow compare marks parity when counts match and keeps primary authoritative", async () => {
  const primary = {
    prepare(sql) {
      const n = sql.includes("games") ? 2 : sql.includes("prediction") ? 5 : 0;
      return { bind() { return { async first() { return { n }; } }; }, async first() { return { n }; } };
    },
  };
  const nhl = {
    prepare(sql) {
      const n = sql.includes("games") ? 2 : sql.includes("prediction") ? 5 : 0;
      return { bind() { return { async first() { return { n }; } }; }, async first() { return { n }; } };
    },
  };
  const report = await shadowCompareSportDb(
    { DB: primary, NHL_DB: nhl, NHL_SPORT_DB_MODE: "shadow" },
    "nhl"
  );
  assert.equal(report.ok, true);
  assert.equal(report.status, "SHADOW_PARITY_OK");
  assert.equal(report.primaryAuthoritative, true);
  assert.equal(report.liveReadsRerouted, false);
  assert.equal(report.canAuthorizeWager, false);
});
