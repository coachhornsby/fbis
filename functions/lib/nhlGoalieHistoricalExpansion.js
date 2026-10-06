import { NHL_GOALIE_PROB_SHADOW_CONFIG as CONFIG } from "../../data/models/nhl-goalie-prob-shadow-v1.js";

export const HISTORICAL_EXPANSION_MODEL_ID="NHL-GOALIE-PROB-HISTORICAL-EXPANSION-v1";
export const LOCKED_GOALIE_SCALE=CONFIG.goalieProbabilityScale;

function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function round(v,n=6){return Number(Number(v).toFixed(n));}
function mean(xs){const v=xs.filter(Number.isFinite);return v.length?v.reduce((s,x)=>s+x,0)/v.length:null;}
function poisson(lambda,k){let p=Math.exp(-lambda);for(let i=1;i<=k;i++)p*=lambda/i;return p;}
function scoreHomeWin(h,a){
  const shared=Math.min(0.32,0.10*Math.min(h,a)),lh=Math.max(0.05,h-shared),la=Math.max(0.05,a-shared);
  let hw=0,tie=0,total=0;
  for(let x=0;x<=11;x++)for(let y=0;y<=11;y++)for(let z=0;z<=5;z++){
    const p=poisson(lh,x)*poisson(la,y)*poisson(shared,z),hg=x+z,ag=y+z;total+=p;
    if(hg>ag)hw+=p;else if(hg===ag)tie+=p;
  }
  if(total>0){hw/=total;tie/=total;}
  return clamp(hw+tie/(1+Math.exp(-(h-a)/0.65)),0.01,0.99);
}
function eloHead(eloDiff){
  const d=finite(eloDiff);
  return d==null?null:1/(1+10**(-((d+35)/400)));
}

export function historicalShadowPrediction(row){
  if(LOCKED_GOALIE_SCALE!==0.25)throw new Error("GOALIE_SCALE_NOT_LOCKED_025");
  const projHome=finite(row?.projHome),projAway=finite(row?.projAway);
  const incumbentP=finite(row?.homeWinProb),vsHome=finite(row?.goalieVsHome),vsAway=finite(row?.goalieVsAway),elo=eloHead(row?.eloDiff);
  if([projHome,projAway,incumbentP,vsHome,vsAway,elo].some(v=>v==null))return{ok:false,reason:"REQUIRED_PIT_INPUT_MISSING"};
  const probabilityHomeMean=projHome-vsHome+LOCKED_GOALIE_SCALE*vsHome;
  const probabilityAwayMean=projAway-vsAway+LOCKED_GOALIE_SCALE*vsAway;
  const raw=scoreHomeWin(probabilityHomeMean,probabilityAwayMean);
  const shadowP=clamp(0.5+0.86*((0.78*raw+0.22*elo)-0.5),0.04,0.96);
  return{
    ok:true,
    projHome,projAway,
    incumbentP,
    shadowP:round(shadowP,8),
    probabilityDelta:round(shadowP-incumbentP,8),
    probabilityHomeMean:round(probabilityHomeMean,6),
    probabilityAwayMean:round(probabilityAwayMean,6),
    goalieSignal:round(Math.max(Math.abs(vsHome),Math.abs(vsAway)),6),
    gateAnalog:Math.max(Math.abs(vsHome),Math.abs(vsAway))>=0.03,
    scoreProjectionChanged:false
  };
}

export function predictiveMetrics(rows,key){
  if(!rows.length)return{n:0};
  let brier=0,ll=0,correct=0,homeMae=0,awayMae=0,totalMae=0,marginMae=0;
  const probs=[];
  for(const r of rows){
    const p=clamp(Number(r[key]),1e-6,1-1e-6),y=r.actualHomeGoals>r.actualAwayGoals?1:0;
    brier+=(p-y)**2;ll+=-(y*Math.log(p)+(1-y)*Math.log(1-p));correct+=(p>=0.5)===Boolean(y)?1:0;
    homeMae+=Math.abs(r.projHome-r.actualHomeGoals);awayMae+=Math.abs(r.projAway-r.actualAwayGoals);
    totalMae+=Math.abs((r.projHome+r.projAway)-(r.actualHomeGoals+r.actualAwayGoals));
    marginMae+=Math.abs((r.projHome-r.projAway)-(r.actualHomeGoals-r.actualAwayGoals));
    probs.push({p,y});
  }
  const bins=Array.from({length:10},()=>[]);
  for(const x of probs)bins[Math.min(9,Math.floor(x.p*10))].push(x);
  let ece=0;
  for(const b of bins)if(b.length){
    const pp=mean(b.map(x=>x.p)),yy=mean(b.map(x=>x.y));
    ece+=b.length/rows.length*Math.abs(pp-yy);
  }
  return{
    n:rows.length,brier:round(brier/rows.length),logLoss:round(ll/rows.length),
    accuracy:round(correct/rows.length),ece:round(ece),
    homeGoalsMae:round(homeMae/rows.length),awayGoalsMae:round(awayMae/rows.length),
    totalMae:round(totalMae/rows.length),marginMae:round(marginMae/rows.length)
  };
}

export function pairedDeltas(rows){
  const brier=[],logLoss=[],correct=[];
  for(const r of rows){
    const y=r.actualHomeGoals>r.actualAwayGoals?1:0,pi=clamp(r.incumbentP,1e-6,1-1e-6),ps=clamp(r.shadowP,1e-6,1-1e-6);
    brier.push((ps-y)**2-(pi-y)**2);
    logLoss.push(-(y*Math.log(ps)+(1-y)*Math.log(1-ps))+(y*Math.log(pi)+(1-y)*Math.log(1-pi)));
    correct.push(Number((ps>=0.5)===Boolean(y))-Number((pi>=0.5)===Boolean(y)));
  }
  return{brier,logLoss,accuracy:correct};
}

function sd(xs){
  if(xs.length<2)return 0;
  const m=mean(xs);return Math.sqrt(xs.reduce((s,x)=>s+(x-m)**2,0)/(xs.length-1));
}
function median(xs){
  if(!xs.length)return null;const a=[...xs].sort((a,b)=>a-b),m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function rng(seed=23051987){
  let x=seed>>>0;return()=>{x=(1664525*x+1013904223)>>>0;return x/4294967296;};
}
export function bootstrapMeanCI(xs,reps=1200,seed=23051987){
  if(!xs.length)return{mean:null,median:null,se:null,ci95:[null,null]};
  const r=rng(seed),means=[];
  for(let b=0;b<reps;b++){let s=0;for(let i=0;i<xs.length;i++)s+=xs[Math.floor(r()*xs.length)];means.push(s/xs.length);}
  means.sort((a,b)=>a-b);
  return{
    mean:round(mean(xs),8),median:round(median(xs),8),se:round(sd(xs)/Math.sqrt(xs.length),8),
    ci95:[round(means[Math.floor(0.025*(means.length-1))],8),round(means[Math.floor(0.975*(means.length-1))],8)]
  };
}
export function pairedSummary(rows){
  const d=pairedDeltas(rows);
  return{
    brier:{...bootstrapMeanCI(d.brier),improvedShare:round(d.brier.filter(x=>x<0).length/Math.max(1,d.brier.length)),worsenedShare:round(d.brier.filter(x=>x>0).length/Math.max(1,d.brier.length))},
    logLoss:bootstrapMeanCI(d.logLoss),
    accuracy:bootstrapMeanCI(d.accuracy)
  };
}

function solve2(a,b,c,d,e,f){
  const det=a*d-b*c;if(Math.abs(det)<1e-12)return[0,1];
  return[(e*d-b*f)/det,(a*f-e*c)/det];
}
export function calibrationFit(rows,key){
  if(rows.length<20)return{n:rows.length,intercept:null,slope:null};
  let a=0,b=0,c=0,e=0,f=0,intercept=0,slope=1;
  for(let iter=0;iter<30;iter++){
    a=b=c=e=f=0;
    for(const r of rows){
      const p=clamp(Number(r[key]),1e-6,1-1e-6),x=Math.log(p/(1-p)),y=r.actualHomeGoals>r.actualAwayGoals?1:0;
      const q=1/(1+Math.exp(-(intercept+slope*x))),w=Math.max(1e-6,q*(1-q)),z=(y-q);
      a+=w;b+=w*x;c+=w*x*x;e+=z;f+=z*x;
    }
    const [di,ds]=solve2(a,b,b,c,e,f);intercept+=di;slope+=ds;
    if(Math.abs(di)+Math.abs(ds)<1e-9)break;
  }
  return{n:rows.length,intercept:round(intercept),slope:round(slope)};
}
export function reliability(rows,key,bins=10){
  const out=[];
  for(let i=0;i<bins;i++){
    const lo=i/bins,hi=(i+1)/bins,x=rows.filter(r=>r[key]>=lo&&(i===bins-1?r[key]<=hi:r[key]<hi));
    if(!x.length)continue;
    out.push({bin:`${lo.toFixed(1)}-${hi.toFixed(1)}`,n:x.length,predicted:round(mean(x.map(r=>r[key]))),actual:round(mean(x.map(r=>r.actualHomeGoals>r.actualAwayGoals?1:0))),gap:round(mean(x.map(r=>r[key]))-mean(x.map(r=>r.actualHomeGoals>r.actualAwayGoals?1:0)))});
  }
  return out;
}
export function requiredSampleForMeanEffect(xs,{alphaZ=1.96,powerZ=0.84}={}){
  const mu=Math.abs(mean(xs)||0),sigma=sd(xs);
  if(mu<1e-9)return null;
  return Math.ceil(((alphaZ+powerZ)*sigma/mu)**2);
}
export function grouped(rows,keyFn,minN=20){
  const m=new Map();
  for(const r of rows){const k=String(keyFn(r)??"UNKNOWN");if(!m.has(k))m.set(k,[]);m.get(k).push(r);}
  return Object.fromEntries([...m.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([k,v])=>[k,{
    n:v.length,
    incumbent:predictiveMetrics(v,"incumbentP"),
    shadow:predictiveMetrics(v,"shadowP"),
    paired:pairedSummary(v),
    status:v.length>=minN?"REPORTABLE":"SMALL_SAMPLE"
  }]));
}
