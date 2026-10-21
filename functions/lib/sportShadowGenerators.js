import { runSportSimulationResearch, SPORT_SIM_SPORTS } from "./sportSimulationResearch.js";
/** Research-only sport generators. No model coefficients or live wagering writes. */
const scopes={nfl:"FULL_GAME",cfb:"FULL_GAME",nba:"FULL_GAME",cbb:"FULL_GAME",wnba:"FULL_GAME",mlb:"FULL_GAME",npb:"FULL_GAME",kbo:"FULL_GAME",nhl:"REGULATION",soccer:"REGULATION"};
const num=n=>typeof n==="number"&&Number.isFinite(n);
const stamp=s=>typeof s==="string"&&s?Date.parse(s):NaN;
function residuals(sport,modelId,eventId,rows){
  if(!Array.isArray(rows))throw Error("REFERENCE_ROWS_REQUIRED");
  const byEvent=new Map();
  for(const row of rows){
    if(row.sport!==sport||row.modelId!==modelId||row.eventId===eventId)continue;
    if(row.official!==true||row.prospective!==true||row.identityVerified!==true||row.marketScope!==scopes[sport])continue;
    if(!num(row.predictedHome)||!num(row.predictedAway)||!num(row.actualHome)||!num(row.actualAway))continue;
    const frozen=stamp(row.publishedAt),start=stamp(row.eventStart),graded=stamp(row.settledAt);
    if(!Number.isFinite(frozen)||!Number.isFinite(start)||!Number.isFinite(graded)||frozen>=start||graded<start)continue;
    if(!String(row.eventId||"").trim())continue;
    const old=byEvent.get(row.eventId);
    if(!old||stamp(old.publishedAt)<frozen)byEvent.set(row.eventId,row);
  }
  if(byEvent.size<80)throw Error("INSUFFICIENT_MATCHED_PROSPECTIVE_REFERENCE_EVENTS");
  return [...byEvent.values()].map(r=>[r.actualHome-r.predictedHome,r.actualAway-r.predictedAway]);
}
function pointHome(server,psHome,psAway,random){return random()<(server==="home"?psHome:1-psAway);}
function other(server){return server==="home"?"away":"home";}
function game(server,psHome,psAway,random){
  let h=0,a=0;
  for(let i=0;i<1000;i++){
    if(pointHome(server,psHome,psAway,random))h++;else a++;
    if((h>=4||a>=4)&&Math.abs(h-a)>=2)return h>a?"home":"away";
  }
  throw Error("GAME_LIMIT_REACHED");
}
function tiebreak(first,psHome,psAway,random){
  let h=0,a=0;
  for(let i=0;i<200;i++){
    const server=i===0?first:(Math.floor((i-1)/2)%2===0?other(first):first);
    if(pointHome(server,psHome,psAway,random))h++;else a++;
    if((h>=7||a>=7)&&Math.abs(h-a)>=2)return h>a?"home":"away";
  }
  throw Error("TIEBREAK_LIMIT_REACHED");
}
function tennisSampler(t){
  if(![t.homeServe,t.awayServe].every(v=>num(v)&&v>0&&v<1))throw Error("INVALID_TENNIS_SERVE_RATE");
  if(![3,5].includes(t.bestOf)||!["home","away"].includes(t.firstServer)||t.ruleset!=="STANDARD_6_6_TIEBREAK")throw Error("UNSUPPORTED_TENNIS_FORMAT");
  return ({random})=>{
    let sh=0,sa=0,totalGames=0,server=t.firstServer;
    while(sh<Math.ceil(t.bestOf/2)&&sa<Math.ceil(t.bestOf/2)){
      let gh=0,ga=0;
      for(let i=0;i<13;i++){
        let winner;
        if(gh===6&&ga===6){winner=tiebreak(server,t.homeServe,t.awayServe,random);}
        else winner=game(server,t.homeServe,t.awayServe,random);
        if(winner==="home")gh++;else ga++;
        totalGames++;server=other(server);
        if((gh>=6||ga>=6)&&Math.abs(gh-ga)>=2 || (gh===7||ga===7))break;
      }
      if(gh>ga)sh++;else sa++;
    }
    return {metrics:{home_sets:sh,away_sets:sa,total_games:totalGames,home_wins:Number(sh>sa)}};
  };
}
/** Generates sport outcomes only if the actual model supplied credible inputs. */
export function runShadowSportEvent({
  sport,eventId,modelId,modelVersion,publishedAt,eventStart,evidenceId,marketScope,
  forecast={},referenceRows=[],tennis=null,iterations=1000,seed=73517,
}={}){
  const s=String(sport||"").toLowerCase();
  if(!SPORT_SIM_SPORTS.includes(s))throw Error("UNSUPPORTED_SPORT");
  if(!String(evidenceId||"").trim())throw Error("MISSING_SOURCE_PROVENANCE");
  let simulate,sampleCount=null,method;
  if(s==="tennis"){
    if(marketScope!=="MATCH")throw Error("UNSUPPORTED_TENNIS_MARKET_SCOPE");
    if(tennis?.verified!==true||!String(tennis.provenanceId||"").trim()||
      !Number.isFinite(stamp(tennis.observedAt))||stamp(tennis.observedAt)>stamp(publishedAt))
      throw Error("UNVERIFIED_TENNIS_RATE_SOURCE");
    simulate=tennisSampler(tennis);
    method="TENNIS_POINT_GAME_SET_RESEARCH_V1";
  }else{
    if(marketScope!==scopes[s])throw Error("UNSUPPORTED_MARKET_SCOPE");
    if(!num(forecast.home)||!num(forecast.away)||forecast.home<0||forecast.away<0)throw Error("INVALID_FROZEN_SCORE_PROJECTION");
    const errors=residuals(s,modelId,eventId,referenceRows);sampleCount=errors.length;
    method="SPORT_MATCHED_EMPIRICAL_JOINT_SCORE_RESEARCH_V1";
    simulate=({random})=>{
      const e=errors[Math.floor(random()*errors.length)];
      const home=Math.max(0,Math.round(forecast.home+e[0]));
      const away=Math.max(0,Math.round(forecast.away+e[1]));
      return {metrics:{home_score:home,away_score:away,margin:home-away,total:home+away,
        home_ahead:Number(home>away),tie:Number(home===away)}};
    };
  }
  return {...runSportSimulationResearch({sport:s,eventId,modelId,modelVersion,publishedAt,eventStart,simulate,iterations,seed}),
    marketScope,sourceEvidenceId:evidenceId,referenceGames:sampleCount,method,
    lifecycle:"SHADOW_RESEARCH",canQualify:false,canAuthorizeWager:false};
}
