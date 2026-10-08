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
  resolveLineage,
  sameLineage,
  dedupeCanonicalObservations,
  incrementalCatalog,
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
  // Health schema tip is declared in migrationTip.js and imported here.
  assert.match(health, /from ["']\.\.\/lib\/migrationTip\.js["']/);
  assert.match(health, /EXPECTED_MIGRATION_ID/);
});

test("gap report exists and freezes incumbents in prose", async () => {
  const report = await readFile(new URL("../docs/canonical/gap-report-2026-09-13.md", import.meta.url), "utf8");
  assert.match(report, /CFB-FBIS-v2/);
  assert.match(report, /Preserve all verified production incumbents|preserving verified production incumbents|Locked incumbents/i);
  assert.match(report, /COMMERCIAL_USE_REVIEW_REQUIRED/);
  assert.match(report, /DISAGREEMENT/);
});

test("SportsDataverse transports collapse to their upstream lineage", () => {
  assert.equal(resolveLineage("sportsdataverse-nflverse"), "nflverse");
  assert.equal(sameLineage("sportsdataverse-cfbd", "cfbd"), true);
  assert.equal(sameLineage("oddsapiR", "theodds"), true);
});

test("canonical dedupe keeps one copy per fact/entity/cutoff/upstream lineage", () => {
  const rows = dedupeCanonicalObservations([
    { canonicalKey: "epa", teamId: "HOU", dataThrough: "2026-10-01", source: "nflverse", value: 0.1, completeness: 1, observedAt: "2026-10-02T01:00:00Z" },
    { canonicalKey: "epa", teamId: "HOU", dataThrough: "2026-10-01", source: "sportsdataverse-nflverse", value: 0.1, completeness: 1, observedAt: "2026-10-02T02:00:00Z" },
    { canonicalKey: "epa", teamId: "HOU", dataThrough: "2026-10-01", source: "espn_public", value: 0.12, completeness: 1, observedAt: "2026-10-02T02:00:00Z" },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((r) => r.lineage === "nflverse").length, 1);
  assert.equal(rows.filter((r) => r.lineage === "espn").length, 1);
});

test("SportsDataverse catalog adds only incremental families", () => {
  const nfl = incrementalCatalog({ sport: "nfl" });
  assert.ok(nfl.some((r) => r.family === "next_gen_stats" && r.decision === "ADD"));
  assert.ok(nfl.some((r) => r.family === "nflverse" && r.decision === "SKIP_DUPLICATE"));
});

test("incremental SportsDataverse providers are registered without market authority", () => {
  const report = buildSourceRegistryReport();
  for (const id of ["sdv_nfl_ngs","sdv_ncaa","sdv_wnba_stats","sdv_nhl_edge","sdv_soccer_espn"]) {
    const s = report.sources.find((x) => x.providerId === id);
    assert.ok(s, id + " missing");
    assert.equal(s.domain, "sports");
    assert.equal(s.inMarketLayer, false);
    assert.equal(s.inPureModel, true);
    assert.equal(s.commercialStatus, COMMERCIAL_STATUS.RESEARCH_ONLY);
  }
});
