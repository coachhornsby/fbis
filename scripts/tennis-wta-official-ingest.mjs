#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const BASE=process.env.WTA_API_BASE||"https://api.wtatennis.com/tennis";
const START_PAGE=Math.max(0,Number(process.env.WTA_START_PAGE||0));
const MAX_PAGES=Math.max(1,Math.min(10,Number(process.env.WTA_MAX_PAGES||2)));
const PAGE_SIZE=Math.max(10,Math.min(100,Number(process.env.WTA_PAGE_SIZE||50)));
const PROFILE_CONCURRENCY=Math.max(1,Math.min(5,Number(process.env.WTA_PROFILE_CONCURRENCY||3)));
const OUT=process.env.WTA_PLAYER_BANK_SQL||"artifacts/wta-official-player-bank.sql";
const SUMMARY=process.env.WTA_PLAYER_BANK_SUMMARY||"artifacts/wta-official-player-bank-summary.json";
const now=new Date().toISOString();
const today=now.slice(0,10);
const SOURCE="WTA_OFFICIAL";
const PRIORITY=100;

const q=v=>v==null?"NULL":`'${String(v).replaceAll("'","''")}'`;
const n=v=>{if(v==null||v==="")return "NULL";const x=Number(v);return Number.isFinite(x)?String(x):"NULL"};
const norm=v=>String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const h=v=>crypto.createHash("sha256").update(String(v)).digest("hex").slice(0,32);
const pick=(obj,...paths)=>{for(const p of paths){let cur=obj;for(const k of p.split(".")){cur=cur?.[k]}if(cur!==undefined&&cur!==null&&cur!=="")return cur}return null};
const cm=v=>{if(v==null||v==="")return null;const x=Number(v);if(!Number.isFinite(x)||x<=0)return null;return x<3?x*100:x};
const money=v=>{if(v==null)return null;const x=Number(String(v).replace(/[^0-9.-]/g,""));return Number.isFinite(x)?x:null};

async function fetchJson(url,{attempts=3}={}){
  let last;
  for(let i=1;i<=attempts;i++){
    try{
      const r=await fetch(url,{headers:{"accept":"application/json","user-agent":"FBIS-WTA-PlayerBank/1.0"}});
      if(r.status===429||r.status>=500){last=new Error(`${r.status} ${url}`);await new Promise(x=>setTimeout(x,500*i));continue}
      if(!r.ok)throw new Error(`${r.status} ${url}`);
      return await r.json();
    }catch(e){last=e;if(i<attempts)await new Promise(x=>setTimeout(x,500*i))}
  }
  throw last;
}
function playerId(row){return String(pick(row,"id","playerId","player.id")||"").trim()}
function playerName(row){return String(pick(row,"fullName","name","player.fullName","displayName")||"").trim()}
function profileFields(p={}){
  return {
    country:pick(p,"countryCode","country.code","nationalityCode"),
    dob:pick(p,"dateOfBirth","birthDate","dob"),
    heightCm:cm(pick(p,"height","heightCm","heightCentimeters")),
    weightKg:pick(p,"weightKg","weight"),
    handedness:pick(p,"plays","handedness","hand"),
    backhand:pick(p,"backhand"),
    turnedProYear:pick(p,"turnedPro","turnedProYear","proYear"),
    coach:pick(p,"coach","coachName","coaches.0.name"),
    headshot:pick(p,"photoUrl","imageUrl","headshotUrl","profileImage","media.photoUrl","images.profile"),
    careerHighRank:pick(p,"careerHighRank","highestRanking","singlesCareerHighRank"),
    careerWins:pick(p,"careerWins","wins","career.wins"),
    careerLosses:pick(p,"careerLosses","losses","career.losses"),
    titles:pick(p,"titles","careerTitles","career.titles"),
    prizeMoney:money(pick(p,"prizeMoney","careerPrizeMoney","career.prizeMoney")),
  };
}
function rankingRow(row={}){
  const p=row.player||{};
  return {
    id:String(p.id||row.playerId||""),
    name:p.fullName||row.fullName||null,
    country:p.countryCode||null,
    dob:p.dateOfBirth||null,
    ranking:Number.isFinite(Number(row.ranking))?Number(row.ranking):null,
    points:Number.isFinite(Number(row.points))?Number(row.points):null,
    tournamentsPlayed:Number.isFinite(Number(row.tournamentsPlayed))?Number(row.tournamentsPlayed):null,
    movement:Number.isFinite(Number(row.movement))?Number(row.movement):null,
    rankedAt:String(row.rankedAt||today).slice(0,10),
  };
}
async function buildRankingMap(){
  const map=new Map();
  for(let page=0;page<20;page++){
    const url=`${BASE}/players/ranked?type=rankSingles&metric=singles&page=${page}&pageSize=100`;
    const data=await fetchJson(url).catch(()=>[]);
    const rows=Array.isArray(data)?data:(data?.content||[]);
    if(!rows.length)break;
    for(const row of rows){const x=rankingRow(row);if(x.id)map.set(x.id,x)}
    if(rows.length<100)break;
  }
  return map;
}
async function pooled(items,fn,limit){
  const out=new Array(items.length);let next=0;
  async function worker(){while(true){const i=next++;if(i>=items.length)return;try{out[i]=await fn(items[i],i)}catch(e){out[i]={error:String(e?.message||e),item:items[i]}}}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));
  return out;
}

const rankingMap=await buildRankingMap();
const playerRows=[];let totalPages=null,pagesFetched=0,sourceFailures=0;
for(let page=START_PAGE;page<START_PAGE+MAX_PAGES;page++){
  const data=await fetchJson(`${BASE}/players?page=${page}&pageSize=${PAGE_SIZE}`);
  const rows=Array.isArray(data)?data:(data?.content||[]);
  totalPages=Number(data?.pageInfo?.numPages??totalPages);
  if(!rows.length)break;
  for(const row of rows){const id=playerId(row),name=playerName(row);if(id&&name)playerRows.push({id,name,row,page})}
  pagesFetched++;
  if(Number.isFinite(totalPages)&&page+1>=totalPages)break;
}
const enriched=await pooled(playerRows,async x=>{
  const profile=await fetchJson(`${BASE}/players/${encodeURIComponent(x.id)}`);
  return {...x,profile,rank:rankingMap.get(x.id)||null};
},PROFILE_CONCURRENCY);

let sql="",written=0,profileObs=0,rankObs=0,headshots=0,dobCount=0,heightCount=0,handCount=0,rankCount=0;
for(const item of enriched){
  if(item?.error){sourceFailures++;continue}
  const {id,name,profile,rank}=item, fbis=`tennis:wta:${id}`, normalized=norm(name), pf=profileFields(profile||{});
  const country=pf.country||rank?.country||pick(item.row,"countryCode");
  const dob=pf.dob||rank?.dob||pick(item.row,"dateOfBirth");
  const currentRank=rank?.ranking??null, points=rank?.points??null;
  if(pf.headshot)headshots++;if(dob)dobCount++;if(pf.heightCm!=null)heightCount++;if(pf.handedness)handCount++;if(currentRank!=null)rankCount++;
  sql+=`INSERT INTO tennis_players(fbis_player_id,tour,canonical_name,normalized_name,country_code,sex,date_of_birth,height_cm,weight_kg,handedness,backhand,turned_pro_year,coach,active_state,official_headshot_url,official_headshot_source,current_rank,ranking_points,career_high_rank,career_wins,career_losses,titles,prize_money_usd,official_source,official_source_player_id,official_source_priority,official_effective_at,official_observed_at,created_at,updated_at) VALUES(${q(fbis)},'wta',${q(name)},${q(normalized)},${q(country)},'F',${q(dob)},${n(pf.heightCm)},${n(pf.weightKg)},${q(pf.handedness)},${q(pf.backhand)},${n(pf.turnedProYear)},${q(pf.coach)},'UNKNOWN',${q(pf.headshot)},${pf.headshot?q(SOURCE):"NULL"},${n(currentRank)},${n(points)},${n(pf.careerHighRank)},${n(pf.careerWins)},${n(pf.careerLosses)},${n(pf.titles)},${n(pf.prizeMoney)},${q(SOURCE)},${q(id)},${PRIORITY},${q(rank?.rankedAt||today)},${q(now)},${q(now)},${q(now)}) ON CONFLICT(fbis_player_id) DO UPDATE SET canonical_name=excluded.canonical_name,normalized_name=excluded.normalized_name,country_code=COALESCE(excluded.country_code,tennis_players.country_code),date_of_birth=COALESCE(excluded.date_of_birth,tennis_players.date_of_birth),height_cm=COALESCE(excluded.height_cm,tennis_players.height_cm),weight_kg=COALESCE(excluded.weight_kg,tennis_players.weight_kg),handedness=COALESCE(excluded.handedness,tennis_players.handedness),backhand=COALESCE(excluded.backhand,tennis_players.backhand),turned_pro_year=COALESCE(excluded.turned_pro_year,tennis_players.turned_pro_year),coach=COALESCE(excluded.coach,tennis_players.coach),official_headshot_url=COALESCE(excluded.official_headshot_url,tennis_players.official_headshot_url),official_headshot_source=CASE WHEN excluded.official_headshot_url IS NOT NULL THEN excluded.official_headshot_source ELSE tennis_players.official_headshot_source END,current_rank=COALESCE(excluded.current_rank,tennis_players.current_rank),ranking_points=COALESCE(excluded.ranking_points,tennis_players.ranking_points),career_high_rank=COALESCE(excluded.career_high_rank,tennis_players.career_high_rank),career_wins=COALESCE(excluded.career_wins,tennis_players.career_wins),career_losses=COALESCE(excluded.career_losses,tennis_players.career_losses),titles=COALESCE(excluded.titles,tennis_players.titles),prize_money_usd=COALESCE(excluded.prize_money_usd,tennis_players.prize_money_usd),official_source=excluded.official_source,official_source_player_id=excluded.official_source_player_id,official_source_priority=MAX(tennis_players.official_source_priority,excluded.official_source_priority),official_effective_at=excluded.official_effective_at,official_observed_at=excluded.official_observed_at,updated_at=excluded.updated_at;\n`;
  sql+=`INSERT INTO tennis_player_source_ids(provider,source_player_id,fbis_player_id,source_name,normalized_source_name,source_priority,first_seen_at,last_seen_at,provenance_json) VALUES(${q(SOURCE)},${q(id)},${q(fbis)},${q(name)},${q(normalized)},${PRIORITY},${q(now)},${q(now)},${q(JSON.stringify({endpoint:"/players/{id}",page:item.page}))}) ON CONFLICT(provider,source_player_id) DO UPDATE SET fbis_player_id=excluded.fbis_player_id,source_name=excluded.source_name,normalized_source_name=excluded.normalized_source_name,source_priority=MAX(tennis_player_source_ids.source_priority,excluded.source_priority),last_seen_at=excluded.last_seen_at,provenance_json=excluded.provenance_json;\n`;
  sql+=`INSERT INTO tennis_player_aliases(alias_normalized,fbis_player_id,alias_display,source,source_priority,first_seen_at,last_seen_at,active) VALUES(${q(normalized)},${q(fbis)},${q(name)},${q(SOURCE)},${PRIORITY},${q(now)},${q(now)},1) ON CONFLICT(alias_normalized,fbis_player_id,source) DO UPDATE SET alias_display=excluded.alias_display,source_priority=MAX(tennis_player_aliases.source_priority,excluded.source_priority),last_seen_at=excluded.last_seen_at,active=1;\n`;
  const fields={country_code:country,date_of_birth:dob,height_cm:pf.heightCm,weight_kg:pf.weightKg,handedness:pf.handedness,backhand:pf.backhand,turned_pro_year:pf.turnedProYear,coach:pf.coach,headshot_url:pf.headshot,career_high_rank:pf.careerHighRank,career_wins:pf.careerWins,career_losses:pf.careerLosses,titles:pf.titles,prize_money_usd:pf.prizeMoney};
  for(const [field,value] of Object.entries(fields)){if(value==null||value==="")continue;const oid="tpo_"+h([SOURCE,id,field,String(value),today].join("|"));sql+=`INSERT OR IGNORE INTO tennis_profile_observations(observation_id,fbis_player_id,source,source_player_id,field_name,value_text,value_num,effective_at,observed_at,ingested_at,provenance_json,confidence,source_priority) VALUES(${q(oid)},${q(fbis)},${q(SOURCE)},${q(id)},${q(field)},${q(String(value))},${typeof value==="number"?n(value):"NULL"},${q(today)},${q(now)},${q(now)},${q(JSON.stringify({endpoint:"/players/{id}"}))},1.0,${PRIORITY});\n`;profileObs++}
  if(rank?.ranking!=null){const rid="tro_"+h([SOURCE,id,rank.rankedAt,rank.ranking,rank.points].join("|"));sql+=`INSERT OR IGNORE INTO tennis_ranking_observations(observation_id,fbis_player_id,tour,ranking_date,singles_rank,points,movement,tournaments_played,career_high_rank,source,source_player_id,observed_at,ingested_at,provenance_json,source_priority) VALUES(${q(rid)},${q(fbis)},'wta',${q(rank.rankedAt)},${n(rank.ranking)},${n(rank.points)},${n(rank.movement)},${n(rank.tournamentsPlayed)},${n(pf.careerHighRank)},${q(SOURCE)},${q(id)},${q(now)},${q(now)},${q(JSON.stringify({endpoint:"/players/ranked",metric:"singles"}))},${PRIORITY});\n`;rankObs++}
  written++;
}
const nextPage=START_PAGE+pagesFetched;
const complete=Number.isFinite(totalPages)&&nextPage>=totalPages;
sql+=`INSERT INTO tennis_ingestion_state(source,tour,stream,cursor_value,status,records_seen,records_written,failure_count,last_error,last_started_at,last_success_at,updated_at) VALUES(${q(SOURCE)},'wta','players',${q(String(nextPage))},${q(complete?"COMPLETE":"PARTIAL")},${playerRows.length},${written},${sourceFailures},${sourceFailures?q("one_or_more_profile_failures"):"NULL"},${q(now)},${q(now)},${q(now)}) ON CONFLICT(source,tour,stream) DO UPDATE SET cursor_value=excluded.cursor_value,status=excluded.status,records_seen=tennis_ingestion_state.records_seen+excluded.records_seen,records_written=tennis_ingestion_state.records_written+excluded.records_written,failure_count=tennis_ingestion_state.failure_count+excluded.failure_count,last_error=excluded.last_error,last_started_at=excluded.last_started_at,last_success_at=excluded.last_success_at,updated_at=excluded.updated_at;\n`;

await fs.mkdir(path.dirname(OUT),{recursive:true});
await fs.writeFile(OUT,sql);
const summary={generatedAt:now,source:SOURCE,sourcePriority:PRIORITY,startPage:START_PAGE,pagesFetched,pageSize:PAGE_SIZE,totalPages,nextPage,status:complete?"COMPLETE":"PARTIAL",playersSeen:playerRows.length,playersWritten:written,profileObservations:profileObs,rankingObservations:rankObs,failures:sourceFailures,coverage:{headshot:written?headshots/written:0,dob:written?dobCount/written:0,height:written?heightCount/written:0,handedness:written?handCount/written:0,currentRank:written?rankCount/written:0},governance:{officialWtaPriority:100,secondaryMayNotOverwriteOfficial:true,availabilityInference:false}};
await fs.writeFile(SUMMARY,JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify(summary,null,2));
if(written===0)process.exitCode=2;
