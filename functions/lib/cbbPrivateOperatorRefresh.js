/**
 * Owner-initiated, bounded CBB input refresh.
 * NO D1 bindings, paid collection jobs, market quotes or automatic polling.
 * Two conditional R2 attempt slots per Central calendar day; one KenPom ratings
 * request maximum per attempt. CBBD adjusted-current is not inferred from prior years.
 */
import {boardDate,captureScoreboards} from './publicBoardSnapshot.js';
import {normalizeKenpomRatingRows,indexKenpomRows} from './kenpomCbb.js';
import {normalizeTorvikTeamRows,indexTorvikRows} from './torvikCbb.js';
import {buildCbbProjectionPacket} from './cbbProjectionPacket.js';
import {validatePrivatePacket} from '../../src/lib/privateBoardProjection.js';

const MAX_ATTEMPTS=2,SHORT_PAUSE_MS=3*60*60*1000;
const MAX_KENPOM_BYTES=3*1024*1024,MAX_TORVIK_BYTES=2*1024*1024;
const objectKey=d=>'private/cbb/projections/'+d+'.json';
const attemptKey=(d,n)=>'private/cbb/refresh-budget/'+d+'/attempt-'+n+'.json';
const response=(state,other={},status=200)=>({state,status,...other});
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const hash=async raw=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))).map(b=>b.toString(16).padStart(2,'0')).join('');
async function textLimited(res,cap){
 const header=Number(res.headers?.get('content-length')||0);if(header>cap)throw Error('SOURCE_RESPONSE_TOO_LARGE');
 const raw=await res.text();if(new TextEncoder().encode(raw).byteLength>cap)throw Error('SOURCE_RESPONSE_TOO_LARGE');
 return raw;
}
async function fetchSource(url,kind,{fetchFn,key,cap}){
 const u=new URL(url);
 if(u.protocol!=='https:'||(kind==='kenpom'?u.hostname!=='kenpom.com':u.hostname!=='barttorvik.com'))throw Error('SOURCE_NOT_ALLOWED');
 const res=await fetchFn(url,{redirect:'error',headers:{Accept:kind==='kenpom'?'application/json':'text/csv',
  ...(kind==='kenpom'?{Authorization:'Bearer '+key}:{})},signal:AbortSignal.timeout(18000)});
 if(!res.ok)throw Error(kind.toUpperCase()+'_HTTP_'+res.status);
 return {raw:await textLimited(res,cap),capturedAt:new Date().toISOString()};
}
/**
 * Use a recent, source-verified schedule asset from THIS production build.
 * Cloudflare Pages Functions cannot always reach ESPN directly even when the
 * Pages build already obtained a complete ESPN CBB slate. Schedule assets
 * contain no paid ratings and were verified during static publication.
 */
export async function readRecentCbbScheduleAsset(date,{assets,now=Date.now(),origin='https://fbis-myz.pages.dev'}={}){
 if(!assets?.fetch||date!==boardDate(now))return null;
 let res;
 try{
  res=await assets.fetch(new Request(new URL('/board-data/'+date+'.json',origin),{redirect:'error',headers:{Accept:'application/json'}}));
 }catch{return null;}
 if(!res?.ok||!String(res.headers?.get('content-type')||'').toLowerCase().includes('json'))return null;
 const maxBytes=4*1024*1024,header=Number(res.headers?.get('content-length')||0);
 if(header>maxBytes)return null;
 let raw;try{raw=await res.text();}catch{return null;}
 if(new TextEncoder().encode(raw).byteLength>maxBytes)return null;
 let b;try{b=JSON.parse(raw);}catch{return null;}
 const t=Date.parse(b?.generatedAt);
 if(b?.version!==1||b?.date!==date||b?.publicationMode!=='SCHEDULE_AND_SCORES_ONLY'||
   !Number.isFinite(t)||t>now+60_000||now-t>3*60*60*1000||
   b?.feeds?.cbb?.ok!==true||b?.feeds?.cbb?.source!=='ESPN_SCOREBOARD'||
   !Array.isArray(b?.sources)||b.sources.filter(x=>x.sport==='cbb'&&x.ok===true).length<2||
   !Array.isArray(b?.games)||b.games.length>500)return null;
 const cbb=b.games.filter(g=>g?.sport==='cbb');
 if(cbb.length===0||cbb.length>300||cbb.some(g=>g.date!==date||g.source!=='ESPN_SCOREBOARD'||
  !/^\\d+$/.test(String(g.id||''))||!/^\\d+$/.test(String(g.home?.espnId||''))||
  !/^\\d+$/.test(String(g.away?.espnId||''))||!Number.isFinite(Date.parse(g.start))||
  typeof g.neutralSite!=='boolean'))return null;
 return {games:cbb,generatedAt:b.generatedAt,source:'VERIFIED_SAVED_ESPN_SCOREBOARD'};
}
function typedRows(index,provider){
 return Object.entries(index.byCanonicalId||{}).map(([teamId,p])=>({provider,season:2027,teamId,payload:{...p,canonicalId:teamId,season:2027}}));
}
export async function buildFreshCbbResearch(date,{key,fetchFn=fetch,now=Date.now(),assets=null}={}){
 if(!key)throw Error('KENPOM_KEY_NOT_CONFIGURED');
 if(date!==boardDate(now))throw Error('ONLY_CURRENT_CENTRAL_DAY');
 // The site already published a complete source-verified ESPN schedule.
 // Reuse it for up to three hours, before attempting direct ESPN from Pages.
 const saved=await readRecentCbbScheduleAsset(date,{assets,now});
 let board=null;
 if(!saved){
  board=await captureScoreboards({date,sports:['cbb'],fetchFn,now});
  if(!board.feeds.cbb?.ok){
   const failures=(board.sources||[]).filter(x=>x.sport==='cbb'&&!x.ok)
    .map(x=>String(x.error||'UNKNOWN').replace(/[^A-Z0-9_]/gi,'_').slice(0,48));
   throw Error('ESPN_CBB_SCHEDULE_UNAVAILABLE'+(failures.length?'_'+[...new Set(failures)].join('_').slice(0,75):''));
  }
 }
 const games=(saved?.games||board.games).filter(g=>g.sport==='cbb'&&g.status==='scheduled'&&Date.parse(g.start)>now);
 if(!games.length)throw Error('NO_VERIFIED_FUTURE_CBB_GAMES');
 const kp=await fetchSource('https://kenpom.com/api.php?endpoint=ratings&y=2027','kenpom',{fetchFn,key,cap:MAX_KENPOM_BYTES});
 let raw;try{raw=JSON.parse(kp.raw);}catch{throw Error('KENPOM_JSON_INVALID');}
 if(!Array.isArray(raw)||raw.length<330||raw.length>500||raw.some(x=>Number(x.Season??x.season)!==2027))throw Error('KENPOM_2027_COVERAGE_INVALID');
 const kpIndex=indexKenpomRows(normalizeKenpomRatingRows(raw),2026);
 if(kpIndex.matched<330||kpIndex.unmatched>30)throw Error('KENPOM_TEAM_IDENTITY_COVERAGE_INVALID');
 const providerRows=typedRows(kpIndex,'kenpom');
 const captures={kenpom:kp.capturedAt},sourceReceipts=[{provider:'KenPom',source:'2027 ratings',rows:raw.length,matched:kpIndex.matched,capturedAt:kp.capturedAt,sha256:await hash(kp.raw),status:'VERIFIED_INPUT'}];
 // One optional public Torvik CSV read. Failure does not alter the primary KenPom output.
 try{
  const tv=await fetchSource('https://barttorvik.com/2027_team_results.csv','torvik',{fetchFn,cap:MAX_TORVIK_BYTES});
  const index=indexTorvikRows(normalizeTorvikTeamRows(tv.raw),2026);
  if(index.matched<330||index.unmatched>30)throw Error('TORVIK_TEAM_IDENTITY_COVERAGE_INVALID');
  providerRows.push(...typedRows(index,'torvik'));captures.torvik=tv.capturedAt;
  sourceReceipts.push({provider:'Torvik',source:'2027 team_results.csv',matched:index.matched,capturedAt:tv.capturedAt,sha256:await hash(tv.raw),status:'VERIFIED_COMPARISON_INPUT'});
 }catch(e){sourceReceipts.push({provider:'Torvik',status:'UNAVAILABLE',reason:String(e?.message||e).slice(0,120)});}
 sourceReceipts.push({provider:'CBBD',status:'CURRENT_ADJUSTED_NOT_VERIFIED',reason:'2027 adjusted-current returned zero rows on prior verified capture; no CBBD call in this bounded owner refresh'});
 const asOf=new Date().toISOString();
 const packet=buildCbbProjectionPacket({games,providerRows,captures,asOf,season:2027});
 validatePrivatePacket(packet);
 if(packet.summary.primaryProjections<1)throw Error('NO_VALID_SOURCE_MATCHED_CBB_PREDICTIONS');
 // One private report per day; no raw provider licensed rows are persisted.
 const evidence={date,generatedAt:asOf,expiresAt:packet.expiresAt,events:games.length,
  scheduleSource:saved?.source||'LIVE_ESPN_SCOREBOARD',scheduleCapturedAt:saved?.generatedAt||board?.generatedAt||null,
  primaryProjections:packet.summary.primaryProjections,torvikComparisons:packet.summary.torvikComparisons,
  cbbdConfirmations:packet.summary.currentCbbdConfirmations,qualified:0,
  sources:sourceReceipts,canAuthorizeWager:false,automaticCollection:false,d1RowsRead:0,d1RowsWritten:0,marketQuotesCollected:0};
 return {packet,evidence};
}
async function readJson(bucket,key){
 const obj=await bucket.get(key);if(!obj)return null;
 if(obj.size>1024*1024)throw Error('PRIVATE_OBJECT_TOO_LARGE');
 const raw=await obj.text();if(raw.length>1024*1024)throw Error('PRIVATE_OBJECT_TOO_LARGE');
 return JSON.parse(raw);
}
export async function refreshCbbOnce({bucket,date,key,fetchFn=fetch,now=Date.now(),builder=buildFreshCbbResearch,assets=null}){
 if(!bucket||!iso(new Date(now).toISOString()))return response('STORAGE_UNAVAILABLE',{},503);
 if(date!==boardDate(now))return response('INVALID_REFRESH_DATE',{},400);
 if(!key)return response('KENPOM_KEY_NOT_CONFIGURED',{},503);
 const saved=await readJson(bucket,objectKey(date));
 if(saved?.version===1&&saved?.visibility==='PRIVATE_PERSONAL_ANALYSIS'&&Date.parse(saved.expiresAt)>now+15*60*1000)
  return response('ALREADY_FRESH',{date,expiresAt:saved.expiresAt,primaryProjections:saved.summary?.primaryProjections||0,providerCalls:0});
 const attempts=[];
 for(let slot=1;slot<=MAX_ATTEMPTS;slot++){
  const previous=await readJson(bucket,attemptKey(date,slot));
  if(previous){attempts.push(previous);continue;}
  if(attempts.some(a=>Number.isFinite(Date.parse(a.startedAt))&&now-Date.parse(a.startedAt)<SHORT_PAUSE_MS))
   return response('REFRESH_PAUSED',{date,reason:'Minimum three hours between manual attempts',providerCalls:0},429);
  const claim=await bucket.put(attemptKey(date,slot),JSON.stringify({date,slot,startedAt:new Date(now).toISOString(),status:'ATTEMPT_RESERVED'}),{
   httpMetadata:{contentType:'application/json'},onlyIf:{etagDoesNotMatch:'*'}});
  if(!claim){attempts.push({date,slot,startedAt:new Date(now).toISOString()});continue;}
  try{
   const {packet,evidence}=await builder(date,{key,fetchFn,now,assets});
   const body=JSON.stringify(packet),written=await bucket.put(objectKey(date),body,{httpMetadata:{contentType:'application/json'}});
   if(!written)throw Error('R2_WRITE_FAILED');
   const confirmed=await readJson(bucket,objectKey(date));
   if(!confirmed||JSON.stringify(confirmed)!==body)throw Error('R2_READBACK_MISMATCH');
   await bucket.put('private/cbb/refresh-receipts/'+date+'.json',JSON.stringify({...evidence,attempt:slot,status:'SUCCESS'}),{httpMetadata:{contentType:'application/json'}});
   return response('REFRESHED',{date,attempt:slot,expiresAt:packet.expiresAt,primaryProjections:packet.summary.primaryProjections,torvikComparisons:packet.summary.torvikComparisons,cbddConfirmations:packet.summary.currentCbbdConfirmations,providerCalls:'1 KenPom, <=1 Torvik, 2 ESPN',canAuthorizeWager:false});
  }catch(e){
   const reason=String(e?.message||e).slice(0,150);
   await bucket.put('private/cbb/refresh-receipts/'+date+'.json',JSON.stringify({date,attempt:slot,status:'FAILED',reason,canAuthorizeWager:false}),{httpMetadata:{contentType:'application/json'}});
   return response('REFRESH_FAILED',{date,attempt:slot,reason},503);
  }
 }
 return response('DAILY_REFRESH_CAP',{date,maxAttempts:MAX_ATTEMPTS,providerCalls:0},429);
}
