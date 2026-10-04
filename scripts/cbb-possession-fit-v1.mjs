import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";

const dir=process.argv[2]||"artifacts/parts";
const predPath=process.argv[3]||"artifacts/frozen/cbb-fbis-native-v2-predictions.json";
const fitPath=process.argv[4]||"artifacts/frozen/cbb-fbis-v2-fit.json";
const files=readdirSync(dir,{recursive:true}).filter(f=>/cbb-possession-history-20\d\d\.json$/.test(String(f).split("/").pop()));
const packs=files.map(f=>JSON.parse(readFileSync(dir+"/"+f,"utf8")));
const predictions=JSON.parse(readFileSync(predPath,"utf8"));
const frozen=JSON.parse(readFileSync(fitPath,"utf8"));
const predById=new Map(predictions.map(r=>[String(r.id),r]));

const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const round=(v,d=4)=>v==null?null:Number(Number(v).toFixed(d));
const get=(o,p)=>p.split(".").reduce((a,k)=>a==null?null:a[k],o);

function predictFrozen(m,r){
  if(!m)return 0;
  const vals=m.features.map(p=>n(get(r,p))??0);
  let y=m.intercept;
  for(let j=0;j<vals.length;j++)y+=m.beta[j]*(vals[j]-m.means[j])/m.sds[j];
  return y;
}
function base(r,kind){return n(r.fbis?.[kind])+predictFrozen(frozen[kind].model,r)}
function actual(r,kind){return kind==="total"?n(r.actualHome)+n(r.actualAway):n(r.actualHome)-n(r.actualAway)}

const POS_KEYS=[
  "possessions","offensiveRating","defensiveRating","netRating","efgPct","tovPct","ftr","orbPctProxy","threePointRate",
  "earlyEfgPct","middleEfgPct","lateEfgPct","earlyTovPct","middleTovPct","lateTovPct"
];
const LINEUP_KEYS=["topLineupPossessionShare","topLineupNetRating"];

function sideSnapshot(side,g){
  const s=g?.[side]||{};
  const top=s.topFiveLineups?.[0]||null;
  return {
    possessions:n(s.possessions),offensiveRating:n(s.offensiveRating),defensiveRating:n(s.defensiveRating),netRating:n(s.netRating),
    efgPct:n(s.efgPct),tovPct:n(s.tovPct),ftr:n(s.ftr),orbPctProxy:n(s.orbPctProxy),threePointRate:n(s.threePointRate),
    earlyEfgPct:n(s.earlyEfgPct),middleEfgPct:n(s.middleEfgPct),lateEfgPct:n(s.lateEfgPct),
    earlyTovPct:n(s.earlyTovPct),middleTovPct:n(s.middleTovPct),lateTovPct:n(s.lateTovPct),
    topLineupPossessionShare:top&&n(s.possessions)>0?n(top.possessions)/n(s.possessions):null,
    topLineupNetRating:n(top?.netRating),
  };
}
function ewmaUpdate(st,obs,alpha=.28){
  if(!st)st={games:0,values:{}};
  st.games++;
  for(const k of [...POS_KEYS,...LINEUP_KEYS]){
    const x=n(obs[k]);if(x==null)continue;
    const old=n(st.values[k]);st.values[k]=old==null?x:alpha*x+(1-alpha)*old;
  }
  return st;
}
function featurePair(h,a,keys){
  const out={};
  for(const k of keys){
    const x=n(h?.values?.[k]),y=n(a?.values?.[k]);
    out[k+"Diff"]=x==null||y==null?0:x-y;
    out[k+"Sum"]=x==null||y==null?0:x+y;
  }
  return out;
}
function buildSamples(){
  const out=[];
  for(const pack of packs){
    const state=new Map();
    const games=(pack.games||[]).filter(g=>g.ok!==false&&g.gameId).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    for(const g of games){
      const p=predById.get(String(g.gameId));
      if(p){
        const hs=state.get(String(g.homeTeamId))||null,as=state.get(String(g.awayTeamId))||null;
        out.push({
          id:String(g.gameId),season:Number(pack.season),date:g.date,
          actualHome:p.actualHome,actualAway:p.actualAway,fbis:p.fbis,kenpom:p.kenpom,market:p.market,
          homeGames:hs?.games||0,awayGames:as?.games||0,
          lineupReliable:Boolean(g.lineupReliable),
          possessionFeatures:featurePair(hs,as,POS_KEYS),
          lineupFeatures:featurePair(hs,as,LINEUP_KEYS),
          qa:g.qa||{},
        });
      }
      state.set(String(g.homeTeamId),ewmaUpdate(state.get(String(g.homeTeamId)),sideSnapshot("home",g)));
      state.set(String(g.awayTeamId),ewmaUpdate(state.get(String(g.awayTeamId)),sideSnapshot("away",g)));
    }
  }
  return out;
}
const rows=buildSamples();

const FAMILIES={
  possession:POS_KEYS.flatMap(k=>[k+"Diff",k+"Sum"]),
  lineup:LINEUP_KEYS.flatMap(k=>[k+"Diff",k+"Sum"]),
  full:[...POS_KEYS,...LINEUP_KEYS].flatMap(k=>[k+"Diff",k+"Sum"]),
};
function eligible(r,family){
  if((r.homeGames||0)<5||(r.awayGames||0)<5)return false;
  if(family==="lineup"||family==="full"){
    return (n(r.qa?.lineupCoverage)??0)>=.70&&(n(r.qa?.subResolution)??0)>=.70;
  }
  return true;
}
function featureObject(r,family){return family==="possession"?r.possessionFeatures:family==="lineup"?r.lineupFeatures:{...r.possessionFeatures,...r.lineupFeatures};}
function x(r,keys,family){const o=featureObject(r,family);return keys.map(k=>n(o[k])??0)}
function solve(A,b){
  const m=A.map((r,i)=>[...r,b[i]]),N=m.length;
  for(let i=0;i<N;i++){
    let p=i;for(let j=i+1;j<N;j++)if(Math.abs(m[j][i])>Math.abs(m[p][i]))p=j;
    [m[i],m[p]]=[m[p],m[i]];const d=Math.abs(m[i][i])<1e-12?1e-12:m[i][i];
    for(let k=i;k<=N;k++)m[i][k]/=d;
    for(let j=0;j<N;j++){if(j===i)continue;const q=m[j][i];for(let k=i;k<=N;k++)m[j][k]-=q*m[i][k];}
  }
  return m.map(r=>r[N]);
}
function fitRidge(rs,kind,lambda,family){
  const keys=FAMILIES[family],X=rs.map(r=>x(r,keys,family)),y=rs.map(r=>actual(r,kind)-base(r,kind)),p=keys.length;
  const means=Array(p).fill(0),sds=Array(p).fill(1);
  for(let j=0;j<p;j++){
    means[j]=X.reduce((s,a)=>s+a[j],0)/X.length;
    const v=X.reduce((s,a)=>s+(a[j]-means[j])**2,0)/Math.max(1,X.length-1);sds[j]=Math.sqrt(v)||1;
  }
  const ym=y.reduce((s,v)=>s+v,0)/y.length,A=Array.from({length:p},()=>Array(p).fill(0)),b=Array(p).fill(0);
  for(let i=0;i<X.length;i++){
    const z=X[i].map((v,j)=>(v-means[j])/sds[j]),yy=y[i]-ym;
    for(let a=0;a<p;a++){b[a]+=z[a]*yy;for(let q=0;q<p;q++)A[a][q]+=z[a]*z[q];}
  }
  for(let j=0;j<p;j++)A[j][j]+=lambda;
  return{features:keys,means,sds,beta:solve(A,b),intercept:ym,lambda,family};
}
function pred(m,r){
  const X=x(r,m.features,m.family);let y=m.intercept;
  for(let j=0;j<X.length;j++)y+=m.beta[j]*(X[j]-m.means[j])/m.sds[j];
  return y;
}
function chooseLambda(train,kind,family){
  const lambdas=[1,10,100,1000,10000],seasons=[2018,2019,2020,2021,2022];let best=null;
  for(const lambda of lambdas){
    let se=0,c=0;
    for(const s of seasons){
      const tr=train.filter(r=>r.season!==s),te=train.filter(r=>r.season===s);
      if(!tr.length||!te.length)continue;
      const m=fitRidge(tr,kind,lambda,family);
      for(const r of te){const e=(actual(r,kind)-base(r,kind))-pred(m,r);se+=e*e;c++;}
    }
    const rmse=Math.sqrt(se/Math.max(1,c));if(!best||rmse<best.rmse)best={lambda,rmse};
  }
  return best;
}
function metrics(rs,kind,m,family){
  let c=0,b=0,p=0,adjusted=0;
  for(const r of rs){
    const a=actual(r,kind),bb=base(r,kind);if(a==null||bb==null)continue;
    let pp=bb;if(m&&eligible(r,family)){pp=bb+pred(m,r);adjusted++;}
    c++;b+=Math.abs(bb-a);p+=Math.abs(pp-a);
  }
  return c?{n:c,adjusted,baseMae:round(b/c),challengerMae:round(p/c),gain:round((b-p)/c)}:{n:0};
}

const report={
  ok:true,id:"CBB-POSSESSION-v1-WALKFORWARD",generatedAt:new Date().toISOString(),rows:rows.length,
  methodology:{
    featureTiming:"Each target game uses only exponentially weighted prior completed games for each team.",
    discovery:"2018-22",validation:"2023-24",confirmation:"2025",
    marketInformed:false,
    lineupGate:"lineup/full families require target-game reconstruction QA >=70% lineup coverage and substitution resolution; features themselves remain prior-only.",
  },
  families:{},
  promotion:{requiresOperatorApproval:true,automaticProduction:false},
};
for(const family of Object.keys(FAMILIES)){
  report.families[family]={};
  const discovery=rows.filter(r=>r.season<=2022&&eligible(r,family));
  const validation=rows.filter(r=>[2023,2024].includes(r.season));
  const confirmation=rows.filter(r=>r.season===2025);
  for(const kind of ["margin","total"]){
    if(discovery.length<100){report.families[family][kind]={promote:false,reason:"insufficient-discovery",n:discovery.length};continue;}
    const sel=chooseLambda(discovery,kind,family),m=fitRidge(discovery,kind,sel.lambda,family);
    const val=metrics(validation,kind,m,family),con=metrics(confirmation,kind,m,family);
    report.families[family][kind]={
      lambdaSelection:sel,
      model:{features:m.features,means:m.means.map(v=>round(v,8)),sds:m.sds.map(v=>round(v,8)),beta:m.beta.map(v=>round(v,8)),intercept:round(m.intercept,8),lambda:m.lambda,family},
      discovery:metrics(rows.filter(r=>r.season<=2022),kind,m,family),validation:val,confirmation:con,
      promote:Boolean(val.gain>0&&con.gain>0),
    };
  }
}
report.recommendation={
  margin:Object.entries(report.families).filter(([,v])=>v.margin?.promote).sort((a,b)=>(b[1].margin.validation.gain+b[1].margin.confirmation.gain)-(a[1].margin.validation.gain+a[1].margin.confirmation.gain))[0]?.[0]||null,
  total:Object.entries(report.families).filter(([,v])=>v.total?.promote).sort((a,b)=>(b[1].total.validation.gain+b[1].total.confirmation.gain)-(a[1].total.validation.gain+a[1].total.confirmation.gain))[0]?.[0]||null,
};
mkdirSync("artifacts",{recursive:true});
writeFileSync("artifacts/cbb-possession-v1-fit.json",JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
