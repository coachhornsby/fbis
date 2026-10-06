import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { buildSlate, resolveSlateDate } from "../lib/slateEngine.js";
import { WNBA_PROP_IMPACT_CHALLENGER_ID, WNBA_GAME_IMPACT_CHALLENGER_ID } from "../lib/wnbaPlayerImpactShadow.js";
import { WNBA_PLAYER_OPPORTUNITY_ID } from "../lib/wnbaProspectiveChallenger.js";
import { buildWnbaOffers, buildWnbaOffersFromOwnedRows, mergeWnbaOffers, loadWnbaOwnedOddsRows } from "../lib/wnbaWagerDecision.js";
import { decisionFromOffer } from "../lib/wagerDecisionEngine.js";

const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}})}
function todayCT(){return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}
async function sha256(s){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(s)));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}

async function persistProp(db,game,row,capturedAt){
  const s=row?.impactShadow;if(!s)return 0;
  const natural=["wnba-impact-prop",game.id,row.playerId,row.market,capturedAt,s.modelVersion].join("|");
  const id="wip_"+(await sha256(natural)).slice(0,28);
  const sql="INSERT OR IGNORE INTO wnba_player_prop_impact_shadow (id,event_id,event_start,player_id,player_name,team,market_type,feature_cutoff_timestamp,baseline_projection,impact_projection,sigma,projected_minutes,player_impact_net,availability_verified,role_context_json,lineup_context_json,model_id,model_version,can_qualify,can_authorize,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";
  const res=await db.prepare(sql).bind(
    id,String(game.id),game.start||null,row.playerId||null,row.playerName,row.team||null,row.market,capturedAt,
    finite(s.baselineProjection),finite(s.projection),finite(s.sigma),finite(s.projectedMinutes),finite(s.playerImpact?.net),
    s.availabilityVerified?1:0,JSON.stringify(s.roleContext||null),JSON.stringify(s.lineupContext||null),
    WNBA_PROP_IMPACT_CHALLENGER_ID,s.modelVersion||"research-v1-shadow",0,0,capturedAt
  ).run();
  return Number(res?.meta?.changes||res?.changes||0);
}
async function persistGame(db,game,capturedAt){
  const s=game?.wnbaImpactGameShadow;if(!s)return 0;
  const base=game?.wnbaV2||game?.researchProjection||{};
  const natural=["wnba-impact-game",game.id,capturedAt,s.modelVersion].join("|");
  const id="wig_"+(await sha256(natural)).slice(0,28);
  const sql="INSERT OR IGNORE INTO wnba_game_impact_shadow (id,event_id,event_start,feature_cutoff_timestamp,baseline_home,baseline_away,baseline_margin,baseline_total,impact_home,impact_away,impact_margin,impact_total,home_adjustment,away_adjustment,availability_verified,model_id,model_version,can_qualify,can_authorize,context_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";
  const res=await db.prepare(sql).bind(
    id,String(game.id),game.start||null,capturedAt,
    finite(base.home),finite(base.away),finite(base.margin),finite(base.total),
    finite(s.home),finite(s.away),finite(s.margin),finite(s.total),
    finite(s.adjustments?.home),finite(s.adjustments?.away),s.adjustments?.availabilityVerified?1:0,
    WNBA_GAME_IMPACT_CHALLENGER_ID,s.modelVersion||"research-v1-shadow",0,0,JSON.stringify(s.adjustments||{}),capturedAt
  ).run();
  return Number(res?.meta?.changes||res?.changes||0);
}


async function persistPossessionGame(db,game,s,capturedAt){
  if(!s?.modelId)return 0;
  const base=s.baseline||game?.wnbaV2||game?.researchProjection||{};
  const natural=["wnba-possession-game",game.id,s.modelId,capturedAt,s.modelVersion].join("|");
  const id="wpg_"+(await sha256(natural)).slice(0,28);
  const feature=s.feature||{};
  const sql="INSERT OR IGNORE INTO wnba_game_possession_challenger_shadow (id,natural_key,event_id,event_start,captured_at,feature_cutoff_timestamp,model_id,model_version,baseline_home,baseline_away,baseline_margin,baseline_total,challenger_home,challenger_away,challenger_margin,challenger_total,sigma_margin,sigma_total,home_feature_value,away_feature_value,feature_delta,feature_reliability,lineup_reliability,feature_json,market_informed,can_qualify,can_authorize,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";
  const res=await db.prepare(sql).bind(id,natural,String(game.id),game.start||null,capturedAt,s.featureCutoffTimestamp||capturedAt,s.modelId,s.modelVersion||"prospective-shadow-v1",finite(base.home),finite(base.away),finite(base.margin),finite(base.total),finite(s.home),finite(s.away),finite(s.margin),finite(s.total),finite(s.sigmaMargin),finite(s.sigmaTotal),finite(feature.home),finite(feature.away),finite(feature.delta),finite(feature.reliability),finite(feature.lineupReliability),JSON.stringify(feature),0,0,0,capturedAt).run();
  return Number(res?.meta?.changes||res?.changes||0);
}
async function persistPossessionMarket(db,game,s,offer,capturedAt){
  const evidence={matchupReliability:finite(s?.feature?.reliability)??0.5,dataQuality:finite(s?.feature?.reliability)??0.5,historicalFactorReliability:finite(s?.feature?.reliability)??0.5,uncertaintyQuality:0.65,priceQuality:0.75};
  const d=decisionFromOffer({offer,distribution:s,evidence,minEv:0.03,stakeRulesValidated:false});
  if(d?.modelProbability==null||d?.breakEvenProbability==null||d?.expectedValue==null)return 0;
  const natural=["wnba-possession-market",game.id,s.modelId,offer.market,offer.side,offer.line,offer.price,capturedAt].join("|");
  const id="wpm_"+(await sha256(natural)).slice(0,28);
  const sql="INSERT OR IGNORE INTO wnba_game_possession_market_shadow (id,natural_key,event_id,event_start,captured_at,model_id,model_version,market,side,line,american_price,sportsbook,market_observed_at,model_probability,break_even_probability,probability_edge,expected_value,research_decision,feature_reliability,lineup_reliability,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";
  const res=await db.prepare(sql).bind(id,natural,String(game.id),game.start||null,capturedAt,s.modelId,s.modelVersion||"prospective-shadow-v1",offer.market,offer.side,finite(offer.line),finite(offer.price),offer.sportsbook||null,offer.observedAt||capturedAt,finite(d.modelProbability),finite(d.breakEvenProbability),finite(d.probabilityEdge),finite(d.expectedValue),d.decision||"PASS",finite(s?.feature?.reliability),finite(s?.feature?.lineupReliability),capturedAt).run();
  return Number(res?.meta?.changes||res?.changes||0);
}
async function persistOpportunity(db,game,row,capturedAt){
  const s=row?.opportunityShadow;if(!s)return 0;
  const natural=["wnba-opportunity",game.id,row.playerId,row.market,capturedAt,s.modelVersion].join("|");
  const id="wpo_"+(await sha256(natural)).slice(0,28);
  const sql="INSERT OR IGNORE INTO wnba_player_opportunity_shadow (id,natural_key,event_id,event_start,captured_at,feature_cutoff_timestamp,player_id,player_name,team_id,market_type,model_id,model_version,baseline_projection,opportunity_projection,sigma,projected_minutes_mean,projected_minutes_sd,usage_mean,usage_sd,fga_mean,fga_sd,tpa_mean,tpa_sd,rebound_opp_mean,rebound_opp_sd,assist_opp_mean,assist_opp_sd,availability_verified,expected_teammates_json,opportunity_json,market_informed,can_qualify,can_authorize,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";
  const res=await db.prepare(sql).bind(id,natural,String(game.id),game.start||null,capturedAt,s.featureCutoffTimestamp||capturedAt,row.playerId||null,row.playerName,row.team||null,row.market,WNBA_PLAYER_OPPORTUNITY_ID,s.modelVersion||"prospective-shadow-v1",finite(row.fbisProjection),finite(s.projection),finite(s.sigma),finite(s.minutesMean),finite(s.minutesSd),finite(s.usageMean),finite(s.usageSd),finite(s.fgaMean),finite(s.fgaSd),finite(s.tpaMean),finite(s.tpaSd),finite(s.reboundOppMean),finite(s.reboundOppSd),finite(s.assistOppMean),finite(s.assistOppSd),s.availabilityVerified?1:0,JSON.stringify(s.expectedTeammates||null),JSON.stringify(s),0,0,0,capturedAt).run();
  return Number(res?.meta?.changes||res?.changes||0);
}
export async function onRequestPost(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok)return json(unauthorizedBody(auth.reason),401);
  if(!context.env?.DB)return json({ok:false,error:"database unavailable"},503);
  const body=await context.request.json().catch(()=>({}));
  const resolved=resolveSlateDate(String(body?.date||todayCT()),{maxPast:2,maxFuture:3});
  if(!resolved.ok)return json({ok:false,error:resolved.error},400);
  try{
    const env={PARLAY_API_KEY:context.env.PARLAY_API_KEY,THEODDS_API_KEY:context.env.THEODDS_API_KEY,SHARPAPI_API_KEY:context.env.SHARPAPI_API_KEY,THERUNDOWN_API_KEY:context.env.THERUNDOWN_API_KEY,DB:context.env.DB,caches:typeof caches!=="undefined"?caches.default:null,parlayCacheOnly:true,palCacheOnly:true,cfbdScheduleFallback:false};
    const slate=await buildSlate("wnba",resolved.date,env);
    const capturedAt=new Date().toISOString();
    let propInserted=0,gameInserted=0,propRows=0,gameRows=0,possessionRows=0,possessionInserted=0,possessionMarketRows=0,possessionMarketInserted=0,opportunityRows=0,opportunityInserted=0;
    for(const game of slate.games||[]){
      if(game?.status?.live||game?.status?.completed)continue;
      if(game.wnbaImpactGameShadow){gameRows++;gameInserted+=await persistGame(context.env.DB,game,capturedAt)}
      const ownedOdds=await loadWnbaOwnedOddsRows(context.env.DB,game.id);
      const offers=mergeWnbaOffers(buildWnbaOffers(game),buildWnbaOffersFromOwnedRows(ownedOdds));
      for(const s of Object.values(game.wnbaPossessionChallengers||{})){
        possessionRows++;possessionInserted+=await persistPossessionGame(context.env.DB,game,s,capturedAt);
        for(const offer of offers){possessionMarketRows++;possessionMarketInserted+=await persistPossessionMarket(context.env.DB,game,s,offer,capturedAt);}
      }
      for(const row of game.playerProjectionRows||[]){
        if(row.impactShadow){propRows++;propInserted+=await persistProp(context.env.DB,game,row,capturedAt);}
      }
      for(const row of game.playerOpportunityShadowRows||[]){
        opportunityRows++;opportunityInserted+=await persistOpportunity(context.env.DB,game,row,capturedAt);
      }
    }
    return json({ok:true,date:resolved.date,capturedAt,games:gameRows,gameInserted,props:propRows,propInserted,possessionRows,possessionInserted,possessionMarketRows,possessionMarketInserted,opportunityRows,opportunityInserted,modelIds:{legacyGame:WNBA_GAME_IMPACT_CHALLENGER_ID,legacyProp:WNBA_PROP_IMPACT_CHALLENGER_ID,opportunity:WNBA_PLAYER_OPPORTUNITY_ID},canQualify:false,canAuthorize:false,marketInformed:false});
  }catch(err){return json({ok:false,date:resolved.date,error:String(err?.message||err)},502)}
}
