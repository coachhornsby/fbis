import test from "node:test";
import assert from "node:assert/strict";
import { runShadowSportEvent } from "../functions/lib/sportShadowGenerators.js";
const base={eventId:"future",modelId:"A",modelVersion:"v1",publishedAt:"2026-10-21T12:00:00Z",eventStart:"2026-10-25T13:00:00Z",evidenceId:"frozen-id"};
const sports=["nfl","cfb","nba","cbb","wnba","mlb","npb","kbo","nhl","soccer"];
function history(sport,scope){return Array.from({length:81},(_,i)=>({
  sport,modelId:"A",eventId:"g"+i,marketScope:scope,official:true,prospective:true,identityVerified:true,
  publishedAt:"2026-10-18T10:00:00Z",eventStart:"2026-10-18T18:00:00Z",settledAt:"2026-10-19T02:00:00Z",
  predictedHome:20,predictedAway:17,actualHome:18+i%5,actualAway:16+i%4,
}));}
test("10 score sports preserve joint errors and require same-sport historical proof",()=>{
  for(const sport of sports){
    const scope=["nhl","soccer"].includes(sport)?"REGULATION":"FULL_GAME";
    const params={...base,sport,marketScope:scope,forecast:{home:22,away:17},referenceRows:history(sport,scope),iterations:100,seed:103};
    const a=runShadowSportEvent(params);
    assert.deepEqual(a,runShadowSportEvent(params));
    assert.equal(a.referenceGames,81);
    assert.equal(a.distributions.total.n,100);
    assert.equal(a.canAuthorizeWager,false);
  }
});
test("sport-mismatched outcomes and smaller populations are rejected",()=>{
 assert.throws(()=>runShadowSportEvent({...base,sport:"mlb",marketScope:"FULL_GAME",forecast:{home:5,away:4},referenceRows:history("nfl","FULL_GAME"),iterations:100}),/INSUFFICIENT/);
 assert.throws(()=>runShadowSportEvent({...base,sport:"nhl",marketScope:"FULL_GAME",forecast:{home:3,away:2},referenceRows:history("nhl","REGULATION"),iterations:100}),/UNSUPPORTED/);
});
test("tennis point-to-match is deterministic and requires validated timed serve rates",()=>{
  const tennis={homeServe:.64,awayServe:.59,bestOf:3,firstServer:"home",ruleset:"STANDARD_6_6_TIEBREAK",
    verified:true,provenanceId:"validated-atp-v4",observedAt:"2026-10-21T10:00:00Z"};
  const params={...base,sport:"tennis",marketScope:"MATCH",tennis,iterations:100,seed:11};
  const a=runShadowSportEvent(params);
  assert.deepEqual(a,runShadowSportEvent(params));
  assert.equal(a.distributions.total_games.n,100);
  assert.equal(a.referenceGames,null);
  assert.throws(()=>runShadowSportEvent({...params,tennis:{...tennis,verified:false}}),/UNVERIFIED/);
  assert.throws(()=>runShadowSportEvent({...params,tennis:{...tennis,observedAt:"2026-10-21T14:00:00Z"}}),/UNVERIFIED/);
});
