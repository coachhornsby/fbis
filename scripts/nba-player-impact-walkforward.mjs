#!/usr/bin/env node
import fs from "node:fs";
import { buildDynamicSkillProfile, boxImpactPrior, fitRegularizedRapm, combinePlayerImpact } from "../functions/lib/nbaPlayerImpact.js";
import { projectNbaPlayer } from "../functions/lib/nbaPlayerPropModel.js";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const gamesFile=args.games||"artifacts/nba-canonical.jsonl";
const stintsFile=args.stints||"artifacts/nba-lineup-stints.jsonl";
const out=args.out||"artifacts/nba-player-impact-walkforward.json";
const rowsOut=args.rows||"artifacts/nba-player-impact-walkforward-rows.jsonl";
const minHistory=Number(args.minHistory||5),refitDays=Number(args.refitDays||21);
const read=p=>fs.existsSync(p)&&fs.statSync(p).size?fs.readFileSync(p,"utf8").split("\n").filter(Boolean).map(JSON.parse):[];
const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const games=read(gamesFile).sort((a,b)=>Date.parse(a.start||a.date)-Date.parse(b.start||b.date));
const stints=read(stintsFile).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
const hist=new Map(),outRows=[];
let rapm={players:{},stints:0},lastFit=0;

function buildPrior(asOf){
  const prior={};
  for(const [id,rows] of hist){
    const skill=buildDynamicSkillProfile(rows,{asOf});
    const p=boxImpactPrior(skill);if(p)prior[id]=p;
  }
  return prior;
}
for(const g of games){
  const asOf=g.start||g.date,t=Date.parse(asOf);
  if(!lastFit||t-lastFit>=refitDays*86400000){
    const prior=buildPrior(asOf);
    const eligible=stints.filter(s=>Date.parse(s.date)<t);
    rapm=fitRegularizedRapm(eligible,{priorByPlayer:prior,lambda:900,priorStrength:.35,iterations:45,tolerance:1e-4});
    lastFit=t;
  }
  for(const p of g.players||[]){
    const id=String(p.id||p.name||""),h=hist.get(id)||[];
    if(h.length>=minHistory&&finite(p.minutes)>0){
      const base=projectNbaPlayer({id,name:p.name},{history:h,status:"AVAILABLE"});
      const impact=combinePlayerImpact({playerId:id,history:h,rapm,asOf});
      const enhanced=projectNbaPlayer({id,name:p.name},{history:h,status:"AVAILABLE",impactContext:impact.ok?impact:null});
      for(const [market,key] of [["points","points"],["rebounds","rebounds"],["assists","assists"],["three_pointers_made","threes"]]){
        const actual=finite(p[key]),b=base?.markets?.[market]?.projection,e=enhanced?.markets?.[market]?.projection;
        if(actual==null||b==null||e==null)continue;
        outRows.push({gameId:g.id,date:asOf,playerId:id,playerName:p.name,market,actual,baseline:b,impact:e,
          baselineError:b-actual,impactError:e-actual,impactNet:impact.ok?impact.net:null,rapmStints:rapm.stints});
      }
    }
  }
  for(const p of g.players||[]){
    const id=String(p.id||p.name||"");if(!id)continue;
    if(!hist.has(id))hist.set(id,[]);
    hist.get(id).push({...p,date:asOf,teamPossessions:g.possessions});
  }
}
const markets={};
for(const m of ["points","rebounds","assists","three_pointers_made"]){
  const rs=outRows.filter(r=>r.market===m);
  const baseAbs=rs.map(r=>Math.abs(r.baselineError)),impactAbs=rs.map(r=>Math.abs(r.impactError));
  const baselineMae=mean(baseAbs),impactMae=mean(impactAbs);
  const relativeImprovement=baselineMae?((baselineMae-impactMae)/baselineMae):null;
  markets[m]={n:rs.length,baselineMae,impactMae,maeDelta:impactMae-baselineMae,relativeImprovement,
    baselineBias:mean(rs.map(r=>r.baselineError)),impactBias:mean(rs.map(r=>r.impactError)),
    passed:rs.length>=500&&relativeImprovement!=null&&relativeImprovement>=0.001};
}
const passCount=Object.values(markets).filter(x=>x.passed).length;
const report={generatedAt:new Date().toISOString(),modelId:"NBA-FBIS-PLAYER-IMPACT-v1",method:"chronological_walk_forward_with_periodic_rapm_refit",
  games:games.length,rows:outRows.length,markets,decision:passCount>=3?"PROMOTE_IMPACT_CONTEXT":"RETAIN_RESEARCH",
  directSelfImpactDecision:passCount>=3?"SUPPORTED":"REJECTED_OR_NO_INCREMENTAL_VALUE",
  roleRedistributionValidation:"PROSPECTIVE_ONLY_UNTIL_TIMESTAMPED_AVAILABILITY_SAMPLE_EXISTS",
  governance:{marketUsed:false,targetGameAvailabilityUsed:false,propLinesUsed:false}};
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
fs.writeFileSync(out,JSON.stringify(report,null,2)+"\n");
fs.writeFileSync(rowsOut,outRows.map(JSON.stringify).join("\n")+(outRows.length?"\n":""));
console.log(JSON.stringify(report,null,2));
