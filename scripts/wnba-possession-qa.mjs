#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { auditWnbaLineupEvidence } from "../functions/lib/wnbaLineupModel.js";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const gamesFile=args.games||"artifacts/wnba-canonical.jsonl";
const pbpFile=args.pbp||"artifacts/wnba-pbp.jsonl";
const statesFile=args.states||"artifacts/wnba-possession-state.jsonl";
const stintsFile=args.stints||"artifacts/wnba-lineup-stints.jsonl";
const out=args.out||"artifacts/wnba-possession-qa.json";
const read=p=>fs.existsSync(p)&&fs.statSync(p).size?fs.readFileSync(p,"utf8").split("\n").filter(Boolean).map(JSON.parse):[];
const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const mean=xs=>{const a=xs.filter(Number.isFinite);return a.length?a.reduce((s,x)=>s+x,0)/a.length:null};
const pct=(n,d)=>d?n/d:null;

const games=read(gamesFile),pbp=read(pbpFile),states=read(statesFile),stints=read(stintsFile);
const gameBy=new Map(games.map(g=>[String(g.id),g]));
const pbpBy=new Map(pbp.map(g=>[String(g.id),g]));
const stateBy=new Map(states.map(g=>[String(g.gameId||g.id),g]));
const stintsBy=new Map();
for(const s of stints){const k=String(s.gameId||"");if(!stintsBy.has(k))stintsBy.set(k,[]);stintsBy.get(k).push(s)}

const rows=[];
for(const g of games){
  const id=String(g.id),p=pbpBy.get(id),s=stateBy.get(id),gs=stintsBy.get(id)||[];
  const players=g.players||[];
  const hp=players.filter(x=>String(x.teamId)===String(g.homeId));
  const ap=players.filter(x=>String(x.teamId)===String(g.awayId));
  const lineupQa=p?auditWnbaLineupEvidence({plays:p.plays||[],homeTeamId:g.homeId,awayTeamId:g.awayId,homePlayers:hp,awayPlayers:ap}):null;

  const boxFgaHome=finite(g.home?.fga),boxFgaAway=finite(g.away?.fga);
  const boxTpaHome=hp.reduce((a,x)=>a+(finite(x.tpa)||0),0);
  const boxTpaAway=ap.reduce((a,x)=>a+(finite(x.tpa)||0),0);
  const stateHome=s?.teams?.[String(g.homeId)],stateAway=s?.teams?.[String(g.awayId)];
  const durationTarget=2400+Math.max(0,Math.max(...((p?.plays||[]).map(x=>Number(x.period||0))),4)-4)*300;
  const stintSeconds=gs.reduce((a,x)=>a+(finite(x.durationSeconds)||0),0);
  const completeStints=gs.filter(x=>(x.homePlayers||[]).length===5&&(x.awayPlayers||[]).length===5);
  const shotRows=s?.shots||[];
  const totalPoss=(finite(stateHome?.possessions)||0)+(finite(stateAway?.possessions)||0);
  const early=(finite(stateHome?.early?.fga)||0)+(finite(stateAway?.early?.fga)||0);
  const middle=(finite(stateHome?.middle?.fga)||0)+(finite(stateAway?.middle?.fga)||0);
  const late=(finite(stateHome?.late?.fga)||0)+(finite(stateAway?.late?.fga)||0);
  const phaseDen=early+middle+late;
  const gameStates=["clutch","close","moderate","large"];
  const gameStatePoss=gameStates.reduce((sum,k)=>sum+(finite(stateHome?.gameState?.[k]?.possessions)||0)+(finite(stateAway?.gameState?.[k]?.possessions)||0),0);

  rows.push({
    gameId:id,date:g.date,start:g.start,
    pbpPresent:Boolean(p),plays:p?.plays?.length||0,
    possessionPresent:Boolean(s),homePoss:finite(stateHome?.possessions),awayPoss:finite(stateAway?.possessions),
    possessionBalanceDelta:s?.qa?.possessionBalanceDelta??null,
    boxPossessions:finite(g.possessions),reconstructedPossessions:s?.qa?.reconstructedPossessions??null,
    boxPossessionDelta:s?.qa?.boxPossessionDelta??null,
    boxFgaHome,reconFgaHome:finite(stateHome?.fga),fgaDeltaHome:boxFgaHome==null||finite(stateHome?.fga)==null?null:finite(stateHome.fga)-boxFgaHome,
    boxFgaAway,reconFgaAway:finite(stateAway?.fga),fgaDeltaAway:boxFgaAway==null||finite(stateAway?.fga)==null?null:finite(stateAway.fga)-boxFgaAway,
    boxTpaHome,reconTpaHome:finite(stateHome?.threePa),tpaDeltaHome:finite(stateHome?.threePa)==null?null:finite(stateHome.threePa)-boxTpaHome,
    boxTpaAway,reconTpaAway:finite(stateAway?.threePa),tpaDeltaAway:finite(stateAway?.threePa)==null?null:finite(stateAway.threePa)-boxTpaAway,
    shots:shotRows.length,zoneResolution:s?.qa?.zoneResolution??null,coordinateCoverage:s?.qa?.coordinateCoverage??null,
    playerIdentityCoverage:shotRows.length?shotRows.filter(x=>String(x.playerId||"")).length/shotRows.length:null,
    lineupStints:gs.length,completeLineupStints:completeStints.length,
    lineupDurationCoverage:durationTarget?Math.min(1,stintSeconds/durationTarget):null,
    substitutionEvents:lineupQa?.substitutionEvents??0,substitutionResolution:lineupQa?.resolutionRate??null,
    transitionProxyRate:totalPoss?((finite(stateHome?.transitionProxyPossessions)||0)+(finite(stateAway?.transitionProxyPossessions)||0))/totalPoss:null,
    earlyShotShare:phaseDen?early/phaseDen:null,middleShotShare:phaseDen?middle/phaseDen:null,lateShotShare:phaseDen?late/phaseDen:null,
    gameStateCoverage:totalPoss?gameStatePoss/totalPoss:null,
  });
}

const report={
  generatedAt:new Date().toISOString(),
  games:games.length,
  coverage:{
    pbpGameCoverage:pct(rows.filter(r=>r.pbpPresent).length,rows.length),
    possessionGameCoverage:pct(rows.filter(r=>r.possessionPresent).length,rows.length),
    gamesWithPlays:pct(rows.filter(r=>r.plays>0).length,rows.length),
    gamesWithLineupStints:pct(rows.filter(r=>r.lineupStints>0).length,rows.length),
  },
  plays:{total:rows.reduce((s,r)=>s+r.plays,0),meanPerGame:mean(rows.map(r=>r.plays))},
  possessions:{
    meanHomeAwayBalanceDelta:mean(rows.map(r=>finite(r.possessionBalanceDelta))),
    meanAbsBoxDelta:mean(rows.map(r=>r.boxPossessionDelta==null?null:Math.abs(r.boxPossessionDelta))),
    within3Balance:pct(rows.filter(r=>finite(r.possessionBalanceDelta)!=null&&Math.abs(r.possessionBalanceDelta)<=3).length,rows.filter(r=>finite(r.possessionBalanceDelta)!=null).length),
    within8Box:pct(rows.filter(r=>finite(r.boxPossessionDelta)!=null&&Math.abs(r.boxPossessionDelta)<=8).length,rows.filter(r=>finite(r.boxPossessionDelta)!=null).length),
  },
  shooting:{
    totalShots:rows.reduce((s,r)=>s+r.shots,0),
    meanZoneResolution:mean(rows.map(r=>finite(r.zoneResolution))),
    meanCoordinateCoverage:mean(rows.map(r=>finite(r.coordinateCoverage))),
    meanPlayerIdentityCoverage:mean(rows.map(r=>finite(r.playerIdentityCoverage))),
    meanAbsFgaDelta:mean(rows.flatMap(r=>[r.fgaDeltaHome,r.fgaDeltaAway].map(x=>x==null?null:Math.abs(x)))),
    meanAbsTpaDelta:mean(rows.flatMap(r=>[r.tpaDeltaHome,r.tpaDeltaAway].map(x=>x==null?null:Math.abs(x)))),
  },
  lineup:{
    meanDurationCoverage:mean(rows.map(r=>finite(r.lineupDurationCoverage))),
    meanSubstitutionResolution:mean(rows.map(r=>finite(r.substitutionResolution))),
    substitutionEvents:rows.reduce((s,r)=>s+r.substitutionEvents,0),
  },
  state:{
    meanTransitionProxyRate:mean(rows.map(r=>finite(r.transitionProxyRate))),
    meanEarlyShotShare:mean(rows.map(r=>finite(r.earlyShotShare))),
    meanMiddleShotShare:mean(rows.map(r=>finite(r.middleShotShare))),
    meanLateShotShare:mean(rows.map(r=>finite(r.lateShotShare))),
    meanGameStateCoverage:mean(rows.map(r=>finite(r.gameStateCoverage))),
  },
  gates:{
    pbpCoveragePass:(pct(rows.filter(r=>r.pbpPresent).length,rows.length)??0)>=0.95,
    possessionCoveragePass:(pct(rows.filter(r=>r.possessionPresent).length,rows.length)??0)>=0.95,
    boxPossessionAgreementPass:(mean(rows.map(r=>r.boxPossessionDelta==null?null:Math.abs(r.boxPossessionDelta)))??999)<=8,
    zoneResolutionPass:(mean(rows.map(r=>finite(r.zoneResolution)))??0)>=0.85,
    playerIdentityPass:(mean(rows.map(r=>finite(r.playerIdentityCoverage)))??0)>=0.80,
    gameStateCoveragePass:(mean(rows.map(r=>finite(r.gameStateCoverage)))??0)>=0.90,
  },
  rows,
};
report.gates.overall=Object.values(report.gates).every(Boolean);
fs.mkdirSync(path.dirname(out),{recursive:true});
fs.writeFileSync(out,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({...report,rows:undefined},null,2));
