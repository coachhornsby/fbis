import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";

export const HISTORICAL_PITCHER_K_MARKETS = Object.freeze([
  "SPORTSBOOK_PROP:player_strikeouts",
  "SPORTSBOOK_PROP:player_pitcher_strikeouts",
  "SPORTSBOOK_PROP:player_strikeouts_thrown",
]);

const text=v=>{const s=String(v??"").trim();return s||null};
const dateOk=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||""));
function json(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:{
    "content-type":"application/json; charset=utf-8",
    "cache-control":"no-store",
  }});
}

export async function historicalPitcherKDates(db){
  const q=await db.prepare(`
    SELECT date,
           COUNT(*) AS rows,
           COUNT(DISTINCT game_id) AS games,
           COUNT(DISTINCT checkpoint) AS checkpoints,
           SUM(CASE WHEN book_line IS NOT NULL THEN 1 ELSE 0 END) AS line_rows,
           SUM(CASE WHEN book_over_price IS NOT NULL AND book_under_price IS NOT NULL THEN 1 ELSE 0 END) AS two_sided_rows
      FROM mlb_market_projections
     WHERE market_type IN ('SPORTSBOOK_PROP:player_strikeouts','SPORTSBOOK_PROP:player_pitcher_strikeouts','SPORTSBOOK_PROP:player_strikeouts_thrown')
     GROUP BY date
     ORDER BY date
  `).all();
  return q.results||[];
}

export async function historicalPitcherKSourceRows(db,date,{limit=5000}={}){
  const cap=Math.max(1,Math.min(10000,Number(limit)||5000));
  const q=await db.prepare(`
    WITH sched AS (
      SELECT game_id, MIN(start_time) AS event_start_at
        FROM mlb_team_schedule_items
       GROUP BY game_id
    )
    SELECT m.id,m.game_id,m.date,m.checkpoint,m.market_type,m.subject_id,m.subject_name,
           m.team_id,m.opponent_id,m.line,m.book,m.book_line,m.book_over_price,m.book_under_price,
           m.source,m.source_as_of,m.frozen_at,m.priced,s.event_start_at
      FROM mlb_market_projections m
      LEFT JOIN sched s ON s.game_id=m.game_id
     WHERE m.date=?
       AND m.market_type IN ('SPORTSBOOK_PROP:player_strikeouts','SPORTSBOOK_PROP:player_pitcher_strikeouts','SPORTSBOOK_PROP:player_strikeouts_thrown')
     ORDER BY m.game_id,m.checkpoint,m.subject_name,COALESCE(m.source_as_of,m.frozen_at),COALESCE(m.book,m.source),m.id
     LIMIT ?
  `).bind(date,cap).all();
  return (q.results||[]).map(r=>{
    const observed=text(r.source_as_of)||text(r.frozen_at);
    const eventStart=text(r.event_start_at);
    const pregame=Boolean(observed&&eventStart&&Date.parse(observed)<Date.parse(eventStart));
    return {...r,observed_at:observed,event_start_at:eventStart,pregame};
  });
}

export async function onRequestGet(context){
  if(!context.env?.DB)return json({ok:false,error:"database unavailable"},503);
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok)return json(unauthorizedBody(),401);
  const u=new URL(context.request.url);
  const mode=String(u.searchParams.get("mode")||"rows").toLowerCase();
  if(mode==="dates"){
    const rows=await historicalPitcherKDates(context.env.DB);
    return json({ok:true,operation:"historical_pitcher_k_dates",rows,
      governance:{readOnly:true,canQualify:false,canAuthorizeWager:false,autoPromotion:false}});
  }
  const date=text(u.searchParams.get("date"));
  if(!dateOk(date))return json({ok:false,error:"date_required_yyyy_mm_dd"},400);
  const limit=Number(u.searchParams.get("limit")||5000);
  const rows=await historicalPitcherKSourceRows(context.env.DB,date,{limit});
  return json({ok:true,operation:"historical_pitcher_k_source",date,rows,
    governance:{readOnly:true,evidenceClass:"HISTORICAL_PIT_RECONSTRUCTED",canQualify:false,canAuthorizeWager:false,autoPromotion:false}});
}
