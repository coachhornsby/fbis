#!/usr/bin/env node
import fs from "node:fs";
import { projectNbaGame } from "../functions/lib/nbaModel.js";
import { buildNbaScheduleContext } from "../functions/lib/nbaTravelContext.js";
import { projectBasketballForm } from "../functions/lib/basketballFormModel.js";
const file=process.argv[2]||"artifacts/nba-canonical.jsonl";
const rows=fs.readFileSync(file,"utf8").trim().split("\n").filter(Boolean).map(JSON.parse).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
const byTeam=new Map(),out=[];
const push=(id,row)=>{if(!byTeam.has(id))byTeam.set(id,[]);byTeam.get(id).push(row)};
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
for(let i=0;i<rows.length;i++){
 const g=rows[i],hh=byTeam.get(g.homeId)||[],ah=byTeam.get(g.awayId)||[];
 if(hh.length>=6&&ah.length>=6){
  const p=projectNbaGame({id:g.id,neutralSite:g.neutralSite,featureCutoff:g.start},{
   homeHistory:hh,awayHistory:ah,
   homeContext:buildNbaScheduleContext(rows,g,i,"home"),
   awayContext:buildNbaScheduleContext(rows,g,i,"away")
  });
  const agg=x=>({games:x.length,pointsFor:x.reduce((s,r)=>s+r.pointsFor,0),pointsAgainst:x.reduce((s,r)=>s+r.pointsAgainst,0)});
  const f=projectBasketballForm("nba",{neutralSite:g.neutralSite},{homeCurrent:agg(hh),awayCurrent:agg(ah)});
  if(p.ok){
   const am=g.homeScore-g.awayScore,at=g.homeScore+g.awayScore;
   out.push({gameId:g.id,date:g.date,modelMargin:p.margin,modelTotal:p.total,formMargin:f.ok?f.margin:null,formTotal:f.ok?f.total:null,
    actualMargin:am,actualTotal:at,marginAbsError:Math.abs(p.margin-am),totalAbsError:Math.abs(p.total-at),
    formMarginAbsError:f.ok?Math.abs(f.margin-am):null,formTotalAbsError:f.ok?Math.abs(f.total-at):null,winnerCorrect:(p.margin>0)===(am>0),formWinnerCorrect:f.ok?((f.margin>0)===(am>0)):null});
  }
 }
 const hp={date:g.start,pointsFor:g.homeScore,pointsAgainst:g.awayScore,possessions:g.possessions,fga:g.home.fga,orb:g.home.orb,tov:g.home.tov,fta:g.home.fta,efg:g.home.efg,tovPct:g.home.tovPct,orbPct:g.home.orbPct,ftRate:g.home.ftRate};
 const ap={date:g.start,pointsFor:g.awayScore,pointsAgainst:g.homeScore,possessions:g.possessions,fga:g.away.fga,orb:g.away.orb,tov:g.away.tov,fta:g.away.fta,efg:g.away.efg,tovPct:g.away.tovPct,orbPct:g.away.orbPct,ftRate:g.away.ftRate};
 push(g.homeId,hp);push(g.awayId,ap);
}
const valid=(xs,k)=>xs.map(x=>x[k]).filter(Number.isFinite);
const report={generatedAt:new Date().toISOString(),modelId:"NBA-FBIS-v1",benchmark:"NBA-FBIS-FORM-v1",method:"chronological-expanding-walk-forward",n:out.length,
 marginMae:mean(valid(out,"marginAbsError")),totalMae:mean(valid(out,"totalAbsError")),winnerAccuracy:out.length?out.filter(x=>x.winnerCorrect).length/out.length:null,
 benchmarkMarginMae:mean(valid(out,"formMarginAbsError")),benchmarkTotalMae:mean(valid(out,"formTotalAbsError")),benchmarkWinnerAccuracy:mean(out.filter(x=>x.formWinnerCorrect!=null).map(x=>x.formWinnerCorrect?1:0)),
 governance:{maturity:"RESEARCH",canQualify:false,canAuthorize:false,autoPromote:false}};
fs.mkdirSync("artifacts",{recursive:true});fs.writeFileSync("artifacts/nba-fbis-v1-walkforward.json",JSON.stringify(report,null,2));fs.writeFileSync("artifacts/nba-fbis-v1-rows.jsonl",out.map(JSON.stringify).join("\n")+"\n");console.log(JSON.stringify(report,null,2));
