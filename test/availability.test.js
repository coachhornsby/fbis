import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAvailabilityStatus,
  normalizeAvailabilityRecord,
  buildGameAvailabilityImpact,
  applyAvailabilityAdjustment,
  buildSportAvailabilityPreflight,
} from "../functions/lib/availability.js";
import { extractTwoDeepAvailability } from "../functions/lib/twoDeep.js";
import { extractNflOfficialInjuries } from "../functions/lib/nflOfficialInjuries.js";

test("availability status normalization handles football designations", () => {
  assert.equal(normalizeAvailabilityStatus("Injured Reserve"), "IR");
  assert.equal(normalizeAvailabilityStatus("Did not practice - Questionable"), "QUESTIONABLE");
  assert.equal(normalizeAvailabilityStatus("Out"), "OUT");
  assert.equal(normalizeAvailabilityStatus("Full participant"), "ACTIVE");
  assert.equal(normalizeAvailabilityStatus("Did Not Participate In Practice"), "DNP_PRACTICE");
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


test("stale weekly designations do not keep moving projections unless status is persistent", () => {
  const game = {
    home: { abbr: "CHI", name: "Chicago Bears" },
    away: { abbr: "PHI", name: "Philadelphia Eagles" },
  };
  const nowMs = Date.parse("2026-09-28T18:00:00Z");
  const old = "2026-09-25T00:00:00Z";
  const staleOut = buildGameAvailabilityImpact(game, [{
    source:"twodeep", team_key:"chi", player_name:"QB One", position:"QB",
    depth_rank:1, status:"OUT", source_updated_at:old, observed_at:"2026-09-28T17:00:00Z"
  }], { sport:"nfl", nowMs });
  assert.equal(staleOut.homeScoreAdjustment, 0);

  const staleIr = buildGameAvailabilityImpact(game, [{
    source:"twodeep", team_key:"chi", player_name:"QB One", position:"QB",
    depth_rank:1, status:"IR", source_updated_at:old, observed_at:"2026-09-28T17:00:00Z"
  }], { sport:"nfl", nowMs });
  assert.ok(staleIr.homeScoreAdjustment < 0);
});


test("sport-specific availability preflight holds unresolved MLB starters and NHL goalies", () => {
  const mlb = buildSportAvailabilityPreflight({
    sport:"mlb",
    home:{abbr:"NYY"},away:{abbr:"BOS"},
    homeSp:{id:null},awaySp:{id:22},
    quality:{flags:["missing_home_sp"]},
    availabilityImpact:{configured:true,stale:false,home:{players:[]},away:{players:[]}},
  },"mlb");
  assert.equal(mlb.state,"HOLD");
  assert.ok(mlb.reasons.includes("probable_starter_unresolved"));

  const nhl = buildSportAvailabilityPreflight({
    sport:"nhl",
    home:{abbr:"TOR"},away:{abbr:"BOS"},
    nhlV1:{layers:{goalie:{
      home:{goalieId:"g1",status:"EXPECTED_STARTER_PRIOR"},
      away:{goalieId:"g2",status:"EXPECTED_STARTER_CURRENT"},
    }}},
    availabilityImpact:{configured:true,stale:false,home:{players:[]},away:{players:[]}},
  },"nhl");
  assert.equal(nhl.state,"HOLD");
  assert.ok(nhl.reasons.includes("starting_goalie_not_confirmed"));
});

test("NBA preflight fails closed when availability feed is not configured", () => {
  const p = buildSportAvailabilityPreflight({sport:"nba",home:{},away:{}},"nba");
  assert.equal(p.state,"BLOCKED");
  assert.ok(p.reasons.includes("rights_cleared_injury_feed_required"));
});


test("official NFL injury report tables normalize practice and game status by team", () => {
  const html = `
    <section><h3>Chicago Bears</h3>
      <table>
        <thead><tr><th>Player</th><th>Position</th><th>Injuries</th><th>Practice Status</th><th>Game Status</th></tr></thead>
        <tbody>
          <tr><td>Caleb Williams</td><td>QB</td><td>Hamstring</td><td>Did Not Participate In Practice</td><td>Out</td></tr>
          <tr><td>Example Receiver</td><td>WR</td><td>Ankle</td><td>Limited Participation in Practice</td><td>Questionable</td></tr>
        </tbody>
      </table>
    </section>
    <section><h3>Green Bay Packers</h3>
      <table>
        <tr><th>Player</th><th>Position</th><th>Injuries</th><th>Practice Status</th><th>Game Status</th></tr>
        <tr><td>Example Guard</td><td>G</td><td>Knee</td><td>Did Not Participate In Practice</td><td></td></tr>
      </table>
    </section>
  `;
  const rows = extractNflOfficialInjuries(html,{observedAt:"2026-10-05T05:00:00Z"});
  assert.equal(rows.length,3);
  const qb=rows.find(r=>r.playerName==="Caleb Williams");
  assert.equal(qb.teamKey,"chi");
  assert.equal(qb.status,"OUT");
  assert.equal(qb.practiceStatus,"Did Not Participate In Practice");
  assert.equal(qb.source,"nfl-official");
  const guard=rows.find(r=>r.playerName==="Example Guard");
  assert.equal(guard.teamKey,"gb");
  assert.equal(guard.status,"DNP_PRACTICE");
});

test("official NFL rows flow into player-prop availability holds without treating practice DNP as OUT", () => {
  const game = {
    sport:"nfl",
    home:{abbr:"CHI",name:"Chicago Bears"},
    away:{abbr:"GB",name:"Green Bay Packers"},
  };
  const impact=buildGameAvailabilityImpact(game,[{
    source:"nfl-official",team_key:"chi",player_name:"Example WR",position:"WR",
    depth_rank:null,status:"DNP_PRACTICE",practice_status:"Did Not Participate In Practice",
    source_updated_at:"2026-10-05T05:00:00Z",observed_at:"2026-10-05T05:00:00Z"
  }],{sport:"nfl",nowMs:Date.parse("2026-10-05T05:10:00Z")});
  assert.equal(impact.configured,true);
  assert.ok(impact.home.offensePenalty>0);
  assert.equal(impact.home.players[0].status,"DNP_PRACTICE");
  assert.equal(impact.criticalUnresolved,false);
});


test("stale carried NFL profile OUT state remains active until superseded", () => {
  const game={home:{abbr:"CHI",name:"Chicago Bears"},away:{abbr:"GB",name:"Green Bay Packers"}};
  const impact=buildGameAvailabilityImpact(game,[{
    source:"nfl-profile",persistent_state:1,team_key:"chi",player_name:"WR One",position:"WR",
    depth_rank:1,status:"OUT",source_updated_at:"2026-09-28T10:00:00Z",observed_at:"2026-09-28T10:00:00Z"
  }],{sport:"nfl",nowMs:Date.parse("2026-10-05T10:00:00Z")});
  assert.ok(impact.home.offensePenalty>0);
  assert.equal(impact.home.players[0].status,"OUT");
});
