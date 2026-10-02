import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildMatchupFactors, attachMatchupFactors } from "../functions/lib/matchupFactors.js";

describe("sport matchup factors", () => {
  it("publishes NFL decomposition factors without using market data", () => {
    const game = {
      sport:"nfl", home:{abbr:"HOU"}, away:{abbr:"DAL"},
      nflProShadow:{ok:true,decomposition:{
        home:{teamPower:1.2,matchup:{pass:1.1,rush:.4,explosive:.3,pressure:.2,trenches:.1},qb:{value:.8},specialTeams:.1,context:0},
        away:{teamPower:.2,matchup:{pass:-.4,rush:.1,explosive:-.2,pressure:-.1,trenches:0},qb:{value:.1},specialTeams:0,context:0},
      }}
    };
    const rows=buildMatchupFactors(game);
    assert.ok(rows.some(r=>r.id==="pass" && r.edge==="HOU"));
    assert.ok(rows.some(r=>r.id==="qb" && r.edge==="HOU"));
    assert.ok(rows.every(r=>!String(r.source).toLowerCase().includes("market")));
  });

  it("publishes CFB offense-defense layers", () => {
    const game={sport:"cfb",home:{abbr:"TEX"},away:{abbr:"OU"},cfbMatchupV2:{ok:true,decomposition:{
      home:{layers:{passing:1.2,rushing:.5,success:.4,explosive:.2,havoc:-.1,trenches:.6,finishing:.3,quarterback:.7,pace:0}},
      away:{layers:{passing:-.2,rushing:.1,success:0,explosive:-.1,havoc:.2,trenches:-.2,finishing:.1,quarterback:.2,pace:0}},
    }}};
    const rows=buildMatchupFactors(game);
    assert.ok(rows.some(r=>r.label==="Pass offense vs pass defense" && r.edge==="TEX"));
    assert.ok(rows.some(r=>r.label==="Trenches / pressure"));
  });

  it("publishes MLB lineup, starter and batter-vs-starter evidence", () => {
    const game={
      sport:"mlb",home:{abbr:"HOU"},away:{abbr:"NYY"},
      homeSp:{name:"Home Pitcher"},awaySp:{name:"Away Pitcher"},
      savant:{homeSpEra:3.1,awaySpEra:4.2},
      bpp:{
        matchup:{
          vsAwaySp:{pitcher:"Away Pitcher",rcVs:12,hrVs:18,kVs:-7,n:9},
          vsHomeSp:{pitcher:"Home Pitcher",rcVs:-8,hrVs:-4,kVs:11,n:9},
        },
        batterMatchups:[{batterId:1,batterName:"Test Hitter",batterTeam:"HOU",pitcherId:2,pitcherName:"Away Pitcher",rcVs:25,hrVs:40,kVs:-15}],
      },
      mlbDeepShadow:{ok:true,pitcherKs:{home:{projection:6.2,opponentKRate:.24},away:{projection:4.8,opponentKRate:.20}},decomposition:{home:{environmentFactor:1.03},away:{environmentFactor:1.03}}},
    };
    const rows=buildMatchupFactors(game);
    assert.ok(rows.some(r=>r.id==="lineup-home" && r.label.includes("Away Pitcher")));
    assert.ok(rows.some(r=>String(r.id).startsWith("batter-") && r.label.includes("Test Hitter")));
    assert.ok(rows.some(r=>r.id==="starter-home"));
  });

  it("publishes NBA scoreboard-form matchup evidence only", () => {
    const game={sport:"nba",home:{abbr:"HOU"},away:{abbr:"SAS"},basketballForm:{ok:true,decomposition:{
      home:{offense:118.2,defenseAllowed:111.4},away:{offense:113.1,defenseAllowed:116.7},
      matchup:{homeExpected:117.45,awayExpected:112.25,hfa:2.5}
    }}};
    const rows=buildMatchupFactors(game);
    assert.ok(rows.some(r=>r.id==="home-offense-defense"));
    assert.ok(rows.some(r=>r.id==="form-matchup" && r.edge==="HOU"));
    assert.ok(rows.every(r=>String(r.source).includes("NBA-FBIS-FORM-v1")));
  });

  it("publishes CBB four-factor matchup evidence", () => {
    const game={sport:"cbb",home:{abbr:"UH"},away:{abbr:"KU"},
      cbbMatchupEvidence:{source:"CBBD adjusted ratings + Torvik/KenPom four factors",
        home:{adjOe:121,adjDe:91,tempo:66,efgPct:.57,efgPctD:.43,tovRate:.14,tovRateD:.24,orbRate:.39,drbRate:.75,ftr:.31,ftrD:.20,twoPtPct:.59,twoPtPctD:.41,threePtPct:.36,threePtPctD:.31},
        away:{adjOe:116,adjDe:97,tempo:70,efgPct:.52,efgPctD:.49,tovRate:.19,tovRateD:.18,orbRate:.31,drbRate:.69,ftr:.27,ftrD:.25,twoPtPct:.54,twoPtPctD:.48,threePtPct:.34,threePtPctD:.34}},
      challengers:{"CBB-MATCHUP-v1":{ok:true,matchupAdj:2.4}}};
    const rows=buildMatchupFactors(game);
    assert.ok(rows.some(r=>r.id==="four-factor-adjustment" && r.edge==="UH"));
    assert.ok(rows.some(r=>r.id==="efg"));
    assert.ok(rows.some(r=>r.id==="three"));
    assert.ok(rows.some(r=>r.id==="turnovers"));
    assert.ok(rows.some(r=>r.id==="rebounding"));
    assert.ok(rows.some(r=>r.id==="free-throws"));
  });

  it("does not invent factors for unsupported/missing source data", () => {
    assert.deepEqual(buildMatchupFactors({sport:"nba"}), []);
    assert.deepEqual(attachMatchupFactors([{sport:"mlb"}])[0].matchupFactors, []);
  });
});
