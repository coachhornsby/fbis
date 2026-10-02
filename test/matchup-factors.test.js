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

  it("does not invent factors for unsupported/missing source data", () => {
    assert.deepEqual(buildMatchupFactors({sport:"nba"}), []);
    assert.deepEqual(attachMatchupFactors([{sport:"mlb"}])[0].matchupFactors, []);
  });
});
