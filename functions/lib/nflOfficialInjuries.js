/**
 * Official NFL injury report ingestion.
 *
 * Source: https://www.nfl.com/injuries/
 * The NFL public page is authoritative for weekly Practice Report / Game Status
 * information. We parse only the published table fields and normalize them into
 * FBIS player_availability_observations.
 *
 * This adapter is deliberately HTML-structure tolerant:
 * - identifies injury tables by their canonical column headers
 * - resolves each table to the nearest preceding NFL team name/alias
 * - strips markup/entities without depending on CSS class names
 *
 * No market data is consumed here.
 */

import nflTeams from "../../data/teams/nfl.js";
import { normalizeAvailabilityRecord } from "./availability.js";
import { persistAvailabilityObservations, setMeta } from "./store.js";

export const NFL_OFFICIAL_INJURY_URL="https://www.nfl.com/injuries/";

function clean(v){ return String(v??"").replace(/\s+/g," ").trim(); }
function lower(v){ return clean(v).toLowerCase(); }
function sixHourBucket(iso){
  const d=new Date(iso);
  if(Number.isNaN(d.getTime())) return String(iso||"");
  const h=Math.floor(d.getUTCHours()/6)*6;
  return `${d.toISOString().slice(0,10)}T${String(h).padStart(2,"0")}:00:00Z`;
}
function decodeEntities(s=""){
  return String(s)
    .replace(/&nbsp;|&#160;/gi," ")
    .replace(/&amp;/gi,"&")
    .replace(/&quot;/gi,'"')
    .replace(/&#39;|&apos;/gi,"'")
    .replace(/&lt;/gi,"<")
    .replace(/&gt;/gi,">")
    .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCharCode(parseInt(n,16)));
}
function textFromHtml(html=""){
  return clean(decodeEntities(
    String(html)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi," ")
      .replace(/<[^>]+>/g," ")
  ));
}
function slug(v){
  return lower(v).normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
}

const TEAM_ALIASES=nflTeams.flatMap(team=>{
  const aliases=[
    team.displayName,team.nickname,team.school,team.city,team.abbr,
    ...(team.sources?.parlay?.names||[]),
    ...(team.sources?.heritage?.names||[]),
  ].filter(Boolean);
  return [...new Set(aliases)].map(alias=>({
    alias:lower(alias),
    team,
  }));
}).sort((a,b)=>b.alias.length-a.alias.length);

function nearestTeam(beforeHtml=""){
  const text=lower(textFromHtml(beforeHtml.slice(-12000)));
  let best=null;
  for(const row of TEAM_ALIASES){
    const idx=text.lastIndexOf(row.alias);
    if(idx<0) continue;
    if(!best || idx>best.idx || (idx===best.idx && row.alias.length>best.alias.length)){
      best={...row,idx};
    }
  }
  return best?.team||null;
}

function tableCells(rowHtml=""){
  return [...String(rowHtml).matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
    .map(m=>textFromHtml(m[1]));
}

function practiceStatusToFallback(practice=""){
  const x=lower(practice);
  if(!x) return "ACTIVE";
  if(/did not participate|\bdnp\b/.test(x)) return "DNP_PRACTICE";
  if(/limited/.test(x)) return "LIMITED";
  if(/full/.test(x)) return "ACTIVE";
  return practice;
}

function injuryTable(tableHtml=""){
  const rows=[...String(tableHtml).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(m=>tableCells(m[1]))
    .filter(c=>c.length);
  if(!rows.length) return null;
  const header=rows[0].map(lower);
  const idx={
    player:header.findIndex(x=>x==="player"||x.includes("player")),
    position:header.findIndex(x=>x==="position"||x==="pos"),
    injury:header.findIndex(x=>x.includes("injur")),
    practice:header.findIndex(x=>x.includes("practice")),
    game:header.findIndex(x=>x.includes("game status")),
  };
  if(idx.player<0||idx.position<0||idx.injury<0||idx.practice<0||idx.game<0) return null;
  return rows.slice(1).map(c=>({
    playerName:c[idx.player]||"",
    position:c[idx.position]||"",
    injuryDetail:c[idx.injury]||"",
    practiceStatus:c[idx.practice]||"",
    gameStatus:c[idx.game]||"",
  })).filter(r=>r.playerName&&r.position);
}

export function extractNflOfficialInjuries(html,{observedAt=new Date().toISOString()}={}){
  const sourceUrl=NFL_OFFICIAL_INJURY_URL;
  const bucket=sixHourBucket(observedAt);
  const out=[];
  const tables=[...String(html||"").matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)];
  for(const match of tables){
    const parsed=injuryTable(match[0]);
    if(!parsed) continue;
    const team=nearestTeam(String(html).slice(0,match.index));
    if(!team) continue;
    for(const row of parsed){
      const status=clean(row.gameStatus)||practiceStatusToFallback(row.practiceStatus);
      const explicitId=[
        "nfl-official","nfl",String(team.abbr||"").toLowerCase(),
        slug(row.playerName),slug(status),slug(row.practiceStatus),slug(row.injuryDetail),bucket
      ].join(":").slice(0,220);
      const normalized=normalizeAvailabilityRecord({
        id:explicitId,
        sport:"nfl",
        teamAbbr:team.abbr,
        teamName:team.displayName,
        playerName:row.playerName,
        position:row.position,
        designation:status,
        practiceStatus:row.practiceStatus||null,
        injuryDetail:row.injuryDetail||null,
        sourceUpdatedAt:observedAt,
        sourceUrl,
      },{source:"nfl-official",observedAt});
      if(normalized) out.push(normalized);
    }
  }

  // De-dupe the same player/team in case responsive markup duplicates a table.
  const byKey=new Map();
  for(const row of out){
    const key=`${row.teamKey}|${lower(row.playerName)}`;
    const cur=byKey.get(key);
    if(!cur) byKey.set(key,row);
    else {
      const curGame=clean(cur.status)!=="ACTIVE"&&clean(cur.status)!=="LIMITED"&&clean(cur.status)!=="DNP_PRACTICE";
      const nextGame=clean(row.status)!=="ACTIVE"&&clean(row.status)!=="LIMITED"&&clean(row.status)!=="DNP_PRACTICE";
      if(nextGame&&!curGame) byKey.set(key,row);
    }
  }
  return [...byKey.values()];
}

export async function syncNflOfficialInjuries(env={}){
  const observedAt=new Date().toISOString();
  await setMeta(env,"last_nfl_official_injury_attempt_at",observedAt).catch(()=>{});
  try{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort("nfl-injury-timeout"),15000);
    let res;
    try{
      res=await fetch(NFL_OFFICIAL_INJURY_URL,{
        headers:{
          accept:"text/html,application/xhtml+xml",
          "user-agent":"FBIS-Personal-Projection-System/1.0",
        },
        signal:controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const html=await res.text();
    await setMeta(env,"last_nfl_official_injury_http_status",String(res.status)).catch(()=>{});
    if(!res.ok){
      const reason=`NFL injury page HTTP ${res.status}`;
      await setMeta(env,"last_nfl_official_injury_error",reason).catch(()=>{});
      return {ok:false,status:"FAILED",source:"nfl-official",httpStatus:res.status,fetched:0,normalized:0,inserted:0,already:0,failed:0,reason};
    }
    const rows=extractNflOfficialInjuries(html,{observedAt});
    if(!rows.length){
      const reason="NFL injury page parsed zero injury rows";
      await setMeta(env,"last_nfl_official_injury_error",reason).catch(()=>{});
      return {ok:false,status:"FAILED",source:"nfl-official",httpStatus:res.status,fetched:0,normalized:0,inserted:0,already:0,failed:0,reason};
    }
    const persisted=await persistAvailabilityObservations(env,rows);
    if(persisted.ok){
      await setMeta(env,"last_nfl_official_injury_success_at",observedAt).catch(()=>{});
      await setMeta(env,"last_nfl_official_injury_records",String(rows.length)).catch(()=>{});
      await setMeta(env,"last_nfl_official_injury_error","").catch(()=>{});
    }else{
      await setMeta(env,"last_nfl_official_injury_error",persisted.reason||"persist-failed").catch(()=>{});
    }
    return {
      ok:persisted.ok,
      status:persisted.ok?"SUCCESS":"FAILED",
      source:"nfl-official",
      httpStatus:res.status,
      fetched:rows.length,
      normalized:rows.length,
      inserted:persisted.inserted||0,
      already:persisted.already||0,
      failed:persisted.failed||0,
      reason:persisted.reason||null,
      observedAt,
      sourceUrl:NFL_OFFICIAL_INJURY_URL,
    };
  }catch(err){
    const reason=String(err?.message||err);
    await setMeta(env,"last_nfl_official_injury_error",reason).catch(()=>{});
    return {ok:false,status:"FAILED",source:"nfl-official",fetched:0,normalized:0,inserted:0,already:0,failed:0,reason};
  }
}
