/** Durable last-observed-before-tip source lines for NBA player research.
 * Separate exchange ledger per game date. No wager/execution authority.
 * Capture only called on freshly acquired, exact-player/event/contract-mapped rows.
 */
const ROOT='player-props/pregame-lines/v1/nba/';
const SOURCES=new Set(['Kalshi','Polymarket']);
export const nbaLineLedgerKey=(provider,date)=>ROOT+provider.toLowerCase()+'/'+date+'.json';
const ts=v=>Date.parse(v||'');
const money=v=>v!=null&&v!==''&&Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null;
const valid=(r,provider,date,at)=>{
 const observed=ts(r?.collectedAt),start=ts(r?.start_time);
 return r?.sport==='nba'&&r?.provider===provider&&r.identityVerified===true&&
  typeof r.id==='string'&&r.id.length>0&&typeof r.contractId==='string'&&r.contractId.length>0&&
  String(r.canonicalEventId||'').length>0&&/^nba:espn:\d+$/.test(String(r.canonicalPlayerId||''))&&
  typeof r.canonical_market==='string'&&r.period==='full_game'&&money(r.line)!=null&&
  ['yes','no','over','under'].includes(r.side)&&
  Number.isFinite(start)&&Number.isFinite(observed)&&observed<start&&
  observed<=at&&at<start&&Math.abs(at-observed)<=60000;
};
export function updateNbaPregameLineLedger(prior=[],incoming=[],{provider,date,now}={}){
 const t=ts(now);
 if(!SOURCES.has(provider)||!Number.isFinite(t)||!/^\d{4}-\d{2}-\d{2}$/.test(date||''))
  return {rows:[],added:0,updated:0,invalid:true};
 const map=new Map();
 for(const r of prior)if(valid(r,provider,date,ts(r.collectedAt))&&r.canAuthorizeWager===false)
  map.set(r.id,r);
 let added=0,updated=0;
 for(const r of incoming){
  if(!valid(r,provider,date,t))continue;
  const older=map.get(r.id);
  // Lock at tip. An equal/older collection cannot replace prior evidence.
  if(older&&ts(older.collectedAt)>=ts(r.collectedAt))continue;
  const snapshot={...r,lineFrozen:false,freezeBasis:'LAST_SOURCE_CAPTURE_BEFORE_TIP',
   sourceCaptureAt:r.collectedAt,fresh:false,marketAvailable:false,
   purchaseAsk:null,executableSize:null,canQualify:false,canAuthorizeWager:false};
  map.set(r.id,snapshot);if(older)updated++;else added++;
 }
 return {rows:[...map.values()],added,updated,invalid:false};
}
export async function captureNbaPregameMarketLines(env,{provider,date,rows=[],now=new Date()}={}){
 if(!env?.ARCHIVE?.get||!env?.ARCHIVE?.put)return {ok:false,reason:'ARCHIVE_UNAVAILABLE'};
 if(!SOURCES.has(provider)||!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!Array.isArray(rows)||rows.length>20000)
  return {ok:false,reason:'INVALID_CAPTURE_INPUT'};
 const key=nbaLineLedgerKey(provider,date);
 try{
  const obj=await env.ARCHIVE.get(key),prior=obj?await obj.json():null;
  if(prior&&(prior.schemaVersion!==1||prior.provider!==provider||prior.date!==date))
   return {ok:false,reason:'EXISTING_LEDGER_IDENTITY_CONFLICT'};
  const current=updateNbaPregameLineLedger(prior?.rows||[],rows,{provider,date,now:now.toISOString()});
  if(current.invalid)return {ok:false,reason:'INVALID_CAPTURE_TIME'};
  if(current.added||current.updated){
   const body={schemaVersion:1,provider,date,updatedAt:now.toISOString(),
    rows:current.rows,canQualify:false,canAuthorizeWager:false};
   await env.ARCHIVE.put(key,JSON.stringify(body),{httpMetadata:{contentType:'application/json'}});
  }
  return {ok:true,provider,date,total:current.rows.length,added:current.added,updated:current.updated};
 }catch{return {ok:false,reason:'LEDGER_READ_OR_WRITE_FAILED'};}
}
export async function readNbaFrozenMarketLines(env,{provider,date,now=Date.now()}={}){
 if(!env?.ARCHIVE?.get||!SOURCES.has(provider)||!/^\d{4}-\d{2}-\d{2}$/.test(date||''))
  return {rows:[],status:'UNAVAILABLE'};
 try{
  const obj=await env.ARCHIVE.get(nbaLineLedgerKey(provider,date));
  if(!obj)return {rows:[],status:'NOT_CAPTURED'};
  const ledger=await obj.json();
  if(ledger.schemaVersion!==1||ledger.date!==date||ledger.provider!==provider||ledger.canAuthorizeWager!==false||!Array.isArray(ledger.rows))
   return {rows:[],status:'INVALID_LEDGER'};
  const at=typeof now==='number'?now:ts(now);
  const rows=ledger.rows.filter(r=>valid(r,provider,date,ts(r.collectedAt))&&
    r.canAuthorizeWager===false&&ts(r.start_time)<=at).map(r=>({
    ...r,lineFrozen:true,freezeBasis:'LAST_SOURCE_CAPTURE_BEFORE_TIP',
    sourceCaptureAt:r.collectedAt,frozenAt:r.start_time,
    historicalReference:true,fresh:false,marketAvailable:false,
    purchaseAsk:null,executableSize:null,priceVerified:false,
    canQualify:false,canAuthorizeWager:false
  }));
  return {rows,status:rows.length?'FROZEN_PREGAME_REFERENCE':'NO_STARTED_LINES',capturedAt:ledger.updatedAt};
 }catch{return {rows:[],status:'READ_FAILED'};}
}
