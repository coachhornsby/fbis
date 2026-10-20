import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCrossSportBoardSummary,
  publishCrossSportBoardSummary,
  readCrossSportBoardSummary,
  CORE_BOARD_SUMMARY_KEY,
} from "../functions/lib/coreBoardSummaries.js";

test("cross-sport summary is incomplete when any sport lacks stats", () => {
  const summary = buildCrossSportBoardSummary({
    sports: {
      nhl: { gameCount: 1, projectionCount: 1, complete: true },
      nfl: { complete: false },
    },
  });
  assert.equal(summary.complete, false);
  assert.ok(summary.incompleteSports.includes("nfl"));
});

test("missing sport entries fail closed as incomplete", () => {
  const summary = buildCrossSportBoardSummary({
    sports: {
      nhl: { gameCount: 1, projectionCount: 1, complete: true },
    },
  });
  assert.equal(summary.complete, false);
  assert.ok(summary.incompleteSports.includes("nfl"));
  assert.ok(summary.incompleteSports.includes("cfb"));
  const missing = summary.sports.find((s) => s.sport === "nfl");
  assert.equal(missing.complete, false);
  assert.equal(missing.reason, "SPORT_ENTRY_MISSING");
});

test("publish and read CORE board summary without fan-out to sport DBs", async () => {
  const writes = [];
  const primary = {
    prepare(sql) {
      if (sql.includes("FROM games")) {
        return { bind() { return { async first() { return { n: 2, freshest: "2026-10-20T00:00:00Z" }; } }; } };
      }
      if (sql.includes("FROM prediction_snapshots")) {
        return { bind() { return { async first() { return { n: 3, freshest: "2026-10-19T00:00:00Z" }; } }; } };
      }
      return { bind() { return { async first() { return { n: 0 }; } }; } };
    },
  };
  const coreStore = new Map();
  const core = {
    prepare(sql) {
      if (sql.startsWith("INSERT OR REPLACE INTO fbis_dashboard_summaries")) {
        return {
          bind(...args) {
            return {
              async run() {
                writes.push(args);
                coreStore.set(args[0], { summary_key: args[0], as_of: args[1], payload_json: args[2], source_binding: args[3] });
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      }
      if (sql.includes("FROM fbis_dashboard_summaries")) {
        return {
          bind(key) {
            return {
              async first() {
                return coreStore.get(key) || null;
              },
            };
          },
        };
      }
      return { bind() { return { async first() { return null; }, async run() { return {}; } }; } };
    },
  };

  const published = await publishCrossSportBoardSummary({ DB: primary, CORE_DB: core });
  assert.equal(published.ok, true);
  assert.equal(published.summary.summaryKey, CORE_BOARD_SUMMARY_KEY);
  assert.equal(published.coreBinding, "CORE_DB");
  assert.equal(writes.length, 1);

  const read = await readCrossSportBoardSummary({ DB: primary, CORE_DB: core });
  assert.equal(read.ok, true);
  assert.equal(read.summary.complete, true);
  assert.ok(read.summary.sports.some((s) => s.sport === "nhl" && s.gameCount === 2));
});
