/**
 * Explicit CFB feature-contract tiers.
 * Collected ≠ validated ≠ eligible ≠ consumed ≠ nonzero fitted influence ≠ display-only.
 */

import {
  CFB_AVAILABLE_CURRENT_SEASON_FIELDS,
  CFB_CHAMPION_CONSUMED_FIELDS,
  CFB_COLLECTED_BUT_UNUSED_BY_CHAMPION,
} from "./cfbFeatureUsageAudit.js";

export const FEATURE_CONTRACT_VERSION = "cfb-feature-contract-v1";

export const FEATURE_TIER = Object.freeze({
  COLLECTED: "collected",
  VALIDATED_CANONICAL: "validated_canonical",
  MODEL_ELIGIBLE: "model_eligible",
  ACTUALLY_CONSUMED: "actually_consumed",
  FITTED_NONZERO: "fitted_nonzero_influence",
  DISPLAY_ONLY: "display_only",
  RESEARCH_ONLY: "research_only",
});

const CHAMPION_KEYS = new Set(CFB_CHAMPION_CONSUMED_FIELDS.map((f) => f.key));
const UNUSED = new Set(CFB_COLLECTED_BUT_UNUSED_BY_CHAMPION);

/** Fitted M*=A / T*=A nonzero influence — overall PPA + n + prior only. */
export const FITTED_NONZERO_FEATURES = Object.freeze([
  "ppaOff",
  "ppaDef",
  "gamesPlayed",
  "priorOff",
  "priorDef",
  "hfa",
]);

/**
 * Classify one canonical feature into contract tiers.
 */
export function classifyFeature(canonicalFeature) {
  const key = String(canonicalFeature || "");
  const available = CFB_AVAILABLE_CURRENT_SEASON_FIELDS.some((f) => f.key === key)
    || key === "priorOff"
    || key === "priorDef"
    || key === "hfa";
  const champion = CHAMPION_KEYS.has(key) || key === "hfa";
  const unused = UNUSED.has(key);
  const fitted = FITTED_NONZERO_FEATURES.includes(key);
  const core = key.startsWith("core");

  const tiers = [];
  if (available || champion) tiers.push(FEATURE_TIER.COLLECTED);
  if (available || champion) tiers.push(FEATURE_TIER.VALIDATED_CANONICAL);
  if (champion || core || unused) tiers.push(FEATURE_TIER.MODEL_ELIGIBLE);
  if (champion) tiers.push(FEATURE_TIER.ACTUALLY_CONSUMED);
  if (fitted) tiers.push(FEATURE_TIER.FITTED_NONZERO);
  if (unused && !champion) tiers.push(FEATURE_TIER.DISPLAY_ONLY);
  if (core || (unused && !champion)) tiers.push(FEATURE_TIER.RESEARCH_ONLY);

  return {
    canonicalFeature: key,
    tiers,
    influencesFittedChampion: fitted,
    displayOnly: unused && !champion,
    researchOnly: core || (unused && !champion),
    note: fitted
      ? CFB_CHAMPION_CONSUMED_FIELDS.find((f) => f.key === key)?.effect || "HFA / structure"
      : core
        ? "CORE research-only until explicit promotion"
        : unused
          ? "Collected/page-visible; zero fitted AA coefficient"
          : "Not in current-season available catalog",
  };
}

export function buildFeatureContractReport() {
  const keys = [
    ...new Set([
      ...CFB_AVAILABLE_CURRENT_SEASON_FIELDS.map((f) => f.key),
      ...CFB_CHAMPION_CONSUMED_FIELDS.map((f) => f.key),
      "hfa",
    ]),
  ];
  const rows = keys.map(classifyFeature);
  return {
    version: FEATURE_CONTRACT_VERSION,
    rows,
    counts: {
      fittedNonzero: rows.filter((r) => r.influencesFittedChampion).length,
      displayOnly: rows.filter((r) => r.displayOnly).length,
      researchOnly: rows.filter((r) => r.researchOnly).length,
    },
    championContract:
      "Fitted CFB-FBIS-v2 consumes priorOff/priorDef + overall PPA→points + gamesPlayed + HFA only",
  };
}

/**
 * Instrument a projection: which features actually contributed.
 */
export function instrumentProjectionContribution(projection = {}, game = {}) {
  const priorDecay = projection.priorDecay || {};
  const scoring = projection.provenance?.scoring || null;
  const consumed = [];
  for (const key of FITTED_NONZERO_FEATURES) {
    if (key === "hfa") {
      consumed.push({
        feature: "hfa",
        value: projection.provenance?.hfa ?? null,
        influence: "additive home-field points",
        fittedNonzero: true,
      });
      continue;
    }
    const home = scoring?.home?.lineage?.[key]?.originalValue
      ?? scoring?.home?.consumed?.[key]
      ?? null;
    const away = scoring?.away?.lineage?.[key]?.originalValue
      ?? scoring?.away?.consumed?.[key]
      ?? null;
    consumed.push({
      feature: key,
      homeValue: home,
      awayValue: away,
      influence: classifyFeature(key).note,
      fittedNonzero: true,
    });
  }
  const presentUnused = [
    ...new Set([
      ...(scoring?.home?.presentButUnusedByChampion || []),
      ...(scoring?.away?.presentButUnusedByChampion || []),
    ]),
  ].map((f) => ({
    feature: f,
    fittedNonzero: false,
    note: "Present on inputs / page but zero champion coefficient",
  }));

  return {
    version: FEATURE_CONTRACT_VERSION,
    modelId: projection.modelId || "CFB-FBIS-v2",
    effectivePriorWeight: {
      home: priorDecay.homeCurrentWeight != null ? 1 - priorDecay.homeCurrentWeight : null,
      away: priorDecay.awayCurrentWeight != null ? 1 - priorDecay.awayCurrentWeight : null,
      formula: priorDecay.formula || "currentWeight=n/(n+6)",
    },
    actuallyConsumed: consumed,
    presentButZeroInfluence: presentUnused,
    doNotRepresentAsInfluencing: presentUnused.map((r) => r.feature),
  };
}
