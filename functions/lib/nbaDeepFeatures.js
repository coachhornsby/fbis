import { projectNbaGame } from "./nbaModel.js";
import { shotProfileEdge, mergeShotProfileFallback, summarizeShotHistory } from "./nbaShotProfile.js";

const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const weighted=(rows,key,halfLife=10)=>{
 let n=0,d=0;
 const xs=[...(rows||[])].sort((a,b)=>Date.parse(b.date||0)-Date.parse(a.date||0));
 xs.forEach((r,i)=>{const v=typeof key==="function"?finite(key(r)):finite(r?.[key]);if(v==null)return;const w=Math.pow(.5,i/halfLife);n+=v*w;d+=w});
 return d?n/d:null;
};
const priorBlend=(v,p,n,k=10)=>v==null?p:p==null?v:v*(n/(n+k))+p*(k/(n+k));
const sum=xs=>xs.reduce((a,b)=>a+(finite(b)||0),0);

export function deepTeamBox(game,side){
 const team=game?.[side]||{},teamId=String(game?.[side+"Id"]||team.id||"");
 const oppSide=side==="home"?"away":"home",opp=game?.[oppSide]||{},oppId=String(game?.[oppSide+"Id"]||opp.id||"");
 const players=(game?.players||[]).filter(p=>String(p.teamId)===teamId);
 const oppPlayers=(game?.players||[]).filter(p=>String(p.teamId)===oppId);
 const agg=(rows,key)=>sum(rows.map(x=>x[key]));
 const fga=finite(team.fga)??agg(players,"fga"),fgm=finite(team.fgm)??agg(players,"fgm");
 const tpa=finite(team.tpa)??agg(players,"tpa"),tpm=finite(team.tpm)??agg(players,"threes");
 const fta=finite(team.fta)??agg(players,"fta"),orb=finite(team.orb)??agg(players,"offensiveRebounds");
 const dreb=finite(team.dreb)??agg(players,"defensiveRebounds"),tov=finite(team.tov)??agg(players,"turnovers");
 const oppDreb=finite(opp.dreb)??agg(oppPlayers,"defensiveRebounds");
 const poss=finite(team.possessions)??finite(game.possessions);
 const efg=fga>0?((fgm||0)+.5*(tpm||0))/fga:null;
 const tovPct=poss>0?tov/poss:null;
 const orbPct=orb!=null&&oppDreb!=null&&(orb+oppDreb)>0?orb/(orb+oppDreb):null;
 const ftRate=fga>0?fta/fga:null;
 return {teamId,abbr:team.abbr||"",fga,fgm,tpa,tpm,fta,orb,dreb,tov,possessions:poss,efg,tovPct,orbPct,ftRate,
   threeRate:fga>0?tpa/fga:null,threePct:tpa>0?tpm/tpa:null,twoPct:(fga-tpa)>0?(fgm-tpm)/(fga-tpa):null};
}

export function teamHistoryRow(game,side,shotProfiles=null){
 const box=deepTeamBox(game,side),oppSide=side==="home"?"away":"home",opp=deepTeamBox(game,oppSide);
 const ownPlayers=(game.players||[]).filter(p=>String(p.teamId)===box.teamId);
 const oppPlayers=(game.players||[]).filter(p=>String(p.teamId)===opp.teamId);
 const ownShot=shotProfiles?.[box.teamId]||mergeShotProfileFallback(box,ownPlayers);
 const oppShot=shotProfiles?.[opp.teamId]||mergeShotProfileFallback(opp,oppPlayers);
 const pointsFor=side==="home"?finite(game.homeScore):finite(game.awayScore);
 const pointsAgainst=side==="home"?finite(game.awayScore):finite(game.homeScore);
 return {
   date:game.start||game.date,gameId:String(game.id),teamId:box.teamId,abbr:box.abbr,
   pointsFor,pointsAgainst,possessions:box.possessions,
   offRtg:box.possessions>0?100*pointsFor/box.possessions:null,
   defRtg:box.possessions>0?100*pointsAgainst/box.possessions:null,
   efg:box.efg,tovPct:box.tovPct,orbPct:box.orbPct,ftRate:box.ftRate,
   oppEfg:opp.efg,oppTovPct:opp.tovPct,oppOrbPct:opp.orbPct,oppFtRate:opp.ftRate,
   threeRate:box.threeRate,threePct:box.threePct,twoPct:box.twoPct,
   oppThreeRate:opp.threeRate,oppThreePct:opp.threePct,oppTwoPct:opp.twoPct,
   shot:ownShot,oppShot,
 };
}

function factorState(history=[],prior={}){
 const n=history.length;
 return {
   n,
   pace:priorBlend(weighted(history,"possessions"),finite(prior.pace)??99.5,n,10),
   offRtg:priorBlend(weighted(history,"offRtg"),finite(prior.offRtg)??114.5,n,12),
   defRtg:priorBlend(weighted(history,"defRtg"),finite(prior.defRtg)??114.5,n,12),
   efg:priorBlend(weighted(history,"efg"),finite(prior.efg)??.56,n,14),
   tov:priorBlend(weighted(history,"tovPct"),finite(prior.tov)??.13,n,14),
   orb:priorBlend(weighted(history,"orbPct"),finite(prior.orb)??.25,n,14),
   ftr:priorBlend(weighted(history,"ftRate"),finite(prior.ftr)??.25,n,14),
   efgAllowed:priorBlend(weighted(history,"oppEfg"),finite(prior.efgAllowed)??.56,n,14),
   tovForced:priorBlend(weighted(history,"oppTovPct"),finite(prior.tovForced)??.13,n,14),
   orbAllowed:priorBlend(weighted(history,"oppOrbPct"),finite(prior.orbAllowed)??.25,n,14),
   ftrAllowed:priorBlend(weighted(history,"oppFtRate"),finite(prior.ftrAllowed)??.25,n,14),
   shot:summarizeShotHistory(history,"for"),
   shotAllowed:summarizeShotHistory(history,"against"),
 };
}
function matchup(off,allowed,league,w=.56){return league+w*((finite(off)??league)-league)+(1-w)*((finite(allowed)??league)-league)}
function lineupValue(ctx={}){
 return {
   offense:finite(ctx.offense)??0,defense:finite(ctx.defense)??0,net:finite(ctx.net)??0,
   continuity:finite(ctx.continuity)??0,minutesKnown:finite(ctx.minutesKnown)??0,
   availabilityVerified:Boolean(ctx.availabilityVerified),
 };
}
function scheduleFeatures(c={}){
 return {
   daysRest:finite(c.daysRest)??3,b2b:c.backToBack||finite(c.daysRest)===0?1:0,
   threeInFour:c.threeInFour?1:0,fourInSix:c.fourInSix?1:0,
   travelMiles:finite(c.travelMiles)??0,timeZonesCrossed:finite(c.timeZonesCrossed)??0,
   altitudeFeet:finite(c.altitudeFeet)??0,longTravel:c.longTravel?1:0,
 };
}
export const NBA_DEEP_FEATURE_NAMES=Object.freeze([
 "v1Margin","v1Total","pace",
 "homeOff","awayOff","homeDef","awayDef",
 "homeEfg","awayEfg","homeTov","awayTov","homeOrb","awayOrb","homeFtr","awayFtr",
 "homeExpectedEfg","awayExpectedEfg","homeExpectedTov","awayExpectedTov","homeExpectedOrb","awayExpectedOrb","homeExpectedFtr","awayExpectedFtr",
 "homeThreeRate","awayThreeRate","homeThreePct","awayThreePct","homeTwoPct","awayTwoPct",
 "homeShotEfg","awayShotEfg","shotEfgDiff","threeRateDiff",
 "restDiff","b2bDiff","threeInFourDiff","fourInSixDiff","travelMilesDiff","tzCrossDiff","altitudeHome","altitudeAway",
 "homeLineupOff","homeLineupDef","homeLineupNet","awayLineupOff","awayLineupDef","awayLineupNet","lineupNetDiff","continuityDiff",
 "efgMatchupDiff","tovMatchupDiff","orbMatchupDiff","ftrMatchupDiff",
 "paceB2bInteraction","altitudeFatigueInteraction","lineupDefenseVsOffense","threeVolumeVsDefense"
]);

export function buildNbaDeepFeatures(game,{
 homeHistory=[],awayHistory=[],homePrior={},awayPrior={},homeSchedule={},awaySchedule={},homeLineup={},awayLineup={},
 homeAvailability=[],awayAvailability=[]
}={}){
 const v1=projectNbaGame(game,{homeHistory,awayHistory,homePrior,awayPrior,homeContext:homeSchedule,awayContext:awaySchedule,homeAvailability,awayAvailability});
 if(!v1.ok)return {ok:false,reason:v1.reason||"incumbent_projection_failed"};
 const h=factorState(homeHistory,homePrior),a=factorState(awayHistory,awayPrior);
 const hs=scheduleFeatures(homeSchedule),as=scheduleFeatures(awaySchedule),hl=lineupValue(homeLineup),al=lineupValue(awayLineup);
 const hEfg=matchup(h.efg,a.efgAllowed,.56),aEfg=matchup(a.efg,h.efgAllowed,.56);
 const hTov=matchup(h.tov,a.tovForced,.13),aTov=matchup(a.tov,h.tovForced,.13);
 const hOrb=matchup(h.orb,a.orbAllowed,.25),aOrb=matchup(a.orb,h.orbAllowed,.25);
 const hFtr=matchup(h.ftr,a.ftrAllowed,.25),aFtr=matchup(a.ftr,h.ftrAllowed,.25);
 const hShot=shotProfileEdge(h.shot,a.shotAllowed),aShot=shotProfileEdge(a.shot,h.shotAllowed);
 const pace=clamp((h.pace+a.pace)/2,91,106);
 const values={
   v1Margin:v1.margin,v1Total:v1.total,pace,
   homeOff:h.offRtg,awayOff:a.offRtg,homeDef:h.defRtg,awayDef:a.defRtg,
   homeEfg:h.efg,awayEfg:a.efg,homeTov:h.tov,awayTov:a.tov,homeOrb:h.orb,awayOrb:a.orb,homeFtr:h.ftr,awayFtr:a.ftr,
   homeExpectedEfg:hEfg,awayExpectedEfg:aEfg,homeExpectedTov:hTov,awayExpectedTov:aTov,homeExpectedOrb:hOrb,awayExpectedOrb:aOrb,homeExpectedFtr:hFtr,awayExpectedFtr:aFtr,
   homeThreeRate:hShot.threeRate,awayThreeRate:aShot.threeRate,homeThreePct:hShot.threePct,awayThreePct:aShot.threePct,homeTwoPct:hShot.twoPct,awayTwoPct:aShot.twoPct,
   homeShotEfg:hShot.expectedEfg,awayShotEfg:aShot.expectedEfg,shotEfgDiff:hShot.expectedEfg-aShot.expectedEfg,threeRateDiff:hShot.threeRate-aShot.threeRate,
   restDiff:hs.daysRest-as.daysRest,b2bDiff:hs.b2b-as.b2b,threeInFourDiff:hs.threeInFour-as.threeInFour,fourInSixDiff:hs.fourInSix-as.fourInSix,
   travelMilesDiff:(hs.travelMiles-as.travelMiles)/1000,tzCrossDiff:hs.timeZonesCrossed-as.timeZonesCrossed,altitudeHome:hs.altitudeFeet/5000,altitudeAway:as.altitudeFeet/5000,
   homeLineupOff:hl.offense,homeLineupDef:hl.defense,homeLineupNet:hl.net,awayLineupOff:al.offense,awayLineupDef:al.defense,awayLineupNet:al.net,
   lineupNetDiff:hl.net-al.net,continuityDiff:hl.continuity-al.continuity,
   efgMatchupDiff:hEfg-aEfg,tovMatchupDiff:aTov-hTov,orbMatchupDiff:hOrb-aOrb,ftrMatchupDiff:hFtr-aFtr,
   paceB2bInteraction:(pace-99.5)*(hs.b2b+as.b2b),
   altitudeFatigueInteraction:(hs.altitudeFeet/5000)*(as.b2b+as.threeInFour+as.longTravel),
   lineupDefenseVsOffense:hl.defense*a.offRtg-al.defense*h.offRtg,
   threeVolumeVsDefense:(hShot.threeRate*(a.shotAllowed.threePct??.36))-(aShot.threeRate*(h.shotAllowed.threePct??.36)),
 };
 const vector=NBA_DEEP_FEATURE_NAMES.map(k=>finite(values[k])??0);
 return {ok:true,vector,values,incumbent:v1,homeState:h,awayState:a,homeShot:hShot,awayShot:aShot,
   schedule:{home:hs,away:as},lineups:{home:hl,away:al},
   provenance:{marketUsed:false,availabilityVerified:hl.availabilityVerified||al.availabilityVerified}};
}
