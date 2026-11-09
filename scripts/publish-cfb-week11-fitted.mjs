// Owner-requested week11 publication. Exact frozen coefficients; no invented inputs or wager authority.
import{mkdir,readFile,writeFile}from'node:fs/promises';import{createHash}from'node:crypto';
import{captureCfbdPpaGames}from'./lib/cfbdFittedRecovery.mjs';
import{captureCfbdFrozenPrior,captureCfbdCompletionSchedule,buildCfbdFittedWeek}from'./lib/cfbdFrozenPrior.mjs';
import{validateFourSportPacket}from'../functions/lib/privateFourSportProjection.js';
import{publicProjectionSummary}from'../functions/lib/publicFourSportProjection.js';
const key=process.env.CFBD_CBBD_KEY,account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
const refresh=process.env.FBIS_CFB_REFRESH_CURRENT==='1';
const maxProviderCalls=refresh?2:5;
const receipt={startedAt:new Date().toISOString(),maxProviderCalls,providerCalls:0,sources:[],published:[],errors:[],canAuthorizeWager:false};
const reserve=p=>{if(p!=='CFBD'||receipt.providerCalls>=maxProviderCalls)throw Error('CFBD_CALL_BUDGET_EXCEEDED');receipt.providerCalls++;};
const sha=x=>createHash('sha256').update(x).digest('hex');const url=p=>'https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(account)+'/r2/buckets/fbis-archive/objects/'+p.split('/').map(encodeURIComponent).join('/');
async function read(p){const r=await fetch(url(p),{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('R2_READ_'+r.status);const s=await r.text();if(Buffer.byteLength(s)>5000000)throw Error('R2_SOURCE_OVERSIZE');return s;}
async function put(p,packet){const body=JSON.stringify(packet);const r=await fetch(url(p),{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/octet-stream'},body,signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('R2_WRITE_'+r.status);if(sha(await read(p))!==sha(body))throw Error('R2_READBACK_MISMATCH');return{key:p,sha256:sha(body)};}
try{
 if(!key||!account||!token)throw Error('EXISTING_SOURCE_OR_STORAGE_CREDENTIALS_MISSING');
 const fixturePacket=JSON.parse(await readFile('data/research/cfb-week11-fixtures-20261109.json','utf8'));
 let ppaPacket,prior,schedule;
 if(refresh){
  const priorPacket=JSON.parse(await read('private/college-sources/cfbd/frozen-prior/2025/latest.json'));
  if(priorPacket.sourceSeason!==2025||priorPacket.frozen!==true||priorPacket.featureContract!=='ppa-derived-base-v2'||!priorPacket.rows?.length)throw Error('STORED_FROZEN_PRIOR_INVALID');
  const ppa=await captureCfbdPpaGames({key,reserve});
  ppaPacket=ppa.packet;prior={packet:priorPacket};
  schedule=await captureCfbdCompletionSchedule({key,reserve});
  receipt.sources.push(ppa.receipt,schedule.receipt,{source:'STORED_FROZEN_PRIOR',sourceSeason:2025,requests:0,sha256:sha(JSON.stringify(priorPacket))});
  await put('private/college-sources/cfbd/ppa-games/2026/latest.json',ppaPacket);
 }else{
  ppaPacket=JSON.parse(await read('private/college-sources/cfbd/ppa-games/2026/latest.json'));
  if(Date.now()-Date.parse(ppaPacket.capturedAt)>6*3600000)throw Error('CURRENT_PPA_CAPTURE_EXPIRED');
  prior=await captureCfbdFrozenPrior({key,reserve});schedule=await captureCfbdCompletionSchedule({key,reserve});
  receipt.sources.push(prior.receipt,schedule.receipt);
  await put('private/college-sources/cfbd/frozen-prior/2025/latest.json',prior.packet);
 }
 await put('private/college-sources/cfbd/completion/2026/latest.json',schedule.packet);
 const generatedAt=new Date().toISOString(),expiresAt=new Date(Date.parse(ppaPacket.capturedAt)+6*3600000).toISOString();
 const result=buildCfbdFittedWeek({fixtures:fixturePacket.games,ppaPacket,priorPacket:prior.packet,schedulePacket:schedule.packet});
 receipt.coverage=result.sourceCoverage;receipt.missing=result.missing;receipt.uploadUsage=fixturePacket.uploadUsage;
 for(const date of [...new Set(result.projections.map(p=>p.game.date))]){
  const events=result.projections.filter(p=>p.game.date===date).map(({eventId,game,result:r})=>({eventId,date,start:game.start,homeId:'cfb-'+game.home.espnId,awayId:'cfb-'+game.away.espnId,sourceCapturedAt:ppaPacket.capturedAt,canAuthorizeWager:false,sourceLabel:'CFBD verified per-game PPA and frozen prior; CFB-FBIS-v2',provenance:r.provenance,projection:{homeScore:r.model.home,awayScore:r.model.away,margin:r.model.margin,total:r.model.total,modelId:r.model.modelId,modelVersion:r.model.version}}));
  const packet={version:1,visibility:'PRIVATE_PERSONAL_ANALYSIS',sport:'cfb',date,generatedAt,expiresAt,modelAuthority:'FROZEN_RESEARCH',canAuthorizeWager:false,canQualify:false,events};
  validateFourSportPacket(packet,{sport:'cfb',date});const summary=publicProjectionSummary(packet,{sport:'cfb',date});if(summary.events.length!==events.length)throw Error('PUBLIC_PROVENANCE_REJECTED');
  receipt.published.push({date,events:events.length,...await put('private/cfb/projections/'+date+'.json',packet),sample:summary.events.slice(0,2)});
 }
 if(!result.projections.length)throw Error('NO_SUPPORTED_FITTED_PROJECTIONS');
}catch(e){receipt.errors.push(String(e.message||e).replaceAll(key||'__NO_KEY__','[redacted]'));}
receipt.finishedAt=new Date().toISOString();await mkdir('artifacts/cfb-week11-fitted',{recursive:true});await writeFile('artifacts/cfb-week11-fitted/receipt.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));if(receipt.errors.length)process.exitCode=1;
