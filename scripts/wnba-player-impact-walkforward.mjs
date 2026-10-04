#!/usr/bin/env node
import fs from "node:fs";
import { buildWnbaDynamicSkill, wnbaBoxImpactPrior, fitWnbaRapm, combineWnbaPlayerImpact } from "../functions/lib/wnbaPlayerImpact.js";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const gamesFile=args.games||"artifacts/wnba-canonical.jsonl";
const stintsFile=args.stints||"artifacts/wnba-lineup-stints.jsonl";
const out=args.out||"artifacts/wnba-player-impact-walkforward.json";
const rowsOut=args.rows||"artifacts/wnba-player-impact-walkforward-rows.jsonl";
const minHistory=Number(args.minHistory||4),refitDays=Number(args.refitDays||18);
const read=p=>fs.existsSync(p)&&fs.statSync(p).size?fs.readFileSync(p,"utf8").split("\n").filter(Boolean).map(JSON.parse):[];
const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const sd=xs=>{if(xs.length<2)return null;const m=mean(xs);return Math.sqrt(xs.reduce((s,x)=>s+(x-m)**2,0)/(xs.length-1))};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const games=read(gamesFile).sort((a,b)=>Date.parse(a.start||a.date)-Date.parse(b.start||b.date));
const stints=read(stintsFile).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
const hist=new Map(),outRows=[];
let rapm={players:{},stints:0},lastFit=0;

function baselineProjection(rows,key){
  const recent=rows.slice(-12);
  const vals=recent.map(r=>finite(r[key])).filter(v=>v!=null);
  const mins=recent.map(r=>finite(r.minutes)).filter(v=>v!=null&&v>0);
  if(!vals.length||!mins.length)return null;
  const perMin=recent.map(r=>{const v=finite(r[key]),m=finite(r.minutes);return v!=null&&m>0?v/m:null}).filter(v=>v!=null);
  if(!perMin.length)return null;
  const projectedMinutes=mean(mins.slice(-6))??mean(mins);
  return mean(perMin.slice(-8))*projectedMinutes;
}
function impactProjection(base,impact,market){
  if(base==null)return null;
  const off=finite(impact?.offense)||0,def=finite(impact?.defense)||0;
  // Small challenger-only multiplier; walk-forward decides whether it survives.
  const weight=market==="points"||market==="threes"?off:def*.35+off*.15;
  return base*clamp(1+weight/500,.97,1.03);
}
function priorMap(asOf){
  const prior={};
  for(const [id,rows] of hist){const s=buildWnbaDynamicSkill(rows,{asOf});const p=wnbaBoxImpactPrior(s);if(p)prior[id]=p}
  return prior;
}

for(const g of games){
  const asOf=g.start||g.date,t=Date.parse(asOf);
  if(!lastFit||t-lastFit>=refitDays*86400000){
    const eligible=stints.filter(s=>Date.parse(s.date)<t);
    rapm=fitWnbaRapm(eligible,{priorByPlayer:priorMap(asOf),lambda:720,priorStrength:.40,iterations:45,tolerance:1e-4});
    lastFit=t;
  }
  for(const p of g.players||[]){
    const id=String(p.id||p.name||""),h=hist.get(id)||[];
    if(h.length>=minHistory&&finite(p.minutes)>0){
      const impact=combineWnbaPlayerImpact({playerId:id,history:h,rapm,asOf});
      for(const [market,key] of [["points","points"],["rebounds","rebounds"],["assists","assists"],["three_pointers_made","threes"]]){
        const actual=finite(p[key]),b=baselineProjection(h,key),e=impactProjection(b,impact.ok?impact:null,key);
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
  const b=rs.map(r=>Math.abs(r.baselineError)),e=rs.map(r=>Math.abs(r.impactError));
  const bm=mean(b),em=mean(e),ri=bm?((bm-em)/bm):null;
  markets[m]={n:rs.length,baselineMae:bm,impactMae:em,maeDelta:em-bm,relativeImprovement:ri,
    baselineBias:mean(rs.map(r=>r.baselineError)),impactBias:mean(rs.map(r=>r.impactError)),
    passed:rs.length>=300&&ri!=null&&ri>=.001};
}
const passCount=Object.values(markets).filter(x=>x.passed).length;
const report={generatedAt:new Date().toISOString(),modelId:"WNBA-FBIS-PLAYER-IMPACT-v1",
  method:"chronological_walk_forward_periodic_regularized_rapm",games:games.length,rows:outRows.length,markets,
  decision:passCount>=3?"PROMOTE_DIRECT_IMPACT_CONTEXT":"RETAIN_DIRECT_IMPACT_RESEARCH",
  directSelfImpactDecision:passCount>=3?"SUPPORTED":"REJECTED_OR_NO_INCREMENTAL_VALUE",
  roleRedistributionValidation:"PROSPECTIVE_ONLY_WITH_TIMESTAMPED_AVAILABILITY",
  governance:{marketUsed:false,targetGameAvailabilityUsed:false,propLinesUsed:false}};
fs.mkdirSync(out.split("/").slice(0,-1).join("/")||".",{recursive:true});
fs.writeFileSync(out,JSON.stringify(report,null,2)+"\n");
fs.writeFileSync(rowsOut,outRows.map(JSON.stringify).join("\n")+(outRows.length?"\n":""));
console.log(JSON.stringify(report,null,2));
