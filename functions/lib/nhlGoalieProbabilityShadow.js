import { NHL_GOALIE_PROB_SHADOW_CONFIG as CONFIG } from "../../data/models/nhl-goalie-prob-shadow-v1.js";

export const NHL_GOALIE_PROB_SHADOW_ID=CONFIG.modelId;
export const NHL_GOALIE_PROB_SHADOW_VERSION=CONFIG.version;

function finite(v){if(v==null||v==="")return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function round(v,n=5){const p=10**n;return Math.round(Number(v)*p)/p;}
function poisson(lambda,k){let p=Math.exp(-lambda);for(let i=1;i<=k;i++)p*=lambda/i;return p;}
function scoreHomeWin(h,a){
  const shared=Math.min(0.32,0.10*Math.min(h,a)),lh=Math.max(0.05,h-shared),la=Math.max(0.05,a-shared);
  let hw=0,tie=0,total=0;
  for(let x=0;x<=11;x++)for(let y=0;y<=11;y++)for(let z=0;z<=5;z++){
    const p=poisson(lh,x)*poisson(la,y)*poisson(shared,z),hg=x+z,ag=y+z;total+=p;
    if(hg>ag)hw+=p;else if(hg===ag)tie+=p;
  }
  if(total>0){hw/=total;tie/=total;}
  const ot=1/(1+Math.exp(-(h-a)/0.65));
  return clamp(hw+tie*ot,0.01,0.99);
}
function teamKey(v){const s=String(v||"").toLowerCase();return ({lak:"la",njd:"nj",sjs:"sj",tbl:"tb"})[s]||s;}
function goalieScoreAdjustments(p={}){
  const h=p?.layers?.goalie?.home||{},a=p?.layers?.goalie?.away||{};
  const vsHome=-(finite(a.impactPerShot)||0)*30*(finite(a.reliability)||0);
  const vsAway=-(finite(h.impactPerShot)||0)*30*(finite(h.reliability)||0);
  return {vsHome,vsAway};
}
function persistentState(profiles,team){
  const k=teamKey(team);
  return {
    team:profiles?.teams?.[k]||null,
    players:profiles?.players?.[k]||[],
    goalies:profiles?.goalies?.[k]||[],
    linemates:profiles?.linemates?.[k]||[],
    schedule:profiles?.schedule?.[k]||[],
  };
}
function goalieStarterEvidence(profile={},projectionGoalie={},cutoff=null,start=null){
  const cutoffMs=Date.parse(cutoff||""),startMs=Date.parse(start||"");
  const usable=(profile.goalies||[]).filter(g=>{
    const t=Date.parse(g.source_updated_at||"");
    return Number.isFinite(t)&&Number.isFinite(cutoffMs)&&Number.isFinite(startMs)&&
      t<=cutoffMs&&t<startMs;
  });
  const confirmed=usable.find(g=>String(g.goalie_state||"").toUpperCase()==="CONFIRMED_STARTER")||null;
  const expected=confirmed||usable.slice().sort((a,b)=>(finite(b.expected_start_probability)??-1)-(finite(a.expected_start_probability)??-1))[0]||null;
  return {
    state:confirmed?"CONFIRMED":expected?"PROJECTED":"HISTORICAL_PROXY_UNVERIFIED",
    playerId:expected?.player_id==null?projectionGoalie.goalieId||null:String(expected.player_id),
    expectedStartProbability:confirmed?1:finite(expected?.expected_start_probability),
    evidenceAt:expected?.source_updated_at||null,
    lineupMatched:confirmed?String(confirmed.player_id)===String(projectionGoalie.goalieId):null,
    goalieSelectionState:projectionGoalie.selectionState||null
  };
}
export function projectNhlGoalieProbabilityShadow(game,profiles={}){
  const p=game?.nhlProV2;
  if(!p?.ok)return{ok:false,reason:"NHL_PRO_V2_REQUIRED",modelId:NHL_GOALIE_PROB_SHADOW_ID,mode:"CONTEXT_ONLY",canQualify:false,canAuthorizeWager:false};
  const home=String(game?.home?.abbr||p.home||"").toUpperCase(),away=String(game?.away?.abbr||p.away||"").toUpperCase();
  const adj=goalieScoreAdjustments(p),scale=CONFIG.goalieProbabilityScale;
  const scoreHome=finite(p.projHome),scoreAway=finite(p.projAway),elo=finite(p?.probability?.eloHead);
  if(scoreHome==null||scoreAway==null||elo==null)return{ok:false,reason:"SHADOW_INPUTS_MISSING",modelId:NHL_GOALIE_PROB_SHADOW_ID,mode:"CONTEXT_ONLY",canQualify:false,canAuthorizeWager:false};
  const probabilityHomeMean=scoreHome-adj.vsHome+scale*adj.vsHome;
  const probabilityAwayMean=scoreAway-adj.vsAway+scale*adj.vsAway;
  const raw=scoreHomeWin(probabilityHomeMean,probabilityAwayMean);
  const shadowP=clamp(0.5+0.86*((0.78*raw+0.22*elo)-0.5),0.04,0.96);
  const signal=Math.max(Math.abs(adj.vsHome),Math.abs(adj.vsAway));
  const homeState=persistentState(profiles,home),awayState=persistentState(profiles,away);
  const starterEvidence={
    home:goalieStarterEvidence(homeState,p?.layers?.goalie?.home||{},p.featureCutoffTimestamp,p.gameStart||game.start),
    away:goalieStarterEvidence(awayState,p?.layers?.goalie?.away||{},p.featureCutoffTimestamp,p.gameStart||game.start)
  };
  const stateKnown=Boolean(homeState.team&&awayState.team);
  const gateFired=Boolean(CONFIG.historicalGateValidated&&stateKnown&&signal>=0.03);
  return{
    ok:true,modelId:NHL_GOALIE_PROB_SHADOW_ID,modelVersion:NHL_GOALIE_PROB_SHADOW_VERSION,
    mode:gateFired?"SHADOW":"CONTEXT_ONLY",gateId:CONFIG.gateId,gateFired,historicallyValidated:CONFIG.historicalGateValidated,
    incumbent:{modelId:CONFIG.incumbentModelId,projHome:scoreHome,projAway:scoreAway,homeWinProbability:finite(p?.probability?.homeWinIncludingOt)},
    challenger:{
      projHome:scoreHome,projAway:scoreAway,
      homeWinProbability:round(shadowP,5),awayWinProbability:round(1-shadowP,5),
      probabilityHomeMean:round(probabilityHomeMean,4),probabilityAwayMean:round(probabilityAwayMean,4),
      goalieProbabilityScale:scale,scoreProjectionChanged:false
    },
    goalieSignal:{...adj,maxAbsGoalAdjustment:round(signal,5),homeGoalie:p?.layers?.goalie?.home||null,awayGoalie:p?.layers?.goalie?.away||null},
    starterEvidence,
    persistentState:{home:homeState,away:awayState,featureCutoffTimestamp:p.featureCutoffTimestamp||null},
    historicalEvidence:CONFIG.historicalMetrics,
    marketInformed:false,canQualify:false,canAuthorizeWager:false,stakingAuthorized:false,
    note:"Prospective shadow only. NHL-PRO-v2 score projection remains incumbent; only goalie translation inside the shadow win-probability head is shrunk."
  };
}
export function attachNhlGoalieProbabilityShadow(games=[],profiles={}){
  let shadow=0,contextOnly=0,missing=0;
  const next=(games||[]).map(game=>{
    if(String(game?.sport||"").toLowerCase()!=="nhl")return game;
    const x=projectNhlGoalieProbabilityShadow(game,profiles);
    if(!x.ok)missing++;else if(x.gateFired)shadow++;else contextOnly++;
    return{...game,nhlGoalieProbabilityShadow:x};
  });
  return{games:next,meta:{modelId:NHL_GOALIE_PROB_SHADOW_ID,version:NHL_GOALIE_PROB_SHADOW_VERSION,shadow,contextOnly,missing,mode:"SHADOW",historicallyValidated:true,productionChanged:false,canQualify:false,canAuthorizeWager:false}};
}
