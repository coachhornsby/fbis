import { projectNbaGame } from "./nbaModel.js";
import { buildNbaScheduleContext } from "./nbaTravelContext.js";
import { impactAvailabilityPoints } from "./nbaPlayerImpact.js";
import { pGreater } from "./metrics.js";

export const NBA_PROFILE_MODEL_ID="NBA-FBIS-v1-PROFILE";
export const NBA_PROFILE_MODEL_VERSION="prospective-v1";
const finite=v=>{if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const round=(v,d=4)=>{const n=finite(v);if(n==null)return null;const p=10**d;return Math.round(n*p)/p};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function teamProfileOverlay(teamId,impact={}){
 const roster=Object.values(impact.players||{}).filter(p=>String(p.teamId||"")===String(teamId));
 const unavailable=new Map();
 for(const p of roster){
   const rc=impact.roleContexts?.[String(p.playerId||p.id)]||{};
   for(const u of rc.unavailable||[])unavailable.set(String(u.playerId),u);
 }
 let availabilityPoints=0,lostMinutes=0,replacementMinutes=0,usageRedistribution=0,lineupStrength=0;
 const rows=[];
 for(const p of roster){
   const id=String(p.playerId||p.id),u=unavailable.get(id),rc=impact.roleContexts?.[id]||{};
   const base=finite(p.skill?.minutes)||0,delta=Math.max(0,finite(rc.role?.minutesDelta)||0);
   const status=String(u?.status||"AVAILABLE").toUpperCase();
   const miss=status==="OUT"?1:status==="DOUBTFUL"?0.8:status==="QUESTIONABLE"?0.45:status==="PROBABLE"?0.12:0;
   if(miss){availabilityPoints-=Math.max(0,impactAvailabilityPoints(p,status)||0);lostMinutes+=base*miss;}
   replacementMinutes+=delta;
   usageRedistribution+=Math.max(0,(finite(rc.role?.usageMultiplier)||1)-1)*Math.max(base,1)/48;
   lineupStrength+=(finite(rc.lineup?.netDelta)||0)*Math.max(base+delta,0)/240;
   rows.push({playerId:id,status,baseMinutes:round(base),replacementMinutes:round(delta),usageMultiplier:round(rc.role?.usageMultiplier||1),lineupNetDelta:round(rc.lineup?.netDelta||0)});
 }
 return {availabilityPoints:round(availabilityPoints),lostMinutes:round(lostMinutes),replacementMinutes:round(replacementMinutes),usageRedistribution:round(usageRedistribution),lineupStrength:round(lineupStrength),players:rows};
}
function overlayAdjustment(o={}){
 // Explicit, bounded research overlay. No market inputs and no v2 Four-Factor/shot/nonlinear features.
 const availability=finite(o.availabilityPoints)||0;
 const replacement=clamp((finite(o.replacementMinutes)||0)*.012,0,.45);
 const usage=clamp((finite(o.usageRedistribution)||0)*.08,0,.35);
 const lineup=clamp((finite(o.lineupStrength)||0)*.08,-.45,.45);
 return {availability, replacementMinutes:round(replacement), usageRedistribution:round(usage), lineupStrength:round(lineup),
   total:round(availability+replacement+usage+lineup)};
}
export function projectNbaProfileGame(game,{homeHistory=[],awayHistory=[],impact={},sequence=[]}={}){
 const idx=sequence.length-1;
 const hs=buildNbaScheduleContext(sequence,game,idx,"home"),as=buildNbaScheduleContext(sequence,game,idx,"away");
 const base=projectNbaGame(game,{homeHistory,awayHistory,homeContext:hs,awayContext:as});
 if(!base.ok)return base;
 const hp=teamProfileOverlay(game.homeId,impact),ap=teamProfileOverlay(game.awayId,impact);
 const ha=overlayAdjustment(hp),aa=overlayAdjustment(ap);
 const home=base.home+ha.total,away=base.away+aa.total,margin=home-away,total=home+away;
 const scheduleDecomp={home:{rest:hs.daysRest,b2b:hs.backToBack,threeInFour:hs.threeInFour,fourInSix:hs.fourInSix,travelMiles:hs.travelMiles,timeZonesCrossed:hs.timeZonesCrossed,altitude:hs.altitudeDestination},
   away:{rest:as.daysRest,b2b:as.backToBack,threeInFour:as.threeInFour,fourInSix:as.fourInSix,travelMiles:as.travelMiles,timeZonesCrossed:as.timeZonesCrossed,altitude:as.altitudeDestination}};
 return {...base,modelId:NBA_PROFILE_MODEL_ID,modelVersion:NBA_PROFILE_MODEL_VERSION,home:round(home,1),away:round(away,1),margin:round(margin,1),total:round(total,1),
   pHomeWin:pGreater(margin,0,base.sigmaMargin), maturity:"CHALLENGER",canQualify:false,canAuthorize:false,
   profileOverlay:{home:{...hp,adjustment:ha},away:{...ap,adjustment:aa},schedule:scheduleDecomp},
   provenance:{...base.provenance,marketUsed:false,profileOverlay:true}};
}
