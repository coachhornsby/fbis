import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MODEL_MATURITY,
  MISPRICE_STATE,
  COMMERCIAL_STATUS,
  evaluateMisprice,
  rankMisprices,
  autoPromoteAllowed,
  listChampions,
  getModel,
  assertChampionFrozen,
  assertPointInTime,
  buildProjectionContract,
  buildSourceRegistryReport,
  commercialBlocksPaidPublication,
  assertNotPureMarketSource,
} from "../functions/lib/canonical/index.js";

test("auto-promote is hard-disabled", () => {
  assert.equal(autoPromoteAllowed(), false);
});

test("CFB and MLB champions are frozen and preserve incumbents", () => {
  const champions = listChampions();
  const ids = champions.map((c) => c.modelId);
  assert.ok(ids.includes("CFB-FBIS-v2"));
  assert.ok(ids.includes("MLB-SAVANT-RPG-SP"));
  for (const id of ["CFB-FBIS-v2", "MLB-SAVANT-RPG-SP"]) {
    const m = getModel(id);
    assert.equal(m.maturity, MODEL_MATURITY.PRODUCTION_CHAMPION);
    assert.equal(m.coefficientsLocked, true);
    assert.equal(m.preservesIncumbent, true);
    assert.equal(m.canAuthorizeWager, false);
    assert.equal(m.marketInformed, false);
    assert.equal(assertChampionFrozen(id).frozen, true);
  }
  const cfb = getModel("CFB-FBIS-v2");
  assert.equal(cfb.canQualify, false);
});

test("ACTION cannot be a PURE feature source", () => {
  const check = assertNotPureMarketSource("action_apify");
  assert.equal(check.ok, true);
  const report = buildSourceRegistryReport();
  const action = report.sources.find((s) => s.providerId === "action_apify");
  assert.ok(action);
  assert.equal(action.domain, "market");
  assert.equal(action.inPureModel, false);
  assert.equal(action.inMarketLayer, true);
  assert.equal(action.commercialStatus, COMMERCIAL_STATUS.COMMERCIAL_USE_REVIEW_REQUIRED);
  assert.equal(commercialBlocksPaidPublication("action_apify"), true);
});

test("uncalibrated misprice is Model disagreement and hides EV", () => {
  const row = evaluateMisprice({
    modelId: "CFB-FBIS-v2",
    projection: 27.5,
    marketLine: 24,
    calibrationLocked: false,
    marketFresh: true,
    identityResolved: true,
    modelProbability: 0.58,
    marketPriceAmerican: -110,
  });
  assert.equal(row.state, MISPRICE_STATE.DISAGREEMENT);
  assert.equal(row.canShowEv, false);
  assert.match(String(row.label).toLowerCase(), /disagreement/);
});

test("point-in-time rule rejects cutoff at/after event start", () => {
  const bad = assertPointInTime({
    effectiveAt: "2026-09-13T12:00:00Z",
    informationCutoff: "2026-09-13T18:00:00Z",
    eventStart: "2026-09-13T18:00:00Z",
  });
  assert.equal(bad.ok, false);
  const good = assertPointInTime({
    effectiveAt: "2026-09-13T12:00:00Z",
    informationCutoff: "2026-09-13T16:00:00Z",
    eventStart: "2026-09-13T18:00:00Z",
  });
  assert.equal(good.ok, true);
});

test("projection contract never enables wager authorization by default", () => {
  const c = buildProjectionContract({
    eventId: "x",
    sport: "cfb",
    modelId: "CFB-FBIS-v2",
    projectedHome: 28,
    projectedAway: 21,
  });
  assert.equal(c.canAuthorizeWager, false);
  assert.equal(c.calibrationLocked, false);
});

test("rankMisprices prefers calibrated states without inventing rows", () => {
  const ranked = rankMisprices([
    { state: MISPRICE_STATE.DISAGREEMENT, disagreementUnits: 9 },
    { state: MISPRICE_STATE.CALIBRATED_EDGE, disagreementUnits: 1 },
  ]);
  assert.equal(ranked[0].state, MISPRICE_STATE.CALIBRATED_EDGE);
});

test("migration 0023 registers canonical governance tables", async () => {
  const migration = await readFile(new URL("../migrations/0023_canonical_governance.sql", import.meta.url), "utf8");
  const migration24 = await readFile(
    new URL("../migrations/0024_action_observation_timeseries.sql", import.meta.url),
    "utf8"
  );
  const schemaExt = await readFile(new URL("../schema.extensions.sql", import.meta.url), "utf8");
  const health = await readFile(new URL("../functions/api/health.js", import.meta.url), "utf8");
  assert.match(migration, /schema_migrations[\s\S]*0023_canonical_governance/i);
  assert.match(migration, /canonical_source_registry/);
  assert.match(migration, /canonical_model_registry/);
  assert.match(migration, /canonical_misprice_snapshots/);
  assert.match(schemaExt, /canonical_source_registry/);
  assert.match(migration24, /schema_migrations[\s\S]*0024_action_observation_timeseries/i);
  assert.match(migration24, /action_market_book_observations/);
  assert.match(migration24, /action_market_snapshot_pointers/);
  assert.match(schemaExt, /action_market_book_observations/);
  const migration25 = await readFile(
    new URL("../migrations/0025_manual_completion_contracts.sql", import.meta.url),
    "utf8"
  );
  assert.match(migration25, /schema_migrations[\s\S]*0025_manual_completion_contracts/i);
  assert.match(migration25, /canonical_publication_ledger/);
  assert.match(schemaExt, /canonical_publication_ledger/);
  // Latest expected migration advances with manual-completion contracts.
  assert.match(health, /EXPECTED_MIGRATION\s*=\s*["']0025_manual_completion_contracts["']/);
});

test("gap report exists and freezes incumbents in prose", async () => {
  const report = await readFile(new URL("../docs/canonical/gap-report-2026-09-13.md", import.meta.url), "utf8");
  assert.match(report, /CFB-FBIS-v2/);
  assert.match(report, /Preserve all verified production incumbents|preserving verified production incumbents|Locked incumbents/i);
  assert.match(report, /COMMERCIAL_USE_REVIEW_REQUIRED/);
  assert.match(report, /DISAGREEMENT/);
});
