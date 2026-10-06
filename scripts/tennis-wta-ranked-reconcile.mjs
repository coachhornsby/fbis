#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const BASE=process.env.WTA_API_BASE||"https://api.wtatennis.com/tennis";
const START_PAGE=Math.max(0,Number(process.env.WTA_RANK_START_PAGE||0));
const MAX_PAGES=Math.max(1,Math.min(25,Number(process.env.WTA_RANK_MAX_PAGES||20)));
const PAGE_SIZE=Math.max(25,Math.min(100,Number(process.env.WTA_RANK_PAGE_SIZE||100)));
const OUT=process.env.WTA_RANK_SQL||"artifacts/wta-ranked-reconcile.sql";
const SUMMARY=process.env.WTA_RANK_SUMMARY||"artifacts/wta-ranked-reconcile-summary.json";
const SOURCE="WTA_OFFICIAL";
const PRIORITY=100;
const now=new Date().toISOString();

const q=v=>v==null?"NULL":`'${String(v).replaceAll("'","''")}'`;
const n=v=>{if(v==null||v==="")return "NULL";const x=Number(v);return Number.isFinite(x)?String(x):"NULL"};
const norm=v=>String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const hash=v=>crypto.createHash("sha256").update(String(v)).digest("hex").slice(0,32);

async function fetchJson(url,{attempts=3}={}){
  let last;
  for(let i=1;i<=attempts;i++){
    try{
      const r=await fetch(url,{headers:{"accept":"application/json","user-agent":"FBIS-WTA-Ranked/1.0"}});
      if(r.status===429||r.status>=500){last=new Error(`${r.status} ${url}`);await new Promise(x=>setTimeout(x,500*i));continue}
      if(!r.ok)throw new Error(`${r.status} ${url}`);
      return await r.json();
    }catch(e){last=e;if(i<attempts)await new Promise(x=>setTimeout(x,500*i))}
  }
  throw last;
}
function parseRow(row={}){
  const p=row.player||{};
  const id=String(p.id||row.playerId||"").trim();
  const name=String(p.fullName||row.fullName||"").trim();
  const ranking=Number(row.ranking),points=Number(row.points),movement=Number(row.movement),tp=Number(row.tournamentsPlayed);
  return {
    id,name,country:p.countryCode||null,dob:p.dateOfBirth||null,
    ranking:Number.isFinite(ranking)&&ranking>0?ranking:null,
    points:Number.isFinite(points)&&points>=0?points:null,
    movement:Number.isFinite(movement)?movement:null,
    tournamentsPlayed:Number.isFinite(tp)&&tp>=0?tp:null,
    rankingDate:String(row.rankedAt||"").slice(0,10)||now.slice(0,10),
  };
}
const rows=[];let pagesFetched=0,complete=false,rankingDate=null,totalReturned=0;
for(let page=START_PAGE;page<START_PAGE+MAX_PAGES;page++){
  const data=await fetchJson(`${BASE}/players/ranked?type=rankSingles&metric=singles&page=${page}&pageSize=${PAGE_SIZE}`);
  const batch=(Array.isArray(data)?data:(data?.content||[])).map(parseRow).filter(x=>x.id&&x.name&&x.ranking!=null);
  if(!batch.length){complete=true;break}
  rankingDate=rankingDate||batch[0].rankingDate;
  for(const r of batch)rows.push({...r,page});
  pagesFetched++;totalReturned+=batch.length;
  if(batch.length<PAGE_SIZE){complete=true;break}
}
const ids=new Map(),names=new Map();let duplicateOfficialIds=0,aliasCollisionsPotential=0;
for(const r of rows){
  if(ids.has(r.id)&&ids.get(r.id)!==r.name)duplicateOfficialIds++;
  ids.set(r.id,r.name);
  const k=norm(r.name);if(names.has(k)&&names.get(k)!==r.id)aliasCollisionsPotential++;else names.set(k,r.id);
}
let sql="",rankingObservations=0;
for(const r of rows){
  const fbis=`tennis:wta:${r.id}`,nameNorm=norm(r.name),rid="tro_"+hash([SOURCE,r.id,r.rankingDate,r.ranking,r.points].join("|"));
  const reviewConflict="tir_"+hash(["official-id-conflict",SOURCE,r.id,fbis].join("|"));
  const reviewAlias="tir_"+hash(["alias-collision",SOURCE,r.id,nameNorm].join("|"));
  sql+=`INSERT OR IGNORE INTO tennis_identity_review_queue(review_id,tour,source,source_player_id,source_name,normalized_source_name,issue_type,candidate_fbis_player_ids_json,detail_json,status,first_observed_at,last_observed_at) SELECT ${q(reviewConflict)},'wta',${q(SOURCE)},${q(r.id)},${q(r.name)},${q(nameNorm)},'OFFICIAL_ID_CONFLICT',json_array(fbis_player_id),${q(JSON.stringify({expectedFbisId:fbis,rankingDate:r.rankingDate}))},'OPEN',${q(now)},${q(now)} FROM tennis_player_source_ids WHERE provider=${q(SOURCE)} AND source_player_id=${q(r.id)} AND fbis_player_id<>${q(fbis)};\n`;
  sql+=`UPDATE tennis_identity_review_queue SET last_observed_at=${q(now)} WHERE review_id=${q(reviewConflict)};\n`;
  sql+=`INSERT OR IGNORE INTO tennis_identity_review_queue(review_id,tour,source,source_player_id,source_name,normalized_source_name,issue_type,candidate_fbis_player_ids_json,detail_json,status,first_observed_at,last_observed_at) SELECT ${q(reviewAlias)},'wta',${q(SOURCE)},${q(r.id)},${q(r.name)},${q(nameNorm)},'OFFICIAL_ALIAS_COLLISION',json_group_array(DISTINCT fbis_player_id),${q(JSON.stringify({rankingDate:r.rankingDate}))},'OPEN',${q(now)},${q(now)} FROM tennis_player_aliases WHERE alias_normalized=${q(nameNorm)} AND fbis_player_id<>${q(fbis)} HAVING COUNT(DISTINCT fbis_player_id)>0;\n`;
  sql+=`UPDATE tennis_identity_review_queue SET last_observed_at=${q(now)} WHERE review_id=${q(reviewAlias)};\n`;
  sql+=`INSERT INTO tennis_players(fbis_player_id,tour,canonical_name,normalized_name,country_code,sex,date_of_birth,active_state,current_rank,ranking_points,official_source,official_source_player_id,official_source_priority,official_effective_at,official_observed_at,created_at,updated_at) SELECT ${q(fbis)},'wta',${q(r.name)},${q(nameNorm)},${q(r.country)},'F',${q(r.dob)},'RANKED_ACTIVE',${n(r.ranking)},${n(r.points)},${q(SOURCE)},${q(r.id)},${PRIORITY},${q(r.rankingDate)},${q(now)},${q(now)},${q(now)} WHERE NOT EXISTS(SELECT 1 FROM tennis_player_source_ids WHERE provider=${q(SOURCE)} AND source_player_id=${q(r.id)} AND fbis_player_id<>${q(fbis)}) ON CONFLICT(fbis_player_id) DO UPDATE SET canonical_name=excluded.canonical_name,normalized_name=excluded.normalized_name,country_code=COALESCE(excluded.country_code,tennis_players.country_code),date_of_birth=COALESCE(excluded.date_of_birth,tennis_players.date_of_birth),active_state='RANKED_ACTIVE',official_source=${q(SOURCE)},official_source_player_id=${q(r.id)},official_source_priority=${PRIORITY},official_observed_at=${q(now)},updated_at=${q(now)} WHERE tennis_players.official_source_priority<=${PRIORITY};\n`;
  sql+=`INSERT INTO tennis_player_source_ids(provider,source_player_id,fbis_player_id,source_name,normalized_source_name,source_priority,first_seen_at,last_seen_at,provenance_json) SELECT ${q(SOURCE)},${q(r.id)},${q(fbis)},${q(r.name)},${q(nameNorm)},${PRIORITY},${q(now)},${q(now)},${q(JSON.stringify({endpoint:"/players/ranked",rankingDate:r.rankingDate,page:r.page}))} WHERE NOT EXISTS(SELECT 1 FROM tennis_player_source_ids WHERE provider=${q(SOURCE)} AND source_player_id=${q(r.id)} AND fbis_player_id<>${q(fbis)}) ON CONFLICT(provider,source_player_id) DO UPDATE SET source_name=excluded.source_name,normalized_source_name=excluded.normalized_source_name,source_priority=MAX(tennis_player_source_ids.source_priority,excluded.source_priority),last_seen_at=excluded.last_seen_at,provenance_json=excluded.provenance_json;\n`;
  sql+=`INSERT INTO tennis_player_aliases(alias_normalized,fbis_player_id,alias_display,source,source_priority,first_seen_at,last_seen_at,active) SELECT ${q(nameNorm)},${q(fbis)},${q(r.name)},${q(SOURCE)},${PRIORITY},${q(now)},${q(now)},1 WHERE NOT EXISTS(SELECT 1 FROM tennis_player_source_ids WHERE provider=${q(SOURCE)} AND source_player_id=${q(r.id)} AND fbis_player_id<>${q(fbis)}) ON CONFLICT(alias_normalized,fbis_player_id,source) DO UPDATE SET alias_display=excluded.alias_display,source_priority=MAX(tennis_player_aliases.source_priority,excluded.source_priority),last_seen_at=excluded.last_seen_at,active=1;\n`;
  sql+=`INSERT OR IGNORE INTO tennis_ranking_observations(observation_id,fbis_player_id,tour,ranking_date,singles_rank,points,movement,tournaments_played,career_high_rank,source,source_player_id,observed_at,ingested_at,provenance_json,source_priority) SELECT ${q(rid)},${q(fbis)},'wta',${q(r.rankingDate)},${n(r.ranking)},${n(r.points)},${n(r.movement)},${n(r.tournamentsPlayed)},NULL,${q(SOURCE)},${q(r.id)},${q(now)},${q(now)},${q(JSON.stringify({endpoint:"/players/ranked",type:"rankSingles",metric:"singles",page:r.page}))},${PRIORITY} WHERE NOT EXISTS(SELECT 1 FROM tennis_player_source_ids WHERE provider=${q(SOURCE)} AND source_player_id=${q(r.id)} AND fbis_player_id<>${q(fbis)});\n`;
  sql+=`UPDATE tennis_players SET current_rank=${n(r.ranking)},ranking_points=${n(r.points)},active_state='RANKED_ACTIVE',official_effective_at=${q(r.rankingDate)},official_observed_at=${q(now)},updated_at=${q(now)} WHERE fbis_player_id=${q(fbis)} AND official_source_priority<=${PRIORITY} AND NOT EXISTS(SELECT 1 FROM tennis_ranking_observations nx WHERE nx.fbis_player_id=${q(fbis)} AND nx.source=${q(SOURCE)} AND nx.ranking_date>${q(r.rankingDate)});\n`;
  rankingObservations++;
}
const nextPage=START_PAGE+pagesFetched;
if(complete&&rankingDate){
  sql+=`UPDATE tennis_players SET active_state='KNOWN_UNRANKED',current_rank=NULL,ranking_points=NULL,updated_at=${q(now)} WHERE tour='wta' AND official_source_priority<=${PRIORITY} AND fbis_player_id NOT IN (SELECT DISTINCT fbis_player_id FROM tennis_ranking_observations WHERE tour='wta' AND source=${q(SOURCE)} AND ranking_date=${q(rankingDate)});\n`;
}
const cursor=`${rankingDate||"UNKNOWN"}|${nextPage}`;
sql+=`INSERT INTO tennis_ingestion_state(source,tour,stream,cursor_value,status,records_seen,records_written,failure_count,last_error,last_started_at,last_success_at,updated_at) VALUES(${q(SOURCE)},'wta','rankings',${q(cursor)},${q(complete?"COMPLETE":"PARTIAL")},${START_PAGE*PAGE_SIZE+totalReturned},${START_PAGE*PAGE_SIZE+rankingObservations},0,NULL,${q(now)},${q(now)},${q(now)}) ON CONFLICT(source,tour,stream) DO UPDATE SET cursor_value=excluded.cursor_value,status=excluded.status,records_seen=CASE WHEN substr(tennis_ingestion_state.cursor_value,1,10)=${q(rankingDate)} THEN MAX(tennis_ingestion_state.records_seen,excluded.records_seen) ELSE excluded.records_seen END,records_written=CASE WHEN substr(tennis_ingestion_state.cursor_value,1,10)=${q(rankingDate)} THEN MAX(tennis_ingestion_state.records_written,excluded.records_written) ELSE excluded.records_written END,failure_count=tennis_ingestion_state.failure_count,last_error=NULL,last_started_at=excluded.last_started_at,last_success_at=excluded.last_success_at,updated_at=excluded.updated_at;\n`;

await fs.mkdir(path.dirname(OUT),{recursive:true});
await fs.writeFile(OUT,sql);
const summary={generatedAt:now,source:SOURCE,rankingDate,startPage:START_PAGE,pagesFetched,pageSize:PAGE_SIZE,nextPage,status:complete?"COMPLETE":"PARTIAL",rankedPlayersReturned:rows.length,rankingObservations,duplicateOfficialIds,aliasCollisionsPotential,pointsCoverage:rows.length?rows.filter(x=>x.points!=null).length/rows.length:0,officialIdCoverage:rows.length?rows.filter(x=>x.id).length/rows.length:0,governance:{identityKey:"WTA_OFFICIAL_PLAYER_ID",fuzzyMatching:false,absenceMeansRetired:false,unknownRankStoredAsNull:true,sourcePriority:PRIORITY}};
await fs.writeFile(SUMMARY,JSON.stringify(summary,null,2)+"\n");
console.log(JSON.stringify(summary,null,2));
if(!rows.length)process.exitCode=2;
