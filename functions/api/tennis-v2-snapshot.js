import {currentActionDisplay} from '../lib/actionDisplayFreshness.js';
import {actionTemporalValidity} from '../lib/actionTemporalValidity.js';
import { proveTennisEvent } from "../lib/tennisEventIntegrity.js";
import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { simulateTennisV2 } from "../lib/tennisFbisV2.js";
import { buildSharpMarketPrior } from "../lib/tennisMarketV2.js";
import {
  actionObservationToTennisMarket,
  actionObservationToTennisMarkets,
  persistTennisMarketSnapshot,
  persistTennisContexts,
  persistTennisV2Decision,
} from "../lib/tennisV2Ledger.js";

function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}})}
const safe=v=>{if(v==null)return null;if(typeof v==="object")return v;try{return JSON.parse(v)}catch{return null}};
const clean=v=>String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};

async function loadProfileRows(db,tour,name){
  const res=await db.prepare(
    `SELECT * FROM tennis_player_profiles_current WHERE tour=? AND player_key=? ORDER BY surface`
  ).bind(String(tour||"").toLowerCase(),clean(name)).all().catch(()=>({results:[]}));
  return res?.results||[];
}
function surfaceProfile(rows,surface){
  const row=(rows||[]).find(r=>String(r.surface)===surface);
  if(!row)return null;
  return {...row,profile:safe(row.profile_json)};
}
function contextFromProfileRow(row,courtSpeedIndex=null,event){
  const p=row?.profile||{};
  return {
    surface:event.surface,tournament:event.tournament_name,courtSpeedIndex,
    gamesLast3Days:finite(row?.games_last_3_days),gamesLast7Days:finite(row?.games_last_7_days),
    setsLast3Days:finite(row?.sets_last_3_days),setsLast7Days:finite(row?.sets_last_7_days),
    daysSinceRetirementOrMto:finite(row?.days_since_retirement_or_mto),
    serveStyleScore:finite(p.serveStyleScore),returnStyleScore:finite(p.returnStyleScore),
    sourceAsOf:row?.source_as_of||null,
  };
}
async function courtSpeedForRows(db,tour,a,b){
  const ta=clean(a?.last_tournament),tb=clean(b?.last_tournament);
  if(!ta||ta!==tb)return null;
  const row=await db.prepare(
    `SELECT court_speed_index FROM tennis_tournament_speed_current
      WHERE tour=? AND tournament_key=? ORDER BY season DESC LIMIT 1`
  ).bind(String(tour||"").toLowerCase(),ta).first().catch(()=>null);
  return finite(row?.court_speed_index);
}
export function currentTennisQuotes(quotes=[],now=Date.now()) {
  return quotes.filter(q=>q && typeof q==='object' && (!/ACTION/i.test(String(q.source||q.provider||'')) ||
    (q.observedAt != null && actionTemporalValidity({collectedAt:q.collectedAt,
      sourceObservedAt:q.observedAt},{now}).valid)));
}

export async function autoDecisionForMarket(db,m,{now=Date.now()}={}){
  if (/ACTION/i.test(String(m?.provider||'ACTION_APIFY_CONSENSUS')) && !actionTemporalValidity({
    collectedAt:m?.collected_at,sourceObservedAt:m?.observed_at
  },{now}).valid) return {inserted:false,reason:'ACTION_CAPTURE_NOT_CURRENT'};
  if(!m?.canonical_event_id||!m?.player1||!m?.player2)return {inserted:false,reason:"market-identity-missing"};
  if(!m.event_start_time)return {inserted:false,reason:"event-start-missing"};
  if(Date.parse(m.event_start_time)<=now)return {inserted:false,reason:"event-started"};
  const integrity=await proveTennisEvent(db,m);
  if(!integrity.valid)return {inserted:false,reason:integrity.reason};
  const [r1,r2]=await Promise.all([loadProfileRows(db,m.tour,m.player1),loadProfileRows(db,m.tour,m.player2)]);
  if(!r1.length||!r2.length)return {inserted:false,reason:"deep-profile-missing"};
  const surface=String(integrity.event.surface).toLowerCase();
  const p1=surfaceProfile(r1,surface),p2=surfaceProfile(r2,surface);
  if(!p1?.profile||!p2?.profile)return {inserted:false,reason:"surface-profile-missing"};
  const courtSpeed=await courtSpeedForRows(db,m.tour,{last_tournament:integrity.event.tournament_name},{last_tournament:integrity.event.tournament_name});
  const contexts=[contextFromProfileRow(p1,courtSpeed,integrity.event),contextFromProfileRow(p2,courtSpeed,integrity.event)];
  const pure=simulateTennisV2({
    id:m.canonical_event_id,tour:m.tour,surface,bestOf:3,
    player1:p1.profile,player2:p2.profile,playerContexts:contexts
  },{simulations:1500},{seed:m.canonical_event_id});
  const prior=finite(m.player1_no_vig_prob);
  if(prior==null)return {inserted:false,reason:"market-prior-missing"};
  const market={
    p1:prior,p2:1-prior,source:m.provider||"ACTION_APIFY_CONSENSUS",
    quotes:[{book:m.sportsbook||"consensus",p1Price:finite(m.player1_price),p2Price:finite(m.player2_price),
      p1:prior,p2:1-prior,observedAt:m.observed_at||null,source:m.provider||"ACTION_APIFY"}]
  };
  const actionIntel={publicSplits:{markets:[{market:"ML",ticketPct:finite(m.public_ticket_pct),
    moneyPct:finite(m.public_money_pct),moneyTicketGap:finite(m.money_minus_ticket_pct)}].filter(x=>x.ticketPct!=null||x.moneyPct!=null)}};
  const contextInserted=await persistTennisContexts(db,{
    eventId:m.canonical_event_id,tour:m.tour,players:[p1.profile,p2.profile],contexts,
    source:"SACKMANN_TENNIS_ABSTRACT_RESEARCH"
  });
  const decision=await persistTennisV2Decision(db,{
    eventId:m.canonical_event_id,tour:m.tour,player1:m.player1,player2:m.player2,
    pureModelId:pure.modelId,pureP1:pure.match?.pPlayer1Win,market,actionIntel,
    context:{eventProof:integrity.proof,differential:((pure.contextDiagnostics?.[0]?.total||0)-(pure.contextDiagnostics?.[1]?.total||0))*2.5,
      diagnostics:pure.contextDiagnostics,surface,profileSource:"SACKMANN_TENNIS_ABSTRACT_RESEARCH",
      marketAnchor:m.provider||"ACTION_APIFY_CONSENSUS"},
    eventStartTime:m.event_start_time||null,decisionTimestamp:new Date().toISOString(),snapshotType:"DECISION"
  });
  return {...decision,contextInserted,surface,courtSpeed};
}

export async function latestActionRows(db,{hours=8,limit=100,now=Date.now()}={}){
  const freshnessSeconds=Math.max(1,Math.min(48,Number(hours)||8))*3600;
  if (!Number.isFinite(now)) return [];
  const cutoff=new Date(now-freshnessSeconds*1000).toISOString();
  const decisionAt=new Date(now).toISOString();
  const res=await db.prepare(
    `WITH ranked AS (
      SELECT *,
             ROW_NUMBER() OVER(PARTITION BY lower(sport),action_game_id ORDER BY julianday(collected_at) DESC,created_at DESC) rn
      FROM shadow_market_observations
      WHERE lower(sport) IN ('atp','wta')
        AND julianday(collected_at) BETWEEN julianday(?) AND julianday(?)
        AND is_live=0
    )
    SELECT id,action_game_id,fbis_event_id,sport,league,home_team,away_team,start_time,
           consensus_json,public_betting_json,market_quality_json,line_movement_json,
           raw_payload_hash,source_observed_at,observed_at,collected_at,created_at
    FROM ranked WHERE rn=1
    ORDER BY start_time,julianday(collected_at) DESC
    LIMIT ?`
  ).bind(cutoff,decisionAt,Math.max(1,Math.min(500,Number(limit)||100))).all();
  // This is an acquisition research lookback, not the current-market ceiling.
  return (res?.results||[]).filter(row=>actionTemporalValidity({collectedAt:row.collected_at,sourceObservedAt:row.source_observed_at},{now,freshnessSeconds}).valid);
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
    const captured=[],blockedDecisions=[];

    if(mode==="capture"||mode==="all"){
      const rows=await latestActionRows(context.env.DB,{hours:body.hours,limit:body.limit});
      for(const row of rows){
        const markets=actionObservationToTennisMarkets(row);
        for(const market of markets){
          const p=await persistTennisMarketSnapshot(context.env.DB,market);
          if(p.inserted)marketInserted++;
          captured.push({...market,snapshotId:p.id});
        }
      }
    }

    if(mode==="auto"||mode==="all"){
      const sourceMarkets=captured.length
        ? captured.filter(x=>x.marketType==="moneyline").map(x=>({
            canonical_event_id:x.canonicalEventId,tour:x.tour,player1:x.player1,player2:x.player2,
            player1_price:x.player1Price,player2_price:x.player2Price,player1_no_vig_prob:x.player1NoVig,
            player2_no_vig_prob:x.player2NoVig,provider:x.provider,sportsbook:x.sportsbook,
            observed_at:x.observedAt,collected_at:x.collectedAt,event_start_time:x.eventStartTime,
            public_ticket_pct:x.publicTicketPct,public_money_pct:x.publicMoneyPct,money_minus_ticket_pct:x.moneyMinusTicketPct
          }))
        : ((await context.env.DB.prepare(
            `WITH ranked AS (
              SELECT *,ROW_NUMBER() OVER(PARTITION BY canonical_event_id ORDER BY observed_at DESC) rn
              FROM tennis_market_snapshots
              WHERE market_type='moneyline' AND event_start_time IS NOT NULL AND event_start_time>datetime('now')
            ) SELECT * FROM ranked WHERE rn=1 ORDER BY observed_at DESC LIMIT 200`
          ).all().catch(()=>({results:[]})))?.results||[]);
      for(const m of sourceMarkets){
        const d=await autoDecisionForMarket(context.env.DB,m);
        if(!d.inserted && d.reason)blockedDecisions.push({eventId:m.canonical_event_id,reason:d.reason});
        contextInserted+=Number(d.contextInserted||0);
        if(d.inserted)decisionInserted++;
      }
    }

    const packets=Array.isArray(body.packets)?body.packets:[];
    if(mode==="decision"||mode==="all"){
      for(const packet of packets){
        if(!packet?.eventId||!packet?.player1||!packet?.player2)continue;
        const integrity=await proveTennisEvent(context.env.DB,{canonical_event_id:packet.eventId,tour:packet.tour,player1:packet.player1.name,player2:packet.player2.name,event_start_time:packet.eventStartTime,surface:packet.surface,tournament:packet.tournament});
        if(!integrity.valid || !packet.surface || !packet.tournament)continue;
        const contexts=Array.isArray(packet.playerContexts)?packet.playerContexts:[];
        if(contexts.length!==2 || contexts.some(c=>clean(c.surface)!==clean(packet.surface)||clean(c.tournament)!==clean(packet.tournament)))continue;
        const pure=simulateTennisV2({
          id:packet.eventId,tour:packet.tour||"atp",surface:packet.surface||"hard",bestOf:Number(packet.bestOf)||3,
          player1:packet.player1,player2:packet.player2,playerContexts:contexts
        },{simulations:Math.max(500,Number(packet.simulations)||1500)},{seed:packet.eventId});
        const decisionAt=Date.now();
        const market=buildSharpMarketPrior({quotes:currentTennisQuotes(packet.marketQuotes||[],decisionAt),
          pinnacle:currentTennisQuotes(packet.pinnacle?[packet.pinnacle]:[],decisionAt)[0]||null,
          betfair:currentTennisQuotes(packet.betfair?[packet.betfair]:[],decisionAt)[0]||null});
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
          actionIntel:currentActionDisplay({actionIntel:packet.actionIntel||null},decisionAt).actionIntel||null,
          context:{eventProof:integrity.proof,differential:((pure.contextDiagnostics?.[0]?.total||0)-(pure.contextDiagnostics?.[1]?.total||0))*2.5,diagnostics:pure.contextDiagnostics},
          eventStartTime:packet.eventStartTime||null,snapshotType:packet.snapshotType||"DECISION"
        });
        if(d.inserted)decisionInserted++;
      }
    }

    return json({
      ok:true,mode,marketInserted,contextInserted,decisionInserted,captured:captured.length,blockedDecisions,
      governance:{researchOnly:true,pureModelMarketFree:true,marketLayerSeparate:true,canQualify:false,canAuthorizeWager:false}
    });
  }catch(err){
    return json({ok:false,error:String(err?.message||err)},500);
  }
}
