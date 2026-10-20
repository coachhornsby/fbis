import {buildSlate} from './slateEngine.js';
import {independentPropRows,loadPropFixturesAndPlayers} from './propResearchData.js';
import {loadCapturedKalshiProps} from './kalshiPlayerPropCollector.js';
import {captureProspectivePropEvidence} from './propProspectiveEvidenceCapture.js';
import {chicagoDayBounds} from './chicagoDayBounds.js';
/** Trusted server model build; accepts no client-side forecast, market price or result. */
export async function captureNhlProspectiveJob(env,{now=new Date(),webCrypto=globalThis.crypto}={}){
 if(!env?.ARCHIVE?.get||!env?.ARCHIVE?.put||!env?.DB?.prepare)
  return {ok:false,reason:'CAPTURE_BINDINGS_UNAVAILABLE'};
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 let projections=[],markets=[],diagnostics=[];
 try{
  const slate=await buildSlate('nhl',day,{...env,caches:typeof caches==='undefined'?null:caches.default,
   parlayCacheOnly:true,cfbdScheduleFallback:false});
  projections=independentPropRows(slate,{now:now.getTime()}).filter(r=>r.sport==='nhl');
 }catch{diagnostics.push('INDEPENDENT_NHL_MODEL_UNAVAILABLE');}
 try{
  const bounds=chicagoDayBounds(day);
  const context=await loadPropFixturesAndPlayers(env,{start:bounds.start,end:bounds.end,sport:'nhl'});
  diagnostics.push(...context.diagnostics);
  if(!context.diagnostics.length){
   const exchange=await loadCapturedKalshiProps(env,{...context,sport:'nhl',now:now.getTime()});
   markets=exchange.rows.filter(r=>r.provider==='Kalshi');
   if(exchange.error)diagnostics.push(exchange.error);
  }
 }catch{diagnostics.push('NHL_CONTRACT_COVERAGE_UNAVAILABLE');}
 const result=await captureProspectivePropEvidence(env,{projections,markets,now,webCrypto});
 const receipt={attemptedAt:now.toISOString(),ok:result.ok===true,day,
  candidateProjections:projections.length,candidateMarketContracts:markets.length,
  captured:result.captured||0,blocked:result.blocked||0,diagnostics,
  canQualify:false,canAuthorizeWager:false};
 try{await env.ARCHIVE.put('player-props/evidence/v1/last-capture-receipt.json',JSON.stringify(receipt));}
 catch{return {ok:false,reason:'CAPTURE_RECEIPT_WRITE_FAILED',receipt};}
 return {...result,receipt};
}
