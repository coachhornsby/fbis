import test from "node:test";
import assert from "node:assert/strict";
import {createBasketballHistoricalReadiness} from "../functions/lib/basketballSdvHistoricalReadiness.js";
function source(sport,i,season=2026){
 const nba=sport==="nba",per=nba?90:68,periods=nba?4:2;
 const possessions=[];let scoreH=0,scoreA=0;
 for(let n=0;n<per;n++)for(const side of ["home","away"]){
  const p=(i+n+side.length)%4===0?2:0;
  if(side==="home")scoreH+=p;else scoreA+=p;
  possessions.push({id:"p"+n+side,sequence:possessions.length+1,
   period:1+Math.floor(n/(per/periods)),offense:side,points:p});
 }
 const start=new Date(Date.UTC(season-1,10,3+i,18)).toISOString();
 return {sport,gameId:sport+"-"+season+"-"+i,season,homeTeamId:"h",awayTeamId:"a",
  tipoff:start,observedAt:new Date(Date.parse(start)+5*3600000).toISOString(),
  sourceFingerprint:(i+20+(season-2026)*50).toString(16).padStart(64,"0"),
  regulationOnly:true,canAuthorizeWager:false,
  homeRegulationScore:scoreH,awayRegulationScore:scoreA,possessions};
}
test("A future NBA forecast can use at least 8 verified historical games, without asserting accuracy",()=>{
 const x=createBasketballHistoricalReadiness({sport:"nba",targetSeason:2027,
  asOf:"2027-02-01T00:00:00Z"});
 for(let i=0;i<10;i++)x.accept(source("nba",i));
 const v=x.summary();
 assert.equal(v.acceptedGames,10);
 assert.equal(v.distinctTeams,2);
 assert.equal(v.historyReadyTeams,2);
 assert.equal(v.historicalPregameForecasts,0);
 assert.equal(v.prospectiveValidated,false);
 assert.equal(v.canAuthorizeWager,false);
});
test("College roster-era gate remains closed without verified current season games",()=>{
 const x=createBasketballHistoricalReadiness({sport:"cbb",targetSeason:2027,
  asOf:"2027-02-01T00:00:00Z"});
 for(let i=0;i<10;i++)x.accept(source("cbb",i));
 assert.equal(x.summary().historyReadyTeams,0);
 for(let i=0;i<3;i++)x.accept(source("cbb",i,2027));
 assert.equal(x.summary().historyReadyTeams,2);
 assert.equal(x.summary().teams[0].currentSeasonGames,3);
});
test("Falsified provenance, duplicated game IDs and future-observed rows fail closed",()=>{
 const x=createBasketballHistoricalReadiness({sport:"nba",targetSeason:2027,
  asOf:"2027-02-01T00:00:00Z"});
 const a=source("nba",1);
 x.accept(a);
 assert.throws(()=>x.accept(a),/DUPLICATE_GAME_ID/);
 assert.throws(()=>x.accept({...source("nba",2),sourceFingerprint:"bad"}),/UNVERIFIED/);
 const future=source("nba",15,2027);
 future.observedAt="2027-03-01T00:00:00Z";
 assert.equal(x.accept(future),false);
 assert.equal(x.summary().excluded.futureObserved,1);
});
