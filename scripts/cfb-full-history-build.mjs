#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";

const BASE=process.env.FBIS_BASE||"https://fbis-myz.pages.dev";
const SECRET=process.env.HARVEST_SECRET||"";
const START=Number(process.env.CFB_HISTORY_START||2000);
const END=Number(process.env.CFB_HISTORY_END||2026);
const CHUNK=Number(process.env.CFB_HISTORY_CHUNK_WEEKS||4);
if(!SECRET){console.error("HARVEST_SECRET missing");process.exit(2);}
mkdirSync("artifacts/cfb-history",{recursive:true});

const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const num=(v)=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null;};
const key=(s)=>String(s||"").trim().toLowerCase();
const safe=(s)=>String(s??"").replaceAll('"','""');
const csv=(rows,cols)=>[cols.join(","),...rows.map(r=>cols.map(c=>{
  const v=r[c]; if(v==null)return ""; if(typeof v==="number")return String(v);
  return '"'+safe(typeof v==="string"?v:JSON.stringify(v))+'"';
}).join(","))].join("\n")+"\n";

async function callChunk(params){
  const u=new URL("/api/cfb-history-chunk",BASE);
  for(const [k,v] of Object.entries(params)) if(v!=null) u.searchParams.set(k,String(v));
  let lastStatus=0,lastBody={};
  for(let attempt=1;attempt<=5;attempt++){
    const res=await fetch(u,{headers:{"x-harvest-secret":SECRET,accept:"application/json"}});
    const body=await res.json().catch(()=>({}));
    lastStatus=res.status;lastBody=body;
    if(res.ok&&body.ok)return body;
    const retryable=res.status===429||res.status>=500||res.status===0;
    console.error(JSON.stringify({phase:"chunk-retry",attempt,status:res.status,error:body.error||null,params}));
    if(!retryable||attempt===5)break;
    await sleep(attempt*5000);
  }
  throw new Error(`chunk failed ${lastStatus} ${u.search}: ${lastBody.error||"unknown"} ${JSON.stringify(lastBody.failures||[])}`);
}
async function collegeHealth(){
  const u=new URL("/api/college",BASE);u.searchParams.set("job","college-health");u.searchParams.set("trigger","workflow_dispatch");
  const res=await fetch(u,{headers:{"x-harvest-secret":SECRET,accept:"application/json"}});
  const body=await res.json().catch(()=>({}));
  return body;
}
function flattenRaw(prefix,obj,out={}){
  if(obj==null)return out;
  for(const [k,v] of Object.entries(obj)){
    const nk=prefix?`${prefix}_${k}`:k;
    if(v&&typeof v==="object"&&!Array.isArray(v)) flattenRaw(nk,v,out);
    else if(!Array.isArray(v)) out[nk]=v;
  }
  return out;
}
function lineHomeSpread(l){
  const s=num(l.spread); if(s==null)return null;
  return s; // CFBD spread is the home-team spread; formattedSpread preserved for verification.
}
function median(xs){
  const a=xs.map(num).filter(Number.isFinite).sort((a,b)=>a-b);if(!a.length)return null;
  const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function byGameTeam(rows){
  const m=new Map();
  for(const r of rows||[]){
    const gid=String(r.gameId||""); const t=key(r.team); if(!gid||!t)continue;
    m.set(gid+"|"+t,r);
  }
  return m;
}
function getRawMetric(row,paths=[]){
  const raw=row?.raw||row||{};
  for(const p of paths){
    let x=raw; for(const k of p.split(".")){x=x?.[k];}
    const n=num(x); if(n!=null)return n;
  }
  return null;
}
function gameTeamMetricRows(chunk){
  const ppa=byGameTeam(chunk.ppa);
  const adv=byGameTeam(chunk.advanced);
  const plays=byGameTeam(chunk.playAggregates);
  const drives=byGameTeam(chunk.driveAggregates);
  const teams=new Set([...ppa.keys(),...adv.keys(),...plays.keys(),...drives.keys()]);
  const out=[];
  for(const k of teams){
    const [gid,...rest]=k.split("|");const team=rest.join("|");
    const pr=ppa.get(k),ar=adv.get(k),pl=plays.get(k),dr=drives.get(k);
    out.push({
      gameId:gid,team,
      ppa_off:getRawMetric(pr,["offense.overall"]),
      ppa_pass:getRawMetric(pr,["offense.passing"]),
      ppa_rush:getRawMetric(pr,["offense.rushing"]),
      ppa_def:getRawMetric(pr,["defense.overall"]),
      ppa_def_pass:getRawMetric(pr,["defense.passing"]),
      ppa_def_rush:getRawMetric(pr,["defense.rushing"]),
      success_off:getRawMetric(ar,["offense.successRate","offense.success_rate"]),
      success_def:getRawMetric(ar,["defense.successRate","defense.success_rate"]),
      explosiveness_off:getRawMetric(ar,["offense.explosiveness"]),
      explosiveness_def:getRawMetric(ar,["defense.explosiveness"]),
      havoc_off:getRawMetric(ar,["offense.havoc.total","offense.havoc"]),
      havoc_def:getRawMetric(ar,["defense.havoc.total","defense.havoc"]),
      line_yards_off:getRawMetric(ar,["offense.lineYards"]),
      line_yards_def:getRawMetric(ar,["defense.lineYards"]),
      points_per_opp_off:getRawMetric(ar,["offense.pointsPerOpportunity"]),
      points_per_opp_def:getRawMetric(ar,["defense.pointsPerOpportunity"]),
      field_pos_off:getRawMetric(ar,["offense.fieldPosition.averageStart"]),
      field_pos_def:getRawMetric(ar,["defense.fieldPosition.averageStart"]),
      plays:getRawMetric(ar,["offense.plays"])??num(pl?.plays),
      play_ppa:num(pl?.ppaPerPlay),early_down_ppa:num(pl?.earlyDownPpa),play_pass_ppa:num(pl?.passPpa),play_rush_ppa:num(pl?.rushPpa),
      play_explosive_rate:num(pl?.explosiveRate),points_per_drive:num(dr?.pointsPerDrive),yards_per_drive:num(dr?.yardsPerDrive),plays_per_drive:num(dr?.playsPerDrive)
    });
  }
  return out;
}
function indexStatic(rows,nameField="team"){
  const m=new Map();for(const r of rows||[]){const t=key(r?.[nameField]??r?.school);if(t)m.set(t,r);}return m;
}
function priorFeatureMaps(stat){
  return {
    sp:indexStatic(stat?.prior?.sp),
    fpi:indexStatic(stat?.prior?.fpi),
    srs:indexStatic(stat?.prior?.srs),
    recruiting:indexStatic(stat?.prior?.recruiting),
    talent:indexStatic(stat?.preseason?.talent),
    returning:indexStatic(stat?.preseason?.returning)
  };
}
function staticFeatures(maps,team){
  const t=key(team),sp=maps.sp.get(t),fpi=maps.fpi.get(t),srs=maps.srs.get(t),rec=maps.recruiting.get(t),tal=maps.talent.get(t),ret=maps.returning.get(t);
  return {
    prior_sp:num(sp?.rating),prior_sp_off:num(sp?.offense?.rating),prior_sp_def:num(sp?.defense?.rating),prior_sp_st:num(sp?.specialTeams?.rating),
    prior_fpi:num(fpi?.fpi),prior_fpi_off:num(fpi?.efficiencies?.offense),prior_fpi_def:num(fpi?.efficiencies?.defense),
    prior_srs:num(srs?.rating),talent:num(tal?.talent),recruiting_points:num(rec?.points),recruiting_rank:num(rec?.rank),
    returning_ppa:num(ret?.percentPPA??ret?.percentPpa),returning_usage:num(ret?.usage)
  };
}
function coreByWeek(rows){
  const m=new Map();
  for(const r of rows||[]){const t=key(r.team),w=num(r.throughWeek);if(!t||w==null)continue;const a=m.get(t)||[];a.push(r);m.set(t,a);}
  for(const a of m.values())a.sort((x,y)=>Number(x.throughWeek)-Number(y.throughWeek));
  return m;
}
function coreBefore(map,team,week){
  const a=map.get(key(team))||[]; let best=null;
  for(const r of a) if(Number(r.throughWeek)<Number(week)) best=r;
  return best;
}
function eloByTarget(rows){
  const m=new Map();for(const r of rows||[]){const w=num(r.targetWeek),t=key(r.team);if(w!=null&&t)m.set(w+"|"+t,r);}return m;
}
function weatherByGame(rows){
  const m=new Map();for(const r of rows||[]){const gid=String(r.id??r.gameId??r.game_id??"");if(gid)m.set(gid,r);}return m;
}
function addRolling(teamGames){
  const metrics=["ppa_off","ppa_pass","ppa_rush","ppa_def","ppa_def_pass","ppa_def_rush","success_off","success_def","explosiveness_off","explosiveness_def","havoc_def","line_yards_off","line_yards_def","points_per_opp_off","points_per_opp_def","play_ppa","early_down_ppa","play_pass_ppa","play_rush_ppa","play_explosive_rate","points_per_drive","yards_per_drive","plays_per_drive"];
  const byTeam=new Map();
  for(const r of teamGames){const a=byTeam.get(key(r.team))||[];a.push(r);byTeam.set(key(r.team),a);}
  for(const a of byTeam.values()){
    a.sort((x,y)=>new Date(x.startDate)-new Date(y.startDate)||Number(x.gameId)-Number(y.gameId));
    for(let i=0;i<a.length;i++){
      const prior=a.slice(0,i), seasonPrior=prior.filter(x=>x.season===a[i].season),l5=prior.slice(-5);
      for(const m of metrics){
        const mean=(rows)=>{const xs=rows.map(x=>num(x[m])).filter(Number.isFinite);return xs.length?xs.reduce((u,v)=>u+v,0)/xs.length:null;};
        a[i]["pregame_season_"+m]=mean(seasonPrior);a[i]["pregame_l5_"+m]=mean(l5);
      }
    }
  }
}
function mergeLineGames(lines){
  const m=new Map();for(const l of lines||[]){const a=m.get(l.gameId)||[];a.push(l);m.set(l.gameId,a);}return m;
}

const health=await collegeHealth();
const quota=health?.d1?.quota||health?.quota||null;
console.error(JSON.stringify({phase:"quota",quota}));
if(quota?.remaining!=null&&Number(quota.remaining)<2500){
  console.error("Insufficient CFBD quota headroom for safe full-history pull");process.exit(3);
}

const coverage={};
const allGames=[];const allLines=[];const chunks=[];const staticBySeason=new Map();
for(let year=START;year<=END;year++){
  const cov=await callChunk({year,weekStart:0,weekEnd:25,seasonType:"regular",includeStatic:1,coverageOnly:1});
  coverage[year]={regular:cov.counts,providerDiagnostics:cov.providerDiagnostics||[]};
  allGames.push(...cov.games);allLines.push(...cov.lines);staticBySeason.set(year,cov);
  if(year>=2022 && cov.counts.games===0){
    throw new Error(`Recent CFB season ${year} returned zero games; refusing incomplete history artifact`);
  }
  const probe=await callChunk({year,weekStart:1,weekEnd:1,seasonType:"regular",includeStatic:0,coverageOnly:0});
  coverage[year].probe=probe.counts;
  const rich=(probe.counts.ppa||probe.counts.advanced||probe.counts.plays||probe.counts.drives||probe.counts.players)>0;
  console.error(JSON.stringify({phase:"coverage",year,games:cov.counts.games,lines:cov.counts.lines,rich,probe:probe.counts}));
  if(cov.counts.games>0&&rich){
    for(let a=0;a<=20;a+=CHUNK){
      const b=Math.min(20,a+CHUNK-1);
      const c=await callChunk({year,weekStart:a,weekEnd:b,seasonType:"regular",includeStatic:0,coverageOnly:0});
      chunks.push(c);await sleep(100);
    }
    const pcov=await callChunk({year,weekStart:1,weekEnd:25,seasonType:"postseason",includeStatic:0,coverageOnly:1});
    coverage[year].postseason=pcov.counts;allGames.push(...pcov.games);allLines.push(...pcov.lines);
    if(pcov.counts.games>0){
      for(let a=1;a<=25;a+=CHUNK){
        const b=Math.min(25,a+CHUNK-1);
        const c=await callChunk({year,weekStart:a,weekEnd:b,seasonType:"postseason",includeStatic:0,coverageOnly:0});
        chunks.push(c);await sleep(100);
      }
    }
  }else if(cov.counts.games>0){
    const pcov=await callChunk({year,weekStart:1,weekEnd:25,seasonType:"postseason",includeStatic:0,coverageOnly:1});
    coverage[year].postseason=pcov.counts;allGames.push(...pcov.games);allLines.push(...pcov.lines);
  }
}

const gameMap=new Map();for(const g of allGames)gameMap.set(g.gameId,g);
const linesUnique=new Map();for(const l of allLines)linesUnique.set([l.gameId,l.provider,l.spread,l.overUnder,l.openingSpread,l.openingOverUnder,l.homeMoneyline,l.awayMoneyline].join("|"),l);
const allMetric=[];
const eloRows=[];
for(const c of chunks){allMetric.push(...gameTeamMetricRows(c));eloRows.push(...(c.elo||[]));}
const metricMap=new Map();for(const r of allMetric)metricMap.set(r.gameId+"|"+key(r.team),r);

const teamGames=[];
for(const g of gameMap.values()){
  for(const side of ["home","away"]){
    const team=g[side+"Team"];if(!team)continue;
    const m=metricMap.get(g.gameId+"|"+key(team))||{};
    teamGames.push({gameId:g.gameId,season:Number(g.season),week:Number(g.week),seasonType:g.seasonType,startDate:g.startDate,team,side,...m});
  }
}
addRolling(teamGames);
const teamGameMap=new Map(teamGames.map(r=>[r.gameId+"|"+key(r.team),r]));
const lineMap=mergeLineGames([...linesUnique.values()]);
const eloMap=eloByTarget(eloRows);
const rows=[];
for(const g of [...gameMap.values()].sort((a,b)=>Number(a.season)-Number(b.season)||Number(a.week)-Number(b.week)||String(a.gameId).localeCompare(String(b.gameId)))){
  const stat=staticBySeason.get(Number(g.season))||{};
  const maps=priorFeatureMaps(stat); const cores=coreByWeek(stat.core||[]); const weather=weatherByGame(stat.weather||[]);
  const h=teamGameMap.get(g.gameId+"|"+key(g.homeTeam))||{},a=teamGameMap.get(g.gameId+"|"+key(g.awayTeam))||{};
  const hl=(lineMap.get(g.gameId)||[]), spreads=hl.map(lineHomeSpread).filter(Number.isFinite), totals=hl.map(x=>num(x.overUnder)).filter(Number.isFinite);
  const openSpreads=hl.map(x=>num(x.openingSpread)).filter(Number.isFinite),openTotals=hl.map(x=>num(x.openingOverUnder)).filter(Number.isFinite);
  const hm=hl.map(x=>num(x.homeMoneyline)).filter(Number.isFinite),am=hl.map(x=>num(x.awayMoneyline)).filter(Number.isFinite);
  const hc=coreBefore(cores,g.homeTeam,g.week),ac=coreBefore(cores,g.awayTeam,g.week);
  const he=eloMap.get(Number(g.week)+"|"+key(g.homeTeam)),ae=eloMap.get(Number(g.week)+"|"+key(g.awayTeam));
  const wx=weather.get(g.gameId)||{};
  const row={
    game_id:g.gameId,season:g.season,week:g.week,season_type:g.seasonType,start_date:g.startDate,neutral_site:g.neutralSite?1:0,conference_game:g.conferenceGame?1:0,
    home_team:g.homeTeam,away_team:g.awayTeam,home_conference:g.homeConference,away_conference:g.awayConference,home_classification:g.homeClassification,away_classification:g.awayClassification,
    home_score:g.homePoints,away_score:g.awayPoints,home_margin:(num(g.homePoints)!=null&&num(g.awayPoints)!=null)?num(g.homePoints)-num(g.awayPoints):null,final_total:(num(g.homePoints)!=null&&num(g.awayPoints)!=null)?num(g.homePoints)+num(g.awayPoints):null,
    market_home_spread_median:median(spreads),market_total_median:median(totals),market_open_home_spread_median:median(openSpreads),market_open_total_median:median(openTotals),market_home_ml_median:median(hm),market_away_ml_median:median(am),market_provider_count:new Set(hl.map(x=>x.provider).filter(Boolean)).size,
    home_elo:num(he?.elo),away_elo:num(ae?.elo),home_core:num(hc?.overall),away_core:num(ac?.overall),home_core_off:num(hc?.offense),away_core_off:num(ac?.offense),home_core_def:num(hc?.defense),away_core_def:num(ac?.defense),
    temperature:num(wx.temperature),wind_speed:num(wx.windSpeed??wx.wind_speed),humidity:num(wx.humidity),weather_condition:wx.weatherCondition??wx.condition??null,
    ...Object.fromEntries(Object.entries(staticFeatures(maps,g.homeTeam)).map(([k,v])=>["home_"+k,v])),
    ...Object.fromEntries(Object.entries(staticFeatures(maps,g.awayTeam)).map(([k,v])=>["away_"+k,v])),
  };
  const metricNames=new Set([...Object.keys(h),...Object.keys(a)].filter(k=>k.startsWith("pregame_")));
  for(const m of metricNames){row["home_"+m]=h[m]??null;row["away_"+m]=a[m]??null;const hv=num(h[m]),av=num(a[m]);row["diff_"+m]=(hv!=null&&av!=null)?hv-av:null;row["sum_"+m]=(hv!=null&&av!=null)?hv+av:null;}
  row.training_eligible=(row.home_score!=null&&row.away_score!=null&&String(g.homeClassification||"").toLowerCase()==="fbs")?1:0;
  rows.push(row);
}

const marketRows=[...linesUnique.values()].map(l=>({
  game_id:l.gameId,provider:l.provider,home_team:l.homeTeam,away_team:l.awayTeam,home_spread:lineHomeSpread(l),formatted_spread:l.formattedSpread,
  opening_home_spread:num(l.openingSpread),total:num(l.overUnder),opening_total:num(l.openingOverUnder),home_moneyline:num(l.homeMoneyline),away_moneyline:num(l.awayMoneyline)
}));
const cols=[...new Set(rows.flatMap(r=>Object.keys(r)))];
const marketCols=[...new Set(marketRows.flatMap(r=>Object.keys(r)))];
writeFileSync("artifacts/cfb-history/cfb_game_training_full_history.csv",csv(rows,cols));
writeFileSync("artifacts/cfb-history/cfb_market_lines_all_providers.csv",csv(marketRows,marketCols));
writeFileSync("artifacts/cfb-history/cfb_history_coverage.json",JSON.stringify({generatedAt:new Date().toISOString(),start:START,end:END,coverage},null,2));

const finals=rows.filter(r=>r.home_score!=null&&r.away_score!=null);
const qa={
  generatedAt:new Date().toISOString(),startSeason:START,endSeason:END,
  gameRows:rows.length,finalGames:finals.length,trainingEligible:rows.filter(r=>r.training_eligible===1).length,
  duplicateGameIds:rows.length-new Set(rows.map(r=>r.game_id)).size,
  marketLineRows:marketRows.length,gamesWithSpread:rows.filter(r=>r.market_home_spread_median!=null).length,gamesWithTotal:rows.filter(r=>r.market_total_median!=null).length,
  gamesWithOpeningSpread:rows.filter(r=>r.market_open_home_spread_median!=null).length,gamesWithOpeningTotal:rows.filter(r=>r.market_open_total_median!=null).length,
  seasonsWithGames:[...new Set(rows.map(r=>Number(r.season)))].sort((a,b)=>a-b),
  seasonsWithMarket:[...new Set(rows.filter(r=>r.market_home_spread_median!=null||r.market_total_median!=null).map(r=>Number(r.season)))].sort((a,b)=>a-b),
  seasonsWithRichFeatures:[...new Set(rows.filter(r=>Object.keys(r).some(k=>k.startsWith("home_pregame_")&&r[k]!=null)).map(r=>Number(r.season)))].sort((a,b)=>a-b),
  temporalIntegrity:"Rolling features use only prior chronological games; CORE is restricted to throughWeek < target week; prior SP/FPI/SRS/recruiting use season-1; Elo uses prior week; market fields are evaluation-only.",
  marketPolicy:"All provider records retained separately. Canonical benchmark uses median of available CFBD providers per game; spread is CFBD home-team spread. Opening lines are retained separately."
};
writeFileSync("artifacts/cfb-history/cfb_history_qa.json",JSON.stringify(qa,null,2));
const recentMarket=rows.filter(r=>Number(r.season)>=2022&&(r.market_home_spread_median!=null||r.market_total_median!=null)).length;
const recentRich=rows.filter(r=>Number(r.season)>=2022&&Object.keys(r).some(k=>k.startsWith("home_pregame_")&&r[k]!=null)).length;
if(recentMarket===0) throw new Error("Recent CFB market coverage is zero; refusing incomplete history artifact");
if(recentRich===0) throw new Error("Recent CFB rich-feature coverage is zero; refusing incomplete history artifact");
console.log(JSON.stringify(qa,null,2));
