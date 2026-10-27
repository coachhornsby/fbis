import { productSportDbHandle } from '../lib/databaseTopology.js';
import { loadNhlPersistentProfiles } from '../lib/nhlPersistentProfiles.js';
import { attachNhlCardStarterEvidence } from '../lib/nhlCardStarterEvidence.js';
import { buildNhlInjuryReport,NHL_INJURY_SOURCE_HEALTH } from '../lib/nhlInjuryIntelligence.js';
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
export async function onRequestGet({request,env}){
 const id=new URL(request.url).searchParams.get('id')||'';
 if(!/^[A-Za-z0-9:_-]{1,100}$/.test(id))return json({ok:false,reason:'GAME_ID_REQUIRED'},400);
 const authority=productSportDbHandle(env,'nhl'),db=authority.db;
 if(!db?.prepare)return json({ok:false,reason:'NHL_AUTHORITY_UNAVAILABLE'},503);
 try{
  const row=await db.prepare("SELECT id,start,home_abbr,away_abbr FROM games WHERE id=? AND sport='nhl'").bind(id).first();
  if(!row)return json({ok:false,reason:'NHL_GAME_NOT_FOUND'},404);
  const game={id:row.id,sport:'nhl',start:row.start,home:{abbr:row.home_abbr},away:{abbr:row.away_abbr}};
  const profiles=await loadNhlPersistentProfiles(db,[row.home_abbr,row.away_abbr]);
  let rows=[],storeAvailable=true;
  try{rows=(await db.prepare("SELECT * FROM player_availability_observations WHERE sport='nhl' AND observed_at>=? ORDER BY observed_at DESC LIMIT 1500")
    .bind(new Date(Date.now()-7*86400000).toISOString()).all()).results||[];}catch{storeAvailable=false;}
  const options={gameId:id,gameStart:row.start,storeAvailable};
  return json({ok:true,gameId:id,start:row.start,checkedAt:new Date().toISOString(),binding:authority.binding,
   injuries:{home:buildNhlInjuryReport(rows,row.home_abbr,options),away:buildNhlInjuryReport(rows,row.away_abbr,options)},
   goalies:attachNhlCardStarterEvidence([game],profiles).games[0].nhlStarterEvidence,
   sourceHealth:NHL_INJURY_SOURCE_HEALTH,researchOnly:true,modelInputsChanged:false,canAuthorizeWager:false});
 }catch{return json({ok:false,reason:'NHL_INTELLIGENCE_READ_FAILED'},503);}
}
