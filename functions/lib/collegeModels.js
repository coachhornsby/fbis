/**
 * Versioned CFB/CBB challenger registry. Shadow models cannot QUALIFY, LOG, or write strategy tickets.
 * Champion weights / HFA 2.5 / FBIS-HC-v1 are not modified here.
 */

export const CHAMPION_CFB = "FBIS-v1.3";
export const CHAMPION_HFA = 2.5;
export const NEUTRAL_HFA = 0;
export const CHAMPION_CBB_HCA = 3.5;
export const DATA_QUALITY_FLOOR = 0.35;

export const PROMOTION_CRITERIA = {
  definedBeforeResults: true,
  minOosN: 400,
  minSeasons: 3,
  primaryMetric: "mae_total",
  minMaeImprovement: 0.15,
  maxBiasAbs: 1.5,
  maxBrierDegradation: 0.02,
  minCoverage: 0.9,
  requireNoLeakage: true,
  requireReproducibleArtifact: true,
  requireOperatorApproval: true,
  neverEvidence: ["good betting week", "7-0 cohort", "attractive current slate"],
};

export const COLLEGE_MODELS = {
  "CFB-LEAGUE-BASELINE": {
    id: "CFB-LEAGUE-BASELINE",
    sport: "cfb",
    name: "CFB league-average scoring + documented HFA",
    version: "v1",
    role: "shadow",
    family: "baseline",
    canQualify: false,
    marketInformed: false,
    independent: true,
  },
  "CFB-CFBD-RATINGS-v1": {
    id: "CFB-CFBD-RATINGS-v1",
    sport: "cfb",
    name: "CFBD opponent-adjusted offense/defense + frozen national scoring",
    version: "v1",
    role: "shadow",
    family: "ratings",
    canQualify: false,
    marketInformed: false,
    independent: true,
  },
  "CFB-CFBD-ENRICHED-v1": {
    id: "CFB-CFBD-ENRICHED-v1",
    sport: "cfb",
    name: "CFBD prior and form plus EPA, transfer, QB, coaching, returning production, and talent",
    version: "v1",
    role: "shadow",
    family: "enriched",
    canQualify: false,
    marketInformed: false,
    independent: true,
  },
  "CFB-CFBD-REG-v1": {
    id: "CFB-CFBD-REG-v1",
    sport: "cfb",
    name: "Regularized CFBD feature model (home/away scores)",
    version: "v1",
    role: "shadow",
    family: "reg",
    canQualify: false,
    marketInformed: false,
    independent: true,
  },
  "CFB-CFBD-ENSEMBLE-v1": {
    id: "CFB-CFBD-ENSEMBLE-v1",
    sport: "cfb",
    name: "Ensemble of independent CFB predictors (not Monte Carlo mean)",
    version: "v1",
    role: "shadow",
    family: "ensemble",
    canQualify: false,
    marketInformed: false,
    independent: true,
    members: ["CFB-LEAGUE-BASELINE", "CFB-CFBD-RATINGS-v1", "CFB-CFBD-REG-v1"],
  },
  "CFB-PINNACLE-IMPLIED": {
    id: "CFB-PINNACLE-IMPLIED",
    sport: "cfb",
    name: "Pinnacle implied score (market baseline)",
    version: "v1",
    role: "shadow",
    family: "market",
    canQualify: false,
    marketInformed: true,
    independent: false,
  },
  "CFB-HFA-GLOBAL-v1": {
    id: "CFB-HFA-GLOBAL-v1",
    sport: "cfb",
    name: "Season-global HFA challenger",
    version: "v1",
    role: "shadow",
    family: "hfa",
    canQualify: false,
    marketInformed: false,
    independent: true,
  },
  "CFB-HFA-CONF-v1": {
    id: "CFB-HFA-CONF-v1",
    sport: "cfb",
    name: "Conference-aware HFA challenger",
    version: "v1",
    role: "shadow",
    family: "hfa",
    canQualify: false,
    marketInformed: false,
    independent: true,
  },
  "CBB-LEAGUE-BASELINE": {
    id: "CBB-LEAGUE-BASELINE",
    sport: "cbb",
    name: "CBB league-average efficiency × tempo + documented HCA",
    version: "v1",
    role: "shadow",
    family: "baseline",
    canQualify: false,
    marketInformed: false,
    independent: true,
  },
  "CBB-CBBD-RATINGS-v1": {
    id: "CBB-CBBD-RATINGS-v1",
    sport: "cbb",
    name: "CBBD AdjOE×AdjDE/national × possessions (identity-preserving)",
    version: "v1",
    role: "shadow",
    family: "ratings",
    canQualify: false,
    marketInformed: false,
    independent: true,
  },
  "CBB-TORVIK-RATINGS-v1": {
    id: "CBB-TORVIK-RATINGS-v1",
    sport: "cbb",
    name: "Torvik ratings when authorized and cached",
    version: "v1",
    role: "shadow",
    family: "ratings",
    canQualify: false,
    marketInformed: false,
    independent: true,
    optional: true,
  },
  "CBB-MATCHUP-v1": {
    id: "CBB-MATCHUP-v1",
    sport: "cbb",
    name: "Four-factor / shooting / TO / rebound / FT matchup",
    version: "v1",
    role: "shadow",
    family: "matchup",
    canQualify: false,
    marketInformed: false,
    independent: true,
  },
  "CBB-REG-v1": {
    id: "CBB-REG-v1",
    sport: "cbb",
    name: "Regularized CBBD historical model",
    version: "v1",
    role: "shadow",
    family: "reg",
    canQualify: false,
    marketInformed: false,
    independent: true,
  },
  "CBB-ENSEMBLE-v1": {
    id: "CBB-ENSEMBLE-v1",
    sport: "cbb",
    name: "Ensemble of independent CBB predictors",
    version: "v1",
    role: "shadow",
    family: "ensemble",
    canQualify: false,
    marketInformed: false,
    independent: true,
    members: ["CBB-LEAGUE-BASELINE", "CBB-CBBD-RATINGS-v1", "CBB-MATCHUP-v1", "CBB-REG-v1"],
  },
  "CBB-MARKET-SHRUNK-v1": {
    id: "CBB-MARKET-SHRUNK-v1",
    sport: "cbb",
    name: "Market-informed shrinkage toward Pinnacle (not independent edge)",
    version: "v1",
    role: "shadow",
    family: "market",
    canQualify: false,
    marketInformed: true,
    independent: false,
  },
  "CBB-PINNACLE-IMPLIED": {
    id: "CBB-PINNACLE-IMPLIED",
    sport: "cbb",
    name: "Pinnacle implied score (market baseline)",
    version: "v1",
    role: "shadow",
    family: "market",
    canQualify: false,
    marketInformed: true,
    independent: false,
  },
  "CBB-KENPOM-SHADOW": {
    id: "CBB-KENPOM-SHADOW",
    sport: "cbb",
    name: "Optional KenPom comparison — never required",
    version: "v1",
    role: "shadow",
    family: "optional",
    canQualify: false,
    marketInformed: false,
    independent: true,
    optional: true,
  },
};

export function modelMeta(id) {
  return COLLEGE_MODELS[id] || null;
}

export function shadowCannotQualify(modelId) {
  const m = modelMeta(modelId);
  if (!m) return true;
  return m.role !== "champion" || m.canQualify !== true;
}

export const SHADOW_BLOCK_REASONS = {
  unresolved: "Identity unresolved — shadow model cannot qualify",
  partial: "Projection state is partial/unavailable/league-average-only",
  missingFeatures: "Required feature set missing",
  unknownArtifact: "Model artifact/version unknown",
  cutoffAfterKick: "Feature cutoff is after kickoff",
  marketIncomplete: "Market pairing incomplete",
  noPrice: "Price absent",
  qualityFloor: "Data quality below predeclared floor",
  pinnacleOnly: "Projection is only Pinnacle-implied",
  shadow: "Challenger is shadow — cannot QUALIFY, LOG, or write strategy tickets",
};

export function failClosedShadow({
  identityOk = true,
  projectionState = "COMPLETE",
  featuresOk = true,
  artifactKnown = true,
  cutoffOk = true,
  marketPaired = true,
  pricePresent = true,
  dataQuality = 1,
  pinnacleOnly = false,
  modelId = null,
} = {}) {
  const reasons = [];
  if (!identityOk) reasons.push(SHADOW_BLOCK_REASONS.unresolved);
  if (["PARTIAL", "UNAVAILABLE", "LEAGUE_AVERAGE_ONLY", "PROVISIONAL"].includes(projectionState)) {
    reasons.push(SHADOW_BLOCK_REASONS.partial);
  }
  if (!featuresOk) reasons.push(SHADOW_BLOCK_REASONS.missingFeatures);
  if (!artifactKnown) reasons.push(SHADOW_BLOCK_REASONS.unknownArtifact);
  if (!cutoffOk) reasons.push(SHADOW_BLOCK_REASONS.cutoffAfterKick);
  if (!marketPaired) reasons.push(SHADOW_BLOCK_REASONS.marketIncomplete);
  if (!pricePresent) reasons.push(SHADOW_BLOCK_REASONS.noPrice);
  if (dataQuality < DATA_QUALITY_FLOOR) reasons.push(SHADOW_BLOCK_REASONS.qualityFloor);
  if (pinnacleOnly) reasons.push(SHADOW_BLOCK_REASONS.pinnacleOnly);
  if (shadowCannotQualify(modelId)) reasons.push(SHADOW_BLOCK_REASONS.shadow);
  return {
    canQualify: false,
    canLog: false,
    canWriteStrategy: false,
    blocked: true,
    reasons,
  };
}

export function evaluatePromotion({ n = 0, seasons = 0, maeImproved = false, biasAbs = 99, brierDegradation = 99, coverage = 0, leakageOk = false, operatorApproved = false, artifactOk = false } = {}) {
  const fail = [];
  if (n < PROMOTION_CRITERIA.minOosN) fail.push(`oos-n ${n} < ${PROMOTION_CRITERIA.minOosN}`);
  if (!maeImproved) fail.push("primary-mae-not-improved");
  if (seasons < PROMOTION_CRITERIA.minSeasons) fail.push(`seasons ${seasons} < ${PROMOTION_CRITERIA.minSeasons}`);
  if (biasAbs > PROMOTION_CRITERIA.maxBiasAbs) fail.push("bias");
  if (brierDegradation > PROMOTION_CRITERIA.maxBrierDegradation) fail.push("brier");
  if (coverage < PROMOTION_CRITERIA.minCoverage) fail.push("coverage");
  if (!leakageOk) fail.push("leakage-audit");
  if (!artifactOk) fail.push("artifact");
  if (!operatorApproved) fail.push("operator-approval-required");
  return { promote: fail.length === 0, fail, criteria: PROMOTION_CRITERIA };
}

export function unavailableMetric(n, extra = "N=0 — unavailable") {
  if (n == null || Number(n) === 0) {
    return { available: false, n: 0, value: null, label: extra };
  }
  return { available: true, n: Number(n), value: null, label: null };
}
