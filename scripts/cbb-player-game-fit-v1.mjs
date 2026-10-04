import {readFileSync,readdirSync,writeFileSync,mkdirSync} from "node:fs";
const dir=process.argv[2]||"artifacts/parts";
const fitPath=process.argv[3]||"artifacts/frozen/cbb-fbis-v2-fit.json";
const files=readdirSync(dir,{recursive:true}).filter(f=>/cbb-player-history-20\d\d\.json$/.test(String(f).split("/").pop()));
const packs=files.map(f=>JSON.parse(readFileSync(dir+"/"+f,"utf8")));
const rows=packs.flatMap(x=>x.gameSamples||[]);
const fit=JSON.parse(readFileSync(fitPath,"utf8"));
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const get=(o,p)=>p.split(".").reduce((a,k)=>a==null?null:a[k],o);
const round=(v,d=4)=>v==null?null:Number(Number(v).toFixed(d));
function predictFrozen(m,r){if(!m)return 0;const vals=m.features.map(p=>n(get(r,p))??0);let y=m.intercept;for(let j=0;j<vals.length;j++)y+=m.beta[j]*(vals[j]-m.means[j])/m.sds[j];return y}
function base(r,kind){return n(r.fbis?.[kind])+predictFrozen(fit[kind].model,r)}
function actual(r,kind){return kind==="total"?n(r.actualHome)+n(r.actualAway):n(r.actualHome)-n(r.actualAway)}
const FEATURE_KEYS=[
 "pointsProxyDiff","pointsProxySum","reboundsProxyDiff","reboundsProxySum","assistsProxyDiff","assistsProxySum","threesProxyDiff","threesProxySum",
 "fgaProxyDiff","fgaProxySum","ftaProxyDiff","ftaProxySum","offensiveReboundProxyDiff","offensiveReboundProxySum","defensiveReboundProxyDiff","defensiveReboundProxySum",
 "turnoverProxyDiff","turnoverProxySum","efgDiff","efgSum","trueShootingDiff","trueShootingSum","top5MinuteShareDiff","top5MinuteShareSum",
 "top3UsageShareDiff","top3UsageShareSum","roleConfidenceDiff","roleConfidenceSum","minuteStabilityDiff","minuteStabilitySum",
 "starterMinuteShareDiff","starterMinuteShareSum","experiencedMinuteShareDiff","experiencedMinuteShareSum","recentDnpMinuteShareDiff","recentDnpMinuteShareSum"
];
function eligible(r){
 const h=r.homePlayer||{},a=r.awayPlayer||{};
 return h.ok&&a.ok&&(n(h.players)||0)>=6&&(n(a.players)||0)>=6&&(n(h.roleConfidence)||0)>=.42&&(n(a.roleConfidence)||0)>=.42&&(n(h.experiencedMinuteShare)||0)>=.45&&(n(a.experiencedMinuteShare)||0)>=.45;
}
function x(r){return FEATURE_KEYS.map(k=>n(r.features?.[k])??0)}
function solve(A,b){const m=A.map((r,i)=>[...r,b[i]]),N=m.length;for(let i=0;i<N;i++){let p=i;for(let j=i+1;j<N;j++)if(Math.abs(m[j][i])>Math.abs(m[p][i]))p=j;[m[i],m[p]]=[m[p],m[i]];const d=m[i][i]||1e-12;for(let k=i;k<=N;k++)m[i][k]/=d;for(let j=0;j<N;j++){if(j===i)continue;const q=m[j][i];for(let k=i;k<=N;k++)m[j][k]-=q*m[i][k]}}return m.map(r=>r[N])}
function fitRidge(rs,kind,lambda){
 const X=rs.map(x),y=rs.map(r=>actual(r,kind)-base(r,kind)),p=FEATURE_KEYS.length,means=Array(p).fill(0),sds=Array(p).fill(1);
 for(let j=0;j<p;j++){means[j]=X.reduce((s,a)=>s+a[j],0)/X.length;const v=X.reduce((s,a)=>s+(a[j]-means[j])**2,0)/Math.max(1,X.length-1);sds[j]=Math.sqrt(v)||1}
 const ym=y.reduce((s,v)=>s+v,0)/y.length,A=Array.from({length:p},()=>Array(p).fill(0)),b=Array(p).fill(0);
 for(let i=0;i<X.length;i++){const z=X[i].map((v,j)=>(v-means[j])/sds[j]),yy=y[i]-ym;for(let a=0;a<p;a++){b[a]+=z[a]*yy;for(let q=0;q<p;q++)A[a][q]+=z[a]*z[q]}}
 for(let j=0;j<p;j++)A[j][j]+=lambda;return{features:FEATURE_KEYS,means,sds,beta:solve(A,b),intercept:ym,lambda}
}
function pred(m,r){const X=x(r);let y=m.intercept;for(let j=0;j<X.length;j++)y+=m.beta[j]*(X[j]-m.means[j])/m.sds[j];return y}
function chooseLambda(train,kind){const lambdas=[.1,1,10,100,1000,10000],seasons=[2018,2019,2020,2021,2022];let best=null;for(const lambda of lambdas){let se=0,c=0;for(const s of seasons){const tr=train.filter(r=>r.season!==s),te=train.filter(r=>r.season===s);if(!tr.length||!te.length)continue;const m=fitRidge(tr,kind,lambda);for(const r of te){const e=(actual(r,kind)-base(r,kind))-pred(m,r);se+=e*e;c++}}const rmse=Math.sqrt(se/Math.max(1,c));if(!best||rmse<best.rmse)best={lambda,rmse}}return best}
function metrics(rs,kind,m=null,{applyOnlyEligible=true}={}){
 let n0=0,b=0,p=0,biasB=0,biasP=0,adjusted=0;
 for(const r of rs){const a=actual(r,kind),bb=base(r,kind);if(a==null||bb==null)continue;let pp=bb;if(m&&(!applyOnlyEligible||eligible(r))){pp=bb+pred(m,r);adjusted++}n0++;b+=Math.abs(bb-a);p+=Math.abs(pp-a);biasB+=bb-a;biasP+=pp-a}
 return n0?{n:n0,adjusted,baseMae:round(b/n0),playerMae:round(p/n0),gain:round((b-p)/n0),baseBias:round(biasB/n0),playerBias:round(biasP/n0)}:{n:0};
}
const discovery=rows.filter(r=>r.season<=2022&&eligible(r)),validation=rows.filter(r=>[2023,2024].includes(r.season)),confirmation=rows.filter(r=>r.season===2025);
const out={id:"CBB-PLAYER-GAME-v1-WALKFORWARD",generatedAt:new Date().toISOString(),rows:rows.length,eligibleDiscovery:discovery.length,training:"2018-22 eligible player-state games only",validation:"2023-24",confirmation:"2025",marketInformed:false,models:{}};
for(const kind of ["total","margin"]){const sel=chooseLambda(discovery,kind),m=fitRidge(discovery,kind,sel.lambda);out.models[kind]={lambdaSelection:sel,model:{features:m.features,means:m.means.map(v=>round(v,8)),sds:m.sds.map(v=>round(v,8)),beta:m.beta.map(v=>round(v,8)),intercept:round(m.intercept,8),lambda:m.lambda},discovery:metrics(rows.filter(r=>r.season<=2022),kind,m),validation:metrics(validation,kind,m),confirmation:metrics(confirmation,kind,m),eligibleValidation:metrics(validation.filter(eligible),kind,m,{applyOnlyEligible:false}),eligibleConfirmation:metrics(confirmation.filter(eligible),kind,m,{applyOnlyEligible:false})};out.models[kind].promote=Boolean(out.models[kind].validation.gain>0&&out.models[kind].confirmation.gain>0&&out.models[kind].eligibleValidation.gain>0&&out.models[kind].eligibleConfirmation.gain>0)}
out.promotion={total:out.models.total.promote,margin:out.models.margin.promote,requiresOperatorApproval:true};
mkdirSync("artifacts",{recursive:true});writeFileSync("artifacts/cbb-player-game-v1-fit.json",JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
