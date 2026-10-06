#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const BASE=process.env.WTA_API_BASE||"https://api.wtatennis.com/tennis";
const YEAR=Number(process.env.WTA_YEAR||new Date().getUTCFullYear());
const SEED_GROUP=process.env.WTA_TOURNAMENT_GROUP_ID||"";
const LIMIT=Math.max(1,Math.min(10,Number(process.env.WTA_TOURNAMENT_LIMIT||2)));
const START=Number(process.env.WTA_TOURNAMENT_OFFSET||0);
const PAGE_SIZE=Math.max(25,Math.min(500,Number(process.env.WTA_TOURNAMENT_PAGE_SIZE||100)));
const MAX_PAGES=Math.max(1,Math.min(25,Number(process.env.WTA_TOURNAMENT_MAX_PAGES||10)));
const INPUT=process.env.WTA_MATCH_INPUT||"";
const OUT=process.env.WTA_MATCH_SQL||"artifacts/wta-match-history.sql";
const RAW=process.env.WTA_RAW_DIR||"artifacts/wta-raw";
const SUMMARY=process.env.WTA_MATCH_SUMMARY||"artifacts/wta-match-history-summary.json";
const now=new Date().toISOString();
const q=v=>v==null?"NULL":`'${String(v).replaceAll("'","''")}'`;
const num=v=>v==null||v===""||!Number.isFinite(Number(v))?"NULL":String(Number(v));
const h=v=>crypto.createHash("sha256").update(String(v)).digest("hex");
const arr=v=>Array.isArray(v)?v:(v?.content||v?.matches||v?.players||[]);
const enc=encodeURIComponent;
async function get(p){const r=await fetch(BASE+p,{headers:{accept:"application/json","user-agent":"FBIS-WTA-History/1.1"}});const text=await r.text();let body=null;try{body=JSON.parse(text)}catch{}return{ok:r.ok,status:r.status,text,body,path:p}}
const pick=(o,...ks)=>{for(const k of ks){if(o?.[k]!=null)return o[k]}return null};
const sourcePid=(m,n)=>String(pick(m,n===1?"PlayerIDA":"PlayerIDB")??"")||null;
const sourcePartnerPid=(m,n)=>String(pick(m,n===1?"PlayerIDA2":"PlayerIDB2")??"")||null;
const matchId=m=>String(pick(m,"MatchID")??"")||null;
const date=m=>pick(m,"MatchTimeStamp");
const round=m=>pick(m,"RoundID");
const reason=m=>pick(m,"MatchState");
const completion=m=>String(pick(m,"MatchState")||"")==="F"?"FINAL":"UNKNOWN";
const score=m=>pick(m,"ScoreString");
const sets=m=>({set1:[pick(m,"ScoreSet1A"),pick(m,"ScoreSet1B")],set2:[pick(m,"ScoreSet2A"),pick(m,"ScoreSet2B")],set3:[pick(m,"ScoreSet3A"),pick(m,"ScoreSet3B")],set4:[pick(m,"ScoreSet4A"),pick(m,"ScoreSet4B")],set5:[pick(m,"ScoreSet5A"),pick(m,"ScoreSet5B")]});
const surface=t=>pick(t,"surface","courtSurface","surfaceName");
const io=t=>pick(t,"indoorOutdoor","indoor_outdoor","environment");
const tname=t=>pick(t,"name","tournamentName","displayName");
const level=t=>pick(t,"level","levelName","category");
const venue=t=>pick(t,"venue","location","city");
const group=t=>String(pick(t?.tournamentGroup,"id")??pick(t,"tournamentGroupId","groupId","id")??"")||null;
const yearOf=t=>Number(pick(t,"year")??0)||null;
const escJson=v=>q(JSON.stringify(v??null));

await fs.mkdir(path.dirname(OUT),{recursive:true});await fs.mkdir(RAW,{recursive:true});
let all=[],pagesScanned=0;
for(let page=0;page<MAX_PAGES;page++){
 const res=await get(`/tournaments/?page=${page}&pageSize=${PAGE_SIZE}&excludeLevels=ITF&from=${enc(`${YEAR}-01-01`)}&to=${enc(`${YEAR}-12-31`)}`);
 if(!res.ok)throw new Error(`tournaments page ${page} HTTP ${res.status}`);
 const rows=arr(res.body);pagesScanned++;
 all.push(...rows.filter(t=>yearOf(t)===YEAR&&group(t)&&String(level(t)||"").toUpperCase()!=="ITF"));
 if(rows.length<PAGE_SIZE)break;
}
const uniq=new Map();for(const t of all)uniq.set(`${group(t)}|${yearOf(t)}`,t);
all=[...uniq.values()];
const chosen=all.slice(START,START+LIMIT);
let sql="";let seen=0,written=0,failures=0;const shards=[];
for(const t of chosen){
 const gid=group(t),yr=yearOf(t),sourcePath=`/tournaments/${gid}/${yr}/matches`,shardKey=`wta:matches:${yr}:${gid}`;
 try{
  const res=INPUT?{ok:true,status:200,text:await fs.readFile(INPUT,"utf8"),body:JSON.parse(await fs.readFile(INPUT,"utf8")),path:sourcePath}:await get(sourcePath);if(!res.ok)throw new Error(`HTTP ${res.status}`);
  const rows=arr(res.body);if(!rows.length){shards.push({shardKey,gid,year:yr,status:"EMPTY",rows:0});continue;}const checksum=h(res.text),rawKey=`wta/matches/${yr}/${gid}/matches-${checksum.slice(0,16)}.json`;
  await fs.mkdir(path.join(RAW,String(yr),gid),{recursive:true});await fs.writeFile(path.join(RAW,String(yr),gid,"matches.json"),res.text);
  seen+=rows.length;
  for(const m of rows){
   const smid=matchId(m);if(!smid)continue;
   const a=sourcePid(m,1),b=sourcePid(m,2),a2=sourcePartnerPid(m,1),b2=sourcePartnerPid(m,2),w=null;
   const p1=a?`(SELECT fbis_player_id FROM tennis_player_source_ids WHERE provider='WTA_OFFICIAL' AND source_player_id=${q(a)} LIMIT 1)`:"NULL";
   const p2=b?`(SELECT fbis_player_id FROM tennis_player_source_ids WHERE provider='WTA_OFFICIAL' AND source_player_id=${q(b)} LIMIT 1)`:"NULL";
   const win=w?`(SELECT fbis_player_id FROM tennis_player_source_ids WHERE provider='WTA_OFFICIAL' AND source_player_id=${q(w)} LIMIT 1)`:"NULL";
   const sourceMatchKey=`${yr}|${gid}|${smid}`;
   const mid=`wta_${h(`WTA_OFFICIAL|wta|${sourceMatchKey}`).slice(0,24)}`;
   sql+=`INSERT INTO tennis_official_matches(match_id,tour,source,source_match_id,tournament_group_id,tournament_year,tournament_name,tournament_level,round_code,match_time,surface,indoor_outdoor,venue,player1_id,player2_id,source_player1_id,source_player2_id,source_player1_partner_id,source_player2_partner_id,winner_id,source_winner_id,score_text,sets_json,duration_seconds,player1_entry_rank,player2_entry_rank,completion_state,result_reason,source_updated_at,observed_at,effective_at,ingested_at,provenance_json,raw_artifact_key) VALUES(${q(mid)},'wta','WTA_OFFICIAL',${q(sourceMatchKey)},${q(gid)},${yr},${q(tname(t))},${q(level(t))},${q(round(m))},${q(date(m))},${q(surface(t))},${q(io(t))},${q(venue(t))},${p1},${p2},${q(a)},${q(b)},${q(a2)},${q(b2)},${win},${q(w)},${q(score(m))},${escJson(sets(m))},NULL,NULL,NULL,${q(completion(m))},${q(reason(m))},${q(pick(m,"LastUpdated"))},${q(now)},${q(date(m))},${q(now)},${q(JSON.stringify({source:"WTA_OFFICIAL",path:sourcePath,checksum}))},${q(rawKey)}) ON CONFLICT(source,tour,source_match_id) DO UPDATE SET observed_at=excluded.observed_at,raw_artifact_key=excluded.raw_artifact_key WHERE excluded.observed_at>tennis_official_matches.observed_at;
`;
   for(const spid of [a,a2,b,b2].filter(Boolean)) sql+=`INSERT OR IGNORE INTO tennis_match_identity_review_queue(review_id,source,tour,source_match_id,source_player_id,reason,payload_json,status,created_at) SELECT ${q("tmr_"+h(sourceMatchKey+"|"+spid).slice(0,24))},'WTA_OFFICIAL','wta',${q(sourceMatchKey)},${q(spid)},'UNRESOLVED_OFFICIAL_PLAYER_ID',${q(JSON.stringify({tournamentGroupId:gid,year:yr}))},'OPEN',${q(now)} WHERE NOT EXISTS(SELECT 1 FROM tennis_player_source_ids WHERE provider='WTA_OFFICIAL' AND source_player_id=${q(spid)});
`;
   written++;
  }
  sql+=`INSERT INTO tennis_wta_shards(shard_key,stream,year,tournament_group_id,status,source_path,cursor_value,records_seen,records_written,unresolved_count,failure_count,checksum,raw_artifact_key,started_at,completed_at,updated_at) VALUES(${q(shardKey)},'matches',${yr},${q(gid)},'COMPLETE',${q(sourcePath)},${q(String(START))},${rows.length},${rows.length},0,0,${q(checksum)},${q(rawKey)},${q(now)},${q(now)},${q(now)}) ON CONFLICT(shard_key) DO UPDATE SET status='COMPLETE',records_seen=excluded.records_seen,records_written=excluded.records_written,checksum=excluded.checksum,raw_artifact_key=excluded.raw_artifact_key,completed_at=excluded.completed_at,updated_at=excluded.updated_at;
`;
  shards.push({shardKey,gid,year:yr,rows:rows.length,checksum,rawKey,status:"COMPLETE"});
 }catch(e){failures++;shards.push({shardKey,gid,year:yr,status:"FAILED",error:String(e)});}
}
await fs.writeFile(OUT,sql);
const summary={generatedAt:now,year:YEAR,offset:START,limit:LIMIT,tournamentPagesScanned:pagesScanned,tournamentsAvailable:all.length,tournamentsAttempted:chosen.length,recordsSeen:seen,recordsWritten:written,failures,shards,nextOffset:START+chosen.length,complete:START+chosen.length>=all.length};
await fs.writeFile(SUMMARY,JSON.stringify(summary,null,2)+String.fromCharCode(10));
console.log(JSON.stringify(summary,null,2));
if(!chosen.length||!seen||failures)process.exitCode=2;

