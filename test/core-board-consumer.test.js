import test from "node:test";
import assert from "node:assert/strict";
import { loadCoreBoardOverview, CORE_BOARD_CONSUMER_CONTRACT } from "../functions/lib/coreBoardConsumer.js";
import { CORE_BOARD_SUMMARY_KEY } from "../functions/lib/coreBoardSummaries.js";

function makeCore(asOf, payload) {
  return {
    prepare(sql) {
      if (sql.includes("FROM fbis_dashboard_summaries")) {
        return {
          bind() {
            return {
              async first() {
                return {
                  summary_key: CORE_BOARD_SUMMARY_KEY,
                  as_of: asOf,
                  payload_json: JSON.stringify(payload),
                  source_binding: "CORE_DB",
                };
              },
            };
          },
        };
      }
      return { bind() { return { async first() { return null; } }; } };
    },
  };
}

test("board consumer refuses stale CORE without touching sport DBs", async () => {
  const overview = await loadCoreBoardOverview(
    {
      CORE_DB: makeCore("2026-10-19T00:00:00.000Z", {
        complete: true,
        sports: [{ sport: "nfl", complete: true, gameCount: 1 }],
        incompleteSports: [],
      }),
      NFL_DB: { prepare() { throw new Error("sport-db-must-not-be-queried"); } },
    },
    { now: new Date("2026-10-20T12:00:00.000Z") }
  );
  assert.equal(overview.contract, CORE_BOARD_CONSUMER_CONTRACT);
  assert.equal(overview.ok, false);
  assert.equal(overview.usable, false);
  assert.equal(overview.reason, "SUMMARY_STALE");
  assert.equal(overview.canAuthorizeWager, false);
});

test("board consumer returns fresh CORE sports list", async () => {
  const asOf = "2026-10-20T11:55:00.000Z";
  const overview = await loadCoreBoardOverview(
    {
      CORE_DB: makeCore(asOf, {
        complete: true,
        sports: [
          { sport: "nfl", complete: true, gameCount: 8, projectionCount: 8 },
          { sport: "cfb", complete: true, gameCount: 12, projectionCount: 12 },
        ],
        incompleteSports: [],
      }),
    },
    { now: new Date("2026-10-20T12:00:00.000Z") }
  );
  assert.equal(overview.ok, true);
  assert.equal(overview.usable, true);
  assert.equal(overview.source, "CORE");
  assert.equal(overview.sports.length, 2);
  assert.equal(overview.asOf, asOf);
});
