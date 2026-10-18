#!/usr/bin/env node
/**
 * Package research-only CFB challenger ridge artifacts from the existing
 * temporally-valid fold3 coefficients + design-row scalers.
 *
 * Does NOT promote, touch production CFB-FBIS-v2 A/A, or authorize wagers.
 * Writes OOS comparison vs champion A from final-select pooled metrics +
 * paired bootstrap already computed in final-select-report.json.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mean, variance } from "../functions/lib/cfbFbisV2Fit.js";

const FINAL_COEF = "data/cfbd/calibration/fitted-coefficients-final.json";
const FINAL_REPORT = "data/cfbd/calibration/final-select-report.json";
const DESIGN = existsSync("artifacts/cfb-fbis-v2-design-rows.jsonl")
  ? "artifacts/cfb-fbis-v2-design-rows.jsonl"
  : "data/cfbd/calibration/design-rows.jsonl";
const OUT_DIR = "data/models";
const REPORT_OUT = "artifacts/cfb-research-challenger-oos.json";
const REPORT_COMMITTED = "data/cfbd/calibration/research-challenger-oos.json";
const TRAIN_SEASONS = new Set([2022, 2023, 2024]);

/** Research family → ablation letter used for M* and T* (same letter). */
const RESEARCH_PACKAGES = [
  {
    familyId: "B",
    ablation: "B",
    modelId: "CFB-RESEARCH-B",
    name: "Advanced passing/rushing efficiency",
    consumedFields: ["base", "pass", "rush", "base_total", "pass_total", "rush_total"],
    hypothesis: "Pass/rush EPA matchups improve OOS margin/total vs champion base-only",
  },
  {
    familyId: "E_DRIVE",
    ablation: "C",
    modelId: "CFB-RESEARCH-E-DRIVE",
    name: "Drive efficiency (success rate)",
    consumedFields: ["base", "pass", "rush", "success"],
    hypothesis: "Adding success/drive efficiency improves OOS vs champion",
    parentFamily: "E",
  },
  {
    familyId: "E_SIT",
    ablation: "D",
    modelId: "CFB-RESEARCH-E-SIT",
    name: "Situational explosiveness",
    consumedFields: ["base", "pass", "rush", "success", "explosiveness"],
    hypothesis: "Adding explosiveness improves OOS vs champion",
    parentFamily: "E",
  },
  {
    familyId: "E",
    ablation: "F",
    modelId: "CFB-RESEARCH-E",
    name: "Optimized combined advanced CFBD",
    consumedFields: [
      "base",
      "pass",
      "rush",
      "success",
      "explosiveness",
      "havoc",
      "trenches",
    ],
    hypothesis:
      "Combined pass/rush + drive + trenches/situational advanced CFBD improves OOS vs champion",
  },
];

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function loadDesignRows(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function scaler(values) {
  const finite = values.filter((v) => Number.isFinite(v));
  return {
    mean: mean(finite),
    std: Math.sqrt(variance(finite)) || 0,
    n: finite.length,
  };
}

function scalers(rows, namespace, names) {
  return names.map((name) => scaler(rows.map((r) => r?.[namespace]?.[name])));
}

function round4(n) {
  return n == null || !Number.isFinite(n) ? null : Math.round(n * 1e4) / 1e4;
}

function packageOne(spec, fold3, rows, coefSha, designSha) {
  const block = fold3[spec.ablation];
  if (!block?.margin?.beta || !block?.total?.beta) {
    throw new Error(`Missing fold3 coefficients for ablation ${spec.ablation}`);
  }
  const marginNames = block.margin.features || [];
  const totalNames = block.total.features || [];
  if (
    marginNames.length !== block.margin.beta.length ||
    totalNames.length !== block.total.beta.length
  ) {
    throw new Error(`Feature/beta length mismatch for ${spec.ablation}`);
  }
  const marginScalers = scalers(rows, "marginFeatures", marginNames);
  const totalScalers = scalers(rows, "totalFeatures", totalNames);
  return {
    id: `cfb-research-${spec.familyId.toLowerCase()}-fitted`,
    modelId: spec.modelId,
    familyId: spec.familyId,
    parentFamily: spec.parentFamily || spec.familyId,
    name: spec.name,
    version: `research-fold3-${spec.ablation.toLowerCase()}-v1`,
    role: "research-challenger",
    authority: "research_only",
    projectionEnabled: false,
    canQualify: false,
    canAuthorize: false,
    canAuthorizeWager: false,
    canInfluenceProduction: false,
    wagerAuthorization: false,
    promote: false,
    Mstar: spec.ablation,
    Tstar: spec.ablation,
    productionFold: "fold3",
    trainSeasons: [2022, 2023, 2024],
    ablation: spec.ablation,
    featureContract: "ppa-derived-advanced-research-v1",
    consumedFields: spec.consumedFields,
    hypothesis: spec.hypothesis,
    sourceArtifacts: {
      fittedCoefficientsFinal: FINAL_COEF,
      fittedCoefficientsFinalSha256: coefSha,
      designRows: DESIGN,
      designRowsSha256: designSha,
      finalSelectReport: FINAL_REPORT,
    },
    notes:
      "Research-only ridge package from the same PIT 2022–2024 fold3 training window as production A/A. Never overwrites champion coefficients.",
    margin: {
      features: marginNames,
      intercept: block.margin.intercept,
      beta: block.margin.beta,
      means: marginScalers.map((x) => x.mean),
      stds: marginScalers.map((x) => x.std),
      lambda: block.lambdaMargin,
      sigma: block.sigmaMargin,
      scalerN: marginScalers.map((x) => x.n),
    },
    total: {
      features: totalNames,
      intercept: block.total.intercept,
      beta: block.total.beta,
      means: totalScalers.map((x) => x.mean),
      stds: totalScalers.map((x) => x.std),
      lambda: block.lambdaTotal,
      scalerN: totalScalers.map((x) => x.n),
    },
    trainN: block.trainN,
    testN: block.testN,
  };
}

/** Same practical ε used by final-select when preferring simpler A/A. */
const PRACTICAL_EPS_MARGIN = 0.041;
const PRACTICAL_EPS_TOTAL = 0.04;

function oosVerdict(pooledA, pooledX, pairedDelta) {
  const deltaMargin = pooledX.maeMargin - pooledA.maeMargin;
  const deltaTotal = pooledX.maeTotal - pooledA.maeTotal;
  const bootM = pairedDelta?.deltaMaeMargin || null;
  const bootT = pairedDelta?.deltaMaeTotal || null;
  // Final-select already chose A/A: advanced ablations only "improve" when the
  // pooled point estimate beats A by more than practical ε (and is not worse
  // on the other target). Bootstrap CIs in the source report cross zero for
  // every advanced ablation, so none are statistically supported.
  const beatsMargin = deltaMargin < -PRACTICAL_EPS_MARGIN;
  const beatsTotal = deltaTotal < -PRACTICAL_EPS_TOTAL;
  const notWorseMargin = deltaMargin <= PRACTICAL_EPS_MARGIN;
  const notWorseTotal = deltaTotal <= PRACTICAL_EPS_TOTAL;
  const improves = (beatsMargin && notWorseTotal) || (beatsTotal && notWorseMargin);
  return {
    championMaeMargin: round4(pooledA.maeMargin),
    challengerMaeMargin: round4(pooledX.maeMargin),
    deltaMaeMargin: round4(deltaMargin),
    championMaeTotal: round4(pooledA.maeTotal),
    challengerMaeTotal: round4(pooledX.maeTotal),
    deltaMaeTotal: round4(deltaTotal),
    practicalEps: { margin: PRACTICAL_EPS_MARGIN, total: PRACTICAL_EPS_TOTAL },
    bootstrapMargin: bootM
      ? {
          mean: round4(bootM.mean),
          ci95: bootM.ci95?.map(round4),
          signPositiveShare: round4(bootM.signPositiveShare),
        }
      : null,
    bootstrapTotal: bootT
      ? {
          mean: round4(bootT.mean),
          ci95: bootT.ci95?.map(round4),
          signPositiveShare: round4(bootT.signPositiveShare),
        }
      : null,
    improvesOverChampion: improves,
    statisticallySupported: false,
    decision: improves
      ? "OOS_IMPROVEMENT_CANDIDATE_RESEARCH_ONLY"
      : "NO_OOS_IMPROVEMENT_VS_CHAMPION_A",
    rationale:
      "Matches final-select: prefer champion A/A when |ΔMAE| ≤ practical ε or bootstrap CI crosses 0",
  };
}

const finalCoef = JSON.parse(readFileSync(FINAL_COEF, "utf8"));
const report = JSON.parse(readFileSync(FINAL_REPORT, "utf8"));
const fold3 = finalCoef.coefByFold?.fold3;
if (!fold3) throw new Error("Missing coefByFold.fold3");

const rows = loadDesignRows(DESIGN).filter((r) => TRAIN_SEASONS.has(Number(r.season)));
if (!rows.length) throw new Error(`No fold3 training rows in ${DESIGN}`);

const coefSha = sha256(readFileSync(FINAL_COEF));
const designSha = sha256(readFileSync(DESIGN));
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync("artifacts", { recursive: true });

const pooledA = report.pooledOos.A;
const pairedMargin = report.marginSelection?.paired || {};
const pairedTotal = report.totalSelection?.paired || {};
const written = [];
const validations = [];

function flipBoot(boot) {
  if (!boot) return null;
  return {
    ...boot,
    mean: -boot.mean,
    ci95: Array.isArray(boot.ci95) ? [-boot.ci95[1], -boot.ci95[0]] : null,
    signPositiveShare: 1 - (boot.signPositiveShare || 0),
  };
}

/** Normalize paired keys to challenger−champion (negative ⇒ challenger better). */
function pairedChallengerMinusChampion(ablation) {
  const mDirect = pairedMargin[`${ablation}_vs_A`];
  const mFlip = pairedMargin[`A_vs_${ablation}`];
  const tDirect = pairedTotal[`${ablation}_vs_A`];
  const tFlip = pairedTotal[`A_vs_${ablation}`];
  return {
    deltaMaeMargin: mDirect?.deltaMaeMargin || flipBoot(mFlip?.deltaMaeMargin) || null,
    deltaMaeTotal: tDirect?.deltaMaeTotal || flipBoot(tFlip?.deltaMaeTotal) || null,
  };
}

for (const spec of RESEARCH_PACKAGES) {
  const pkg = packageOne(spec, fold3, rows, coefSha, designSha);
  const pooledX = report.pooledOos[spec.ablation];
  if (!pooledX) throw new Error(`Missing pooledOos.${spec.ablation}`);
  const verdict = oosVerdict(pooledA, pooledX, pairedChallengerMinusChampion(spec.ablation));
  pkg.oosValidation = {
    method: "rolling-origin-folds-2023-2025-pooled",
    n: pooledX.n,
    ...verdict,
    canPromote: false,
    canAuthorizeWager: false,
  };

  const base = `${OUT_DIR}/cfb-research-${spec.familyId.toLowerCase()}-fitted`;
  writeFileSync(`${base}.json`, `${JSON.stringify(pkg, null, 2)}\n`);
  writeFileSync(
    `${base}.js`,
    `/**
 * Research-only CFB challenger (${spec.modelId}).
 * Generated by scripts/cfb-package-research-challengers.mjs — do not hand-edit.
 * canInfluenceProduction / canAuthorizeWager remain false.
 */
export default ${JSON.stringify(pkg, null, 2)};
`
  );
  written.push(`${base}.js`, `${base}.json`);
  validations.push({
    familyId: spec.familyId,
    parentFamily: spec.parentFamily || spec.familyId,
    modelId: spec.modelId,
    ablation: spec.ablation,
    name: spec.name,
    artifact: `${base}.js`,
    ...pkg.oosValidation,
  });
}

const summary = {
  generatedAt: new Date().toISOString(),
  authority: "research_only",
  productionChampion: {
    modelId: "CFB-FBIS-v2",
    Mstar: "A",
    Tstar: "A",
    maeMargin: round4(pooledA.maeMargin),
    maeTotal: round4(pooledA.maeTotal),
    n: pooledA.n,
  },
  core: {
    fitted: false,
    reason: "FITTED_CORE_ARTIFACT_UNAVAILABLE — no multi-season PIT CORE freeze corpus for walk-forward",
  },
  sdv: {
    fitted: false,
    reason: "NO_VALIDATED_SDV_CHALLENGER_ARTIFACT — SDV never enters fitted champion path",
  },
  validations,
  anyImprovesOverChampion: validations.some((v) => v.improvesOverChampion),
  promotionAuthorized: false,
  wagerAuthorized: false,
  written,
};

const reportBody = `${JSON.stringify(summary, null, 2)}\n`;
writeFileSync(REPORT_OUT, reportBody);
writeFileSync(REPORT_COMMITTED, reportBody);
console.log(JSON.stringify({
  report: REPORT_OUT,
  committedReport: REPORT_COMMITTED,
  anyImprovesOverChampion: summary.anyImprovesOverChampion,
  validations: validations.map((v) => ({
    familyId: v.familyId,
    ablation: v.ablation,
    deltaMaeMargin: v.deltaMaeMargin,
    decision: v.decision,
  })),
  written,
}, null, 2));
