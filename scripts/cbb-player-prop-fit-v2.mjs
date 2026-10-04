import {readFileSync,readdirSync,writeFileSync,mkdirSync} from "node:fs";
const dir=process.argv[2]||"artifacts/parts";
const files=readdirSync(dir,{recursive:true}).filter(f=>/cbb-player-history-20\d\d\.json$/.test(String(f).split("/").pop()));
const rows=files.flatMap(f=>(JSON.parse(readFileSync(dir+"/"+f,"utf8")).propSamples||[]));
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const round=(v,d=4)=>v==null?null:Number(Number(v).toFixed(d));
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const mean=a=>{const x=a.map(n).filter(v=>v!=null);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null};
const markets=["points","rebounds","assists","three_pointers_made","points_rebounds_assists"];
function marketVals(r,m){
 const p=r.prior||{},key=m==="three_pointers_made"?"threesMade":m==="points_rebounds_assists"?"pra":m;
 if(m==="points_rebounds_assists"){
   return{
    season:(n(p.pointsPerGame)||0)+(n(p.reboundsPerGame)||0)+(n(p.assistsPerGame)||0),
    per40:(n(p.pointsPer40)||0)+(n(p.reboundsPer40)||0)+(n(p.assistsPer40)||0),
    recent:(n(p.recent?.points)||0)+(n(p.recent?.rebounds)||0)+(n(p.recent?.assists)||0),
    trend:(n(p.trend?.points)||0)+(n(p.trend?.rebounds)||0)+(n(p.trend?.assists)||0),
    volatility:Math.sqrt((n(p.volatility?.points)||0)**2+(n(p.volatility?.rebounds)||0)**2+(n(p.volatility?.assists)||0)**2)
   };
 }
 return{season:n(p[key+"PerGame"]),per40:n(p[key+"Per40"]),recent:n(p.recent?.[key]),trend:n(p.trend?.[key]),volatility:n(p.volatility?.[key])};
}
function baseline(r,m){
 const p=r.prior||{},v=marketVals(r,m),mins=n(p.projectedMinutes)||0;
 const vals=[[v.per40==null?null:v.per40*mins/40,.48],[v.season,.22],[v.recent,.20],[v.trend,.10]];
 let sx=0,sw=0;for(const [x,w] of vals){if(x==null)continue;sx+=x*w;sw+=w}
 let y=sw?sx/sw:null;if(y==null)return null;
 const poss=n(r.game?.possessions);if(poss!=null)y*=clamp(poss/69,.88,1.12);
 const teamScore=r.side==="home"?n(r.game?.baseHome):n(r.game?.baseAway);
 if(teamScore!=null&&(m==="points"||m==="points_rebounds_assists"))y*=clamp(teamScore/72,.86,1.16);
 return y;
}
const FEATURES=["projectedMinutes","minutesPerGame","roleConfidence","sampleSize","season","per40","recent","trend","volatility","possessions","teamScore","home","pointsPer40","reboundsPer40","assistsPer40","threesPer40","fgaPer40","ftaPer40","orebPer40","drebPer40","tovPer40","minuteStability","lastGameDnp"];
function x(r,m){
 const p=r.prior||{},v=marketVals(r,m),teamScore=r.side==="home"?n(r.game?.baseHome):n(r.game?.baseAway);
 return[
  n(p.projectedMinutes)||0,n(p.minutesPerGame)||0,n(p.roleConfidence)||0,n(p.sampleSize)||0,
  n(v.season)||0,n(v.per40)||0,n(v.recent)||0,n(v.trend)||0,n(v.volatility)||0,
  n(r.game?.possessions)||69,teamScore||72,r.side==="home"?1:0,
  n(p.pointsPer40)||0,n(p.reboundsPer40)||0,n(p.assistsPer40)||0,n(p.threesMadePer40)||0,
  n(p.fieldGoalAttemptsPer40)||0,n(p.freeThrowAttemptsPer40)||0,n(p.offensiveReboundsPer40)||0,n(p.defensiveReboundsPer40)||0,n(p.turnoversPer40)||0,
  n(p.role?.minuteStability)||0,p.role?.lastGameDnp?1:0
 ];
}
function actual(r,m){return n(r.actual?.[m])}
function usable(r,m){return actual(r,m)!=null&&baseline(r,m)!=null&&(n(r.prior?.sampleSize)||0)>=3&&(n(r.prior?.projectedMinutes)||0)>=10}
function solve(A,b){const m=A.map((r,i)=>[...r,b[i]]),N=m.length;for(let i=0;i<N;i++){let p=i;for(let j=i+1;j<N;j++)if(Math.abs(m[j][i])>Math.abs(m[p][i]))p=j;[m[i],m[p]]=[m[p],m[i]];const d=m[i][i]||1e-12;for(let k=i;k<=N;k++)m[i][k]/=d;for(let j=0;j<N;j++){if(j===i)continue;const q=m[j][i];for(let k=i;k<=N;k++)m[j][k]-=q*m[i][k]}}return m.map(r=>r[N])}
function fitRidge(rs,mkt,lambda){
 const X=rs.map(r=>x(r,mkt)),y=rs.map(r=>actual(r,mkt)-baseline(r,mkt)),p=FEATURES.length,means=Array(p).fill(0),sds=Array(p).fill(1);
 for(let j=0;j<p;j++){means[j]=X.reduce((s,a)=>s+a[j],0)/X.length;const v=X.reduce((s,a)=>s+(a[j]-means[j])**2,0)/Math.max(1,X.length-1);sds[j]=Math.sqrt(v)||1}
 const ym=y.reduce((s,v)=>s+v,0)/y.length,A=Array.from({length:p},()=>Array(p).fill(0)),b=Array(p).fill(0);
 for(let i=0;i<X.length;i++){const z=X[i].map((v,j)=>(v-means[j])/sds[j]),yy=y[i]-ym;for(let a=0;a<p;a++){b[a]+=z[a]*yy;for(let q=0;q<p;q++)A[a][q]+=z[a]*z[q]}}
 for(let j=0;j<p;j++)A[j][j]+=lambda;return{features:FEATURES,means,sds,beta:solve(A,b),intercept:ym,lambda}
}
function pred(m,r,mkt){const X=x(r,mkt);let y=m.intercept;for(let j=0;j<X.length;j++)y+=m.beta[j]*(X[j]-m.means[j])/m.sds[j];return baseline(r,mkt)+y}
function chooseLambda(train,mkt){const ls=[.1,1,10,100,1000,10000],ss=[2018,2019,2020,2021,2022];let best=null;for(const lambda of ls){let se=0,c=0;for(const s of ss){const tr=train.filter(r=>r.season!==s),te=train.filter(r=>r.season===s);if(!tr.length||!te.length)continue;const m=fitRidge(tr,mkt,lambda);for(const r of te){const e=actual(r,mkt)-pred(m,r,mkt);se+=e*e;c++}}const rmse=Math.sqrt(se/Math.max(1,c));if(!best||rmse<best.rmse)best={lambda,rmse}}return best}
function metrics(rs,mkt,m){
 let k=0,bm=0,pm=0,bs=0,ps=0;const errs=[];
 for(const r of rs){if(!usable(r,mkt))continue;const a=actual(r,mkt),b=baseline(r,mkt),p=pred(m,r,mkt),eb=b-a,ep=p-a;k++;bm+=Math.abs(eb);pm+=Math.abs(ep);bs+=eb*eb;ps+=ep*ep;errs.push(ep)}
 const bias=k?errs.reduce((s,v)=>s+v,0)/k:null,sd=k>1?Math.sqrt(errs.reduce((s,v)=>s+(v-bias)**2,0)/(k-1)):null;
 return k?{n:k,baselineMae:round(bm/k),modelMae:round(pm/k),gain:round((bm-pm)/k),baselineRmse:round(Math.sqrt(bs/k)),modelRmse:round(Math.sqrt(ps/k)),residualBias:round(bias),residualSd:round(sd)}:{n:0}
}
const out={id:"CBB-PLAYER-PROP-v2-WALKFORWARD",generatedAt:new Date().toISOString(),rows:rows.length,training:"2018-22 prior-only player state",validation:"2023-24",confirmation:"2025",marketInformed:false,markets:{}};
for(const mkt of markets){
 const tr=rows.filter(r=>r.season<=2022&&usable(r,mkt)),va=rows.filter(r=>[2023,2024].includes(r.season)),co=rows.filter(r=>r.season===2025),sel=chooseLambda(tr,mkt),m=fitRidge(tr,mkt,sel.lambda),vm=metrics(va,mkt,m),cm=metrics(co,mkt,m);
 out.markets[mkt]={lambdaSelection:sel,model:{features:m.features,means:m.means.map(v=>round(v,8)),sds:m.sds.map(v=>round(v,8)),beta:m.beta.map(v=>round(v,8)),intercept:round(m.intercept,8),lambda:m.lambda},discovery:metrics(tr,mkt,m),validation:vm,confirmation:cm,promote:Boolean(vm.gain>0&&cm.gain>0),sigma:round(Math.max(vm.residualSd||0,cm.residualSd||0),3)};
}
out.promotion={markets:Object.fromEntries(markets.map(m=>[m,out.markets[m].promote])),canQualify:false,canAuthorizeWager:false,requiresProspectiveMarketValidation:true};
mkdirSync("artifacts",{recursive:true});writeFileSync("artifacts/cbb-player-prop-v2-fit.json",JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
