import {authorizeHarvest,unauthorizedBody} from "../lib/auth.js";
import {resolveTennisFixturePlayers} from "../lib/tennisFixturePlayerLink.js";
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const normal=v=>String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
export async function buildTennisIntelligenceBank(db,{limit=30}={}){
 const max=Math.min(50,Math.max(1,Number(limit)||30));
 const result=await db.prepare("SELECT fixture_id AS id,tour,player1_name AS away_name,player2_name AS home_name,match_time AS start,status,source,fetched_at FROM tennis_external_fixtures WHERE status IN ('SCHEDULED','IN_PROGRESS') ORDER BY match_time ASC LIMIT ?").bind(max).all();
 const fixtures=[];
 for(const fixture of result.results||[]){
  const identity=await resolveTennisFixturePlayers(db,fixture);
  const players=[];
  for(const player of identity.players){
   if(!player.matched){players.push(player);continue;}
   const profiles=await db.prepare("SELECT surface,profile_json,last_match_date,source,source_as_of,production_dependency FROM tennis_player_profiles_current WHERE tour=? AND player_key=? ORDER BY surface").bind(fixture.tour,normal(player.fixtureName)).all();
   players.push({...player,profiles:(profiles.results||[]).map(p=>({surface:p.surface,profile:JSON.parse(p.profile_json),lastMatchDate:p.last_match_date,source:p.source,sourceAsOf:p.source_as_of,productionDependency:Boolean(p.production_dependency)}))});
  }
  const market=await db.prepare("SELECT source,market_family,COUNT(*) AS observations,MAX(collected_at) AS last_collected FROM normalized_market_observations WHERE sport='tennis' AND canonical_event_id=? GROUP BY source,market_family ORDER BY source,market_family").bind(fixture.id).all();
  fixtures.push({...fixture,players,playerIdentityVerified:identity.verified,
   linkedMarkets:market.results||[],canQualify:false,canAuthorizeWager:false});
 }
 return {ok:true,researchOnly:true,fixtureCount:fixtures.length,fixtures,
  playerIdentityComplete:fixtures.filter(f=>f.playerIdentityVerified).length,
  fixturesWithLinkedMarkets:fixtures.filter(f=>f.linkedMarkets.length>0).length,
  canQualify:false,canAuthorizeWager:false};
}
export async function onRequestGet({request,env}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
 if(!env?.DB)return json({ok:false,error:"DB_REQUIRED"},503);
 try{
  const limit=new URL(request.url).searchParams.get("limit")||30;
  return json(await buildTennisIntelligenceBank(env.DB,{limit}));
 }catch(error){return json({ok:false,error:String(error?.message||error).slice(0,160)},503);}
}
