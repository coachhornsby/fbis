/**
 * NCAA-enriched CBB possession/lineup aggregation.
 * Source rows are SportsDataverse ncaa_mbb_pbp records derived from stats.ncaa.org.
 * These rows already carry possession ids, on-floor 5-man units, and ESPN game ids.
 */
export const CBB_NCAA_POSSESSION_MODEL_ID="CBB-NCAA-POSSESSION-v1";
export const CBB_NCAA_POSSESSION_MODEL_VERSION="v1.0.0";

const n=v=>{if(v==null||v==="")return null;const x=Number(v);return Number.isFinite(x)?x:null};
const b=v=>v===true||["1","true","t","yes"].includes(String(v||"").toLowerCase());
const key=v=>String(v??"");
const round=(v,d=6)=>v==null?null:Number(Number(v).toFixed(d));
const txt=r=>String(r.event_type||"")+" "+String(r.event_description||"")+" "+String(r.event_result||"");
const lower=r=>txt(r).toLowerCase();
const made=r=>/made|good/.test(String(r.event_result||"").toLowerCase())||/made|good/.test(lower(r));
const isFt=r=>/free throw/.test(lower(r));
const isShot=r=>!isFt(r)&&[2,3].includes(n(r.shot_value));
const isThree=r=>n(r.shot_value)===3;
const isTov=r=>/turnover|travel|bad pass|lost ball|offensive foul/.test(lower(r));
const isOrb=r=>/offensive rebound|off rebound|off\. rebound/.test(lower(r));
const isDrb=r=>/defensive rebound|def rebound|def\. rebound/.test(lower(r));
const isAst=r=>/assist/.test(lower(r))||Boolean(r.assist_player);
const isRim=r=>/dunk|layup|tip|hook/.test(lower(r))||b(r.is_paint);
const isMid=r=>isShot(r)&&!isThree(r)&&!isRim(r);

function ids(r,side){
  const out=[];
  for(let i=1;i<=5;i++){
    const id=r[side+"_"+i+"_player_id"]||r[side+"_"+i+"_clean_name"]||r[side+"_"+i];
    if(id)out.push(String(id));
  }
  return [...new Set(out)].sort();
}
function combos(a,n){
  const out=[]; const rec=(s,c)=>{if(c.length===n){out.push(c.slice());return;}for(let i=s;i<a.length;i++){c.push(a[i]);rec(i+1,c);c.pop();}};
  rec(0,[]); return out;
}
function empty(){
  return {possessions:0,pointsFor:0,pointsAgainst:0,fga:0,fgm:0,threePa:0,threePm:0,fta:0,orb:0,drb:0,turnovers:0,assists:0,
    rimA:0,rimM:0,midA:0,midM:0,early:{shots:0,makes:0,tov:0},middle:{shots:0,makes:0,tov:0},late:{shots:0,makes:0,tov:0},transitionPoss:0};
}
function phase(elapsed){if(elapsed==null)return null;if(elapsed<=10)return"early";if(elapsed<=20)return"middle";return"late";}
function finalize(s){
  return {...s,
    offensiveRating:s.possessions?100*s.pointsFor/s.possessions:null,
    defensiveRating:s.possessions?100*s.pointsAgainst/s.possessions:null,
    netRating:s.possessions?100*(s.pointsFor-s.pointsAgainst)/s.possessions:null,
    efgPct:s.fga?(s.fgm+.5*s.threePm)/s.fga:null,
    tovPct:s.possessions?s.turnovers/s.possessions:null,
    ftr:s.fga?s.fta/s.fga:null,
    orbPctProxy:(s.orb+s.drb)?s.orb/(s.orb+s.drb):null,
    threePointRate:s.fga?s.threePa/s.fga:null,
    rimRate:s.fga?s.rimA/s.fga:null,
    rimFgPct:s.rimA?s.rimM/s.rimA:null,
    midRate:s.fga?s.midA/s.fga:null,
    midFgPct:s.midA?s.midM/s.midA:null,
    transitionRate:s.possessions?s.transitionPoss/s.possessions:null,
    earlyEfgPct:s.early.shots?s.early.makes/s.early.shots:null,
    middleEfgPct:s.middle.shots?s.middle.makes/s.middle.shots:null,
    lateEfgPct:s.late.shots?s.late.makes/s.late.shots:null,
    earlyTovPct:s.possessions?s.early.tov/s.possessions:null,
    middleTovPct:s.possessions?s.middle.tov/s.possessions:null,
    lateTovPct:s.possessions?s.late.tov/s.possessions:null,
  };
}
function addCombo(map,lineup,offense,team,pts){
  if(lineup.length!==5)return;
  for(let z=2;z<=5;z++)for(const c of combos(lineup,z)){
    const k=z+":"+c.join("-");
    const s=map.get(k)||{size:z,players:c,possessions:0,pointsFor:0,pointsAgainst:0};
    s.possessions++;
    if(offense===team)s.pointsFor+=pts; else s.pointsAgainst+=pts;
    map.set(k,s);
  }
}

export function aggregateNcaaCbbGame(rows=[]){
  if(!rows.length)return{ok:false,reason:"empty-game"};
  const first=rows[0];
  const gameId=key(first.espn_game_id||first.contest_id);
  const homeId=key(first.home_espn_team_id||first.home_ncaa_team_id||first.home);
  const awayId=key(first.away_espn_team_id||first.away_ncaa_team_id||first.away);
  if(!homeId||!awayId)return{ok:false,reason:"missing-team-ids"};
  const H=empty(),A=empty(), comboH=new Map(),comboA=new Map();
  const byPoss=new Map();
  let completeLineupPoss=0,subDeviate=0;

  for(const r of rows){
    subDeviate=Math.max(subDeviate,n(r.sub_deviate)||0);
    const pk=String(r.period||"")+"|"+String(r.poss_num||"")+"|"+String(r.poss_team||"");
    if(!byPoss.has(pk))byPoss.set(pk,[]);
    byPoss.get(pk).push(r);
  }

  for(const evs of byPoss.values()){
    if(!evs.length)continue;
    const p0=evs[0], possTeamId=key(p0.poss_team_espn_team_id||p0.poss_team_ncaa_team_id||p0.poss_team);
    if(!possTeamId)continue;
    const off=possTeamId===homeId?H:possTeamId===awayId?A:null;
    const def=possTeamId===homeId?A:possTeamId===awayId?H:null;
    if(!off||!def)continue;
    off.possessions++;
    if(evs.some(r=>b(r.is_transition)))off.transitionPoss++;
    const hs0=n(p0.home_score)??0,as0=n(p0.away_score)??0;
    const plast=evs[evs.length-1],hs1=n(plast.home_score)??hs0,as1=n(plast.away_score)??as0;
    const scoreDelta=Math.max(0,possTeamId===homeId?hs1-hs0:as1-as0);
    const eventPoints=evs.reduce((sum,r)=>{
      const eventTeam=key(r.event_team_espn_team_id||r.event_team_ncaa_team_id||r.event_team);
      if(eventTeam!==possTeamId||!made(r))return sum;
      if(isFt(r))return sum+1;
      const sv=n(r.shot_value);
      return sum+(sv===3?3:sv===2?2:0);
    },0);
    const pts=Math.max(scoreDelta,eventPoints);
    off.pointsFor+=pts; def.pointsAgainst+=pts;

    const homeLine=ids(p0,"home"),awayLine=ids(p0,"away");
    if(homeLine.length===5&&awayLine.length===5)completeLineupPoss++;
    addCombo(comboH,homeLine,possTeamId,homeId,pts);
    addCombo(comboA,awayLine,possTeamId,awayId,pts);

    const startSec=n(p0.game_seconds);
    for(const r of evs){
      const target=key(r.event_team_espn_team_id||r.event_team_ncaa_team_id||r.event_team);
      const s=target===homeId?H:target===awayId?A:null;
      if(!s)continue;
      const elapsed=(startSec!=null&&n(r.game_seconds)!=null)?Math.max(0,n(r.game_seconds)-startSec):null;
      const ph=phase(elapsed);
      if(isShot(r)){
        s.fga++; if(made(r))s.fgm++;
        if(isThree(r)){s.threePa++;if(made(r))s.threePm++;}
        if(isRim(r)){s.rimA++;if(made(r))s.rimM++;}
        else if(isMid(r)){s.midA++;if(made(r))s.midM++;}
        if(ph){s[ph].shots++;if(made(r))s[ph].makes++;}
      } else if(isFt(r)) s.fta++;
      if(isTov(r)){s.turnovers++;if(ph)s[ph].tov++;}
      if(isOrb(r))s.orb++;
      if(isDrb(r))s.drb++;
      if(isAst(r))s.assists++;
    }
  }

  const formatCombos=(map)=>[...map.values()].map(x=>({...x,
    offensiveRating:x.possessions?100*x.pointsFor/x.possessions:null,
    defensiveRating:x.possessions?100*x.pointsAgainst/x.possessions:null,
    netRating:x.possessions?100*(x.pointsFor-x.pointsAgainst)/x.possessions:null,
  })).sort((a,b)=>b.possessions-a.possessions);

  const h=finalize(H),a=finalize(A),hc=formatCombos(comboH),ac=formatCombos(comboA);
  h.combinations=hc;h.topFiveLineups=hc.filter(x=>x.size===5).slice(0,12);
  a.combinations=ac;a.topFiveLineups=ac.filter(x=>x.size===5).slice(0,12);
  const totalPoss=H.possessions+A.possessions;
  const lineupCoverage=totalPoss?completeLineupPoss/totalPoss:0;
  return {
    ok:true,modelId:CBB_NCAA_POSSESSION_MODEL_ID,modelVersion:CBB_NCAA_POSSESSION_MODEL_VERSION,
    gameId,contestId:key(first.contest_id),homeTeamId:homeId,awayTeamId:awayId,homeTeamName:first.home,awayTeamName:first.away,
    teams:{[homeId]:h,[awayId]:a},
    qa:{possessions:totalPoss,completeLineupPoss,lineupCoverage:round(lineupCoverage),subDeviate},
    lineupReliable:lineupCoverage>=.8&&subDeviate===0,
    independent:true,marketInformed:false,canQualify:false,canAuthorizeWager:false,
  };
}

export function cbbNcaaPossessionFeatures(result){
  if(!result?.ok)return{};
  const h=result.teams[result.homeTeamId],a=result.teams[result.awayTeamId];
  const out={}; const keys=["possessions","offensiveRating","defensiveRating","netRating","efgPct","tovPct","ftr","orbPctProxy","threePointRate","rimRate","rimFgPct","midRate","midFgPct","transitionRate","earlyEfgPct","middleEfgPct","lateEfgPct","earlyTovPct","middleTovPct","lateTovPct"];
  for(const k of keys){const x=n(h[k]),y=n(a[k]);out[k+"Diff"]=x==null||y==null?null:round(x-y);out[k+"Sum"]=x==null||y==null?null:round(x+y);}
  const h5=h.topFiveLineups?.[0],a5=a.topFiveLineups?.[0];
  out.topLineupPossessionShareDiff=h5&&a5&&h.possessions&&a.possessions?round(h5.possessions/h.possessions-a5.possessions/a.possessions):null;
  out.topLineupNetDiff=h5?.netRating!=null&&a5?.netRating!=null?round(h5.netRating-a5.netRating):null;
  out.lineupCoverage=result.qa.lineupCoverage;
  out.subDeviate=result.qa.subDeviate;
  return out;
}
