import { pGreater } from "./metrics.js";

export const NBA_MODEL_ID = "NBA-FBIS-v1";
export const NBA_MODEL_VERSION = "research-v1";
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const round1=v=>Math.round(Number(v)*10)/10;
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const weighted=(rows,key,halfLife=8)=>{
  let num=0,den=0;
  const sorted=[...(rows||[])].sort((a,b)=>Date.parse(b.date||b.start||0)-Date.parse(a.date||a.start||0));
  sorted.forEach((r,i)=>{const v=finite(r?.[key]);if(v==null)return;const w=Math.pow(.5,i/halfLife);num+=v*w;den+=w;});
  return den?num/den:null;
};
export function estimatePossessions(g){
  const fga=finite(g.fga),orb=finite(g.orb),tov=finite(g.tov),fta=finite(g.fta);
  if([fga,orb,tov,fta].some(v=>v==null)) return finite(g.possessions);
  return fga-orb+tov+0.44*fta;
}
export function gameRates(g){
  const poss=estimatePossessions(g);
  const pf=finite(g.pointsFor),pa=finite(g.pointsAgainst);
  if(!poss||pf==null||pa==null)return null;
  return {...g,possessions:poss,offRtg:100*pf/poss,defRtg:100*pa/poss};
}
function priorBlend(current,prior,n,k=12){
  if(current==null)return prior;
  if(prior==null)return current;
  const w=Math.max(0,n)/(Math.max(0,n)+k);
  return current*w+prior*(1-w);
}
function teamState(history=[],prior={}){
  const rows=(history||[]).map(gameRates).filter(Boolean);
  const n=rows.length;
  const pace=priorBlend(weighted(rows,"possessions"),finite(prior.pace)??99.5,n,10);
  const off=priorBlend(weighted(rows,"offRtg"),finite(prior.offRtg)??114.5,n,12);
  const def=priorBlend(weighted(rows,"defRtg"),finite(prior.defRtg)??114.5,n,12);
  const efg=weighted(rows,"efg");
  const tov=weighted(rows,"tovPct");
  const orb=weighted(rows,"orbPct");
  const ftr=weighted(rows,"ftRate");
  return {n,pace,off,def,efg,tov,orb,ftr};
}
function restAdjustment(ctx={}){
  const d=finite(ctx.daysRest);
  let pts=0,pace=0;
  if(d===0){pts-=1.1;pace-=0.8;}
  if(ctx.threeInFour){pts-=0.55;pace-=0.25;}
  if(ctx.fourInSix){pts-=0.45;pace-=0.20;}
  if((finite(ctx.timeZonesCrossed)||0)>=2)pts-=0.25;
  if(ctx.altitudeDestination)pts-=0.20;
  return {pts,pace};
}
function availabilityAdjustment(rows=[]){
  let points=0,unc=0;
  for(const r of rows||[]){
    const impact=Math.max(0,finite(r.impactPoints)??0);
    const s=String(r.status||"").toUpperCase();
    if(s==="OUT") points-=impact;
    else if(s==="DOUBTFUL"){points-=impact*.8;unc+=impact*.25;}
    else if(s==="QUESTIONABLE"){points-=impact*.45;unc+=impact*.45;}
    else if(s==="PROBABLE"){points-=impact*.12;unc+=impact*.15;}
  }
  return {points,unc};
}
export function projectNbaGame(game,{homeHistory=[],awayHistory=[],homePrior={},awayPrior={},homeContext={},awayContext={},homeAvailability=[],awayAvailability=[]}={}){
  const h=teamState(homeHistory,homePrior),a=teamState(awayHistory,awayPrior);
  if(!h.n&&!a.n)return {ok:false,reason:"team-history-missing",modelId:NBA_MODEL_ID};
  const hr=restAdjustment(homeContext),ar=restAdjustment(awayContext);
  const ha=availabilityAdjustment(homeAvailability),aa=availabilityAdjustment(awayAvailability);
  const expectedPoss=clamp(((h.pace+a.pace)/2)+((hr.pace+ar.pace)/2),91,106);
  const league=114.5;
  const hEff=league+(h.off-league)*.56+(a.def-league)*.44;
  const aEff=league+(a.off-league)*.56+(h.def-league)*.44;
  const hca=game?.neutralSite?0:2.2;
  const home=expectedPoss/100*hEff+hca/2+hr.pts+ha.points;
  const away=expectedPoss/100*aEff-hca/2+ar.pts+aa.points;
  const margin=home-away,total=home+away;
  const evidence=Math.min(1,Math.min(h.n,a.n)/16);
  const availabilityUnc=ha.unc+aa.unc;
  const sigmaMargin=clamp(13.4-1.8*evidence+availabilityUnc,11.2,17.5);
  const sigmaTotal=clamp(17.2-1.5*evidence+availabilityUnc*.8,14.8,21.5);
  return {
    ok:true,modelId:NBA_MODEL_ID,modelVersion:NBA_MODEL_VERSION,
    home:round1(home),away:round1(away),margin:round1(margin),total:round1(total),
    expectedPossessions:round1(expectedPoss),pHomeWin:pGreater(margin,0,sigmaMargin),
    sigmaMargin:round1(sigmaMargin),sigmaTotal:round1(sigmaTotal),
    independent:true,marketInformed:false,maturity:"RESEARCH",canQualify:false,canAuthorize:false,
    decomposition:{home:h,away:a,homeRest:hr,awayRest:ar,homeAvailability:ha,awayAvailability:aa,hca},
    provenance:{marketUsed:false,featureCutoff:game?.featureCutoff||null}
  };
}
export function scheduleContext(games=[],target,index,side){
  const team=String(target?.[side]?.id||target?.[side+"Id"]||target?.[side+"Team"]||"");
  const start=Date.parse(target.start||target.date||0);
  const prior=(games||[]).filter((g,i)=>i<index&&[g.homeId,g.awayId,String(g.home?.id||""),String(g.away?.id||"")].includes(team))
    .sort((x,y)=>Date.parse(y.start||y.date||0)-Date.parse(x.start||x.date||0));
  const prev=prior[0]; const prev3=prior.slice(0,3);
  const daysRest=prev?Math.max(0,Math.floor((start-Date.parse(prev.start||prev.date))/86400000)-1):3;
  const in4=prev3.filter(g=>start-Date.parse(g.start||g.date)<=4*86400000).length>=2;
  const in6=prev3.filter(g=>start-Date.parse(g.start||g.date)<=6*86400000).length>=3;
  return {daysRest,threeInFour:in4,fourInSix:in6};
}
