import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.FBIS_BASE || "https://fbis-myz.pages.dev";
const SECRET = process.env.HARVEST_SECRET || "";
const sourcePath = process.argv[2] || "artifacts/cbb-data-stack-predictions.json";
if (!SECRET) throw new Error("HARVEST_SECRET required");

const rows0 = JSON.parse(readFileSync(sourcePath,"utf8"));
const num = v => { if(v==null||v==="") return null; const n=Number(v); return Number.isFinite(n)?n:null; };
const round = (v,d=3) => v==null?null:Number(Number(v).toFixed(d));
const mean = a => a.length ? a.reduce((s,x)=>s+x,0)/a.length : null;
const abs = Math.abs;

async function source(kind, params={}) {
  const u = new URL("/api/cbb-walkforward-source", BASE);
  u.searchParams.set("kind",kind);
  for (const [k,v] of Object.entries(params)) if(v!=null) u.searchParams.set(k,String(v));
  const res=await fetch(u,{headers:{"x-harvest-secret":SECRET,accept:"application/json"}});
  const body=await res.json().catch(()=>null);
  if(!res.ok||!body?.ok) throw new Error(`${kind} failed HTTP ${res.status}: ${body?.error||"unknown"}`);
  return body;
}

const providerPriority=["pinnacle","circa","draftkings","fanduel","betmgm","caesars","betonline","consensus"];
function providerRank(v){
  const s=String(v||"").toLowerCase();
  const i=providerPriority.findIndex(x=>s.includes(x));
  return i<0?999:i;
}
function median(values){
  const a=values.map(num).filter(v=>v!=null).sort((x,y)=>x-y);
  if(!a.length)return null;
  const m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function chooseMarket(lines){
  const explicit=lines.find(x=>String(x.provider||"").toLowerCase()==="consensus");
  if(explicit) return {...explicit, marketConstruction:"explicit-consensus", sourceBooks:lines.length};
  const spread=median(lines.map(x=>x.spread));
  const openingSpread=median(lines.map(x=>x.openingSpread));
  const overUnder=median(lines.map(x=>x.overUnder));
  const openingOverUnder=median(lines.map(x=>x.openingOverUnder));
  if(spread==null&&overUnder==null&&openingSpread==null&&openingOverUnder==null)return null;
  return {
    ...lines[0],
    provider:"MEDIAN CONSENSUS",
    spread,openingSpread,overUnder,openingOverUnder,
    homeSpreadPrice:null,awaySpreadPrice:null,overPrice:null,underPrice:null,
    marketConstruction:"median-across-books",
    sourceBooks:lines.length,
  };
}
function americanProfit(odds){
  const o=num(odds);
  if(o==null||o===0) return 100/110;
  return o<0?100/abs(o):o/100;
}
function betResult(predSign, actualResidual, price){
  if(predSign===0||actualResidual===0) return {result:"push",units:0};
  const won=Math.sign(predSign)===Math.sign(actualResidual);
  return won?{result:"win",units:americanProfit(price)}:{result:"loss",units:-1};
}
function summarizeBets(bets){
  const s={n:0,w:0,l:0,p:0,units:0,priced:0,assumed:0};
  for(const b of bets){
    s.n++; s.units+=b.units;
    if(b.result==="win")s.w++; else if(b.result==="loss")s.l++; else s.p++;
    if(b.price==null)s.assumed++; else s.priced++;
  }
  const decisions=s.w+s.l;
  return {...s,winPct:decisions?round(100*s.w/decisions,2):null,roi:s.n?round(100*s.units/s.n,2):null,assumedPricePct:s.n?round(100*s.assumed/s.n,1):null};
}
function key(v){return String(v||"").toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g," ").trim();}
function avgLast(arr,n=5){const a=(arr||[]).slice(-n);return a.length?mean(a):0;}
function pushTrim(map,k,v,max=12){if(!map.has(k))map.set(k,[]);const a=map.get(k);a.push(v);while(a.length>max)a.shift();}

const seasons=[...new Set(rows0.map(r=>Number(r.season)).filter(Number.isFinite))].sort((a,b)=>a-b);

function lineWindows(season) {
  const months=[[season,11],[season,12],[season+1,1],[season+1,2],[season+1,3],[season+1,4]];
  return months.map(([y,m])=>{
    const start=`${y}-${String(m).padStart(2,"0")}-01T00:00:00Z`;
    const nextM=m===12?1:m+1, nextY=m===12?y+1:y;
    const end=new Date(Date.UTC(nextY,nextM-1,1)-1).toISOString();
    return {start,end};
  });
}

const linesByGame=new Map();
const providerCounts={};
const coverage=[];
for(const season of seasons){
  let lineRows=0;
  const grouped=new Map();
  const windowCoverage=[];
  for(const w of lineWindows(season)){
    const res=await source("lines",{season,start:w.start,end:w.end});
    lineRows+=Number(res.n||0);
    windowCoverage.push({start:w.start,end:w.end,lineRows:Number(res.n||0)});
    for(const line of res.rows||[]){
      const id=String(line.gameId||"");
      if(!id)continue;
      if(!grouped.has(id))grouped.set(id,[]);
      const signature=[line.provider,line.spread,line.overUnder,line.openingSpread,line.openingOverUnder].join("|");
      if(!grouped.get(id).some(x=>[x.provider,x.spread,x.overUnder,x.openingSpread,x.openingOverUnder].join("|")===signature)) grouped.get(id).push(line);
    }
  }
  let selected=0;
  for(const [id,ls] of grouped){
    const m=chooseMarket(ls);
    if(!m)continue;
    linesByGame.set(id,m);
    selected++;
    const p=m.provider||"unknown";
    providerCounts[p]=(providerCounts[p]||0)+1;
  }
  coverage.push({season,lineRows,gamesWithMarket:selected,windowCoverage});
}

const joined=rows0.map(r=>{
  const m=linesByGame.get(String(r.id));
  if(!m)return null;
  const actualMargin=num(r.actualHome)-num(r.actualAway);
  const actualTotal=num(r.actualHome)+num(r.actualAway);
  const spread=num(m.spread), total=num(m.overUnder);
  return {
    ...r, market:m,
    actualMargin,actualTotal,
    marketHomeMargin:spread==null?null:-spread,
    sideResidual:spread==null?null:actualMargin+spread,
    totalResidual:total==null?null:actualTotal-total,
    spreadMove:spread!=null&&num(m.openingSpread)!=null?spread-num(m.openingSpread):null,
    totalMove:total!=null&&num(m.openingOverUnder)!=null?total-num(m.openingOverUnder):null,
  };
}).filter(Boolean).sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.id).localeCompare(String(b.id)));

let orientN=0,orientOk=0;
for(const r of joined){
  const s=num(r.market.spread), hm=num(r.market.homeMoneyline), am=num(r.market.awayMoneyline);
  if(s==null||hm==null||am==null||s===0)continue;
  orientN++;
  if((s<0&&hm<am)||(s>0&&hm>am))orientOk++;
}
const orientationConsistency=orientN?orientOk/orientN:null;
if(orientationConsistency!=null&&orientationConsistency<0.65) throw new Error(`market-spread-orientation-check-failed:${orientationConsistency}`);

const teamMarginResidual=new Map(),teamTotalResidual=new Map(),teamAtsResidual=new Map(),teamOuResidual=new Map();
for(const r of joined){
  const hk=key(r.home),ak=key(r.away);
  r.roll={
    homeKpMarginL5:avgLast(teamMarginResidual.get(hk),5),
    awayKpMarginL5:avgLast(teamMarginResidual.get(ak),5),
    homeTotalL5:avgLast(teamTotalResidual.get(hk),5),
    awayTotalL5:avgLast(teamTotalResidual.get(ak),5),
    homeAtsL5:avgLast(teamAtsResidual.get(hk),5),
    awayAtsL5:avgLast(teamAtsResidual.get(ak),5),
    homeOuL5:avgLast(teamOuResidual.get(hk),5),
    awayOuL5:avgLast(teamOuResidual.get(ak),5),
  };
  const kpMargin=r.kenpom?.margin;
  const kpTotal=r.kenpom?.total;
  if(kpMargin!=null){
    const e=r.actualMargin-kpMargin;
    pushTrim(teamMarginResidual,hk,e); pushTrim(teamMarginResidual,ak,-e);
  }
  if(kpTotal!=null){
    const e=r.actualTotal-kpTotal;
    pushTrim(teamTotalResidual,hk,e); pushTrim(teamTotalResidual,ak,e);
  }
  if(r.sideResidual!=null){
    pushTrim(teamAtsResidual,hk,r.sideResidual); pushTrim(teamAtsResidual,ak,-r.sideResidual);
  }
  if(r.totalResidual!=null){
    pushTrim(teamOuResidual,hk,r.totalResidual); pushTrim(teamOuResidual,ak,r.totalResidual);
  }
}

function signedEdge(p,market,kind){
  if(!p)return null;
  return kind==="side"?(num(p.margin)!=null&&num(market.spread)!=null?num(p.margin)+num(market.spread):null):(num(p.total)!=null&&num(market.overUnder)!=null?num(p.total)-num(market.overUnder):null);
}
function featureObject(r){
  return {
    kpSide:signedEdge(r.kenpom,r.market,"side"),
    cbbdSide:signedEdge(r.cbbd,r.market,"side"),
    torvikSide:signedEdge(r.torvik,r.market,"side"),
    fullSide:signedEdge(r.fullStack,r.market,"side"),
    kpTotal:signedEdge(r.kenpom,r.market,"total"),
    cbbdTotal:signedEdge(r.cbbd,r.market,"total"),
    torvikTotal:signedEdge(r.torvik,r.market,"total"),
    fullTotal:signedEdge(r.fullStack,r.market,"total"),
    sideDisagree:r.kenpom&&r.cbbd?num(r.kenpom.margin)-num(r.cbbd.margin):null,
    totalDisagree:r.kenpom&&r.cbbd?num(r.kenpom.total)-num(r.cbbd.total):null,
    spread:num(r.market.spread),
    totalLine:num(r.market.overUnder),
    spreadMove:r.spreadMove,
    totalMove:r.totalMove,
    neutral:r.neutral?1:0,
    homeKpMarginL5:r.roll.homeKpMarginL5,
    awayKpMarginL5:r.roll.awayKpMarginL5,
    homeTotalL5:r.roll.homeTotalL5,
    awayTotalL5:r.roll.awayTotalL5,
    homeAtsL5:r.roll.homeAtsL5,
    awayAtsL5:r.roll.awayAtsL5,
    homeOuL5:r.roll.homeOuL5,
    awayOuL5:r.roll.awayOuL5,
  };
}
for(const r of joined)r.features=featureObject(r);

const featureFamilies={
  rating:["kpSide","cbbdSide","torvikSide","fullSide"],
  ratingDisagreement:["kpSide","cbbdSide","torvikSide","fullSide","sideDisagree"],
  ratingMarket:["kpSide","cbbdSide","torvikSide","fullSide","sideDisagree","spread","spreadMove","neutral"],
  ratingMarketForm:["kpSide","cbbdSide","torvikSide","fullSide","sideDisagree","spread","spreadMove","neutral","homeKpMarginL5","awayKpMarginL5","homeAtsL5","awayAtsL5"],
};
const totalFeatureFamilies={
  rating:["kpTotal","cbbdTotal","torvikTotal","fullTotal"],
  ratingDisagreement:["kpTotal","cbbdTotal","torvikTotal","fullTotal","totalDisagree"],
  ratingMarket:["kpTotal","cbbdTotal","torvikTotal","fullTotal","totalDisagree","totalLine","totalMove","neutral"],
  ratingMarketForm:["kpTotal","cbbdTotal","torvikTotal","fullTotal","totalDisagree","totalLine","totalMove","neutral","homeTotalL5","awayTotalL5","homeOuL5","awayOuL5"],
};

function solve(A,b){
  const n=b.length,M=A.map((r,i)=>[...r,b[i]]);
  for(let i=0;i<n;i++){
    let p=i;for(let j=i+1;j<n;j++)if(abs(M[j][i])>abs(M[p][i]))p=j;
    [M[i],M[p]]=[M[p],M[i]];
    if(abs(M[i][i])<1e-10)continue;
    const d=M[i][i];for(let k=i;k<=n;k++)M[i][k]/=d;
    for(let j=0;j<n;j++)if(j!==i){const f=M[j][i];for(let k=i;k<=n;k++)M[j][k]-=f*M[i][k];}
  }
  return M.map(r=>r[n]);
}
function fitRidge(rows,names,target,lambda){
  const stats=names.map(n=>{
    const vals=rows.map(r=>num(r.features[n])).filter(v=>v!=null);
    const mu=vals.length?mean(vals):0; const sd=vals.length?Math.sqrt(mean(vals.map(v=>(v-mu)**2))):1;
    return {name:n,mu,sd:sd||1};
  });
  const p=stats.length+1, XtX=Array.from({length:p},()=>Array(p).fill(0)), Xty=Array(p).fill(0);
  let n=0;
  for(const r of rows){
    const y=num(r[target]);if(y==null)continue;
    const x=[1,...stats.map(s=>{const v=num(r.features[s.name]);return v==null?0:(v-s.mu)/s.sd;})];
    n++;
    for(let i=0;i<p;i++){Xty[i]+=x[i]*y;for(let j=0;j<p;j++)XtX[i][j]+=x[i]*x[j];}
  }
  for(let i=1;i<p;i++)XtX[i][i]+=lambda;
  const beta=solve(XtX,Xty);
  return {stats,beta,n,lambda,names};
}
function predict(model,r){
  let y=model.beta[0]||0;
  model.stats.forEach((s,i)=>{const v=num(r.features[s.name]);y+=(model.beta[i+1]||0)*(v==null?0:(v-s.mu)/s.sd);});
  return y;
}
function priceFor(r,kind,sign){
  if(kind==="side")return sign>0?num(r.market.homeSpreadPrice):num(r.market.awaySpreadPrice);
  return sign>0?num(r.market.overPrice):num(r.market.underPrice);
}
function evalModel(model,rows,kind,threshold){
  const target=kind==="side"?"sideResidual":"totalResidual",bets=[];
  for(const r of rows){
    if(num(r[target])==null)continue;
    const pred=predict(model,r);
    if(abs(pred)<threshold)continue;
    const sign=Math.sign(pred); const price=priceFor(r,kind,sign);
    bets.push({...betResult(sign,r[target],price),price,pred,actual:r[target],id:r.id,season:r.season});
  }
  return summarizeBets(bets);
}
const lambdas=[0.1,1,10,100],thresholds=[0,0.5,1,1.5,2,3,4,5];
function selectSpec(train,val,kind,families){
  let best=null;
  for(const [family,names] of Object.entries(families)){
    for(const lambda of lambdas){
      const target=kind==="side"?"sideResidual":"totalResidual";
      const m=fitRidge(train,names,target,lambda);
      if(m.n<500)continue;
      for(const threshold of thresholds){
        const ev=evalModel(m,val,kind,threshold);
        if(ev.n<100)continue;
        const score=ev.units-0.002*ev.n;
        if(!best||score>best.score)best={family,names,lambda,threshold,validation:ev,score};
      }
    }
  }
  return best;
}
function refitAndTest(dev,test,kind,spec){
  if(!spec)return null;
  const target=kind==="side"?"sideResidual":"totalResidual";
  const m=fitRidge(dev,spec.names,target,spec.lambda);
  return {spec:{family:spec.family,lambda:spec.lambda,threshold:spec.threshold},validation:spec.validation,test:evalModel(m,test,kind,spec.threshold),coefficients:Object.fromEntries(["intercept",...spec.names].map((n,i)=>[n,round(m.beta[i],4)]))};
}

function directStrategy(rows,kind,modelKey,threshold=0,band=null){
  const bets=[];
  for(const r of rows){
    const edge=signedEdge(r[modelKey],r.market,kind);
    const actual=kind==="side"?r.sideResidual:r.totalResidual;
    if(edge==null||actual==null||abs(edge)<threshold)continue;
    if(band&&kind==="total"){
      const line=num(r.market.overUnder);if(line==null||line<band[0]||line>band[1])continue;
    }
    const sign=Math.sign(edge),price=priceFor(r,kind,sign);
    bets.push({...betResult(sign,actual,price),price});
  }
  return summarizeBets(bets);
}
function frozenHypothesis(rows, name) {
  const bets=[];
  for (const r of rows) {
    const kpSide=signedEdge(r.kenpom,r.market,"side");
    const sideActual=r.sideResidual;
    const spread=num(r.market.spread);
    if (name==="kenpom-dog-gap6-spread-under20") {
      if (kpSide==null||sideActual==null||spread==null||Math.abs(kpSide)<6||Math.abs(spread)>=20) continue;
      const selectedHome=kpSide>0;
      const selectedDog=(selectedHome&&spread>0)||(!selectedHome&&spread<0);
      if(!selectedDog) continue;
      const sign=Math.sign(kpSide),price=priceFor(r,"side",sign);
      bets.push({...betResult(sign,sideActual,price),price,season:r.season,provider:r.market.provider||"unknown"});
    } else if (name==="kenpom-total-gap4-market120-135") {
      const kpTotal=signedEdge(r.kenpom,r.market,"total");
      const totalActual=r.totalResidual;
      const totalLine=num(r.market.overUnder);
      if(kpTotal==null||totalActual==null||totalLine==null||Math.abs(kpTotal)<4||totalLine<120||totalLine>135)continue;
      const sign=Math.sign(kpTotal),price=priceFor(r,"total",sign);
      bets.push({...betResult(sign,totalActual,price),price,season:r.season,provider:r.market.provider||"unknown"});
    }
  }
  const bySeason={};
  for(const season of [...new Set(bets.map(b=>Number(b.season)))].sort((a,b)=>a-b)) bySeason[season]=summarizeBets(bets.filter(b=>Number(b.season)===season));
  const byProvider={};
  for(const provider of [...new Set(bets.map(b=>b.provider))].sort()) byProvider[provider]=summarizeBets(bets.filter(b=>b.provider===provider));
  return {name,overall:summarizeBets(bets),bySeason,byProvider};
}

function selectiveDisagreementV1(rows){
  const bets=[];
  for(const r of rows){
    const kp=signedEdge(r.kenpom,r.market,"side");
    const cb=signedEdge(r.cbbd,r.market,"side");
    const spread=num(r.market.spread);
    if(kp==null||cb==null||spread==null||r.sideResidual==null) continue;
    if(abs(kp)<4||abs(spread)>=20||Math.sign(kp)!==Math.sign(cb)) continue;
    const sign=Math.sign(kp),price=priceFor(r,"side",sign);
    bets.push({...betResult(sign,r.sideResidual,price),price,season:r.season,edge:kp,cbbdEdge:cb,spread});
  }
  const bySeason={};
  for(const season of seasons) bySeason[season]=summarizeBets(bets.filter(b=>Number(b.season)===Number(season)));
  const confirm=bets.filter(b=>Number(b.season)>=2023);
  const finalHoldout=bets.filter(b=>Number(b.season)===2025);
  return {
    id:"CBB-SELECTIVE-DISAGREEMENT-v1",
    frozenRule:"KenPom side edge >=4; CBBD rolling independent projection agrees on side; abs(market spread) <20",
    discoverySeasons:[2021,2022],
    confirmationSeasons:[2023,2024],
    finalUntouchedSeason:2025,
    overall:summarizeBets(bets),
    bySeason,
    confirmation:summarizeBets(confirm),
    finalHoldout:summarizeBets(finalHoldout),
    governance:{researchOnly:true,canQualify:false,wagerAuthorization:false,noFurtherTuningOn2025:true},
  };
}

function candidateRules(rows,kind){
  const models=["kenpom","cbbd","fullStack"];
  const out=[];
  for(const model of models){
    for(const t of [1,2,3,4,5,6,7.5,10]){
      out.push({model,threshold:t,band:null,metrics:directStrategy(rows,kind,model,t)});
      if(kind==="total")for(const band of [[120,135],[135,145],[145,155],[155,170]])out.push({model,threshold:t,band,metrics:directStrategy(rows,kind,model,t,band)});
    }
  }
  return out.filter(x=>x.metrics.n>=50).sort((a,b)=>b.metrics.units-a.metrics.units);
}

const bySeason=Object.fromEntries(seasons.map(s=>[s,joined.filter(r=>Number(r.season)===s)]));
const folds=[];
for(let i=2;i<seasons.length;i++){
  const testSeason=seasons[i],devSeasons=seasons.slice(0,i),valSeason=devSeasons.at(-1),trainSeasons=devSeasons.slice(0,-1);
  const train=trainSeasons.flatMap(s=>bySeason[s]||[]),val=bySeason[valSeason]||[],dev=devSeasons.flatMap(s=>bySeason[s]||[]),test=bySeason[testSeason]||[];
  if(train.length<500||val.length<200||test.length<200)continue;
  const sideSpec=selectSpec(train,val,"side",featureFamilies);
  const totalSpec=selectSpec(train,val,"total",totalFeatureFamilies);
  folds.push({
    testSeason,trainSeasons,valSeason,
    sizes:{train:train.length,val:val.length,test:test.length},
    side:refitAndTest(dev,test,"side",sideSpec),
    total:refitAndTest(dev,test,"total",totalSpec),
    direct:{
      side:{
        kenpom:directStrategy(test,"side","kenpom",0),
        cbbd:directStrategy(test,"side","cbbd",0),
        fullStack:directStrategy(test,"side","fullStack",0),
      },
      total:{
        kenpom:directStrategy(test,"total","kenpom",0),
        cbbd:directStrategy(test,"total","cbbd",0),
        fullStack:directStrategy(test,"total","fullStack",0),
      },
    },
  });
}
function aggregateFold(kind){
  const vals=folds.map(f=>f[kind]?.test).filter(Boolean);
  const out={n:0,w:0,l:0,p:0,units:0,priced:0,assumed:0};
  for(const v of vals)for(const k of ["n","w","l","p","units","priced","assumed"])out[k]+=Number(v[k]||0);
  const decisions=out.w+out.l;
  return {...out,units:round(out.units,3),winPct:decisions?round(100*out.w/decisions,2):null,roi:out.n?round(100*out.units/out.n,2):null,assumedPricePct:out.n?round(100*out.assumed/out.n,1):null};
}

const report={
  ok:true,generatedAt:new Date().toISOString(),
  methodology:{
    targetSide:"actual home margin minus market-implied home margin (equivalent to home cover margin)",
    targetTotal:"actual total minus market total",
    split:"nested walk-forward by season: earlier seasons fit, latest development season selects family/lambda/threshold, next season untouched test",
    market:"explicit CBBD consensus when available; otherwise median spread/total across available books per game; opening/current values retained; market never enters independent score generation",
    prices:"recorded side/total prices when exposed by CBBD; otherwise -110 only for research accounting and explicitly counted",
    note:"research-only; no wager qualification or production promotion",
  },
  sourceRows:rows0.length,joinedRows:joined.length,seasons,coverage,providerCounts,
  marketAudit:{moneylineOrientationN:orientN,spreadOrientationConsistency:round(orientationConsistency,3)},
  folds,
  aggregateHoldout:{side:aggregateFold("side"),total:aggregateFold("total")},
  selectiveDisagreementV1:selectiveDisagreementV1(joined),
  frozenHypotheses:[
    frozenHypothesis(joined,"kenpom-dog-gap6-spread-under20"),
    frozenHypothesis(joined,"kenpom-total-gap4-market120-135"),
  ],
  exploratoryRules:{
    side:candidateRules(joined,"side").slice(0,20),
    total:candidateRules(joined,"total").slice(0,30),
  },
};

mkdirSync("artifacts",{recursive:true});
writeFileSync("artifacts/cbb-market-edge-lab.json",JSON.stringify(report,null,2));
writeFileSync("artifacts/cbb-market-research-dataset.json",JSON.stringify(joined.map(r=>({
  id:r.id,season:r.season,date:r.date,home:r.home,away:r.away,neutral:r.neutral,
  actualHome:r.actualHome,actualAway:r.actualAway,market:r.market,
  cbbd:r.cbbd,torvik:r.torvik,kenpom:r.kenpom,fullStack:r.fullStack,
  roll:r.roll,features:r.features,sideResidual:r.sideResidual,totalResidual:r.totalResidual,
})),null,2));
console.log(JSON.stringify({ok:true,sourceRows:report.sourceRows,joinedRows:report.joinedRows,seasons,coverage,marketAudit:report.marketAudit,folds:folds.map(f=>({testSeason:f.testSeason,side:f.side?.test,total:f.total?.test,specSide:f.side?.spec,specTotal:f.total?.spec})),aggregateHoldout:report.aggregateHoldout,selectiveDisagreementV1:report.selectiveDisagreementV1,topSideRules:report.exploratoryRules.side.slice(0,5),frozenHypotheses:report.frozenHypotheses,topTotalRules:report.exploratoryRules.total.slice(0,8)},null,2));
