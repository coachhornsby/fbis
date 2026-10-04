import test from "node:test";
import assert from "node:assert/strict";

import { selectivePropStars, rankSelectiveProps, estimatedPropHitProbability } from "../functions/lib/selectivePropEdge.js";
import { projectTennisPlayerProps } from "../functions/lib/tennisPlayerPropModel.js";
import { projectCbbPlayerProps } from "../functions/lib/cbbPlayerPropModel.js";
import { flattenCfbPlayerProjectionRows } from "../functions/lib/cfbPlayerModel.js";
import {
  canonicalizeProPlayerPropMarket,
  normalizeProPropSport,
} from "../functions/lib/proPlayerProps.js";

test("selective star model rewards standardized edge and caps weak reliability", () => {
  assert.equal(selectivePropStars({ fbisProjection: 120, line: 100, fbisSigma: 20, dataQuality: 1 }), 5);
  assert.equal(selectivePropStars({ fbisProjection: 108, line: 100, fbisSigma: 20, dataQuality: 1 }), 2);
  assert.equal(selectivePropStars({
    fbisProjection: 130, line: 100, fbisSigma: 20, dataQuality: 0.3,
  }), 2);
  assert.equal(selectivePropStars({ fbisProjection: null, line: 100 }), null);
});

test("selector publishes strongest edges without sport quotas or weak filler", () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({
    sport: i % 2 ? "cfb" : "tennis",
    eventId: "g" + Math.floor(i / 2),
    playerName: "P" + i,
    fbisProjection: 100 + i,
    line: 100,
    fbisSigma: 20,
    dataQuality: 0.9,
  }));
  const out = rankSelectiveProps(rows, { maxRows: 12, minStars: 2 });
  assert.ok(out.rows.length <= 12);
  assert.equal(out.policy.quotaBySport, false);
  assert.equal(out.policy.fillWeakQuota, false);
  assert.ok(out.rows.every((r) => r.confidenceStars >= 2));
  assert.ok(out.rows[0].selectionScore >= out.rows.at(-1).selectionScore);
});

test("tennis model is independent and focused on total games markets", () => {
  const result = projectTennisPlayerProps({
    id: "m1",
    bestOf: 3,
    playerA: { id:"a", name:"A", holdPct:0.80, breakPct:0.24, surfaceHoldPct:0.82, surfaceBreakPct:0.25, sampleSize:30, elo:1900 },
    playerB: { id:"b", name:"B", holdPct:0.77, breakPct:0.22, surfaceHoldPct:0.76, surfaceBreakPct:0.21, sampleSize:25, elo:1810 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.marketInformed, false);
  assert.deepEqual(result.rows.map((r)=>r.market), ["total_games","total_games_won","total_games_won"]);
  assert.ok(result.rows.every((r)=>r.fbisProjection != null && r.fbisSigma > 0));
});

test("tennis model fails closed without service-return data", () => {
  const result = projectTennisPlayerProps({ playerA:{name:"A"}, playerB:{name:"B"} });
  assert.equal(result.ok, false);
  assert.equal(result.rows.length, 0);
});

test("CBB model projects only players with stable game/player inputs", () => {
  const result = projectCbbPlayerProps({
    projectedPossessions: 72,
    teamProjectedPoints: { DUKE: 80 },
  }, [{
    id:"1", name:"Guard", team:"DUKE", projectedMinutes:34,
    pointsPerGame:18, reboundsPerGame:5, assistsPerGame:6, threesMadePerGame:2.4,
    pointsPer40:22, reboundsPer40:6, assistsPer40:7, threesMadePer40:3,
    sampleSize:10, recentGames:5, roleConfidence:0.9,
    recent:{points:19,rebounds:5.2,assists:6.1,threesMade:2.5,pace:70},
    trend:{points:20,rebounds:5.5,assists:6.5,threesMade:2.7},
    volatility:{points:4.2,rebounds:2.1,assists:2.0,threesMade:1.1},
  }]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.rows.map((r)=>r.market), ["points","rebounds","assists","three_pointers_made","points_rebounds_assists"]);
  assert.ok(result.rows.every((r)=>r.independent && !r.marketInformed));
});

test("CFB adapter exposes only focused yardage markets to PrizePicks contract", () => {
  const projection = {
    players: {
      home: {
        QB1: {
          passing_yards: { player:"QB", player_id:"q", team:"H", projection:275, sigma:42, data_quality:0.8, role_confidence:0.9, sample_size:5 },
          attempts: { player:"QB", player_id:"q", team:"H", projection:32, sigma:5 },
        },
        RB1: {
          rushing_yards: { player:"RB", player_id:"r", team:"H", projection:88, sigma:24, data_quality:0.8, role_confidence:0.9, sample_size:5 },
        },
        WR1: {
          receiving_yards: { player:"WR", player_id:"w", team:"H", projection:74, sigma:22, data_quality:0.8, role_confidence:0.9, sample_size:5 },
        },
      },
      away: {},
    },
  };
  const rows = flattenCfbPlayerProjectionRows(projection);
  assert.deepEqual(rows.map((r)=>r.market).sort(), ["passing_yards","receiving_yards","rushing_yards"]);
});

test("focused college and tennis aliases normalize correctly", () => {
  assert.equal(normalizeProPropSport("NCAAF"), "cfb");
  assert.equal(normalizeProPropSport("College Basketball"), "cbb");
  assert.equal(normalizeProPropSport("ATP"), "tennis");
  assert.equal(canonicalizeProPlayerPropMarket("cfb", "Pass Yards"), "passing_yards");
  assert.equal(canonicalizeProPlayerPropMarket("tennis", "Games Won"), "total_games_won");
  assert.equal(canonicalizeProPlayerPropMarket("cbb", "3 Pointers Made"), "three_pointers_made");
  assert.equal(canonicalizeProPlayerPropMarket("cbb", "PRA"), "points_rebounds_assists");
});


test("selective prop portfolio requires enough modeled hit probability and role reliability", () => {
  assert.ok(estimatedPropHitProbability({fbisProjection:120,line:100,fbisSigma:20}) > 0.8);
  const out=rankSelectiveProps([
    {eventId:"g1",playerName:"Stable",fbisProjection:120,line:100,fbisSigma:20,dataQuality:0.9,roleConfidence:0.9,propGate:"CLEAR"},
    {eventId:"g2",playerName:"Low Role",fbisProjection:130,line:100,fbisSigma:20,dataQuality:0.9,roleConfidence:0.3,propGate:"CLEAR"},
    {eventId:"g3",playerName:"Held",fbisProjection:130,line:100,fbisSigma:20,dataQuality:0.9,roleConfidence:0.9,propGate:"HOLD"},
  ],{minStars:2});
  assert.deepEqual(out.rows.map(r=>r.playerName),["Stable"]);
  assert.equal(out.policy.minHitProbability,0.56);
});
