import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { americanBreakEven } from "../lib/wagerDecisionEngine.js";

function json(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
}
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
function dateCT(iso){
  try{return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(iso));}
  catch{return null;}
}
async function fetchSummary(eventId){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),8000);
  try{
    const r=await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary?event=${encodeURIComponent(eventId)}`,{
      signal:controller.signal,headers:{"user-agent":"FBIS-WNBA-Wager-Grader/1.0",accept:"application/json"}
    });
    if(!r.ok)throw new Error(`ESPN summary HTTP ${r.status}`);
    return r.json();
  }finally{clearTimeout(timer);}
}
function finalScore(summary){
  const comp=summary?.header?.competitions?.[0];
  const cs=comp?.competitors||[];
  const h=cs.find(x=>x.homeAway==="home"),a=cs.find(x=>x.homeAway==="away");
  const hs=finite(h?.score),as=finite(a?.score);
  const complete=comp?.status?.type?.completed===true||summary?.header?.competitions?.[0]?.status?.type?.completed===true;
  return complete&&hs!=null&&as!=null?{home:hs,away:as,margin:hs-as,total:hs+as}:null;
}
function grade(decision,score){
  const market=String(decision.market||"").toUpperCase();
  const side=String(decision.side||"").toUpperCase();
  const line=finite(decision.line);
  let diff=null;
  if(market==="MONEYLINE") diff=side==="HOME"?score.margin:-score.margin;
  else if(market==="SPREAD"&&line!=null) diff=side==="HOME"?score.margin+line:-score.margin+line;
  else if(market==="TOTAL"&&line!=null) diff=side==="OVER"?score.total-line:line-score.total;
  if(diff==null)return null;
  if(diff===0)return {result:"PUSH",win:null,push:1};
  return {result:diff>0?"WIN":"LOSS",win:diff>0?1:0,push:0};
}
function selectionFor(decision){
  const side=String(decision.side||"").toLowerCase();
  return side;
}
async function closingQuote(db,decision){
  if(!db?.prepare)return null;
  const market=String(decision.market||"").toUpperCase()==="MONEYLINE"?"ml":String(decision.market||"").toLowerCase();
  try{
    const owned=await db.prepare(
      `SELECT line,price AS american_price,captured_at AS provider_timestamp,captured_at,
              checkpoint AS snapshot_type,'FBIS_ODDS_SNAPSHOTS' AS source
         FROM odds_snapshots
        WHERE sport='wnba' AND game_id=?
          AND lower(market)=lower(?) AND lower(side)=lower(?)
          AND captured_at<? AND COALESCE(rejected_post_start,0)=0
          AND price IS NOT NULL
        ORDER BY captured_at DESC
        LIMIT 1`
    ).bind(decision.event_id,market,selectionFor(decision),decision.event_start).first();
    if(owned)return owned;
  }catch{}
  try{
    const action=await db.prepare(
      `SELECT line,american_price,provider_timestamp,collected_at,snapshot_type,'ACTION_APIFY' AS source
         FROM action_market_book_observations
        WHERE sport='wnba'
          AND canonical_event_id=?
          AND lower(market_type)=lower(?)
          AND lower(selection)=lower(?)
          AND collected_at<?
        ORDER BY CASE WHEN snapshot_type='FINAL_PREGAME' THEN 0 WHEN snapshot_type='CLOSE' THEN 1 ELSE 2 END,
                 collected_at DESC
        LIMIT 1`
    ).bind(decision.event_id,decision.market,selectionFor(decision),decision.event_start).first();
    return action||null;
  }catch{return null;}
}
function directionalClvLine(decision,closeLine){
  const d=finite(decision.line),c=finite(closeLine);
  if(d==null||c==null)return null;
  const m=String(decision.market).toUpperCase(),s=String(decision.side).toUpperCase();
  if(m==="SPREAD")return d-c;
  if(m==="TOTAL")return s==="OVER"?c-d:d-c;
  return null;
}
function clvPrice(decision,closePrice){
  const d=americanBreakEven(decision.american_price),c=americanBreakEven(closePrice);
  return d==null||c==null?null:(c-d)*100;
}

export async function onRequestPost(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok)return json(unauthorizedBody(auth.reason),401);
  if(!context.env?.DB)return json({ok:false,error:"database unavailable"},503);
  const body=await context.request.json().catch(()=>({}));
  const date=String(body?.date||"").slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return json({ok:false,error:"invalid-date"},400);
  try{
    const res=await context.env.DB.prepare(
      `SELECT d.*
         FROM wnba_wager_decisions d
         LEFT JOIN wnba_wager_results r ON r.decision_id=d.id
        WHERE r.decision_id IS NULL
          AND d.event_start>=datetime(?,'-1 day')
          AND d.event_start<datetime(?,'+2 day')
        ORDER BY d.event_start,d.event_id,d.captured_at`
    ).bind(date,date).all();
    const candidates=(res?.results||[]).filter(r=>dateCT(r.event_start)===date);
    const byEvent=new Map();
    for(const row of candidates){
      if(!byEvent.has(row.event_id))byEvent.set(row.event_id,[]);
      byEvent.get(row.event_id).push(row);
    }
    let graded=0,wins=0,losses=0,pushes=0,skipped=0;
    const errors=[];
    for(const [eventId,rows] of byEvent){
      let score;
      try{score=finalScore(await fetchSummary(eventId));}
      catch(e){errors.push({eventId,error:String(e?.message||e)});continue;}
      if(!score){skipped+=rows.length;continue;}
      for(const d of rows){
        const g=grade(d,score);
        if(!g){skipped++;continue;}
        const close=await closingQuote(context.env.DB,d);
        const settledAt=new Date().toISOString();
        await context.env.DB.prepare(
          `INSERT OR IGNORE INTO wnba_wager_results(
             decision_id,event_id,actual_home,actual_away,actual_margin,actual_total,result,win,push,
             close_line,close_price,clv_line,clv_price,settled_at,provenance_json
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(
          d.id,eventId,score.home,score.away,score.margin,score.total,g.result,g.win,g.push,
          finite(close?.line),finite(close?.american_price),directionalClvLine(d,close?.line),
          clvPrice(d,close?.american_price),settledAt,
          JSON.stringify({finalSource:"ESPN_WNBA_SUMMARY",closeSource:close?.source||"UNAVAILABLE",closeObservedAt:close?.provider_timestamp||close?.collected_at||null,closeSnapshotType:close?.snapshot_type||null})
        ).run();
        graded++;
        if(g.result==="WIN")wins++;
        else if(g.result==="LOSS")losses++;
        else pushes++;
      }
    }
    const calibration=await context.env.DB.prepare(
      `SELECT * FROM wnba_wager_confidence_calibration ORDER BY market,side,confidence_band`
    ).all().catch(()=>({results:[]}));
    return json({ok:true,date,candidates:candidates.length,events:byEvent.size,graded,wins,losses,pushes,skipped,errors,calibration:calibration?.results||[]});
  }catch(err){
    return json({ok:false,date,error:String(err?.message||err)},500);
  }
}
