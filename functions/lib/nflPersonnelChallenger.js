/**
 * NFL-PRO-v1.3 personnel research challenger.
 * A new, as-of pre-kickoff observation; NEVER revises an NFL-PRO-v1.2 freeze.
 * All coefficients below are exploratory assumptions, not fitted estimates.
 * No prices, market information, wager decisions, or auto-promotion.
 */
export const NFL_PERSONNEL_MODEL = "NFL-PRO-v1.3-PERSONNEL-SHADOW";
export const NFL_PERSONNEL_CONTRACT = "NFL-PERSONNEL-ASOF-v1";
const ABSENT = new Set(["OUT","IR","PUP","NFI","SUSPENDED"]);
const UNCERTAIN = new Set(["QUESTIONABLE","DOUBTFUL","DNP_PRACTICE","LIMITED"]);
const DEFENSE = new Set(["CB","DB","S","FS","SS","EDGE","DE","DT","NT","DL","LB","OLB","ILB"]);
const OFFENSE = new Set(["QB","WR","TE","RB","FB","OL","OT","T","G","OG","C","LT","RT","LG","RG"]);
const VALID_SOURCE = /nfl.official|espn|licensed|league|injury|active.inactive/i;
const bounded=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const num=v=>v==null||v===""||!Number.isFinite(Number(v))?null:Number(v);
const stamp=s=>typeof s==="string"&&s.trim()?Date.parse(s):NaN;
const round=(n,d=2)=>Math.round(n*10**d)/10**d;
const get=(p,...keys)=>{for(const k of keys)if(p?.[k]!=null)return p[k];return null;};
const norm=s=>String(s||"").trim().toUpperCase().replace(/[\s-]+/g,"_");
export const nflPersonnelTeamKey=abbr=>({JAC:"jax",WSH:"was",LA:"lar"}[String(abbr||"").trim().toUpperCase()]||String(abbr||"").trim().toLowerCase());
function evaluatePlayer(player,at){
  const position=norm(get(player,"position"));
  const health=norm(get(player,"health_state","healthState"));
  const source=String(get(player,"state_source","stateSource")||"");
  const observed=get(player,"state_source_updated_at","stateSourceUpdatedAt");
  const updated=get(player,"updated_at","updatedAt");
  const observedMs=stamp(observed),updatedMs=stamp(updated);
  const ageHours=Number.isFinite(observedMs)?(at-observedMs)/3600000:null;
  // Persistent state is not license to borrow observations from the future.
  const temporalValid=Number.isFinite(observedMs)&&observedMs<=at&&
    Number.isFinite(updatedMs)&&updatedMs<=at&&
    observedMs<=updatedMs;
  const prolonged=ABSENT.has(health);
  const notCarried=Number(get(player,"carried_state","carriedState")||0)!==1;
  // Current roster presence establishes expected depth, NOT a confirmed game-day active status.
  // Only NFL-official or independent injury feeds can assert an absent player.
  const expectedRoster=temporalValid&&source==="roster-presence"&&health==="AVAILABLE"&&
    ageHours>=0&&ageHours<=48&&notCarried;
  const verified=temporalValid&&VALID_SOURCE.test(source)&&
    ageHours>=0&&ageHours<=(prolonged?14*24:96)&&notCarried;
  const share=num(get(player,"last_known_snap_share","lastKnownSnapShare","last_game_snap_share","lastGameSnapShare"));
  const depth=num(get(player,"depth_rank","depthRank"));
  return {
    id:String(get(player,"player_key","playerKey","player_id","playerId")||""),
    name:String(get(player,"player_name","playerName")||""),
    position,health,source,observedAt:observed||null,
    ageHours:ageHours==null?null:round(ageHours,1),
    depthRank:depth,snapShare:share==null?null:bounded(share,0,1),
    verified,expectedRoster,absent:verified&&ABSENT.has(health),
    uncertain:verified&&UNCERTAIN.has(health),
  };
}
function side(players=[],capturedAt){
  const asOf=stamp(capturedAt);
  const normalized=(players||[]).map(p=>evaluatePlayer(p,asOf));
  const out=normalized.filter(p=>p.absent);
  const doubtful=normalized.filter(p=>p.uncertain);
  const wr=normalized.filter(p=>p.position==="WR")
    .sort((a,b)=>(b.snapShare??-1)-(a.snapShare??-1)||(a.depthRank??99)-(b.depthRank??99));
  // Three high-snap WRs are usually on field, but these are usage proxies, not routes or targets.
  const identifiedWr=wr.filter(p=>p.snapShare!=null);
  const wrCovered=wr.length>=5&&identifiedWr.length>=3&&
    identifiedWr.slice(0,3).every(p=>p.verified||p.expectedRoster);
  const top5=identifiedWr.slice(0,5),top3=top5.slice(0,3);
  const absentTop3=wrCovered?top3.filter(p=>p.absent):[];
  const absentTop5=wrCovered?top5.filter(p=>p.absent):[];
  const wrLost=absentTop5.reduce((s,p)=>s+(p.snapShare??0),0);
  const availableWr=identifiedWr.filter(p=>(p.verified||p.expectedRoster)&&!p.absent&&!p.uncertain);
  const replacementCapacity=availableWr.filter(p=>!top3.includes(p))
    .sort((a,b)=>(b.snapShare??0)-(a.snapShare??0)).slice(0,3)
    .reduce((s,p)=>s+(p.snapShare??0),0);
  // v1.3 research assumption: count simultaneous top-of-depth-chart WR absences,
  // and constrain impact only partially when proven replacements exist.
  const wrPenalty=wrCovered?bounded(
    wrLost*0.80+
    Math.max(0,absentTop3.length-1)*1.10+
    Math.max(0,absentTop5.length-3)*0.70-
    Math.min(0.75,replacementCapacity*0.30),0,5.5):0;
  const support={QB:0,TE:0,RB:0,OL:0,DEF:0};
  for(const p of out){
    if(p.position==="WR")continue;
    const w=p.snapShare??(p.depthRank===1?0.7:0);
    if(p.position==="QB")support.QB+=4.2*w;
    else if(p.position==="TE")support.TE+=0.7*w;
    else if(p.position==="RB"||p.position==="FB")support.RB+=0.45*w;
    else if(["OL","OT","T","G","OG","C","LT","RT","LG","RG"].includes(p.position))support.OL+=0.5*w;
    else if(DEFENSE.has(p.position))support.DEF+=0.40*w;
  }
  const attack=round(bounded(wrPenalty+support.QB+support.TE+support.RB+support.OL,0,7));
  const defense=round(bounded(support.DEF,0,2.5));
  const severeWr=wrCovered&&(absentTop3.length>=2||absentTop5.length>=4);
  const openCritical=doubtful.some(p=>p.position==="QB"||p.position==="WR"&&top3.includes(p));
  const insufficient=normalized.length<12||!wrCovered;
  return {
    rosterRows:normalized.length,verifiedRows:normalized.filter(p=>p.verified).length,
    expectedRosterRows:normalized.filter(p=>p.expectedRoster).length,
    expectedTopWrNotConfirmed:top3.filter(p=>p.expectedRoster).length,
    observedOut:out.length,uncertainCount:doubtful.length,
    topWrRosterCoverage:wr.length,topWrUsageCoverage:identifiedWr.length,wrCovered,
    absentTop3:absentTop3.length,absentTop5:absentTop5.length,
    wrLostSnapProxy:round(wrLost),replacementSnapProxy:round(replacementCapacity),
    severeWrLoss:severeWr,criticalUnresolved:openCritical,
    offensePenalty:attack,defensePenalty:defense,
    status:insufficient?"INCOMPLETE":severeWr?"SEVERE_WR_DEPLETION":openCritical?"LINEUP_UNRESOLVED":"OBSERVED",
    absences:out.map(p=>({name:p.name,position:p.position,depthRank:p.depthRank,snapShare:p.snapShare,observedAt:p.observedAt,source:p.source})).slice(0,18),
    uncertain:doubtful.map(p=>({name:p.name,position:p.position,health:p.health})).slice(0,12),
    replacements:availableWr.filter(p=>!top3.includes(p)).slice(0,3).map(p=>({name:p.name,snapShare:p.snapShare})),
    evidenceTimes:out.map(p=>p.observedAt).filter(Boolean),
    unverifiedOut:normalized.filter(p=>ABSENT.has(p.health)&&!p.verified).length,
    unknownStatusCount:normalized.filter(p=>p.health==="UNKNOWN").length,
  };
}
export function evaluateNflPersonnelResearch({
  gameId,kickoff,capturedAt,baselineFrozenAt,baselineSnapshotId,
  projectedHome,projectedAway,homePlayers=[],awayPlayers=[]
}={}){
  const started=stamp(kickoff),observed=stamp(capturedAt),base=stamp(baselineFrozenAt);
  if(!gameId||!Number.isFinite(started)||!Number.isFinite(observed)||
     !Number.isFinite(base)||!(base<=observed&&observed<started)||
     ![projectedHome,projectedAway].every(v=>num(v)!=null&&num(v)>=3&&num(v)<=65)){
    return {ok:false,reason:"INVALID_PREGAME_TEMPORAL_OR_BASELINE",modelId:NFL_PERSONNEL_MODEL,canQualify:false,canAuthorizeWager:false};
  }
  const home=side(homePlayers,capturedAt),away=side(awayPlayers,capturedAt);
  const warnings=[];
  if(home.status==="INCOMPLETE")warnings.push("HOME_PERSONNEL_COVERAGE_INCOMPLETE");
  if(away.status==="INCOMPLETE")warnings.push("AWAY_PERSONNEL_COVERAGE_INCOMPLETE");
  if(home.unverifiedOut||away.unverifiedOut)warnings.push("UNVERIFIED_OR_STALE_ABSENCE_NOT_COUNTED");
  if(home.expectedTopWrNotConfirmed||away.expectedTopWrNotConfirmed)warnings.push("EXPECTED_ROSTER_NOT_GAME_DAY_CONFIRMED");
  if(home.criticalUnresolved||away.criticalUnresolved)warnings.push("CRITICAL_LINEUP_UNRESOLVED");
  if((started-observed)>72*3600000)warnings.push("BEYOND_FINAL_INJURY_REPORT_WINDOW");
  const qualifiedForResearch=home.status!=="INCOMPLETE"&&away.status!=="INCOMPLETE"&&
    !warnings.includes("BEYOND_FINAL_INJURY_REPORT_WINDOW");
  const baseScore={home:Number(projectedHome),away:Number(projectedAway)};
  const correctionHome=qualifiedForResearch?-home.offensePenalty+0.4*away.defensePenalty:0;
  const correctionAway=qualifiedForResearch?-away.offensePenalty+0.4*home.defensePenalty:0;
  const scores=qualifiedForResearch?{
    home:round(bounded(baseScore.home+correctionHome,3,65)),
    away:round(bounded(baseScore.away+correctionAway,3,65))
  }:null;
  const baseline={...baseScore,margin:round(baseScore.home-baseScore.away),total:round(baseScore.home+baseScore.away),
    snapshotId:baselineSnapshotId||null,frozenAt:baselineFrozenAt};
  const adjusted=scores?{...scores,margin:round(scores.home-scores.away),total:round(scores.home+scores.away)}:null;
  return {
    ok:true,modelId:NFL_PERSONNEL_MODEL,contract:NFL_PERSONNEL_CONTRACT,
    lifecycle:"RESEARCH_SHADOW_ONLY",calibrationStatus:"NOT_VALIDATED",
    capturedAt,kickoff,baseline,adjusted,
    correction:adjusted?{home:round(adjusted.home-baseline.home),away:round(adjusted.away-baseline.away),margin:round(adjusted.margin-baseline.margin)}:null,
    home,away,warnings,
    severePersonnelLoss:home.severeWrLoss||away.severeWrLoss,
    researchEligible:qualifiedForResearch,projectionsProvisional:true,
    assumptions:"EXPLORATORY_COEFFICIENTS_NOT_PROSPECTIVELY_FITTED",
    knownMissingness:"SNAP_SHARES_ARE_NOT_TARGET_SHARES;UNCERTAINTY_NOT_CALIBRATED",
    provenance:{availabilityAsOf:capturedAt,baselineFrozenAt,pointInTime:true,marketUsed:false},
    canQualify:false,canAuthorizeWager:false,changesProductionChampion:false,
  };
}
export async function loadNflPersonnelSlate(db,games=[],capturedAt=new Date().toISOString()){
  if(!db?.prepare)throw Error("NFL_DB_UNBOUND");
  if(!Array.isArray(games)||!games.length)return new Map();
  const keys=[...new Set(games.flatMap(g=>[
    nflPersonnelTeamKey(g.homeAbbr),nflPersonnelTeamKey(g.awayAbbr)
  ]))].filter(Boolean);
  if(keys.length>64)throw Error("PERSONNEL_TOO_MANY_TEAMS");
  const rows=await db.prepare("SELECT player_key,player_name,team_key,position,depth_rank,last_known_snap_share,last_game_snap_share,health_state,practice_state,state_source,state_source_updated_at,updated_at,carried_state FROM nfl_player_profiles WHERE team_key IN ("+keys.map(()=>"?").join(",")+")").bind(...keys).all();
  if(!Array.isArray(rows?.results))throw Error("NFL_PERSONNEL_DB_READ_FAILED");
  const byTeam=new Map(keys.map(k=>[k,[]]));
  for(const p of rows.results){
    const key=String(p.team_key||"").toLowerCase();
    if(byTeam.has(key))byTeam.get(key).push(p);
  }
  const result=new Map();
  for(const game of games){
    result.set(String(game.gameId),evaluateNflPersonnelResearch({
      gameId:String(game.gameId),kickoff:game.kickoff,
      capturedAt,baselineFrozenAt:game.sourceFrozenAt,baselineSnapshotId:game.snapshotId,
      projectedHome:game.projectedHome,projectedAway:game.projectedAway,
      homePlayers:byTeam.get(nflPersonnelTeamKey(game.homeAbbr))||[],
      awayPlayers:byTeam.get(nflPersonnelTeamKey(game.awayAbbr))||[],
    }));
  }
  return result;
}
