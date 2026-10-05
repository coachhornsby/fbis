import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { simulateTennisV2 } from "../lib/tennisFbisV2.js";
import { buildSharpMarketPrior } from "../lib/tennisMarketV2.js";
import {
  actionObservationToTennisMarket,
  persistTennisMarketSnapshot,
  persistTennisContexts,
  persistTennisV2Decision,
} from "../lib/tennisV2Ledger.js";

function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}})}
const safe=v=>{if(v==null)return null;if(typeof v==="object")return v;try{return JSON.parse(v)}catch{return null}};

async function latestActionRows(db,{hours=8,limit=100}={}){
  const res=await db.prepare(
    `WITH ranked AS (
      SELECT *,
             ROW_NUMBER() OVER(PARTITION BY lower(sport),action_game_id ORDER BY collected_at DESC,created_at DESC) rn
      FROM shadow_market_observations
      WHERE lower(sport) IN ('atp','wta')
        AND collected_at >= datetime('now', ?)
        AND is_live=0
    )
    SELECT id,action_game_id,fbis_event_id,sport,league,home_team,away_team,start_time,
           consensus_json,public_betting_json,market_quality_json,line_movement_json,
           raw_payload_hash,source_observed_at,observed_at,collected_at,created_at
    FROM ranked WHERE rn=1
    ORDER BY start_time,collected_at DESC
    LIMIT ?`
  ).bind(`-${Math.max(1,Math.min(48,Number(hours)||8))} hours`,Math.max(1,Math.min(500,Number(limit)||100))).all();
  return res?.results||[];
}

async function readLatest(db,limit=100){
  const [markets,decisions]=await Promise.all([
    db.prepare(`SELECT * FROM tennis_market_snapshots ORDER BY observed_at DESC LIMIT ?`).bind(limit).all().catch(()=>({results:[]})),
    db.prepare(`SELECT * FROM tennis_v2_research_decisions ORDER BY decision_timestamp DESC LIMIT ?`).bind(limit).all().catch(()=>({results:[]})),
  ]);
  return {markets:markets?.results||[],decisions:decisions?.results||[]};
}

export async function onRequestGet(context){
  if(!context.env?.DB)return json({ok:false,error:"database unavailable"},503);
  const u=new URL(context.request.url),limit=Math.max(1,Math.min(200,Number(u.searchParams.get("limit"))||50));
  const latest=await readLatest(context.env.DB,limit);
  return json({ok:true,...latest,governance:{researchOnly:true,canQualify:false,canAuthorizeWager:false}});
}

export async function onRequestPost(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok)return json(unauthorizedBody(auth.reason),401);
  if(!context.env?.DB)return json({ok:false,error:"database unavailable"},503);
  const body=await context.request.json().catch(()=>({}));
  const mode=String(body.mode||"capture").toLowerCase();

  try{
    let marketInserted=0,contextInserted=0,decisionInserted=0;
    const captured=[];

    if(mode==="capture"||mode==="all"){
      const rows=await latestActionRows(context.env.DB,{hours:body.hours,limit:body.limit});
      for(const row of rows){
        const market=actionObservationToTennisMarket(row);
        if(!market)continue;
        const p=await persistTennisMarketSnapshot(context.env.DB,market);
        if(p.inserted)marketInserted++;
        captured.push({...market,snapshotId:p.id});
      }
    }

    const packets=Array.isArray(body.packets)?body.packets:[];
    if(mode==="decision"||mode==="all"){
      for(const packet of packets){
        if(!packet?.eventId||!packet?.player1||!packet?.player2)continue;
        const contexts=Array.isArray(packet.playerContexts)?packet.playerContexts:[{},{}];
        const pure=simulateTennisV2({
          id:packet.eventId,tour:packet.tour||"atp",surface:packet.surface||"hard",bestOf:Number(packet.bestOf)||3,
          player1:packet.player1,player2:packet.player2,playerContexts:contexts
        },{simulations:Math.max(500,Number(packet.simulations)||1500)},{seed:packet.eventId});
        const market=buildSharpMarketPrior({quotes:packet.marketQuotes||[],pinnacle:packet.pinnacle||null,betfair:packet.betfair||null});
        if(market.p1==null)continue;
        contextInserted+=await persistTennisContexts(context.env.DB,{
          eventId:packet.eventId,tour:packet.tour||"atp",
          players:[packet.player1,packet.player2],
          contexts:contexts.map(c=>({...c,tournament:packet.tournament||c.tournament,surface:packet.surface||c.surface})),
          source:packet.contextSource||"FBIS_TENNIS_V2"
        });
        for(const q of market.quotes||[]){
          const ms=await persistTennisMarketSnapshot(context.env.DB,{
            canonicalEventId:packet.eventId,tour:packet.tour||"atp",player1:packet.player1.name,player2:packet.player2.name,
            provider:q.source||"MARKET_FEED",sportsbook:q.book,player1NoVig:q.p1,player2NoVig:q.p2,hold:q.hold,
            observedAt:q.observedAt||new Date().toISOString(),collectedAt:new Date().toISOString(),tradedVolume:q.volume,
            snapshotType:packet.snapshotType||"DECISION"
          });
          if(ms.inserted)marketInserted++;
        }
        const d=await persistTennisV2Decision(context.env.DB,{
          eventId:packet.eventId,tour:packet.tour||"atp",player1:packet.player1.name,player2:packet.player2.name,
          pureModelId:pure.modelId,pureP1:pure.match?.pPlayer1Win,market,
          actionIntel:packet.actionIntel||null,
          context:{differential:((pure.contextDiagnostics?.[0]?.total||0)-(pure.contextDiagnostics?.[1]?.total||0))*2.5,diagnostics:pure.contextDiagnostics},
          eventStartTime:packet.eventStartTime||null,snapshotType:packet.snapshotType||"DECISION"
        });
        if(d.inserted)decisionInserted++;
      }
    }

    return json({
      ok:true,mode,marketInserted,contextInserted,decisionInserted,captured:captured.length,
      governance:{researchOnly:true,pureModelMarketFree:true,marketLayerSeparate:true,canQualify:false,canAuthorizeWager:false}
    });
  }catch(err){
    return json({ok:false,error:String(err?.message||err)},500);
  }
}
