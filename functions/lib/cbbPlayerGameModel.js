/**
 * CBB-PLAYER-GAME-v1
 *
 * Independent player/rotation features for the CBB game model.
 * Inputs are prior player production, projected minutes, role stability, and
 * availability-like rotation evidence. No sportsbook, PrizePicks, KenPom, or
 * game-market line enters this layer.
 */
import { playersForCbbGame } from "./cbbPlayerFeed.js";

export const CBB_PLAYER_GAME_MODEL_ID = "CBB-PLAYER-GAME-v1";
export const CBB_PLAYER_GAME_VERSION = "v1.0.0";

const n=(v)=>{const x=Number(v);return Number.isFinite(x)?x:null};
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const r=(v,d=4)=>v==null?null:Number(Number(v).toFixed(d));
const weighted=(xs)=>{
  let sx=0,sw=0;
  for(const [x0,w0] of xs){const x=n(x0),w=n(w0);if(x==null||w==null||w<=0)continue;sx+=x*w;sw+=w}
  return sw? sx/sw : null;
};

function playerRate(p,key){
  return n(p?.[key+"Per40"]);
}
function rawProjectedMinutes(p){
  const base=n(p?.projectedMinutes??p?.minutesPerGame)??0;
  const lastDnp=Boolean(p?.role?.lastGameDnp);
  const lastMin=n(p?.role?.lastGameMinutes);
  let m=base;
  if(lastDnp) m*=0.45;
  else if(lastMin!=null&&lastMin<5&&base>12) m*=0.72;
  return clamp(m,0,40);
}
function normalizedRotation(players=[]){
  const rows=(players||[])
    .map(p=>({...p,_rawMinutes:rawProjectedMinutes(p)}))
    .filter(p=>p._rawMinutes>=4)
    .sort((a,b)=>b._rawMinutes-a._rawMinutes)
    .slice(0,12);
  const rawTotal=rows.reduce((s,p)=>s+p._rawMinutes,0);
  const scale=rawTotal>0?200/rawTotal:0;
  return rows.map(p=>({...p,_minutes:clamp(p._rawMinutes*scale,0,40)}));
}
export function buildCbbTeamPlayerState(players=[]){
  const rot=normalizedRotation(players);
  if(!rot.length)return{ok:false,players:0,minutesCoverage:0};
  const minTotal=rot.reduce((s,p)=>s+p._minutes,0)||1;
  const top5=rot.slice(0,5).reduce((s,p)=>s+p._minutes,0);
  const top8=rot.slice(0,8);
  const proxy=(key)=>rot.reduce((s,p)=>{
    const rate=playerRate(p,key);return s+(rate==null?0:rate*p._minutes/40);
  },0);
  const usageWeights=rot.map(p=>{
    const fga=n(p.fieldGoalAttemptsPer40)??0,fta=n(p.freeThrowAttemptsPer40)??0,tov=n(p.turnoversPer40)??0;
    return Math.max(0,fga+0.475*fta+tov);
  });
  const usageTotal=usageWeights.reduce((a,b)=>a+b,0);
  const top3Usage=usageWeights.slice(0,3).reduce((a,b)=>a+b,0);
  const roleConfidence=weighted(rot.map(p=>[p.roleConfidence,p._minutes]));
  const minuteStability=weighted(rot.map(p=>[p?.role?.minuteStability,p._minutes]));
  const recentDnpMinutes=rot.reduce((s,p)=>s+(p?.role?.lastGameDnp?p._minutes:0),0);
  const starterShare=rot.reduce((s,p)=>s+((n(p?.role?.startsRecent)||0)>=3?p._minutes:0),0)/minTotal;
  const experiencedMinutes=rot.reduce((s,p)=>s+Math.min(1,(n(p.sampleSize)||0)/8)*p._minutes,0)/minTotal;
  const efg=weighted(rot.map(p=>[p.effectiveFieldGoalPct,p._minutes]));
  const ts=weighted(rot.map(p=>[p.trueShootingPct,p._minutes]));
  const offRating=weighted(rot.map(p=>[p.offensiveRating,p._minutes]));
  return {
    ok:true,
    players:rot.length,
    projectedMinutes:r(minTotal,2),
    minutesCoverage:r(Math.min(1,minTotal/200),4),
    pointsProxy:r(proxy("points"),4),
    reboundsProxy:r(proxy("rebounds"),4),
    assistsProxy:r(proxy("assists"),4),
    threesProxy:r(proxy("threesMade"),4),
    fgaProxy:r(proxy("fieldGoalAttempts"),4),
    ftaProxy:r(proxy("freeThrowAttempts"),4),
    offensiveReboundProxy:r(proxy("offensiveRebounds"),4),
    defensiveReboundProxy:r(proxy("defensiveRebounds"),4),
    turnoverProxy:r(proxy("turnovers"),4),
    efg:r(efg,5),
    trueShooting:r(ts,5),
    offensiveRating:r(offRating,4),
    top5MinuteShare:r(top5/minTotal,4),
    top3UsageShare:r(usageTotal?top3Usage/usageTotal:null,4),
    roleConfidence:r(roleConfidence,4),
    minuteStability:r(minuteStability,4),
    starterMinuteShare:r(starterShare,4),
    experiencedMinuteShare:r(experiencedMinutes,4),
    recentDnpMinuteShare:r(recentDnpMinutes/minTotal,4),
    topRotation:top8.map(p=>({
      playerId:p.id??null,name:p.name??null,minutes:r(p._minutes,1),
      roleConfidence:r(p.roleConfidence,3),lastGameDnp:Boolean(p?.role?.lastGameDnp)
    })),
  };
}
function diff(a,b,key){const x=n(a?.[key]),y=n(b?.[key]);return x==null||y==null?null:r(x-y,5)}
function sum(a,b,key){const x=n(a?.[key]),y=n(b?.[key]);return x==null||y==null?null:r(x+y,5)}
export function cbbPlayerGameFeatures(home,away){
  const keys=["pointsProxy","reboundsProxy","assistsProxy","threesProxy","fgaProxy","ftaProxy","offensiveReboundProxy","defensiveReboundProxy","turnoverProxy","efg","trueShooting","offensiveRating","top5MinuteShare","top3UsageShare","roleConfidence","minuteStability","starterMinuteShare","experiencedMinuteShare","recentDnpMinuteShare"];
  const out={};
  for(const k of keys){out[k+"Diff"]=diff(home,away,k);out[k+"Sum"]=sum(home,away,k)}
  return out;
}
export function attachCbbPlayerGameResearch(games=[],context={}){
  let available=0;
  const out=(games||[]).map(game=>{
    const bySide=playersForCbbGame(game,context);
    const home=buildCbbTeamPlayerState(bySide.home);
    const away=buildCbbTeamPlayerState(bySide.away);
    const ok=Boolean(home.ok&&away.ok);
    if(ok)available++;
    return {
      ...game,
      cbbPlayerGame:{
        modelId:CBB_PLAYER_GAME_MODEL_ID,
        modelVersion:CBB_PLAYER_GAME_VERSION,
        ok,
        independent:true,
        marketInformed:false,
        home,away,
        features:ok?cbbPlayerGameFeatures(home,away):{},
        canQualify:false,
        canAuthorizeWager:false,
      }
    };
  });
  return {games:out,meta:{modelId:CBB_PLAYER_GAME_MODEL_ID,modelVersion:CBB_PLAYER_GAME_VERSION,games:out.length,available,independent:true,marketInformed:false,canQualify:false,canAuthorizeWager:false}};
}
