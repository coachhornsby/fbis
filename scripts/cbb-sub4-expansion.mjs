import {readFileSync,mkdirSync,writeFileSync} from "node:fs";
const path=process.argv[2]||"artifacts/cbb-market-research-dataset.json";
const rows=JSON.parse(readFileSync(path,"utf8"));
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null},abs=Math.abs;
const profit=(w,l)=>w*(100/110)-l;
function summarize(a){let w=0,l=0,p=0;for(const x of a){if(x.result>0)w++;else if(x.result<0)l++;else p++;}const n=a.length,d=w+l,u=profit(w,l);return{n,w,l,p,winPct:d?+(100*w/d).toFixed(2):null,units:+u.toFixed(3),roi:n?+(100*u/n).toFixed(2):null};}
function base(r){const k=num(r.features?.kpSide),c=num(r.features?.cbbdSide),s=num(r.market?.spread),a=num(r.sideResidual);if(k==null||c==null||s==null||a==null)return null;if(abs(k)<2||abs(k)>=4||abs(s)>=20||Math.sign(k)!==Math.sign(c))return null;const home=k>0;return{k,c,s,a,home,dog:(home&&s>0)||(!home&&s<0),neutral:!!r.neutral,result:a===0?0:(Math.sign(k)===Math.sign(a)?1:-1),season:+r.season,form:home?num(r.roll?.homeAtsL5):num(r.roll?.awayAtsL5)};}
const cand=rows.map(r=>({r,b:base(r)})).filter(x=>x.b);
const rules=[];
const defs=[
 ["all",x=>true],
 ["dog",x=>x.dog],["favorite",x=>!x.dog],
 ["neutral",x=>x.neutral],["nonneutral",x=>!x.neutral],
 ["dog-neutral",x=>x.dog&&x.neutral],["dog-nonneutral",x=>x.dog&&!x.neutral],
 ["spread-under10",x=>abs(x.s)<10],["dog-spread-under10",x=>x.dog&&abs(x.s)<10],
 ["cbbd-edge-ge2",x=>abs(x.c)>=2],["cbbd-edge-ge3",x=>abs(x.c)>=3],
 ["dog-cbbd-ge2",x=>x.dog&&abs(x.c)>=2],["dog-cbbd-ge3",x=>x.dog&&abs(x.c)>=3],
 ["models-within2",x=>abs(x.k-x.c)<=2],["models-within1",x=>abs(x.k-x.c)<=1],
 ["dog-models-within2",x=>x.dog&&abs(x.k-x.c)<=2],
 ["prior-ats-nonnegative",x=>x.form!=null&&x.form>=0],
 ["dog-prior-ats-nonnegative",x=>x.dog&&x.form!=null&&x.form>=0],
];
for(const [name,fn] of defs){
 const dev=cand.filter(x=>[2023,2024].includes(x.b.season)&&fn(x.b)).map(x=>x.b);
 const conf=cand.filter(x=>x.b.season===2025&&fn(x.b)).map(x=>x.b);
 const early=cand.filter(x=>[2021,2022].includes(x.b.season)&&fn(x.b)).map(x=>x.b);
 rules.push({name,early:summarize(early),development2023_24:summarize(dev),confirmation2025:summarize(conf)});
}
rules.sort((a,b)=>(b.development2023_24.roi??-999)-(a.development2023_24.roi??-999));
const report={ok:true,generatedAt:new Date().toISOString(),scope:"KenPom disagreement 2.0-3.99 points; CBBD agrees on side; abs market spread <20",interpretation:"disagreement means model-vs-market spread difference, not sportsbook spread magnitude",governance:{researchOnly:true,canQualify:false,wagerAuthorization:false,confirmation2025NotUntouched:true},historicalStructuralCoverage:{available:["point-in-time KenPom projection","prior-only CBBD rolling projection","market spread","neutral site","dog/favorite status","prior ATS residual form"],notLeakageSafeEnoughForThisRun:["historical point-in-time eFG/2P/3P matchup snapshots","historical point-in-time ORB/FTR matchup snapshots"],policy:"not substituted with final-season statistics"},candidateCount:cand.length,baseline:{early:summarize(cand.filter(x=>[2021,2022].includes(x.b.season)).map(x=>x.b)),development2023_24:summarize(cand.filter(x=>[2023,2024].includes(x.b.season)).map(x=>x.b)),confirmation2025:summarize(cand.filter(x=>x.b.season===2025).map(x=>x.b))},rules};
mkdirSync("artifacts",{recursive:true});writeFileSync("artifacts/cbb-sub4-expansion.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
