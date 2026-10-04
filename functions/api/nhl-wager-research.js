import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { buildTodayBoard, resolveTodayDate } from "../lib/todayBoard.js";
import { buildPlayerPropsBoard } from "../../src/features/playerProps/buildPlayerPropsBoard.js";
import { americanProfit } from "../lib/pricing.js";
import { persistOddsSnapshot } from "../lib/store.js";

const TZ="America/Chicago";
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
function finite(v){if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function dateCt(d=new Date()){return new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"}).format(d);}
function shiftDay(day,delta){const [y,m,d]=day.split("-").map(Number),x=new Date(Date.UTC(y,m-1,d,12));x.setUTCDate(x.getUTCDate()+delta);return x.toISOString().slice(0,10);}
function envOf(context){return {
  PARLAY_API_KEY:context.env.PARLAY_API_KEY,THEODDS_API_KEY:context.env.THEODDS_API_KEY,
  SHARPAPI_API_KEY:context.env.SHARPAPI_API_KEY,THERUNDOWN_API_KEY:context.env.THERUNDOWN_API_KEY,
  BALLPARK_PAL_API_KEY:context.env.BALLPARK_PAL_API_KEY,CFBD_API_KEY:context.env.CFBD_API_KEY,
  CBBD_API_KEY:context.env.CBBD_API_KEY,DB:context.env.DB,caches:caches.default
};}
function checkpoint(start,snapshotAt){
  const a=Date.parse(start||""),b=Date.parse(snapshotAt||"");if(!Number.isFinite(a)||!Number.isFinite(b))return"CURRENT";
  const h=(a-b)/3600000;if(h>24)return"OPEN";if(h>4)return"CURRENT";if(h>1.5)return"DECISION";if(h>=0)return"FINAL_PREGAME";return"CLOSE";
}
export function exactMarketSnapshotRows(board,snapshotAt,date){
  const out=[];
  for(const game of board?.games||[]){
    if(String(game?.sport||"").toLowerCase()!=="nhl"||!game?.nhlWagerV1?.ok)continue;
    const start=game.start||null,startMs=Date.parse(start||""),snapMs=Date.parse(snapshotAt||"");
    if(Number.isFinite(startMs)&&Number.isFinite(snapMs)&&snapMs>=startMs)continue;
    const book=String(game?.odds?.pinBook||game?.odds?.book||game?.odds?.source||"CANONICAL_BOARD");
    for(const o of game.nhlWagerV1.offers||[]){
      const price=finite(o.americanPrice),implied=finite(o.breakEvenProbability),noVig=finite(o.marketNoVigProbability);
      if(price==null||implied==null||noVig==null)continue;
      const m=String(o.market||"").toLowerCase();
      const market=m==="moneyline"?"ml":m==="spread"?"spread":m==="total"?"total":m;
      const selection=String(o.selection||"").toUpperCase();
      if(!["ML","SPREAD","TOTAL"].includes(market.toUpperCase())||!["HOME","AWAY","OVER","UNDER"].includes(selection))continue;
      out.push({
        gameId:String(game.id),sport:"nhl",date:String(date||""),
        book,market,side:selection,line:finite(o.line),price,
        implied,noVig,capturedAt:snapshotAt,period:"fg",
        eventId:String(game.id),gameStart:start,checkpoint:checkpoint(start,snapshotAt),
        rejectedPostStart:false,paired:true,
      });
    }
  }
  return out;
}
async function persistExactMarketSnapshots(env,rows){
  let written=0,failed=0;
  for(const row of rows){
    const r=await persistOddsSnapshot(env,row);
    if(r?.ok)written++;else failed++;
  }
  return {rows:rows.length,written,failed};
}

function gameRows(board,snapshotAt){
  const rows=[];
  for(const game of board.games||[]){
    if(game.sport!=="nhl"||!game.nhlWagerV1?.ok)continue;
    for(const o of game.nhlWagerV1.offers||[]){
      if(o.americanPrice==null||o.calibratedProbability==null)continue;
      rows.push({
        eventId:String(game.id),eventStart:game.start||null,wagerScope:"GAME",
        playerId:null,playerName:null,team:null,market:o.market,selection:o.selection,
        line:o.line,americanPrice:o.americanPrice,modelProbability:o.modelProbability,
        calibratedProbability:o.calibratedProbability,breakEvenProbability:o.breakEvenProbability,
        marketNoVigProbability:o.marketNoVigProbability,probabilityEdge:o.probabilityEdge,
        expectedRoi:o.expectedRoi,reliability:o.reliability?.score,confidence:o.confidence,
        confidenceVersion:o.confidenceVersion,confidenceStatus:o.confidenceStatus,decision:o.decision,
        suggestedUnits:o.suggestedUnits||0,modelId:game.nhlWagerV1.modelId,modelVersion:game.nhlWagerV1.version,
        projection:game.nhlWagerV1.independentProjection,disagreement:game.nhlWagerV1.disagreement,
        trajectory:o.trajectory,sourceSnapshotType:checkpoint(game.start,snapshotAt),researchCandidate:Boolean(o.researchCandidate)
      });
    }
  }
  return rows;
}
function propRows(board,snapshotAt){
  const pb=buildPlayerPropsBoard(board,{sportFilter:"nhl"});
  const rows=[];
  for(const r of pb.rows||[]){
    const w=r.nhlWagerV1;if(!w||w.americanPrice==null||w.calibratedProbability==null)continue;
    const game=(board.games||[]).find(g=>String(g.id)===String(r.eventId));
    rows.push({
      eventId:String(r.eventId),eventStart:game?.start||null,wagerScope:"PROP",
      playerId:r.fbisPlayerId||r.providerPlayerId||null,playerName:r.playerName||null,team:r.team||null,
      market:w.market,selection:w.side,line:w.line,americanPrice:w.americanPrice,modelProbability:w.modelProbability,
      calibratedProbability:w.calibratedProbability,breakEvenProbability:w.breakEvenProbability,
      marketNoVigProbability:w.marketNoVigProbability,probabilityEdge:w.probabilityEdge,
      expectedRoi:w.expectedRoi,reliability:w.reliability?.score,confidence:w.confidence,
      confidenceVersion:w.confidenceVersion,confidenceStatus:w.confidenceStatus,decision:w.decision,
      suggestedUnits:w.suggestedUnits||0,modelId:w.modelId,modelVersion:w.version,
      projection:{projection:w.projection,line:w.line,market:w.market},disagreement:null,trajectory:null,
      sourceSnapshotType:checkpoint(game?.start,snapshotAt),researchCandidate:Boolean(w.researchCandidate)
    });
  }
  return rows;
}
async function persistRows(db,rows,snapshotAt){
  let written=0;
  for(const r of rows){
    const id="nhlw_"+crypto.randomUUID().replaceAll("-","");
    await db.prepare(`INSERT INTO nhl_wager_decisions(
      id,snapshot_at,event_id,event_start,wager_scope,player_id,player_name,team,market,selection,line,american_price,
      model_probability,calibrated_probability,break_even_probability,market_no_vig_probability,probability_edge,
      expected_roi,reliability,confidence,confidence_version,confidence_status,decision,research_candidate,suggested_units,model_id,
      model_version,projection_json,disagreement_json,trajectory_json,source_snapshot_type,can_qualify,can_authorize_wager,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id,snapshotAt,r.eventId,r.eventStart,r.wagerScope,r.playerId,r.playerName,r.team,r.market,r.selection,r.line,r.americanPrice,
        r.modelProbability,r.calibratedProbability,r.breakEvenProbability,r.marketNoVigProbability,r.probabilityEdge,r.expectedRoi,
        r.reliability,r.confidence,r.confidenceVersion,r.confidenceStatus,r.decision,r.researchCandidate?1:0,r.suggestedUnits,r.modelId,r.modelVersion,
        JSON.stringify(r.projection||null),JSON.stringify(r.disagreement||null),JSON.stringify(r.trajectory||null),r.sourceSnapshotType,0,0,snapshotAt).run();
    written++;
  }
  return written;
}
function resultGame(row,home,away){
  const line=finite(row.line),sel=String(row.selection||"").toLowerCase(),m=String(row.market||"").toLowerCase();
  if(m==="moneyline"){if(home===away)return"VOID";return (sel==="home"?(home>away):(away>home))?"WIN":"LOSS";}
  if(m==="spread"){
    const selected=sel==="home"?home:away,other=sel==="home"?away:home,d=selected+(line||0)-other;
    return d>0?"WIN":d<0?"LOSS":"PUSH";
  }
  if(m==="total"){
    const d=home+away-(line||0);if(d===0)return"PUSH";
    return (sel==="over"?d>0:d<0)?"WIN":"LOSS";
  }
  return"VOID";
}
function profitFor(result,price){
  if(result==="PUSH"||result==="VOID")return 0;if(result==="LOSS")return-1;
  return americanProfit(price,1)??0;
}
async function fetchBox(eventId){
  const r=await fetch(`https://api-web.nhle.com/v1/gamecenter/${encodeURIComponent(eventId)}/boxscore`,{headers:{accept:"application/json","user-agent":"FBIS-NHL-WAGER-v1/1.0"},signal:AbortSignal.timeout(5000)});
  if(!r.ok)return null;return r.json();
}
function actualProp(box,row){
  const pid=String(row.player_id||""),name=String(row.player_name||"").toLowerCase();
  for(const side of ["homeTeam","awayTeam"]){
    const n=box?.playerByGameStats?.[side]||{};
    for(const group of ["forwards","defense","goalies"]){
      for(const p of n[group]||[]){
        const match=pid?String(p.playerId||"")===pid:String(p.name?.default||p.name||"").toLowerCase()===name;
        if(!match)continue;
        const m=String(row.market||"");
        if(m==="shots_on_goal")return finite(p.sog??p.shots);
        if(m==="goals")return finite(p.goals);
        if(m==="assists")return finite(p.assists);
        if(m==="points")return finite(p.points)??((finite(p.goals)||0)+(finite(p.assists)||0));
        if(m==="saves")return finite(p.saves);
      }
    }
  }
  return null;
}
function resultProp(row,actual){
  const line=finite(row.line);if(line==null||actual==null)return"VOID";const d=actual-line;if(d===0)return"PUSH";
  const s=String(row.selection||"").toUpperCase();return ((s==="OVER"||s==="MORE")?d>0:d<0)?"WIN":"LOSS";
}
async function closeQuote(db,row){
  if(row.wager_scope!=="GAME")return null;
  const market=String(row.market||"").toUpperCase()==="MONEYLINE"?"ML":String(row.market||"").toUpperCase();
  const side=String(row.selection||"").toUpperCase();
  return db.prepare(`SELECT line,price,no_vig,captured_at FROM odds_snapshots
    WHERE game_id=? AND upper(market)=? AND upper(side)=? AND rejected_post_start=0
      AND captured_at <= COALESCE(?,captured_at)
    ORDER BY captured_at DESC LIMIT 1`).bind(row.event_id,market,side,row.event_start).first();
}
async function settle(db,date,board){
  const decisions=(await db.prepare(`SELECT d.* FROM nhl_wager_decisions d
    LEFT JOIN nhl_wager_settlements s ON s.decision_id=d.id
    WHERE s.decision_id IS NULL AND substr(d.event_start,1,10) BETWEEN ? AND ?`)
    .bind(shiftDay(date,-1),shiftDay(date,1)).all()).results||[];
  const games=new Map((board.games||[]).map(g=>[String(g.id),g])),boxes=new Map();
  let settled=0,voided=0;
  for(const d of decisions){
    let result="VOID",actualHome=null,actualAway=null,actualPlayer=null;
    const g=games.get(String(d.event_id));
    if(d.wager_scope==="GAME"){
      actualHome=finite(g?.home?.score),actualAway=finite(g?.away?.score);
      if(actualHome==null||actualAway==null)continue;
      result=resultGame(d,actualHome,actualAway);
    }else{
      if(!boxes.has(d.event_id))boxes.set(d.event_id,await fetchBox(d.event_id).catch(()=>null));
      actualPlayer=actualProp(boxes.get(d.event_id),d);
      if(actualPlayer==null)continue;
      result=resultProp(d,actualPlayer);
    }
    const cq=await closeQuote(db,d).catch(()=>null);
    const closeNoVig=finite(cq?.no_vig),entryNoVig=finite(d.market_no_vig_probability);
    const clv=closeNoVig!=null&&entryNoVig!=null?(closeNoVig-entryNoVig)*100:null;
    const profit=profitFor(result,d.american_price),at=new Date().toISOString();
    await db.prepare(`INSERT OR IGNORE INTO nhl_wager_settlements(
      decision_id,event_id,settled_at,actual_home,actual_away,actual_player_value,result,risk_units,profit_units,
      close_line,close_price,close_no_vig_probability,clv_probability_pp,notes
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(d.id,d.event_id,at,actualHome,actualAway,actualPlayer,result,1,profit,
      finite(cq?.line),finite(cq?.price),closeNoVig,clv,result==="VOID"?"ungradeable_or_push_rule":null).run();
    settled++;if(result==="VOID")voided++;
  }
  return{eligible:decisions.length,settled,voided};
}
async function summary(db){
  const [counts,cal]=await Promise.all([
    db.prepare(`SELECT wager_scope,market,decision,COUNT(*) n,MIN(snapshot_at) first_at,MAX(snapshot_at) last_at
      FROM nhl_wager_decisions GROUP BY wager_scope,market,decision ORDER BY wager_scope,market,decision`).all(),
    db.prepare("SELECT * FROM nhl_wager_confidence_calibration ORDER BY wager_scope,market,confidence_band").all()
  ]);
  return{counts:counts.results||[],calibration:cal.results||[]};
}
export async function onRequestGet(context){
  const db=context.env.DB;if(!db?.prepare)return json({ok:false,error:"d1_unavailable"},503);
  return json({ok:true,...await summary(db)});
}
export async function onRequestPost(context){
  const auth=authorizeHarvest(context.request,context.env);if(!auth.ok)return json(unauthorizedBody(),401);
  const db=context.env.DB;if(!db?.prepare)return json({ok:false,error:"d1_unavailable"},503);
  let body={};try{body=await context.request.json()}catch{}
  const mode=String(body.mode||"capture").toLowerCase(),raw=String(body.date||dateCt());
  const resolved=resolveTodayDate(raw);if(!resolved.ok)return json({ok:false,error:resolved.error},400);
  const env=envOf(context),board=await buildTodayBoard(resolved.date,env,{focusSport:"nhl"});
  if(mode==="settle"){
    const s=await settle(db,resolved.date,board);return json({ok:true,mode,date:resolved.date,...s,...await summary(db)});
  }
  if(mode!=="capture")return json({ok:false,error:"invalid_mode"},400);
  const snapshotAt=new Date().toISOString();
  const marketSnapshots=exactMarketSnapshotRows(board,snapshotAt,resolved.date);
  const marketSnapshotWrite=await persistExactMarketSnapshots(env,marketSnapshots);
  const rows=[...gameRows(board,snapshotAt),...propRows(board,snapshotAt)];
  const written=await persistRows(db,rows,snapshotAt);
  return json({ok:true,mode,date:resolved.date,snapshotAt,rows:rows.length,written,marketSnapshotWrite,
    researchCandidates:rows.filter(r=>r.researchCandidate).length,researchBets:rows.filter(r=>r.decision==="BET").length,gameRows:rows.filter(r=>r.wagerScope==="GAME").length,
    propRows:rows.filter(r=>r.wagerScope==="PROP").length,authority:false,staking:false});
}
