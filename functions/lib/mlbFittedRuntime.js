import {MLB_STATS_ID,resolveMlbCanon} from './mlbCanonical.js';
import {sha256Hex} from './sha256Hex.js';
import {predictRetrospectiveK} from './mlbRetrospectiveKFit.js';
import {MLB_PROP_PROMOTION_THRESHOLDS} from './mlbPropPromotionGovernance.js';
const DAY=86400000, avg=xs=>xs.reduce((a,b)=>a+b,0)/xs.length, clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const FITTED_STATE_KEY='models/mlb/fitted/v1/state/current.json';
export const FITTED_MARKETS=['pitcher_k','hits','total_bases','home_runs'];
export function emptyFittedState(){return {version:'mlb-fitted-state-v1',throughExclusive:'2024-03-01',pitchers:{},batters:{},starts:{},hitters:{},teams:{},sources:[]};}
export function advanceFittedState(input,day){
 if(day.date!==input.throughExclusive||day.classification!=='RETROSPECTIVE'||!day.leagueSourceHash||!Array.isArray(day.games))throw Error('FITTED_STATE_NONCONTIGUOUS_SOURCE');
 const s=structuredClone(input);
 for(const game of day.games)for(const p of game.players){
  const id=String(p.playerId);
  if(p.group==='pitching'&&p.starter&&Number.isFinite(p.stats.battersFaced))s.starts[id]=[...(s.starts[id]||[]),{date:day.date,battersFaced:p.stats.battersFaced}].slice(-5);
  if(p.group==='batting'&&Number.isFinite(p.stats.strikeOuts)&&Number.isFinite(p.stats.plateAppearances)){const t=s.teams[p.teamId]||{k:0,pa:0};t.k+=p.stats.strikeOuts;t.pa+=p.stats.plateAppearances;s.teams[p.teamId]=t;}
  if(p.group==='batting'&&p.starter&&Number.isFinite(p.stats.plateAppearances)){
   const h=s.hitters[id]||{pa:0,totals:{hits:0,totalBases:0,homeRuns:0},recent:[]};h.pa+=p.stats.plateAppearances;
   for(const field of Object.keys(h.totals)){if(!Number.isFinite(p.stats[field]))h.totals[field]=null;else if(h.totals[field]!==null)h.totals[field]+=p.stats[field];}
   h.recent=[...h.recent,{date:day.date,plateAppearances:p.stats.plateAppearances}].slice(-10);s.hitters[id]=h;
  }
 }
 for(const [ds,key] of [[day.pitcherDays||[],'pitchers'],[day.batterDays||[],'batters']])for(const p of ds){const id=String(p.playerId);s[key][id]=[...(s[key][id]||[]),{...p,date:day.date}];}
 s.throughExclusive=new Date(Date.parse(day.date)+DAY).toISOString().slice(0,10);
 if(s.throughExclusive.endsWith('-12-01'))s.throughExclusive=(Number(day.date.slice(0,4))+1)+'-03-01';
 for(const key of ['pitchers','batters'])for(const id of Object.keys(s[key])){s[key][id]=s[key][id].filter(p=>Date.parse(s.throughExclusive)-Date.parse(p.date)<=90*DAY);if(!s[key][id].length)delete s[key][id];}
 s.sources.push({date:day.date,leagueSourceHash:day.leagueSourceHash,gameHashes:day.games.map(g=>g.sourceHash)});return s;
}
export function fittedDesignRow(s,{market,playerId,opponentId,opponentPitcherId,date}){
 const id=String(playerId),ds=(s[market==='pitcher_k'?'pitchers':'batters'][id]||[]).filter(p=>p.date<date&&Date.parse(date)-Date.parse(p.date)<=90*DAY);
 const metric=(rows,k)=>{const ms=rows.map(p=>p.metrics[k]).filter(m=>m?.denominator>0&&Number.isFinite(m.numerator)),den=ms.reduce((a,m)=>a+m.denominator,0);return den?ms.reduce((a,m)=>a+m.numerator,0)/den:null;};
 let features,baseline;
 if(market==='pitcher_k'){
  const work=s.starts[id]||[],opp=s.teams[opponentId],rate=metric(ds,'strikeout');
  features=['whiff','chase','hardHit','xwobacon','velocity'].map(k=>metric(ds,k));features.push(opp?.pa>0?opp.k/opp.pa:null);
  if(work.length<3||!Number.isFinite(rate)||work.some(w=>w.date>=date))return null;
  baseline=clamp(rate*avg(work.map(w=>w.battersFaced)),.1,20);
 }else{
  const h=s.hitters[id],op=(s.pitchers[String(opponentPitcherId)]||[]).filter(p=>p.date<date&&Date.parse(date)-Date.parse(p.date)<=90*DAY),field={hits:'hits',total_bases:'totalBases',home_runs:'homeRuns'}[market];
  features=['xwobacon','hardHit','barrel','contact','chase'].map(k=>metric(ds,k));features.push(metric(op,'strikeout'));
  if(!field||!h||h.pa<50||!Number.isFinite(h.totals[field])||!h.recent.length||h.recent.some(g=>g.date>=date))return null;
  baseline=clamp(h.totals[field]/h.pa*avg(h.recent.map(g=>g.plateAppearances)),.01,20);
 }
 if(ds.reduce((a,p)=>a+p.pitches,0)<200||!features.every(Number.isFinite)||!Number.isFinite(baseline))return null;
 return {baseline,features,priorSourceDates:ds.map(p=>p.date)};
}
export function fittedModelReadiness(report){return Object.fromEntries(FITTED_MARKETS.map(m=>{const r=m==='pitcher_k'?report:report?.hitterModels?.[m],h=r?.holdout,c=h?.candidate,b=h?.baseline,ci=h?.pairedGameError;
 const historicalPass=!!(c&&b&&c.poissonDeviance<b.poissonDeviance&&c.mae<b.mae&&Number.isFinite(ci?.hi)&&ci.hi<0);
 return [m,{modelHash:r?.modelHash||null,historicalPass,status:historicalPass?'LIVE_SHADOW_CANDIDATE':'RESEARCH_COMPARISON',canPromote:false,blockers:['NO_QUALIFIED_LIVE_MODEL_COHORT','NO_VERIFIED_EXACT_LINE_ECONOMIC_EVIDENCE'],requirements:MLB_PROP_PROMOTION_THRESHOLDS.promotionReady}];}));}
export async function loadFittedRuntime(env,now=new Date().toISOString(),playerIds=[]){
 try{
  if(!env.ARCHIVE?.get)return {available:false,reason:'ARCHIVE_UNBOUND'};
  const p=await env.ARCHIVE.get(FITTED_STATE_KEY);if(!p)return {available:false,reason:'STATE_NOT_PUBLISHED'};
  const pointer=await p.json(),o=await env.ARCHIVE.get(pointer.key);if(!o)return {available:false,reason:'STATE_MISSING'};
  const bundle=await o.json();if(sha256Hex(JSON.stringify(bundle))!==pointer.hash)throw Error('STATE_HASH_MISMATCH');
  if(bundle.state?.version!=='mlb-fitted-state-v1'||!Number.isFinite(Date.parse(bundle.observedAt))||Date.parse(bundle.observedAt)>Date.parse(now))throw Error('STATE_TIME_INVALID');
  const ref=await env.ARCHIVE.get(bundle.reportKey);if(!ref)throw Error('MODEL_MISSING');const report=await ref.json();
  if(report.coverage?.missing?.length||report.status!=='RETROSPECTIVE_MULTI_MARKET')throw Error('CORPUS_INCOMPLETE');
  for(const m of FITTED_MARKETS){const r=m==='pitcher_k'?report:report.hitterModels?.[m];if(!r?.model||sha256Hex(JSON.stringify(r.model))!==r.modelHash||r.model.coefficients.length!==7||r.model.mean.length!==6||r.model.sd.length!==6||!r.model.sd.every(v=>Number.isFinite(v)&&v>0)||![...r.model.mean,...r.model.coefficients].every(Number.isFinite))throw Error('MODEL_HASH_OR_SCHEMA_INVALID');}
  const state={...bundle.state,pitchers:bundle.state.pitchers||{},batters:bundle.state.batters||{}};
  const ids=[...new Set(playerIds.map(String))];if(ids.length>600)throw Error('PLAYER_STATE_SCOPE_LIMIT');
  for(let at=0;at<ids.length;at+=12)await Promise.all(ids.slice(at,at+12).map(async id=>{const ref=state.playerShards?.[id];if(!ref)return;const o=await env.ARCHIVE.get(ref.key);if(!o)throw Error('PLAYER_STATE_MISSING');const p=await o.json();if(sha256Hex(JSON.stringify(p))!==ref.hash||p.playerId!==id)throw Error('PLAYER_STATE_HASH_MISMATCH');state.pitchers[id]=p.pitcherDays;state.batters[id]=p.batterDays;}));
  return {available:true,...bundle,state,stateHash:pointer.hash,report,readiness:fittedModelReadiness(report)};
 }catch(e){return {available:false,reason:e.message};}
}
export function scoreFittedGame(game,runtime,now=new Date().toISOString()){
 const unavailable=reason=>({version:'mlb-fitted-shadow-v1',available:false,reason,canPromote:false,canAuthorizeWager:false,forecasts:[]});
 if(!runtime.available)return unavailable(runtime.reason);
 const start=Date.parse(game.start),captured=Date.parse(now);
 if(!Number.isFinite(start)||!Number.isFinite(captured)||captured>=start)return unavailable('PREGAME_ONLY');
 const officialDate=game.officialDate||new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(start));
 if(runtime.state.throughExclusive>officialDate||Date.parse(officialDate)-Date.parse(runtime.state.throughExclusive)>2*DAY||Date.parse(runtime.observedAt)>captured)return unavailable('STATE_CUTOFF_OR_FRESHNESS');
 const forecasts=[],seen=new Set();
 for(const side of ['home','away']){
  const opp=side==='home'?'away':'home',sp=game[side+'Sp'],oppSp=game[opp+'Sp'];
  const selections=[...(sp?.id?[{playerId:String(sp.id),market:'pitcher_k',championProjection:game.mlbDeepShadow?.pitcherKs?.[side]?.projection}]:[]),...(game.playerProjectionRows||[]).filter(p=>FITTED_MARKETS.includes(p.market)&&p.market!=='pitcher_k'&&resolveMlbCanon({abbr:p.team})===resolveMlbCanon(game[side])).map(p=>({...p,championProjection:p.fbisProjection??p.projection}))];
  for(const p of selections){const key=p.playerId+':'+p.market;if(seen.has(key))continue;seen.add(key);const row=fittedDesignRow(runtime.state,{market:p.market,playerId:p.playerId,opponentId:MLB_STATS_ID[resolveMlbCanon(game[opp])],opponentPitcherId:oppSp?.id,date:officialDate});if(!row)continue;
   const r=p.market==='pitcher_k'?runtime.report:runtime.report.hitterModels[p.market];
   forecasts.push({playerId:String(p.playerId),market:p.market,side,baseline:row.baseline,features:row.features,projection:predictRetrospectiveK(r.model,row),championProjection:Number.isFinite(p.championProjection)?p.championProjection:null,modelVersion:r.model.version,modelHash:r.modelHash,stateHash:runtime.stateHash,priorSourceDates:row.priorSourceDates,status:runtime.readiness[p.market].status});
  }
 }
 return {version:'mlb-fitted-shadow-v1',available:forecasts.length>0,reason:forecasts.length?null:'NO_ELIGIBLE_PLAYER_HISTORY',capturedAt:now,gameStart:game.start,officialDate,stateHash:runtime.stateHash,observedAt:runtime.observedAt,throughExclusive:runtime.state.throughExclusive,canPromote:false,canAuthorizeWager:false,forecasts};
}
