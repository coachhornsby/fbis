/**
 * NHL unified full-game moneyline research contract.
 * The three heads remain visible independently until PIT-safe historical
 * validation yields fitted combination coefficients. Never market-informed.
 */
export const NHL_UNIFIED_ML_ID = "NHL-UNIFIED-ML-SHADOW-v1";
export const NHL_UNIFIED_ML_VERSION = "shadow-v1.0-three-head-integrity";

const finite = v => v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;
const probability = v => { const n=finite(v); return n!=null && n>=0 && n<=1 ? n : null; };
const round = (v,n=6) => v==null ? null : Number(v.toFixed(n));
const logit = p => Math.log(Math.max(1e-6,Math.min(1-1e-6,p))/(1-Math.max(1e-6,Math.min(1-1e-6,p))));
const sigmoid = z => z>=0 ? 1/(1+Math.exp(-z)) : Math.exp(z)/(1+Math.exp(z));

export function auditNhlMoneylineProbability(game={}) {
  const p=game.nhlProV2 || game.challengers?.["NHL-PRO-v2"] || null;
  const reasons=[];
  const eventId=game.id==null ? null : String(game.id);
  const home=String(game.home?.abbr||"").toUpperCase();
  const away=String(game.away?.abbr||"").toUpperCase();
  const start=Date.parse(game.start||"");
  const cutoff=p?.featureCutoffTimestamp||p?.dataLineage?.asOf||null;
  const cutoffMs=Date.parse(cutoff||"");
  if(!eventId||!home||!away||home===away) reasons.push("INVALID_EVENT_IDENTITY");
  if(!p?.ok||p.modelId!=="NHL-PRO-v2") reasons.push("INCUMBENT_PROJECTION_MISSING");
  if(p?.eventId!=null && String(p.eventId)!==eventId) reasons.push("PROJECTION_EVENT_MISMATCH");
  if(p?.home!==home||p?.away!==away) reasons.push("HOME_AWAY_IDENTITY_MISMATCH");
  if(!Number.isFinite(start)||!Number.isFinite(cutoffMs)||cutoffMs>=start) reasons.push("PIT_CUTOFF_NOT_VERIFIED");
  if(p?.marketInformed===true) reasons.push("MARKET_INFORMED_PROJECTION");
  const h=finite(p?.projHome),a=finite(p?.projAway);
  if(h==null||a==null||h<=0||a<=0) reasons.push("INVALID_GOAL_MEANS");
  const prob=p?.probability||{};
  const hp=probability(prob.homeWinIncludingOt),ap=probability(prob.awayWinIncludingOt);
  if(hp==null||ap==null||Math.abs(hp+ap-1)>0.00021) reasons.push("INVALID_FULL_GAME_PROBABILITY");
  const hr=probability(prob.homeRegWin),ar=probability(prob.awayRegWin),tie=probability(prob.regulationTie);
  if(hr==null||ar==null||tie==null||Math.abs(hr+ar+tie-1)>0.00035) reasons.push("INVALID_REGULATION_DISTRIBUTION");
  const raw=probability(prob.rawHomeWinIncludingOt);
  const elo=probability(prob.eloHead);
  if(raw==null||elo==null) reasons.push("PROBABILITY_HEAD_LINEAGE_MISSING");
  return {
    ok:reasons.length===0,reasons,eventId,home,away,marketScope:"FULL_GAME_INCLUDING_OT_SHOOTOUT",
    projection:{modelId:p?.modelId||null,modelVersion:p?.modelVersion||null,
      homeGoals:h,awayGoals:a,featureCutoffTimestamp:cutoff,gameStart:game.start||null,
      sourceLineage:p?.dataLineage||null,marketInformed:Boolean(p?.marketInformed)},
    distribution:{family:p?.layers?.distribution?.family||null,
      homeRegWin:hr,awayRegWin:ar,regulationTie:tie,
      rawHomeWinIncludingOt:raw,eloHead:elo},
    incumbent:{homeWinIncludingOt:hp,awayWinIncludingOt:ap},
    calibratedProbabilitySource:"NHL-PRO-v2",
  };
}

function validateFit(fit) {
  if(fit?.status!=="VALIDATED_OUT_OF_TIME"||fit?.marketInformed!==false||
    fit?.marketScope!=="FULL_GAME_INCLUDING_OT_SHOOTOUT"||
    !fit?.trainingEnd||!fit?.testStart||
    !(Date.parse(fit.trainingEnd)<Date.parse(fit.testStart))||
    !Number.isInteger(fit?.testGames)||fit.testGames<200||
    !Array.isArray(fit?.coefficients)||fit.coefficients.length!==4||
    !fit.coefficients.every(Number.isFinite)) return false;
  return true;
}

export function projectNhlUnifiedMoneylineShadow(game={},fit=null) {
  const audit=auditNhlMoneylineProbability(game);
  const p=game.nhlProV2||game.challengers?.["NHL-PRO-v2"]||{};
  const w=p.winnerHead||{};
  const g=game.nhlGoalieProbabilityShadow||{};
  const classifier=probability(w.classifierScore);
  const goalie=probability(g.challenger?.homeWinProbability);
  const independent=probability(audit.incumbent.homeWinIncludingOt);
  const componentIssues=[];
  if(w?.ok!==true||classifier==null||w?.pickSide!=="HOME"&&w?.pickSide!=="AWAY")
    componentIssues.push("DIRECTIONAL_HEAD_UNAVAILABLE");
  if(g?.ok!==true||goalie==null||g?.marketInformed===true)
    componentIssues.push("GOALIE_SHADOW_UNAVAILABLE");
  if(g?.incumbent?.homeWinProbability!=null&&independent!=null&&
    Math.abs(Number(g.incumbent.homeWinProbability)-independent)>0.0003)
    componentIssues.push("GOALIE_SHADOW_INCUMBENT_MISMATCH");
  if(g?.incumbent?.projHome!=null&&Math.abs(Number(g.incumbent.projHome)-Number(p.projHome))>0.011)
    componentIssues.push("GOALIE_SHADOW_SCORE_MISMATCH");
  if(g?.incumbent?.projAway!=null&&Math.abs(Number(g.incumbent.projAway)-Number(p.projAway))>0.011)
    componentIssues.push("GOALIE_SHADOW_SCORE_MISMATCH");
  const ready=audit.ok&&componentIssues.length===0;
  const fitted=validateFit(fit);
  const coefficients=fitted?fit.coefficients:null;
  const features=ready?[logit(independent),logit(classifier),logit(goalie)]:null;
  const z=ready&&coefficients?coefficients[0]+features.reduce((sum,x,i)=>sum+coefficients[i+1]*x,0):null;
  const candidate=z!=null&&Number.isFinite(z)?sigmoid(z):null;
  return {
    ok:ready,modelId:NHL_UNIFIED_ML_ID,modelVersion:NHL_UNIFIED_ML_VERSION,
    mode:"SHADOW",marketScope:"FULL_GAME_INCLUDING_OT_SHOOTOUT",
    eventId:audit.eventId,home:audit.home,away:audit.away,
    probabilityAudit:audit,
    components:{
      proV2:{modelId:p.modelId||null,version:p.modelVersion||null,
        projectedHomeGoals:finite(p.projHome),projectedAwayGoals:finite(p.projAway),
        scoreDerivedHomeProbability:audit.distribution.rawHomeWinIncludingOt,
        eloHomeProbability:audit.distribution.eloHead,
        incumbentHomeProbability:independent},
      winV1:{modelId:w.modelId||null,version:w.modelVersion||null,
        classifierScore:classifier,pick:w.pick||null,pickSide:w.pickSide||null,
        probabilityInterpretation:"UNVALIDATED_CLASSIFIER_SCORE"},
      goalieShadow:{modelId:g.modelId||null,version:g.modelVersion||null,
        homeProbability:goalie,starterEvidence:g.starterEvidence||null,
        status:g.mode||null},
    },
    candidate:{
      homeWinProbability:round(candidate),awayWinProbability:candidate==null?null:round(1-candidate),
      calibrationStatus:!ready?"INPUTS_INVALID":!fitted?"NO_VALIDATED_THREE_HEAD_FIT":"RESEARCH_FIT_ONLY",
      fittedWeights:coefficients,fitVersion:fitted?fit.version||null:null,
      logitFeatures:features,
      independentlyQualified:false,
    },
    reasons:[...audit.reasons,...componentIssues,...(!fitted?["THREE_HEAD_FIT_NOT_VALIDATED"]:[])],
    sourceRole:"PIT_DIAGNOSTIC_RESEARCH_ONLY",
    marketInformed:false,canQualify:false,canAuthorizeWager:false,stakingAuthorized:false,
    projectionChanged:false,incumbentAuthorityChanged:false,
  };
}

export function attachNhlUnifiedMoneylineShadow(games=[],fit=null) {
  let complete=0,incomplete=0;
  const next=games.map(game=>{
    if(String(game?.sport||"").toLowerCase()!=="nhl")return game;
    const shadow=projectNhlUnifiedMoneylineShadow(game,fit);
    if(shadow.ok)complete++;else incomplete++;
    return {...game,nhlUnifiedMoneylineShadow:shadow};
  });
  return {games:next,meta:{modelId:NHL_UNIFIED_ML_ID,version:NHL_UNIFIED_ML_VERSION,
    complete,incomplete,mode:"SHADOW",canQualify:false,canAuthorizeWager:false,
    productionChanged:false}};
}
