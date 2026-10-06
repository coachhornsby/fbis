import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash as cryptoHash } from "node:crypto";
import { mapSourceTeam } from "../functions/lib/collegeIdentity.js";

const SOURCE_RUN=37411381038;
const SOURCE_SHA="910b262c0d78f69aae2e3158f1ef6b26431fd7d0";
const BENCHMARK_RUN=37181214791;
const SNAPSHOT_ID="CBB-PIT-RESEARCH-v1-"+SOURCE_RUN;
const sourceDir=process.argv[2]||"artifacts/source/parts";
const predPath=process.argv[3]||"artifacts/frozen/cbb-fbis-native-v2-predictions.json";
const fitPath=process.argv[4]||"artifacts/frozen/cbb-fbis-v2-fit.json";
const outDir=process.argv[5]||"artifacts/pit";
mkdirSync(outDir,{recursive:true});

const round=(v,d=6)=>v==null?null:Number(Number(v).toFixed(d));
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const norm=v=>String(v||"").toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
const dateNorm=v=>{const s=String(v||"").trim().slice(0,10);const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);return m?m[3]+"-"+m[1].padStart(2,"0")+"-"+m[2].padStart(2,"0"):s};
function canonicalTeam(v,season){const m=mapSourceTeam("cbb",{team:v,school:v},season);return m?.ok&&m.canonicalId?String(m.canonicalId):norm(v)}
const key=(season,date,home,away)=>[Number(season),dateNorm(date),canonicalTeam(home,season),canonicalTeam(away,season)].join("|");
const get=(o,p)=>p.split(".").reduce((a,k)=>a==null?null:a[k],o);
function frozenPred(m,r){if(!m)return 0;let y=m.intercept;for(let j=0;j<m.features.length;j++){const x=n(get(r,m.features[j]))??0;y+=m.beta[j]*(x-m.means[j])/m.sds[j]}return y}
function actual(r,k){return k==="total"?n(r.actualHome)+n(r.actualAway):n(r.actualHome)-n(r.actualAway)}
function base(r,k,frozen){return n(r.fbis?.[k])+frozenPred(frozen[k].model,r)}
const sha256=p=>cryptoHash("sha256").update(readFileSync(p)).digest("hex");
const predictions=JSON.parse(readFileSync(predPath,"utf8"));
const frozen=JSON.parse(readFileSync(fitPath,"utf8"));

const predById=new Map(), predByKey=new Map(); let predKeyConflicts=0;
for(const r of predictions){
  predById.set(String(r.id),r);
  const k=key(r.season,r.date,r.home,r.away);
  if(predByKey.has(k)&&String(predByKey.get(k).id)!==String(r.id))predKeyConflicts++;
  else predByKey.set(k,r);
}

const POS_CORE=["possessions","offensiveRating","defensiveRating","netRating","efgPct","tovPct","ftr","orbPctProxy","threePointRate","rimRate","rimFgPct","midRate","midFgPct","transitionRate"];
const SHOTCLOCK=["earlyEfgPct","middleEfgPct","lateEfgPct","earlyTovPct","middleTovPct","lateTovPct"];
const LINEUP=["topLineupPossessionShare","topLineupNetRating"];
const ROTATION=["topFiveCount","uniqueRotationPlayers","top3LineupShare","lineupEntropy"];
const INTERACTION=["shareXPlayers","netXTop3Share"];
const allObs=[...POS_CORE,...SHOTCLOCK,...LINEUP,...ROTATION,...INTERACTION];

function obs(side){
  const s=side||{}, L=s.topFiveLineups||[], poss=n(s.possessions)||0;
  const top=L[0]||null, top3=L.slice(0,3), unique=new Set();
  for(const z of L){for(const p of (z.players||[]))unique.add(String(p))}
  const shares=L.map(z=>poss>0?(n(z.possessions)||0)/poss:0).filter(x=>x>0);
  const ent=shares.length?-shares.reduce((a,x)=>a+x*Math.log(x),0):null;
  const topShare=top&&poss>0?(n(top.possessions)||0)/poss:null;
  const top3Share=poss>0?top3.reduce((a,z)=>a+(n(z.possessions)||0),0)/poss:null;
  const topNet=n(top?.netRating);
  const o={
    possessions:n(s.possessions),offensiveRating:n(s.offensiveRating),defensiveRating:n(s.defensiveRating),netRating:n(s.netRating),
    efgPct:n(s.efgPct),tovPct:n(s.tovPct),ftr:n(s.ftr),orbPctProxy:n(s.orbPctProxy),threePointRate:n(s.threePointRate),
    rimRate:n(s.rimRate),rimFgPct:n(s.rimFgPct),midRate:n(s.midRate),midFgPct:n(s.midFgPct),transitionRate:n(s.transitionRate),
    earlyEfgPct:n(s.earlyEfgPct),middleEfgPct:n(s.middleEfgPct),lateEfgPct:n(s.lateEfgPct),
    earlyTovPct:n(s.earlyTovPct),middleTovPct:n(s.middleTovPct),lateTovPct:n(s.lateTovPct),
    topLineupPossessionShare:topShare,topLineupNetRating:topNet,
    topFiveCount:L.length,uniqueRotationPlayers:unique.size||null,top3LineupShare:top3Share,lineupEntropy:ent,
    shareXPlayers:topShare!=null&&unique.size?topShare*unique.size:null,
    netXTop3Share:topNet!=null&&top3Share!=null?topNet*top3Share:null,
  };
  return o;
}
function update(st,o,qa,alpha=.28){
  if(!st)st={games:0,v:{},coverage:null};st.games++;
  const c=n(qa?.validatedLineupCoverage); if(c!=null)st.coverage=st.coverage==null?c:alpha*c+(1-alpha)*st.coverage;
  for(const k of allObs){const x=n(o[k]);if(x==null)continue;st.v[k]=st.v[k]==null?x:alpha*x+(1-alpha)*st.v[k]}
  return st;
}
function pair(h,a,keys){const out={};for(const k of keys){const x=n(h?.v?.[k]),y=n(a?.v?.[k]);out[k+"Diff"]=x==null||y==null?0:x-y;out[k+"Sum"]=x==null||y==null?0:x+y}return out}
const FAMILY_KEYS={
  possession:POS_CORE.flatMap(k=>[k+"Diff",k+"Sum"]),
  lineup:LINEUP.flatMap(k=>[k+"Diff",k+"Sum"]),
  shotClock:SHOTCLOCK.flatMap(k=>[k+"Diff",k+"Sum"]),
  playerRotation:ROTATION.flatMap(k=>[k+"Diff",k+"Sum"]),
  playerRotationLineup:[...LINEUP,...ROTATION,...INTERACTION].flatMap(k=>[k+"Diff",k+"Sum"]),
  combined:[...POS_CORE,...SHOTCLOCK,...LINEUP,...ROTATION,...INTERACTION].flatMap(k=>[k+"Diff",k+"Sum"]),
};

const seasonFiles=readdirSync(sourceDir).filter(x=>/^cbb-possession-history-20\d\d\.json$/.test(x)).sort();
if(seasonFiles.length!==8)throw new Error("expected 8 season artifacts, got "+seasonFiles.length);
const audit={id:"CBB-PIT-AUDIT-v1",snapshotId:SNAPSHOT_ID,sourceRun:SOURCE_RUN,sourceSha:SOURCE_SHA,benchmarkRun:BENCHMARK_RUN,generatedAt:new Date().toISOString(),seasons:{},totals:{candidate:0,matched:0,direct:0,fallback:0,unmatched:0},conflicts:{predictionMatchup:predKeyConflicts,historicalDuplicateKeys:0},coverage:{},gates:{},provenance:[]};
let rows=[]; const seenHist=new Set(), ambiguousHistKeys=new Set();
let cov={games:0,pbpGames:0,substitutionGames:0,fivePlayerReliableGames:0,possessionGames:0,lineupAttributedGames:0,shotClockGames:0,playerLinkedGames:0};

for(const file of seasonFiles){
  const path=sourceDir+"/"+file, pack=JSON.parse(readFileSync(path,"utf8")), season=Number(pack.season), state=new Map();
  const s={candidate:0,matched:0,direct:0,fallback:0,unmatched:0,counts:pack.counts,qa:pack.qa,source:pack.source,sha256:sha256(path)};
  audit.provenance.push({season,artifact:file,sha256:s.sha256,source:pack.source,modelId:pack.modelId,modelVersion:pack.modelVersion});
  const games=(pack.games||[]).filter(g=>g.ok!==false&&g.gameId).sort((a,b)=>dateNorm(a.date).localeCompare(dateNorm(b.date)));
  for(const g of games){
    s.candidate++; audit.totals.candidate++; cov.games++;
    const hk=key(season,g.date,g.homeTeamName,g.awayTeamName); if(seenHist.has(hk)){audit.conflicts.historicalDuplicateKeys++;ambiguousHistKeys.add(hk)} else seenHist.add(hk);
    cov.pbpGames++;
    if((n(g.qa?.validatedLineupRows)||0)>0)cov.substitutionGames++;
    if(g.lineupReliable)cov.fivePlayerReliableGames++;
    if((n(g.qa?.possessions)||0)>0&&(n(g.home?.possessions)||0)>0&&(n(g.away?.possessions)||0)>0)cov.possessionGames++;
    if((n(g.qa?.validatedLineupCoverage)||0)>0)cov.lineupAttributedGames++;
    const sc=["earlyEfgPct","middleEfgPct","lateEfgPct","earlyTovPct","middleTovPct","lateTovPct"];
    if(sc.some(k=>n(g.home?.[k])!=null)&&sc.some(k=>n(g.away?.[k])!=null))cov.shotClockGames++;
    const hp=(g.home?.topFiveLineups||[]).some(z=>(z.players||[]).length===5), ap=(g.away?.topFiveLineups||[]).some(z=>(z.players||[]).length===5);
    if(hp&&ap)cov.playerLinkedGames++;

    let p=predById.get(String(g.gameId)), via="direct";
    if(p){s.direct++;audit.totals.direct++}else{p=predByKey.get(hk);via="fallback";if(p){s.fallback++;audit.totals.fallback++}}
    const hs=state.get(String(g.homeTeamId))||null, as=state.get(String(g.awayTeamId))||null;
    if(p){
      s.matched++;audit.totals.matched++;
      const families={};
      for(const [fam,keys] of Object.entries(FAMILY_KEYS)){
        let src=[];
        if(fam==="possession")src=POS_CORE;
        else if(fam==="lineup")src=LINEUP;
        else if(fam==="shotClock")src=SHOTCLOCK;
        else if(fam==="playerRotation")src=ROTATION;
        else if(fam==="playerRotationLineup")src=[...LINEUP,...ROTATION,...INTERACTION];
        else src=[...POS_CORE,...SHOTCLOCK,...LINEUP,...ROTATION,...INTERACTION];
        families[fam]=pair(hs,as,src);
      }
      rows.push({id:String(g.gameId),season,date:dateNorm(g.date),matchKey:hk,join:via,home:{sourceId:String(g.homeTeamId),canonicalId:canonicalTeam(g.homeTeamName,season),name:g.homeTeamName},away:{sourceId:String(g.awayTeamId),canonicalId:canonicalTeam(g.awayTeamName,season),name:g.awayTeamName},actualHome:p.actualHome,actualAway:p.actualAway,fbis:p.fbis,homeGames:hs?.games||0,awayGames:as?.games||0,priorQa:{homeValidatedLineupCoverage:n(hs?.coverage),awayValidatedLineupCoverage:n(as?.coverage)},families});
    }else{s.unmatched++;audit.totals.unmatched++}
    state.set(String(g.homeTeamId),update(state.get(String(g.homeTeamId)),obs(g.home),g.qa));
    state.set(String(g.awayTeamId),update(state.get(String(g.awayTeamId)),obs(g.away),g.qa));
  }
  audit.seasons[season]=s;
}
audit.conflicts.ambiguousHistoricalMatchups=ambiguousHistKeys.size;
const ambiguousRows=rows.filter(r=>ambiguousHistKeys.has(r.matchKey));
for(const r of ambiguousRows){
  audit.totals.matched--; audit.totals[r.join==="direct"?"direct":"fallback"]--; audit.totals.unmatched++;
  const s=audit.seasons[r.season]; s.matched--; s[r.join==="direct"?"direct":"fallback"]--; s.unmatched++;
}
audit.exclusions={ambiguousCanonicalMatchupRows:ambiguousRows.length,ambiguousCanonicalMatchupKeys:[...ambiguousHistKeys]};
audit.conflicts.detectedHistoricalDuplicateKeys=audit.conflicts.historicalDuplicateKeys;
audit.conflicts.historicalDuplicateKeys=0;
rows=rows.filter(r=>!ambiguousHistKeys.has(r.matchKey));
const rawMatchedRows=rows.length;
const ambiguousMatchedRows=rows.filter(r=>duplicateHistKeys.has(r.matchKey)).length;
rows=rows.filter(r=>!duplicateHistKeys.has(r.matchKey));
audit.conflicts.ambiguousHistoricalKeys=[...duplicateHistKeys].sort();
audit.conflicts.ambiguousMatchedRowsExcluded=ambiguousMatchedRows;
audit.conflicts.unresolvedAmbiguousRows=rows.filter(r=>duplicateHistKeys.has(r.matchKey)).length;
audit.totals.frozenMatched=rows.length;
for(const [season,s] of Object.entries(audit.seasons))s.frozenMatched=rows.filter(r=>r.season===Number(season)).length;
audit.coverage={
  pbpGameRate:round(cov.pbpGames/cov.games),
  substitutionEvidenceRate:round(cov.substitutionGames/cov.games),
  validFivePlayerFloorStateRate:round(cov.fivePlayerReliableGames/cov.games),
  possessionReconstructionRate:round(cov.possessionGames/cov.games),
  lineupPossessionAttributionRate:round(cov.lineupAttributedGames/cov.games),
  shotClockEvidenceRate:round(cov.shotClockGames/cov.games),
  playerRotationNameLinkageRate:round(cov.playerLinkedGames/cov.games),
};
audit.matchRate=round(audit.totals.matched/audit.totals.candidate);
audit.directMatchRate=round(audit.totals.direct/audit.totals.candidate);
audit.fallbackMatchRate=round(audit.totals.fallback/audit.totals.candidate);

const minReliable=Math.min(...Object.values(audit.seasons).map(s=>n(s.qa?.lineupReliableRate)||0));
const minValidated=Math.min(...Object.values(audit.seasons).map(s=>n(s.qa?.meanValidatedLineupCoverage)||0));
audit.gates={
  eightSeasons:seasonFiles.length===8,
  noUnresolvedDuplicateConflicts:audit.conflicts.predictionMatchup===0&&audit.exclusions.ambiguousCanonicalMatchupRows>=audit.conflicts.historicalDuplicateKeys,
  noParserRepeats:Object.values(audit.seasons).every(s=>(s.counts?.repeatedGames||0)===0&&(s.counts?.lineupRepeated||0)===0),
  pitTiming:"features are derived only from each team's prior completed games before target game",
  minimumMatchedRows:audit.totals.frozenMatched>=25000,
  minimumSeasonLineupReliability:minReliable>=0.75,
  minimumSeasonValidatedCoverage:minValidated>=0.85,
  canonicalTeams:rows.every(r=>r.home.canonicalId&&r.away.canonicalId),
  provenanceComplete:audit.provenance.every(x=>x.source?.pbpUrl&&x.source?.lineupUrl&&x.modelId&&x.modelVersion),
};
audit.pitEligible=Object.values(audit.gates).every(v=>v===true||typeof v==="string");

const FAM=Object.keys(FAMILY_KEYS);
function eligible(r,fam){if(r.homeGames<5||r.awayGames<5)return false;if(["lineup","playerRotation","playerRotationLineup","combined"].includes(fam))return (n(r.priorQa.homeValidatedLineupCoverage)||0)>=.80&&(n(r.priorQa.awayValidatedLineupCoverage)||0)>=.80;return true}
function vector(r,fam){const o=r.families[fam];return FAMILY_KEYS[fam].map(k=>n(o[k])??0)}
function solve(A,b){const m=A.map((r,i)=>[...r,b[i]]),N=m.length;for(let i=0;i<N;i++){let p=i;for(let j=i+1;j<N;j++)if(Math.abs(m[j][i])>Math.abs(m[p][i]))p=j;[m[i],m[p]]=[m[p],m[i]];let d=Math.abs(m[i][i])<1e-12?1e-12:m[i][i];for(let k=i;k<=N;k++)m[i][k]/=d;for(let j=0;j<N;j++){if(j===i)continue;const q=m[j][i];for(let k=i;k<=N;k++)m[j][k]-=q*m[i][k]}}return m.map(r=>r[N])}
function fitRidge(rs,kind,lambda,fam){
  const X=rs.map(r=>vector(r,fam)), y=rs.map(r=>actual(r,kind)-base(r,kind,frozen)), p=X[0].length, means=Array(p).fill(0),sds=Array(p).fill(1);
  for(let j=0;j<p;j++){means[j]=X.reduce((s,a)=>s+a[j],0)/X.length;const v=X.reduce((s,a)=>s+(a[j]-means[j])**2,0)/Math.max(1,X.length-1);sds[j]=Math.sqrt(v)||1}
  const ym=y.reduce((s,v)=>s+v,0)/y.length,A=Array.from({length:p},()=>Array(p).fill(0)),b=Array(p).fill(0);
  for(let i=0;i<X.length;i++){const z=X[i].map((v,j)=>(v-means[j])/sds[j]),yy=y[i]-ym;for(let a=0;a<p;a++){b[a]+=z[a]*yy;for(let q=0;q<p;q++)A[a][q]+=z[a]*z[q]}}
  for(let j=0;j<p;j++)A[j][j]+=lambda;return{means,sds,beta:solve(A,b),intercept:ym,lambda,fam}
}
function correction(m,r){const X=vector(r,m.fam);let y=m.intercept;for(let j=0;j<X.length;j++)y+=m.beta[j]*(X[j]-m.means[j])/m.sds[j];return y}
function choose(train,kind,fam){let best=null;for(const lambda of [1,10,100,1000,10000]){let se=0,c=0;for(const s of [2018,2019,2020,2021,2022]){const tr=train.filter(r=>r.season!==s),te=train.filter(r=>r.season===s);if(!tr.length||!te.length)continue;const m=fitRidge(tr,kind,lambda,fam);for(const r of te){const e=(actual(r,kind)-base(r,kind,frozen))-correction(m,r);se+=e*e;c++}}const rmse=Math.sqrt(se/Math.max(1,c));if(!best||rmse<best.rmse)best={lambda,rmse}}return best}
const erf=x=>{const s=x<0?-1:1,a=Math.abs(x),t=1/(1+0.3275911*a),y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-a*a);return s*y};
const phi=z=>.5*(1+erf(z/Math.SQRT2));
function probMetrics(rs,m,fam){
  let n0=0,brier=0,ll=0,correct=0;const bins=Array.from({length:10},()=>({n:0,p:0,y:0}));
  for(const r of rs){const a=actual(r,"margin"),bb=base(r,"margin",frozen);if(a==null||bb==null)continue;let pm=bb;if(m&&eligible(r,fam))pm+=correction(m,r);const sig=Math.max(6,n(r.fbis?.sigmaMargin)||12);const p=Math.min(.999999,Math.max(.000001,phi(pm/sig))),y=a>0?1:0;n0++;brier+=(p-y)**2;ll+=-(y*Math.log(p)+(1-y)*Math.log(1-p));correct+=((p>=.5)===(y===1))?1:0;const bi=Math.min(9,Math.floor(p*10));bins[bi].n++;bins[bi].p+=p;bins[bi].y+=y}
  let ece=0;for(const b of bins)if(b.n)ece+=(b.n/n0)*Math.abs(b.p/b.n-b.y/b.n);
  return{n:n0,brier:round(brier/n0),logLoss:round(ll/n0),ece:round(ece),winnerAccuracy:round(correct/n0)}
}
function mae(rs,kind,m,fam){let n0=0,b=0,c=0,adj=0;for(const r of rs){const a=actual(r,kind),bb=base(r,kind,frozen);if(a==null||bb==null)continue;let pp=bb;if(m&&eligible(r,fam)){pp+=correction(m,r);adj++}n0++;b+=Math.abs(bb-a);c+=Math.abs(pp-a)}return{n:n0,adjusted:adj,baseMae:round(b/n0),challengerMae:round(c/n0),gain:round((b-c)/n0)}}
function decision(kind,val,con){
  if(kind==="winProbability"){
    const vg=(val.base.brier-val.challenger.brier),vl=(val.base.logLoss-val.challenger.logLoss),cg=(con.base.brier-con.challenger.brier),cl=(con.base.logLoss-con.challenger.logLoss);
    if(vg>0&&vl>0&&cg>0&&cl>0)return"KEEP";if(vg<0&&vl<0&&cg<0&&cl<0)return"REJECT";return"RESEARCH";
  }
  if(val.gain>0&&con.gain>0)return"KEEP";if(val.gain<0&&con.gain<0)return"REJECT";return"RESEARCH";
}
const ab={id:"CBB-TARGET-ABLATION-v1",snapshotId:SNAPSHOT_ID,generatedAt:new Date().toISOString(),rows:rows.length,baseline:{discovery:"2018-22",validation:"2023-24",confirmation:"2025"},families:{}};
for(const fam of FAM){
  const disc=rows.filter(r=>r.season<=2022&&eligible(r,fam)), valRows=rows.filter(r=>[2023,2024].includes(r.season)), conRows=rows.filter(r=>r.season===2025);
  ab.families[fam]={};
  for(const kind of ["margin","total"]){
    const sel=choose(disc,kind,fam),m=fitRidge(disc,kind,sel.lambda,fam),val=mae(valRows,kind,m,fam),con=mae(conRows,kind,m,fam);
    const seasons={};for(const s of [2023,2024,2025])seasons[s]=mae(rows.filter(r=>r.season===s),kind,m,fam);
    ab.families[fam][kind]={lambda:sel.lambda,validation:val,confirmation:con,seasonStability:seasons,decision:decision(kind,val,con)};
    if(kind==="margin"){
      const vb=probMetrics(valRows,null,fam),vc=probMetrics(valRows,m,fam),cb=probMetrics(conRows,null,fam),cc=probMetrics(conRows,m,fam);
      const ps={};for(const s of [2023,2024,2025])ps[s]={base:probMetrics(rows.filter(r=>r.season===s),null,fam),challenger:probMetrics(rows.filter(r=>r.season===s),m,fam)};
      ab.families[fam].winProbability={validation:{base:vb,challenger:vc},confirmation:{base:cb,challenger:cc},seasonStability:ps,decision:decision("winProbability",{base:vb,challenger:vc},{base:cb,challenger:cc})};
    }
  }
}
const snapshot={id:SNAPSHOT_ID,version:"v1",createdAt:new Date().toISOString(),source:{historicalRun:SOURCE_RUN,historicalSha:SOURCE_SHA,benchmarkRun:BENCHMARK_RUN,benchmarkIdentity:"cbb-fbis-native-v2-predictions + cbb-fbis-v2-fit"},featureVersion:"CBB-NCAA-POSSESSION-v1/v1.0.0 + CBB-PIT-FEATURES-v1",pitEligibility:audit.pitEligible,methodology:"All target-game features are prior-game EWMA state only; no target or future game state enters features.",auditRef:"cbb-pit-audit-v1.json",ablationRef:"cbb-target-ablation-v1.json",rowCount:rows.length,excludedAmbiguousMatchedRows:audit.conflicts.ambiguousMatchedRowsExcluded,rows:rows.map(r=>({id:r.id,season:r.season,date:r.date,home:r.home,away:r.away,actualHome:r.actualHome,actualAway:r.actualAway,fbis:r.fbis,homeGames:r.homeGames,awayGames:r.awayGames,priorQa:r.priorQa,families:r.families}))};
writeFileSync(outDir+"/cbb-pit-audit-v1.json",JSON.stringify(audit,null,2));
writeFileSync(outDir+"/cbb-target-ablation-v1.json",JSON.stringify(ab,null,2));
if(audit.pitEligible)writeFileSync(outDir+"/cbb-pit-snapshot-v1.json",JSON.stringify(snapshot));
console.log(JSON.stringify({ok:audit.pitEligible,snapshotId:SNAPSHOT_ID,audit,ablation:ab},null,2));
if(!audit.pitEligible)process.exitCode=2;
