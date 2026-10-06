#!/usr/bin/env node
import fs from "node:fs";

const INPUT=process.argv[2]||"artifacts/soccer-v3-walkforward-rows.jsonl";
const OUT=process.argv[3]||"artifacts/soccer-phase3b-league-validation.json";
const EVIDENCE=process.argv[4]||"artifacts/soccer-phase3b-evidence.json";
const PRIORITY=["eng.1","eng.2","ger.1","esp.1","ita.1","fra.1","uefa.champions","uefa.europa","usa.1","mex.1"];
const MODEL_VERSION="research-v1.2-phase3-score-layer";
const CORE_LINES=[-0.5,0,0.5];

const rows=fs.readFileSync(INPUT,"utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const finite=v=>Number.isFinite(Number(v));
const mean=xs=>{const a=xs.map(Number).filter(Number.isFinite);return a.length?a.reduce((s,v)=>s+v,0)/a.length:null;};
const sum=xs=>xs.map(Number).filter(Number.isFinite).reduce((s,v)=>s+v,0);
const outcomeIndex={H:0,D:1,A:2};

function eceBinary(rs,probKey,labelFn,bins=10){
  const x=rs.filter(r=>finite(r[probKey]));
  if(!x.length)return null;
  let out=0;
  for(let i=0;i<bins;i++){
    const lo=i/bins,hi=(i+1)/bins;
    const b=x.filter(r=>Number(r[probKey])>=lo&&(i===bins-1?Number(r[probKey])<=hi:Number(r[probKey])<hi));
    if(!b.length)continue;
    const conf=mean(b.map(r=>r[probKey])),obs=mean(b.map(labelFn));
    out+=(b.length/x.length)*Math.abs(conf-obs);
  }
  return out;
}
function ece1x2(rs,prefix,bins=10){
  if(!rs.length)return null;let out=0;
  for(let i=0;i<bins;i++){
    const lo=i/bins,hi=(i+1)/bins;
    const b=rs.filter(r=>{
      const ps=[r[prefix+"Home"],r[prefix+"Draw"],r[prefix+"Away"]].map(Number);
      const m=Math.max(...ps);return m>=lo&&(i===bins-1?m<=hi:m<hi);
    });
    if(!b.length)continue;
    const conf=mean(b.map(r=>Math.max(Number(r[prefix+"Home"]),Number(r[prefix+"Draw"]),Number(r[prefix+"Away"]))));
    const acc=mean(b.map(r=>r[prefix+"Pick"]===r.outcome?1:0));
    out+=(b.length/rs.length)*Math.abs(conf-acc);
  }
  return out;
}
function pairedCI(rs,keyV3,keyV2){
  const d=rs.map(r=>Number(r[keyV3])-Number(r[keyV2])).filter(Number.isFinite);
  if(d.length<2)return {n:d.length,delta:mean(d),lo:null,hi:null};
  const m=mean(d),v=sum(d.map(x=>(x-m)**2))/(d.length-1),se=Math.sqrt(v/d.length),z=1.96;
  return {n:d.length,delta:m,lo:m-z*se,hi:m+z*se};
}
function oneX2(rs,prefix){
  const actual={
    H:mean(rs.map(r=>r.outcome==="H"?1:0)),
    D:mean(rs.map(r=>r.outcome==="D"?1:0)),
    A:mean(rs.map(r=>r.outcome==="A"?1:0))
  };
  const predicted={H:mean(rs.map(r=>r[prefix+"Home"])),D:mean(rs.map(r=>r[prefix+"Draw"])),A:mean(rs.map(r=>r[prefix+"Away"]))};
  return{
    n:rs.length,
    accuracy:mean(rs.map(r=>r[prefix+"Pick"]===r.outcome?1:0)),
    brier:mean(rs.map(r=>r[prefix+"Brier"])),
    logLoss:mean(rs.map(r=>r[prefix+"LogLoss"])),
    ece:ece1x2(rs,prefix),
    classBalance:actual,
    meanProbability:predicted,
    probabilityBias:{H:predicted.H-actual.H,D:predicted.D-actual.D,A:predicted.A-actual.A}
  };
}
function goals(rs,prefix){
  const hk=prefix+"HomeGoals",ak=prefix+"AwayGoals";
  return{
    n:rs.length,
    homeGoalMae:mean(rs.map(r=>Math.abs(Number(r[hk])-Number(r.homeScore)))),
    awayGoalMae:mean(rs.map(r=>Math.abs(Number(r[ak])-Number(r.awayScore)))),
    totalGoalMae:mean(rs.map(r=>Math.abs((Number(r[hk])+Number(r[ak]))-(Number(r.homeScore)+Number(r.awayScore))))),
    totalGoalBias:mean(rs.map(r=>(Number(r[hk])+Number(r[ak]))-(Number(r.homeScore)+Number(r.awayScore))))
  };
}
function binary(rs,prefix,kind){
  const pkey=kind==="BTTS"?prefix+"BttsProb":prefix+"O25Prob";
  const label=kind==="BTTS"?(r=>Number(r.homeScore)>0&&Number(r.awayScore)>0?1:0):(r=>Number(r.homeScore)+Number(r.awayScore)>2.5?1:0);
  const x=rs.filter(r=>finite(r[pkey]));
  return{
    n:x.length,
    brier:mean(x.map(r=>(Number(r[pkey])-label(r))**2)),
    ece:eceBinary(x,pkey,label),
    bias:mean(x.map(r=>Number(r[pkey])-label(r))),
    observedRate:mean(x.map(label)),
    meanProbability:mean(x.map(r=>r[pkey]))
  };
}
function asianOutcome(r,line){const z=Number(r.homeScore)-Number(r.awayScore)+line;return z>0?"W":z<0?"L":"P";}
function asian(rs,prefix){
  const byLine={};
  for(const line of CORE_LINES){
    const key=prefix+"AsianCore";
    const x=rs.filter(r=>r[key]?.[String(line)]);
    const scores=x.map(r=>{
      const p=r[key][String(line)],o=asianOutcome(r,line);
      return ((Number(p.win||0)-(o==="W"?1:0))**2+(Number(p.push||0)-(o==="P"?1:0))**2+(Number(p.loss||0)-(o==="L"?1:0))**2)/3;
    });
    let cal=null;
    if(x.length>=50){
      let total=0;
      for(let b=0;b<10;b++){
        const lo=b/10,hi=(b+1)/10;
        const bucket=x.filter(r=>{
          const p=r[key][String(line)],m=Math.max(Number(p.win||0),Number(p.push||0),Number(p.loss||0));
          return m>=lo&&(b===9?m<=hi:m<hi);
        });
        if(!bucket.length)continue;
        const conf=mean(bucket.map(r=>{const p=r[key][String(line)];return Math.max(Number(p.win||0),Number(p.push||0),Number(p.loss||0));}));
        const acc=mean(bucket.map(r=>{const p=r[key][String(line)],o=asianOutcome(r,line);const pick=[["W",Number(p.win||0)],["P",Number(p.push||0)],["L",Number(p.loss||0)]].sort((a,b)=>b[1]-a[1])[0][0];return pick===o?1:0;}));
        total+=(bucket.length/x.length)*Math.abs(conf-acc);
      }
      cal=total;
    }
    byLine[String(line)]={n:x.length,brier:mean(scores),ece:cal};
  }
  return{coreLines:byLine,weightedCoreBrier:mean(Object.values(byLine).flatMap(x=>Number.isFinite(x.brier)?Array(x.n).fill(x.brier):[]))};
}
function bundle(rs,prefix){
  return{oneX2:oneX2(rs,prefix),goals:goals(rs,prefix),btts:binary(rs,prefix,"BTTS"),totals25:binary(rs,prefix,"O25"),asian:asian(rs,prefix)};
}
function deltas(v2,v3){
  return{
    oneX2:{
      accuracy:v3.oneX2.accuracy-v2.oneX2.accuracy,
      brier:v3.oneX2.brier-v2.oneX2.brier,
      logLoss:v3.oneX2.logLoss-v2.oneX2.logLoss,
      ece:v3.oneX2.ece-v2.oneX2.ece
    },
    goals:{
      homeGoalMae:v3.goals.homeGoalMae-v2.goals.homeGoalMae,
      awayGoalMae:v3.goals.awayGoalMae-v2.goals.awayGoalMae,
      totalGoalMae:v3.goals.totalGoalMae-v2.goals.totalGoalMae,
      totalGoalBiasAbs:Math.abs(v3.goals.totalGoalBias)-Math.abs(v2.goals.totalGoalBias)
    },
    btts:{brier:v3.btts.brier-v2.btts.brier,ece:v3.btts.ece-v2.btts.ece,biasAbs:Math.abs(v3.btts.bias)-Math.abs(v2.btts.bias)},
    totals25:{brier:v3.totals25.brier-v2.totals25.brier,ece:v3.totals25.ece-v2.totals25.ece,biasAbs:Math.abs(v3.totals25.bias)-Math.abs(v2.totals25.bias)},
    asian:{weightedCoreBrier:v3.asian.weightedCoreBrier-v2.asian.weightedCoreBrier,
      byLine:Object.fromEntries(CORE_LINES.map(l=>[String(l),{
        brier:(v3.asian.coreLines[String(l)].brier??0)-(v2.asian.coreLines[String(l)].brier??0),
        ece:v3.asian.coreLines[String(l)].ece!=null&&v2.asian.coreLines[String(l)].ece!=null?v3.asian.coreLines[String(l)].ece-v2.asian.coreLines[String(l)].ece:null
      }]))}
  };
}
function seasonKey(r){return String(r.season||String(r.date).slice(0,4));}
function compact(rs){
  if(!rs.length)return null;
  const v2=bundle(rs,"v2"),v3=bundle(rs,"v3");
  return{n:rs.length,v2,v3,deltas:deltas(v2,v3)};
}
function stability(rs){
  const sorted=[...rs].sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const mid=Math.floor(sorted.length/2);
  return{
    bySeason:Object.fromEntries([...new Set(sorted.map(seasonKey))].map(s=>[s,compact(sorted.filter(r=>seasonKey(r)===s))])),
    olderHalf:compact(sorted.slice(0,mid)),
    newerHalf:compact(sorted.slice(mid)),
    latest50:compact(sorted.slice(-50)),
    latest100:compact(sorted.slice(-100)),
    availableDepth:{start:sorted[0]?.date||null,end:sorted.at(-1)?.date||null,n:sorted.length,seasons:[...new Set(sorted.map(seasonKey))]}
  };
}
function classify(rs,v2,v3,d,st){
  if(rs.length<120)return "INSUFFICIENT_EVIDENCE";
  const ciB=pairedCI(rs,"v3Brier","v2Brier"),ciL=pairedCI(rs,"v3LogLoss","v2LogLoss");
  const oneX2Good=d.oneX2.brier<0&&d.oneX2.logLoss<0&&d.oneX2.ece<=0.005;
  const derivativeWins=[d.goals.totalGoalMae<0,d.btts.brier<0,d.totals25.brier<0,d.asian.weightedCoreBrier<0].filter(Boolean).length;
  const recent=st.latest50?.deltas?.oneX2;
  const recentBad=recent&&(recent.brier>0&&recent.logLoss>0);
  if(oneX2Good&&derivativeWins>=2&&!recentBad&&(ciB.hi==null||ciB.hi<=0.003))return "ADVANCED_LAYER_HELPFUL";
  if(d.oneX2.brier>0&&d.oneX2.logLoss>0&&derivativeWins<=1&&(ciB.lo==null||ciB.lo>=-0.003))return "NO_INCREMENTAL_VALUE";
  return "MIXED";
}
function leagueReport(league){
  const rs=rows.filter(r=>r.league===league);
  const v2=bundle(rs,"v2"),v3=bundle(rs,"v3"),d=deltas(v2,v3),st=stability(rs);
  return{
    league,n:rs.length,v2,v3,deltas:d,
    pairedUncertainty:{
      brier:pairedCI(rs,"v3Brier","v2Brier"),
      logLoss:pairedCI(rs,"v3LogLoss","v2LogLoss"),
      totalGoalMae:pairedCI(rs,"v3TotalMae","v2TotalMae"),
      bttsBrier:pairedCI(rs,"v3BttsBrier","v2BttsBrier"),
      o25Brier:pairedCI(rs,"v3O25Brier","v2O25Brier"),
      asianBrier:pairedCI(rs,"v3AsianBrier","v2AsianBrier")
    },
    stability:st,
    classification:classify(rs,v2,v3,d,st)
  };
}

const leagues=Object.fromEntries(PRIORITY.map(l=>[l,leagueReport(l)]));
const weighted=compact(rows.filter(r=>PRIORITY.includes(r.league)));
const leagueValues=Object.values(leagues);
function unweighted(path){
  return mean(leagueValues.map(x=>path(x)).filter(Number.isFinite));
}
const aggregate={
  weighted,
  unweightedLeagueAverage:{
    v2:{oneX2:{accuracy:unweighted(x=>x.v2.oneX2.accuracy),brier:unweighted(x=>x.v2.oneX2.brier),logLoss:unweighted(x=>x.v2.oneX2.logLoss),ece:unweighted(x=>x.v2.oneX2.ece)},
        goals:{totalGoalMae:unweighted(x=>x.v2.goals.totalGoalMae)},btts:{brier:unweighted(x=>x.v2.btts.brier)},totals25:{brier:unweighted(x=>x.v2.totals25.brier)},asian:{weightedCoreBrier:unweighted(x=>x.v2.asian.weightedCoreBrier)}},
    v3:{oneX2:{accuracy:unweighted(x=>x.v3.oneX2.accuracy),brier:unweighted(x=>x.v3.oneX2.brier),logLoss:unweighted(x=>x.v3.oneX2.logLoss),ece:unweighted(x=>x.v3.oneX2.ece)},
        goals:{totalGoalMae:unweighted(x=>x.v3.goals.totalGoalMae)},btts:{brier:unweighted(x=>x.v3.btts.brier)},totals25:{brier:unweighted(x=>x.v3.totals25.brier)},asian:{weightedCoreBrier:unweighted(x=>x.v3.asian.weightedCoreBrier)}}
  },
  classificationCounts:Object.fromEntries(["ADVANCED_LAYER_HELPFUL","MIXED","NO_INCREMENTAL_VALUE","INSUFFICIENT_EVIDENCE"].map(k=>[k,leagueValues.filter(x=>x.classification===k).length])),
  largestLeagueShare:rows.length?Math.max(...leagueValues.map(x=>x.n))/rows.length:null
};
const helpful=aggregate.classificationCounts.ADVANCED_LAYER_HELPFUL,mixed=aggregate.classificationCounts.MIXED,no=aggregate.classificationCounts.NO_INCREMENTAL_VALUE;
const phaseDecision=helpful>=5&&no<=2?"PASS":helpful+mixed>=5&&no<5?"PARTIAL_PASS":"FAIL";

const snapshotId=process.env.SOCCER_VALIDATION_SNAPSHOT||("phase3b-"+new Date().toISOString().replace(/[:.]/g,"-"));
const codeSha=process.env.GITHUB_SHA||"LOCAL";
const report={
  generatedAt:new Date().toISOString(),snapshotId,codeSha,modelVersion:MODEL_VERSION,
  pointInTime:true,marketUsed:false,persistentStateUsed:false,researchOnly:true,canQualify:false,canAuthorize:false,
  leagues,aggregate,phaseDecision,
  marketBenchmark:{status:"SEPARATE_FROZEN_REPLAY",availableHistoricalFamilies:["1X2"],missingHistoricalFamilies:["BTTS","totals","Asian handicap"],policy:"unavailable market history must not be inferred"}
};
fs.mkdirSync("artifacts",{recursive:true});
fs.writeFileSync(OUT,JSON.stringify(report,null,2));

const evidence=[];
for(const [league,x] of Object.entries(leagues)){
  for(const [variant,m] of [["SOCCER-FBIS-v2",x.v2],["SOCCER-FBIS-v3.1",x.v3]]){
    evidence.push({heritageKey:league,modelVariant:variant,benchmarkVariant:variant==="SOCCER-FBIS-v3.1"?"SOCCER-FBIS-v2":null,marketFamily:"1X2",sampleN:x.n,metrics:m.oneX2});
    evidence.push({heritageKey:league,modelVariant:variant,benchmarkVariant:variant==="SOCCER-FBIS-v3.1"?"SOCCER-FBIS-v2":null,marketFamily:"GOALS",sampleN:x.n,metrics:m.goals});
    evidence.push({heritageKey:league,modelVariant:variant,benchmarkVariant:variant==="SOCCER-FBIS-v3.1"?"SOCCER-FBIS-v2":null,marketFamily:"BTTS",sampleN:m.btts.n,metrics:m.btts});
    evidence.push({heritageKey:league,modelVariant:variant,benchmarkVariant:variant==="SOCCER-FBIS-v3.1"?"SOCCER-FBIS-v2":null,marketFamily:"TOTALS",lineKey:"2.5",sampleN:m.totals25.n,metrics:m.totals25});
    for(const line of CORE_LINES)evidence.push({heritageKey:league,modelVariant:variant,benchmarkVariant:variant==="SOCCER-FBIS-v3.1"?"SOCCER-FBIS-v2":null,marketFamily:"ASIAN_HANDICAP",lineKey:String(line),sampleN:m.asian.coreLines[String(line)].n,metrics:m.asian.coreLines[String(line)]});
  }
  evidence.push({heritageKey:league,modelVariant:"SOCCER-FBIS-v3.1",benchmarkVariant:"SOCCER-FBIS-v2",marketFamily:"STABILITY",sampleN:x.n,metrics:{classification:x.classification,deltas:x.deltas,pairedUncertainty:x.pairedUncertainty,stability:x.stability}});
}
fs.writeFileSync(EVIDENCE,JSON.stringify({snapshotId,codeSha,modelVersion:MODEL_VERSION,rows:evidence},null,2));
console.log(JSON.stringify(report,null,2));
