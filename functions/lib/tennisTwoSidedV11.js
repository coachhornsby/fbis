/**
 * TENNIS-FBIS-v1.1-DEEP / TENNIS-PLAYER-v1.1-DEEP
 *
 * Research-only opponent-adjusted tennis feature engine.
 * Every rate is estimated from both sides of the matchup, surface-specific history,
 * all-surface history, and recency. Market data is never an input.
 */
import { simulateTennisMatch } from "./tennisFbisV1.js";

export const TENNIS_DEEP_MATCH_MODEL_ID="TENNIS-FBIS-v1.1-DEEP";
export const TENNIS_DEEP_PLAYER_MODEL_ID="TENNIS-PLAYER-v1.1-DEEP";
export const TENNIS_DEEP_VERSION="v1.1-two-sided-surface-recency";

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const logit=p=>Math.log(clamp(p,1e-5,1-1e-5)/(1-clamp(p,1e-5,1-1e-5)));
const logistic=z=>1/(1+Math.exp(-z));
const surfaceKey=s=>{
  s=String(s||"hard").toLowerCase();
  return s.includes("clay")?"clay":s.includes("grass")?"grass":"hard";
};
const empty=()=>({
  matches:0,svpt:0,firstIn:0,firstWon:0,secondWon:0,ace:0,df:0,serviceGames:0,
  bpSaved:0,bpFaced:0,returnPts:0,returnWon:0,returnFirstPts:0,returnFirstWon:0,
  returnSecondPts:0,returnSecondWon:0,acesAllowed:0,dfsReceived:0,
  returnGames:0,bpCreated:0,bpWon:0,
});
const priors={
  atp:{firstIn:.62,firstWon:.72,secondWon:.52,serveWon:.64,ace:.075,df:.035,
    returnWon:.36,returnFirstWon:.28,returnSecondWon:.48,aceAllowed:.075,dfReceived:.035,
    bpSave:.62,bpConvert:.38,bpFacedPerGame:.28,servicePointsPerGame:6.4},
  wta:{firstIn:.64,firstWon:.66,secondWon:.48,serveWon:.59,ace:.045,df:.045,
    returnWon:.41,returnFirstWon:.34,returnSecondWon:.52,aceAllowed:.045,dfReceived:.045,
    bpSave:.58,bpConvert:.42,bpFacedPerGame:.34,servicePointsPerGame:6.6},
};
function ratio(n,d,fallback){return d>0?n/d:fallback}
function shrink(rate,n,prior,k){const w=n/(n+k);return prior*(1-w)+rate*w}
function mixSurface(surfaceRate,surfaceN,overallRate,overallN,prior){
  const s=shrink(surfaceRate,surfaceN,overallRate,Math.max(100,surfaceN<100?100:220));
  return shrink(s,surfaceN,prior,55);
}
function twoSided(off,allow,base,wo=.62,wd=.38){
  return logistic(logit(base)+wo*(logit(off)-logit(base))+wd*(logit(allow)-logit(base)));
}
function weightedRecent(longRate,recentRate,recentN){
  const w=Math.min(.35,recentN/250);
  return clamp(longRate*(1-w)+recentRate*w,1e-5,1-1e-5);
}
function mergeBucket(dst,src,weight=1){
  for(const [k,v] of Object.entries(src||{})){
    if(k==="matches")dst[k]+=(finite(v)||0)*weight;
    else if(typeof v==="number")dst[k]+=(finite(v)||0)*weight;
  }
}
function statPack(row,side){
  const o=side==="w"?"l":"w";
  const v=k=>finite(row[`${side}_${k}`]);
  const ov=k=>finite(row[`${o}_${k}`]);
  const svpt=v("svpt"),firstIn=v("1stIn"),firstWon=v("1stWon"),secondWon=v("2ndWon"),
    ace=v("ace"),df=v("df"),serviceGames=v("SvGms"),bpSaved=v("bpSaved"),bpFaced=v("bpFaced");
  const osvpt=ov("svpt"),ofirstIn=ov("1stIn"),ofirstWon=ov("1stWon"),osecondWon=ov("2ndWon"),
    oace=ov("ace"),odf=ov("df"),oserviceGames=ov("SvGms"),obpSaved=ov("bpSaved"),obpFaced=ov("bpFaced");
  if([svpt,firstIn,firstWon,secondWon,ace,df,serviceGames,bpSaved,bpFaced,
      osvpt,ofirstIn,ofirstWon,osecondWon,oace,odf,oserviceGames,obpSaved,obpFaced].some(x=>x==null)) return null;
  const secondPts=Math.max(0,svpt-firstIn),osecondPts=Math.max(0,osvpt-ofirstIn);
  return {
    matches:1,svpt,firstIn,firstWon,secondWon,ace,df,serviceGames,bpSaved,bpFaced,
    returnPts:osvpt,returnWon:Math.max(0,osvpt-(ofirstWon+osecondWon)),
    returnFirstPts:ofirstIn,returnFirstWon:Math.max(0,ofirstIn-ofirstWon),
    returnSecondPts:osecondPts,returnSecondWon:Math.max(0,osecondPts-osecondWon),
    acesAllowed:oace,dfsReceived:odf,returnGames:oserviceGames,bpCreated:obpFaced,
    bpWon:Math.max(0,obpFaced-obpSaved),
  };
}
function idOf(row,side){return String(row[`${side}_id`]||row[`${side}_name`]||"").trim()}

export class TennisDeepState{
  constructor(tour="atp"){this.tour=tour==="wta"?"wta":"atp";this.players=new Map();}
  player(id){
    if(!this.players.has(id))this.players.set(id,{
      overall:empty(),surface:{hard:empty(),clay:empty(),grass:empty()},
      recent:empty(),elo:1500,surfaceElo:{hard:1500,clay:1500,grass:1500},
    });
    return this.players.get(id);
  }
  update(row,surfaceRaw){
    const surface=surfaceKey(surfaceRaw),wi=idOf(row,"winner"),li=idOf(row,"loser");
    if(!wi||!li)return;
    const wp=this.player(wi),lp=this.player(li);
    const ew=1/(1+10**((lp.elo-wp.elo)/400)),k=24;
    wp.elo+=k*(1-ew);lp.elo-=k*ew;
    const ws=wp.surfaceElo[surface],ls=lp.surfaceElo[surface],es=1/(1+10**((ls-ws)/400));
    wp.surfaceElo[surface]+=28*(1-es);lp.surfaceElo[surface]-=28*es;
    for(const [side,p] of [["w",wp],["l",lp]]){
      const pack=statPack(row,side); if(!pack)continue;
      mergeBucket(p.overall,pack);mergeBucket(p.surface[surface],pack);
      // Recency EWMA represented as decayed counting totals: half-life roughly 20 matches.
      for(const key of Object.keys(p.recent))p.recent[key]*=.965;
      mergeBucket(p.recent,pack);
    }
  }
  profile(id,name,surfaceRaw){
    const surface=surfaceKey(surfaceRaw),p=this.player(id),P=priors[this.tour],o=p.overall,s=p.surface[surface],r=p.recent;
    const rate=(num,den,prior)=>{
      const or=ratio(o[num],o[den],prior),sr=ratio(s[num],s[den],or),rr=ratio(r[num],r[den],or);
      return weightedRecent(mixSurface(sr,s[den],or,o[den],prior),rr,r[den]);
    };
    const countRate=(num,den,prior)=>{
      const or=ratio(o[num],o[den],prior),sr=ratio(s[num],s[den],or),rr=ratio(r[num],r[den],or);
      const sw=s[den]/(s[den]+75), base=or*(1-sw)+sr*sw;
      const rw=Math.min(.30,r[den]/300);
      return Math.max(0,base*(1-rw)+rr*rw);
    };
    const firstIn=rate("firstIn","svpt",P.firstIn);
    const firstWon=rate("firstWon","firstIn",P.firstWon);
    const secondWon=rate("secondWon","svpt",P.secondWon); // corrected below using second-point count
    const overallSecondPts=Math.max(0,o.svpt-o.firstIn),surfaceSecondPts=Math.max(0,s.svpt-s.firstIn),recentSecondPts=Math.max(0,r.svpt-r.firstIn);
    const secondWonRate=weightedRecent(
      mixSurface(ratio(s.secondWon,surfaceSecondPts,P.secondWon),surfaceSecondPts,ratio(o.secondWon,overallSecondPts,P.secondWon),overallSecondPts,P.secondWon),
      ratio(r.secondWon,recentSecondPts,P.secondWon),recentSecondPts
    );
    const returnFirstWon=rate("returnFirstWon","returnFirstPts",P.returnFirstWon);
    const returnSecondWon=rate("returnSecondWon","returnSecondPts",P.returnSecondWon);
    return {
      id,name,historyMatches:o.matches,surfaceMatches:s.matches,
      overallServiceGames:o.serviceGames,surfaceServiceGames:s.serviceGames,
      _profileType:"historical",_sampleMatches:s.matches,
      elo:p.elo,surfaceElo:{[surface]:p.surfaceElo[surface]},
      firstServeIn:firstIn,firstServeWin:firstWon,secondServeWin:secondWonRate,
      servePointWin:firstIn*firstWon+(1-firstIn)*secondWonRate,
      aceRate:rate("ace","svpt",P.ace),doubleFaultRate:rate("df","svpt",P.df),
      bpSaveRate:rate("bpSaved","bpFaced",P.bpSave),
      bpFacedPerServiceGame:countRate("bpFaced","serviceGames",P.bpFacedPerGame),
      servicePointsPerGame:countRate("svpt","serviceGames",P.servicePointsPerGame),
      returnPointWin:rate("returnWon","returnPts",P.returnWon),
      returnFirstWin:returnFirstWon,returnSecondWin:returnSecondWon,
      aceAllowedRate:rate("acesAllowed","returnPts",P.aceAllowed),
      dfReceivedRate:rate("dfsReceived","returnPts",P.dfReceived),
      bpCreatePerReturnGame:countRate("bpCreated","returnGames",P.bpFacedPerGame),
      bpConvertRate:rate("bpWon","bpCreated",P.bpConvert),
      surface,
    };
  }
}

export function deepMatchupProfiles(p1,p2,{tour="atp",surface="hard"}={}){
  const P=priors[tour==="wta"?"wta":"atp"];
  const build=(server,receiver)=>{
    const firstIn=server.firstServeIn;
    const firstWin=twoSided(server.firstServeWin,1-receiver.returnFirstWin,P.firstWon,.65,.35);
    const secondWin=twoSided(server.secondServeWin,1-receiver.returnSecondWin,P.secondWon,.62,.38);
    const serveComposite=firstIn*firstWin+(1-firstIn)*secondWin;
    const ace=twoSided(server.aceRate,receiver.aceAllowedRate,P.ace,.64,.36);
    const df=twoSided(server.doubleFaultRate,receiver.dfReceivedRate,P.df,.78,.22);
    const bpSave=twoSided(server.bpSaveRate,1-receiver.bpConvertRate,P.bpSave,.62,.38);
    const bpPressure=twoSided(server.bpFacedPerServiceGame,receiver.bpCreatePerReturnGame,P.bpFacedPerGame,.50,.50);
    // Break-point pressure/save modifies the neutral point estimate modestly rather than double counting.
    const pressureAdj=clamp((bpSave-P.bpSave)*.08-(bpPressure-P.bpFacedPerGame)*.025,-.02,.02);
    const pServe=clamp(serveComposite+pressureAdj,.46,.79);
    return {
      ...server,
      servePointWinPct:pServe,
      matchupServePointWinPct:pServe,
      returnPointWinPct:server.returnPointWin,
      aceRate:clamp(ace,.002,.25),
      doubleFaultRate:clamp(df,.002,.18),
      deepDiagnostics:{
        firstServeIn:firstIn,firstServeWin:firstWin,secondServeWin:secondWin,
        rawServeComposite:serveComposite,bpSave,bpPressure,
        serverAceRate:server.aceRate,receiverAceAllowedRate:receiver.aceAllowedRate,
        serverDfRate:server.doubleFaultRate,receiverDfReceivedRate:receiver.dfReceivedRate,
        serverReturnPointWin:server.returnPointWin,opponentServePointWin:receiver.servePointWin,
        surface:surfaceKey(surface),tour,
      }
    };
  };
  return [build(p1,p2),build(p2,p1)];
}

export function simulateTennisDeepV11(game={},ctx={},opts={}){
  const [p1,p2]=deepMatchupProfiles(game.player1,game.player2,{tour:game.tour||ctx.tour||"atp",surface:game.surface||ctx.surface||"hard"});
  const projection=simulateTennisMatch({...game,player1:p1,player2:p2},ctx,opts);
  return {
    ...projection,
    modelId:TENNIS_DEEP_MATCH_MODEL_ID,
    modelVersion:TENNIS_DEEP_VERSION,
    deep:true,
    matchupProfiles:[p1,p2],
    playerModelId:TENNIS_DEEP_PLAYER_MODEL_ID,
    canQualify:false,canAuthorizeWager:false,decisionEligible:false,
  };
}

export function deepPropDiagnostics(projection={}){
  return (projection.matchupProfiles||[]).map((p,i)=>({
    playerIndex:i,
    ace:{forRate:p.deepDiagnostics?.serverAceRate,opponentAllowedRate:p.deepDiagnostics?.receiverAceAllowedRate,matchupRate:p.aceRate},
    doubleFault:{forRate:p.deepDiagnostics?.serverDfRate,opponentReceivedRate:p.deepDiagnostics?.receiverDfReceivedRate,matchupRate:p.doubleFaultRate},
    serve:{
      firstServeIn:p.deepDiagnostics?.firstServeIn,
      firstServeWon:p.deepDiagnostics?.firstServeWin,
      secondServeWon:p.deepDiagnostics?.secondServeWin,
      pointWin:p.servePointWinPct,
      bpSave:p.deepDiagnostics?.bpSave,
      bpPressure:p.deepDiagnostics?.bpPressure,
    }
  }));
}
