/**
 * NFL game-specific matchup analysis layer.
 * Deterministic, market-free and fail-closed. It explains each game from PIT
 * features and only applies small research adjustments when evidence is complete.
 */
import { pGreater } from "./metrics.js";
import { clamp, finite, round1 } from "./deepModelCommon.js";

export const NFL_GAME_MATCHUP_ID="NFL-GAME-MATCHUP-v1";
const MAX_SIDE_ADJ=1.5, MAX_MARGIN_ADJ=2.5;

function sf(game,side){return game?.nflFeatures?.[side]||game?.nflDeepInput?.[side]||game?.gameFeatures?.[side]||{};}
function n(o,...ks){for(const k of ks){const v=finite(o?.[k]);if(v!=null)return v;}return null;}
function signal(id,label,homeRaw,awayRaw,scale,cap=1){
  if(homeRaw==null||awayRaw==null)return{id,label,available:false,adjustment:0,evidence:"missing-required-inputs"};
  const raw=(homeRaw-awayRaw)*scale,adjustment=clamp(raw,-cap,cap);
  return{id,label,available:true,homeRaw,awayRaw,adjustment:round1(adjustment),evidence:"point-in-time-team-features"};
}
export function analyzeNflGameMatchup(game={},baseline=game.nflProShadow){
  if(!baseline?.ok)return{ok:false,modelId:NFL_GAME_MATCHUP_ID,reason:"baseline-unavailable",marketInformed:false,canQualify:false};
  const h=sf(game,"home"),a=sf(game,"away");
  const hPressure=n(h,"pressureRateAllowed","pressureAllowed"),aPressure=n(a,"pressureRateAllowed","pressureAllowed");
  const hDefPressure=n(h,"pressureRate","defPressureRate"),aDefPressure=n(a,"pressureRate","defPressureRate");
  const hQbp=n(h,"qbPressureEpa","pressureEpa"),aQbp=n(a,"qbPressureEpa","pressureEpa");
  const hRush=n(h,"rushEpa","rushOffEpa"),aRush=n(a,"rushEpa","rushOffEpa");
  const hRushDef=n(h,"rushEpaAllowed","rushDefEpa"),aRushDef=n(a,"rushEpaAllowed","rushDefEpa");
  const hYoe=n(h,"rushYoePerAtt"),aYoe=n(a,"rushYoePerAtt");
  const hSep=n(h,"receivingSeparation"),aSep=n(a,"receivingSeparation");
  const hYac=n(h,"receivingYacOe"),aYac=n(a,"receivingYacOe");
  const hPassDef=n(h,"passEpaAllowed","passDefEpa"),aPassDef=n(a,"passEpaAllowed","passDefEpa");
  const hExp=n(h,"explosiveRate","explosivePassRate"),aExp=n(a,"explosiveRate","explosivePassRate");
  const hExpDef=n(h,"explosiveRateAllowed","explosivePassRateAllowed"),aExpDef=n(a,"explosiveRateAllowed","explosivePassRateAllowed");
  const hEarly=n(h,"earlyDownEpa","earlyDownOffEpa"),aEarly=n(a,"earlyDownEpa","earlyDownOffEpa");
  const hEarlyDef=n(h,"earlyDownEpaAllowed","earlyDownDefEpa"),aEarlyDef=n(a,"earlyDownEpaAllowed","earlyDownDefEpa");

  const pressureHome=hPressure!=null&&aDefPressure!=null&&hQbp!=null?-(hPressure-aDefPressure)*(1-Math.tanh(hQbp))*5:null;
  const pressureAway=aPressure!=null&&hDefPressure!=null&&aQbp!=null?-(aPressure-hDefPressure)*(1-Math.tanh(aQbp))*5:null;
  const runHome=hRush!=null&&aRushDef!=null&&hYoe!=null?(hRush-aRushDef)*3+hYoe*.18:null;
  const runAway=aRush!=null&&hRushDef!=null&&aYoe!=null?(aRush-hRushDef)*3+aYoe*.18:null;
  const passHome=hSep!=null&&hYac!=null&&aPassDef!=null?(hSep-2.9)*.35+hYac*.12-aPassDef*1.5:null;
  const passAway=aSep!=null&&aYac!=null&&hPassDef!=null?(aSep-2.9)*.35+aYac*.12-hPassDef*1.5:null;
  const expHome=hExp!=null&&aExpDef!=null?(hExp-aExpDef):null,expAway=aExp!=null&&hExpDef!=null?(aExp-hExpDef):null;
  const earlyHome=hEarly!=null&&aEarlyDef!=null?hEarly-aEarlyDef:null,earlyAway=aEarly!=null&&hEarlyDef!=null?aEarly-hEarlyDef:null;

  const signals=[
    signal("pressure","QB pressure × protection/pass rush",pressureHome,pressureAway,1,.8),
    signal("run","Run efficiency/YOE × run defense",runHome,runAway,1,.7),
    signal("coverageRoute","Separation/YAC × pass defense",passHome,passAway,1,.7),
    signal("explosive","Explosive offense × explosive prevention",expHome,expAway,8,.6),
    signal("earlyDown","Early-down efficiency × defense",earlyHome,earlyAway,3,.6),
  ];
  const available=signals.filter(x=>x.available), coverage=available.length/signals.length;
  // Research gate: incomplete evidence explains the game but cannot alter the baseline.
  const evidenceQualified=coverage>=.8;
  const rawAdj=available.reduce((s,x)=>s+x.adjustment,0);
  const marginAdjustment=evidenceQualified?clamp(rawAdj,-MAX_MARGIN_ADJ,MAX_MARGIN_ADJ):0;
  const homeAdjustment=clamp(marginAdjustment/2,-MAX_SIDE_ADJ,MAX_SIDE_ADJ),awayAdjustment=-homeAdjustment;
  const home=round1(baseline.home+homeAdjustment),away=round1(baseline.away+awayAdjustment);
  const margin=round1(home-away),total=round1(home+away);
  const uncertaintyMultiplier=1+(1-coverage)*.12;
  const sigmaMargin=round1((baseline.sigmaMargin||13.8)*uncertaintyMultiplier);
  return{ok:true,modelId:NFL_GAME_MATCHUP_ID,role:"research-overlay",baselineModelId:baseline.modelId,
    baseline:{home:baseline.home,away:baseline.away,margin:baseline.margin,total:baseline.total},
    final:{home,away,margin,total,pHomeWin:pGreater(margin,0,sigmaMargin),sigmaMargin,sigmaTotal:round1((baseline.sigmaTotal||12.8)*uncertaintyMultiplier)},
    adjustment:{home:round1(homeAdjustment),away:round1(awayAdjustment),margin:round1(marginAdjustment),evidenceQualified,cap:MAX_MARGIN_ADJ},
    coverage:{available:available.length,total:signals.length,share:coverage},signals,
    availability:{configured:Boolean(game.availabilityImpact?.configured),criticalUnresolved:Boolean(game.availabilityImpact?.criticalUnresolved),stale:Boolean(game.availabilityImpact?.configured&&game.availabilityImpact?.stale)},
    marketInformed:false,marketUsed:false,canQualify:false,canAuthorizeWager:false};
}
export function attachNflGameMatchups(games=[]){
 let available=0,qualified=0;
 const next=games.map(game=>{if(game.sport&&game.sport!=="nfl")return game;const x=analyzeNflGameMatchup(game,game.nflProShadow);if(x.ok)available++;if(x.adjustment?.evidenceQualified)qualified++;return{...game,nflGameMatchup:x,challengers:{...(game.challengers||{}),[NFL_GAME_MATCHUP_ID]:x}};});
 return{games:next,meta:{modelId:NFL_GAME_MATCHUP_ID,available,evidenceQualified:qualified,games:next.length,marketInformed:false,qualificationAllowed:false}};
}
