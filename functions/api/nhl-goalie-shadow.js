import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { buildTodayBoard, resolveTodayDate } from "../lib/todayBoard.js";
import { americanProfit } from "../lib/pricing.js";

const TZ="America/Chicago";
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
function finite(v){if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function dateCt(d=new Date()){return new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"}).format(d);}
function shiftDay(day,delta){const [y,m,d]=day.split("-").map(Number),x=new Date(Date.UTC(y,m-1,d,12));x.setUTCDate(x.getUTCDate()+delta);return x.toISOString().slice(0,10);}
function envOf(context){return {
  PARLAY_API_KEY:context.env.PARLAY_API_KEY,THEODDS_API_KEY:context.env.THEODDS_API_KEY,
  SHARPAPI_API_KEY:context.env.SHARPAPI_API_KEY,THERUNDOWN_API_KEY:context.env.THERUNDOWN_API_KEY,
  BALLPARK_PAL_API_KEY:context.env.BALLPARK_PAL_API_KEY,CFBD_API_KEY:context.env.CFBD_API_KEY,
  CBBD_API_KEY:context.env.CBBD_API_KEY,DB:context.env.DB,caches:caches.default
};}
function playerState(side={}){
  const players=side.players||[];
  return {
    ev:players.filter(p=>p.ev_line!=null||p.d_pair!=null).map(p=>({playerId:p.player_id,name:p.player_name,position:p.position,evLine:p.ev_line,dPair:p.d_pair,roleConfidence:p.role_confidence})),
    pp:players.filter(p=>p.pp_unit!=null).map(p=>({playerId:p.player_id,name:p.player_name,ppUnit:p.pp_unit,rollingPpToiSeconds:p.rolling_pp_toi_seconds})),
    availability:players.map(p=>({playerId:p.player_id,name:p.player_name,availabilityState:p.availability_state,gameState:p.game_state,injuryDetail:p.injury_detail,stateConfidence:p.state_confidence})),
    replacements:players.filter(p=>Array.isArray(p.replacements)&&p.replacements.length).map(p=>({playerId:p.player_id,name:p.player_name,replacements:p.replacements}))
  };
}
function freezeRows(board,snapshotAt,codeSha){
  const out=[];
  for(const game of board.games||[]){
    if(String(game.sport||"").toLowerCase()!=="nhl")continue;
    const s=game.nhlGoalieProbabilityShadow;
    if(!s?.ok||!s.historicallyValidated)continue;
    const startMs=Date.parse(game.start||""),nowMs=Date.parse(snapshotAt);
    if(!Number.isFinite(startMs)||!Number.isFinite(nowMs))continue;
    const hours=(startMs-nowMs)/3600000;
    if(hours<0.25||hours>6)continue;
    const h=playerState(s.persistentState?.home||{}),a=playerState(s.persistentState?.away||{});
    out.push({
      id:`nhlgs_${String(game.id)}_${String(s.modelVersion).replace(/[^a-z0-9]+/gi,"_")}`,
      eventId:String(game.id),gameStart:game.start||null,featureCutoffTimestamp:snapshotAt,
      modelId:s.modelId,modelVersion:s.modelVersion,incumbentModelId:s.incumbent?.modelId||"NHL-PRO-v2",
      gateId:s.gateId,gateFired:Boolean(s.gateFired),historicalGateValidated:Boolean(s.historicallyValidated),
      goalieProbabilityScale:finite(s.challenger?.goalieProbabilityScale),
      incumbentHomeWinProbability:finite(s.incumbent?.homeWinProbability),shadowHomeWinProbability:finite(s.challenger?.homeWinProbability),
      projectedHome:finite(s.incumbent?.projHome),projectedAway:finite(s.incumbent?.projAway),
      goalieState:{signal:s.goalieSignal,home:s.persistentState?.home?.goalies||[],away:s.persistentState?.away?.goalies||[]},
      evDeployment:{home:h.ev,away:a.ev},ppDeployment:{home:h.pp,away:a.pp},
      scratchesAvailability:{home:h.availability,away:a.availability},
      replacementMapping:{home:h.replacements,away:a.replacements},
      persistentState:s.persistentState,marketSnapshot:game.odds||null,codeSha,
    });
  }
  return out;
}
async function persist(db,rows){
  let written=0,existing=0;
  for(const r of rows){
    const result=await db.prepare(`INSERT OR IGNORE INTO nhl_goalie_probability_shadow(
      id,event_id,game_start,feature_cutoff_timestamp,model_id,model_version,incumbent_model_id,gate_id,gate_fired,historical_gate_validated,
      goalie_probability_scale,incumbent_home_win_probability,shadow_home_win_probability,projected_home,projected_away,
      goalie_state_json,ev_deployment_json,pp_deployment_json,scratches_availability_json,replacement_mapping_json,persistent_state_json,market_snapshot_json,
      code_sha,can_qualify,can_authorize_wager,staking_authorized,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(r.id,r.eventId,r.gameStart,r.featureCutoffTimestamp,r.modelId,r.modelVersion,r.incumbentModelId,r.gateId,r.gateFired?1:0,r.historicalGateValidated?1:0,
        r.goalieProbabilityScale,r.incumbentHomeWinProbability,r.shadowHomeWinProbability,r.projectedHome,r.projectedAway,
        JSON.stringify(r.goalieState),JSON.stringify(r.evDeployment),JSON.stringify(r.ppDeployment),JSON.stringify(r.scratchesAvailability),JSON.stringify(r.replacementMapping),JSON.stringify(r.persistentState),JSON.stringify(r.marketSnapshot),
        r.codeSha,0,0,0,r.featureCutoffTimestamp).run();
    if(result?.meta?.changes)written++;else existing++;
  }
  return{written,existing};
}
async function fetchBox(eventId){
  const r=await fetch(`https://api-web.nhle.com/v1/gamecenter/${encodeURIComponent(eventId)}/boxscore`,{headers:{accept:"application/json","user-agent":"FBIS-NHL-GOALIE-SHADOW-v1/1.0"},signal:AbortSignal.timeout(6000)});
  if(!r.ok)return null;return r.json();
}
function boxScore(box){
  const h=finite(box?.homeTeam?.score),a=finite(box?.awayTeam?.score);
  return h==null||a==null?null:{home:h,away:a};
}
function americanImplied(price){
  const p=finite(price);if(p==null||p===0)return null;
  return p<0?(-p)/((-p)+100):100/(p+100);
}
function priceForSide(snapshot,side){
  if(!snapshot||typeof snapshot!=="object")return null;
  const homeKeys=["homeML","homeMoneyline","home_ml","moneylineHome"],awayKeys=["awayML","awayMoneyline","away_ml","moneylineAway"];
  for(const k of side==="HOME"?homeKeys:awayKeys){const v=finite(snapshot[k]);if(v!=null)return v;}
  return null;
}
async function closeNoVig(db,eventId,side,start){
  try{
    const row=await db.prepare(`SELECT no_vig FROM odds_snapshots
      WHERE game_id=? AND upper(market)='ML' AND upper(side)=? AND rejected_post_start=0 AND captured_at<=?
      ORDER BY captured_at DESC LIMIT 1`).bind(eventId,side,start).first();
    return finite(row?.no_vig);
  }catch{return null;}
}
async function settle(db,date){
  const rows=(await db.prepare(`SELECT * FROM nhl_goalie_probability_shadow
    WHERE graded_at IS NULL AND substr(game_start,1,10) BETWEEN ? AND ? ORDER BY game_start`)
    .bind(shiftDay(date,-1),shiftDay(date,1)).all()).results||[];
  let graded=0;
  for(const r of rows){
    const box=await fetchBox(r.event_id).catch(()=>null),score=boxScore(box);if(!score)continue;
    const y=score.home>score.away?1:0,pi=clamp(finite(r.incumbent_home_win_probability)??0.5,1e-6,1-1e-6),ps=clamp(finite(r.shadow_home_win_probability)??0.5,1e-6,1-1e-6);
    const ib=(pi-y)**2,sb=(ps-y)**2,ill=-(y*Math.log(pi)+(1-y)*Math.log(1-pi)),sll=-(y*Math.log(ps)+(1-y)*Math.log(1-ps));
    const ic=(pi>=0.5)===Boolean(y)?1:0,sc=(ps>=0.5)===Boolean(y)?1:0;
    let market={};try{market=JSON.parse(r.market_snapshot_json||"{}")||{};}catch{}
    const side=ps>=0.5?"HOME":"AWAY",price=priceForSide(market,side);
    const won=side==="HOME"?score.home>score.away:score.away>score.home;
    const profit=price==null?null:(won?(americanProfit(price,1)??0):-1);
    const close=await closeNoVig(db,r.event_id,side,r.game_start);
    const entryImp=americanImplied(price),clv=close!=null&&entryImp!=null?(close-entryImp)*100:null;
    const grade={side,price,won,scoreMarketsChanged:false,atsDelta:"SAME_AS_INCUMBENT",totalDelta:"SAME_AS_INCUMBENT"};
    await db.prepare(`UPDATE nhl_goalie_probability_shadow SET
      actual_home=?,actual_away=?,incumbent_brier=?,shadow_brier=?,incumbent_log_loss=?,shadow_log_loss=?,
      incumbent_correct=?,shadow_correct=?,research_clv_probability_pp=?,research_profit_units=?,grade_json=?,graded_at=?
      WHERE id=?`).bind(score.home,score.away,ib,sb,ill,sll,ic,sc,clv,profit,JSON.stringify(grade),new Date().toISOString(),r.id).run();
    graded++;
  }
  return{eligible:rows.length,graded};
}
async function summary(db){
  const [counts,metrics]=await Promise.all([
    db.prepare(`SELECT COUNT(*) n,SUM(CASE WHEN gate_fired=1 THEN 1 ELSE 0 END) gate_n,SUM(CASE WHEN graded_at IS NOT NULL THEN 1 ELSE 0 END) graded_n,
      MIN(feature_cutoff_timestamp) first_at,MAX(feature_cutoff_timestamp) last_at FROM nhl_goalie_probability_shadow`).first(),
    db.prepare(`SELECT COUNT(*) n,AVG(incumbent_brier) incumbent_brier,AVG(shadow_brier) shadow_brier,
      AVG(incumbent_log_loss) incumbent_log_loss,AVG(shadow_log_loss) shadow_log_loss,
      AVG(incumbent_correct) incumbent_accuracy,AVG(shadow_correct) shadow_accuracy,
      AVG(research_clv_probability_pp) avg_clv_probability_pp,AVG(research_profit_units) avg_profit_units
      FROM nhl_goalie_probability_shadow WHERE graded_at IS NOT NULL`).first()
  ]);
  return{counts:counts||{},metrics:metrics||{},productionChampion:"NHL-PRO-v2",productionChanged:false,authority:false,staking:false};
}
export async function onRequestGet(context){
  const db=context.env.DB;if(!db?.prepare)return json({ok:false,error:"d1_unavailable"},503);
  return json({ok:true,...await summary(db)});
}
export async function onRequestPost(context){
  const auth=authorizeHarvest(context.request,context.env);if(!auth.ok)return json(unauthorizedBody(),401);
  const db=context.env.DB;if(!db?.prepare)return json({ok:false,error:"d1_unavailable"},503);
  let body={};try{body=await context.request.json()}catch{}
  const mode=String(body.mode||"freeze").toLowerCase(),raw=String(body.date||dateCt()),resolved=resolveTodayDate(raw);
  if(!resolved.ok)return json({ok:false,error:resolved.error},400);
  if(mode==="settle")return json({ok:true,mode,date:resolved.date,...await settle(db,resolved.date),...await summary(db)});
  if(mode!=="freeze")return json({ok:false,error:"invalid_mode"},400);
  const board=await buildTodayBoard(resolved.date,envOf(context),{focusSport:"nhl"});
  const snapshotAt=new Date().toISOString(),codeSha=context.env.CF_PAGES_COMMIT_SHA||body.codeSha||null;
  const rows=freezeRows(board,snapshotAt,codeSha),p=await persist(db,rows);
  return json({ok:true,mode,date:resolved.date,snapshotAt,candidates:rows.length,...p,
    gateFired:rows.filter(r=>r.gateFired).length,productionChampion:"NHL-PRO-v2",productionChanged:false,authority:false,staking:false});
}
