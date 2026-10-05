#!/usr/bin/env node
import fs from "node:fs";
import { projectNbaGame } from "../functions/lib/nbaModel.js";
import { buildNbaScheduleContext } from "../functions/lib/nbaTravelContext.js";
import { projectNbaPlayer } from "../functions/lib/nbaPlayerPropModel.js";

const file=process.argv[2]||"artifacts/nba-canonical.jsonl";
const holdoutStart=process.argv[3]||"2025-10-21";
const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const games=fs.readFileSync(file,"utf8").trim().split("\n").filter(Boolean).map(JSON.parse).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
const playerHist=new Map();
const teamHist=new Map();
const out=[];
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;

function pushTeam(id,row){
  const key=String(id||"");
  if(!key)return;
  if(!teamHist.has(key))teamHist.set(key,[]);
  teamHist.get(key).push(row);
}
function teamRow(g,side){
  const isHome=side==="home";
  const team=g[side]||{};
  return {
    date:g.start||g.date,
    pointsFor:isHome?g.homeScore:g.awayScore,
    pointsAgainst:isHome?g.awayScore:g.homeScore,
    possessions:g.possessions,
    fga:team.fga,orb:team.orb,tov:team.tov,fta:team.fta,
    efg:team.efg,tovPct:team.tovPct,orbPct:team.orbPct,ftRate:team.ftRate,
  };
}

for(const g of games){
  const date=String(g.date||"");
  const hHist=teamHist.get(String(g.homeId||""))||[];
  const aHist=teamHist.get(String(g.awayId||""))||[];
  let gameProjection=null;

  if(date>=holdoutStart && hHist.length>=6 && aHist.length>=6){
    const gi=games.indexOf(g);
    gameProjection=projectNbaGame(
      {id:g.id,neutralSite:g.neutralSite,featureCutoff:g.start},
      {homeHistory:hHist,awayHistory:aHist,
       homeContext:buildNbaScheduleContext(games,g,gi,"home"),
       awayContext:buildNbaScheduleContext(games,g,gi,"away")}
    );
  }

  if(date>=holdoutStart && gameProjection?.ok){
    const teamProjection=new Map([
      [String(g.homeId),gameProjection.home],
      [String(g.awayId),gameProjection.away],
    ]);
    for(const p of g.players||[]){
      const key=String(p.id||p.name||"");
      const prior=playerHist.get(key)||[];
      if(prior.length<5)continue;
      const projectedTeam=teamProjection.get(String(p.teamId||""));
      if(projectedTeam==null)continue;
      const proj=projectNbaPlayer(
        {id:p.id,name:p.name},
        {
          history:prior,
          teamProjection:projectedTeam,
          gamePossessions:gameProjection.expectedPossessions,
          status:"AVAILABLE"
        }
      );
      if(!proj.ok)continue;
      for(const [market,keyStat] of [
        ["points","points"],
        ["rebounds","rebounds"],
        ["assists","assists"],
        ["three_pointers_made","threes"]
      ]){
        const pr=proj.markets[market],actual=finite(p[keyStat]);
        if(!pr||actual==null)continue;
        const priorVals=prior.slice(-10).map(r=>finite(r[keyStat])).filter(v=>v!=null);
        const baselineProjection=priorVals.length?mean(priorVals):null;
        out.push({
          gameId:g.id,date:g.date,playerId:p.id,playerName:p.name,teamId:p.teamId,
          market,projection:pr.projection,sigma:pr.sigma,projectedMinutes:proj.minutes,
          gameModelId:gameProjection.modelId,gameModelVersion:gameProjection.modelVersion,
          projectedTeamScore:projectedTeam,projectedPossessions:gameProjection.expectedPossessions,
          baselineProjection,
          actual,error:pr.projection-actual,absError:Math.abs(pr.projection-actual),
          baselineError:baselineProjection==null?null:baselineProjection-actual,
          baselineAbsError:baselineProjection==null?null:Math.abs(baselineProjection-actual),
          featureCutoff:g.start,marketInformed:false
        });
      }
    }
  }

  for(const p of g.players||[]){
    const key=String(p.id||p.name||"");
    if(!key)continue;
    if(!playerHist.has(key))playerHist.set(key,[]);
    playerHist.get(key).push({...p,date:g.start});
  }
  pushTeam(g.homeId,teamRow(g,"home"));
  pushTeam(g.awayId,teamRow(g,"away"));
}

const markets={};
for(const m of ["points","rebounds","assists","three_pointers_made"]){
  const r=out.filter(x=>x.market===m);
  const rb=r.filter(x=>x.baselineAbsError!=null);
  markets[m]={
    n:r.length,
    mae:mean(r.map(x=>x.absError)),
    bias:mean(r.map(x=>x.error)),
    baselineN:rb.length,
    trailing10BaselineMae:mean(rb.map(x=>x.baselineAbsError)),
    maeAdvantageVsTrailing10:mean(rb.map(x=>x.baselineAbsError))-mean(r.map(x=>x.absError))
  };
}
const report={
  generatedAt:new Date().toISOString(),
  modelId:"NBA-PLAYER-PROP-v1",
  gameModelId:"NBA-FBIS-v1",
  method:"untouched-2025-26-player-holdout-with-pregame-game-model",
  holdoutStart,
  n:out.length,
  markets,
  integrity:{
    actualTeamScoreUsedAsFeature:false,
    actualPossessionsUsedAsFeature:false,
    propLinesUsedAsFeatures:false,
    targetGameStatsUsedAsFeatures:false,
    historicalAvailabilityReconstructed:false,
    evaluationCondition:"target player appeared in target-game box score"
  },
  governance:{
    maturity:"RESEARCH",
    canQualify:false,
    canAuthorize:false,
    requiresProspectiveAvailabilityAndMarketValidation:true
  }
};
fs.mkdirSync("artifacts",{recursive:true});
fs.writeFileSync("artifacts/nba-player-prop-walkforward.json",JSON.stringify(report,null,2));
fs.writeFileSync("artifacts/nba-player-prop-rows.jsonl",out.map(JSON.stringify).join("\n")+"\n");
console.log(JSON.stringify(report,null,2));
