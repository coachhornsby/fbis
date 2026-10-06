/**
 * KBO / NPB FBIS source-contract inventory.
 *
 * This module records only infrastructure verified in-repo and live source
 * contracts checked during Phase 1. It is intentionally fail-closed:
 * missing persistence/history/ID guarantees are represented as gaps rather
 * than inferred capabilities.
 */

export const ASIAN_BASEBALL_DATA_CONTRACT_VERSION = "phase1-2026-10-06";

const SOURCE_STATE = Object.freeze({
  VERIFIED_LIVE: "VERIFIED_LIVE",
  VERIFIED_CODE: "VERIFIED_CODE",
  PARTIAL: "PARTIAL",
  MISSING: "MISSING",
});

export const ASIAN_BASEBALL_SOURCE_STATE = SOURCE_STATE;

const sharedGaps = Object.freeze({
  historicalPersistence: SOURCE_STATE.MISSING,
  oddsHistoryPersistence: SOURCE_STATE.MISSING,
  boundedBackfillWorkflow: SOURCE_STATE.MISSING,
  rosterHistory: SOURCE_STATE.MISSING,
  lineupHistory: SOURCE_STATE.MISSING,
  marketValidation: SOURCE_STATE.MISSING,
  wagerAuthority: false,
});

export const ASIAN_BASEBALL_DATA_CONTRACTS = Object.freeze({
  kbo: Object.freeze({
    league: "KBO",
    scheduleResults: Object.freeze({
      state: SOURCE_STATE.VERIFIED_LIVE,
      source: "KBO official English Daily Schedule",
      stableGameKey: "date + away + home",
      notes: "Current schedule/results/venue/time are parseable from the official KBO English surface.",
    }),
    rosters: Object.freeze({
      state: SOURCE_STATE.PARTIAL,
      source: "KBO official player/team surfaces",
      notes: "Player-stat tables and IDs exist in current parsers, but no durable roster snapshot/history layer is present.",
    }),
    starters: Object.freeze({
      state: SOURCE_STATE.VERIFIED_CODE,
      source: "KBO official GameCenter START_PIT / preview",
      stablePlayerId: true,
      notes: "Current ingestion resolves official starter player IDs when GameCenter exposes them; unresolved states remain provisional.",
    }),
    pitcherStats: Object.freeze({
      state: SOURCE_STATE.VERIFIED_LIVE,
      source: "KBO official Korean pitcher basic + advanced tables",
      stablePlayerId: true,
    }),
    hitterStats: Object.freeze({
      state: SOURCE_STATE.VERIFIED_LIVE,
      source: "KBO official Korean team hitter tables",
      stablePlayerId: false,
      notes: "Current production code aggregates team offense; hitter-level durable identity/history is not yet implemented.",
    }),
    bullpen: Object.freeze({
      state: SOURCE_STATE.PARTIAL,
      source: "Derived from official KBO pitcher population",
      notes: "Relief ERA proxy exists; role/depth/fatigue state is not durably persisted.",
    }),
    parkEnvironment: Object.freeze({
      state: SOURCE_STATE.PARTIAL,
      source: "Venue from official schedule + shared historical park-factor hook",
      notes: "Venue is live; park-factor estimator exists, but no KBO historical persistence currently feeds it.",
    }),
    oddsHistory: Object.freeze({
      state: SOURCE_STATE.MISSING,
      notes: "No KBO-specific durable odds-history contract found in repo.",
    }),
    temporalCoverage: Object.freeze({
      state: SOURCE_STATE.PARTIAL,
      notes: "Official standings expose multiple seasons and temporal walk-forward grading code exists, but frozen pregame snapshots are not yet persisted.",
    }),
    stableIds: Object.freeze({
      state: SOURCE_STATE.PARTIAL,
      team: "canonical FBIS team registry exists",
      player: "official KBO playerId present for pitcher/starter surfaces",
      game: "deterministic FBIS key exists; durable canonical game table not yet present",
    }),
    models: Object.freeze(["KBO-FBIS-v1", "KBO-FBIS-v2"]),
    validation: Object.freeze({
      predictiveGate: "implemented",
      minimumWalkForwardN: 500,
      canQualify: false,
      canAuthorize: false,
    }),
    gaps: sharedGaps,
  }),

  npb: Object.freeze({
    league: "NPB",
    scheduleResults: Object.freeze({
      state: SOURCE_STATE.VERIFIED_LIVE,
      source: "NPB.jp monthly detailed schedule",
      stableGameKey: "date + away + home",
      notes: "Official schedule/results/venue/time are parsed from NPB.jp.",
    }),
    rosters: Object.freeze({
      state: SOURCE_STATE.PARTIAL,
      source: "NPB.jp player batting/pitching pages",
      notes: "Current code has player-level stat rows, but no durable roster snapshot/history layer.",
    }),
    starters: Object.freeze({
      state: SOURCE_STATE.VERIFIED_CODE,
      source: "NPB.jp schedule player links",
      stablePlayerId: true,
      notes: "Probable-starter IDs are parsed when present; unresolved states remain provisional.",
    }),
    pitcherStats: Object.freeze({
      state: SOURCE_STATE.VERIFIED_LIVE,
      source: "NPB.jp official team pitching pages",
      stablePlayerId: true,
    }),
    hitterStats: Object.freeze({
      state: SOURCE_STATE.VERIFIED_LIVE,
      source: "NPB.jp official team batting pages",
      stablePlayerId: false,
      notes: "Current batting parser does not persist official hitter IDs.",
    }),
    bullpen: Object.freeze({
      state: SOURCE_STATE.PARTIAL,
      source: "Derived from official NPB pitching rows",
      notes: "Relief ERA proxy exists; role/depth/fatigue state is not durably persisted.",
    }),
    parkEnvironment: Object.freeze({
      state: SOURCE_STATE.PARTIAL,
      source: "Venue from official schedule + shared historical park-factor hook",
      notes: "Venue is live; park-factor estimator exists, but no NPB historical persistence currently feeds it.",
    }),
    oddsHistory: Object.freeze({
      state: SOURCE_STATE.MISSING,
      notes: "No NPB-specific durable odds-history contract found in repo.",
    }),
    temporalCoverage: Object.freeze({
      state: SOURCE_STATE.PARTIAL,
      notes: "Season/date loaders and temporal walk-forward grading code exist, but frozen pregame snapshots are not yet persisted.",
    }),
    stableIds: Object.freeze({
      state: SOURCE_STATE.PARTIAL,
      team: "canonical FBIS team registry exists",
      player: "official NPB pitcher/starter playerId present; hitter IDs not currently persisted",
      game: "deterministic FBIS key exists; durable canonical game table not yet present",
    }),
    models: Object.freeze(["NPB-FBIS-v1", "NPB-FBIS-v2"]),
    validation: Object.freeze({
      predictiveGate: "implemented",
      minimumWalkForwardN: 500,
      canQualify: false,
      canAuthorize: false,
    }),
    gaps: sharedGaps,
  }),
});

export function asianBaseballDataReadiness(league) {
  const key=String(league||"").toLowerCase();
  const c=ASIAN_BASEBALL_DATA_CONTRACTS[key];
  if(!c) return {ok:false,reason:"unsupported-league"};

  const blockers=[];
  if(c.gaps.historicalPersistence===SOURCE_STATE.MISSING) blockers.push("historical_persistence_missing");
  if(c.gaps.oddsHistoryPersistence===SOURCE_STATE.MISSING) blockers.push("odds_history_persistence_missing");
  if(c.gaps.boundedBackfillWorkflow===SOURCE_STATE.MISSING) blockers.push("bounded_backfill_missing");
  if(c.gaps.rosterHistory===SOURCE_STATE.MISSING) blockers.push("roster_history_missing");
  if(c.validation.canQualify!==true) blockers.push("predictive_validation_not_promoted");
  if(c.validation.canAuthorize!==true) blockers.push("wager_authority_disabled");

  return {
    ok:true,
    league:key,
    contractVersion:ASIAN_BASEBALL_DATA_CONTRACT_VERSION,
    researchReady:true,
    productionDataReady:blockers.length===0,
    canQualify:false,
    canAuthorize:false,
    blockers,
  };
}
