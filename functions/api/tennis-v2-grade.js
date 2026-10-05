import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { noVigAmerican, profitUnits } from "../lib/tennisV2Ledger.js";

function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}})}
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const safe=v=>{if(v==null)return null;if(typeof v==="object")return v;try{return JSON.parse(v)}catch{return null}};

async function latestClose(db,eventId,eventStart){
  const row=await db.prepare(
    `SELECT * FROM tennis_market_snapshots
      WHERE canonical_event_id=? AND observed_at<=?
      ORDER BY observed_at DESC LIMIT 1`
  ).bind(eventId,eventStart||"9999-12-31T23:59:59Z").first().catch(()=>null);
  return row||null;
}
function selectedP1(d,minEdge){
  const edge=finite(d.model_edge);
  if(edge==null||Math.abs(edge)<minEdge)return null;
  return edge>0;
}
function entryPrice(d,selP1){
  const m=safe(d.market_json)||{};
  const q=Array.isArray(m.quotes)?m.quotes.find(x=>x.book==="pinnacle")||m.quotes[0]:null;
  if(q){
    const p=selP1?q.p1Price:q.p2Price;
    if(finite(p)!=null)return finite(p);
  }
  return null;
}

export async function onRequestPost(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok)return json(unauthorizedBody(auth.reason),401);
  if(!context.env?.DB)return json({ok:false,error:"database unavailable"},503);
  const body=await context.request.json().catch(()=>({}));
  const results=Array.isArray(body.results)?body.results:[];
  const minEdge=Math.max(0,Math.min(.25,Number(body.minEdge)||.02));
  let graded=0,bets=0,wins=0,losses=0,skipped=0;
  const details=[];
  for(const rr of results){
    const eventId=String(rr.eventId||"");
    const winner=String(rr.winner||"").trim();
    if(!eventId||!winner){skipped++;continue;}
    const res=await context.env.DB.prepare(
      `SELECT * FROM tennis_v2_research_decisions
       WHERE canonical_event_id=? AND graded_at IS NULL
       ORDER BY decision_timestamp`
    ).bind(eventId).all();
    for(const d of res?.results||[]){
      const sel=selectedP1(d,minEdge);
      const wonP1=winner.toLowerCase()===String(d.player1||"").toLowerCase();
      const wonP2=winner.toLowerCase()===String(d.player2||"").toLowerCase();
      if(!wonP1&&!wonP2){skipped++;continue;}
      const close=await latestClose(context.env.DB,eventId,d.event_start_time);
      const closeP1=finite(close?.player1_no_vig_prob);
      const closeSelected=closeP1==null?null:(sel===null?null:(sel?closeP1:1-closeP1));
      const entryMarket=finite(d.market_prior_p1);
      const entrySelected=sel===null?null:(sel?entryMarket:1-entryMarket);
      const clv=entrySelected!=null&&closeSelected!=null?closeSelected-entrySelected:null;
      let units=null,price=null,resultLabel="PASS";
      if(sel!==null){
        bets++;
        price=entryPrice(d,sel);
        units=profitUnits({selectedP1:sel,wonP1,price});
        if(units!=null){
          if(units>0)wins++;else losses++;
          resultLabel=units>0?"WIN":"LOSS";
        }else resultLabel=sel===wonP1?"WIN_UNPRICED":"LOSS_UNPRICED";
      }
      await context.env.DB.prepare(
        `UPDATE tennis_v2_research_decisions
         SET result_winner=?,closing_p1_no_vig=?,clv=?,profit_units=?,graded_at=?
         WHERE id=?`
      ).bind(winner,closeP1,clv,units,new Date().toISOString(),d.id).run();
      graded++;
      details.push({decisionId:d.id,eventId,selection:sel===null?"PASS":(sel?d.player1:d.player2),edge:d.model_edge,result:resultLabel,clv,units,closeSource:close?.provider||null});
    }
  }
  return json({ok:true,minEdge,graded,bets,wins,losses,skipped,details,governance:{researchOnly:true,canAuthorizeWager:false}});
}
