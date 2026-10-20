import test from "node:test";
import assert from "node:assert/strict";
import { rehearseSportCutover } from "../functions/lib/sportCutoverRehearsal.js";
import { productSportDbHandle } from "../functions/lib/databaseTopology.js";

function db(tag, { games = [], preds = [] } = {}) {
  return {
    tag,
    prepare(sql) {
      const s = String(sql);
      if (s.includes("FROM games")) {
        return {
          bind() {
            return {
              async all() { return { results: games.map((id) => ({ id })) }; },
              async first() { return { n: games.length }; },
            };
          },
        };
      }
      if (s.includes("FROM prediction_snapshots")) {
        return {
          bind() {
            return {
              async all() { return { results: preds.map((id) => ({ id })) }; },
              async first() { return { n: preds.length }; },
            };
          },
        };
      }
      return {
        bind() { return this; },
        async first() { return { n: 0 }; },
        async all() { return { results: [] }; },
        async run() { return { meta: { changes: 0 } }; },
      };
    },
  };
}

test("cutover rehearsal keeps primary authoritative and proves rollback", async () => {
  const primary = db("primary", { games: ["g1", "g2"], preds: ["p1"] });
  const nhl = db("nhl", { games: ["g1", "g2"], preds: ["p1"] });
  const env = {
    DB: primary,
    NHL_DB: nhl,
    NHL_SPORT_DB_MODE: "shadow",
    SPORT_DB_MODE_NHL: "shadow",
  };

  const report = await rehearseSportCutover(env, "nhl", {
    injectMissingBinding: true,
    injectStaleCore: true,
  });
  assert.equal(report.liveCutoverAuthorized, false);
  assert.equal(report.productionCutoverBlocked, true);
  assert.equal(report.deployedStillAuthoritative, true);
  assert.equal(report.ok, true);
  assert.equal(productSportDbHandle(env, "nhl").productIoUsesSportDb, false);
});

test("rehearsal simulated sport switch activates only in-process", async () => {
  const primary = db("primary", { games: ["g1"], preds: ["p1"] });
  const nfl = db("nfl", { games: ["g1"], preds: ["p1"] });
  const env = {
    DB: primary,
    NFL_DB: nfl,
    SPORT_DB_MODE_NFL: "shadow",
  };
  const report = await rehearseSportCutover(env, "nfl");
  assert.equal(report.ok, true);
  const sportStep = report.steps.find((s) => s.step === "simulated_sport_switch");
  assert.equal(sportStep.fingerprint.productIoUsesSportDb, true);
  // Live env untouched
  assert.equal(productSportDbHandle(env, "nfl").productIoUsesSportDb, false);
  assert.equal(env.SPORT_DB_MODE_NFL, "shadow");
});
