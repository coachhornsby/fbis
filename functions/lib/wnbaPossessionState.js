/**
 * WNBA possession / shot-state research layer.
 *
 * Independent of market data. Research-only until historical ablation and
 * prospective validation demonstrate incremental economic value.
 *
 * Important: ESPN PBP is event data, not an official possession feed.
 * Possessions and transition labels below are deterministic reconstructions
 * with explicit QA/proxy flags.
 */

export const WNBA_POSSESSION_STATE_MODEL_ID = "WNBA-POSSESSION-STATE-v1";
export const WNBA_POSSESSION_STATE_VERSION = "research-v1";

const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const round=(v,d=5)=>{const n=finite(v);if(n==null)return null;const p=10**d;return Math.round(n*p)/p};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const txt=p=>String((p?.type||"")+" "+(p?.text||"")).toLowerCase();

function clockSeconds(clock){
  const m=String(clock||"").match(/(\d+):(\d+(?:\.\d+)?)/);
  return m?Number(m[1])*60+Number(m[2]):null;
}
function periodLength(period){return Number(period||1)<=4?600:300}
function elapsedGame(period,clock){
  const p=Math.max(1,Number(period||1)),remaining=clockSeconds(clock);
  let before=0;
  for(let i=1;i<p;i++) before+=periodLength(i);
  return before+(periodLength(p)-(remaining??periodLength(p)));
}
function otherTeam(team,home,away){
  const t=String(team||"");
  if(t===String(home))return String(away);
  if(t===String(away))return String(home);
  return null;
}

function isFt(p){return /free throw/.test(txt(p))}
function isTurnover(p){return /turnover|lost ball|bad pass|travel|offensive foul/.test(txt(p))}
function isOffRebound(p){return /offensive rebound|off\. rebound|off rebound/.test(txt(p))}
function isRebound(p){return /rebound/.test(txt(p))}
function isDefRebound(p){return isRebound(p)&&!isOffRebound(p)}
function isEndPeriod(p){return /end of|end period|end of quarter|end of game/.test(txt(p))}
function isMade(p){return Boolean(p?.scoringPlay)||(finite(p?.scoreValue)||0)>0||/\bmade\b|\bmakes\b|\bgood\b/.test(txt(p))}
function isThree(p){return (finite(p?.scoreValue)===3)||/3pt|3-pt|3-point|three point|three-point/.test(txt(p))}
function isShot(p){
  if(isFt(p))return false;
  if(p?.shootingPlay)return true;
  return /miss|made|makes|jumper|jump shot|layup|dunk|hook|tip|fadeaway|pullup|pull-up|floating|floater|3pt|3-point|three point/.test(txt(p));
}
function ftIsLast(p){
  const t=txt(p);
  const m=t.match(/(\d+)\s+of\s+(\d+)/);
  if(m)return Number(m[1])===Number(m[2]);
  return /technical free throw|and one|flagrant/.test(t);
}

export function classifyWnbaShot(play={}){
  if(!isShot(play))return null;
  const t=txt(play),three=isThree(play),made=isMade(play);
  let zone="midrange",zoneEvidence="TEXT_INFERRED";
  if(three){
    zone="three";
  }else if(/dunk|layup|alley.?oop|tip.?in|tip shot/.test(t)){
    zone="rim";
  }else if(/hook|floater|floating|paint|driving shot/.test(t)){
    zone="paint";
  }else if(/fadeaway|pullup|pull-up|jump shot|jumper/.test(t)){
    zone="midrange";
  }else{
    zone="two_unknown";
    zoneEvidence="UNRESOLVED_TWO_POINT";
  }
  return {
    zone,made,three,
    zoneEvidence,
    x:finite(play?.coordinate?.x),
    y:finite(play?.coordinate?.y),
  };
}

function shotClockPhase(elapsed){
  const e=finite(elapsed);
  if(e==null)return "unknown";
  if(e<=8)return "early";
  if(e<=16)return "middle";
  return "late";
}
function gameState({period,clock,margin}={}){
  const m=Math.abs(finite(margin)||0),sec=clockSeconds(clock);
  if(Number(period)>=4&&sec!=null&&sec<=300&&m<=5)return "clutch";
  if(m<=5)return "close";
  if(m<=12)return "moderate";
  return "large";
}
function offenseFromEvent(p,current,home,away){
  const team=String(p?.teamId||"");
  if(team){
    if(isTurnover(p)||isOffRebound(p)||isShot(p)||isFt(p))return team;
    if(isDefRebound(p))return otherTeam(team,home,away);
  }
  return current||null;
}
function starterScore(play){
  return {home:finite(play?.homeScore)??0,away:finite(play?.awayScore)??0};
}
function scoreForTeam(score,team,home,away){
  if(String(team)===String(home))return finite(score?.home)??0;
  if(String(team)===String(away))return finite(score?.away)??0;
  return 0;
}
function marginForTeam(score,team,home,away){
  const own=scoreForTeam(score,team,home,away),opp=scoreForTeam(score,otherTeam(team,home,away),home,away);
  return own-opp;
}
function emptyTeam(teamId){
  return {
    teamId:String(teamId||""),
    possessions:0,points:0,fga:0,fgm:0,threePa:0,threePm:0,
    turnovers:0,orb:0,drb:0,fta:0,
    transitionProxyPossessions:0,
    early:{fga:0,fgm:0,points:0,turnovers:0},
    middle:{fga:0,fgm:0,points:0,turnovers:0},
    late:{fga:0,fgm:0,points:0,turnovers:0},
    zones:{
      rim:{a:0,m:0},paint:{a:0,m:0},midrange:{a:0,m:0},three:{a:0,m:0},two_unknown:{a:0,m:0}
    },
    gameState:{
      clutch:{possessions:0,points:0,fga:0,fgm:0},
      close:{possessions:0,points:0,fga:0,fgm:0},
      moderate:{possessions:0,points:0,fga:0,fgm:0},
      large:{possessions:0,points:0,fga:0,fgm:0},
    }
  };
}
function finalizeTeam(s){
  const z=s.zones;
  const rate=k=>s.fga?z[k].a/s.fga:null;
  const pct=k=>z[k].a?z[k].m/z[k].a:null;
  const phase=k=>({
    fga:s[k].fga,fgm:s[k].fgm,points:s[k].points,turnovers:s[k].turnovers,
    fgPct:s[k].fga?s[k].fgm/s[k].fga:null,
    turnoverPerPossession:s.possessions?s[k].turnovers/s.possessions:null,
  });
  return {
    ...s,
    offensiveRating:s.possessions?100*s.points/s.possessions:null,
    efgPct:s.fga?(s.fgm+0.5*s.threePm)/s.fga:null,
    turnoverPct:s.possessions?s.turnovers/s.possessions:null,
    threePointRate:s.fga?s.threePa/s.fga:null,
    ftRate:s.fga?s.fta/s.fga:null,
    transitionProxyRate:s.possessions?s.transitionProxyPossessions/s.possessions:null,
    rimRate:rate("rim"),paintRate:rate("paint"),midrangeRate:rate("midrange"),
    threeRate:rate("three"),unknownTwoRate:rate("two_unknown"),
    rimPct:pct("rim"),paintPct:pct("paint"),midrangePct:pct("midrange"),
    threePct:pct("three"),unknownTwoPct:pct("two_unknown"),
    early:phase("early"),middle:phase("middle"),late:phase("late"),
  };
}

export function reconstructWnbaPossessionState(pbpGame={}){
  const home=String(pbpGame?.homeId||""),away=String(pbpGame?.awayId||"");
  if(!home||!away)return {ok:false,reason:"missing-team-ids"};
  const plays=[...(pbpGame?.plays||[])].sort((a,b)=>{
    const ea=elapsedGame(a.period,a.clock),eb=elapsedGame(b.period,b.clock);
    if(ea!==eb)return ea-eb;
    return (finite(a.sequenceNumber)||0)-(finite(b.sequenceNumber)||0);
  });
  if(!plays.length)return {ok:false,reason:"empty-pbp"};

  const stats=new Map([[home,emptyTeam(home)],[away,emptyTeam(away)]]);
  const possessions=[],shots=[];
  const qa={
    events:plays.length,possessions:0,shots:0,unresolvedShotZones:0,
    possessionsWithoutOffense:0,scoreFallbacks:0,periodBoundaryClosures:0,
    transitionProxyPossessions:0,coordinateShots:0,
  };
  let offense=null,startElapsed=null,segmentElapsed=null,startScore=starterScore(plays[0]),startReason="UNKNOWN",period=null;
  let currentScore={...startScore};

  const open=(p,team,reason)=>{
    offense=String(team||"");
    period=Number(p.period||1);
    startElapsed=elapsedGame(p.period,p.clock);
    segmentElapsed=startElapsed;
    startScore={...currentScore};
    startReason=reason||"UNKNOWN";
  };
  const close=(p,reason)=>{
    if(!offense){qa.possessionsWithoutOffense++;return}
    const endElapsed=elapsedGame(p.period,p.clock);
    const ownStart=scoreForTeam(startScore,offense,home,away);
    const ownEnd=scoreForTeam(currentScore,offense,home,away);
    let points=Math.max(0,ownEnd-ownStart);
    if(points===0&&reason==="MADE_FG"){
      points=clamp(finite(p.scoreValue)??(isThree(p)?3:2),0,4);
      if(points>0)qa.scoreFallbacks++;
    }
    const elapsed=startElapsed!=null&&endElapsed!=null?Math.max(0,endElapsed-startElapsed):null;
    const margin=marginForTeam(startScore,offense,home,away);
    const state=gameState({period,clock:p.clock,margin});
    const transitionProxy=(startReason==="DEF_REBOUND"||startReason==="TURNOVER")&&elapsed!=null&&elapsed<=6;
    const row={
      gameId:String(pbpGame.id||""),date:pbpGame.date||null,start:pbpGame.start||null,
      offenseTeamId:offense,defenseTeamId:otherTeam(offense,home,away),
      period,startClock:plays.find(x=>elapsedGame(x.period,x.clock)===startElapsed)?.clock||null,
      endClock:p.clock||null,startElapsed,endElapsed,elapsed,
      points,reason,startReason,shotClockPhase:shotClockPhase(elapsed),
      gameState:state,marginAtStart:margin,transitionProxy,
      marketInformed:false,
    };
    possessions.push(row);
    qa.possessions++;
    const s=stats.get(offense);
    if(s){
      s.possessions++;s.points+=points;
      if(transitionProxy){s.transitionProxyPossessions++;qa.transitionProxyPossessions++}
      if(s.gameState[state]){s.gameState[state].possessions++;s.gameState[state].points+=points}
    }
    offense=null;startElapsed=null;segmentElapsed=null;startReason="UNKNOWN";period=null;
  };

  for(const p of plays){
    if(finite(p.homeScore)!=null)currentScore.home=finite(p.homeScore);
    if(finite(p.awayScore)!=null)currentScore.away=finite(p.awayScore);

    if(offense&&period!=null&&Number(p.period||period)!==period){
      close(p,"PERIOD_CHANGE");qa.periodBoundaryClosures++;
    }

    const inferred=offenseFromEvent(p,offense,home,away);
    if(!offense&&inferred){
      let reason="EVENT";
      if(isTurnover(p))reason="TURNOVER";
      else if(isDefRebound(p))reason="DEF_REBOUND";
      open(p,inferred,reason);
    }

    const team=String(p.teamId||"");
    if(isShot(p)&&team){
      const s=stats.get(team),shot=classifyWnbaShot(p);
      if(s&&shot){
        const now=elapsedGame(p.period,p.clock);
        const segElapsed=segmentElapsed!=null&&now!=null?Math.max(0,now-segmentElapsed):null;
        const phase=shotClockPhase(segElapsed);
        const margin=marginForTeam(currentScore,team,home,away);
        const state=gameState({period:p.period,clock:p.clock,margin});
        const transitionProxy=(startReason==="DEF_REBOUND"||startReason==="TURNOVER")&&startElapsed!=null&&now!=null&&(now-startElapsed)<=6;
        const player=p.participants?.[0]||{};
        const row={
          gameId:String(pbpGame.id||""),playId:String(p.id||""),teamId:team,
          playerId:String(player.id||""),playerName:player.name||null,
          period:p.period,clock:p.clock,zone:shot.zone,zoneEvidence:shot.zoneEvidence,
          made:shot.made,three:shot.three,x:shot.x,y:shot.y,
          possessionElapsed:startElapsed!=null&&now!=null?Math.max(0,now-startElapsed):null,
          segmentElapsed:segElapsed,shotClockPhase:phase,gameState:state,
          marginAtShot:margin,transitionProxy,
        };
        shots.push(row);qa.shots++;
        if(shot.zone==="two_unknown")qa.unresolvedShotZones++;
        if(shot.x!=null&&shot.y!=null)qa.coordinateShots++;
        s.fga++;if(shot.made)s.fgm++;
        if(shot.three){s.threePa++;if(shot.made)s.threePm++}
        s.zones[shot.zone].a++;if(shot.made)s.zones[shot.zone].m++;
        if(["early","middle","late"].includes(phase)){
          s[phase].fga++;if(shot.made)s[phase].fgm++;
          s[phase].points+=shot.made?(shot.three?3:2):0;
        }
        if(s.gameState[state]){
          s.gameState[state].fga++;if(shot.made)s.gameState[state].fgm++;
        }
      }
    }

    if(isFt(p)&&team){
      const s=stats.get(team);if(s)s.fta++;
    }
    if(isTurnover(p)&&team){
      const s=stats.get(team);
      if(s){
        s.turnovers++;
        const now=elapsedGame(p.period,p.clock),seg=segmentElapsed!=null&&now!=null?Math.max(0,now-segmentElapsed):null;
        const ph=shotClockPhase(seg);if(["early","middle","late"].includes(ph))s[ph].turnovers++;
      }
      if(!offense)open(p,team,"TURNOVER");
      close(p,"TURNOVER");
      continue;
    }
    if(isOffRebound(p)&&team){
      const s=stats.get(team);if(s)s.orb++;
      segmentElapsed=elapsedGame(p.period,p.clock);
      continue;
    }
    if(isDefRebound(p)&&team){
      const s=stats.get(team);if(s)s.drb++;
      if(offense)close(p,"DEF_REBOUND");
      open(p,team,"DEF_REBOUND");
      continue;
    }
    if(isMade(p)&&isShot(p)&&!isFt(p)){
      if(!offense&&team)open(p,team,"SHOT");
      close(p,"MADE_FG");
      continue;
    }
    if(isFt(p)&&ftIsLast(p)&&isMade(p)){
      if(!offense&&team)open(p,team,"FREE_THROW");
      close(p,"MADE_LAST_FT");
      continue;
    }
    if(isEndPeriod(p)){
      if(offense)close(p,"END_PERIOD");
      continue;
    }
  }
  if(offense)close(plays.at(-1),"END_DATA");

  const teams={};
  for(const id of [home,away])teams[id]=finalizeTeam(stats.get(id));

  const homePoss=teams[home].possessions,awayPoss=teams[away].possessions;
  const possAvg=(homePoss+awayPoss)/2;
  const boxPoss=finite(pbpGame?.boxPossessions);
  const possDelta=boxPoss==null?null:possAvg-boxPoss;
  qa.possessionBalanceDelta=Math.abs(homePoss-awayPoss);
  qa.coordinateCoverage=qa.shots?qa.coordinateShots/qa.shots:0;
  qa.zoneResolution=qa.shots?(qa.shots-qa.unresolvedShotZones)/qa.shots:0;
  qa.boxPossessions=boxPoss;
  qa.reconstructedPossessions=round(possAvg);
  qa.boxPossessionDelta=round(possDelta);

  return {
    ok:true,modelId:WNBA_POSSESSION_STATE_MODEL_ID,modelVersion:WNBA_POSSESSION_STATE_VERSION,
    gameId:String(pbpGame.id||""),date:pbpGame.date||null,start:pbpGame.start||null,
    homeTeamId:home,awayTeamId:away,teams,possessions,shots,qa,
    governance:{independent:true,marketInformed:false,canQualify:false,canAuthorize:false,researchOnly:true},
  };
}

export function buildWnbaOpponentShotProfiles(result={}){
  if(!result?.ok)return {};
  const home=result.teams?.[result.homeTeamId],away=result.teams?.[result.awayTeamId];
  if(!home||!away)return {};
  const pick=s=>({
    attempts:s.fga,efgPct:s.efgPct,threePointRate:s.threePointRate,
    rimRate:s.rimRate,paintRate:s.paintRate,midrangeRate:s.midrangeRate,
    threeRate:s.threeRate,unknownTwoRate:s.unknownTwoRate,
    rimPct:s.rimPct,paintPct:s.paintPct,midrangePct:s.midrangePct,threePct:s.threePct,
    transitionProxyRate:s.transitionProxyRate,
    earlyFgPct:s.early?.fgPct,middleFgPct:s.middle?.fgPct,lateFgPct:s.late?.fgPct,
  });
  return {
    [result.homeTeamId]:{shot:pick(home),oppShot:pick(away)},
    [result.awayTeamId]:{shot:pick(away),oppShot:pick(home)},
  };
}
