import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBoardActionIntel,
  attachActionIntelToGames,
} from "../functions/lib/boardActionIntel.js";
import { leaguesForSport } from "../functions/lib/actionApifyCollector.js";
import { ODDS_PROVIDER_ORDER } from "../functions/lib/oddsProviderRouter.js";

test("buildBoardActionIntel maps consensus + public splits for display", () => {
  const intel = buildBoardActionIntel({
    fbis_event_id: "nfl_broncos_chiefs_2026-09-14_b3",
    sport: "nfl",
    match_confidence: "EXACT",
    collected_at: "2026-09-13T21:00:00.000Z",
    consensus_json: JSON.stringify({
      spreadHome: -2.5,
      total: 43.5,
      moneylineHome: -135,
      moneylineAway: 114,
    }),
    public_betting_json: JSON.stringify({
      spreadHome: { ticketsPercent: 38, moneyPercent: 55 },
    }),
    best_odds_json: JSON.stringify({ spreadHome: { book: "Pinnacle", price: -110 } }),
    line_movement_json: JSON.stringify({ openSpreadHome: -3.0 }),
    research_fields_json: null,
  });
  assert.equal(intel.provider, "ACTION_APIFY");
  assert.equal(intel.role, "market_intelligence");
  assert.equal(intel.governanceMode, "shadow");
  assert.equal(intel.displayOnly, true);
  assert.equal(intel.canQualify, false);
  assert.equal(intel.canAuthorizeWager, false);
  assert.equal(intel.inProductionRouter, false);
  assert.equal(intel.consensus.spreadHome, -2.5);
  assert.equal(intel.consensus.total, 43.5);
  assert.equal(intel.publicSplits.ticketPct, 38);
  assert.equal(intel.publicSplits.moneyPct, 55);
  assert.equal(intel.publicSplits.moneyTicketGap, 17);
  assert.equal(intel.movement.bestBook, "Pinnacle");
  assert.equal(intel.publicSplits.sharpLabel, null);
});

test("attachActionIntelToGames joins by event id and never promotes odds authority", async () => {
  const rows = [
    {
      fbis_event_id: "nfl_a",
      sport: "nfl",
      match_confidence: "HIGH",
      collected_at: "2026-09-13T20:00:00.000Z",
      consensus_json: JSON.stringify({ spreadHome: -1, total: 44 }),
      public_betting_json: JSON.stringify({
        spreadHome: { ticketsPercent: 60, moneyPercent: 40 },
      }),
      best_odds_json: null,
      line_movement_json: null,
      research_fields_json: null,
      decision_eligible: 0,
      can_qualify: 0,
      can_authorize_wager: 0,
    },
  ];
  const db = {
    prepare(sql) {
      assert.match(sql, /shadow_market_observations/);
      assert.match(sql, /fbis_event_id/);
      return {
        bind() {
          return this;
        },
        async all() {
          return { results: rows };
        },
      };
    },
  };
  const games = [
    { id: "nfl_a", sport: "nfl", away: { abbr: "DEN" }, home: { abbr: "KC" } },
    { id: "nfl_b", sport: "nfl", away: { abbr: "DAL" }, home: { abbr: "NYG" } },
  ];
  const out = await attachActionIntelToGames(games, db);
  assert.equal(out.attached, 1);
  assert.equal(out.games[0].actionIntel.consensus.spreadHome, -1);
  assert.equal(out.games[0].actionIntel.canQualify, false);
  assert.equal(out.games[0].sentiment.source, "ACTION_APIFY");
  assert.equal(out.games[1].actionIntel, undefined);
  assert.ok(!ODDS_PROVIDER_ORDER.map((x) => String(x).toLowerCase()).includes("action"));
  assert.ok(!ODDS_PROVIDER_ORDER.map((x) => String(x).toLowerCase()).includes("apify"));
});

test("leaguesForSport accepts board sport cbb via ncaab alias", () => {
  assert.deepEqual(leaguesForSport("cbb"), ["ncaab"]);
  assert.deepEqual(leaguesForSport("nba"), ["nba"]);
  assert.deepEqual(leaguesForSport("nfl"), ["nfl"]);
});

test("publicSplits.markets exposes ML / RL / TOTAL money leans for knife UI", () => {
  const intel = buildBoardActionIntel({
    fbis_event_id: "nfl_knife_1",
    sport: "nfl",
    match_confidence: "EXACT",
    collected_at: "2026-09-13T21:00:00.000Z",
    consensus_json: JSON.stringify({
      spreadHome: -3,
      total: 45.5,
      moneylineHome: -150,
      moneylineAway: 130,
    }),
    public_betting_json: JSON.stringify({
      spreadHome: { ticketsPercent: 38, moneyPercent: 55 },
      moneylineHome: { ticketsPercent: 70, moneyPercent: 45 },
      over: { ticketsPercent: 52, moneyPercent: 61 },
    }),
    best_odds_json: null,
    line_movement_json: null,
    research_fields_json: null,
  });
  assert.equal(intel.publicSplits.sharpLabel, null);
  assert.equal(intel.publicSplits.primaryMarket, "RL");
  assert.equal(intel.publicSplits.ticketPct, 38);
  const byMkt = Object.fromEntries(intel.publicSplits.markets.map((m) => [m.market, m]));
  assert.equal(byMkt.RL.leanSide, "HOME");
  assert.equal(byMkt.RL.magnitude, 17);
  assert.equal(byMkt.ML.leanSide, "AWAY");
  assert.equal(byMkt.ML.magnitude, 25);
  assert.equal(byMkt.TOTAL.leanSide, "OVER");
  assert.equal(byMkt.TOTAL.magnitude, 9);
  assert.ok(intel.publicSplits.markets.every((m) => m.sharpLabel == null));
});

