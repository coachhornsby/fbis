import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { cbbdGet } from "../lib/collegeApi.js";
import { gradeCbbPlayerPropSignal } from "../lib/cbbPlayerPropMoney.js";

function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}})}
const n=v=>{if(v==null||v==="")return null;const x=Number(v);return Number.isFinite(x)?x:null};
const norm=v=>String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
function ctDate(v=new Date()){
  const d=v instanceof Date?v:new Date(v);
  return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(d);
}
function dayShift(day,delta){const d=new Date(day+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+delta);return d.toISOString().slice(0,10)}
function teamName(v){return v?.school||v?.name||v?.displayName||v?.location||v||null}
function actualForMarket(p,m){
  if(m==="points")return n(p?.points);
  if(m==="rebounds")return n(p?.rebounds?.total??p?.rebounds);
  if(m==="assists")return n(p?.assists);
  if(m==="three_pointers_made")return n(p?.threePointFieldGoals?.made??p?.three_point_field_goals_made);
  if(m==="points_rebounds_assists"){
    const a=n(p?.points),b=n(p?.rebounds?.total??p?.rebounds),c=n(p?.assists);
    return a==null||b==null||c==null?null:a+b+c;
  }
  return null;
}
function playerName(p){return p?.name||p?.displayName||p?.athlete?.displayName||null}
function buildActualIndex(games=[]){
  const exact=new Map(),byPlayerDate=new Map();
  for(const g of games||[]){
    const date=String(g?.startDate||g?.gameDate||g?.date||"").slice(0,10);
    const team=teamName(g?.team);
    for(const p of g?.players||[]){
      const pn=playerName(p); if(!date||!pn)continue;
      const ekey=[date,norm(pn),norm(team)].join("|");
      if(!exact.has(ekey))exact.set(ekey,[]);
      exact.get(ekey).push({game:g,player:p,team});
      const pkey=[date,norm(pn)].join("|");
      if(!byPlayerDate.has(pkey))byPlayerDate.set(pkey,[]);
      byPlayerDate.get(pkey).push({game:g,player:p,team});
    }
  }
  return{exact,byPlayerDate};
}
function resolveActual(signal,index){
  const day=String(signal.start_time||"").slice(0,10);
  const team=norm(signal.team);
  for(const d of [day,dayShift(day,-1),dayShift(day,1)]){
    if(team){
      const xs=index.exact.get([d,norm(signal.player_name),team].join("|"))||[];
      if(xs.length===1)return xs[0];
    }
    const ys=index.byPlayerDate.get([d,norm(signal.player_name)].join("|"))||[];
    if(ys.length===1)return ys[0];
  }
  return null;
}
async function settle(context,day){
  const db=context.env.DB,now=new Date().toISOString();
  const since=dayShift(day,-1)+"T00:00:00Z",until=dayShift(day,2)+"T00:00:00Z";
  const sig=(await db.prepare(
    `SELECT * FROM cbb_player_prop_signals
      WHERE result='OPEN' AND start_time IS NOT NULL
        AND start_time >= ? AND start_time < ?
      ORDER BY signal_at ASC`
  ).bind(since,until).all())?.results||[];
  if(!sig.length)return{ok:true,date:day,open:0,settled:0,unmatched:0};

  const feed=await cbbdGet("/games/players",context.env,{query:{startDateRange:since,endDateRange:until,seasonType:"regular"}});
  if(!feed.ok)return{ok:false,error:feed.reason||"player-results-unavailable",open:sig.length,settled:0};
  const index=buildActualIndex(Array.isArray(feed.data)?feed.data:[]);
  let settled=0,unmatched=0,withClose=0;
  for(const s of sig){
    const hit=resolveActual(s,index);
    if(!hit){unmatched++;continue}
    const actual=actualForMarket(hit.player,s.market);
    if(actual==null){unmatched++;continue}
    const close=await db.prepare(
      `SELECT line,collected_at FROM prizepicks_prop_lines
        WHERE fbis_event_id=? AND LOWER(player_name)=LOWER(?) AND canonical_market=?
          AND collected_at <= ?
        ORDER BY collected_at DESC LIMIT 1`
    ).bind(s.fbis_event_id,s.player_name,s.market,s.start_time).first();
    const graded=gradeCbbPlayerPropSignal(s,actual,n(close?.line),close?.collected_at||null);
    if(!graded.ok){unmatched++;continue}
    if(graded.closeLine!=null)withClose++;
    await db.prepare(
      `UPDATE cbb_player_prop_signals
        SET close_line=?,close_at=?,line_clv=?,actual=?,result=?,settled_at=?,updated_at=?
        WHERE id=?`
    ).bind(graded.closeLine,graded.closeAt,graded.lineClv,graded.actual,graded.result,graded.settledAt,now,s.id).run();
    settled++;
  }
  return{ok:true,date:day,open:sig.length,settled,unmatched,withClose,source:"CBBD /games/players"};
}
async function summary(db){
  const rows=(await db.prepare(
    `SELECT market,edge_band,
      COUNT(*) n,
      SUM(CASE WHEN result='WIN' THEN 1 ELSE 0 END) wins,
      SUM(CASE WHEN result='LOSS' THEN 1 ELSE 0 END) losses,
      SUM(CASE WHEN result='PUSH' THEN 1 ELSE 0 END) pushes,
      AVG(CASE WHEN line_clv IS NOT NULL THEN line_clv END) avg_line_clv,
      COUNT(CASE WHEN line_clv IS NOT NULL THEN 1 END) clv_n
     FROM cbb_player_prop_signals
     WHERE result!='OPEN'
     GROUP BY market,edge_band
     ORDER BY market,edge_band`
  ).all())?.results||[];
  return rows.map(r=>({...r,hitRate:(Number(r.wins)+Number(r.losses))?Number(r.wins)/(Number(r.wins)+Number(r.losses)):null}));
}
export async function onRequestGet(context){
  if(!context.env?.DB)return json({ok:false,error:"database unavailable"},503);
  const url=new URL(context.request.url),limit=Math.max(1,Math.min(1000,Number(url.searchParams.get("limit")||300)));
  const rows=(await context.env.DB.prepare(
    `SELECT * FROM cbb_player_prop_signals ORDER BY signal_at DESC LIMIT ${limit}`
  ).all())?.results||[];
  return json({ok:true,count:rows.length,rows,summary:await summary(context.env.DB),governance:{
    model:"CBB-PLAYER-PROP-MONEY-v1",prospectiveOnly:true,canQualify:false,canAuthorizeWager:false,
    promotionRequires:"prospective hit-rate + positive line CLV by market/edge band; executed-slip ROI tracked separately"
  }});
}
export async function onRequestPost(context){
  const auth=authorizeHarvest(context.request,context.env);if(!auth.ok)return json(unauthorizedBody(),401);
  if(!context.env?.DB)return json({ok:false,error:"database unavailable"},503);
  let body={};try{body=await context.request.json()}catch{}
  const mode=String(body.mode||"settle").toLowerCase();
  if(mode!=="settle")return json({ok:false,error:"unsupported mode"},400);
  const day=String(body.date||ctDate(new Date(Date.now()-86400000))).slice(0,10);
  const out=await settle(context,day);
  return json(out,out.ok?200:503);
}
