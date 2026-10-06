import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { buildSlate, resolveSlateDate } from "../lib/slateEngine.js";
import { buildNflQbPersonnelShadow, executableNflMarketSnapshot, NFL_QB_PERSONNEL_GATE } from "../lib/nflQbPersonnelShadow.js";
import { sha256Hex } from "../lib/sha256Hex.js";
import { evaluateNflQbProspectiveGate, nflQbProspectiveCriteria } from "../lib/nflProspectiveGate.js";
import {
  canonicalEvidenceId,
  persistCanonicalProspectiveEvidence,
  persistCanonicalEconomicGrade,
  markCanonicalEvidenceGraded,
  twoWayNoVigFromPrices,
} from "../lib/canonical/sportEvidenceAdapter.js";

function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}})}
function finite(v){const n=Number(v);return v==null||v===""||!Number.isFinite(n)?null:n}
function ctDate(d=new Date()){return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(d)}
function checkpoint(start,frozenAt){
  const ms=Date.parse(start)-Date.parse(frozenAt);
  if(!Number.isFinite(ms)||ms<=0)return null;
  const h=ms/3600000;
  if(h<=4 && h>=0.25)return"LATE";
  if(h<=72 && h>4)return"EARLY";
  return null;
}
function profileObservedAts(...profiles){
  const out=[];
  for(const node of profiles.filter(Boolean)){
    for(const v of [node.updatedAt,node.sourceUpdatedAt])if(v)out.push(v);
    for(const p of node.players||[])for(const v of [p.stateSourceUpdatedAt,p.updatedAt])if(v)out.push(v);
  }
  return out;
}
function compactProfile(node={}){
  if(!node)return null;
  return {
    teamKey:node.team_key||node.teamKey||null,
    updatedAt:node.updated_at||node.updatedAt||null,
    sourceUpdatedAt:node.source_updated_at||node.sourceUpdatedAt||null,
    players:(node.players||[]).filter(p=>String(p.position||"").toUpperCase()==="QB").map(p=>({
      playerKey:p.player_key||p.playerKey||null,playerId:p.player_id||p.playerId||null,playerName:p.player_name||p.playerName||null,
      depthRank:p.depth_rank??p.depthRank??null,roleLabel:p.role_label||p.roleLabel||null,
      lastKnownSnapShare:p.last_known_snap_share??p.lastKnownSnapShare??null,expectedSnapShare:p.expected_snap_share??p.expectedSnapShare??null,
      healthState:p.health_state||p.healthState||null,practiceState:p.practice_state||p.practiceState||null,
      injuryDetail:p.injury_detail||p.injuryDetail||null,stateConfidence:p.state_confidence??p.stateConfidence??null,
      carriedState:Boolean(p.carried_state??p.carriedState),stateSource:p.state_source||p.stateSource||null,
      stateSourceUpdatedAt:p.state_source_updated_at||p.stateSourceUpdatedAt||null,updatedAt:p.updated_at||p.updatedAt||null,
    })),
  };
}
function marketSide(projectionMargin,spreadHome){
  const m=finite(projectionMargin),s=finite(spreadHome);
  if(m==null||s==null)return null;
  const threshold=-s;
  return m>threshold?"home":m<threshold?"away":"push";
}
function profit(price){
  const p=finite(price);if(p==null||p===0)return null;
  return p<0?100/(-p):p/100;
}
function gradeAts(actualMargin,spreadHome,selection,homePrice,awayPrice){
  const a=finite(actualMargin),s=finite(spreadHome);
  if(a==null||s==null||!["home","away"].includes(selection))return {result:null,units:null};
  const cover=a+s;
  const signed=selection==="home"?cover:-cover;
  const result=signed>0?"WIN":signed<0?"LOSS":"PUSH";
  const price=selection==="home"?homePrice:awayPrice;
  const pr=profit(price);
  if(result!=="PUSH" && pr==null)return {result,units:null};
  return {result,units:result==="WIN"?pr:result==="LOSS"?-1:0};
}
function probGrade(actualHomeWin,p){
  const q=Math.max(.001,Math.min(.999,finite(p)??.5)),y=actualHomeWin?1:0;
  return {brier:(q-y)**2,logLoss:-(y*Math.log(q)+(1-y)*Math.log(1-q))};
}
async function latestCloseMarket(db,eventId){
  if(!db?.prepare)return null;
  const rows=(await db.prepare(`
    SELECT o.market_type,o.selection,o.line,o.american_price,o.sportsbook,o.snapshot_type,o.collected_at
    FROM action_market_snapshot_pointers p
    JOIN action_market_book_observations o ON o.id=p.observation_id
    WHERE p.canonical_event_id=? AND o.sport='nfl' AND o.market_period='event'
      AND p.snapshot_type IN ('CLOSE','FINAL_PREGAME')
    ORDER BY CASE p.snapshot_type WHEN 'CLOSE' THEN 0 ELSE 1 END, o.collected_at DESC
  `).bind(String(eventId)).all())?.results||[];
  if(!rows.length)return null;
  const spreadHome=rows.find(r=>r.market_type==="spread"&&r.selection==="home");
  const spreadAway=rows.find(r=>r.market_type==="spread"&&r.selection==="away");
  const over=rows.find(r=>r.market_type==="total"&&r.selection==="over");
  const under=rows.find(r=>r.market_type==="total"&&r.selection==="under");
  const mlHome=rows.find(r=>["moneyline","ml"].includes(String(r.market_type||"").toLowerCase())&&r.selection==="home");
  const mlAway=rows.find(r=>["moneyline","ml"].includes(String(r.market_type||"").toLowerCase())&&r.selection==="away");
  const mlNoVig=twoWayNoVigFromPrices(mlHome?.american_price,mlAway?.american_price);
  return {
    spreadHome:finite(spreadHome?.line),spreadHomePrice:finite(spreadHome?.american_price),spreadAwayPrice:finite(spreadAway?.american_price),
    total:finite(over?.line??under?.line),overPrice:finite(over?.american_price),underPrice:finite(under?.american_price),
    moneylineHome:finite(mlHome?.american_price),moneylineAway:finite(mlAway?.american_price),
    noVigHomeProbability:mlNoVig.a,noVigAwayProbability:mlNoVig.b,
    sportsbook:spreadHome?.sportsbook||over?.sportsbook||mlHome?.sportsbook||null,
    snapshotType:spreadHome?.snapshot_type||over?.snapshot_type||mlHome?.snapshot_type||null,
    observedAt:spreadHome?.collected_at||over?.collected_at||mlHome?.collected_at||null,
  };
}
async function espnFinal(date){
  const compact=String(date).replaceAll("-","");
  const res=await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${compact}`,{headers:{"user-agent":"FBIS-NFL-QB-Shadow/1.0"}});
  if(!res.ok)return new Map();
  const body=await res.json();
  const out=new Map();
  for(const e of body.events||[]){
    const comp=e.competitions?.[0]||{},done=Boolean(e.status?.type?.completed||comp.status?.type?.completed);
    if(!done)continue;
    const home=(comp.competitors||[]).find(x=>x.homeAway==="home"),away=(comp.competitors||[]).find(x=>x.homeAway==="away");
    const hs=finite(home?.score),as=finite(away?.score);
    if(hs==null||as==null)continue;
    out.set(String(e.id),{home:hs,away:as});
  }
  return out;
}
async function snapshot(context,date){
  const resolved=resolveSlateDate(date,{maxPast:1,maxFuture:7});
  if(!resolved.ok)return{ok:false,error:resolved.error};
  const env={
    PARLAY_API_KEY:context.env.PARLAY_API_KEY,THEODDS_API_KEY:context.env.THEODDS_API_KEY,
    SHARPAPI_API_KEY:context.env.SHARPAPI_API_KEY,THERUNDOWN_API_KEY:context.env.THERUNDOWN_API_KEY,
    DB:context.env.DB,ARCHIVE:context.env.ARCHIVE,caches:caches.default,parlayCacheOnly:true,cfbdScheduleFallback:false,
  };
  const slate=await buildSlate("nfl",resolved.date,env);
  const frozenAt=new Date().toISOString();let inserted=0,eligible=0,gated=0,skipped=0,canonicalWritten=0,canonicalExisting=0,canonicalTemporalFailures=0;
  for(const game of slate.games||[]){
    const start=game.start||game.startTime||game.commence_time;
    const cp=checkpoint(start,frozenAt);
    if(!cp){skipped++;continue}
    const criteria=nflQbProspectiveCriteria();
    const storageCheckpoint=`${cp}@${criteria.gateId}`;
    const shadow=buildNflQbPersonnelShadow(game);
    if(!shadow.ok){skipped++;continue}
    eligible++;if(shadow.gate.fired)gated++;
    const market=executableNflMarketSnapshot(game);
    const eventId=String(game.id||"");
    if(!eventId){skipped++;continue}
    const id=sha256Hex(["nfl-qb-shadow-v1",criteria.gateId,eventId,cp].join("|"));
    const profile=game.nflPersistentProfile||{};
    const homeProfile=compactProfile(profile.home),awayProfile=compactProfile(profile.away);
    const codeSha=context.env.CF_PAGES_COMMIT_SHA||null;
    const provenance={
      frozenAt,source:"FBIS_PROSPECTIVE_SHADOW",stateBeforeWeight:true,
      historicalGateValidated:true,prospectiveValidated:false,operatorApprovedProduction:false,
      championUntouched:true,wagerAuthorityUntouched:true,marketUsedInProjection:false,
      profileVersion:profile.version||null,
      prospectiveGateId:criteria.gateId,
      governanceId:criteria.governanceId,
      codeSha,
    };
    const result=await context.env.DB.prepare(`
      INSERT OR IGNORE INTO nfl_qb_personnel_shadow_predictions(
        id,event_id,season,week,start_time,checkpoint,frozen_at,champion_governance_id,incumbent_model_id,incumbent_model_version,
        incumbent_home,incumbent_away,incumbent_margin,incumbent_win_probability,incumbent_total,
        challenger_model_id,challenger_home,challenger_away,challenger_margin,challenger_win_probability,challenger_total,margin_correction,
        combined_qb_burden,home_qb_burden,away_qb_burden,gate_threshold,gate_fired,
        executable_market_json,home_profile_json,away_profile_json,personnel_json,provenance_json,lifecycle,can_qualify,can_authorize_wager
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      id,eventId,finite(game.season?.year??game.seasonYear??new Date(start).getUTCFullYear()),finite(game.week?.number??game.week),start,storageCheckpoint,frozenAt,
      shadow.championGovernanceId,shadow.incumbentModelId,shadow.incumbentModelVersion,
      shadow.incumbent.home,shadow.incumbent.away,shadow.incumbent.margin,shadow.incumbent.pHomeWin,shadow.incumbent.total,
      shadow.modelId,shadow.home,shadow.away,shadow.margin,shadow.pHomeWin,shadow.total,shadow.marginCorrection,
      shadow.gate.combinedQbBurden,shadow.gate.homeQbBurden,shadow.gate.awayQbBurden,shadow.gate.threshold,shadow.gate.fired?1:0,
      JSON.stringify(market),JSON.stringify(homeProfile),JSON.stringify(awayProfile),
      JSON.stringify(shadow.personnel),JSON.stringify(provenance),"SHADOW",0,0
    ).run();
    inserted+=Number(result?.meta?.changes||0);
    const canonical=await persistCanonicalProspectiveEvidence(context.env.DB,{
      sport:"nfl",eventId,eventStartAt:start,snapshotAt:frozenAt,
      championModelId:criteria.champion,modelId:shadow.modelId,modelVersion:"v1",
      lifecycle:"SHADOW",gateVersion:criteria.gateId,
      stateSnapshotId:`nfl-profile:${eventId}:${frozenAt}`,
      marketSnapshotId:market.observedAt?`nfl-market:${eventId}:${market.observedAt}`:null,
      marketObservedAt:market.observedAt,sourceObservedAts:profileObservedAts(homeProfile,awayProfile),
      codeSha,
      incumbentProjection:{home:shadow.incumbent.home,away:shadow.incumbent.away,margin:shadow.incumbent.margin,total:shadow.incumbent.total,homeWinProbability:shadow.incumbent.pHomeWin},
      challengerProjection:{home:shadow.home,away:shadow.away,margin:shadow.margin,total:shadow.total,homeWinProbability:shadow.pHomeWin},
      governance:{governanceId:criteria.governanceId,gateFired:Boolean(shadow.gate.fired),historicallyValidated:true,prospectivelyValidated:false,operatorApproved:false},
      canQualify:false,canAuthorize:false,legacy:false,
    },{
      sourceTable:"nfl_qb_personnel_shadow_predictions",sourceId:id,
      cohortGateVersion:criteria.gateId,minSnapshotAt:criteria.frozenAt,
    });
    canonicalWritten+=Number(canonical.written||0);
    canonicalExisting+=Number(canonical.existing||0);
    if(!canonical.ok&&canonical.reason==="temporal_integrity_failed")canonicalTemporalFailures++;
  }
  return{ok:true,date:resolved.date,frozenAt,eligible,gated,inserted,skipped,
    canonical:{written:canonicalWritten,existing:canonicalExisting,temporalFailures:canonicalTemporalFailures},
    gate:NFL_QB_PERSONNEL_GATE};
}
async function grade(context,date){
  const finals=await espnFinal(date);
  const rows=(await context.env.DB.prepare(`
    SELECT * FROM nfl_qb_personnel_shadow_predictions
    WHERE substr(start_time,1,10)=? AND graded_at IS NULL
  `).bind(date).all())?.results||[];
  let graded=0;
  for(const row of rows){
    const final=finals.get(String(row.event_id));if(!final)continue;
    const actualMargin=final.home-final.away,actualTotal=final.home+final.away,homeWin=actualMargin>0;
    const market=JSON.parse(row.executable_market_json||"{}"),close=await latestCloseMarket(context.env.DB,row.event_id);
    const incSide=marketSide(row.incumbent_margin,market.spreadHome),chalSide=marketSide(row.challenger_margin,market.spreadHome);
    const incAts=gradeAts(actualMargin,market.spreadHome,incSide,market.spreadHomePrice,market.spreadAwayPrice);
    const chalAts=gradeAts(actualMargin,market.spreadHome,chalSide,market.spreadHomePrice,market.spreadAwayPrice);
    const incProb=probGrade(homeWin,row.incumbent_win_probability),chalProb=probGrade(homeWin,row.challenger_win_probability);
    const clv=(side)=>{
      if(!close||finite(market.spreadHome)==null||finite(close.spreadHome)==null||!["home","away"].includes(side))return null;
      const homeValue=Number(market.spreadHome)-Number(close.spreadHome);
      return side==="home"?homeValue:-homeValue;
    };
    const gradedAt=new Date().toISOString();
    await context.env.DB.prepare(`
      UPDATE nfl_qb_personnel_shadow_predictions SET
        actual_home=?,actual_away=?,actual_margin=?,actual_total=?,closing_market_json=?,
        incumbent_margin_abs_error=?,challenger_margin_abs_error=?,incumbent_winner_correct=?,challenger_winner_correct=?,
        incumbent_brier=?,challenger_brier=?,incumbent_log_loss=?,challenger_log_loss=?,
        incumbent_ats_result=?,challenger_ats_result=?,incumbent_roi_units=?,challenger_roi_units=?,
        incumbent_clv=?,challenger_clv=?,graded_at=?
      WHERE id=?
    `).bind(
      final.home,final.away,actualMargin,actualTotal,JSON.stringify(close),
      Math.abs(Number(row.incumbent_margin)-actualMargin),Math.abs(Number(row.challenger_margin)-actualMargin),
      Math.sign(Number(row.incumbent_margin))===Math.sign(actualMargin)?1:0,Math.sign(Number(row.challenger_margin))===Math.sign(actualMargin)?1:0,
      incProb.brier,chalProb.brier,incProb.logLoss,chalProb.logLoss,
      incAts.result,chalAts.result,incAts.units,chalAts.units,clv(incSide),clv(chalSide),gradedAt,row.id
    ).run();

    let provenance={};try{provenance=JSON.parse(row.provenance_json||"{}")||{}}catch{}
    const criteria=nflQbProspectiveCriteria();
    if(provenance.prospectiveGateId===criteria.gateId && Date.parse(row.frozen_at)>=Date.parse(criteria.frozenAt)){
      const evidenceId=canonicalEvidenceId({sport:"nfl",sourceTable:"nfl_qb_personnel_shadow_predictions",sourceId:row.id,gateVersion:criteria.gateId});
      await markCanonicalEvidenceGraded(context.env.DB,evidenceId,{gradedAt,result:{
        actualHome:final.home,actualAway:final.away,actualMargin,actualTotal,
        incumbentBrier:incProb.brier,challengerBrier:chalProb.brier,
        incumbentLogLoss:incProb.logLoss,challengerLogLoss:chalProb.logLoss,
        sourceSpreadClvPoints:{incumbent:clv(incSide),challenger:clv(chalSide)},
      }});
      const entryNoVig=twoWayNoVigFromPrices(market.moneylineHome,market.moneylineAway);
      const closeNoVig={a:finite(close?.noVigHomeProbability),b:finite(close?.noVigAwayProbability)};
      const side=Number(row.challenger_win_probability)>=0.5?"HOME":"AWAY";
      const won=side==="HOME"?homeWin:!homeWin;
      const projectedProbability=side==="HOME"?finite(row.challenger_win_probability):(1-finite(row.challenger_win_probability));
      const entryProbability=side==="HOME"?entryNoVig.a:entryNoVig.b;
      const closeProbability=side==="HOME"?closeNoVig.a:closeNoVig.b;
      await persistCanonicalEconomicGrade(context.env.DB,{
        evidenceId,sport:"nfl",eventId:String(row.event_id),marketFamily:"moneyline_probability",
        selection:side,projectedProbability,
        entryNoVigProbability:entryProbability,closeNoVigProbability:closeProbability,
        result:won?"WIN":"LOSS",gradedAt,
        metadata:{researchOnly:true,sourceClvSemantics:"spread_line_movement_points"},
      },{
        executionEvidence:false,sourceTable:"nfl_qb_personnel_shadow_predictions",sourceId:row.id,
        sourceMetrics:{challengerBrier:chalProb.brier,challengerLogLoss:chalProb.logLoss,challengerSpreadClvPoints:clv(chalSide)},
      });
    }
    graded++;
  }
  return{ok:true,date,candidates:rows.length,finals:finals.size,graded};
}
async function summary(db){
  const allRows=(await db.prepare("SELECT * FROM nfl_qb_personnel_shadow_predictions ORDER BY start_time").all())?.results||[];
  const rows=allRows.filter(r=>r.graded_at && String(r.provenance_json||"").includes(nflQbProspectiveCriteria().gateId));
  const group=(arr)=>{
    if(!arr.length)return{n:0};
    const avg=k=>arr.reduce((s,r)=>s+Number(r[k]||0),0)/arr.length;
    const roi=k=>arr.filter(r=>finite(r[k])!=null).reduce((s,r)=>s+Number(r[k]),0);
    const clv=k=>{const a=arr.map(r=>finite(r[k])).filter(v=>v!=null);return a.length?a.reduce((s,v)=>s+v,0)/a.length:null};
    const ats=(k)=>{
      const a=arr.map(r=>r[k]).filter(Boolean),wins=a.filter(x=>x==="WIN").length,losses=a.filter(x=>x==="LOSS").length,pushes=a.filter(x=>x==="PUSH").length;
      return{n:a.length,wins,losses,pushes,winRate:wins+losses?wins/(wins+losses):null};
    };
    return{
      n:arr.length,
      incumbent:{marginMae:avg("incumbent_margin_abs_error"),winnerAccuracy:avg("incumbent_winner_correct"),brier:avg("incumbent_brier"),logLoss:avg("incumbent_log_loss"),ats:ats("incumbent_ats_result"),roiUnits:roi("incumbent_roi_units"),avgClv:clv("incumbent_clv")},
      challenger:{marginMae:avg("challenger_margin_abs_error"),winnerAccuracy:avg("challenger_winner_correct"),brier:avg("challenger_brier"),logLoss:avg("challenger_log_loss"),ats:ats("challenger_ats_result"),roiUnits:roi("challenger_roi_units"),avgClv:clv("challenger_clv")},
    };
  };
  const burdenBuckets=[
    {label:"<0.15",min:-1,max:.15},{label:"0.15-0.30",min:.15,max:.30},{label:"0.30-0.50",min:.30,max:.50},{label:"0.50+",min:.50,max:99},
  ].map(b=>({bucket:b.label,...group(rows.filter(r=>Number(r.combined_qb_burden)>=b.min&&Number(r.combined_qb_burden)<b.max))}));
  const weeks={};
  for(const r of rows){const k=`${r.season||""}-W${r.week||""}`;if(!weeks[k])weeks[k]=[];weeks[k].push(r)}
  const byEvent=new Map();
  for(const r of rows){
    const prior=byEvent.get(String(r.event_id));
    const currentLate=String(r.checkpoint||"").startsWith("LATE");
    const priorLate=String(prior?.checkpoint||"").startsWith("LATE");
    if(!prior || (!priorLate&&currentLate))byEvent.set(String(r.event_id),r);
  }
  const primary=[...byEvent.values()];
  const checkpointGroups={EARLY:group(rows.filter(r=>String(r.checkpoint||"").startsWith("EARLY"))),LATE:group(rows.filter(r=>String(r.checkpoint||"").startsWith("LATE")))};
  const homeDisrupted=primary.filter(r=>Number(r.home_qb_burden)>=0.30);
  const awayDisrupted=primary.filter(r=>Number(r.away_qb_burden)>=0.30);
  const prospectiveGate=evaluateNflQbProspectiveGate(allRows);
  const criteria=nflQbProspectiveCriteria();
  const canonical=await db.prepare(`SELECT
      COUNT(*) n,
      SUM(CASE WHEN temporal_integrity=1 THEN 1 ELSE 0 END) temporal_ok,
      SUM(CASE WHEN graded_at IS NOT NULL THEN 1 ELSE 0 END) graded
    FROM fbis_prospective_evidence
    WHERE sport='nfl' AND model_id=? AND gate_version=?`).bind(criteria.modelId,criteria.gateId).first();
  const canonicalGrades=await db.prepare(`SELECT COUNT(*) n FROM fbis_economic_grades
    WHERE sport='nfl' AND evidence_id IN (
      SELECT evidence_id FROM fbis_prospective_evidence WHERE sport='nfl' AND model_id=? AND gate_version=?
    )`).bind(criteria.modelId,criteria.gateId).first();
  return{
    ok:true,lifecycle:"SHADOW",productionChampionModified:false,wagerAuthorityModified:false,
    frozenRows:rows.length,uniqueGames:primary.length,
    primary:group(primary),
    gated:group(primary.filter(r=>Number(r.gate_fired)===1)),
    nonGated:group(primary.filter(r=>Number(r.gate_fired)!==1)),
    checkpoints:checkpointGroups,
    burdenBuckets:burdenBuckets.map(b=>({bucket:b.bucket,...group(primary.filter(r=>{
      const x=Number(r.combined_qb_burden);
      if(b.bucket==="<0.15")return x<.15;
      if(b.bucket==="0.15-0.30")return x>=.15&&x<.30;
      if(b.bucket==="0.30-0.50")return x>=.30&&x<.50;
      return x>=.50;
    }))})),
    seasonWeek:Object.fromEntries(Object.entries(weeks).map(([k,v])=>{
      const ev=new Map();for(const r of v){const p=ev.get(String(r.event_id));const pLate=String(p?.checkpoint||"").startsWith("LATE");const rLate=String(r.checkpoint||"").startsWith("LATE");if(!p||(!pLate&&rLate))ev.set(String(r.event_id),r)}
      return[k,group([...ev.values()])];
    })),
    disruptionSide:{
      home:homeDisrupted.length>=10?group(homeDisrupted):{n:homeDisrupted.length,status:"INSUFFICIENT_SAMPLE"},
      away:awayDisrupted.length>=10?group(awayDisrupted):{n:awayDisrupted.length,status:"INSUFFICIENT_SAMPLE"},
    },
    prospectiveGate,
    canonicalAdapter:{
      sourceEligibleFrozenRows:prospectiveGate.sample.eligibleFrozenRows,
      excludedLegacyOrWrongVersionRows:prospectiveGate.sample.excludedPreGateOrWrongVersionRows,
      canonicalRows:Number(canonical?.n||0),
      canonicalTemporalOk:Number(canonical?.temporal_ok||0),
      canonicalGraded:Number(canonical?.graded||0),
      canonicalEconomicGrades:Number(canonicalGrades?.n||0),
      exactFreezeReconciliation:Number(canonical?.n||0)===Number(prospectiveGate.sample.eligibleFrozenRows||0),
      sourceClvSemantics:"spread_line_movement_points",
      canonicalClvSemantics:"no_vig_probability",
      clvDirectlyComparable:false,
    },
    promotionState:prospectiveGate.decision,
    promotionEligible:false,
    prospectiveValidationPassed:false,
    operatorApprovedForProduction:false,
    primaryPromotionQuestion:"Does improvement remain concentrated in gate-fired games (QB burden >= 0.30) prospectively?",
  };
}

export async function onRequest(context){
  const auth=authorizeHarvest(context.request,context.env);
  if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
  if(!context.env?.DB)return json({ok:false,error:"database-unavailable"},503);
  const url=new URL(context.request.url),mode=String(url.searchParams.get("mode")||"summary").toLowerCase();
  const date=url.searchParams.get("date")||ctDate();
  try{
    if(mode==="snapshot")return json(await snapshot(context,date));
    if(mode==="grade")return json(await grade(context,date));
    if(mode==="summary")return json(await summary(context.env.DB));
    return json({ok:false,error:"unsupported-mode"},400);
  }catch(err){
    return json({ok:false,error:"nfl-qb-shadow-failed",detail:String(err?.message||err)},500);
  }
}
