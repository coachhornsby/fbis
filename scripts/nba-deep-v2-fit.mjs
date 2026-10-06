#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { buildNbaDeepFeatures, NBA_DEEP_FEATURE_NAMES, teamHistoryRow } from "../functions/lib/nbaDeepFeatures.js";
import { buildNbaScheduleContext } from "../functions/lib/nbaTravelContext.js";
import { buildDynamicSkillProfile, boxImpactPrior } from "../functions/lib/nbaPlayerImpact.js";

const args=Object.fromEntries(process.argv.slice(2).map(x=>x.split("=")));
const gamesFile=args.games||"artifacts/nba-canonical.jsonl";
const shotsFile=args.shots||"artifacts/nba-shot-profiles.jsonl";
const out=args.out||"artifacts/nba-fbis-v2-deep-fit.json";
const reportOut=args.report||"artifacts/nba-fbis-v2-deep-validation.json";
const rowsOut=args.rows||"artifacts/nba-fbis-v2-deep-rows.jsonl";
const trainingCutoff=args.trainingCutoff||"2025-06-22T23:59:59Z";
const holdoutStart=args.holdoutStart||"2025-10-21T00:00:00Z";
const minHistory=Number(args.minHistory||6);
const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const readJsonl=p=>fs.existsSync(p)&&fs.statSync(p).size?fs.readFileSync(p,"utf8").split("\n").filter(Boolean).map(JSON.parse):[];
const games=readJsonl(gamesFile).sort((a,b)=>Date.parse(a.start||a.date)-Date.parse(b.start||b.date));
const shots=new Map(readJsonl(shotsFile).map(r=>[String(r.gameId),r.profiles||{}]));
const teamHist=new Map(),playerHist=new Map(),latestTeam=new Map(),lastRotation=new Map(),featureRows=[];

const push=(map,key,row)=>{const k=String(key||"");if(!k)return;if(!map.has(k))map.set(k,[]);map.get(k).push(row)};
function expectedLineup(teamId,asOf){
 const t=Date.parse(asOf),cand=[];
 for(const [id,h] of playerHist){
   if(String(latestTeam.get(id)||"")!==String(teamId)||!h.length)continue;
   const last=h.at(-1);if(t-Date.parse(last.date||0)>60*86400000)continue;
   const skill=buildDynamicSkillProfile(h,{asOf});if(!skill)continue;
   const impact=boxImpactPrior(skill);if(!impact)continue;
   cand.push({id,minutes:finite(skill.minutes)||0,impact});
 }
 cand.sort((a,b)=>b.minutes-a.minutes);
 const rot=cand.slice(0,9),den=rot.reduce((s,x)=>s+x.minutes,0)||1;
 const offense=rot.reduce((s,x)=>s+x.impact.offense*x.minutes,0)/den;
 const defense=rot.reduce((s,x)=>s+x.impact.defense*x.minutes,0)/den;
 const net=rot.reduce((s,x)=>s+x.impact.net*x.minutes,0)/den;
 const prev=lastRotation.get(String(teamId))||new Set(),now=new Set(rot.slice(0,8).map(x=>x.id));
 const overlap=now.size?[...now].filter(x=>prev.has(x)).length/now.size:0;
 return {offense,defense,net,continuity:overlap,minutesKnown:Math.min(240,den),availabilityVerified:false,players:rot.map(x=>x.id)};
}
function actualRotation(g,teamId){
 return new Set((g.players||[]).filter(p=>String(p.teamId)===String(teamId)&&(finite(p.minutes)||0)>=8).sort((a,b)=>(finite(b.minutes)||0)-(finite(a.minutes)||0)).slice(0,8).map(p=>String(p.id||p.name)));
}

for(let i=0;i<games.length;i++){
 const g=games[i],date=g.start||g.date,hid=String(g.homeId),aid=String(g.awayId);
 const hh=teamHist.get(hid)||[],ah=teamHist.get(aid)||[];
 if(hh.length>=minHistory&&ah.length>=minHistory){
   const homeSchedule=buildNbaScheduleContext(games,g,i,"home"),awaySchedule=buildNbaScheduleContext(games,g,i,"away");
   const homeLineup=expectedLineup(hid,date),awayLineup=expectedLineup(aid,date);
   const f=buildNbaDeepFeatures({id:g.id,start:g.start,date:g.date,neutralSite:g.neutralSite,homeId:hid,awayId:aid,home:g.home,away:g.away,featureCutoff:date},{
     homeHistory:hh,awayHistory:ah,homeSchedule,awaySchedule,homeLineup,awayLineup
   });
   if(f.ok){
     const actualMargin=Number(g.homeScore)-Number(g.awayScore),actualTotal=Number(g.homeScore)+Number(g.awayScore);
     featureRows.push({
       gameId:String(g.id),date,vector:f.vector,values:f.values,
       v1Margin:f.incumbent.margin,v1Total:f.incumbent.total,
       actualMargin,actualTotal,
       homeSchedule,awaySchedule,homeLineup,awayLineup
     });
   }
 }
 const sp=shots.get(String(g.id))||null;
 push(teamHist,hid,teamHistoryRow(g,"home",sp));push(teamHist,aid,teamHistoryRow(g,"away",sp));
 for(const p of g.players||[]){
   const id=String(p.id||p.name||"");if(!id)continue;
   push(playerHist,id,{...p,date,teamId:String(p.teamId||"")});latestTeam.set(id,String(p.teamId||""));
 }
 lastRotation.set(hid,actualRotation(g,hid));lastRotation.set(aid,actualRotation(g,aid));
}

function standardize(rows){
 const p=NBA_DEEP_FEATURE_NAMES.length,means=Array(p).fill(0),scales=Array(p).fill(1);
 for(let j=0;j<p;j++){const xs=rows.map(r=>r.vector[j]).filter(Number.isFinite);means[j]=mean(xs)||0;const v=mean(xs.map(x=>(x-means[j])**2))||0;scales[j]=Math.sqrt(v)||1}
 return {means,scales,z:rows.map(r=>r.vector.map((x,j)=>((finite(x)||0)-means[j])/scales[j]))};
}
function fitRidge(X,y,lambda=.35,iterations=80){
 const n=X.length,p=X[0]?.length||0,coef=Array(p).fill(0),intercept=mean(y)||0,pred=Array(n).fill(intercept);
 for(let it=0;it<iterations;it++){
   for(let j=0;j<p;j++){
     let num=0,den=lambda*n;
     for(let i=0;i<n;i++){
       const x=X[i][j],partial=y[i]-(pred[i]-coef[j]*x);
       num+=x*partial;den+=x*x;
     }
     const next=den?num/den:0,delta=next-coef[j];
     if(delta)for(let i=0;i<n;i++)pred[i]+=delta*X[i][j];
     coef[j]=next;
   }
 }
 return {intercept,coefficients:coef,pred};
}
function quantile(xs,q){const a=[...xs].sort((a,b)=>a-b),i=Math.max(0,Math.min(a.length-1,Math.floor(q*(a.length-1))));return a[i]}
function fitStumps(X,residual,{rounds=36,learningRate=.08}={}){
 const n=X.length,p=X[0]?.length||0,pred=Array(n).fill(0),stumps=[];
 const thresholds=Array.from({length:p},(_,j)=>[.15,.3,.5,.7,.85].map(q=>quantile(X.map(r=>r[j]),q)).filter((v,i,a)=>i===0||v!==a[i-1]));
 for(let r=0;r<rounds;r++){
   let best=null;
   for(let j=0;j<p;j++)for(const t of thresholds[j]){
     let ln=0,ls=0,rn=0,rs=0;
     for(let i=0;i<n;i++){const y=residual[i]-pred[i];if(X[i][j]<=t){ln++;ls+=y}else{rn++;rs+=y}}
     if(!ln||!rn)continue;
     const lv=ls/ln,rv=rs/rn;let sse=0;
     for(let i=0;i<n;i++){const y=residual[i]-pred[i],v=X[i][j]<=t?lv:rv;sse+=(y-v)**2}
     if(!best||sse<best.sse)best={feature:j,threshold:t,left:lv,right:rv,sse};
   }
   if(!best)break;
   stumps.push({...best,learningRate});
   for(let i=0;i<n;i++)pred[i]+=learningRate*(X[i][best.feature]<=best.threshold?best.left:best.right);
 }
 return {stumps,pred};
}
function fitHead(train,targetKey,baseKey){
 const s=standardize(train),y=train.map(r=>r[targetKey]-r[baseKey]);
 const ridge=fitRidge(s.z,y,.45,90);
 const residual=y.map((v,i)=>v-ridge.pred[i]);
 const boost=fitStumps(s.z,residual,{rounds:40,learningRate:.07});
 const fitPred=ridge.pred.map((v,i)=>v+boost.pred[i]);
 const sigma=Math.sqrt(mean(y.map((v,i)=>(v-fitPred[i])**2))||1);
 return {means:s.means,scales:s.scales,intercept:ridge.intercept,coefficients:ridge.coefficients,stumps:boost.stumps,sigma};
}
function score(vector,head){
 const z=vector.map((x,j)=>((finite(x)||0)-head.means[j])/Math.max(head.scales[j],1e-8));
 let v=head.intercept;for(let j=0;j<z.length;j++)v+=head.coefficients[j]*z[j];
 for(const s of head.stumps)v+=(s.learningRate??1)*(z[s.feature]<=s.threshold?s.left:s.right);
 return v;
}

const train=featureRows.filter(r=>Date.parse(r.date)<=Date.parse(trainingCutoff));
const holdout=featureRows.filter(r=>Date.parse(r.date)>=Date.parse(holdoutStart));
if(train.length<500||holdout.length<500)throw new Error(`insufficient train/holdout rows train=${train.length} holdout=${holdout.length}`);
const margin=fitHead(train,"actualMargin","v1Margin"),total=fitHead(train,"actualTotal","v1Total");
const evalRows=holdout.map(r=>{
 const dm=score(r.vector,margin),dt=score(r.vector,total),m=r.v1Margin+dm,t=r.v1Total+dt;
 return {...r,deepMargin:m,deepTotal:t,marginResidual:dm,totalResidual:dt,
   v1MarginAbsError:Math.abs(r.v1Margin-r.actualMargin),deepMarginAbsError:Math.abs(m-r.actualMargin),
   v1TotalAbsError:Math.abs(r.v1Total-r.actualTotal),deepTotalAbsError:Math.abs(t-r.actualTotal),
   v1WinnerCorrect:(r.v1Margin>0)===(r.actualMargin>0),deepWinnerCorrect:(m>0)===(r.actualMargin>0)};
});
const metric=(k)=>mean(evalRows.map(r=>r[k]).filter(Number.isFinite));
const v1MarginMae=metric("v1MarginAbsError"),deepMarginMae=metric("deepMarginAbsError"),v1TotalMae=metric("v1TotalAbsError"),deepTotalMae=metric("deepTotalAbsError");
const v1Winner=mean(evalRows.map(r=>r.v1WinnerCorrect?1:0)),deepWinner=mean(evalRows.map(r=>r.deepWinnerCorrect?1:0));
const marginImprovement=(v1MarginMae-deepMarginMae)/v1MarginMae,totalImprovement=(v1TotalMae-deepTotalMae)/v1TotalMae;
const evidencePass=marginImprovement>=.005&&totalImprovement>=.003&&deepWinner>=v1Winner-.005;
const fit={
 id:"nba-fbis-v2-deep-fit",modelId:"NBA-FBIS-v2-DEEP",version:"research-v1",
 trainingStart:train[0]?.date||null,trainingCutoff,holdoutStart,featureNames:NBA_DEEP_FEATURE_NAMES,
 margin,total,
 validation:{n:evalRows.length,v1MarginMae,deepMarginMae,marginImprovement,v1TotalMae,deepTotalMae,totalImprovement,v1WinnerAccuracy:v1Winner,deepWinnerAccuracy:deepWinner,evidencePass},
 governance:{marketUsed:false,holdoutViewedForPromotion:true,autoPromote:false,canQualify:false,canAuthorize:false}
};
const report={generatedAt:new Date().toISOString(),...fit.validation,trainN:train.length,holdoutN:holdout.length,decision:evidencePass?"EVIDENCE_PASS_CHALLENGER":"RETAIN_RESEARCH",
 featureCount:NBA_DEEP_FEATURE_NAMES.length,shotProfileGames:shots.size,
 integrity:{marketUsed:false,targetGameBoxUsedAsFeature:false,targetGamePlayersUsedAsFeature:false,realRestTravel:true,lineupPointInTime:true,availabilityHistoricalReconstructed:false}};
fs.mkdirSync(path.dirname(out),{recursive:true});
fs.writeFileSync(out,JSON.stringify(fit,null,2)+"\n");fs.writeFileSync(reportOut,JSON.stringify(report,null,2)+"\n");fs.writeFileSync(rowsOut,evalRows.map(JSON.stringify).join("\n")+"\n");
console.log(JSON.stringify(report,null,2));
