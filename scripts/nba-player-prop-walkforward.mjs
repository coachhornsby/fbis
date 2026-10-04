#!/usr/bin/env node
import fs from "node:fs";
import { projectNbaPlayer } from "../functions/lib/nbaPlayerPropModel.js";
const file=process.argv[2]||"artifacts/nba-canonical.jsonl";
const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const games=fs.readFileSync(file,"utf8").trim().split("\n").filter(Boolean).map(JSON.parse).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
const hist=new Map(),out=[];const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
for(const g of games){
 const teamScore=new Map([[g.homeId,g.homeScore],[g.awayId,g.awayScore]]);
 for(const p of g.players||[]){
   const key=String(p.id||p.name),prior=hist.get(key)||[];
   if(prior.length>=5){
    const proj=projectNbaPlayer({id:p.id,name:p.name},{history:prior,teamProjection:teamScore.get(p.teamId),gamePossessions:g.possessions||99.5,status:"AVAILABLE"});
    if(proj.ok)for(const [market,keyStat] of [["points","points"],["rebounds","rebounds"],["assists","assists"],["three_pointers_made","threes"]]){
      const pr=proj.markets[market],actual=finite(p[keyStat]);if(pr&&actual!=null)out.push({gameId:g.id,date:g.date,playerId:p.id,playerName:p.name,market,projection:pr.projection,sigma:pr.sigma,actual,error:pr.projection-actual,absError:Math.abs(pr.projection-actual)});
    }
   }
   if(!hist.has(key))hist.set(key,[]);hist.get(key).push({...p,date:g.start});
 }
}
const markets={};for(const m of ["points","rebounds","assists","three_pointers_made"]){const r=out.filter(x=>x.market===m);markets[m]={n:r.length,mae:mean(r.map(x=>x.absError)),bias:mean(r.map(x=>x.error))};}
const report={generatedAt:new Date().toISOString(),modelId:"NBA-PLAYER-PROP-v1",method:"chronological-player-walk-forward",n:out.length,markets,governance:{maturity:"RESEARCH",canQualify:false,canAuthorize:false,propLinesUsedAsFeatures:false}};
fs.mkdirSync("artifacts",{recursive:true});fs.writeFileSync("artifacts/nba-player-prop-walkforward.json",JSON.stringify(report,null,2));fs.writeFileSync("artifacts/nba-player-prop-rows.jsonl",out.map(JSON.stringify).join("\n")+"\n");console.log(JSON.stringify(report,null,2));
