/** Read immutable, prestart FBIS player forecasts through a bounded daily receipt.
 * Date index is mutable metadata only; source forecast object hashes are verified.
 * Fail closed on game/athlete/team or source clock mismatches.
 */
import {propTeamKey} from './propResearchData.js';
const supported=new Set(['nba','nfl','nhl','mlb']);
const finite=x=>x!==null&&x!==''&&Number.isFinite(Number(x))?Number(x):null;
const validId=x=>typeof x==='string'&&/^[a-z0-9:_-]{1,160}$/i.test(x);
export const frozenForecastDateIndex=(sport,date)=>'player-props/forecasts/v1/'+sport+'/dates/'+date+'.json';
const digest=async(raw,subtle)=>[...new Uint8Array(await subtle.digest('SHA-256',new TextEncoder().encode(raw)))]
 .map(x=>x.toString(16).padStart(2,'0')).join('');
export function mapIndexedFrozenForecasts(objects=[],{sport,games=[],players=[],now=Date.now()}={}){
 const gameIndex=new Map(games.filter(g=>g.sport===sport).map(g=>[String(g.id),g]));
 const result=[],keys=new Set();
 for(const obj of objects){
  const g=gameIndex.get(String(obj?.canonicalEventId||'')),start=Date.parse(g?.start);
  const frozen=Date.parse(obj?.frozenAt);
  if(!g||obj.schemaVersion!==1||obj.sport!==sport||
   obj.recordedWager!==false||!Number.isFinite(start)||start<=now||
   Date.parse(obj.eventStart)!==start||!Number.isFinite(frozen)||frozen>=start||
   !Array.isArray(obj.forecasts)||obj.forecasts.length>1500)continue;
  const teams=[propTeamKey(sport,g.home_abbr),propTeamKey(sport,g.away_abbr)];
  for(const f of obj.forecasts){
   const id=String(f?.canonicalPlayerId||''),parts=id.split(':'),playerId=parts.at(-1);
   const asOf=Date.parse(f?.modelAsOf),projection=finite(f?.projection),market=String(f?.market||'');
   if(parts.length!==3||parts[0]!==sport||!validId(playerId)||projection===null||
    !Number.isFinite(asOf)||asOf>frozen||asOf>=start||f.period!=='full_game'||
    !validId(market)||!f.modelId||!f.modelVersion)continue;
   const matches=players.filter(p=>p.sport===sport&&String(p.player_id)===playerId&&
     teams.includes(propTeamKey(sport,p.team_key)));
   if(matches.length!==1)continue;
   const p=matches[0],team=propTeamKey(sport,p.team_key);
   const opponent=team===teams[0]?teams[1]:teams[0];
   if(!opponent||opponent===team)continue;
   const identity=[g.id,id,market,'full_game'].join('|');
   if(keys.has(identity))continue;keys.add(identity);
   result.push({id:'frozen:'+identity,sport,canonicalEventId:String(g.id),
    canonicalPlayerId:id,player_name:p.player_name||p.name,team,opponent,
    start_time:g.start,canonical_market:market,period:'full_game',
    fbis_projection:projection,sigma:finite(f.sigma),modelId:f.modelId,modelVersion:f.modelVersion,
    modelAsOf:f.modelAsOf,independent:true,marketInformed:false,identityVerified:true,
    modelStatus:'FROZEN_PREGAME_SOURCE',availabilityStatus:p.availability_status||'UNKNOWN',
    historicalPregame:false,marketAvailable:false,
    canQualify:false,canAuthorizeWager:false,
    reasons:['PERSISTED_PREGAME_FORECAST','THRESHOLD_CALIBRATION_REQUIRED']});
  }
 }
 return result;
}
export async function loadIndexedFrozenForecasts(env,{sport,date,games=[],players=[],now=Date.now(),subtle=globalThis.crypto?.subtle}={}){
 if(!supported.has(sport)||!/^\d{4}-\d{2}-\d{2}$/.test(String(date||''))||
 !env?.ARCHIVE?.get||!subtle)return {rows:[],status:'INDEX_UNAVAILABLE'};
 try{
  const path=frozenForecastDateIndex(sport,date);
  const file=await env.ARCHIVE.get(path)||await env.ARCHIVE.get('player-props/forecasts/v1/'+sport+'/last-capture.json');
  if(!file)return {rows:[],status:'NO_CAPTURE_INDEX'};
  const index=await file.json();
  if(index.sport!==sport||index.date!==date||!Array.isArray(index.receipts))
   return {rows:[],status:'INDEX_DATE_MISMATCH'};
  const indexed=index.receipts.filter(r=>r?.ok===true&&r.key&&validId(r.event)&&
    r.key.startsWith('player-props/forecasts/v1/'+sport+'/'+encodeURIComponent(r.event)+'/'))
    .slice(0,32);
  const read=await Promise.all(indexed.map(async r=>{
   try{
    const blob=await env.ARCHIVE.get(r.key);
    if(!blob)return null;
    const raw=await blob.text(),expected=r.key.match(/-([a-f0-9]{64})\.json$/)?.[1];
    if(!expected||await digest(raw,subtle)!==expected)return null;
    return JSON.parse(raw);
   }catch{return null}
  }));
  const valid=read.filter(Boolean);
  const rows=mapIndexedFrozenForecasts(valid,{sport,games,players,now});
  return {rows,status:valid.length===indexed.length?'SOURCE_HASH_VERIFIED':'PARTIAL_HASH_OR_READ_FAILURE',
   checkedObjects:indexed.length,verifiedObjects:valid.length};
 }catch{return {rows:[],status:'READ_FAILED'};}
}
