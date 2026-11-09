import {createHash} from 'node:crypto';
import {normalizeFbisCbbGameTeamRows,buildFbisCbbRatings,projectFbisCbbGame} from '../../functions/lib/cbbFbisRatings.js';
import {cbbFbisV2TotalCorrection} from '../../functions/lib/cbbFbisV2Total.js';
const hash=x=>createHash('sha256').update(x).digest('hex');
const final=g=>['final','completed','complete'].includes(String(g.status?.type?.name??g.status??'').toLowerCase())||g.completed===true;
export function buildCurrentCbbNativeEvidence({games,boxes,fixtures=[],asOf,season=2027}){
 const now=Date.parse(asOf);if(!Number.isFinite(now)||!Array.isArray(games)||!Array.isArray(boxes)||games.length>=3000||boxes.length>=3000)throw Error('CBBD_COMPLETENESS_UNPROVEN');
 const completed=new Map(games.filter(g=>Number(g.season)===season&&final(g)&&Number.isFinite(Date.parse(g.startDate))&&Date.parse(g.startDate)<now).map(g=>[String(g.id),g]));
 const eligible=boxes.filter(r=>Number(r.season)===season&&completed.has(String(r.gameId??r.id)));
 const normalized=normalizeFbisCbbGameTeamRows(eligible,season).filter(r=>/^cbb-\d+$/.test(r.teamId));
 const byGame=new Map();for(const r of normalized){if(!byGame.has(r.gameId))byGame.set(r.gameId,[]);byGame.get(r.gameId).push(r);}
 // Only complete, exact reciprocal D1 pairs; never let a one-sided box create evidence.
 const pairs=[...byGame.values()].filter(rs=>rs.length===2&&rs[0].teamId!==rs[1].teamId&&rs[0].team===rs[1].opponent&&rs[1].team===rs[0].opponent&&rs.every(r=>Date.parse(r.startDate)===Date.parse(completed.get(r.gameId).startDate))).flat();
 const catalog=buildFbisCbbRatings(pairs,{asOf,season});
 const projections=[],unavailable=[];
 for(const g of fixtures){
  if(g.date==null||Date.parse(g.start)<=now||typeof g.neutralSite!=='boolean')continue;
  const home=catalog.byTeamId?.[g.homeId],away=catalog.byTeamId?.[g.awayId];
  if(!home||!away){unavailable.push({eventId:g.eventId,reason:'CURRENT_COMPLETED_TEAM_HISTORY_MISSING'});continue;}
  const native=projectFbisCbbGame(g,home,away,{nationalEff:catalog.national.eff,nationalTempo:catalog.national.tempo,globalHca:catalog.national.globalHca});
  if(!native.ok)continue;
  // Frozen total correction needs all of its detailed features, not zero-filled missing inputs.
  const detailed=[native.possessions,native.paceAdjustment,native.homeEff,native.awayEff,native.reliability,native.hca,...['home','away'].flatMap(side=>Object.values(native.matchup[side])),...['home','away'].flatMap(side=>[native.schedule[side].sos,native.schedule[side].conferenceStrength])];
  const correction=detailed.every(v=>typeof v==='number'&&Number.isFinite(v))?cbbFbisV2TotalCorrection(native):null;
  projections.push({eventId:g.eventId,date:g.date,start:g.start,homeId:g.homeId,awayId:g.awayId,sourceCapturedAt:asOf,modelId:native.modelId,home:native.home,away:native.away,total:native.total,margin:native.margin,homeGames:home.games,awayGames:away.games,reliability:native.reliability,lowSample:home.games<5||away.games<5,correctedTotal:correction?.ok?correction.total:null,baselineKenpomTotal:g.primary?.total??null,totalDifferenceFromKenpom:g.primary?Math.round((native.total-g.primary.total)*10)/10:null,usage:'PRIVATE_RESEARCH_COMPARISON_ONLY',canQualify:false,canAuthorizeWager:false});
 }
 return {version:1,visibility:'PRIVATE_RESEARCH_COMPARISON',provider:'CBBD',season,generatedAt:asOf,sourceGameRows:games.length,sourceBoxRows:boxes.length,completedGames:completed.size,pairedD1Games:pairs.length/2,normalizedRows:normalized.length,modelTeams:Object.keys(catalog.byTeamId||{}).length,primaryModelInfluence:0,comparisonModelInfluence:projections.length?'ACTUAL_CURRENT_CBBD_BOX_SCORES':'NONE_INSUFFICIENT_INPUTS',projections,unavailable,canAuthorizeWager:false};
}
export async function captureCbbdNativeInputs({key,reserve,fetchFn=fetch,now=Date.now,season=2027}){
 if(!key||typeof reserve!=='function')throw Error('CBBD_CREDENTIAL_OR_BUDGET_MISSING');
 const asOf=new Date(now()).toISOString(),query=new URLSearchParams({season:String(season),startDateRange:`${season-1}-11-01T00:00:00Z`,endDateRange:asOf});const receipts=[],payloads=[];
 for(const path of ['/games','/games/teams']){
  reserve('CBBD');const r=await fetchFn('https://api.collegebasketballdata.com'+path+'?'+query,{headers:{Authorization:'Bearer '+key,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('CBBD_NATIVE_HTTP_'+r.status);
  const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>8000000)throw Error('CBBD_NATIVE_RESPONSE_TOO_LARGE');
  const value=JSON.parse(bytes.toString('utf8'));if(!Array.isArray(value)||value.length>=3000)throw Error('CBBD_NATIVE_COMPLETENESS_UNPROVEN');
  receipts.push({endpoint:path,season,observedAt:new Date(now()).toISOString(),status:r.status,records:value.length,sha256:hash(bytes),fields:value[0]?Object.keys(value[0]).sort():[]});payloads.push(value);
 }
 return {packet:{version:1,visibility:'PRIVATE_SOURCE_EVIDENCE',season,generatedAt:new Date(now()).toISOString(),receipts,games:payloads[0],boxes:payloads[1],canAuthorizeWager:false},receipt:{provider:'CBBD',receipts,requests:2,primaryModelInfluence:0}};
}
