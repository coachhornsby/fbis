import {reconcileTennisCards} from './lib/reconcile-tennis-cards.mjs';
import {mkdir,writeFile} from 'node:fs/promises';

const base=process.env.FBIS_BASE||'https://fbis-myz.pages.dev';
const secret=process.env.HARVEST_SECRET;
const now=new Date();
const ctDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
async function get(path,auth=false){
 const response=await fetch(base+path,{headers:auth&&secret?{'x-harvest-secret':secret}:{},signal:AbortSignal.timeout(45000)});
 let body;try{body=await response.json();}catch{throw Error(path+':INVALID_JSON:'+response.status);}
 if(!response.ok||body?.ok===false)throw Error(path+':HTTP_'+response.status+':'+String(body?.reason||body?.error||'UNAVAILABLE'));
 return body;
}
const report={at:now.toISOString(),ctDate,checks:{},alerts:[],passed:false};
let rawBoardGames=[],rawOfficialFixtures=[];
async function check(name,fn){
 try{report.checks[name]={status:'OK',data:await fn()};}
 catch(error){report.checks[name]={status:'ERROR',error:String(error.message||error)};report.alerts.push(name+':UNAVAILABLE');}
}
await Promise.all([
 check('officialProjectionCoverage',async()=>{
  const c=await get('/api/tennis-projection-coverage');
  rawOfficialFixtures=c.fixtures||[];
  const missed=rawOfficialFixtures.filter(x=>!x.available);
  const details=missed.map(f=>({eventId:f.eventId,players:[f.player1,f.player2],start:f.start,reason:f.blockedReason}));
  return {scheduledCandidates:c.scheduledCandidates,verifiedFixtures:c.verifiedFixtures,successfulProjections:c.successfulProjections,missingOutputs:c.missingOutputs,blockedReasons:c.blockedReasons,details};
 }),
 check('portraits',async()=>{
  const c=await get('/api/tennis-portrait-coverage?limit=100');
  return {total:c.total,byTour:c.byTour,topMissing:c.missingPlayers};
 }),
 check('tennisBoard',async()=>{
  const c=await get('/api/today?sport=tennis&date='+encodeURIComponent(ctDate));
  const games=Array.isArray(c.games)?c.games:[];
  rawBoardGames=games;
  return {gameCount:games.length,gameIds:games.map(g=>String(g.id||'')).filter(Boolean),responseKeys:Object.keys(c)};
 }),
 check('prizePicksAcquisition',async()=>{
  if(!secret)throw Error('HARVEST_SECRET_NOT_CONFIGURED');
  const a=await get('/api/prizepicks-props?mode=acquisition',true);
  return {date:a.ctDate,state:a.acquisition?.state||'NOT_STARTED',runId:a.acquisition?.run_id||null,coverage:a.coverage,sourceCapturedAt:a.capturedScope?.captured_at||null};
 })
]);
if(report.checks.tennisBoard?.status==='OK' && report.checks.officialProjectionCoverage?.status==='OK'){
 report.checks.boardReconciliation={status:'OK',data:reconcileTennisCards(rawBoardGames,rawOfficialFixtures)};
 const rc=report.checks.boardReconciliation.data;
 if(rc.byStatus.NO_MATCHING_OFFICIAL_FIXTURE)report.alerts.push('EXCHANGE_CARDS_WITHOUT_OFFICIAL_FIXTURE:'+rc.byStatus.NO_MATCHING_OFFICIAL_FIXTURE);
 if(rc.byStatus.AMBIGUOUS_OFFICIAL_MATCH)report.alerts.push('AMBIGUOUS_OFFICIAL_MATCH:'+rc.byStatus.AMBIGUOUS_OFFICIAL_MATCH);
 if(rc.byStatus.BOARD_IDENTITY_OR_TIME_INCOMPLETE)report.alerts.push('BOARD_IDENTITY_OR_TIME_INCOMPLETE:'+rc.byStatus.BOARD_IDENTITY_OR_TIME_INCOMPLETE);
}
const pc=report.checks.officialProjectionCoverage?.data;
if(pc){
 if(pc.missingOutputs>0)report.alerts.push('OFFICIAL_FIXTURES_WITHOUT_PROJECTIONS:'+pc.missingOutputs);
 if(pc.scheduledCandidates===0)report.alerts.push('NO_OFFICIAL_FIXTURES_IN_72_HOURS');
}
const board=report.checks.tennisBoard?.data;
if(board?.gameCount>0&&pc?.scheduledCandidates===0)report.alerts.push('EXCHANGE_BOARD_WITHOUT_OFFICIAL_FIXTURE_COVERAGE');
const pp=report.checks.prizePicksAcquisition?.data;
if(pp&&pp.state!=='COMPLETE')report.alerts.push('PRIZEPICKS_DAILY_CAPTURE_'+pp.state);
if(pp&&pp.state==='COMPLETE'&&!pp.coverage?.some(x=>String(x.sport).toLowerCase()==='tennis'&&Number(x.rows)>0))report.alerts.push('PRIZEPICKS_COMPLETE_NO_TENNIS_ROWS');
report.passed=report.alerts.length===0;
await mkdir('artifacts',{recursive:true});
await writeFile('artifacts/tennis-completeness-audit.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({at:report.at,boardCards:board?.gameCount,official:pc?.successfulProjections,officialCandidates:pc?.scheduledCandidates,portraits:report.checks.portraits?.data?.total,prizePicks:pp?.state,alerts:report.alerts}));
if(!report.passed)process.exitCode=1;
