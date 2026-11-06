#!/usr/bin/env node
/**
 * GitHub-only college model regression and historical baseline availability audit.
 * Imports the original tested modules via existing node:test suites in the workflow.
 * Does not invent projections from incomplete historical receipts.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
const read = path => JSON.parse(readFileSync(path, "utf8"));
const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const modelPaths = [
  "data/models/cbb-pro-v1.json", "data/models/cbb-reg-v1.js",
  "data/models/cfb-fbis-v2-fitted-aa.js", "data/models/cfb-fbis-v2-fitted-aa.json"
];
const integrity = read("artifacts/cbb-cutover/frozen-model-integrity.json");
const baseline = new Map(integrity.models.map(x => [x.path,x.baselineSha256]));
const hashes = modelPaths.map(path => ({
  path, expectedSha256:baseline.get(path) || null,
  actualSha256:hash(path),
  matchesHistoricBaseline:baseline.get(path) === hash(path)
}));
const teamBasePath = "data/teams/cbb-base.js", supplementPath = "data/teams/cbb-supplement-2027.js";
const ids = source => [...readFileSync(source,"utf8").matchAll(/"id"\s*:\s*"cbb-(\d+)"/g)].map(x=>x[1]);
const base = ids(teamBasePath), supplement=ids(supplementPath);
const unique = new Set([...base,...supplement]);
const frozenCfb = read("data/cfb/2026/weeks05-08-frozen-a-a-receipts.json");
const invalidFrozen = frozenCfb.filter(x => !x.game_id ||
  !Number.isFinite(Number(x.proj_home)) || !Number.isFinite(Number(x.proj_away)) ||
  !x.frozen_at || !x.model_version);
const cbbReadiness = read("data/public/cbb-readiness/2026-11-02.json");
const historicalCfb = read("research/cfb/finalization-20261011/production-deployed.json");
const report = {
  schema:"FBIS-COLLEGE-GITHUB-SHADOW-REGRESSION-v1",
  generatedAt:new Date().toISOString(),
  mode:"historical_contract_regression_no_network",
  cbbRegistry:{
    oldBase:base.length,supplement:supplement.length,currentUnique:unique.size,
    ids:supplement,expectedOldBase:362,expectedCurrent:365,
    passed:base.length===362&&supplement.length===3&&unique.size===365
  },
  modelHashes:hashes,
  cfbFrozenReceipts:{
    count:frozenCfb.length,invalid:invalidFrozen.length,
    uniqueGames:new Set(frozenCfb.map(x=>x.game_id)).size,
    basis:"actual prior frozen predictions, not regenerated current projections"
  },
  historicalCfbAcceptance:{
    observedAt:historicalCfb.observedAt,
    fixtureWindows:historicalCfb.windows.map(w=>({
      expected:w.expected,published:w.published,provisional:w.provisionalForecasts,
      qualificationBlocked:w.qualificationBlocked,passed:w.passed
    }))
  },
  cbbReadiness:{
    generatedAt:cbbReadiness.generatedAt,expiresAt:cbbReadiness.expiresAt,
    publicationMode:cbbReadiness.publicationMode,
    publicProjection:cbbReadiness.states?.publicProjection
  },
  shadowComparisons:{
    modelContractRegression:"RUN_WITH_NODE_TEST_IN_SAME_WORKFLOW",
    liveNumericalCfbParity:"BLOCKED_MISSING_ORIGINAL_PREGAME_FEATURE_INPUTS_MATCHED_TO_BASELINES",
    liveNumericalCbbParity:"BLOCKED_MISSING_CONCURRENT_ESPN_FIXTURE_SNAPSHOT_AND_FROZEN_PROJECTION_BASELINE",
    historicalBaselinePresent:!!frozenCfb.length,
    noFictionalSubstitutions:true,
    noPromotion:true,
    verifiedLiveParity:false
  },
  productionAuthority:false,canQualify:false,canAuthorizeWager:false,
  cloudflareApiCalls:0,providerApiCalls:0,modelCoefficientsRewritten:false,
  canProceedToProduction:false
};
const structuralPass=hashes.every(x=>x.matchesHistoricBaseline)&&
  report.cbbRegistry.passed&&invalidFrozen.length===0;
report.offlineStructuralPassed=structuralPass;
mkdirSync("artifacts/college-github-shadow",{recursive:true});
writeFileSync("artifacts/college-github-shadow/contract-report.json",JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({
  structuralPass,modelHashesMatched:hashes.filter(x=>x.matchesHistoricBaseline).length,
  modelsChecked:hashes.length,oldTeams:base.length,currentTeams:unique.size,
  frozenCfbReceiptCount:frozenCfb.length,liveNumericalParity:"NOT_ESTABLISHED",
  output:"artifacts/college-github-shadow/contract-report.json"
}));
if(!structuralPass) process.exitCode=2;
