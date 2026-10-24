/** Free ATP/WTA current-season research collector.
 * Reads both season and ongoing TML files. Sources are archived independently,
 * records are source-clocked, and official settlement remains untouched.
 */
import {parseTennisCsv,selectCurrentTennisRows} from './tennisFreeCurrentResearch.js';
const sha=async data=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',
 new TextEncoder().encode(data)))].map(b=>b.toString(16).padStart(2,'0')).join('');
const base='https://stats.tennismylife.org/data/';
export async function captureFreeTennisCurrentSeason(env,{tour,now=new Date(),fetchImpl=fetch}={}){
 if(env?.TENNIS_FREE_RESEARCH_ENABLED!=='true')throw Error('FREE_RESEARCH_DISABLED');
 if(!['atp','wta'].includes(tour)||!Number.isFinite(+now))throw Error('TOUR_OR_CLOCK_INVALID');
 if(!env.TENNIS_DB?.prepare||!env.ARCHIVE?.put)throw Error('DEDICATED_TENNIS_RESEARCH_STORAGE_REQUIRED');
 const year=now.getUTCFullYear();
 const filenames=[String(year)+(tour==='wta'?'_wta':'')+'.csv',
  tour==='wta'?'wta_ongoing_tourneys.csv':'ongoing_tourneys.csv'];
 const at=now.toISOString(),sourceFiles=[],matched=new Map();
 for(let i=0;i<filenames.length;i++){
  const filename=filenames[i],url=base+filename;
  const resp=await fetchImpl(url,{headers:{accept:'text/csv',
    'user-agent':'FBIS-Tennis-Private-Research/1.0'},signal:AbortSignal.timeout(25000)});
  if(!resp.ok)throw Error('RESEARCH_SOURCE_HTTP_'+tour+'_'+filename+'_'+resp.status);
  const len=Number(resp.headers?.get('content-length')||0);
  if(len>6000000)throw Error('RESEARCH_SOURCE_TOO_LARGE');
  const raw=await resp.text();
  if(raw.length>6000000)throw Error('RESEARCH_SOURCE_TOO_LARGE');
  const rows=parseTennisCsv(raw);
  if(i===0&&rows.length<100)throw Error('SEASON_SOURCE_ROWS_UNAVAILABLE');
  const selected=selectCurrentTennisRows(rows,{tour,now});
  const fileChecksum=await sha(raw);
  const rawKey='tennis/research/tennismylife/'+tour+'/'+year+'/'+fileChecksum+'.csv';
  await env.ARCHIVE.put(rawKey,raw,{httpMetadata:{contentType:'text/csv'}});
  for(const item of selected.matches)matched.set(item.sourceEventKey,{
   ...item,fileChecksum,rawKey,stream:i===0?'SEASON':'ONGOING'});
  sourceFiles.push({filename,url,stream:i===0?'SEASON':'ONGOING',
   sourceRows:rows.length,candidates:selected.seen,validated:selected.matches.length,
   excluded:selected.reasons,fileChecksum,rawKey,
   latestSourceDateLabel:rows.map(x=>String(x.tourney_date||''))
     .filter(x=>/^\d{8}$/.test(x)).sort().at(-1)||null});
 }
 if(!matched.size)throw Error('NO_CURRENT_VERIFIED_SERVE_STATS');
 if(matched.size>800)throw Error('CURRENT_RESEARCH_SHARD_TOO_LARGE');
 const queryObs=`INSERT OR IGNORE INTO tennis_free_current_observations(
 observation_key,source_event_key,source_row_checksum,raw_file_checksum,raw_r2_key,
 observed_at,parsed_json,provider,contract_trading_authorized)
 VALUES(?,?,?,?,?,?,?,'TENNISMYLIFE',0)`;
 const queryCurrent=`INSERT INTO tennis_free_current_matches(
 source_event_key,provider,tour,source_date_label,tournament_id,match_num,
 winner_source_id,loser_source_id,winner_name,loser_name,surface,result_score,
 winner_stats_json,loser_stats_json,source_row_checksum,raw_file_checksum,
 raw_r2_key,first_observed_at,last_observed_at,contract_trading_authorized)
 VALUES(?,'TENNISMYLIFE',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)
 ON CONFLICT(source_event_key) DO UPDATE SET
 winner_source_id=excluded.winner_source_id,loser_source_id=excluded.loser_source_id,
 winner_name=excluded.winner_name,loser_name=excluded.loser_name,
 surface=excluded.surface,result_score=excluded.result_score,
 winner_stats_json=excluded.winner_stats_json,loser_stats_json=excluded.loser_stats_json,
 source_row_checksum=excluded.source_row_checksum,
 raw_file_checksum=excluded.raw_file_checksum,raw_r2_key=excluded.raw_r2_key,
 last_observed_at=excluded.last_observed_at
 WHERE excluded.last_observed_at>=tennis_free_current_matches.last_observed_at`;
 let processed=0,newVersions=0,upsertChanges=0;const queued=[];
 async function flush(){
  if(!queued.length)return;
  let receipts=[];
  if(typeof env.TENNIS_DB.batch==='function')receipts=await env.TENNIS_DB.batch(queued.splice(0));
  else for(const q of queued.splice(0))receipts.push(await q.run());
  for(let i=0;i<receipts.length;i+=2){
   newVersions+=Number(receipts[i]?.meta?.changes??receipts[i]?.changes??0);
   upsertChanges+=Number(receipts[i+1]?.meta?.changes??receipts[i+1]?.changes??0);
  }
 }
 for(const item of matched.values()){
  const {fileChecksum,rawKey,stream,...observation}=item;
  const stable=JSON.stringify(observation),rowSha=await sha(stable);
  const obsKey=await sha(item.sourceEventKey+'|'+rowSha);
  queued.push(env.TENNIS_DB.prepare(queryObs).bind(obsKey,item.sourceEventKey,rowSha,
   fileChecksum,rawKey,at,stable));
  queued.push(env.TENNIS_DB.prepare(queryCurrent).bind(
   item.sourceEventKey,item.tour,item.dateLabel,item.tournamentId,item.matchNum,
   item.winnerSourceId,item.loserSourceId,item.winnerName,item.loserName,
   item.surface,item.score,JSON.stringify(item.winnerStats),
   JSON.stringify(item.loserStats),rowSha,fileChecksum,rawKey,at,at));
  processed++;
  if(queued.length>=40)await flush();
 }
 await flush();
 return {ok:true,source:'TENNISMYLIFE',tour,year,asOf:at,sourceFiles,
  validatedWithStats:matched.size,processed,newVersions,upsertChanges,
  exactMatchTimesAvailable:false,officialSettlementsCreated:0,
  researchOnly:true,contractTradingAuthorized:false};
}
