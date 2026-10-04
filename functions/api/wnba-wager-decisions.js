import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { buildSlate, resolveSlateDate } from "../lib/slateEngine.js";
import { buildWnbaGameDecisions } from "../lib/wnbaWagerDecision.js";
import { persistOddsSnapshot } from "../lib/store.js";

function json(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"private, no-store, max-age=0"}});
}
function todayCT(){
  return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
}
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function monotonicCalibration(rows=[]){
  const groups=new Map();
  for(const row of rows||[]){
    const key=`${String(row.market||"").toUpperCase()}:${String(row.side||"").toUpperCase()}`;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(row);
  }
  const state=new Map();
  for(const [key,list] of groups){
    const qualified=list
      .map(r=>({...r,confidence_band:Number(r.confidence_band),decisions:Number(r.decisions)||0,hit_rate:finite(r.hit_rate)}))
      .filter(r=>r.decisions>=30&&r.hit_rate!=null)
      .sort((a,b)=>a.confidence_band-b.confidence_band);
    let monotonic=qualified.length>=2;
    for(let i=1;i<qualified.length;i++){
      if(qualified[i].hit_rate+0.02<qualified[i-1].hit_rate){monotonic=false;break;}
    }
    state.set(key,{rows:qualified,monotonic});
  }
  return ({offer,decision})=>{
    const key=`${String(offer?.market||"").toUpperCase()}:${String(offer?.side||"").toUpperCase()}`;
    const g=state.get(key);
    if(!g?.monotonic)return null;
    const band=Math.floor((Number(decision?.rawConfidence)||0)/10)*10;
    const row=g.rows.find(r=>r.confidence_band===band);
    if(!row)return null;
    return {confidence:Math.round(clamp(row.hit_rate*100,0,100)),n:row.decisions,band,monotonic:true};
  };
}

async function loadCalibration(db){
  if(!db?.prepare)return monotonicCalibration([]);
  try{
    const res=await db.prepare(
      `SELECT market,side,confidence_band,graded,decisions,wins,hit_rate,avg_expected_value,units_per_decision,avg_clv_line,avg_clv_price
         FROM wnba_wager_confidence_calibration
        ORDER BY market,side,confidence_band`
    ).all();
    return monotonicCalibration(res?.results||[]);
  }catch{return monotonicCalibration([]);}
}

async function sha256(text){
  const buf=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(text)));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");
}

async function persistDecision(db,gamePacket,decision,capturedAt){
  if(!db?.prepare)return {inserted:false,reason:"db-unavailable"};
  const natural=[
    "wnba_wager_v1",gamePacket.gameId,capturedAt,decision.market,decision.side,
    decision.line??"",decision.price??"",decision.sportsbook??"",gamePacket.model?.modelVersion??""
  ].join("|");
  const hash=await sha256(natural);
  const id=`wwd_${hash.slice(0,28)}`;
  const stmt=db.prepare(
    `INSERT OR IGNORE INTO wnba_wager_decisions (
      id,natural_key,event_id,event_start,captured_at,model_id,model_version,decision_version,model_as_of,
      market,side,line,american_price,sportsbook,market_observed_at,model_probability,break_even_probability,
      probability_edge,expected_value,raw_confidence,confidence,confidence_calibration_state,
      confidence_calibration_n,decision,stake_units,stake_state,projection_json,factors_json,
      market_intelligence_json,evidence_json,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    id,natural,gamePacket.gameId,gamePacket.start||null,capturedAt,
    gamePacket.model?.modelId||"WNBA-FBIS-v2",gamePacket.model?.modelVersion||null,gamePacket.decisionVersion,capturedAt,
    decision.market,decision.side,decision.line,decision.price,decision.sportsbook,decision.observedAt,
    decision.modelProbability,decision.breakEvenProbability,decision.probabilityEdge,decision.expectedValue,
    decision.rawConfidence,decision.confidence,decision.confidenceCalibrationState,decision.confidenceCalibrationN||0,
    decision.decision,decision.stakeUnits,decision.stakeState,
    JSON.stringify(gamePacket.model||{}),JSON.stringify(gamePacket.model?.factors||[]),
    JSON.stringify(decision.marketIntelligence||{}),JSON.stringify(decision.evidence||{}),capturedAt
  );
  const res=await stmt.run();
  return {inserted:Number(res?.meta?.changes||res?.changes||0)>0,id};
}

async function readLatest(db,date){
  if(!db?.prepare)return [];
  try{
    const res=await db.prepare(
      `WITH ranked AS (
         SELECT *,ROW_NUMBER() OVER (
           PARTITION BY event_id,market,side
           ORDER BY captured_at DESC
         ) rn
         FROM wnba_wager_decisions
         WHERE substr(event_start,1,10)=?
       )
       SELECT id,event_id,event_start,captured_at,market,side,line,american_price,sportsbook,
              model_probability,break_even_probability,probability_edge,expected_value,
              raw_confidence,confidence,confidence_calibration_state,confidence_calibration_n,
              decision,stake_units,stake_state,market_intelligence_json,evidence_json
         FROM ranked WHERE rn=1
        ORDER BY event_start,event_id,market,side`
    ).bind(date).all();
    return res?.results||[];
  }catch{return [];}
}

export async function onRequestGet(context){
  if(!context.env?.DB)return json({ok:false,error:"database unavailable"},503);
  const url=new URL(context.request.url);
  const raw=url.searchParams.get("date")||todayCT();
  const resolved=resolveSlateDate(raw,{maxPast:30,maxFuture:7});
  if(!resolved.ok)return json({ok:false,error:resolved.error,rows:[]},400);
  const rows=await readLatest(context.env.DB,resolved.date);
  return json({ok:true,date:resolved.date,rows,count:rows.length});
}

export async function onRequestPost(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok)return json(unauthorizedBody(auth.reason),401);
  if(!context.env?.DB)return json({ok:false,error:"database unavailable"},503);

  const body=await context.request.json().catch(()=>({}));
  const raw=String(body?.date||todayCT());
  const resolved=resolveSlateDate(raw,{maxPast:2,maxFuture:3});
  if(!resolved.ok)return json({ok:false,error:resolved.error},400);

  const env={
    PARLAY_API_KEY:context.env.PARLAY_API_KEY,
    THEODDS_API_KEY:context.env.THEODDS_API_KEY,
    SHARPAPI_API_KEY:context.env.SHARPAPI_API_KEY,
    THERUNDOWN_API_KEY:context.env.THERUNDOWN_API_KEY,
    CFBD_API_KEY:context.env.CFBD_API_KEY,
    CBBD_API_KEY:context.env.CBBD_API_KEY,
    DB:context.env.DB,
    caches:typeof caches!=="undefined"?caches.default:null,
    parlayCacheOnly:true,
    palCacheOnly:true,
    cfbdScheduleFallback:false,
  };

  try{
    const slate=await buildSlate("wnba",resolved.date,env);
    const capturedAt=new Date().toISOString();
    const calibrationLookup=await loadCalibration(context.env.DB);
    const packets=[];
    let inserted=0;
    for(const game of slate.games||[]){
      if(game?.status?.live||game?.status?.completed)continue;
      const packet=await buildWnbaGameDecisions(game,context.env.DB,{minEv:0.03,calibrationLookup});
      packets.push(packet);
      if(!packet.ok)continue;
      for(const decision of packet.offers||[]){
        const p=await persistDecision(context.env.DB,packet,decision,capturedAt);
        if(p.inserted)inserted++;
        const marketKey=decision.market==="MONEYLINE"?"ml":String(decision.market||"").toLowerCase();
        const started=Date.parse(packet.start||"");
        const capturedMs=Date.parse(capturedAt);
        if(Number.isFinite(started)&&Number.isFinite(capturedMs)&&capturedMs<started&&decision.price!=null){
          await persistOddsSnapshot(context.env,{
            gameId:packet.gameId,
            sport:"wnba",
            date:resolved.date,
            book:decision.sportsbook||"Market",
            market:marketKey,
            period:"fg",
            side:decision.side,
            line:decision.line,
            price:decision.price,
            implied:decision.breakEvenProbability,
            noVig:null,
            capturedAt,
            eventId:packet.gameId,
            gameStart:packet.start||null,
            checkpoint:"WNBA_WAGER_DECISION",
            rejectedPostStart:false,
            paired:false,
          });
        }
      }
    }
    return json({
      ok:true,date:resolved.date,capturedAt,games:packets.length,offers:packets.reduce((n,p)=>n+(p.offers?.length||0),0),
      bets:packets.reduce((n,p)=>n+(p.offers||[]).filter(x=>x.decision==="BET").length,0),
      inserted,packets,
      architecture:"independent projection -> per-offer pricing -> separate ACTION intelligence -> confidence -> BET/PASS",
      staking:"disabled until staking rules validate",
    });
  }catch(err){
    return json({ok:false,date:resolved.date,error:String(err?.message||err)},502);
  }
}
