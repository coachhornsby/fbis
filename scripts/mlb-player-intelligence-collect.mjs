#!/usr/bin/env node
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {normalizeMlbGameFeed} from '../functions/lib/mlbGameIntelligence.js';
const args=Object.fromEntries(process.argv.slice(2).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)];}));
const out=args.out||'artifacts/mlb-intelligence',limit=Math.min(40,Math.max(1,Number(args.limit)||2));
await fs.mkdir(out,{recursive:true});
async function get(url){let last;for(let i=0;i<3;i++)try{const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`SOURCE_HTTP_${r.status}`);return await r.json();}catch(e){last=e;}throw last;}
const q=v=>v==null?'NULL':"'"+String(v).replaceAll("'","''")+"'";
const insert=(table,columns,values)=>`INSERT OR IGNORE INTO ${table}(${columns.join(',')}) VALUES(${values.map(q).join(',')});`;
const run=(...argv)=>{const r=spawnSync('npx',['wrangler',...argv],{stdio:'inherit'});if(r.status!==0)throw Error('WRANGLER_FAILED');};
let games=[];
if(args.gameId){if(!/^\d+$/.test(args.gameId))throw Error('NUMERIC_GAME_ID_REQUIRED');games=[args.gameId];}
else{
 const day=args.start||new Date(Date.now()-86400000).toISOString().slice(0,10),end=args.end||day;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||Date.parse(end)<Date.parse(day)||Date.parse(end)-Date.parse(day)>6*86400000)throw Error('MAX_SEVEN_DAY_BATCH');
 const s=await get(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${day}&endDate=${end}&gameTypes=R,F,D,L,W`);
 games=(s.dates||[]).flatMap(d=>d.games||[]).filter(g=>g.status?.codedGameState==='F').map(g=>String(g.gamePk));
}
let database=null,token=null,account=null,databaseId=null;
if(args.persist==='true'){
 // This collector is certified for current legacy ownership only. Stop on a future cutover.
 token=process.env.CLOUDFLARE_API_TOKEN;account=process.env.CLOUDFLARE_ACCOUNT_ID;if(!token||!account)throw Error('CLOUDFLARE_CREDENTIALS_REQUIRED');
 const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/fbis`,{headers:{authorization:`Bearer ${token}`}});const b=await r.json();
 if(!r.ok||!b.success||b.result.deployment_configs.production.env_vars.SPORT_DB_MODE_MLB?.value!=='shadow')throw Error('MLB_OWNER_CHANGED_REQUALIFICATION_REQUIRED');
 databaseId=b.result.deployment_configs.production.d1_databases?.DB?.id;
 if(!databaseId)throw Error('AUTHORITATIVE_PRIMARY_BINDING_REQUIRED');
 const capacityResponse=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${databaseId}`,{headers:{authorization:`Bearer ${token}`}});
 const capacity=await capacityResponse.json(),bytes=Number(capacity.result?.file_size);
 // Stop below the hard limit; reserve 2 MB per admitted game plus 200 MB headroom.
 if(!capacityResponse.ok||!capacity.success||!Number.isFinite(bytes)||bytes+limit*2000000+200000000>9000000000)throw Error('PRIMARY_D1_CAPACITY_ADMISSION_REJECTED');
 database='fbis';
 run('d1','execute',database,'--remote','--file=migrations/0124_mlb_player_intelligence.sql');
}
const receipt={version:'mlb-intelligence-collector-v1',startedAt:new Date().toISOString(),expectedFinalGames:games.length,processed:[],errors:[],remainingGameIds:games.slice(limit),complete:false};
for(const id of games.slice(0,limit)){
 try{
  const feed=await get(`https://statsapi.mlb.com/api/v1.1/game/${id}/feed/live`),raw=JSON.stringify(feed),hash=createHash('sha256').update(JSON.stringify({gameData:feed.gameData,liveData:feed.liveData})).digest('hex');
  if(Buffer.byteLength(raw)>25000000)throw Error('GAME_SOURCE_BYTE_BUDGET_EXCEEDED');
  if(database){
   const existingResponse=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${databaseId}/query`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({sql:'SELECT game_id FROM mlb_intelligence_game_versions WHERE game_id=? AND source_hash=?',params:[id,hash]})});
   const existing=await existingResponse.json();if(!existingResponse.ok||!existing.success)throw Error('EXISTING_VERSION_CHECK_FAILED');
   // Never overwrite archived raw bytes or first-observed normalized evidence on a retry.
   if(existing.result?.[0]?.results?.length){receipt.processed.push({gameId:id,hash,persisted:true,reusedExistingVersion:true});await fs.writeFile(`${out}/receipt.json`,JSON.stringify(receipt,null,2));continue;}
  }
  const normalized=normalizeMlbGameFeed(feed,{sourceHash:hash}),base=`models/mlb/intelligence/games/${id}/${hash}`;
  const rawFile=`${out}/${id}-${hash}-raw.json.gz`,normalizedFile=`${out}/${id}-${hash}.json.gz`,sqlFile=`${out}/${id}-${hash}.sql`;
  await fs.writeFile(rawFile,gzipSync(raw));await fs.writeFile(normalizedFile,gzipSync(JSON.stringify(normalized)));
  const sql=[insert('mlb_intelligence_game_versions',['game_id','source_hash','season','game_type','official_date','start_time','observed_at','raw_r2_key','normalized_r2_key','player_records','pitch_records'],[id,hash,normalized.season,normalized.gameType,normalized.officialDate,normalized.start,normalized.observedAt,base+'/raw.json.gz',base+'/normalized.json.gz',normalized.players.length,normalized.pitches.length])];
  for(const p of normalized.players){sql.push(insert('mlb_player_game_records',['player_id','game_id','stat_group','source_hash','team_id','opponent_id','is_home','official_date','game_type','observed_at','stats_json'],[p.playerId,id,p.group,hash,p.teamId,p.opponentId,p.isHome?1:0,normalized.officialDate,normalized.gameType,normalized.observedAt,JSON.stringify(p.stats)]));sql.push(insert('mlb_roster_membership_observations',['player_id','team_id','effective_date','game_id','observed_at','source_hash'],[p.playerId,p.teamId,normalized.officialDate,id,normalized.observedAt,hash]));}
  const record={gameId:id,hash,players:normalized.players.length,pitches:normalized.pitches.length,observedAt:normalized.observedAt,persisted:false};
  sql.push(insert('mlb_intelligence_ingestion_receipts',['game_id','source_hash','imported_at','receipt_json'],[id,hash,normalized.observedAt,JSON.stringify({...record,persisted:true})]));
  await fs.writeFile(sqlFile,sql.join('\n')+'\n');
  if(database){
   // Archive evidence before D1 references it. Corrections receive a new hash/key.
   run('r2','object','put',`fbis-archive/${base}/raw.json.gz`,'--file',rawFile,'--remote');
   run('r2','object','put',`fbis-archive/${base}/normalized.json.gz`,'--file',normalizedFile,'--remote');
   run('d1','execute',database,'--remote',`--file=${sqlFile}`);record.persisted=true;
  }
  receipt.processed.push(record);
 }catch(error){receipt.errors.push({gameId:id,error:String(error.message)});}
 await fs.writeFile(`${out}/receipt.json`,JSON.stringify(receipt,null,2));
}
receipt.complete=receipt.errors.length===0&&receipt.remainingGameIds.length===0;receipt.finishedAt=new Date().toISOString();
await fs.writeFile(`${out}/receipt.json`,JSON.stringify(receipt,null,2));
console.log(JSON.stringify(receipt));if(receipt.errors.length)process.exitCode=1;
