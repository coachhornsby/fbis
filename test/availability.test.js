import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAvailabilityStatus,
  normalizeAvailabilityRecord,
  buildGameAvailabilityImpact,
  applyAvailabilityAdjustment,
} from "../functions/lib/availability.js";
import { extractTwoDeepAvailability } from "../functions/lib/twoDeep.js";

test("availability status normalization handles football designations", () => {
  assert.equal(normalizeAvailabilityStatus("Injured Reserve"), "IR");
  assert.equal(normalizeAvailabilityStatus("Did not practice - Questionable"), "QUESTIONABLE");
  assert.equal(normalizeAvailabilityStatus("Out"), "OUT");
  assert.equal(normalizeAvailabilityStatus("Full participant"), "ACTIVE");
});

test("licensed availability record normalizes to canonical row", () => {
  const row = normalizeAvailabilityRecord({
    sport: "NFL",
    teamAbbr: "CHI",
    playerName: "Example QB",
    position: "QB",
    depthRank: 1,
    designation: "Questionable",
    injury: "ankle",
  }, { source: "twodeep", observedAt: "2026-09-28T18:00:00Z" });
  assert.equal(row.sport, "nfl");
  assert.equal(row.teamKey, "chi");
  assert.equal(row.status, "QUESTIONABLE");
  assert.equal(row.position, "QB");
  assert.equal(row.depthRank, 1);
});

test("game availability impact is team-specific and bounded", () => {
  const game = {
    home: { abbr: "CHI", name: "Chicago Bears" },
    away: { abbr: "PHI", name: "Philadelphia Eagles" },
  };
  const rows = [
    {
      source:"twodeep", team_key:"chi", player_name:"QB One", position:"QB",
      depth_rank:1, status:"OUT", observed_at:"2026-09-28T18:00:00Z"
    },
    {
      source:"twodeep", team_key:"chi", player_name:"CB One", position:"CB",
      depth_rank:1, status:"OUT", observed_at:"2026-09-28T18:00:00Z"
    },
  ];
  const impact = buildGameAvailabilityImpact(game, rows, {
    sport:"nfl",
    nowMs:Date.parse("2026-09-28T19:00:00Z")
  });
  assert.equal(impact.configured, true);
  assert.ok(impact.homeScoreAdjustment < 0);
  assert.ok(impact.awayScoreAdjustment > 0);
  assert.ok(Math.abs(impact.homeScoreAdjustment) <= 3.5);
  assert.ok(Math.abs(impact.awayScoreAdjustment) <= 3.5);
});

test("availability adjustment updates final independent football board once", () => {
  const game = {
    projectionKind:"FBIS",
    projHomeScore:27,
    projAwayScore:24,
    model:{projectionKind:"FBIS",projHome:27,projAway:24,projTotal:51,projMargin:3},
    researchProjection:{home:27,away:24,total:51,margin:3},
    availabilityImpact:{
      configured:true,
      homeScoreAdjustment:-1,
      awayScoreAdjustment:0.5,
    },
  };
  const once = applyAvailabilityAdjustment(game,"nfl");
  assert.equal(once.projHomeScore,26);
  assert.equal(once.projAwayScore,24.5);
  assert.equal(once.model.projMargin,1.5);
  const twice = applyAvailabilityAdjustment(once,"nfl");
  assert.equal(twice.projHomeScore,26);
  assert.equal(twice.projAwayScore,24.5);
});

test("Two Deep adapter flattens common nested availability payloads without hardcoded endpoint shape", () => {
  const payload = {
    sport:"nfl",
    teams:[
      {
        teamAbbr:"CHI",
        players:[
          {playerName:"Player A",position:"WR",status:"Out"},
          {playerName:"Player B",position:"QB",status:"Questionable"},
        ],
      },
    ],
  };
  const rows = extractTwoDeepAvailability(payload);
  assert.equal(rows.length,2);
  assert.equal(rows[0].sport,"nfl");
  assert.equal(rows[0].teamKey,"chi");
});
