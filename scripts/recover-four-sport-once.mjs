#!/usr/bin/env node
/**
 * Bounded, operator-controlled four-sport FBIS model recovery.
 * No D1, Workers model executions, PinnOdds collector, bets, or scheduled polling.
 * Runs existing independent models from recently fetched ESPN final scores and,
 * for CBB only, one licensed KenPom rating feed when the owner already has a key.
 * Missing, stale, unmatched or insufficient evidence -> NO PREDICTION.
 */
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {boardDate,captureScoreboards} from '../functions/lib/publicBoardSnapshot.js';
import {projectNbaGame,estimatePossessions,NBA_MODEL_ID,NBA_MODEL_VERSION} from '../functions/lib/nbaModel.js';
import {projectNflFormV0,NFL_SHADOW_ID} from '../functions/lib/nflModel.js';
import {projectCfbMatchup,CFB_CONSTANTS} from '../functions/lib/cfbModel.js';
import {normalizeKenpomRatingRows,indexKenpomRows,lookupKenpomRating} from '../functions/lib/kenpomCbb.js';
import {cbbKenpomRatingsV1} from '../functions/lib/cbbRatings.js';
import {validateFourSportPacket} from '../functions/lib/privateFourSportProjection.js';
import {validatePrivatePacket} from '../src/lib/privateBoardProjection.js';

const now=new Date();
const nowMs=now.getTime(),generatedAt=now.toISOString();
const date=String(process.env.FBIS_RECOVERY_DATE||boardDate(generatedAt));
const zone='America/Chicago';
const dayNumber=t=>Date.parse(t+'T12:00:00Z');
if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(dayNumber(date))||
 Math.abs(dayNumber(date)-dayNumber(boardDate(generatedAt)))>86400000)
 throw Error('RECOVERY_DATE_OUTSIDE_TODAY_WINDOW');
const account=String(process.env.CLOUDFLARE_ACCOUNT_ID||'');
const token=String(process.env.CLOUDFLARE_API_TOKEN||'');
const kenpomKey=String(process.env.KENPOM_API_KEY||'');
const outDir='artifacts/four-sport-recovery';
await mkdir(outDir,{recursive:true});
let providerCalls=0;const MAX_SOURCE_CALLS=135;
const results={date,generatedAt,ownerScope:'PRIVATE_RESEARCH_ONLY',modelAuthority:'RESEARCH_ONLY',
 noD1:true,paidCollectors:0,providerCalls:{ESPN:0,KenPom:0},written:[],skipped:[],errors:[],
 noWagerAuthorization:true,cost:{d1Reads:0,d1Writes:0,paidCollectors:0,espnCallsCap:134,kenpomCallsCap:1}};
const sha=s=>createHash('sha256').update(s).digest('hex');
const shiftDay=(d,n)=>new Date(dayNumber(d)+n*86400000).toISOString().slice(0,10);
function assertUrl(url){
 const u=new URL(url);
 if(u.protocol!=='https:'||!['site.api.espn.com','kenpom.com'].includes(u.hostname))throw Error('SOURCE_URL_NOT_ALLOWED');
 return u;
}
async function getJson(url,{kind='ESPN',maxBytes=3800000}={}){
 assertUrl(url);if(++providerCalls>MAX_SOURCE_CALLS)throw Error('SOURCE_CALL_BUDGET_EXCEEDED');
 results.providerCalls[kind]=(results.providerCalls[kind]||0)+1;
 const res=await fetch(url,{redirect:'error',headers:{Accept:'application/json',
   ...(kind==='KenPom'?{Authorization:'Bearer '+kenpomKey}:{})},
   signal:AbortSignal.timeout(16000)});
 if(!res.ok)throw Error(kind+'_HTTP_'+res.status);
 const bytes=Buffer.from(await res.arrayBuffer());
 if(bytes.byteLength>maxBytes)throw Error('SOURCE_RESPONSE_TOO_LARGE');
 return JSON.parse(bytes.toString('utf8'));
}
const sources={nba:'basketball/nba',nfl:'football/nfl',cfb:'football/college-football',cbb:'basketball/mens-college-basketball'};
// Expand completed-week evidence as the season advances, without future-week assumptions.
const seasonYear=Number(date.slice(5,7))<=6?Number(date.slice(0,4))-1:Number(date.slice(0,4));
const weeksSince=(start,max)=>Math.min(max,Math.max(1,Math.floor((dayNumber(date)-dayNumber(start))/604800000)+2));
const nflWeeks=weeksSince(seasonYear+'-09-10',18),cfbWeeks=weeksSince(seasonYear+'-08-22',18);
function rawFinals(payload,sport,cutoff=nowMs){
 if(!Array.isArray(payload?.events))return [];
 const out=[];
 for(const event of payload.events){
  for(const c of event.competitions||[]){
   if(!c?.status?.type?.completed&&!event.status?.type?.completed)continue;
   const start=c.date||event.date;
   if(!Number.isFinite(Date.parse(start))||Date.parse(start)>=cutoff)continue;
   const h=(c.competitors||[]).find(x=>x.homeAway==='home'),a=(c.competitors||[]).find(x=>x.homeAway==='away');
   if(!h?.team?.id||!a?.team?.id||h.team.id===a.team.id)continue;
   const hp=Number(h.score),ap=Number(a.score);
   if(!Number.isFinite(hp)||!Number.isFinite(ap)||hp<0||ap<0)return []; // malformed source fails closed
   out.push({id:String(c.id||event.id),sport,start,homeId:String(h.team.id),awayId:String(a.team.id),
     homePoints:hp,awayPoints:ap,home:h,away:a,neutralSite:c.neutralSite===true});
  }
 }
 return out;
}
function teamForm(finals,id){
 const relevant=finals.filter(f=>f.homeId===id||f.awayId===id);
 if(!relevant.length)return null;
 const p=relevant.map(f=>({
  pointsFor:f.homeId===id?f.homePoints:f.awayPoints,
  pointsAgainst:f.homeId===id?f.awayPoints:f.homePoints,
  start:f.start
 }));
 const n=p.length;
 return {games:n,pf:p.reduce((s,x)=>s+x.pointsFor,0),pa:p.reduce((s,x)=>s+x.pointsAgainst,0),
   lastGameAt:p.map(x=>x.start).sort().at(-1)};
}
async function fetchWeeklyFinals(sport,weeks){
 const all=[],warnings=[];
 for(let week=1;week<=weeks;week++){
  const u=new URL('https://site.api.espn.com/apis/site/v2/sports/'+sources[sport]+'/scoreboard');
  for(const [k,v] of Object.entries({week:String(week),year:String(seasonYear),seasontype:'2',limit:'499',...(sport==='cfb'?{groups:'80'}:{})}))u.searchParams.set(k,v);
  try{
   const j=await getJson(u.toString());
   if(!Array.isArray(j.events)||j.events.length>=499){warnings.push('WEEK_'+week+'_TRUNCATED');continue;}
   all.push(...rawFinals(j,sport));
  }catch(e){warnings.push('WEEK_'+week+':'+String(e.message||e));}
 }
 const final=[...new Map(all.map(f=>[f.id,f])).values()];
 results.skipped.push(...warnings.map(x=>({sport,reason:x})));
 return final;
}
async function fetchNbaFinals(){
 const all=[];
 for(let offset=1;offset<=15;offset++){
  const d=shiftDay(date,-offset),u='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates='+d.replaceAll('-','')+'&limit=100';
  try{all.push(...rawFinals(await getJson(u),'nba'));}
  catch(e){results.skipped.push({sport:'nba',reason:'DATE_'+d+':'+String(e.message||e)});}
 }
 return [...new Map(all.map(g=>[g.id,g])).values()].sort((a,b)=>Date.parse(b.start)-Date.parse(a.start));
}
function statNumber(stat){
 const v=stat?.displayValue??stat?.value;
 if(v==null||v==='')return null;
 const n=Number(v);
 return Number.isFinite(n)?n:null;
}
function boxStat(stats,names){
 const s=(stats||[]).find(x=>names.some(n=>n===String(x.name||'').toLowerCase()||n===String(x.label||'').toLowerCase()||n===String(x.abbreviation||'').toLowerCase()));
 return s||null;
}
function pairAttempts(stat){
 const v=String(stat?.displayValue??stat?.value??'').trim();
 const m=v.match(/^\d+\s*-\s*(\d+)$/);return m?Number(m[1]):null;
}
async function nbaBoxHistory(finals,slate){
 const needed=new Set(slate.flatMap(g=>[String(g.home.espnId),String(g.away.espnId)]));
 const ordered=finals.filter(g=>needed.has(g.homeId)||needed.has(g.awayId));
 const chosen=[],byTeam=new Map();
 for(const g of ordered){
  const h=byTeam.get(g.homeId)||0,a=byTeam.get(g.awayId)||0;
  if(h>=6&&a>=6)continue;
  chosen.push(g);byTeam.set(g.homeId,h+1);byTeam.set(g.awayId,a+1);
  if(chosen.length>=75)break;
 }
 const out=new Map();
 for(const g of chosen){
  let j;try{j=await getJson('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event='+g.id,{maxBytes:7000000});}
  catch(e){results.skipped.push({sport:'nba',reason:'BOX_'+g.id+':'+String(e.message||e)});continue;}
  const rows=j?.boxscore?.teams;
  if(!Array.isArray(rows))continue;
  for(const [id,pointsFor,pointsAgainst] of [[g.homeId,g.homePoints,g.awayPoints],[g.awayId,g.awayPoints,g.homePoints]]){
   const row=rows.find(r=>String(r.team?.id)===id),stats=row?.statistics;
   if(!Array.isArray(stats))continue;
   const fg=boxStat(stats,['fieldgoalsmade-fieldgoalsattempted','fg','fieldgoals']);
   const ft=boxStat(stats,['freethrowsmade-freethrowsattempted','ft','freethrows']);
   const fga=pairAttempts(fg),fta=pairAttempts(ft);
   const orb=statNumber(boxStat(stats,['offensiverebounds','oreb','orb']));
   const tov=statNumber(boxStat(stats,['turnovers','to','tov']));
   const possession=estimatePossessions({fga,fta,orb,tov});
   if(!Number.isFinite(possession)||possession<65||possession>135)continue;
   const r={date:g.start,pointsFor,pointsAgainst,fga,fta,orb,tov,possessions:possession};
   if(!out.has(id))out.set(id,[]);
   out.get(id).push(r);
  }
 }
 return out;
}
function packetEvent(g,p,{sport,sourceAt=generatedAt,sourceLabel='Verified inputs',modelId,version}={}){
 const away=Number(p.away),home=Number(p.home);
 if(!Number.isFinite(home)||!Number.isFinite(away)||home<5||away<5||home>180||away>180)return null;
 const margin=Math.round((home-away)*10)/10,total=Math.round((home+away)*10)/10;
 return {eventId:String(g.id),date:g.date,start:g.start,
   homeId:sport+'-'+g.home.espnId,awayId:sport+'-'+g.away.espnId,
   sourceCapturedAt:sourceAt,canAuthorizeWager:false,
   projection:{homeScore:home,awayScore:away,margin,total,
     modelId:modelId||p.modelId,modelVersion:version||p.modelVersion||p.version||'RESEARCH'},
   sourceLabel,sourceDataCutoffAt:p.dataCutoffAt||null};
}
function packetFor(sport,day,events,expiryHours=18){
 return {version:1,visibility:'PRIVATE_PERSONAL_ANALYSIS',sport,date:day,generatedAt,
   expiresAt:new Date(nowMs+Math.min(22,expiryHours)*3600000).toISOString(),
   modelAuthority:'RESEARCH_ONLY',canAuthorizeWager:false,events};
}
async function writeObject(key,payload){
 const body=JSON.stringify(payload),bytes=Buffer.byteLength(body);
 if(bytes>512000)throw Error('PRIVATE_PACKET_TOO_LARGE');
 if(!token||!account)return {stored:false,reason:'CLOUDFLARE_R2_CREDS_UNAVAILABLE'};
 const url='https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(account)+
  '/r2/buckets/fbis-archive/objects/'+key.split('/').map(encodeURIComponent).join('/');
 const headers={Authorization:'Bearer '+token,'content-type':'application/octet-stream'};
 const res=await fetch(url,{method:'PUT',headers,body,signal:AbortSignal.timeout(35000)});
 if(!res.ok)throw Error('R2_PUBLISH_HTTP_'+res.status);
 const again=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(35000)});
 if(!again.ok)throw Error('R2_READBACK_HTTP_'+again.status);
 const read=await again.text();
 if(sha(read)!==sha(body))throw Error('R2_READBACK_SHA256_MISMATCH');
 return {stored:true,key,sha256:sha(body),bytes};
}
async function run(){
 const board=await captureScoreboards({date,sports:['cbb','nfl','nba','cfb']});
 const target=Object.fromEntries(['cbb','nfl','nba','cfb'].map(s=>[s,board.games.filter(g=>g.sport===s&&g.status==='scheduled'&&Date.parse(g.start)>nowMs)]));
 results.slateCounts=Object.fromEntries(Object.entries(target).map(([s,rows])=>[s,rows.length]));
 results.feedStates=Object.fromEntries(Object.entries(board.feeds).map(([s,f])=>[s,{ok:f.ok,n:f.n}]));
 // Research forecast products must have independently measured input coverage.
 const nflFinals=target.nfl.length?await fetchWeeklyFinals('nfl',nflWeeks):[];
 const cfbFinals=target.cfb.length?await fetchWeeklyFinals('cfb',cfbWeeks):[];
 const nbaFinals=target.nba.length?await fetchNbaFinals():[];
 const nbaHistory=target.nba.length?await nbaBoxHistory(nbaFinals,target.nba):new Map();
 results.sourceCoverage={nflFinals:nflFinals.length,cfbFinals:cfbFinals.length,nbaFinals:nbaFinals.length,nbaWithBoxes:[...nbaHistory.values()].filter(x=>x.length>=3).length};
 const eventGroups={nfl:[],nba:[],cfb:[],cbb:[]};
 for(const g of target.nfl){
  const home=teamForm(nflFinals,String(g.home.espnId)),away=teamForm(nflFinals,String(g.away.espnId));
  if(!home||!away||home.games<4||away.games<4){results.skipped.push({sport:'nfl',event:g.id,reason:'INSUFFICIENT_VERIFIED_2026_FORM'});continue;}
  const p=projectNflFormV0(g,{homeCurrent:home,awayCurrent:away});
  if(!p.ok){results.skipped.push({sport:'nfl',event:g.id,reason:p.reason||'MODEL_INVALID'});continue;}
  const e=packetEvent(g,p,{sport:'nfl',sourceLabel:'ESPN verified 2026 final scores; NFL form baseline, not NFL-PRO champion',modelId:NFL_SHADOW_ID,version:p.version});
  if(e)eventGroups.nfl.push(e);
 }
 for(const g of target.cfb){
  const home=teamForm(cfbFinals,String(g.home.espnId)),away=teamForm(cfbFinals,String(g.away.espnId));
  if(!home||!away||home.games<5||away.games<5){results.skipped.push({sport:'cfb',event:g.id,reason:'INSUFFICIENT_VERIFIED_2026_FORM'});continue;}
  const n=CFB_CONSTANTS.leaguePpg;
  const p=projectCfbMatchup({homeOff:home.pf/home.games,homeDef:home.pa/home.games,
    awayOff:away.pf/away.games,awayDef:away.pa/away.games,
    hfa:g.neutralSite?0:CFB_CONSTANTS.hfaPoints,national:n});
  const e=packetEvent(g,p,{sport:'cfb',sourceLabel:'ESPN verified 2026 team scoring form; CFB score-form research (NOT fitted CFB-FBIS-v2)',modelId:'CFB-SCORE-FORM-RESEARCH',version:'v1.3-score-form'});
  if(e)eventGroups.cfb.push(e);
 }
 for(const g of target.nba){
  const home=nbaHistory.get(String(g.home.espnId))||[],away=nbaHistory.get(String(g.away.espnId))||[];
  if(home.length<3||away.length<3){results.skipped.push({sport:'nba',event:g.id,reason:'INSUFFICIENT_VERIFIED_POSSESSION_BOX_HISTORY'});continue;}
  const p=projectNbaGame(g,{homeHistory:home,awayHistory:away});
  if(!p.ok){results.skipped.push({sport:'nba',event:g.id,reason:p.reason||'MODEL_INVALID'});continue;}
  const e=packetEvent(g,p,{sport:'nba',sourceLabel:'ESPN actual current-season box scores; lineup/injury context unavailable (NBA-FBIS-v1 research)',modelId:NBA_MODEL_ID,version:NBA_MODEL_VERSION});
  if(e)eventGroups.nba.push(e);
 }
 // The one permitted licensed current CBB ratings pull runs only if a key was ALREADY provisioned.
 if(target.cbb.length&&kenpomKey){
  try{
   const u='https://kenpom.com/api.php?endpoint=ratings&y=2027';
   const raw=await getJson(u,{kind:'KenPom',maxBytes:3000000});
   if(!Array.isArray(raw)||raw.length<300)throw Error('CBB_RATINGS_TEAM_COVERAGE_INCOMPLETE');
   const mapped=indexKenpomRows(normalizeKenpomRatingRows(raw),2026);
   for(const g of target.cbb){
    if(typeof g.neutralSite!=='boolean'){results.skipped.push({sport:'cbb',event:g.id,reason:'NEUTRAL_SITE_NOT_VERIFIED'});continue;}
    const home=lookupKenpomRating(mapped,g.home),away=lookupKenpomRating(mapped,g.away);
    if(!home||!away){results.skipped.push({sport:'cbb',event:g.id,reason:'KENPOM_TEAM_MATCH_UNVERIFIED'});continue;}
    const p=cbbKenpomRatingsV1(g,{homeAdjOe:home.adjOe,homeAdjDe:home.adjDe,homeTempo:home.tempo,
     awayAdjOe:away.adjOe,awayAdjDe:away.adjDe,awayTempo:away.tempo});
    if(!p.ok)continue;
    eventGroups.cbb.push({eventId:String(g.id),date:g.date,start:g.start,
      homeId:'cbb-'+g.home.espnId,awayId:'cbb-'+g.away.espnId,neutralSite:g.neutralSite,
      primary:{home:p.home,away:p.away,margin:p.margin,total:p.total,modelId:'CBB-KENPOM-RATINGS-v1',
       modelVersion:'v1',attribution:'KenPom authorized 2027 ratings + FBIS independent formula; PRELIMINARY / no CBBD validation'},
      comparison:null,confirmationAvailable:false});
   }
  }catch(e){results.errors.push({sport:'cbb',reason:'KENPOM_FETCH_OR_MAPPING_FAILED:'+String(e.message||e)});}
 }else if(target.cbb.length)results.skipped.push({sport:'cbb',reason:'NO_ALREADY_PROVISIONED_KENPOM_API_KEY'});
 for(const sport of ['cbb','nfl','nba','cfb']){
  const events=eventGroups[sport];
  if(!events.length){results.skipped.push({sport,reason:'NO_VALID_CURRENT_FORECASTS'});continue;}
  let packet;
  if(sport==='cbb'){
   packet={version:1,season:2027,generatedAt,expiresAt:new Date(nowMs+6*3600000).toISOString(),
     visibility:'PRIVATE_PERSONAL_ANALYSIS',canAuthorizeWager:false,
     captures:{kenpom:generatedAt},sourceAttribution:['KenPom','ESPN'],
     events,summary:{fixtures:target.cbb.length,primaryProjections:events.length,confirmed:0,qualified:0},
     dataQuality:'RESEARCH_PRELIMINARY',canQualify:false};
   validatePrivatePacket(packet);
  }else{
   packet=packetFor(sport,date,events);
   validateFourSportPacket(packet,{sport,date});
  }
  const key='private/'+sport+'/projections/'+date+'.json';
  const file=outDir+'/'+sport+'-'+date+'.json';
  await writeFile(file,JSON.stringify(packet));
  try{const pub=await writeObject(key,packet);results.written.push({sport,events:events.length,file,...pub});}
  catch(e){results.errors.push({sport,reason:'PUBLICATION_FAILED:'+String(e.message||e)});}
 }
 results.modelCoverage=Object.fromEntries(Object.entries(eventGroups).map(([s,events])=>[s,events.length]));
 // No odds provider calls: these are projections only; the display will NOT label a best bookmaker.
 results.marketQuoteCoverage={cbb:0,nfl:0,nba:0,cfb:0};
}
try{await run();}
catch(e){results.errors.push({stage:'RUN',reason:String(e.message||e)});}
await writeFile(outDir+'/receipt.json',JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results));
if(results.errors.length||!results.written.some(x=>x.stored))process.exitCode=1;
