import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { americanBreakEven, americanProfitMultiple } from "../lib/wagerDecisionEngine.js";
import { WNBA_LINEUP_RELIABILITY_REPORT_THRESHOLD } from "../lib/wnbaProspectiveChallenger.js";

const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const norm=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"");
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}})}
function dateCT(iso){try{return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(iso));}catch{return null}}
function normalCdf(x){const z=Number(x),a=Math.abs(z)/Math.sqrt(2),t=1/(1+0.3275911*a);const erf=(z<0?-1:1)*(1-((((1.061405429*t-1.453152027)*t+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-a*a));return .5*(1+erf)}
async function fetchSummary(eventId){
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),8000);
  try{const r=await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary?event=${encodeURIComponent(eventId)}`,{signal:c.signal,headers:{"user-agent":"FBIS-WNBA-Possession-Grader/1.0",accept:"application/json"}});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()}finally{clearTimeout(timer)}
}
function parseMadeAttempted(v){const m=String(v??"").trim().match(/^(\d+)\s*-\s*(\d+)$/);return m?{made:Number(m[1]),attempted:Number(m[2])}:{made:null,attempted:null}}
function playerRows(summary){
  const out=[];
  for(const block of summary?.boxscore?.players||[]){
    const team=block.team||{};
    for(const group of block.statistics||[]){
      const labels=group.labels||group.names||[];
      for(const a of group.athletes||[]){
        const vals=a.stats||[];
        const raw=names=>{for(const n of names){const i=labels.findIndex(x=>norm(x)===norm(n));if(i>=0)return vals[i]}return null};
        const num=names=>finite(raw(names)),tp=parseMadeAttempted(raw(["3PT","3P","three pointers"]));
        const name=a.athlete?.displayName||a.displayName;if(!name)continue;
        out.push({id:String(a.athlete?.id||a.id||name),name,teamId:String(team.id||""),points:num(["PTS","points"]),rebounds:num(["REB","rebounds"]),assists:num(["AST","assists"]),threes:tp.made});
      }
    }
  }
  return out;
}
function finalData(summary){
  const comp=summary?.header?.competitions?.[0],cs=comp?.competitors||[];
  const h=cs.find(x=>x.homeAway==="home"),a=cs.find(x=>x.homeAway==="away"),home=finite(h?.score),away=finite(a?.score);
  const complete=comp?.status?.type?.completed===true;
  return complete&&home!=null&&away!=null?{home,away,margin:home-away,total:home+away,players:playerRows(summary)}:null;
}
function gradeMarket(r,s){
  const m=String(r.market||"").toUpperCase(),side=String(r.side||"").toUpperCase(),line=finite(r.line);let d=null;
  if(m==="MONEYLINE")d=side==="HOME"?s.margin:-s.margin;
  else if(m==="SPREAD"&&line!=null)d=side==="HOME"?s.margin+line:-s.margin+line;
  else if(m==="TOTAL"&&line!=null)d=side==="OVER"?s.total-line:line-s.total;
  if(d==null)return null;if(d===0)return{result:"PUSH",win:null,push:1,units:0};
  const win=d>0,pm=americanProfitMultiple(r.american_price);
  return{result:win?"WIN":"LOSS",win:win?1:0,push:0,units:win?(pm??0):-1};
}
function lineClv(r,closeLine){
  const e=finite(r.line),c=finite(closeLine);if(e==null||c==null)return null;
  const m=String(r.market).toUpperCase(),s=String(r.side).toUpperCase();
  if(m==="SPREAD")return e-c;
  if(m==="TOTAL")return s==="OVER"?c-e:e-c;
  return null;
}
function priceClv(entry,close){
  const e=americanBreakEven(entry),c=americanBreakEven(close);return e==null||c==null?null:(c-e)*100;
}
async function closeQuote(db,r){
  const market=String(r.market||"").toUpperCase()==="MONEYLINE"?"ml":String(r.market||"").toLowerCase();
  try{return await db.prepare(`SELECT line,price,captured_at FROM odds_snapshots WHERE sport='wnba' AND game_id=? AND lower(market)=lower(?) AND lower(side)=lower(?) AND captured_at<? AND COALESCE(rejected_post_start,0)=0 AND price IS NOT NULL ORDER BY captured_at DESC LIMIT 1`).bind(r.event_id,market,String(r.side||"").toLowerCase(),r.event_start).first()}catch{return null}
}
function actualFor(p,m){if(!p)return null;return m==="points"?p.points:m==="rebounds"?p.rebounds:m==="assists"?p.assists:m==="three_pointers_made"?p.threes:null}
function brier(mu,sigma,actualMargin){const sig=finite(sigma);if(sig==null||sig<=0)return null;const p=1-normalCdf((0-mu)/sig),y=actualMargin>0?1:0;return (p-y)**2}

export async function onRequestPost(context){
  const auth=authorizeHarvest(context.request,context.env);if(!auth.ok)return json(unauthorizedBody(auth.reason),401);
  const db=context.env?.DB;if(!db?.prepare)return json({ok:false,error:"database unavailable"},503);
  const body=await context.request.json().catch(()=>({})),date=String(body?.date||"").slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return json({ok:false,error:"invalid-date"},400);
  try{
    const [gRes,mRes,pRes]=await Promise.all([
      db.prepare(`SELECT * FROM wnba_game_possession_challenger_shadow WHERE graded_at IS NULL AND event_start>=datetime(?,'-1 day') AND event_start<datetime(?,'+2 day')`).bind(date,date).all(),
      db.prepare(`SELECT * FROM wnba_game_possession_market_shadow WHERE settled_at IS NULL AND event_start>=datetime(?,'-1 day') AND event_start<datetime(?,'+2 day')`).bind(date,date).all(),
      db.prepare(`SELECT * FROM wnba_player_opportunity_shadow WHERE graded_at IS NULL AND event_start>=datetime(?,'-1 day') AND event_start<datetime(?,'+2 day')`).bind(date,date).all()
    ]);
    const gameRows=(gRes.results||[]).filter(r=>dateCT(r.event_start)===date),marketRows=(mRes.results||[]).filter(r=>dateCT(r.event_start)===date),propRows=(pRes.results||[]).filter(r=>dateCT(r.event_start)===date);
    const ids=[...new Set([...gameRows,...marketRows,...propRows].map(r=>String(r.event_id)))],finals=new Map(),errors=[];
    for(const id of ids){try{const x=finalData(await fetchSummary(id));if(x)finals.set(id,x)}catch(e){errors.push({eventId:id,error:String(e?.message||e)})}}
    const now=new Date().toISOString();let gradedGames=0,settledMarkets=0,gradedProps=0;
    for(const r of gameRows){
      const s=finals.get(String(r.event_id));if(!s)continue;
      const bm=Math.abs(finite(r.baseline_margin)-s.margin),cm=Math.abs(finite(r.challenger_margin)-s.margin),bt=Math.abs(finite(r.baseline_total)-s.total),ct=Math.abs(finite(r.challenger_total)-s.total);
      await db.prepare(`UPDATE wnba_game_possession_challenger_shadow SET actual_home=?,actual_away=?,baseline_margin_abs_error=?,challenger_margin_abs_error=?,baseline_total_abs_error=?,challenger_total_abs_error=?,winner_brier_baseline=?,winner_brier_challenger=?,graded_at=? WHERE id=?`).bind(s.home,s.away,bm,cm,bt,ct,brier(finite(r.baseline_margin),finite(r.sigma_margin),s.margin),brier(finite(r.challenger_margin),finite(r.sigma_margin),s.margin),now,r.id).run();gradedGames++;
    }
    for(const r of marketRows){
      const s=finals.get(String(r.event_id));if(!s)continue;const g=gradeMarket(r,s);if(!g)continue;const cl=await closeQuote(db,r);
      await db.prepare(`UPDATE wnba_game_possession_market_shadow SET result=?,win=?,push=?,units=?,close_line=?,close_price=?,clv_line=?,clv_price=?,settled_at=? WHERE id=?`).bind(g.result,g.win,g.push,g.units,finite(cl?.line),finite(cl?.price),lineClv(r,cl?.line),priceClv(r.american_price,cl?.price),now,r.id).run();settledMarkets++;
    }
    for(const r of propRows){
      const s=finals.get(String(r.event_id));if(!s)continue;
      const p=s.players.find(x=>String(x.id)===String(r.player_id))||s.players.find(x=>norm(x.name)===norm(r.player_name)),actual=actualFor(p,String(r.market_type));
      if(actual==null)continue;
      await db.prepare(`UPDATE wnba_player_opportunity_shadow SET actual_value=?,baseline_abs_error=?,opportunity_abs_error=?,graded_at=? WHERE id=?`).bind(actual,Math.abs(finite(r.baseline_projection)-actual),Math.abs(finite(r.opportunity_projection)-actual),now,r.id).run();gradedProps++;
    }

    const models=await db.prepare(`SELECT model_id,COUNT(*) n,AVG(baseline_margin_abs_error) bm,AVG(challenger_margin_abs_error) cm,AVG(baseline_total_abs_error) bt,AVG(challenger_total_abs_error) ct,AVG(winner_brier_baseline) bb,AVG(winner_brier_challenger) cb FROM wnba_game_possession_challenger_shadow WHERE graded_at IS NOT NULL GROUP BY model_id`).all();
    const economics=await db.prepare(`SELECT model_id,market,COUNT(*) n,SUM(CASE WHEN research_decision='BET' THEN 1 ELSE 0 END) bet_n,SUM(CASE WHEN research_decision='BET' THEN units ELSE 0 END) units,AVG(CASE WHEN research_decision='BET' THEN clv_line END) avg_clv_line FROM wnba_game_possession_market_shadow WHERE settled_at IS NOT NULL GROUP BY model_id,market`).all();
    const reliable=await db.prepare(`SELECT model_id,COUNT(*) n,AVG(baseline_margin_abs_error) bm,AVG(challenger_margin_abs_error) cm,AVG(baseline_total_abs_error) bt,AVG(challenger_total_abs_error) ct FROM wnba_game_possession_challenger_shadow WHERE graded_at IS NOT NULL AND lineup_reliability>=? GROUP BY model_id`).bind(WNBA_LINEUP_RELIABILITY_REPORT_THRESHOLD).all();
    const econBy=new Map();for(const x of economics.results||[]){if(!econBy.has(x.model_id))econBy.set(x.model_id,[]);econBy.get(x.model_id).push(x)}
    const relBy=new Map((reliable.results||[]).map(x=>[x.model_id,x]));
    const decisions={};
    for(const x of models.results||[]){
      const econ=econBy.get(x.model_id)||[],bets=econ.reduce((s,z)=>s+Number(z.bet_n||0),0),units=econ.reduce((s,z)=>s+Number(z.units||0),0),clv=(()=>{const a=econ.filter(z=>finite(z.avg_clv_line)!=null);return a.length?a.reduce((s,z)=>s+Number(z.avg_clv_line),0)/a.length:null})();
      const md=finite(x.cm)-finite(x.bm),td=finite(x.ct)-finite(x.bt),bd=finite(x.cb)-finite(x.bb),rel=relBy.get(x.model_id);
      let decision="CONTINUE_SHADOW";
      const enough=Number(x.n)>=100&&bets>=50&&units>0&&(clv==null||clv>0);
      if(enough){
        if(x.model_id.includes("GAMESTATE")&&md<=-0.05&&bd<0)decision="PROMOTE";
        else if(x.model_id.includes("LINEUP")&&md<0&&td<=0&&Number(rel?.n||0)>=60&&(finite(rel?.cm)-finite(rel?.bm))<0)decision="PROMOTE";
        else if(x.model_id.includes("PACE")&&td<=-0.05)decision="PROMOTE";
        else if(md>=0.08&&td>=0.10)decision="REJECT";
      }
      decisions[x.model_id]={n:Number(x.n),marginMaeDelta:md,totalMaeDelta:td,brierDelta:bd,bets,units,roi:bets?units/bets:null,avgClvLine:clv,reliableN:Number(rel?.n||0),decision};
      await db.prepare(`INSERT OR REPLACE INTO wnba_possession_challenger_validation (id,model_id,model_version,validation_type,n,baseline_margin_mae,challenger_margin_mae,margin_mae_delta,baseline_total_mae,challenger_total_mae,total_mae_delta,baseline_brier,challenger_brier,brier_delta,lineup_reliability_threshold,reliable_n,details_json,decision,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(`${x.model_id}:${now}`,x.model_id,"prospective-shadow-v1","PROSPECTIVE",Number(x.n),finite(x.bm),finite(x.cm),md,finite(x.bt),finite(x.ct),td,finite(x.bb),finite(x.cb),bd,WNBA_LINEUP_RELIABILITY_REPORT_THRESHOLD,Number(rel?.n||0),JSON.stringify({economics:econ,reliable:rel||null}),decision,now).run();
    }
    const propAgg=await db.prepare(`SELECT market_type,COUNT(*) n,AVG(baseline_abs_error) bm,AVG(opportunity_abs_error) om,SUM(availability_verified) verified_n FROM wnba_player_opportunity_shadow WHERE graded_at IS NOT NULL GROUP BY market_type`).all();
    const prop={};
    for(const x of propAgg.results||[]){const delta=finite(x.om)-finite(x.bm),decision=Number(x.n)>=300&&delta<0?"CONTINUE_SHADOW":"CONTINUE_SHADOW";prop[x.market_type]={n:Number(x.n),baselineMae:finite(x.bm),opportunityMae:finite(x.om),maeDelta:delta,availabilityVerifiedN:Number(x.verified_n||0),decision};
      await db.prepare(`INSERT OR REPLACE INTO wnba_player_opportunity_validation (id,model_id,model_version,market_type,n,baseline_mae,opportunity_mae,mae_delta,availability_verified_n,details_json,decision,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(`WNBA-PLAYER-OPPORTUNITY-v1:${x.market_type}:${now}`,"WNBA-PLAYER-OPPORTUNITY-v1","prospective-shadow-v1",x.market_type,Number(x.n),finite(x.bm),finite(x.om),delta,Number(x.verified_n||0),JSON.stringify({meanAnchored:true}),decision,now).run();
    }
    return json({ok:true,date,events:ids.length,gradedGames,settledMarkets,gradedProps,decisions,playerOpportunity:prop,errors,productionPromotionApplied:false});
  }catch(err){return json({ok:false,date,error:String(err?.message||err)},500)}
}
