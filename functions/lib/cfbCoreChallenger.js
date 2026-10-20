/**
 * CFB-CORE-SHADOW-v1: independently trained, research-only CORE challenger.
 *
 * CORE offense/defense are opponent-relative per-100-play ratings. They are
 * DIFFERENT from per-play PPA/EPA and cannot be treated as score-point deltas.
 * No coefficients live here: they must originate from temporal OOS research.
 * This module never reads market odds or authorizes qualification/wagers.
 *
 * Accepted CORE sources (point-in-time):
 *   - CFBD `/ratings/core` (optional external overlay)
 *   - FBIS weekly training documents (`fbis_weekly_training_document`)
 */
export const CFB_CORE_SHADOW_ID = "CFB-CORE-SHADOW-v1";
export const CFB_CORE_FEATURE_KEYS = Object.freeze([
  "baselineMargin", "baselineTotal", "coreCrossMargin", "coreCrossTotal",
]);
/** Endpoints that may supply PIT CORE offense/defense for Model C vectors. */
export const CFB_CORE_ALLOWED_SOURCE_ENDPOINTS = Object.freeze([
  "/ratings/core",
  "fbis_weekly_training_document",
]);
const num = v => v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
const invalid = (reason, diagnostics = {}) => ({
  modelId: CFB_CORE_SHADOW_ID, ok: false, reason, diagnostics,
  authority: "research_only", marketInformed: false,
  canQualify: false, canAuthorizeWager: false, canInfluenceProduction: false,
});
const coreField = (x, field) => num(x?.[field] ?? x?.coreRow?.[field === "coreYear" ? "year" :
  field === "coreThroughWeek" ? "throughWeek" :
  field === "coreOffense" ? "offense" : field === "coreDefense" ? "defense" : field]);
const sourceDate = x => x?.coreSourceAsOf ?? x?.snapshotAsOf ?? x?.asOf ?? null;

/**
 * Extract a same-season, same-week, strictly pre-kickoff CORE matchup vector.
 * Never substitute 0 for missing fields. No market/reference prices involved.
 */
export function buildCfbCoreMatchupVector({
  home, away, season, week, kickoff, baselineHome, baselineAway,
} = {}) {
  const gameSeason = num(season), gameWeek = num(week);
  const startMs = Date.parse(String(kickoff || ""));
  const hScore = num(baselineHome), aScore = num(baselineAway);
  if (![gameSeason, gameWeek].every(Number.isInteger) || gameWeek < 2 ||
      !Number.isFinite(startMs) || hScore == null || aScore == null)
    return invalid("GAME_OR_BASELINE_UNVERIFIED");
  const sides = [home, away].map(x => {
    const year=coreField(x,"coreYear"), through=coreField(x,"coreThroughWeek");
    const offense=coreField(x,"coreOffense"), defense=coreField(x,"coreDefense");
    const asOf=sourceDate(x), observedMs=Date.parse(String(asOf || ""));
    return { year, through, offense, defense, observedMs, asOf,
      weekBounded:x?.coreWeekBounded === true,
      endpoint:x?.coreSourceEndpoint ?? x?.coreRow?.sourceEndpoint ?? null,
      seasonType:x?.coreThroughSeasonType ?? x?.coreRow?.throughSeasonType ?? null };
  });
  if (sides.some(x => x.year!==gameSeason || x.through==null ||
    !Number.isInteger(x.through) || x.through<1 || x.through>=gameWeek ||
    x.offense==null || x.defense==null || !x.weekBounded ||
    !CFB_CORE_ALLOWED_SOURCE_ENDPOINTS.includes(x.endpoint) ||
    !Number.isFinite(x.observedMs) || x.observedMs>=startMs))
    return invalid("CORE_PIT_OR_COVERAGE_UNVERIFIED",{season:gameSeason,week:gameWeek,
      coreCoverage:sides.map(x=>({year:x.year,through:x.through,weekBounded:x.weekBounded,
        collectedAt:x.asOf,endpoint:x.endpoint}))});
  if (sides[0].through!==sides[1].through)
    return invalid("CORE_PERIOD_MISMATCH",{homeWeek:sides[0].through,awayWeek:sides[1].through});
  if (sides[0].endpoint!==sides[1].endpoint)
    return invalid("CORE_SOURCE_MISMATCH",{homeEndpoint:sides[0].endpoint,awayEndpoint:sides[1].endpoint});
  if (sides.some(x => x.seasonType && String(x.seasonType).toLowerCase()!=="regular"))
    return invalid("CORE_SEASON_TYPE_MISMATCH");
  const [h,a]=sides;
  const crossHome=h.offense-a.defense, crossAway=a.offense-h.defense;
  const sourceLabel = h.endpoint === "fbis_weekly_training_document"
    ? "FBIS weekly training documents (EPA→CORE)"
    : "CFBD /ratings/core";
  return {
    ok:true,modelId:CFB_CORE_SHADOW_ID,
    season:gameSeason,week:gameWeek,throughWeek:h.through,kickoff,
    coreSourceAsOf:{home:h.asOf,away:a.asOf},
    coreSourceEndpoint:h.endpoint,
    featureOrder:[...CFB_CORE_FEATURE_KEYS],
    features:{
      baselineMargin:hScore-aScore,baselineTotal:hScore+aScore,
      coreCrossMargin:crossHome-crossAway,
      coreCrossTotal:crossHome+crossAway,
    },
    lineage:{source:sourceLabel,cadence:"weekly",pointInTime:true,
      seasonType:"regular",units:"CORE ratings per 100 plays, not PPA",
      endpoint:h.endpoint},
    authority:"research_only",canQualify:false,canAuthorizeWager:false,
  };
}

/**
 * An unapproved OOS artifact may supply shadow predictions only when its
 * training cutoff STRICTLY precedes the target season. No fallback weights.
 * Means, stds and betas must all come from the fitted artifact.
 */
export function projectCfbCoreShadow(input = {}, artifact = null) {
  const v=buildCfbCoreMatchupVector(input);
  if (!v.ok) return v;
  if (!artifact || artifact.modelId!==CFB_CORE_SHADOW_ID ||
      artifact.authority!=="research_only" || artifact.verifiedOos!==true ||
      !Array.isArray(artifact.features) ||
      artifact.features.join("|")!==CFB_CORE_FEATURE_KEYS.join("|") ||
      !Number.isInteger(artifact.lastTrainingSeason) ||
      artifact.lastTrainingSeason>=v.season)
    return invalid("FITTED_RESEARCH_ARTIFACT_NOT_VERIFIED",{vector:v});
  const validModel = model => model && num(model.intercept)!=null &&
    [model.beta,model.means,model.stds].every(a=>Array.isArray(a)&&a.length===CFB_CORE_FEATURE_KEYS.length&&
      a.every(x=>num(x)!=null)) && model.stds.every(s=>s>=0);
  if (!validModel(artifact.margin)||!validModel(artifact.total))
    return invalid("FITTED_COEFFICIENTS_INVALID",{vector:v});
  const x=CFB_CORE_FEATURE_KEYS.map(k=>v.features[k]);
  const predict=m=>m.intercept+m.beta.reduce((sum,b,j)=>sum+
    b*(m.stds[j]>1e-9?(x[j]-m.means[j])/m.stds[j]:0),0);
  const margin=predict(artifact.margin),total=predict(artifact.total);
  if(!Number.isFinite(margin)||!Number.isFinite(total)||total<=0 ||
      Math.abs(margin)>total+1)
    return invalid("FITTED_PREDICTION_INVALID",{vector:v});
  const home=(total+margin)/2,away=(total-margin)/2;
  return {
    ok:true,modelId:CFB_CORE_SHADOW_ID,version:artifact.version||"research-v1",
    home,away,margin,total,
    pHomeWin:null, sigmaMargin:null, sigmaTotal:null,
    vector:v,sourceArtifact:artifact.artifactId||null,
    authority:"research_only",independent:true,marketInformed:false,
    canQualify:false,canAuthorizeWager:false,canInfluenceProduction:false,
    explanation:"Opponent-relative CORE and baseline are combined only using OOS-fitted research coefficients",
  };
}
