/**
 * Research-only NBA/CBB opponent-conditioned empirical possession simulations.
 * Input: verified, regulation-only game possession outcomes, NEVER raw team
 * boxscore estimates or fabricated per-possession points. No sportsbook data.
 *
 * NBA: four 12-minute quarters (48 regulation minutes)
 * CBB: two 20-minute halves (40 regulation minutes)
 *
 * v0.1 samples offense/defense empirical 0-4+ point possession outcomes; it
 * does NOT infer live lineup ownership or claims independent calibration.
 */
import {createHash} from "node:crypto";

export const BASKETBALL_POSSESSION_RESEARCH=Object.freeze({
 nba:Object.freeze({id:"NBA-SDV-EMPIRICAL-POSSESSIONS-SHADOW-v0.1",periods:4,
  periodSeconds:720,minPace:75,maxPace:130,minTeamGames:8,minCurrentSeasonGames:2}),
 cbb:Object.freeze({id:"CBB-SDV-EMPIRICAL-POSSESSIONS-SHADOW-v0.1",periods:2,
  periodSeconds:1200,minPace:45,maxPace:100,minTeamGames:8,minCurrentSeasonGames:3})
});
const finite=x=>typeof x==="number"&&Number.isFinite(x);
const validId=x=>typeof x==="string"&&x.length>0&&x.length<=120;
const time=s=>typeof s==="string"?Date.parse(s):NaN;
const hash=s=>createHash("sha256").update(s).digest("hex");
function reject(message){throw Error(message)}
function clockPeriod(p,config){return Number.isInteger(p)&&p>=1&&p<=config.periods}
export function validateBasketballPossessionGame(game){
 const cfg=BASKETBALL_POSSESSION_RESEARCH[game?.sport];
 if(!cfg||!validId(game.gameId)||!validId(game.homeTeamId)||!validId(game.awayTeamId)||
   game.homeTeamId===game.awayTeamId||!Number.isFinite(time(game.tipoff))||
   !Number.isFinite(time(game.observedAt))||time(game.observedAt)<=time(game.tipoff)||
   game.regulationOnly!==true||game.canAuthorizeWager!==false||
   !/^[a-f0-9]{64}$/i.test(game.sourceFingerprint||"")||
   !Array.isArray(game.possessions)||!game.possessions.length)
   reject("UNVERIFIED_BASKETBALL_POSSESSION_GAME");
 const n={home:0,away:0},s={home:0,away:0};
 let lastPeriod=0,prevSequence=-1;
 const seen=new Set();
 for(const p of game.possessions){
  if(!validId(String(p.id||""))||seen.has(p.id)||
   !clockPeriod(p.period,cfg)||p.period<lastPeriod||
   !Number.isInteger(p.sequence)||p.sequence<=prevSequence||
   !["home","away"].includes(p.offense)||
   !Number.isInteger(p.points)||p.points<0||p.points>6)
   reject("INVALID_BASKETBALL_POSSESSION_SEQUENCE");
  seen.add(p.id);prevSequence=p.sequence;lastPeriod=p.period;
  n[p.offense]++;s[p.offense]+=p.points;
 }
 if(!Number.isInteger(game.homeRegulationScore)||!Number.isInteger(game.awayRegulationScore)||
   s.home!==game.homeRegulationScore||s.away!==game.awayRegulationScore||
   n.home<cfg.minPace||n.home>cfg.maxPace||
   n.away<cfg.minPace||n.away>cfg.maxPace)
  reject("BASKETBALL_POSSESSION_FINAL_OR_PACE_MISMATCH");
 return {...game,homePossessions:n.home,awayPossessions:n.away};
}
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
function rng(seed){
 let x=seed>>>0||1;
 return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296};
}
function seedFrom(s){return parseInt(hash(s).slice(0,8),16)}
function histogram(rows,side,role){
 const h=Array(7).fill(0);
 for(const g of rows){
  for(const p of g.possessions){
   const owner=p.offense==="home"?g.homeTeamId:g.awayTeamId;
   if(owner===side&&role==="offense"||owner!==side&&role==="defense")
    h[p.points]++;
  }
 }
 return h;
}
function teamSamples(rows,team,role){
 return rows.filter(g=>role==="offense"?
  g.homeTeamId===team||g.awayTeamId===team:
  g.homeTeamId===team||g.awayTeamId===team);
}
function opponentHist(rows,team,mode){
 const h=Array(7).fill(0);
 for(const g of rows){
  const side=g.homeTeamId===team?"home":g.awayTeamId===team?"away":null;
  if(!side)continue;
  for(const p of g.possessions){
   if(mode==="offense"&&p.offense===side||mode==="defense"&&p.offense!==side)
    h[p.points]++;
  }
 }
 return h;
}
function blendHistogram(off,def){
 const ot=off.reduce((a,b)=>a+b,0),dt=def.reduce((a,b)=>a+b,0);
 if(ot<100||dt<100)reject("BASKETBALL_POSSESSION_OUTCOME_COVERAGE_LOW");
 // Independent descriptive blend, NOT a fitted matchup coefficient.
 return off.map((n,i)=>.5*n/ot+.5*def[i]/dt);
}
function sampleOutcome(random,cdf){
 const p=random();let total=0;
 for(let i=0;i<cdf.length;i++){total+=cdf[i];if(p<total)return i}
 return cdf.length-1;
}
function summarizeDraws(draws){
 const avg=k=>mean(draws.map(d=>d[k])),n=draws.length;
 const prob=f=>draws.filter(f).length/n;
 return {home:avg("home"),away:avg("away"),total:avg("total"),margin:avg("margin"),
  pace:avg("pace"),homeRegulationWin:prob(x=>x.home>x.away),
  awayRegulationWin:prob(x=>x.away>x.home),regulationTie:prob(x=>x.home===x.away),
  homeBlowout14:prob(x=>x.home-x.away>=14),awayBlowout14:prob(x=>x.away-x.home>=14)};
}
export function simulateBasketballPossessions({
 sport,eventId,homeTeamId,awayTeamId,tipoff,frozenAt,
 season,history,iterations=1000,historyMode="SOURCE_OBSERVED_PRE_FORECAST"
}={}){
 const cfg=BASKETBALL_POSSESSION_RESEARCH[sport];
 if(!cfg||!validId(eventId)||![homeTeamId,awayTeamId].every(validId)||
  homeTeamId===awayTeamId||!Number.isFinite(time(frozenAt))||
  !Number.isFinite(time(tipoff))||time(frozenAt)>=time(tipoff)||
  !Number.isInteger(season)||season<2000||season>2100||
  !Number.isInteger(iterations)||iterations<100||iterations>5000||
  historyMode!=="SOURCE_OBSERVED_PRE_FORECAST"||!Array.isArray(history))
  reject("INVALID_BASKETBALL_SHADOW_REQUEST");
 const training=[],exclusions={},unique=new Set();
 for(const row of history){
  if(row?.sport!==sport)continue;
  const game=validateBasketballPossessionGame(row);
  if(time(game.tipoff)>=time(frozenAt)||time(game.observedAt)>time(frozenAt)||
    game.gameId===eventId){exclusions.NOT_VERIFIABLY_BEFORE_FORECAST=(exclusions.NOT_VERIFIABLY_BEFORE_FORECAST||0)+1;continue}
  if(unique.has(game.gameId))reject("DUPLICATE_BASKETBALL_SOURCE_GAME");
  unique.add(game.gameId);training.push(game);
 }
 training.sort((a,b)=>time(b.tipoff)-time(a.tipoff));
 const h=teamSamples(training,homeTeamId).slice(0,16),a=teamSamples(training,awayTeamId).slice(0,16);
 if(h.length<cfg.minTeamGames||a.length<cfg.minTeamGames)
  reject("BASKETBALL_TEAM_HISTORY_INSUFFICIENT");
 if(sport==="cbb"&&
   (h.filter(g=>g.season===season).length<cfg.minCurrentSeasonGames||
    a.filter(g=>g.season===season).length<cfg.minCurrentSeasonGames))
  reject("CBB_CURRENT_SEASON_ROSTER_ERA_UNVERIFIED");
 const both=new Map([...h,...a].map(g=>[g.gameId,g]));
 const cohort=[...both.values()].sort((x,y)=>x.gameId.localeCompare(y.gameId));
 const homePace=h.map(g=>g.homeTeamId===homeTeamId?g.homePossessions:g.awayPossessions);
 const awayPace=a.map(g=>g.homeTeamId===awayTeamId?g.homePossessions:g.awayPossessions);
 const hp=blendHistogram(opponentHist(h,homeTeamId,"offense"),
   opponentHist(a,awayTeamId,"defense"));
 const ap=blendHistogram(opponentHist(a,awayTeamId,"offense"),
   opponentHist(h,homeTeamId,"defense"));
 const pacePool=[...homePace,...awayPace];
 const fingerprint=hash(JSON.stringify(cohort.map(g=>[g.gameId,g.sourceFingerprint,g.observedAt])));
 const modelId=cfg.id,random=rng(seedFrom([modelId,eventId,homeTeamId,awayTeamId,frozenAt,fingerprint].join("|")));
 const draws=[];
 for(let sim=0;sim<iterations;sim++){
  let pace=pacePool[Math.floor(random()*pacePool.length)];
  pace=Math.min(cfg.maxPace,Math.max(cfg.minPace,pace));
  let home=0,away=0;
  for(let possession=0;possession<pace;possession++){
   home+=sampleOutcome(random,hp);
   away+=sampleOutcome(random,ap);
  }
  draws.push({home,away,margin:home-away,total:home+away,pace});
 }
 return {ok:true,sport,eventId,homeTeamId,awayTeamId,tipoff,
  modelId,modelVersion:"0.1.0",regulationMinutes:cfg.periods*cfg.periodSeconds/60,
  simulatedPaths:iterations,forecastFrozenAt:frozenAt,
  historyObservedBeforeForecast:true,observations:{sourceGames:cohort.length,
   homeTeamGames:h.length,awayTeamGames:a.length,sourceFingerprint:fingerprint},
  distributions:summarizeDraws(draws),exclusions,
  scoringMechanism:"OFFENSE_DEFENSE_EMPIRICAL_POSSESSION_OUTCOME_BLEND",
  paceMechanism:"EMPIRICAL_RECENT_TEAM_PACE_RESAMPLING",
  officialPointInTimeModelFit:false,calibrated:false,prospectiveValidated:false,
  canQualify:false,canAuthorizeWager:false,changesProductionChampion:false};
}
