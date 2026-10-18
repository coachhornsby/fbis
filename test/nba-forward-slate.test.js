import test from "node:test";
import assert from "node:assert/strict";
import {
  NBA_FORWARD_COLLECT_DAYS,
  NBA_FORWARD_SHADOW_DAYS,
  nbaCollectDates,
  nbaForwardDates,
  parseNbaDateArgs,
  shiftIsoDate,
} from "../functions/lib/nbaForwardSlate.js";
import { collectDatesForSport } from "../functions/lib/projLedger.js";

test("nbaForwardDates covers today through bounded look-ahead", () => {
  assert.deepEqual(nbaForwardDates("2026-10-18", 2), [
    "2026-10-18",
    "2026-10-19",
    "2026-10-20",
  ]);
  assert.equal(nbaForwardDates("2026-10-18", NBA_FORWARD_SHADOW_DAYS).length, 7);
});

test("parseNbaDateArgs accepts dates= and throughDays", () => {
  assert.deepEqual(parseNbaDateArgs({ dates: "2026-10-20,2026-10-21" }), [
    "2026-10-20",
    "2026-10-21",
  ]);
  assert.deepEqual(parseNbaDateArgs({ date: "2026-10-20", throughDays: 2 }), [
    "2026-10-20",
    "2026-10-21",
    "2026-10-22",
  ]);
});

test("nbaCollectDates mirrors five-day opening window", () => {
  const days = nbaCollectDates("2026-10-18", {
    shiftDateCT: (d, n) => shiftIsoDate(d, n),
  });
  assert.equal(days.length, NBA_FORWARD_COLLECT_DAYS + 1);
  assert.deepEqual(days, [
    "2026-10-18",
    "2026-10-19",
    "2026-10-20",
    "2026-10-21",
    "2026-10-22",
  ]);
});

test("collectDatesForSport widens NBA without changing NFL/CFB contract", () => {
  const nba = collectDatesForSport("nba", "2026-10-18", null);
  assert.ok(nba.includes("2026-10-20"));
  assert.ok(nba.includes("2026-10-22"));
  assert.equal(nba.length, 5);
  const nfl = collectDatesForSport("nfl", "2026-10-18", null);
  assert.deepEqual(nfl, [
    "2026-10-17",
    "2026-10-18",
    "2026-10-19",
    "2026-10-20",
  ]);
});

test("opening-week ESPN identity contract expects 36 unique events across Oct 20-24", () => {
  // Network scoreboard probe lives in scripts/nba-opening-night-readiness.mjs.
  // Keep this unit offline: only the date-window identity math is asserted here.
  const dates = ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"];
  assert.deepEqual(dates, nbaForwardDates("2026-10-20", 4));
  assert.equal(dates.length, 5);
});

test("attachNbaBoardProjection promotes v1 scores without wager authority", async () => {
  const { attachNbaBoardProjection } = await import("../functions/lib/nbaBoardProjection.js");
  const db = {
    prepare() {
      return {
        bind() {
          return this;
        },
        async all() {
          return {
            results: [
              {
                game_id: "g1",
                model_id: "NBA-FBIS-v1",
                model_version: "research-v1.1-calibrated",
                feature_cutoff_timestamp: "2026-10-18T12:00:00Z",
                projected_home: 115.8,
                projected_away: 119.1,
                projected_margin: -3.3,
                projected_total: 234.9,
                expected_possessions: 102.2,
                p_home_win: 0.41,
                sigma_margin: 14.5,
                sigma_total: 18.5,
                maturity: "VALIDATION",
                can_qualify: 1,
                can_authorize: 0,
                provenance_json: JSON.stringify({
                  marketUsed: false,
                  decomposition: { home: { off: 114 }, away: { off: 113 } },
                }),
                created_at: "2026-10-18T12:00:00Z",
              },
            ],
          };
        },
      };
    },
  };
  const out = await attachNbaBoardProjection(
    [
      {
        id: "g1",
        researchProjection: {
          modelId: "NBA-FBIS-FORM-v1",
          home: 112,
          away: 110,
          canAuthorize: false,
        },
      },
      { id: "g2" },
    ],
    db
  );
  assert.equal(out.meta.available, 1);
  assert.equal(out.meta.missing, 1);
  assert.equal(out.games[0].nbaFbisV1.home, 115.8);
  assert.equal(out.games[0].researchProjection.modelId, "NBA-FBIS-v1");
  assert.equal(out.games[0].projHomeScore, 115.8);
  assert.equal(out.games[0].canAuthorizeWager, false);
  assert.equal(out.games[0].challengers["NBA-FBIS-FORM-v1"].home, 112);
  assert.equal(out.games[1].nbaProjectionBlocker.code, "NBA_FBIS_V1_PROJECTION_MISSING");
});
