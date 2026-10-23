import {authorizeHarvest,unauthorizedBody} from "../lib/auth.js";
const response=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});
const source={nfl:"NFL_PBP_VERIFIED_POSSESSIONS",cfb:"SDV_ESPN_CFB_PBP_DRIVES"};
const valid=x=>typeof x==="string"&&Number.isFinite(Date.parse(x));
function dbFor(env,sport){
 const db=sport==="nfl"?env.NFL_DB:env.CFB_DB;
 if(!db?.prepare)throw Error("SPORT_DB_UNBOUND");
 return db;
}
export function validateSdvGame(g,sport){
 if(!g||g.sport!==sport||g.source!==source[sport]||g.prospective!==false||
  g.evidenceClass!=="POSTGAME_RECONSTRUCTED"||g.regulationOnly!==true||
  g.officialScoreMatched!==true||![g.kickoff,g.observedAt,g.gradedAt].every(valid)||
  Date.parse(g.kickoff)>=Date.parse(g.gradedAt)||
  Date.parse(g.gradedAt)>Date.parse(g.observedAt)||
  !/^[A-Za-z0-9:._-]+$/.test(g.gameId||"")||
  !/^[a-f0-9]{64}$/i.test(g.sourceFingerprint||"")||
  !Array.isArray(g.drives)||g.drives.length<12||g.drives.length>70||
  !Number.isInteger(g.homeScore)||!Number.isInteger(g.awayScore)||
  g.homeScore<0||g.awayScore<0||typeof g.sourceAsset!=="string"||
  !g.sourceAsset.startsWith("https://github.com/"))throw Error("INVALID_SDV_ARCHIVE");
 let h=0,a=0;
 for(const [i,d] of g.drives.entries()){
  if(d.seq!==i+1||!["home","away"].includes(d.offense)||
    !Number.isInteger(d.offensePoints)||!Number.isInteger(d.defensePoints)||
    d.offensePoints<0||d.offensePoints>8||d.defensePoints<0||d.defensePoints>8||
    !Number.isInteger(d.startYardsToGoal)||d.startYardsToGoal<0||d.startYardsToGoal>100||
    !Number.isInteger(d.period)||d.period<1||d.period>4||
    (d.offensePoints>0&&d.defensePoints>0))throw Error("INVALID_SDV_DRIVE");
  if(d.offense==="home"){h+=d.offensePoints;a+=d.defensePoints}
  else{a+=d.offensePoints;h+=d.defensePoints}
 }
 if(h!==g.homeScore||a!==g.awayScore)throw Error("INVALID_SDV_SCORE");
 return g;
}
export async function onRequestGet({request,env}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return response(unauthorizedBody(auth.reason),403);
 const sport=new URL(request.url).searchParams.get("sport");
 if(!source[sport])return response({ok:false,error:"INVALID_SPORT"},400);
 try{
  const db=dbFor(env,sport);
  const counts=await db.prepare("SELECT COUNT(*) games,COALESCE(SUM(drive_count),0) drives,MAX(source_observed_at) latest FROM football_sdv_verified_games WHERE sport=?").bind(sport).first();
  return response({ok:true,sport,counts,canAuthorizeWager:false});
 }catch(e){return response({ok:false,error:String(e.message).slice(0,100)},503)}
}
export async function onRequestPost({request,env}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return response(unauthorizedBody(auth.reason),403);
 if(Number(request.headers.get("content-length")||0)>700000)
  return response({ok:false,error:"BATCH_TOO_LARGE"},413);
 let payload;
 try{payload=await request.json()}catch{return response({ok:false,error:"INVALID_JSON"},400)}
 const sport=payload?.sport,games=payload?.games;
 if(!source[sport]||!Array.isArray(games)||games.length<1||games.length>10)
  return response({ok:false,error:"INVALID_BATCH"},400);
 try{
  const verified=games.map(g=>validateSdvGame(g,sport)),db=dbFor(env,sport);
  const batch=verified.map(g=>db.prepare("INSERT OR IGNORE INTO football_sdv_verified_games (sport,game_id,season,home_team_id,away_team_id,kickoff,source_observed_at,graded_at,source_asset,source_fingerprint,source_model,score_home,score_away,drive_count,drives_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(sport,g.gameId,g.season,g.homeTeamId,g.awayTeamId,g.kickoff,g.observedAt,g.gradedAt,g.sourceAsset,g.sourceFingerprint,g.source,g.homeScore,g.awayScore,g.drives.length,JSON.stringify(g.drives)));
  const results=await db.batch(batch);
  if(!Array.isArray(results)||results.length!==verified.length)throw Error("D1_BATCH_INCOMPLETE");
  const inserted=results.reduce((n,r)=>n+(Number(r.meta?.changes)||0),0);
  return response({ok:true,sport,received:verified.length,inserted,canAuthorizeWager:false});
 }catch(e){return response({ok:false,error:String(e.message).slice(0,100)},503)}
}
