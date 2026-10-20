import { persistPropEvidence } from './propEvidenceStore.js';

export function parseNhlOfficialPlayerStat(box, scope, observedAt) {
 const allowed={shots_on_goal:'sog',goals:'goals',assists:'assists',points:'points',saves:'saves'};
 if(!scope?.identityVerified||!scope.canonicalEventId||!scope.canonicalPlayerId||
    !/^\d+$/.test(String(scope.gameId))||!/^\d+$/.test(String(scope.playerId))||
    scope.period!=='full_game'||!allowed[scope.stat])
  return {ok:false,reason:'VERIFIED_SCOPE_REQUIRED'};
 if(String(box?.id)!==String(scope.gameId)||box.gameState!=='OFF'||box.gameScheduleState!=='OK')
  return {ok:false,reason:'OFFICIAL_FINAL_GAME_REQUIRED'};
 const entries=[];
 for(const team of ['homeTeam','awayTeam'])
  for(const group of ['forwards','defense','goalies'])
   for(const p of box.playerByGameStats?.[team]?.[group]||[])
    if(String(p.playerId)===String(scope.playerId))entries.push({player:p,group});
 if(entries.length!==1)return {ok:false,reason:'EXACT_PLAYER_APPEARANCE_REQUIRED'};
 const [{player,group}]=entries;
 if((scope.stat==='saves')!==(group==='goalies'))return {ok:false,reason:'POSITION_STAT_MISMATCH'};
 const actual=player[allowed[scope.stat]];
 if(!Number.isInteger(actual)||actual<0)return {ok:false,reason:'OFFICIAL_STAT_MISSING'};
 if(!Number.isFinite(Date.parse(observedAt)))return {ok:false,reason:'OBSERVATION_TIME_INVALID'};
 return {ok:true,result:{
  canonicalEventId:scope.canonicalEventId,canonicalPlayerId:scope.canonicalPlayerId,
  canonical_market:scope.stat,period:'full_game',actual,official:true,
  source:'NHL_GAMECENTER_BOXSCORE',sourceRecordId:String(scope.gameId)+':'+String(scope.playerId)+':'+scope.stat,
  finalizedAt:observedAt,status:'FINAL',playerStatus:'PLAYED',overtimeIncluded:true,correctionPending:false
 }};
}

export async function captureNhlOfficialPlayerResults(env,{now=new Date(),fetchImpl=fetch,webCrypto=globalThis.crypto}={}) {
 if(!env?.ARCHIVE?.get||!env?.ARCHIVE?.put)return {ok:false,reason:'ARCHIVE_UNBOUND'};
 let manifest;
 try {const obj=await env.ARCHIVE.get('player-props/official/v1/nhl-scopes.json');manifest=obj?await obj.json():null;}
 catch{return {ok:false,reason:'MANIFEST_READ_FAILED'};}
 if(manifest?.version!==1||manifest.certified!==true||!Array.isArray(manifest.scopes))
  return {ok:false,reason:'CERTIFIED_MANIFEST_REQUIRED'};
 const receipts=[];
 for(const scope of manifest.scopes.slice(0,8)){
  if(!scope?.identityVerified||!/^\d+$/.test(String(scope.gameId))){
   receipts.push({ok:false,reason:'SCOPE_INVALID'});continue;
  }
  try {
   const response=await fetchImpl('https://api-web.nhle.com/v1/gamecenter/'+scope.gameId+'/boxscore',
    {headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)});
   if(!response.ok){receipts.push({ok:false,reason:'SOURCE_HTTP_'+response.status});continue;}
   const parsed=parseNhlOfficialPlayerStat(await response.json(),scope,now.toISOString());
   if(!parsed.ok){receipts.push(parsed);continue;}
   const record={schemaVersion:1,kind:'OFFICIAL_RESULT',observedAt:now.toISOString(),
    canonicalEventId:scope.canonicalEventId,canonicalPlayerId:scope.canonicalPlayerId,
    sourceId:'nhl:boxscore:'+scope.gameId,result:parsed.result};
   const saved=await persistPropEvidence(env,record,{webCrypto});
   receipts.push({ok:saved.ok,id:saved.id||null,reason:saved.reason||null});
  }catch{receipts.push({ok:false,reason:'OFFICIAL_SOURCE_UNAVAILABLE'});}
 }
 const summary={checkedAt:now.toISOString(),attempted:receipts.length,stored:receipts.filter(r=>r.ok).length,
  blocked:receipts.filter(r=>!r.ok).length,receipts,canAuthorizeWager:false};
 try {await env.ARCHIVE.put('player-props/official/v1/nhl-last-receipt.json',JSON.stringify(summary));}
 catch{return {ok:false,reason:'RECEIPT_PERSISTENCE_FAILED',...summary};}
 return {ok:summary.blocked===0&&summary.stored>0,...summary};
}
