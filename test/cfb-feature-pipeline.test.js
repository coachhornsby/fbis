import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  temporalClassForFeature,
  TEMPORAL_CLASS,
  buildPriorCatalog,
  buildRollingMatchupFeatures,
  buildFcsConferenceStrength,
  fcsEquivalentForTeam,
  assembleGameFeatures,
  catalogWithTemporalClasses,
} from "../functions/lib/cfbFeaturePipeline.js";
import { featureAvailabilityTable, markdownFeatureTable } from "../functions/lib/cfbdFeatureCatalog.js";
import { projectCfbFbisV2 } from "../functions/lib/cfbFbisV2.js";
import { assertPregameTemporalIntegrity } from "../functions/lib/cfbFeatureStore.js";

describe("cfb feature pipeline temporal classes", () => {
  it("classifies evaluation as E and game PPA as B/C appropriately", () => {
    assert.equal(temporalClassForFeature({ use: "evaluation", pregameSafe: false }), TEMPORAL_CLASS.E);
    assert.equal(
      temporalClassForFeature({
        use: "matchup",
        grain: "game",
        endpoint: "/ppa/games",
        pregameSafe: true,
        leakageRisk: "none",
      }),
      TEMPORAL_CLASS.A
    );
    assert.equal(
      temporalClassForFeature({
        use: "matchup",
        grain: "season",
        endpoint: "/ppa/teams",
        pregameSafe: "conditional",
        leakageRisk: "high",
      }),
      TEMPORAL_CLASS.C
    );
    assert.equal(
      temporalClassForFeature({
        use: "prior",
        grain: "season",
        endpoint: "/ratings/sp",
        pregameSafe: "conditional",
        leakageRisk: "high",
      }),
      TEMPORAL_CLASS.D
    );
  });

  it("exposes temporalSafety in markdown catalog table", () => {
    const rows = featureAvailabilityTable();
    assert.ok(rows.every((r) => r.temporalSafety));
    assert.ok(markdownFeatureTable(rows).includes("Temporal"));
    const enriched = catalogWithTemporalClasses({});
    assert.ok(enriched.some((f) => f.temporalClass === TEMPORAL_CLASS.E));
  });
});

describe("prior / rolling / FCS assembly", () => {
  const priorBundle = {
    season: 2024,
    endpoints: {
      sp: {
        data: [
          { team: "Ohio State", conference: "Big Ten", rating: 28, offense: { rating: 42 }, defense: { rating: 14 } },
          { team: "Oregon", conference: "Big Ten", rating: 22, offense: { rating: 38 }, defense: { rating: 18 } },
        ],
      },
      fpi: { data: [{ team: "Ohio State", fpi: 24 }, { team: "Oregon", fpi: 20 }] },
      srs: {
        data: [
          { team: "Ohio State", rating: 20, conference: "Big Ten", division: "FBS" },
          { team: "North Dakota State", rating: 8, conference: "MVFC", division: "FCS" },
          { team: "South Dakota State", rating: 6, conference: "MVFC", division: "FCS" },
          { team: "Montana", rating: 4, conference: "Big Sky", division: "FCS" },
          { team: "Idaho", rating: 2, conference: "Big Sky", division: "FCS" },
        ],
      },
      elo: { data: [{ team: "Ohio State", elo: 1800 }] },
      talent: { data: [{ school: "Ohio State", talent: 950 }] },
      returning: { data: [{ team: "Ohio State", percentPPA: 0.62 }] },
      recruiting: { data: [{ team: "Ohio State", points: 280 }] },
      ppaTeams: {
        data: [
          {
            team: "Ohio State",
            offense: { passing: 0.3, rushing: 0.15 },
            defense: { passing: 0.05, rushing: 0.02 },
          },
        ],
      },
    },
  };

  it("builds prior catalog from prior-season freeze only", () => {
    const catalog = buildPriorCatalog(priorBundle);
    assert.ok(catalog.bySchool["ohio state"].priorOff > 30);
    assert.equal(catalog.bySchool["ohio state"].provenance, "prior-season-freeze");
    assert.equal(catalog.bySchool["ohio state"].temporalClass, TEMPORAL_CLASS.A);
  });

  it("rejects future games when rolling and keeps missing as null", () => {
    const kick = "2025-10-11T19:00:00.000Z";
    const rolling = buildRollingMatchupFeatures({
      team: "Ohio State",
      kickoffTimestamp: kick,
      ppaGameRows: [
        {
          team: "Ohio State",
          startDate: "2025-10-04T19:00:00.000Z",
          offense: { overall: 0.25, passing: 0.3, rushing: 0.1 },
          defense: { overall: -0.05, passing: 0.0, rushing: -0.02 },
        },
        {
          team: "Ohio State",
          startDate: "2025-10-18T19:00:00.000Z",
          offense: { overall: 0.9, passing: 0.9, rushing: 0.9 },
          defense: { overall: -0.9, passing: -0.9, rushing: -0.9 },
        },
      ],
      advGameRows: [
        {
          team: "Ohio State",
          startDate: "2025-10-04T19:00:00.000Z",
          offense: { successRate: 0.48, explosiveness: 0.14, lineYards: 3.4, pointsPerOpportunity: 4.2, plays: 72 },
          defense: { successRate: 0.38, explosiveness: 0.1, lineYards: 2.5, pointsPerOpportunity: 3.1, havoc: { total: 0.18 } },
        },
      ],
    });
    assert.equal(rolling.gamesPlayed, 1);
    assert.equal(rolling.passEpa, 0.3);
    assert.equal(rolling.successRate, 0.48);
    assert.equal(rolling.reconstructedFromGames, true);
  });

  it("maps FCS conferences distinctly and marks missing provisional", () => {
    const catalog = buildPriorCatalog(priorBundle);
    const conf = buildFcsConferenceStrength(catalog);
    assert.ok(conf.MVFC);
    assert.notEqual(conf.MVFC.fbsEquivalentPower, conf["Big Sky"].fbsEquivalentPower);
    const ndsu = fcsEquivalentForTeam(catalog.bySchool["north dakota state"], conf);
    assert.equal(ndsu.provisional, false);
    assert.ok(ndsu.fbsEquivalentPower != null);
    const weak = fcsEquivalentForTeam({ classification: "FCS", conference: "Unknown" }, conf);
    assert.equal(weak.provisional, true);
  });

  it("assembles pregame vectors with temporal integrity and no market in score path", () => {
    const catalog = buildPriorCatalog(priorBundle);
    const confMap = buildFcsConferenceStrength(catalog);
    const kick = "2025-10-11T19:00:00.000Z";
    const asOf = "2025-10-11T18:59:00.000Z";
    const record = assembleGameFeatures({
      game: {
        id: 401,
        season: 2025,
        week: 7,
        startDate: kick,
        homeTeam: "Ohio State",
        awayTeam: "Oregon",
        neutralSite: false,
      },
      priorCatalog: catalog,
      confMap,
      ppaGameRows: [
        {
          team: "Ohio State",
          startDate: "2025-10-04T19:00:00.000Z",
          offense: { overall: 0.2, passing: 0.25, rushing: 0.1 },
          defense: { overall: -0.05, passing: 0.02, rushing: -0.01 },
        },
      ],
      collectionTimestamp: asOf,
      lineRow: { lines: [{ provider: "Pinnacle", spread: -7.5, overUnder: 55 }] },
    });
    assert.equal(record.temporalOk, true);
    assert.equal(record.features.evaluation.closingSpread, -7.5);
    assert.equal(record.features.provenance.marketInIndependentScore, false);
    const integrity = assertPregameTemporalIntegrity({
      kickoffTimestamp: record.kickoff_timestamp,
      featureAsOfTimestamp: record.feature_as_of_timestamp,
      featureCutoffTimestamp: record.feature_cutoff_timestamp,
      collectionTimestamp: record.collection_timestamp,
    });
    assert.equal(integrity.ok, true);

    const bad = assembleGameFeatures({
      game: {
        id: 402,
        season: 2025,
        week: 7,
        startDate: kick,
        homeTeam: "Ohio State",
        awayTeam: "Oregon",
      },
      priorCatalog: catalog,
      confMap,
      collectionTimestamp: "2025-10-11T20:00:00.000Z",
    });
    assert.equal(bad.temporalOk, false);

    const withMkt = projectCfbFbisV2({
      sport: "cfb",
      home: { name: "Ohio State" },
      away: { name: "Oregon" },
      pinSpread: -14,
      pinTotal: 70,
      cfbFbisV2Input: record.features,
    });
    const noMkt = projectCfbFbisV2({
      sport: "cfb",
      home: { name: "Ohio State" },
      away: { name: "Oregon" },
      cfbFbisV2Input: record.features,
    });
    assert.equal(withMkt.ok, true);
    assert.equal(withMkt.home, noMkt.home);
    assert.equal(withMkt.provenance.marketUsed, false);
    assert.equal(withMkt.canQualify, false);
  });
});
