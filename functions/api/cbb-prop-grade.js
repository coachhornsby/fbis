import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { cbbdGet } from "../lib/collegeApi.js";

function json(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
}
const n=v=>{if(v==null||v==="")return null;const x=Number(v);return Number.isFinite(x)?x:null};
const norm=v=>String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g," ").trim();
const dateKey=v=>String(v||"").slice(0,10);
function actualFor(player,market){
  if(!player)return null;
  const pts=n(player.points),reb=n(player.rebounds?.total),ast=n(player.assists),thr=n(player.threePointFieldGoals?.made);
  if(market==="points")return pts;
  if(market==="rebounds")return reb;
  if(market==="assists")return ast;
  if(market==="three_pointers_made")return thr;
  if(market==="points_rebounds_assists")return [pts,reb,ast].every(x=>x!=null)?pts+reb+ast:null;
  return null;
}
function resultFor(side,actual,line){
  if(actual==null||line==null)return "OPEN";
  if(actual===line)return "PUSH";
  if(side==="MORE")return actual>line?"WIN":"LOSS";
  if(side==="LESS")return actual<line?"WIN":"LOSS";
  return "OPEN";
}
function lineClv(side,signal,close){
  if(signal==null||close==null)return null;
  return side==="MORE"?close-signal:side==="LESS"?signal-close:null;
}
function playerFromRows(rows,signal){
  const day=dateKey(signal.start_time),pname=norm(signal.player_name),team=norm(signal.team);
  let best=null;
  for(const game of rows||[]){
    if(dateKey(game?.startDate||game?.start_date||game?.date)!==day)continue;
    const gameTeam=norm(game?.team?.school||game?.team?.name||game?.team||"");
    if(team&&gameTeam&&team!==gameTeam&&!gameTeam.includes(team)&&!team.includes(gameTeam))continue;
    for(const p of game?.players||[]){
      const pid=String(p?.athleteId??p?.athleteSourceId??"");
      const exactId=signal.player_id&&pid&&String(signal.player_id)===pid;
      const exactName=norm(p?.name||p?.displayName||p?.athleteDisplayName)===pname;
      if(!exactId&&!exactName)continue;
      const score=(exactId?5:0)+(exactName?3:0)+(team&&gameTeam===team?2:0);
      if(!best||score>best.score)best={score,player:p,game};
    }
  }
  return best;
}
async function latestClose(db,signal){
  const row=await db.prepare(
    `SELECT line, observed_at, collected_at FROM prizepicks_prop_lines
     WHERE sport='cbb'
       AND player_name=?
       AND canonical_market=?
       AND (? IS NULL OR fbis_event_id=?)
       AND COALESCE(observed_at,collected_at) < ?
     ORDER BY COALESCE(observed_at,collected_at) DESC
     LIMIT 1`
  ).bind(signal.player_name,signal.market,signal.fbis_event_id,signal.fbis_event_id,signal.start_time).first();
  return row||null;
}
async function grade(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok)return json(unauthorizedBody(),401);
  if(!context.env?.DB)return json({ok:false,error:"database unavailable"},503);
  const url=new URL(context.request.url);
  const limit=Math.max(1,Math.min(1000,Number(url.searchParams.get("limit")||500)));
  const open=(await context.env.DB.prepare(
    `SELECT * FROM cbb_prop_learning_signals
     WHERE result='OPEN' AND start_time IS NOT NULL AND start_time < ?
     ORDER BY start_time ASC LIMIT ${limit}`
  ).bind(new Date().toISOString()).all())?.results||[];
  if(!open.length)return json({ok:true,open:0,graded:0,unmatched:0});
  const dates=open.map(x=>dateKey(x.start_time)).filter(Boolean).sort();
  const start=dates[0],end=dates.at(-1);
  const res=await cbbdGet("/games/players",context.env,{query:{startDateRange:start,endDateRange:end}});
  if(!res.ok)return json({ok:false,error:res.reason||"cbbd games/players unavailable",status:res.status||null},502);
  const rows=Array.isArray(res.data)?res.data:[];
  let graded=0,unmatched=0,wins=0,losses=0,pushes=0;
  const statements=[];
  for(const signal of open){
    const hit=playerFromRows(rows,signal);
    const actual=actualFor(hit?.player,signal.market);
    if(actual==null){unmatched++;continue}
    const close=await latestClose(context.env.DB,signal);
    const closingLine=n(close?.line),result=resultFor(signal.side,actual,n(signal.signal_line)),clv=lineClv(signal.side,n(signal.signal_line),closingLine);
    statements.push(context.env.DB.prepare(
      `UPDATE cbb_prop_learning_signals SET closing_line=?,closing_observed_at=?,line_clv=?,actual=?,result=?,graded_at=? WHERE id=? AND result='OPEN'`
    ).bind(closingLine,close?.observed_at||close?.collected_at||null,clv,actual,result,new Date().toISOString(),signal.id));
    graded++;if(result==="WIN")wins++;else if(result==="LOSS")losses++;else if(result==="PUSH")pushes++;
  }
  for(let i=0;i<statements.length;i+=100)await context.env.DB.batch(statements.slice(i,i+100));
  return json({ok:true,open:open.length,graded,unmatched,wins,losses,pushes,sourceRows:rows.length,startDate:start,endDate:end});
}
async function stats(context){
  if(!context.env?.DB)return json({ok:false,error:"database unavailable"},503);
  const rows=(await context.env.DB.prepare(
    `SELECT market,
       CASE WHEN ABS(COALESCE(signal_z,0)) < 0.25 THEN '0-.25'
            WHEN ABS(signal_z) < 0.5 THEN '.25-.5'
            WHEN ABS(signal_z) < 0.75 THEN '.5-.75'
            WHEN ABS(signal_z) < 1.0 THEN '.75-1'
            ELSE '1+' END z_bucket,
       COUNT(*) n,
       SUM(CASE WHEN result='WIN' THEN 1 ELSE 0 END) wins,
       SUM(CASE WHEN result='LOSS' THEN 1 ELSE 0 END) losses,
       SUM(CASE WHEN result='PUSH' THEN 1 ELSE 0 END) pushes,
       AVG(line_clv) avg_line_clv
     FROM cbb_prop_learning_signals
     WHERE result IN ('WIN','LOSS','PUSH')
     GROUP BY market,z_bucket
     ORDER BY market,z_bucket`
  ).all())?.results||[];
  const totals=await context.env.DB.prepare(
    `SELECT COUNT(*) signals,
      SUM(CASE WHEN result='OPEN' THEN 1 ELSE 0 END) open,
      SUM(CASE WHEN result='WIN' THEN 1 ELSE 0 END) wins,
      SUM(CASE WHEN result='LOSS' THEN 1 ELSE 0 END) losses,
      SUM(CASE WHEN result='PUSH' THEN 1 ELSE 0 END) pushes,
      AVG(line_clv) avg_line_clv
     FROM cbb_prop_learning_signals`
  ).first();
  return json({ok:true,model:"CBB-PROP-LEARNING-v1",canQualify:false,canAuthorizeWager:false,totals:totals||{},buckets:rows});
}
export async function onRequestGet(context){
  const url=new URL(context.request.url);
  if(String(url.searchParams.get("mode")||"stats").toLowerCase()==="grade")return grade(context);
  return stats(context);
}
export async function onRequestPost(context){return grade(context)}
