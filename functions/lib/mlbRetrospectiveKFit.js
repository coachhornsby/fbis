import {sha256Hex} from './sha256Hex.js';
const avg=xs=>xs.reduce((s,v)=>s+v,0)/xs.length;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const K_FEATURES=['whiff','chase','hardHit','xwobacon','velocity','opponentK'];
export function buildRetrospectiveKRows(days){
 const pitchers=new Map(),starts=new Map(),teams=new Map(),rows=[],coverage={eligibleStarts:0,insufficientHistory:0};
 const ordered=[...days].sort((a,b)=>a.date.localeCompare(b.date));if(new Set(ordered.map(d=>d.date)).size!==ordered.length)throw Error('DUPLICATE_HISTORY_DATE');
 for(const day of ordered){
  for(const game of day.games)for(const p of game.players.filter(p=>p.group==='pitching'&&p.starter)){
   coverage.eligibleStarts++;const past=(pitchers.get(p.playerId)||[]).filter(x=>Date.parse(day.date)-Date.parse(x.date)<=90*86400000),work=(starts.get(p.playerId)||[]).slice(-5),opponent=teams.get(p.opponentId);
   const metric=k=>{const values=past.map(p=>p.metrics[k]).filter(m=>m&&m.denominator>0&&Number.isFinite(m.numerator));const den=values.reduce((s,m)=>s+m.denominator,0);return den?values.reduce((s,m)=>s+m.numerator,0)/den:null;};
   const features=[metric('whiff'),metric('chase'),metric('hardHit'),metric('xwobacon'),metric('velocity'),opponent?.pa>0?opponent.k/opponent.pa:null];
   const rate=metric('strikeout'),expectedBf=work.length?avg(work.map(w=>w.battersFaced)):null;
   const target=p.stats.strikeOuts;
   if(work.length<3||past.reduce((s,p)=>s+p.pitches,0)<200||!features.every(Number.isFinite)||!Number.isFinite(rate)||!Number.isFinite(target)||!(expectedBf>0)){coverage.insufficientHistory++;continue;}
   rows.push({gameId:game.gameId,playerId:p.playerId,date:day.date,scope:game.gameType==='R'?'regular':'postseason',baseline:clamp(rate*expectedBf,.1,20),features,target,classification:'RETROSPECTIVE',sourceHash:game.sourceHash,priorSourceDates:past.map(p=>p.date)});
  }
  // Whole-day lag: no actual same-day innings or opposing lineup outcome enters a feature.
  for(const game of day.games)for(const p of game.players){
   if(p.group==='pitching'&&p.starter&&Number.isFinite(p.stats.battersFaced)){const xs=starts.get(p.playerId)||[];xs.push({battersFaced:p.stats.battersFaced,date:day.date});starts.set(p.playerId,xs);}
   if(p.group==='batting'&&Number.isFinite(p.stats.strikeOuts)&&Number.isFinite(p.stats.plateAppearances)){const t=teams.get(p.teamId)||{k:0,pa:0};t.k+=p.stats.strikeOuts;t.pa+=p.stats.plateAppearances;teams.set(p.teamId,t);}
  }
  for(const p of day.pitcherDays){const xs=(pitchers.get(p.playerId)||[]).filter(x=>Date.parse(day.date)-Date.parse(x.date)<=90*86400000);xs.push({...p,date:day.date});pitchers.set(p.playerId,xs);}
 }
 return {rows,coverage};
}
export function predictRetrospectiveK(model,row){const z=row.features.map((x,i)=>clamp((x-model.mean[i])/model.sd[i],-5,5));return clamp(row.baseline*Math.exp(clamp(model.coefficients[0]+z.reduce((s,x,i)=>s+x*model.coefficients[i+1],0),-2,2)),.1,20);}
function fit(train,ridge){
 const mean=K_FEATURES.map((_,i)=>avg(train.map(r=>r.features[i]))),sd=mean.map((m,i)=>Math.sqrt(avg(train.map(r=>(r.features[i]-m)**2)))||1),coefficients=Array(7).fill(0),model={mean,sd,coefficients,ridge};
 const design=train.map(r=>[1,...r.features.map((x,i)=>clamp((x-mean[i])/sd[i],-5,5))]);
 for(let epoch=0;epoch<400;epoch++){const gradient=Array(7).fill(0);for(let i=0;i<train.length;i++){const row=train[i],z=design[i],mu=clamp(row.baseline*Math.exp(clamp(z.reduce((s,x,j)=>s+x*coefficients[j],0),-2,2)),.1,20);for(let j=0;j<7;j++)gradient[j]+=(mu-row.target)*z[j]/train.length;}
  for(let j=0;j<7;j++)coefficients[j]-=.01*(gradient[j]+(j?ridge*coefficients[j]:0));
 }
 return model;
}
export function kFitScores(rows,predict){if(!rows.length)return null;const errors=rows.map(r=>({y:r.target,mu:predict(r)}));return {n:rows.length,distinctGames:new Set(rows.map(r=>r.gameId)).size,mae:avg(errors.map(r=>Math.abs(r.mu-r.y))),rmse:Math.sqrt(avg(errors.map(r=>(r.mu-r.y)**2))),bias:avg(errors.map(r=>r.mu-r.y)),poissonDeviance:avg(errors.map(r=>2*(r.y>0?r.y*Math.log(r.y/r.mu)-(r.y-r.mu):r.mu)))};}
export function countCalibration(rows,predict,lines=[.5,1.5,2.5,4.5,6.5]){
 return lines.map(line=>{
  const records=rows.map(r=>{const mu=predict(r);let term=Math.exp(-mu),cdf=term;for(let k=1;k<=Math.floor(line);k++){term*=mu/k;cdf+=term;}return {p:clamp(1-cdf,1e-9,1-1e-9),y:r.target>line?1:0};});
  if(!records.length)return {line,n:0,brier:null,logLoss:null,ece:null,bins:[]};
  const bins=Array.from({length:10},(_,bin)=>{const rs=records.filter(r=>Math.min(9,Math.floor(r.p*10))===bin);return {bin,n:rs.length,predicted:rs.length?avg(rs.map(r=>r.p)):null,observed:rs.length?avg(rs.map(r=>r.y)):null};});
  return {line,n:records.length,brier:avg(records.map(r=>(r.p-r.y)**2)),logLoss:-avg(records.map(r=>r.y*Math.log(r.p)+(1-r.y)*Math.log(1-r.p))),ece:bins.reduce((s,b)=>s+(b.n?Math.abs(b.predicted-b.observed)*b.n/records.length:0),0),bins};
 });
}
function pairedGameErrorInterval(rows,model){
 const games=new Map();for(const r of rows){const xs=games.get(r.gameId)||[];xs.push(Math.abs(predictRetrospectiveK(model,r)-r.target)-Math.abs(r.baseline-r.target));games.set(r.gameId,xs);}
 const differences=[...games.values()].map(avg),mean=avg(differences),n=differences.length,se=n>1?Math.sqrt(differences.reduce((s,x)=>s+(x-mean)**2,0)/(n-1)/n):null;
 return {distinctGames:n,meanCandidateMinusBaseline:mean,lo:n>=30?mean-1.96*se:null,hi:n>=30?mean+1.96*se:null,method:'GAME_CLUSTERED_NORMAL_APPROXIMATION'};
}
export function fitRetrospectiveKCandidate(input,{market='pitcher_k',features=K_FEATURES}={}){
 const rows=[...input].sort((a,b)=>a.date.localeCompare(b.date));
 if(rows.some(r=>r.classification!=='RETROSPECTIVE'||!Number.isFinite(r.target)||r.target<0||!Number.isFinite(r.baseline)||r.baseline<=0||r.features.length!==6||!r.features.every(Number.isFinite)||r.priorSourceDates.some(d=>d>=r.date)))throw Error('INVALID_OR_LEAKING_DESIGN_ROW');
 const keys=rows.map(r=>r.gameId+':'+r.playerId);if(new Set(keys).size!==keys.length)throw Error('DUPLICATE_START');
 const dates=[...new Set(rows.map(r=>r.date))];if(dates.length<90||rows.length<1500)return {status:'INSUFFICIENT_HISTORY',n:rows.length,dates:dates.length,canPromote:false};
 const calibrationStart=dates[Math.floor(dates.length*.70)],holdoutStart=dates[Math.floor(dates.length*.85)],train=rows.filter(r=>r.date<calibrationStart),calibration=rows.filter(r=>r.date>=calibrationStart&&r.date<holdoutStart),holdout=rows.filter(r=>r.date>=holdoutStart);
 if(train.length<1000||calibration.length<150||holdout.length<150)return {status:'INSUFFICIENT_FOLD_COUNTS',canPromote:false};
 const candidates=[.01,.1,1].map(ridge=>{const model=fit(train,ridge);return {model,score:kFitScores(calibration,r=>predictRetrospectiveK(model,r))};}).sort((a,b)=>a.score.poissonDeviance-b.score.poissonDeviance);
 const rolling=[];
 for(const fraction of [.5,.6,.7,.8]){
  const testStart=dates[Math.floor(dates.length*fraction)],testEnd=dates[Math.floor(dates.length*Math.min(.85,fraction+.1))],validationStart=dates[Math.floor(dates.length*(fraction-.1))];
  const tr=rows.filter(r=>r.date<validationStart),va=rows.filter(r=>r.date>=validationStart&&r.date<testStart),te=rows.filter(r=>r.date>=testStart&&r.date<testEnd);
  if(tr.length<1000||va.length<150||te.length<150){rolling.push({testStart,testEnd,status:'INSUFFICIENT_FOLD_COUNTS',train:tr.length,calibration:va.length,test:te.length});continue;}
  const selected=[.01,.1,1].map(ridge=>{const m=fit(tr,ridge);return {model:m,loss:kFitScores(va,r=>predictRetrospectiveK(m,r)).poissonDeviance};}).sort((a,b)=>a.loss-b.loss)[0].model;
  rolling.push({testStart,testEnd,status:'SCORED',train:tr.length,calibration:va.length,test:te.length,modelHash:sha256Hex(JSON.stringify(selected)),baseline:kFitScores(te,r=>r.baseline),candidate:kFitScores(te,r=>predictRetrospectiveK(selected,r)),pairedGameError:pairedGameErrorInterval(te,selected)});
 }
 const model={version:`mlb-retrospective-${market}-v1`,features,...candidates[0].model,trainedThroughExclusive:calibrationStart,selectedBefore:holdoutStart};
 return {status:'FITTED_RETROSPECTIVE_ONLY',model,modelHash:sha256Hex(JSON.stringify(model)),rollingWalkForward:rolling,folds:{train:train.length,calibration:calibration.length,holdout:holdout.length,calibrationStart,holdoutStart},holdout:{pairedGameError:pairedGameErrorInterval(holdout,model),calibration:{baseline:countCalibration(holdout,r=>r.baseline),candidate:countCalibration(holdout,r=>predictRetrospectiveK(model,r))},baseline:kFitScores(holdout,r=>r.baseline),candidate:kFitScores(holdout,r=>predictRetrospectiveK(model,r)),segments:Object.fromEntries(['regular','postseason'].map(scope=>[scope,{baseline:kFitScores(holdout.filter(r=>r.scope===scope),r=>r.baseline),candidate:kFitScores(holdout.filter(r=>r.scope===scope),r=>predictRetrospectiveK(model,r))}]))},canPromote:false,limitations:['Retrospectively downloaded data cannot establish historical source availability.','Conditional on actual starting players; no historic Pal/weather forecasts or executable quotes reconstructed.','Rolling historical folds remain retrospective; they do not establish pregame acquisition timing or economic qualification.','No production projection or wagering authority changes.']};
}

export function buildRetrospectiveHitterRows(days){
 const history=new Map(),batters=new Map(),pitchers=new Map(),rows={hits:[],total_bases:[],home_runs:[]};
 for(const day of [...days].sort((a,b)=>a.date.localeCompare(b.date))){
  for(const game of day.games){
   const starters=game.players.filter(p=>p.group==='pitching'&&p.starter);
   for(const p of game.players.filter(p=>p.group==='batting'&&p.starter)){
    const past=(batters.get(p.playerId)||[]).filter(r=>Date.parse(day.date)-Date.parse(r.date)<=90*86400000),games=history.get(p.playerId)||[],opp=starters.find(s=>s.teamId===p.opponentId),oppDays=(pitchers.get(opp?.playerId)||[]).filter(r=>Date.parse(day.date)-Date.parse(r.date)<=90*86400000);
    const metric=(ds,key)=>{const ms=ds.map(d=>d.metrics[key]).filter(m=>m?.denominator>0&&Number.isFinite(m.numerator)),den=ms.reduce((s,m)=>s+m.denominator,0);return den?ms.reduce((s,m)=>s+m.numerator,0)/den:null;};
    const features=['xwobacon','hardHit','barrel','contact','chase'].map(k=>metric(past,k));features.push(metric(oppDays,'strikeout'));
    const pa=games.reduce((s,g)=>s+g.plateAppearances,0),recent=games.slice(-10),expectedPa=recent.length?avg(recent.map(g=>g.plateAppearances)):0;
    if(pa<50||past.reduce((s,d)=>s+d.pitches,0)<200||!features.every(Number.isFinite)||!expectedPa)continue;
    for(const [market,field] of [['hits','hits'],['total_bases','totalBases'],['home_runs','homeRuns']]){
     const target=p.stats[field];if(!Number.isFinite(target)||!games.every(g=>Number.isFinite(g[field])))continue;
     rows[market].push({gameId:game.gameId,playerId:p.playerId,date:day.date,scope:game.gameType==='R'?'regular':'postseason',baseline:clamp(games.reduce((s,g)=>s+g[field],0)/pa*expectedPa,.1,20),features,target,classification:'RETROSPECTIVE',sourceHash:game.sourceHash,priorSourceDates:past.map(d=>d.date)});
    }
   }
  }
  for(const game of day.games)for(const p of game.players.filter(p=>p.group==='batting'&&p.starter&&Number.isFinite(p.stats.plateAppearances))){const xs=history.get(p.playerId)||[];xs.push({...p.stats,date:day.date});history.set(p.playerId,xs);}
  for(const [source,map] of [[day.batterDays||[],batters],[day.pitcherDays,pitchers]])for(const p of source){const xs=(map.get(p.playerId)||[]).filter(d=>Date.parse(day.date)-Date.parse(d.date)<=90*86400000);xs.push({...p,date:day.date});map.set(p.playerId,xs);}
 }
 return rows;
}
