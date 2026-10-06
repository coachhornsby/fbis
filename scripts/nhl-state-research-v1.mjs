import { readFile, writeFile, mkdir } from "node:fs/promises";

const sourcePath = process.argv.find(x=>x.startsWith("--source="))?.split("=")[1] || "data/models/nhl-pro-v2-validation.json";
const outPath = process.argv.find(x=>x.startsWith("--out="))?.split("=")[1] || "data/models/nhl-state-research-v1.json";
const source = JSON.parse(await readFile(sourcePath,"utf8"));
const rows = source.gamePredictions || [];
if (!rows.length) throw new Error("NHL_STATE_RESEARCH_NO_ROWS");

const LEAGUE_SPECIAL_TEAMS_XG = 0.914335;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const round=(v,n=5)=>Number(Number(v).toFixed(n));
function poisson(lambda,k){let p=Math.exp(-lambda);for(let i=1;i<=k;i++)p*=lambda/i;return p;}
function homeWin(h,a){
  const shared=Math.min(0.32,0.10*Math.min(h,a)),lh=Math.max(0.05,h-shared),la=Math.max(0.05,a-shared);
  let hw=0,tie=0;
  for(let x=0;x<=11;x++)for(let y=0;y<=11;y++)for(let z=0;z<=5;z++){
    const p=poisson(lh,x)*poisson(la,y)*poisson(shared,z),hg=x+z,ag=y+z;
    if(hg>ag)hw+=p;else if(hg===ag)tie+=p;
  }
  const ot=1/(1+Math.exp(-(h-a)/0.65));
  return clamp(hw+tie*ot,0.01,0.99);
}
function probability(row,h,a){
  const elo=1/(1+10**(-((Number(row.eloDiff||0)+35)/400)));
  const ensemble=0.78*homeWin(h,a)+0.22*elo;
  return clamp(0.5+0.86*(ensemble-0.5),0.04,0.96);
}
function scheduleAdjustment(row){
  const hd=Number(row.homeRestDays),ad=Number(row.awayRestDays);
  let home=Number.isFinite(hd)&&hd<1.6?-0.10:0;
  let away=Number.isFinite(ad)&&ad<1.6?-0.10:0;
  if(Number.isFinite(hd)&&Number.isFinite(ad)){
    const rd=clamp((hd-ad)*0.018,-0.07,0.07); home+=rd; away-=rd;
  }
  return {home,away};
}
const variants={
  full_v2:r=>({h:r.projHome,a:r.projAway,p:r.homeWinProb}),
  no_goalie:r=>({h:r.projHome-Number(r.goalieVsHome||0),a:r.projAway-Number(r.goalieVsAway||0)}),
  no_finish_deployment_proxy:r=>({h:r.projHome-Number(r.finishHome||0),a:r.projAway-Number(r.finishAway||0)}),
  no_pressure_volume:r=>({h:r.projHome-Number(r.pressureHome||0)-Number(r.shotVolumeHome||0),a:r.projAway-Number(r.pressureAway||0)-Number(r.shotVolumeAway||0)}),
  no_schedule_rest:r=>{const s=scheduleAdjustment(r);return {h:r.projHome-s.home,a:r.projAway-s.away};},
  no_special_teams:r=>({h:r.projHome-0.20*(Number(r.specialTeamsHome??LEAGUE_SPECIAL_TEAMS_XG)-LEAGUE_SPECIAL_TEAMS_XG),a:r.projAway-0.20*(Number(r.specialTeamsAway??LEAGUE_SPECIAL_TEAMS_XG)-LEAGUE_SPECIAL_TEAMS_XG)}),
};
variants.no_active_context_families=r=>{
  const s=scheduleAdjustment(r);
  return {
    h:r.projHome-Number(r.goalieVsHome||0)-Number(r.finishHome||0)-Number(r.pressureHome||0)-Number(r.shotVolumeHome||0)-0.20*(Number(r.specialTeamsHome??LEAGUE_SPECIAL_TEAMS_XG)-LEAGUE_SPECIAL_TEAMS_XG)-s.home,
    a:r.projAway-Number(r.goalieVsAway||0)-Number(r.finishAway||0)-Number(r.pressureAway||0)-Number(r.shotVolumeAway||0)-0.20*(Number(r.specialTeamsAway??LEAGUE_SPECIAL_TEAMS_XG)-LEAGUE_SPECIAL_TEAMS_XG)-s.away
  };
};

function metrics(sample,fn){
  let margin=0,total=0,winner=0,brier=0,home=0,away=0;
  for(const r of sample){
    const q=fn(r),h=q.h,a=q.a,p=q.p??probability(r,h,a),am=r.actualHomeGoals-r.actualAwayGoals,at=r.actualHomeGoals+r.actualAwayGoals;
    margin+=Math.abs((h-a)-am); total+=Math.abs((h+a)-at); home+=Math.abs(h-r.actualHomeGoals); away+=Math.abs(a-r.actualAwayGoals);
    const y=r.actualHomeGoals>r.actualAwayGoals?1:0; winner+=(p>=0.5)===Boolean(y)?1:0; brier+=(p-y)**2;
  }
  const n=sample.length;
  return {n,marginMae:round(margin/n),totalMae:round(total/n),homeGoalsMae:round(home/n),awayGoalsMae:round(away/n),winnerAccuracy:round(winner/n),brier:round(brier/n)};
}
function evaluate(sample){
  const out={}; for(const [name,fn] of Object.entries(variants)) out[name]=metrics(sample,fn);
  const base=out.full_v2;
  for(const [name,m] of Object.entries(out)){
    m.deltaVsFull={marginMae:round(m.marginMae-base.marginMae),totalMae:round(m.totalMae-base.totalMae),winnerAccuracy:round(m.winnerAccuracy-base.winnerAccuracy),brier:round(m.brier-base.brier)};
    if(name!=="full_v2"){
      const d=m.deltaVsFull;
      m.familyHelpsScoreModel = d.marginMae>0 || d.totalMae>0;
      m.familyHelpsProbability = d.brier>0;
    }
  }
  return out;
}
const bySeason={};
for(const season of [...new Set(rows.map(r=>String(r.season)))]) bySeason[season]=evaluate(rows.filter(r=>String(r.season)===season));

const aggregate=evaluate(rows);
const ranking=Object.entries(aggregate)
  .filter(([k])=>k!=="full_v2"&&k!=="no_active_context_families")
  .map(([name,m])=>({family:name.replace(/^no_/,""),scoreDamageWhenRemoved:round(m.deltaVsFull.marginMae+m.deltaVsFull.totalMae),brierDamageWhenRemoved:round(m.deltaVsFull.brier),winnerDamageWhenRemoved:round(-m.deltaVsFull.winnerAccuracy)}))
  .sort((a,b)=>b.scoreDamageWhenRemoved-a.scoreDamageWhenRemoved);

const report={
  modelId:"NHL-STATE-RESEARCH-v1",
  generatedAt:new Date().toISOString(),
  sourceModel:source.modelId,
  sourceVersion:source.version,
  sourceGeneratedAt:source.generatedAt,
  pointInTime:Boolean(source.pointInTime),
  marketInformed:false,
  method:"leave-one-family-out ablation on frozen NHL-PRO-v2 PIT predictions; no market inputs; no retraining",
  sampleGames:rows.length,
  aggregate,
  bySeason,
  ranking,
  findings:{
    scoreModelKeep:ranking.filter(x=>x.scoreDamageWhenRemoved>0).map(x=>x.family),
    probabilityReview:ranking.filter(x=>x.brierDamageWhenRemoved<=0).map(x=>x.family),
    note:"Ablation measures marginal value of currently active v2 context families. Historical line/linemate/replacement overlays remain a separate challenger because they are not yet embedded in the frozen v2 validation rows."
  },
  governance:{
    canPromoteAutomatically:false,
    canAuthorizeWager:false,
    stakingAuthorized:false,
    nextGate:"Build PIT historical deployment/linemate/replacement challenger and compare against full_v2 with the same folds."
  }
};
await mkdir(outPath.split("/").slice(0,-1).join("/")||".",{recursive:true});
await writeFile(outPath,JSON.stringify(report,null,2)+"\n","utf8");
console.log(JSON.stringify({sampleGames:report.sampleGames,ranking:report.ranking,findings:report.findings},null,2));
