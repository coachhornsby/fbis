#!/usr/bin/env node
/**
 * FBIS CI Auto Repair — governed, all-sport production watchdog.
 *
 * READ: every scheduled/live game and every supported prop market.
 * REPAIR: at most one existing signed forecast capture per affected sport
 *         and one existing CORE summary republish per authorized run.
 * NEVER: make paid-provider calls, synthesize lines, change forecast/model
 *        versions, rewrite immutable evidence, or grant wagering authority.
 *
 * The report is a durable GitHub Actions artifact; issues are reconciled by
 * the workflow separately to avoid a write-enabled web endpoint.
 */
import {mkdir,writeFile} from 'node:fs/promises';
import {assessFixtureCoverage,assessPropCoverage,summarizeReliability,PROP_SPORTS} from './lib/fbisAutoRepairPolicy.mjs';
import {readExchangeWithSportFallback} from './lib/fbisExchangeReadFallback.mjs';

const BASE=(process.env.FBIS_BASE_URL||'https://fbis-myz.pages.dev').replace(/\/$/,'');
const SECRET=process.env.HARVEST_SECRET||'';
const REPAIR=process.env.FBIS_REPAIR_WINDOW==='true'&&!!SECRET;
const localDay=x=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(x);
const dayOffset=(day,n)=>localDay(new Date(Date.parse(day+'T12:00:00Z')+n*86400000));
const now=Date.now(),date=process.env.AUDIT_DATE||localDay(new Date(now));
if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('AUDIT_DATE_INVALID');
const days=[date,dayOffset(date,1)],errors=[],reports=[],recovery=[],matrix=[];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function request(path,{method='GET',body=null,timeoutMs=60000}={}){
 const write=method!=='GET';
 if(write&&!SECRET)throw Error('WRITE_AUTH_UNAVAILABLE');
 for(let attempt=0;attempt<(write?1:2);attempt++){
  try{
   const r=await fetch(BASE+path,{method,headers:{accept:'application/json',
    ...(write?{'content-type':'application/json','x-harvest-secret':SECRET}:{}),
    'cache-control':'no-store'},body:write?JSON.stringify(body):undefined,
    signal:AbortSignal.timeout(timeoutMs)});
   if(!r.ok)throw Error('HTTP_'+r.status);
   const x=await r.json();
   if(x?.ok===false)throw Error('SOURCE_STATUS_'+(x.reason||x.error||'NOT_OK'));
   return x;
  }catch(e){
   if(attempt===0&&!write){await wait(1250);continue;}
   throw Error(String(e?.message||e).slice(0,160));
  }
 }
}
async function scan(day){
 let board;
 try{
  board=await request('/api/today?'+new URLSearchParams({date:day}),{timeoutMs:100000});
  if(!Array.isArray(board.games))throw Error('BOARD_GAMES_MISSING');
 }catch(e){
  return {day,board:null,findings:[{kind:'PIPELINE',sport:'all',eventId:'',reason:'BOARD_READ_FAILED',details:String(e)}],
   sports:[],fixtures:[],projections:[],marketContracts:[],counts:{}};
 }
 const fixture=assessFixtureCoverage(board,{now});
 const scopedSports=[...new Set(fixture.games.map(g=>g.sport))].filter(s=>PROP_SPORTS.includes(s));
 const exchangeRead=await readExchangeWithSportFallback({request,sports:scopedSports,date:day});
 const exchange=exchangeRead.exchange;
 for(const failed of exchangeRead.failedSports)errors.push({kind:'PIPELINE',sport:failed.sport,eventId:'',
  reason:'EXCHANGE_PROPS_READ_FAILED',day,detail:failed.reason});
 const projections=[];
 const contracts=Array.isArray(exchange.rows)?exchange.rows:[];
 // Three simultaneous expensive slate requests at most; preserve per-sport failures.
 const queue=[...scopedSports];
 async function worker(){
  while(queue.length){
   const sport=queue.shift();
   try{
    const p=await request('/api/prop-projections?'+new URLSearchParams({sport,date:day}),{timeoutMs:95000});
    if(!Array.isArray(p.rows))throw Error('MODEL_ROWS_MISSING');
    projections.push(...p.rows);
   }catch(e){errors.push({kind:'PIPELINE',sport,eventId:'',reason:'PLAYER_MODEL_ENDPOINT_FAILED',day,detail:String(e)});}
  }
 }
 await Promise.all([worker(),worker(),worker()]);
 // An unreadable source is UNKNOWN, not an empty provider market. Keep a
 // pipeline incident, but do not report unsupported zero-contract conclusions.
 const failedSports=new Set(exchangeRead.failedSports.map(f=>f.sport));
 const props=scopedSports.filter(s=>!failedSports.has(s)).map(sport=>
  assessPropCoverage({sport,games:board.games,models:projections,contracts,now}));
 const diagnostics=[...(board.sports||[]).filter(s=>s.error).map(s=>({kind:'PIPELINE',sport:s.sport,eventId:'',
  reason:'SPORT_BOARD_FEED_ERROR',day,detail:String(s.error).slice(0,150)})),
  ...(exchange.diagnostics||[]).filter(x=>x.status==='READ_FAILED'||x.truncated).map(x=>({
    kind:'PIPELINE',sport:'all',eventId:'',reason:'EXCHANGE_HISTORY_READ_INCOMPLETE',day,detail:x.store+':'+x.status
  }))];
 return {day,board,fixture,props,findings:[...fixture.findings,...props.flatMap(p=>p.findings),...diagnostics],
  sports:scopedSports,counts:fixture.counts,projections,marketContracts:contracts,
  providerStatus:exchange.coverage,collectorCoverage:exchange.collectorCoverage,
  exchangeReadMode:exchangeRead.fallbackUsed?'SCOPED_FALLBACK':'ALL_SPORT',
  exchangeReadInitialFailure:exchangeRead.initialFailure};
}
for(const day of days){
 const data=await scan(day);
 const publicRecord={date:day,counts:data.counts,sports:data.sports,
  models:data.props?.map(p=>({sport:p.sport,counts:p.counts}))||[],
  games:data.fixture?.games||[],findings:data.findings,
  providerStatus:data.providerStatus||[],collectorCoverage:data.collectorCoverage||[],
  exchangeReadMode:data.exchangeReadMode||'UNKNOWN',
  exchangeReadInitialFailure:data.exchangeReadInitialFailure||null};
 reports.push(publicRecord);
 matrix.push(data);
}
const first=matrix[0];
const missingForecastSports=(first?.props||[]).filter(p=>
 p.counts.fixtures>0&&(p.counts.unmatchedContracts>0||p.counts.independentModels===0))
 .map(p=>p.sport).filter(s=>['nba','nfl','nhl','mlb'].includes(s));
if(REPAIR){
 // Sanctioned source-backed forecast capture. The endpoint builds its own
 // forecasts; no client-supplied player ID, threshold, price, or projection.
 for(const sport of missingForecastSports){
  try{
   const result=await request('/api/prop-acceptance?'+new URLSearchParams({sport}),
    {method:'POST',body:{operation:'capture'},timeoutMs:95000});
   recovery.push({sport,action:'SOURCE_OWNED_FORECAST_CAPTURE',ok:true,status:result.status||'ACCEPTED',
    count:Number(result.captured||0),canAuthorizeWager:false});
  }catch(e){recovery.push({sport,action:'SOURCE_OWNED_FORECAST_CAPTURE',ok:false,reason:String(e)});}
 }
 // Publishing CORE does not acquire odds or replace any provider clock.
 if(first?.fixture?.games?.some(g=>!g.currentOdds&&g.referenceOnly)){
  try{
   const r=await request('/api/database-topology',{method:'POST',
    body:{operation:'core-board-summary-publish'},timeoutMs:110000});
   recovery.push({action:'REBUILD_CORE_SUMMARY_FROM_EXISTING_EVIDENCE',ok:r.ok===true});
  }catch(e){recovery.push({action:'REBUILD_CORE_SUMMARY_FROM_EXISTING_EVIDENCE',ok:false,reason:String(e)});}
 }
}
// Source recovery never counts as success until the same public endpoint is
// checked a second time. Only recheck affected sport/day, do not repull feeds.
if(recovery.some(r=>r.ok)){
 const after=await scan(date);
 reports[0].findings=after.findings;
 reports[0].counts=after.counts;
 reports[0].models=after.props?.map(p=>({sport:p.sport,counts:p.counts}))||[];
 reports[0].games=after.fixture?.games||[];
 reports[0].verifiedAfterRepair=true;
}
for(const error of errors)reports[error.day===days[1]?1:0].findings.push(error);
const combined=summarizeReliability(reports.map(r=>({findings:r.findings})),{date,asOf:new Date(now).toISOString()});
const output={...combined,phase:'FBIS_CI_AUTO_REPAIR_V1',window:days,repairWindow:REPAIR,
 scan:reports,recovery,paidProviderCalls:0,canAuthorizeWager:false,
 notes:['No unsupported synthetic odds or model estimates','Quote clocks are source-verified only',
 'Unlisted bookmaker/exchange contracts cannot be forced into existence',
 'No unscheduled PinnOdds requests or price-authority escalation']};
await mkdir('artifacts',{recursive:true});
await writeFile('artifacts/fbis-auto-repair-'+date+'.json',JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({ok:output.ok,days,sports:reports.map(x=>x.sports.length),
 gameCoverage:reports.map(x=>x.counts),issues:output.counts,recovery},null,2));
if(process.env.GITHUB_STEP_SUMMARY)await writeFile(process.env.GITHUB_STEP_SUMMARY,
 '## FBIS CI Auto Repair · All Sports\n\n'+
 '| Category | Unresolved |\n|---|---:|\n'+
 Object.entries(output.counts).map(([k,v])=>'| '+k+' | '+v+' |').join('\n')+
 '\n\nPrice references without verified provider-side clocks are not called live current odds. No paid capture was initiated.\n',{flag:'a'});
// Incident reconciliation is an independent workflow step (runs even on gaps).
// The workflow itself stays green when an issue has been tracked; a failed
// audit/request remains visible in the incident rather than masked as healthy.
