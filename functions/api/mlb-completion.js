import {authorizeHarvest} from '../lib/auth.js';
import {buildSlate} from '../lib/slateEngine.js';
import {persistMlbAblationFreeze,archiveMlbFinalGame,gradeMlbAblations,summarizeMlbAblations,gunzipEvidence,validDay} from '../lib/mlbCompletionEvidence.js';
import {persistMlbLeagueDay,poolMlbLeagueDays} from '../lib/mlbLeagueBenchmarks.js';
const compactTrainingDay=p=>({playerId:p.playerId,pitches:p.pitches,plateAppearances:p.plateAppearances,metrics:Object.fromEntries(['strikeout','whiff','chase','hardHit','xwobacon','velocity','barrel','contact'].map(k=>[k,p.metrics[k]]))});
const reply=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
async function readBounded(request,max){const reader=request.body?.getReader();if(!reader)return {};const chunks=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw Error('PAYLOAD_TOO_LARGE');}chunks.push(value);}const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}return JSON.parse(new TextDecoder().decode(bytes));}
export async function onRequestPost(context){
 const {env,request}=context;
 if(!request.headers.get('x-harvest-secret')||!authorizeHarvest(request,env).ok)return reply({ok:false,error:'Unauthorized'},403);
 if(!env.ARCHIVE?.get||!env.ARCHIVE?.put)return reply({ok:false,error:'ARCHIVE_UNBOUND'},503);
 try{
  const body=await readBounded(request,26000000),date=body.date;
  if(!validDay(date)||date<'2024-01-01'||date>new Date().toISOString().slice(0,10))throw Error('INVALID_DATE');
  if(body.operation==='research-report'){
   const report=body.report;if(!report||report.canPromote!==false||!['FITTED_RETROSPECTIVE_ONLY','INSUFFICIENT_HISTORY','INSUFFICIENT_FOLD_COUNTS','INCOMPLETE_CORPUS','RETROSPECTIVE_MULTI_MARKET'].includes(report.status))throw Error('INVALID_RESEARCH_REPORT');
   const key=`models/mlb/evaluation/research/${new Date().toISOString().replaceAll(':','-')}.json`;await env.ARCHIVE.put(key,JSON.stringify(report),{onlyIf:new Headers({'If-None-Match':'*'})});await env.ARCHIVE.put('models/mlb/evaluation/research/current.json',JSON.stringify({key}));return reply({ok:true,key,status:report.status});
  }
  if(body.operation==='training-day'){
   const manifestObject=await env.ARCHIVE.get(`models/mlb/intelligence/manifests/v1/${date}.json`),pointerObject=await env.ARCHIVE.get(`models/mlb/league/v1/${date}/current.json`);
   if(!manifestObject||!pointerObject)throw Error('HISTORY_DAY_NOT_COLLECTED');const manifest=await manifestObject.json(),pointer=await pointerObject.json(),leagueObject=await env.ARCHIVE.get(pointer.key);if(!manifest.complete||!leagueObject)throw Error('HISTORY_DAY_INCOMPLETE');const league=await leagueObject.json();if(!league.complete)throw Error('LEAGUE_DAY_INCOMPLETE');
   const games=[];for(const receipt of manifest.receipts){const object=await env.ARCHIVE.get(receipt.key);if(!object)throw Error('GAME_SOURCE_MISSING');const game=await gunzipEvidence(object);games.push({gameId:game.gameId,date:game.officialDate,gameType:game.gameType,sourceHash:game.sourceHash,players:game.players.filter(p=>p.group==='pitching'||p.group==='batting').map(p=>({playerId:p.playerId,teamId:p.teamId,opponentId:p.opponentId,group:p.group,starter:p.starter,stats:Object.fromEntries(['strikeOuts','battersFaced','outs','runs','earnedRuns','plateAppearances','hits','totalBases','homeRuns'].filter(k=>p.stats[k]!=null).map(k=>[k,p.stats[k]]))}))});}
   return reply({ok:true,date,classification:'RETROSPECTIVE',leagueSourceHash:league.sourceHash,pitcherDays:(league.pitcherDays||[]).map(compactTrainingDay),batterDays:(league.batterDays||[]).map(compactTrainingDay),games});
  }
  if(body.operation==='status'){
   const game=await env.ARCHIVE.get(`models/mlb/intelligence/manifests/v1/${date}.json`),league=await env.ARCHIVE.get(`models/mlb/league/v1/${date}/current.json`);
   let summary=null;if(league){const pointer=await league.json(),object=await env.ARCHIVE.get(pointer.key);if(object)summary=await object.json();}
   return reply({ok:true,date,game:game?await game.json():null,league:summary?{complete:summary.complete,sourceHash:summary.sourceHash}:null});
  }
  if(body.operation==='manifest'){
   const ids=body.finalGameIds;if(!Array.isArray(ids)||ids.length>30||ids.some(id=>!/^\d+$/.test(String(id)))||new Set(ids.map(String)).size!==ids.length)throw Error('INVALID_GAME_MANIFEST');
   const receipts=[],missing=[];
   for(const id of ids){const object=await env.ARCHIVE.get(`models/mlb/intelligence/receipts/v1/${date}/${id}.json`);if(!object){missing.push(String(id));continue;}const r=await object.json();if(r.date!==date||r.gameId!==String(id)||!await env.ARCHIVE.head(r.key)){missing.push(String(id));continue;}receipts.push(r);}
   const manifest={date,expectedGameIds:ids.map(String),receipts,missingGameIds:missing,complete:missing.length===0,indexedInD1:false,observedAt:new Date().toISOString()};await env.ARCHIVE.put(`models/mlb/intelligence/manifests/v1/${date}.json`,JSON.stringify(manifest));return reply({ok:true,...manifest});
  }
  if(body.operation==='capture'){
   if(date!==new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))throw Error('CAPTURE_TODAY_ONLY');
   const slate=await buildSlate('mlb',date,{...env,caches:globalThis.caches?.default});const frozen=[],skipped=[];
   for(const game of (slate.games||[]).slice(0,20)){if(Date.parse(game.start)<=Date.now()){skipped.push({gameId:game.id,reason:'ALREADY_STARTED'});continue;}try{frozen.push(await persistMlbAblationFreeze(env,game,date,new Date().toISOString()));}catch(e){skipped.push({gameId:game.id,reason:e.message});}}
   return reply({ok:true,version:'mlb-completion-v1',operation:'capture',date,frozen,skipped});
  }
  if(body.operation==='game'&&body.feed?.gameData?.datetime?.officialDate!==date)throw Error('GAME_DATE_MISMATCH');
  if(body.operation==='game')return reply({ok:true,...await archiveMlbFinalGame(env,body.feed)});
  if(body.operation==='league')return reply({ok:true,...await persistMlbLeagueDay(env,{date,rawCsv:body.rawCsv,finalGameIds:body.finalGameIds})});
  if(body.operation==='month'){
   const through=body.through||new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());if(!validDay(through)||through>new Date().toISOString().slice(0,10))throw Error('INVALID_HISTORY_HORIZON');
   const month=date.slice(0,7),days=[];let expected=0,missing=[];
   for(let n=1;n<=31;n++){const d=month+'-'+String(n).padStart(2,'0');if(!validDay(d)||d>=through)continue;expected++;const pointer=await env.ARCHIVE.get(`models/mlb/league/v1/${d}/current.json`);if(!pointer){missing.push(d);continue;}const p=await pointer.json(),object=await env.ARCHIVE.get(p.key);if(!object){missing.push(d);continue;}days.push(await object.json());}
   const summary={...poolMlbLeagueDays(days),month,throughExclusive:through,calendarMonthComplete:through>new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).toISOString().slice(0,10),expectedDays:expected,missingDays:missing,complete:missing.length===0&&days.every(d=>d.complete)};
   await env.ARCHIVE.put(`models/mlb/league/v1/months/${month}.json`,JSON.stringify(summary));return reply({ok:true,...summary});
  }
  if(body.operation==='grade'){
   const id=String(body.feed?.gameData?.game?.pk||''),graded=[];
   for(const checkpoint of ['EARLY','T60','T15']){const object=await env.ARCHIVE.get(`models/mlb/evaluation/v1/${date}/${id}/${checkpoint}.json`);if(!object)continue;const grade=gradeMlbAblations(await object.json(),body.feed),key=`models/mlb/evaluation-grades/v1/${date}/${id}/${checkpoint}/${grade.finalSourceHash}.json`;await env.ARCHIVE.put(key,JSON.stringify(grade),{onlyIf:new Headers({'If-None-Match':'*'})});await env.ARCHIVE.put(`models/mlb/evaluation-grades/v1/${date}/${id}/${checkpoint}/current.json`,JSON.stringify({key}));graded.push(grade);}
   return reply({ok:true,date,gameId:id,graded:graded.length,report:summarizeMlbAblations(graded)});
  }
  throw Error('INVALID_OPERATION');
 }catch(e){return reply({ok:false,error:String(e.message)},422);}
}

export async function onRequestGet({env,request}){
 const selectedDate=new URL(request.url).searchParams.get('date');
 const date=selectedDate||new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 if(!validDay(date))return reply({ok:false,error:'Invalid date'},400);
 if(!env.ARCHIVE?.get)return reply({ok:false,error:'ARCHIVE_UNBOUND'},503);
 const months=[];for(const year of [2024,2025,2026])for(let n=3;n<=11;n++){const month=`${year}-${String(n).padStart(2,'0')}`;if(month>new Date().toISOString().slice(0,7))continue;const o=await env.ARCHIVE.get(`models/mlb/league/v1/months/${month}.json`);if(o){const m=await o.json();months.push({month,complete:m.complete,acquiredDays:m.days,expectedDays:m.expectedDays,missingDays:m.missingDays});}}
 const frozen=[],grades=[],seen=new Set();let forecastListTruncated=false;
 const evaluationPrefix='models/mlb/evaluation/v1/'+(selectedDate?date+'/':date.slice(0,4)+'-');
 if(env.ARCHIVE.list){const objects=await env.ARCHIVE.list({prefix:evaluationPrefix,limit:1000});forecastListTruncated=objects.truncated===true;for(const entry of objects.objects){const f=await (await env.ARCHIVE.get(entry.key)).json(),storageDate=entry.key.slice('models/mlb/evaluation/v1/'.length).split('/')[0],dedupe=f.gameId+':'+f.checkpoint;if(seen.has(dedupe))continue;seen.add(dedupe);frozen.push({date:storageDate,gameId:f.gameId,checkpoint:f.checkpoint,capturedAt:f.capturedAt,sourceHash:f.sourceHash,variants:Object.keys(f.predictions),lineupsOfficial:f.lineupsOfficial});const current=await env.ARCHIVE.get(`models/mlb/evaluation-grades/v1/${storageDate}/${f.gameId}/${f.checkpoint}/current.json`);if(current){const p=await current.json(),g=await env.ARCHIVE.get(p.key);if(g)grades.push(await g.json());}}}
 const pointer=await env.ARCHIVE.get('models/mlb/evaluation/research/current.json');let historicalFit=null;if(pointer){const p=await pointer.json(),o=await env.ARCHIVE.get(p.key);if(o)historicalFit=await o.json();}
 return reply({ok:true,date,reportScope:selectedDate?'SELECTED_DATE':'SEASON_TO_DATE',forecastListTruncated,months,frozen,prospectiveReport:summarizeMlbAblations(grades),historicalFit,ssw:{available:false,reason:'No validated observed-versus-inferred spin-axis residual model in the connected feed.'},xra:{available:false,reason:'Expected-run target and calibrated estimator not validated.'},canPromote:false});
}
