import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { canonicalizeProPlayerPropMarket, normalizeProPropSport } from "../lib/proPlayerProps.js";
import { sha256Hex } from "../lib/sha256Hex.js";

const TARGET_MONTHLY_USD = 22;
const HARD_MONTHLY_CAP_USD = 25;
const RUN_START_USD = 0.05;
const PER_PROJECTION_USD = 0.00005;

function json(body,status=200){
  return new Response(JSON.stringify(body),{status,headers:{
    "content-type":"application/json; charset=utf-8",
    "cache-control":"no-store",
    "access-control-allow-origin":"*",
  }});
}
function s(v){const x=String(v??"").trim();return x||null}
function n(v){if(v==null||v==="")return null;const x=Number(v);return Number.isFinite(x)?x:null}
function norm(v){return String(v||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}
function first(obj,paths){
  for(const path of paths){
    let v=obj;
    for(const key of path.split(".")){ if(v==null){v=null;break} v=v[key] }
    if(v!=null&&v!=="") return v;
  }
  return null;
}
function sportOf(row){
  const raw=first(row,["sport","league","leagueName","league.name","competition"]);
  const token=String(raw||"").toLowerCase();
  if(token.includes("mlb")||token.includes("baseball")) return "mlb";
  if(token.includes("nfl")||token==="football") return "nfl";
  if(token.includes("nhl")||token.includes("hockey")) return "nhl";
  if(token.includes("wnba")) return "wnba";
  if(token.includes("nba")) return "nba";
  if(token.includes("cfb")||token.includes("college football")) return "cfb";
  if(token.includes("cbb")||token.includes("college basketball")) return "cbb";
  if(token.includes("tennis")||token.includes("atp")||token.includes("wta")) return "tennis";
  if(token.includes("soccer")||token.includes("football")) return "soccer";
  return normalizeProPropSport(raw);
}
function statOf(row){
  return s(first(row,["statType","stat_type","stat","market","marketName","projectionType","projection_type","type"]));
}
function playerNameOf(row){
  return s(first(row,["playerName","player_name","name","player.name","player.displayName"]));
}
function playerIdOf(row){
  return s(first(row,["playerId","player_id","player.id","playerIdExternal"]));
}
function headshotOf(row){
  return s(first(row,[
    "playerImage","player_image","playerImageUrl","player_image_url","imageUrl","image_url",
    "headshot","headshotUrl","headshot_url","photo","photoUrl","photo_url",
    "player.image","player.imageUrl","player.image_url","player.photo","player.headshot"
  ]));
}
function lineOf(row){
  return n(first(row,["line","lineScore","line_score","projection","projectionLine","value"]));
}
function tierOf(row){
  return s(first(row,["oddsTier","odds_tier","tier","oddsType","odds_type"]));
}
function durationOf(row){
  return s(first(row,["duration","period","timeframe"]));
}
function startOf(row){
  return s(first(row,["startTime","start_time","game.startTime","game.start_time","gameTime"]));
}
function teamOf(row){
  return s(first(row,["team","teamAbbr","team_abbr","player.team","player.teamAbbr"]));
}
function opponentOf(row){
  return s(first(row,["opponent","opponentAbbr","opponent_abbr","game.opponent"]));
}
function gameIdOf(row){
  return s(first(row,["gameId","game_id","game.id","eventId","event_id"]));
}
function projectionIdOf(row){
  return s(first(row,["projectionId","projection_id","id"]));
}
function marketFor(sport,stat){
  if(sport==="wnba") return norm(stat).replace(/ /g,"_");
  return canonicalizeProPlayerPropMarket(sport,stat) || norm(stat).replace(/ /g,"_") || null;
}
function candidateKey(c){
  return [String(c.sport||"").toLowerCase(),norm(c.playerName),String(c.market||"").toLowerCase()].join("|");
}
export function candidateOpponent(cand, rawTeam){
  if(!cand) return null;
  const team=norm(rawTeam || cand.team);
  const home=s(cand.home), away=s(cand.away);
  if(team && home && team===norm(home)) return away;
  if(team && away && team===norm(away)) return home;
  return s(cand.opponent);
}
async function mtd(db){
  const now=new Date();
  const monthStart=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString();
  const r=await db.prepare(
    "SELECT COALESCE(SUM(CASE WHEN actual_total_usd IS NOT NULL THEN actual_total_usd ELSE estimated_total_usd END),0) usd FROM shadow_cost_ledger WHERE created_at >= ?"
  ).bind(monthStart).first();
  return {usd:Number(r?.usd||0),monthStart};
}
export async function onRequestGet(context){
  if(!context.env?.DB) return json({ok:false,error:"database unavailable",rows:[]},503);
  const url=new URL(context.request.url);
  const mode=String(url.searchParams.get("mode")||"rows").toLowerCase();
  if(mode==="budget"){
    const auth=authorizeHarvest(context.request,context.env);
    if(!auth.ok) return json(unauthorizedBody(),401);
    const spent=await mtd(context.env.DB);
    return json({
      ok:true,
      monthToDateUsd:spent.usd,
      monthStart:spent.monthStart,
      targetMonthlyUsd:TARGET_MONTHLY_USD,
      hardMonthlyCapUsd:HARD_MONTHLY_CAP_USD,
      remainingToTargetUsd:Math.max(0,TARGET_MONTHLY_USD-spent.usd),
      remainingUsd:Math.max(0,HARD_MONTHLY_CAP_USD-spent.usd),
      pricing:{runStartUsd:RUN_START_USD,perProjectionUsd:PER_PROJECTION_USD},
    });
  }
  const sport=s(url.searchParams.get("sport"))?.toLowerCase()||null;
  const eventId=s(url.searchParams.get("eventId"));
  const limit=Math.max(1,Math.min(1000,Number(url.searchParams.get("limit")||300)));
  const where=[],bind=[];
  if(sport){where.push("sport=?");bind.push(sport)}
  if(eventId){where.push("fbis_event_id=?");bind.push(eventId)}
  const clause=where.length?"WHERE "+where.join(" AND "):"";
  const rows=(await context.env.DB.prepare(
    `SELECT * FROM prizepicks_prop_lines ${clause} ORDER BY collected_at DESC LIMIT ${limit}`
  ).bind(...bind).all())?.results||[];
  return json({ok:true,rows,count:rows.length,source:"PRIZEPICKS_APIFY",decisionEligible:false,canQualify:false});
}
export async function onRequestPost(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok) return json(unauthorizedBody(),401);
  if(!context.env?.DB) return json({ok:false,error:"database unavailable"},503);
  let body={};try{body=await context.request.json()}catch{}
  const rows=Array.isArray(body.rows)?body.rows:[];
  const candidates=Array.isArray(body.candidates)?body.candidates:[];
  const runId=s(body.runId)||`pp_${Date.now()}`;
  const collectedAt=s(body.collectedAt)||new Date().toISOString();
  const estimate=RUN_START_USD+rows.length*PER_PROJECTION_USD;
  const spent=await mtd(context.env.DB);
  if(spent.usd+estimate>HARD_MONTHLY_CAP_USD+1e-9){
    return json({ok:false,blocked:true,error:"monthly_budget_cap",monthToDateUsd:spent.usd,estimatedRunUsd:estimate,hardMonthlyCapUsd:HARD_MONTHLY_CAP_USD},409);
  }
  const cmap=new Map(candidates.map(c=>[candidateKey(c),c]));
  let written=0,matched=0,malformed=0;
  const statements=[];
  for(const raw of rows){
    const sport=sportOf(raw),playerName=playerNameOf(raw),stat=statOf(raw),line=lineOf(raw);
    if(!sport||!playerName||!stat||line==null){malformed++;continue}
    const market=marketFor(sport,stat);
    const cand=cmap.get([sport,norm(playerName),String(market||"").toLowerCase()].join("|"))||null;
    if(cand) matched++;
    const fbisProjection=n(cand?.fbisProjection),fbisSigma=n(cand?.fbisSigma);
    const delta=fbisProjection==null?null:fbisProjection-line;
    const side=delta==null||Math.abs(delta)<1e-9?null:(delta>0?"MORE":"LESS");
    const projectionId=projectionIdOf(raw);
    const id=sha256Hex(JSON.stringify([runId,projectionId,sport,playerName,market,line,tierOf(raw),durationOf(raw),collectedAt]));
    statements.push(context.env.DB.prepare(
      `INSERT OR REPLACE INTO prizepicks_prop_lines(
        id,run_id,projection_id,fbis_event_id,sport,league,player_id,player_name,player_headshot_url,team,opponent,game_id,start_time,
        stat_type,canonical_market,line,odds_tier,duration,fbis_projection,fbis_sigma,delta_fbis_minus_line,candidate_side,
        observed_at,collected_at,raw_json
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      id,runId,projectionId,s(cand?.eventId),sport,s(first(raw,["league","leagueName","league.name"])),
      playerIdOf(raw),playerName,headshotOf(raw),s(teamOf(raw)||cand?.team),s(opponentOf(raw)||candidateOpponent(cand,teamOf(raw))),gameIdOf(raw),s(startOf(raw)||cand?.start),
      stat,market,line,tierOf(raw),durationOf(raw),fbisProjection,fbisSigma,delta,side,
      s(first(raw,["updatedAt","updated_at","timestamp","observedAt","createdAt"]))||collectedAt,collectedAt,JSON.stringify(raw)
    ));
  }
  const BATCH_SIZE=200;
  for(let i=0;i<statements.length;i+=BATCH_SIZE){
    const result=await context.env.DB.batch(statements.slice(i,i+BATCH_SIZE));
    written+=result.reduce((sum,row)=>sum+Number(row?.meta?.changes||0),0);
  }
  const costId="cost_"+runId;
  const actual=Number.isFinite(Number(body.actualCostUsd))?Number(body.actualCostUsd):null;
  const total=actual==null?estimate:actual;
  await context.env.DB.prepare(
    `INSERT OR REPLACE INTO shadow_collection_runs(
      id,provider,mode,plan,profile,sport,lifecycle,status,enabled,requested_max_items,
      games_returned,observations_written,malformed_rows,estimated_cost_usd,actual_cost_usd,cost_basis,
      started_at,finished_at,duration_ms,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    runId,"PRIZEPICKS_APIFY","shadow",
    JSON.stringify({actor:"zen-studio/prizepicks-player-props",targeted:true,candidateCount:candidates.length}),
    "PRIZEPICKS_TARGETED","all","targeted_props","success_prizepicks",1,rows.length,
    rows.length,written,malformed,estimate,actual,actual==null?"ESTIMATED":"ACTUAL",
    collectedAt,collectedAt,0,collectedAt
  ).run();
  await context.env.DB.prepare(
    `INSERT OR REPLACE INTO shadow_cost_ledger(
      id,run_id,plan,sport,profile,cost_basis,run_start_usd,scoreboard_usd,row_usd,movement_usd,player_props_usd,
      game_props_usd,detail_usd,weather_usd,injuries_usd,standings_usd,futures_usd,estimated_total_usd,
      actual_total_usd,delta_usd,games_returned,features_json,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    costId,runId,"starter","all","PRIZEPICKS_TARGETED",actual==null?"ESTIMATED":"ACTUAL",
    RUN_START_USD,0,rows.length*PER_PROJECTION_USD,0,0,0,0,0,0,0,0,estimate,actual,actual==null?null:actual-estimate,
    rows.length,JSON.stringify({actor:"zen-studio/prizepicks-player-props",candidateCount:candidates.length,targeted:true}),collectedAt
  ).run();
  return json({ok:true,runId,rowsReturned:rows.length,written,matched,malformed,estimatedCostUsd:estimate,recordedCostUsd:total,hardMonthlyCapUsd:HARD_MONTHLY_CAP_USD});
}
