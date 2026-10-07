#!/usr/bin/env node
import { writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const WRITE=process.argv.includes("--write");
const START="2025-04-01", END="2025-09-30";
const PROVIDER="KBO_OFFICIAL_GAMECENTER";
const SOURCE_CONTRACT="KBO_OFFICIAL_GAMECENTER_SCHEDULE_V1";
const PARSER_VERSION="phase4b1-v1.0.0";

const TEAM={
  LG:"kbo-lg",HH:"kbo-han",SK:"kbo-ssg",SS:"kbo-sam",NC:"kbo-nc",
  KT:"kbo-kt",LT:"kbo-lot",HT:"kbo-kia",OB:"kbo-doo",WO:"kbo-kiw"
};
const VENUE={
  "잠실":"JAMSIL","대구":"DAEGU","수원":"SUWON","광주":"GWANGJU","문학":"MUNHAK",
  "인천":"MUNHAK","사직":"SAJIK","창원":"CHANGWON","대전":"DAEJEON","고척":"GOCHEOK",
  "고척스카이돔":"GOCHEOKSKY","울산":"ULSAN","포항":"POHANG","청주":"CHEONGJU"
};
const pad=n=>String(n).padStart(2,"0");
const isoDate=d=>d.toISOString().slice(0,10);
const esc=v=>String(v??"").replaceAll("'","''");
function dateRange(a,b){
  const out=[],x=new Date(a+"T00:00:00Z"),z=new Date(b+"T00:00:00Z");
  for(;x<=z;x.setUTCDate(x.getUTCDate()+1))out.push(isoDate(x));
  return out;
}
function gameParts(gid){
  const m=String(gid||"").match(/^(\d{8})([A-Z]{2})([A-Z]{2})(\d)$/);
  if(!m)return null;
  return{date:`${m[1].slice(0,4)}-${m[1].slice(4,6)}-${m[1].slice(6,8)}`,away:m[2],home:m[3],gameNo:Number(m[4])};
}
function canonicalId(g){
  const base=`KBO-${g.gameDate.replaceAll("-","")}-${g.awayTeamId}-${g.homeTeamId}`;
  return g.gameNo>0?`${base}-g${g.gameNo}`:base;
}
function kstIso(date,time="18:30"){
  const [y,m,d]=date.split("-").map(Number),[hh,mm]=String(time||"18:30").split(":").map(Number);
  return new Date(Date.UTC(y,m-1,d,hh-9,mm||0)).toISOString();
}
async function fetchDay(date){
  const body=new URLSearchParams({leId:"1",srId:"0",date:date.replaceAll("-","")});
  const r=await fetch("https://www.koreabaseball.com/ws/Main.asmx/GetKboGameList",{
    method:"POST",
    headers:{"content-type":"application/x-www-form-urlencoded; charset=UTF-8","x-requested-with":"XMLHttpRequest","referer":"https://www.koreabaseball.com/Schedule/GameCenter/Main.aspx"},
    body
  });
  if(!r.ok)throw new Error(`HTTP_${r.status}_${date}`);
  const j=await r.json();
  return Array.isArray(j?.game)?j.game:[];
}
function normalize(raw){
  const p=gameParts(raw.G_ID); if(!p)return null;
  if(Number(raw.SR_ID??0)!==0)return null;
  if(String(raw.CANCEL_SC_ID??"0")!=="0")return null;
  const awayRuns=Number(raw.T_SCORE_CN),homeRuns=Number(raw.B_SCORE_CN);
  if(!Number.isFinite(awayRuns)||!Number.isFinite(homeRuns))return null;
  const awayTeamId=TEAM[p.away],homeTeamId=TEAM[p.home];
  if(!awayTeamId||!homeTeamId)return null;
  const venueRaw=String(raw.S_NM||"").trim();
  return{
    providerGameId:String(raw.G_ID),gameDate:p.date,gameNo:p.gameNo,awayCode:p.away,homeCode:p.home,
    awayTeamId,homeTeamId,awayRuns,homeRuns,scheduledStart:kstIso(p.date,raw.G_TM||"18:30"),
    venue:VENUE[venueRaw]||venueRaw||null,venueRaw
  };
}
function sqlForMonth(month,games,retrievedAt){
  const lines=["BEGIN TRANSACTION;"];
  for(const g of games){
    const cid=canonicalId(g),src=`https://www.koreabaseball.com/Schedule/GameCenter/Main.aspx?gameId=${g.providerGameId}`;
    lines.push(`INSERT INTO asian_baseball_games(
      canonical_game_id,league,season,source_game_id,game_date,scheduled_start,home_team_id,away_team_id,venue,game_status,
      home_final_runs,away_final_runs,innings_status_json,source_contract,source_ref,result_observed_at,first_fetched_at,last_fetched_at,
      parser_version,is_final,research_only,can_qualify,can_authorize,created_at,updated_at,game_number,canonical_identity_version
    ) VALUES('${esc(cid)}','KBO',2025,NULL,'${g.gameDate}','${g.scheduledStart}','${g.homeTeamId}','${g.awayTeamId}',${g.venue?"'"+esc(g.venue)+"'":"NULL"},'FINAL',
      ${g.homeRuns},${g.awayRuns},NULL,'${SOURCE_CONTRACT}','${esc(src)}','${retrievedAt}','${retrievedAt}','${retrievedAt}',
      '${PARSER_VERSION}',1,1,0,0,'${retrievedAt}','${retrievedAt}',${g.gameNo},'v2')
    ON CONFLICT(canonical_game_id) DO UPDATE SET
      scheduled_start=COALESCE(excluded.scheduled_start,asian_baseball_games.scheduled_start),
      venue=COALESCE(excluded.venue,asian_baseball_games.venue),
      game_status='FINAL',home_final_runs=excluded.home_final_runs,away_final_runs=excluded.away_final_runs,
      last_fetched_at=excluded.last_fetched_at,parser_version=excluded.parser_version,
      game_number=excluded.game_number,canonical_identity_version='v2',updated_at=excluded.updated_at;`);
    lines.push(`INSERT INTO asian_baseball_game_observations(
      id,canonical_game_id,league,observation_type,relation_to_start,observed_at,fetched_at,source_contract,source_ref,parser_version,payload_json,
      research_only,pregame_eligible,created_at,updated_at
    ) VALUES('${esc(cid)}:FINAL_RESULT','${esc(cid)}','KBO','FINAL_RESULT','AT_OR_AFTER_START','${retrievedAt}','${retrievedAt}',
      '${SOURCE_CONTRACT}','${esc(src)}','${PARSER_VERSION}',
      '${esc(JSON.stringify({status:"FINAL",homeFinalRuns:g.homeRuns,awayFinalRuns:g.awayRuns,venue:g.venue,providerGameId:g.providerGameId,gameNumber:g.gameNo}))}',
      1,0,'${retrievedAt}','${retrievedAt}')
    ON CONFLICT(id) DO UPDATE SET fetched_at=excluded.fetched_at,payload_json=excluded.payload_json,updated_at=excluded.updated_at;`);
    lines.push(`INSERT INTO asian_baseball_game_provider_crosswalk(
      id,league,canonical_game_id,provider,provider_game_id,game_date,home_team_id,away_team_id,provider_home_team,provider_away_team,
      stadium,scheduled_start,match_method,match_confidence,source_contract,source_ref,parser_version,first_observed_at,last_observed_at,
      research_only,can_influence_projection,can_qualify,can_authorize,created_at,updated_at
    ) VALUES('KBO:${PROVIDER}:${g.providerGameId}','KBO','${esc(cid)}','${PROVIDER}','${g.providerGameId}','${g.gameDate}',
      '${g.homeTeamId}','${g.awayTeamId}','${g.homeCode}','${g.awayCode}',${g.venue?"'"+esc(g.venue)+"'":"NULL"},'${g.scheduledStart}',
      'OFFICIAL_G_ID_CANONICALIZED',1.0,'${SOURCE_CONTRACT}','${esc(src)}','${PARSER_VERSION}','${retrievedAt}','${retrievedAt}',1,0,0,0,'${retrievedAt}','${retrievedAt}')
    ON CONFLICT(league,provider,provider_game_id) DO UPDATE SET
      canonical_game_id=excluded.canonical_game_id,stadium=excluded.stadium,scheduled_start=excluded.scheduled_start,
      match_method=excluded.match_method,match_confidence=excluded.match_confidence,last_observed_at=excluded.last_observed_at,updated_at=excluded.updated_at;`);
  }
  const [y,m]=month.split("-"),days=new Date(Date.UTC(Number(y),Number(m),0)).getUTCDate();
  const first=`${month}-01`,last=`${month}-${pad(days)}`,cursor=new Date(Date.UTC(Number(y),Number(m),days+1)).toISOString().slice(0,10);
  lines.push(`INSERT INTO asian_baseball_backfill_shards(
    id,league,season,month,start_date,end_date,cursor_date,max_requests,status,attempts,requests_used,games_discovered,games_persisted,
    malformed_rows,duplicate_rows,source_contract,created_at,updated_at,completed_at
  ) VALUES('kbo:${month}','KBO',2025,${Number(m)},'${first}','${last}','${cursor}',31,'DONE',1,${days},${games.length},${games.length},0,0,
    '${SOURCE_CONTRACT}','${retrievedAt}','${retrievedAt}','${retrievedAt}')
  ON CONFLICT(id) DO UPDATE SET cursor_date=excluded.cursor_date,status='DONE',attempts=asian_baseball_backfill_shards.attempts+1,
    requests_used=asian_baseball_backfill_shards.requests_used+excluded.requests_used,
    games_discovered=excluded.games_discovered,games_persisted=excluded.games_persisted,malformed_rows=0,
    source_contract=excluded.source_contract,last_error=NULL,lease_until=NULL,updated_at=excluded.updated_at,completed_at=excluded.completed_at;`);
  lines.push("COMMIT;");
  return lines.join("\n");
}
const days=dateRange(START,END),all=[],errors=[];
for(const date of days){
  try{
    const raws=await fetchDay(date);
    for(const raw of raws){const g=normalize(raw);if(g)all.push(g);}
  }catch(e){errors.push({date,error:String(e?.message||e)});}
}
const seen=new Set(),dupes=[];
for(const g of all){const k=canonicalId(g);if(seen.has(k))dupes.push(k);seen.add(k);}
const byMonth={};
for(const g of all){const m=g.gameDate.slice(0,7);(byMonth[m]??=[]).push(g);}
const doubleheaders=Object.values(all.reduce((acc,g)=>{
  const k=`${g.gameDate}:${g.awayTeamId}:${g.homeTeamId}`;
  (acc[k]??=[]).push(g);return acc;
},{})).filter(xs=>xs.length>1).map(xs=>xs.map(g=>g.providerGameId));
const summary={
  write:WRITE,start:START,end:END,requests:days.length,fetchErrors:errors,totalGames:all.length,
  canonicalIdDuplicates:dupes,doubleheaderGroups:doubleheaders,
  months:Object.fromEntries(Object.entries(byMonth).map(([m,xs])=>[m,{games:xs.length,gameNo0:xs.filter(x=>x.gameNo===0).length,doubleheaderGames:xs.filter(x=>x.gameNo>0).length}]))
};
console.log("KBO_PHASE4B1_SUMMARY="+JSON.stringify(summary));
if(errors.length||dupes.length)process.exitCode=2;
if(WRITE&&!process.exitCode){
  const retrievedAt=new Date().toISOString();
  for(const month of Object.keys(byMonth).sort()){
    const path=`/tmp/kbo-${month}.sql`;
    await writeFile(path,sqlForMonth(month,byMonth[month],retrievedAt));
    const r=spawnSync("npx",["wrangler","d1","execute","fbis","--remote","--file",path],{stdio:"inherit",env:process.env});
    await rm(path,{force:true});
    if(r.status!==0)throw new Error(`D1_WRITE_FAILED_${month}`);
    console.log(`KBO_PHASE4B1_WRITTEN month=${month} games=${byMonth[month].length}`);
  }
}
