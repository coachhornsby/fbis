import test from "node:test";
import assert from "node:assert/strict";
import {cfbBoardEspnId,cfbBoardSeasonEvidence} from "../src/lib/cfbBoardSeasonJoin.js";
const fixture={
  ok:true,season:2026,version:"cfb-sdv-intelligence-v3",
  source:{sha256:"a".repeat(64),observedAt:"2026-10-14T20:00:00Z",providerPublicationAt:null},
  teams:[
    {teamId:"cfb:espn:204",espnId:"204",name:"Oregon State",games:5,rank:15,offenseRank:12,defenseRank:22,stats:{net_adj_epa:.16,adj_off_epa:.21,adj_def_epa:.05,success_off:0,success_def:.4},missingMetrics:2,availableMetrics:4},
    {teamId:"cfb:espn:21",espnId:"21",name:"San Diego State",games:4,rank:70,offenseRank:80,defenseRank:65,stats:{net_adj_epa:-.08,adj_off_epa:.01,adj_def_epa:.09},missingMetrics:2,availableMetrics:3}
  ]
};
const game={sport:"cfb",id:"game-1",home:{canonicalId:"cfb:espn:204"},away:{espnId:"21"}};
test("joins only by exact ESPN team IDs; preserves zero-valued metrics and source clocks",()=>{
 const r=cfbBoardSeasonEvidence(game,fixture);
 assert.equal(r.state,"SOURCE_OBSERVED");assert.equal(r.home.offenseSuccess,0);assert.equal(r.home.nationalRank,15);
 assert.equal(r.away.teamId,"cfb:espn:21");assert.equal(r.source.observedAt,fixture.source.observedAt);
 assert.equal(r.canQualify,false);assert.equal(r.canAuthorizeWager,false);assert.equal(r.canInfluenceProjection,false);
 assert.equal(r.historicalPitVerified,false);
});
test("does not infer a team from names or fabricate incomplete FBS stats",()=>{
 const noIds={...game,home:{name:"Oregon State"},away:{name:"San Diego State"}};
 assert.equal(cfbBoardSeasonEvidence(noIds,fixture).state,"IDENTITY_UNRESOLVED");
 assert.equal(cfbBoardSeasonEvidence(game,{...fixture,source:{}}).state,"SOURCE_UNAVAILABLE");
 assert.equal(cfbBoardSeasonEvidence(game,{...fixture,teams:fixture.teams.slice(0,1)}).state,"IDENTITY_UNRESOLVED");
 assert.equal(cfbBoardSeasonEvidence({...game,sport:"nfl"},fixture).state,"NOT_CFB");
 assert.equal(cfbBoardEspnId({canonicalId:"cfb:espn:204"}),"204");
 assert.equal(cfbBoardEspnId({id:"cfb:other:204"}),null);
});
test("source sample gaps are explicit, not zero-filled",()=>{
 const r=cfbBoardSeasonEvidence(game,{...fixture,teams:[{...fixture.teams[0],games:0},fixture.teams[1]]});
 assert.equal(r.state,"INSUFFICIENT_SOURCE_GAMES");
 assert.equal(r.home.games,0);assert.equal(r.home.offenseSuccess,0);
});
