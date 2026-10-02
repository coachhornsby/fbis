import { mkdirSync, writeFileSync } from "node:fs";
import { cbbRatingsV1 } from "../functions/lib/cbbRatings.js";
import { mapSourceTeam } from "../functions/lib/collegeIdentity.js";

const BASE = process.env.FBIS_BASE || "https://fbis-myz.pages.dev";
const SECRET = process.env.HARVEST_SECRET || "";
const SEASONS = String(process.env.CBB_WF_SEASONS || "2021,2022,2023,2024,2025")
  .split(",").map(Number).filter(Number.isFinite);
const LEAGUE_PPG = 72;
const PRIOR_GAMES = 5;

if (!SECRET) throw new Error("HARVEST_SECRET required");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round1 = (n) => Math.round(Number(n) * 10) / 10;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

function keyName(v) {
  return String(v || "").toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g," ").trim();
}

function canonicalKey(name, season) {
  const mapped = mapSourceTeam("cbb", { team:name, school:name }, season);
  return mapped.ok ? mapped.canonicalId : `name:${keyName(name)}`;
}

function dateEt(iso) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone:"America/New_York", year:"numeric", month:"2-digit", day:"2-digit"
  }).formatToParts(d);
  const m = Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return `${m.year}-${m.month}-${m.day}`;
}

function shiftDate(date, delta) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate()+delta);
  return d.toISOString().slice(0,10);
}

async function source(kind, params={}) {
  const u = new URL("/api/cbb-walkforward-source", BASE);
  u.searchParams.set("kind",kind);
  for (const [k,v] of Object.entries(params)) if(v != null) u.searchParams.set(k,String(v));
  const res = await fetch(u,{headers:{"x-harvest-secret":SECRET,accept:"application/json"}});
  const body = await res.json().catch(()=>null);
  if(!res.ok || !body?.ok) throw new Error(`${kind} failed HTTP ${res.status}: ${body?.error || "unknown"}`);
  return body;
}

function monthWindows(season) {
  const months = [
    [season,10],[season,11],[season,12],
    [season+1,1],[season+1,2],[season+1,3],[season+1,4],
  ];
  return months.map(([y,m])=>{
    const start=`${y}-${String(m).padStart(2,"0")}-01T00:00:00Z`;
    const nextM=m===12?1:m+1, nextY=m===12?y+1:y;
    const endDate=new Date(Date.UTC(nextY,nextM-1,1)-1).toISOString();
    return {start,end:endDate};
  });
}

async function loadGames(season) {
  const all=[];
  for(const w of monthWindows(season)){
    const res=await source("games",{season,start:w.start,end:w.end});
    all.push(...(res.rows||[]));
    await sleep(60);
  }
  const byId=new Map(all.map(g=>[String(g.id),g]));
  return [...byId.values()].sort((a,b)=>Date.parse(a.startDate)-Date.parse(b.startDate));
}

function parseCsv(text) {
  const lines=String(text).split(/\r?\n/).filter(Boolean);
  if(!lines.length) return [];
  const parse=(line)=>{
    const out=[]; let cur=""; let q=false;
    for(let i=0;i<line.length;i++){
      const ch=line[i];
      if(ch==='"'){
        if(q && line[i+1]==='"'){cur+='"';i++;} else q=!q;
      } else if(ch==="," && !q){out.push(cur);cur="";} else cur+=ch;
    }
    out.push(cur); return out;
  };
  const h=parse(lines[0]).map(x=>x.trim());
  return lines.slice(1).map(line=>{
    const cols=parse(line); const row={};
    h.forEach((k,i)=>{if(k) row[k]=cols[i]??"";});
    return row;
  });
}

async function loadTorvikEndingSeason(endingYear) {
  if(![2022,2023].includes(Number(endingYear))) return {available:false,reason:"public-daily-archive-not-available-in-current-mirror",byDate:new Map()};
  const url=`https://raw.githubusercontent.com/andreweatherman/toRvik-data/main/ratings/archive/by_year/full_${endingYear}.csv`;
  const res=await fetch(url,{headers:{"User-Agent":"FBIS-CBB-Research/1.0"}});
  if(!res.ok) return {available:false,reason:`HTTP ${res.status}`,byDate:new Map()};
  const rows=parseCsv(await res.text());
  const byDate=new Map();
  for(const r of rows){
    const date=String(r.date||"").slice(0,10);
    const team=r.team;
    const adjOe=num(r.adj_o), adjDe=num(r.adj_d), tempo=num(r.adj_tempo);
    if(!date||!team||adjOe==null||adjDe==null) continue;
    if(!byDate.has(date)) byDate.set(date,[]);
    byDate.get(date).push({team,adjOe,adjDe,tempo});
  }
  return {available:true,byDate,dates:[...byDate.keys()].sort(),n:rows.length};
}

function latestTorvikRows(torvik, cutoff) {
  if(!torvik?.available) return [];
  let best=null;
  for(const d of torvik.dates){ if(d<=cutoff) best=d; else break; }
  return best ? torvik.byDate.get(best)||[] : [];
}

function indexRatings(rows, season) {
  const map=new Map();
  for(const r of rows||[]){
    const k=canonicalKey(r.team,season);
    map.set(k,r);
    map.set(`name:${keyName(r.team)}`,r);
  }
  return map;
}

function getRating(index, team, season) {
  return index.get(canonicalKey(team,season)) || index.get(`name:${keyName(team)}`) || null;
}

function rollingProjection(game, states) {
  const hk=canonicalKey(game.homeTeam,game.season), ak=canonicalKey(game.awayTeam,game.season);
  const hs=states.get(hk)||{n:0,pf:0,pa:0}, as=states.get(ak)||{n:0,pf:0,pa:0};
  const avg=(sum,n)=>(sum+LEAGUE_PPG*PRIOR_GAMES)/(n+PRIOR_GAMES);
  const hOff=avg(hs.pf,hs.n), hDef=avg(hs.pa,hs.n);
  const aOff=avg(as.pf,as.n), aDef=avg(as.pa,as.n);
  const hca=game.neutralSite?0:3.5;
  const home=(hOff+aDef)/2+hca/2;
  const away=(aOff+hDef)/2-hca/2;
  return {home:round1(home),away:round1(away),margin:round1(home-away),total:round1(home+away),evidence:{homeGames:hs.n,awayGames:as.n}};
}

function updateState(game,states){
  const hk=canonicalKey(game.homeTeam,game.season), ak=canonicalKey(game.awayTeam,game.season);
  const hs=states.get(hk)||{n:0,pf:0,pa:0}, as=states.get(ak)||{n:0,pf:0,pa:0};
  hs.n++; hs.pf+=game.homePoints; hs.pa+=game.awayPoints;
  as.n++; as.pf+=game.awayPoints; as.pa+=game.homePoints;
  states.set(hk,hs); states.set(ak,as);
}

function ratingProjection(game,home,away){
  if(!home||!away) return null;
  const ht=num(home.adjTempo ?? home.tempo), at=num(away.adjTempo ?? away.tempo);
  if(ht==null||at==null) return null;
  const p=cbbRatingsV1({neutralSite:game.neutralSite},{
    homeAdjOe:home.adjOe,homeAdjDe:home.adjDe,homeTempo:ht,
    awayAdjOe:away.adjOe,awayAdjDe:away.adjDe,awayTempo:at,
  });
  return p?.ok ? {home:p.home,away:p.away,margin:p.margin,total:p.total} : null;
}

function blend(...projections){
  const p=projections.filter(Boolean);
  if(!p.length) return null;
  const home=p.reduce((s,x)=>s+x.home,0)/p.length;
  const away=p.reduce((s,x)=>s+x.away,0)/p.length;
  return {home:round1(home),away:round1(away),margin:round1(home-away),total:round1(home+away)};
}

function metrics(rows, key){
  const use=rows.filter(r=>r[key]);
  if(!use.length) return {n:0,marginMae:null,totalMae:null,winnerAccuracy:null};
  let me=0,te=0,w=0;
  for(const r of use){
    const p=r[key], am=r.actualHome-r.actualAway, at=r.actualHome+r.actualAway;
    me+=Math.abs(p.margin-am); te+=Math.abs(p.total-at);
    if((p.margin>0)===(am>0)) w++;
  }
  return {n:use.length,marginMae:round1(me/use.length),totalMae:round1(te/use.length),winnerAccuracy:Math.round((w/use.length)*1000)/10};
}

function fairMetrics(rows, keys){
  const common=rows.filter(r=>keys.every(k=>r[k]));
  return Object.fromEntries(keys.map(k=>[k,metrics(common,k)]));
}

const allRows=[];
const coverage=[];
for(const season of SEASONS){
  const games=await loadGames(season);
  const ending=season+1;
  const torvik=await loadTorvikEndingSeason(ending);
  const preseason=await source("kenpom-preseason",{season:ending}).catch(()=>({rows:[]}));
  const preseasonIndex=indexRatings(preseason.rows||[],season);
  const states=new Map();
  const byGameDate=new Map();
  for(const g of games){
    const d=dateEt(g.startDate);
    if(!byGameDate.has(d)) byGameDate.set(d,[]);
    byGameDate.get(d).push(g);
  }
  const dates=[...byGameDate.keys()].sort();
  let kpMatched=0,tvMatched=0;
  for(const gameDate of dates){
    const cutoff=shiftDate(gameDate,-1);
    const kp=await source("kenpom-archive",{date:cutoff}).catch(()=>({rows:[]}));
    const kpIndex=indexRatings(kp.rows?.length?kp.rows:preseason.rows||[],season);
    const tvRows=latestTorvikRows(torvik,cutoff);
    const tvIndex=indexRatings(tvRows,season);
    for(const g of byGameDate.get(gameDate)){
      const baseline=rollingProjection(g,states);
      const kh=getRating(kpIndex,g.homeTeam,season), ka=getRating(kpIndex,g.awayTeam,season);
      const th=getRating(tvIndex,g.homeTeam,season), ta=getRating(tvIndex,g.awayTeam,season);
      const kenpom=ratingProjection(g,kh,ka);
      const torvikP=ratingProjection(g,th,ta);
      if(kenpom) kpMatched++;
      if(torvikP) tvMatched++;
      const row={
        id:g.id,season,date:gameDate,home:g.homeTeam,away:g.awayTeam,neutral:g.neutralSite,
        actualHome:g.homePoints,actualAway:g.awayPoints,
        cbbd:baseline,
        torvik:torvikP,
        kenpom,
        cbbdTorvik:torvikP?blend(baseline,torvikP):null,
        cbbdKenpom:kenpom?blend(baseline,kenpom):null,
        fullStack:torvikP&&kenpom?blend(baseline,torvikP,kenpom):null,
      };
      allRows.push(row);
      updateState(g,states);
    }
    await sleep(120);
  }
  coverage.push({season,games:games.length,kenpomMatched:kpMatched,torvikMatched:tvMatched,torvikArchive:torvik.available,torvikReason:torvik.reason||null});
}

const aggregate={
  cbbd:metrics(allRows,"cbbd"),
  cbbdKenpom:metrics(allRows,"cbbdKenpom"),
  cbbdTorvik:metrics(allRows,"cbbdTorvik"),
  fullStack:metrics(allRows,"fullStack"),
};
const kenpomFair=fairMetrics(allRows,["cbbd","cbbdKenpom"]);
const threeWayFair=fairMetrics(allRows,["cbbd","cbbdTorvik","fullStack"]);
const bySeason=Object.fromEntries(SEASONS.map(s=>{
  const rows=allRows.filter(r=>r.season===s);
  return [s,{
    cbbd:metrics(rows,"cbbd"),
    cbbdKenpom:metrics(rows,"cbbdKenpom"),
    cbbdTorvik:metrics(rows,"cbbdTorvik"),
    fullStack:metrics(rows,"fullStack"),
  }];
}));

if (!allRows.length) throw new Error("cbb-walkforward-empty-sample");

const report={
  ok:true,
  generatedAt:new Date().toISOString(),
  methodology:{
    temporalCutoff:"KenPom/Torvik snapshot dated one ET calendar day before game; CBBD form uses only prior completed games.",
    cbbd:"smoothed rolling PF/PA with 5-game league-average prior + 3.5 HCA (0 neutral)",
    cbbdTorvik:"equal-weight blend of CBBD projection and point-in-time Torvik ratings projection",
    cbbdKenpom:"equal-weight blend of CBBD projection and point-in-time KenPom archive projection",
    fullStack:"equal-weight blend of CBBD, point-in-time Torvik, and point-in-time KenPom projections",
    ratingProjection:"AdjOE × opponent AdjDE / 104.5; possessions = mean adjusted tempo; existing FBIS CBB ratings formula",
    note:"This is a leakage-safe fixed-weight data-value screen, not final CBB-PRO coefficient selection.",
  },
  seasons:SEASONS,
  coverage,
  aggregate,
  fairComparison:{kenpomIncremental:kenpomFair,threeWayOverlap:threeWayFair},
  bySeason,
  rows:allRows.length,
};

mkdirSync("artifacts",{recursive:true});
writeFileSync("artifacts/cbb-data-stack-walkforward.json",JSON.stringify(report,null,2));
writeFileSync("artifacts/cbb-data-stack-predictions.json",JSON.stringify(allRows.map(r=>({
  id:r.id,season:r.season,date:r.date,home:r.home,away:r.away,neutral:r.neutral,
  actualHome:r.actualHome,actualAway:r.actualAway,
  cbbd:r.cbbd,torvik:r.torvik,kenpom:r.kenpom,cbbdTorvik:r.cbbdTorvik,cbbdKenpom:r.cbbdKenpom,fullStack:r.fullStack,
})),null,2));
console.log(JSON.stringify({ok:true,rows:report.rows,coverage,aggregate,fairComparison:report.fairComparison},null,2));
