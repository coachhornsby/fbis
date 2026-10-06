import test from "node:test";
import assert from "node:assert/strict";
import { persistSoccerMatch } from "../functions/lib/store.js";
import {
  buildSoccerV2State,
  projectSoccerV2,
  SOCCER_FBIS_V2_ID,
} from "../functions/lib/soccerFbisV2.js";

function teams(){
  return {
    a:{espnId:"1",name:"Alpha"},
    b:{espnId:"2",name:"Beta"},
    c:{espnId:"3",name:"Gamma"},
    d:{espnId:"4",name:"Delta"},
  };
}

function sampleHistory(){
  const t=teams();
  const rows=[];
  let day=1;
  const push=(home,away,hs,as,extra={})=>{
    rows.push({
      id:String(day),date:`2026-07-${String(day).padStart(2,"0")}`,
      home,away,homeScore:hs,awayScore:as,
      homeShotsOnTarget:extra.hsot??5,awayShotsOnTarget:extra.asot??3,
      homePossession:extra.hp??54,awayPossession:extra.ap??46,
      homeXg:extra.hxg,awayXg:extra.axg,
      homePpda:extra.hppda,awayPpda:extra.appda,
      homeDeepCompletions:extra.hdeep,awayDeepCompletions:extra.adeep,
      homeExpectedPoints:extra.hxp,awayExpectedPoints:extra.axp,
    }); day++;
  };
  for(let i=0;i<9;i++){
    push(t.a,i%2?t.c:t.d,2+(i%3===0?1:0),i%4===0?1:0,{hxg:2.0,axg:0.8,hppda:8.5,appda:12.5,hdeep:9,adeep:4,hxp:2.2,axp:0.5});
    push(i%2?t.c:t.d,t.b,i%3===0?2:1,i%4===0?1:0,{hxg:1.4,axg:0.7,hppda:10,appda:14,hdeep:6,adeep:3,hxp:1.7,axp:0.8});
  }
  return {t,rows};
}

test("v2 state is strictly point-in-time",()=>{
  const {t,rows}=sampleHistory();
  const s1=buildSoccerV2State(rows,"2026-07-15");
  const s2=buildSoccerV2State([...rows,{
    id:"future",date:"2026-09-01",home:t.b,away:t.a,homeScore:9,awayScore:0
  }],"2026-07-15");
  assert.equal(s1.leagueMatches,s2.leagueMatches);
  assert.equal(s1.classifier.updates,s2.classifier.updates);
  assert.deepEqual(s1.classifier.weights,s2.classifier.weights);
});

test("v2 produces normalized independent ensemble probabilities",()=>{
  const {t,rows}=sampleHistory();
  const p=projectSoccerV2({
    start:"2026-08-01T18:00:00Z",soccerLeague:"eng.1",home:t.a,away:t.b
  },rows);
  assert.equal(p.ok,true);
  assert.equal(p.modelId,SOCCER_FBIS_V2_ID);
  assert.equal(p.marketInformed,false);
  assert.equal(p.canQualify,false);
  assert.equal(p.canAuthorize,false);
  assert.ok(Math.abs(p.pHomeWin+p.pDraw+p.pAwayWin-1)<1e-8);
  assert.ok(p.pHomeWin>p.pAwayWin);
  assert.ok(p.ensemble.v1Weight>=0.55&&p.ensemble.v1Weight<=0.82);
  assert.equal(p.provenance.featurePolicy,"strictly-pre-match");
});


test("v2 resolves exact team names when future provider IDs differ from canonical IDs",()=>{
  const {t,rows}=sampleHistory();
  const p=projectSoccerV2({
    start:"2026-08-01T18:00:00Z",
    soccerLeague:"eng.1",
    home:{id:"pitch-alpha",name:t.a.name},
    away:{id:"pitch-beta",name:t.b.name},
  },rows);
  assert.equal(p.ok,true);
  assert.equal(p.provenance.marketUsed,false);
  assert.equal(p.canQualify,false);
  assert.equal(p.canAuthorize,false);
});

test("v2 activates challenger after sufficient causal history",()=>{
  const t=teams();
  const rows=[];
  const clubs=[t.a,t.b,t.c,t.d];
  let d=new Date("2026-01-01T12:00:00Z");
  for(let i=0;i<72;i++){
    const home=clubs[i%4],away=clubs[(i+1+(i%2))%4];
    if(home===away) continue;
    rows.push({
      id:String(i),date:d.toISOString().slice(0,10),home,away,
      homeScore:(i%5===0?3:2),awayScore:(i%4===0?2:1),
      homeShotsOnTarget:6,awayShotsOnTarget:3,
      homePossession:56,awayPossession:44,
    });
    d.setUTCDate(d.getUTCDate()+3);
  }
  const p=projectSoccerV2({
    start:"2026-09-01T18:00:00Z",soccerLeague:"eng.1",home:t.a,away:t.b
  },rows);
  assert.equal(p.ok,true);
  assert.equal(p.challenger.active,true);
  assert.ok(p.challenger.updates>=40);
  assert.ok(p.ensemble.challengerWeight>0);
});

test("optional advanced features are additive, not required",()=>{
  const {t,rows}=sampleHistory();
  const noAdvanced=rows.map(r=>({
    ...r,homeXg:null,awayXg:null,homePpda:null,awayPpda:null,
    homeDeepCompletions:null,awayDeepCompletions:null,
    homeExpectedPoints:null,awayExpectedPoints:null
  }));
  const p=projectSoccerV2({
    start:"2026-08-01T18:00:00Z",soccerLeague:"eng.1",home:t.a,away:t.b
  },noAdvanced);
  assert.equal(p.ok,true);
  assert.equal(p.uncertainty.advancedCoverage,0);
});


test("canonical soccer persistence binds v2 advanced columns exactly",async()=>{
  let captured=null;
  const env={DB:{prepare(sql){return{bind(...args){
    captured={sql,args};
    assert.equal((sql.match(/\\?/g)||[]).length,args.length);
    return{run:async()=>({meta:{changes:1}})};
  }}}}};
  const r=await persistSoccerMatch(env,{
    id:"evt",eventId:"evt",league:"eng.1",season:2026,date:"2026-09-01",
    home:{espnId:"1",name:"Alpha"},away:{espnId:"2",name:"Beta"},
    homeScore:2,awayScore:1,homeXg:1.8,awayXg:0.7,homePpda:8.2,awayPpda:12.4,
    homeDeepCompletions:9,awayDeepCompletions:4,homeExpectedPoints:2.1,awayExpectedPoints:0.6,
    advancedSource:"espn-summary",advancedObservedAt:"2026-09-01T22:00:00Z"
  });
  assert.equal(r.ok,true);
  assert.match(captured.sql,/home_xg/);
  assert.match(captured.sql,/advanced_source/);
  assert.ok(captured.args.includes(1.8));
  assert.ok(captured.args.includes("espn-summary"));
});
