/**
 * Immutable CFB CORE prospective shadow ledger (research-only).
 * Writes target TIER3_DB. Never rewrites older pregame predictions with newer CORE.
 * Settlement may update score/closing columns only after kickoff.
 */
import {CFB_CORE_SHADOW_ID, projectCfbCoreShadow, buildCfbCoreMatchupVector} from "./cfbCoreChallenger.js";
import {
  CFB_CORE_MARGIN_HYBRID_ID,
  CFB_CORE_MARGIN_HYBRID_VARIANT_LEADING,
  CFB_CORE_MARGIN_HYBRID_VARIANT_RESIDUAL,
  projectCfbCoreMarginHybrid,
} from "./cfbCoreMarginHybrid.js";
import {evaluateCfbCoreResearch} from "./cfbCoreEvaluation.js";
import {CHAMPION_HFA} from "./collegeModels.js";
import {estimateCfbWeekFromDate} from "./cfbCoreAdvancedPlumbing.js";

const num = v => v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
const str = v => (v == null || v === "") ? null : String(v);
const j = v => JSON.stringify(v ?? null);

function tier3(env) {
  return env?.TIER3_DB || null;
}

function parseFeatures(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

/** Load latest verified research artifact; never falls back to invented weights.
 * Prefers margin-hybrid artifacts when present (leading research candidate).
 */
export async function loadCfbCoreResearchArtifact(env) {
  const db = tier3(env);
  if (!db?.prepare) return null;
  try {
    // Prefer margin-only hybrid, then fall back to full CORE shadow artifact.
    let row = await db.prepare(
      `SELECT artifact_id,model_id,version,verified_oos,last_training_season,
        features_json,margin_json,total_json,authority,can_influence_production,can_authorize_wager
       FROM cfb_core_research_artifacts
       WHERE model_id=? AND verified_oos=1 AND authority='research_only'
       ORDER BY frozen_at DESC LIMIT 1`
    ).bind(CFB_CORE_MARGIN_HYBRID_ID).first();
    if (!row) {
      row = await db.prepare(
        `SELECT artifact_id,model_id,version,verified_oos,last_training_season,
          features_json,margin_json,total_json,authority,can_influence_production,can_authorize_wager
         FROM cfb_core_research_artifacts
         WHERE model_id=? AND verified_oos=1 AND authority='research_only'
         ORDER BY frozen_at DESC LIMIT 1`
      ).bind(CFB_CORE_SHADOW_ID).first();
    }
    if (!row || !row.verified_oos) return null;
    const features = JSON.parse(row.features_json || "[]");
    const margin = JSON.parse(row.margin_json || "null");
    const total = JSON.parse(row.total_json || "null");
    const isHybrid =
      row.model_id === CFB_CORE_MARGIN_HYBRID_ID ||
      margin?.variant === CFB_CORE_MARGIN_HYBRID_VARIANT_LEADING ||
      margin?.variant === CFB_CORE_MARGIN_HYBRID_VARIANT_RESIDUAL;
    if (isHybrid) {
      const variant = margin?.variant || CFB_CORE_MARGIN_HYBRID_VARIANT_LEADING;
      return {
        ok: true,
        modelId: CFB_CORE_MARGIN_HYBRID_ID,
        variant,
        version: row.version,
        artifactId: row.artifact_id,
        verifiedOos: true,
        lastTrainingSeason: Number(row.last_training_season),
        features,
        margin: margin?.margin || (variant === CFB_CORE_MARGIN_HYBRID_VARIANT_LEADING ? margin : null),
        residual: margin?.residual || (variant === CFB_CORE_MARGIN_HYBRID_VARIANT_RESIDUAL ? margin : null),
        total,
        authority: "research_only",
        canInfluenceProduction: false,
        canAuthorizeWager: false,
      };
    }
    return {
      modelId: row.model_id,
      version: row.version,
      artifactId: row.artifact_id,
      verifiedOos: true,
      lastTrainingSeason: Number(row.last_training_season),
      features, margin, total,
      authority: "research_only",
      canInfluenceProduction: false,
      canAuthorizeWager: false,
    };
  } catch {
    return null;
  }
}

export async function saveCfbCoreResearchArtifact(env, artifact, reportId = null) {
  const db = tier3(env);
  if (!db?.prepare || !artifact?.verifiedOos) return { ok: false, reason: "artifact-or-db-unavailable" };
  const id = artifact.artifactId || `core-art-${Date.now()}`;
  const now = new Date().toISOString();
  const modelId = artifact.modelId || CFB_CORE_SHADOW_ID;
  const marginPayload =
    artifact.variant === CFB_CORE_MARGIN_HYBRID_VARIANT_LEADING
      ? { variant: CFB_CORE_MARGIN_HYBRID_VARIANT_LEADING, margin: artifact.margin }
      : artifact.variant === CFB_CORE_MARGIN_HYBRID_VARIANT_RESIDUAL
        ? { variant: CFB_CORE_MARGIN_HYBRID_VARIANT_RESIDUAL, residual: artifact.residual }
        : artifact.margin;
  try {
    await db.prepare(
      `INSERT OR IGNORE INTO cfb_core_research_artifacts
      (artifact_id,model_id,version,verified_oos,last_training_season,features_json,margin_json,total_json,
       evaluation_report_id,authority,can_influence_production,can_authorize_wager,created_at,frozen_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,0,0,?,?)`
    ).bind(
      id, modelId, artifact.version || "research-v1", 1,
      artifact.lastTrainingSeason ?? null,
      j(artifact.features), j(marginPayload), j(artifact.total),
      reportId, "research_only", now, now
    ).run();
    return { ok: true, artifactId: id };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

function coreSideFromFeatures(feat) {
  if (!feat) return null;
  return {
    coreYear: num(feat.coreYear),
    coreThroughWeek: num(feat.coreThroughWeek),
    coreOffense: num(feat.coreOffense),
    coreDefense: num(feat.coreDefense),
    coreWeekBounded: feat.coreWeekBounded === true,
    coreSourceEndpoint: feat.coreSourceEndpoint || null,
    coreSourceAsOf: feat.coreSourceAsOf || feat.asOf || null,
    coreThroughSeasonType: feat.coreThroughSeasonType || "regular",
  };
}

function disagreementDriver(vector) {
  if (!vector?.ok) return null;
  const f = vector.features || {};
  const cross = Math.abs(num(f.coreCrossMargin) || 0);
  const base = Math.abs(num(f.baselineMargin) || 0);
  if (cross >= base * 0.35 && cross >= 2) return "core_offense_vs_defense";
  if (base > cross) return "champion_baseline";
  return "mixed";
}

/**
 * Build a freeze candidate from champion projection + team CORE features.
 * Flags missing data rather than inventing projections.
 */
export function buildCfbCoreShadowRecord(game = {}, { artifact = null, market = null, now = null } = {}) {
  const generationAt = now || new Date().toISOString();
  const season = num(game.season ?? game.year);
  const week = num(game.week);
  const kickoff = str(game.kickoff || game.start || game.startDate || game.startTime);
  const homeFeat = parseFeatures(game.homeFeatures) || game.home || {};
  const awayFeat = parseFeatures(game.awayFeatures) || game.away || {};
  const championHome = num(game.championHome ?? game.projHome ?? game.model?.projHome);
  const championAway = num(game.championAway ?? game.projAway ?? game.model?.projAway);
  const championSpread = championHome != null && championAway != null ? championAway - championHome : null;
  const championTotal = championHome != null && championAway != null ? championHome + championAway : null;
  const hfa = game.neutralSite || game.neutral ? 0 : (num(game.hfaPoints) ?? CHAMPION_HFA);

  const homeCore = coreSideFromFeatures(homeFeat);
  const awayCore = coreSideFromFeatures(awayFeat);
  const vector = buildCfbCoreMatchupVector({
    home: homeCore, away: awayCore, season, week, kickoff,
    baselineHome: championHome, baselineAway: championAway,
  });
  // Prefer frozen margin-only hybrid artifact when present (leading research candidate).
  const useMarginHybrid =
    artifact?.modelId === CFB_CORE_MARGIN_HYBRID_ID ||
    artifact?.variant === CFB_CORE_MARGIN_HYBRID_VARIANT_LEADING ||
    artifact?.variant === CFB_CORE_MARGIN_HYBRID_VARIANT_RESIDUAL;
  const coreProj = useMarginHybrid
    ? projectCfbCoreMarginHybrid(
        {
          season,
          week,
          baselineHome: championHome,
          baselineAway: championAway,
          vector,
          xCombined: vector.ok
            ? [
                vector.features.baselineMargin,
                vector.features.baselineTotal,
                vector.features.coreCrossMargin,
                vector.features.coreCrossTotal,
              ]
            : null,
        },
        artifact,
        { aaHome: championHome, aaAway: championAway }
      )
    : projectCfbCoreShadow({
        home: homeCore, away: awayCore, season, week, kickoff,
        baselineHome: championHome, baselineAway: championAway,
      }, artifact);

  const eligibility = !vector.ok ? "ineligible" :
    (!coreProj.ok ? "vector_ok_artifact_unverified" : "eligible_projected");
  const missingReason = !vector.ok ? vector.reason :
    (!coreProj.ok ? coreProj.reason : null);

  const coreSpread = coreProj.ok ? (coreProj.away - coreProj.home) : null;
  const coreTotal = coreProj.ok ? coreProj.total : null;
  const disagreementSpread = (championSpread != null && coreSpread != null)
    ? coreSpread - championSpread : null;
  const disagreementTotal = (championTotal != null && coreTotal != null)
    ? coreTotal - championTotal : null;

  const id = [
    String(game.gameId || game.id || "unknown"),
    CFB_CORE_SHADOW_ID,
    generationAt,
  ].join(":");

  return {
    id,
    gameId: String(game.gameId || game.id || ""),
    season, week, kickoff,
    homeTeamId: str(game.homeTeamId || homeFeat.canonicalId),
    awayTeamId: str(game.awayTeamId || awayFeat.canonicalId),
    homeTeam: str(game.homeTeam || homeFeat.team || homeFeat.school),
    awayTeam: str(game.awayTeam || awayFeat.team || awayFeat.school),
    homeConference: str(game.homeConference || homeFeat.conference),
    awayConference: str(game.awayConference || awayFeat.conference),
    neutralSite: game.neutralSite || game.neutral ? 1 : 0,
    generationAt,
    featureCutoffAt: str(homeCore?.coreSourceAsOf || awayCore?.coreSourceAsOf),
    coreThroughWeek: vector.ok ? vector.throughWeek : num(homeCore?.coreThroughWeek),
    coreYear: vector.ok ? vector.season : num(homeCore?.coreYear),
    coreSourceAsOfHome: homeCore?.coreSourceAsOf || null,
    coreSourceAsOfAway: awayCore?.coreSourceAsOf || null,
    coreSourceEndpoint: homeCore?.coreSourceEndpoint || awayCore?.coreSourceEndpoint || null,
    eligibility, missingReason,
    championModelId: str(game.championModelId || game.model?.modelId || "CFB-FBIS-v2"),
    championModelVersion: str(game.championModelVersion || game.model?.version || null),
    championSpread, championTotal, championHome, championAway,
    championPHomeWin: num(game.championPHomeWin ?? game.model?.pHomeWin),
    coreModelId: useMarginHybrid ? CFB_CORE_MARGIN_HYBRID_ID : CFB_CORE_SHADOW_ID,
    coreModelVersion: coreProj.ok ? (coreProj.version || null) : null,
    coreArtifactId: coreProj.ok ? (coreProj.sourceArtifact || artifact?.artifactId || null) : null,
    coreSpread, coreTotal,
    coreHome: coreProj.ok ? coreProj.home : null,
    coreAway: coreProj.ok ? coreProj.away : null,
    corePHomeWin: coreProj.ok ? coreProj.pHomeWin : null,
    coreCrossMargin: vector.ok ? vector.features.coreCrossMargin : null,
    coreCrossTotal: vector.ok ? vector.features.coreCrossTotal : null,
    homeCoreOffense: homeCore?.coreOffense ?? null,
    homeCoreDefense: homeCore?.coreDefense ?? null,
    awayCoreOffense: awayCore?.coreOffense ?? null,
    awayCoreDefense: awayCore?.coreDefense ?? null,
    hfaPoints: hfa,
    disagreementSpread, disagreementTotal,
    disagreementDriver: disagreementDriver(vector),
    marketSpread: num(market?.spread),
    marketTotal: num(market?.total),
    marketMlHome: num(market?.mlHome),
    marketMlAway: num(market?.mlAway),
    marketCapturedAt: str(market?.capturedAt),
    marketSource: str(market?.source || (market ? "PinnOdds" : null)),
    marketObservationId: str(market?.observationId),
    researchSignal: (eligibility === "eligible_projected" && disagreementSpread != null)
      ? {
          kind: "research_disagreement",
          absSpreadDisagreement: Math.abs(disagreementSpread),
          notProvenEdge: true,
          canAuthorizeWager: false,
        } : null,
    vector: vector.ok ? vector : { ok: false, reason: vector.reason, diagnostics: vector.diagnostics },
    provenance: {
      authority: "research_only",
      immutablePregame: true,
      lookAheadForbidden: true,
      marketUsedAsFeature: false,
      championUnchanged: true,
      generationAt,
    },
  };
}

export async function freezeCfbCoreShadowRecords(env, records = []) {
  const db = tier3(env);
  if (!db?.batch || !db?.prepare) return { ok: false, reason: "TIER3_DB_UNAVAILABLE", inserted: 0, skipped: 0 };
  const statements = [];
  let skipped = 0;
  for (const r of records) {
    if (!r?.id || !r?.gameId || !r?.kickoff) { skipped += 1; continue; }
    statements.push(db.prepare(
      `INSERT OR IGNORE INTO cfb_core_shadow_predictions (
        id,game_id,season,week,kickoff,home_team_id,away_team_id,home_team,away_team,
        home_conference,away_conference,neutral_site,generation_at,feature_cutoff_at,
        core_through_week,core_year,core_source_as_of_home,core_source_as_of_away,core_source_endpoint,
        eligibility,missing_reason,champion_model_id,champion_model_version,
        champion_spread,champion_total,champion_home,champion_away,champion_p_home_win,
        core_model_id,core_model_version,core_artifact_id,core_spread,core_total,core_home,core_away,core_p_home_win,
        core_cross_margin,core_cross_total,home_core_offense,home_core_defense,away_core_offense,away_core_defense,
        hfa_points,disagreement_spread,disagreement_total,disagreement_driver,
        market_spread,market_total,market_ml_home,market_ml_away,market_captured_at,market_source,market_observation_id,
        research_signal_json,vector_json,provenance_json,authority,can_qualify,can_authorize_wager,can_influence_production,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0,?)`
    ).bind(
      r.id, r.gameId, r.season, r.week, r.kickoff, r.homeTeamId, r.awayTeamId, r.homeTeam, r.awayTeam,
      r.homeConference, r.awayConference, r.neutralSite || 0, r.generationAt, r.featureCutoffAt,
      r.coreThroughWeek, r.coreYear, r.coreSourceAsOfHome, r.coreSourceAsOfAway, r.coreSourceEndpoint,
      r.eligibility, r.missingReason, r.championModelId, r.championModelVersion,
      r.championSpread, r.championTotal, r.championHome, r.championAway, r.championPHomeWin,
      r.coreModelId, r.coreModelVersion, r.coreArtifactId, r.coreSpread, r.coreTotal, r.coreHome, r.coreAway, r.corePHomeWin,
      r.coreCrossMargin, r.coreCrossTotal, r.homeCoreOffense, r.homeCoreDefense, r.awayCoreOffense, r.awayCoreDefense,
      r.hfaPoints, r.disagreementSpread, r.disagreementTotal, r.disagreementDriver,
      r.marketSpread, r.marketTotal, r.marketMlHome, r.marketMlAway, r.marketCapturedAt, r.marketSource, r.marketObservationId,
      j(r.researchSignal), j(r.vector), j(r.provenance), "research_only", r.generationAt
    ));
  }
  if (!statements.length) return { ok: true, inserted: 0, skipped, authority: "research_only" };
  try {
    const results = await db.batch(statements);
    const inserted = results.reduce((s, x) => s + (x?.meta?.changes || 0), 0);
    return { ok: true, inserted, attempted: statements.length, skipped, authority: "research_only", canAuthorizeWager: false };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err), inserted: 0, skipped };
  }
}

/**
 * Settle immutable pregame rows with verified final scores + optional closing lines.
 * Does not rewrite projections or CORE ratings.
 */
export async function settleCfbCoreShadowRecords(env, settlements = []) {
  const db = tier3(env);
  if (!db?.prepare) return { ok: false, reason: "TIER3_DB_UNAVAILABLE", settled: 0 };
  let settled = 0;
  const now = new Date().toISOString();
  for (const s of settlements) {
    if (!s?.gameId || s.finalVerified !== true) continue;
    const ah = num(s.actualHome), aa = num(s.actualAway);
    if (ah == null || aa == null) continue;
    const settlement = {
      actualMargin: ah - aa,
      actualTotal: ah + aa,
      settledAt: now,
      researchOnly: true,
    };
    try {
      const res = await db.prepare(
        `UPDATE cfb_core_shadow_predictions SET
          actual_home=?, actual_away=?, final_verified=1, settled_at=?,
          closing_spread=COALESCE(?, closing_spread),
          closing_total=COALESCE(?, closing_total),
          closing_captured_at=COALESCE(?, closing_captured_at),
          settlement_json=?
         WHERE game_id=? AND final_verified=0 AND datetime(kickoff) < datetime(?)`
      ).bind(
        ah, aa, now,
        num(s.closingSpread), num(s.closingTotal), str(s.closingCapturedAt),
        j(settlement), String(s.gameId), now
      ).run();
      settled += res?.meta?.changes || 0;
    } catch { /* continue */ }
  }
  return { ok: true, settled, authority: "research_only" };
}

export async function loadCfbCoreShadowDashboard(env, { limit = 80 } = {}) {
  const db = tier3(env);
  const unavailable = (reason) => ({
    ok: false, reason, authority: "research_only",
    canAuthorizeWager: false, canInfluenceProduction: false,
    coverage: null, upcoming: [], disagreements: [], accuracy: null,
    bettingEdge: null, health: null, latestReport: null,
  });
  if (!db?.prepare) return unavailable("TIER3_DB_UNAVAILABLE");

  try {
    const upcoming = (await db.prepare(
      `SELECT * FROM cfb_core_shadow_predictions
       WHERE datetime(kickoff) >= datetime('now','-6 hours')
       ORDER BY kickoff ASC, abs(COALESCE(disagreement_spread,0)) DESC
       LIMIT ?`
    ).bind(Math.min(200, Math.max(1, limit))).all())?.results || [];

    const disagreements = [...upcoming]
      .filter(r => r.eligibility === "eligible_projected" && r.disagreement_spread != null)
      .sort((a, b) => Math.abs(b.disagreement_spread) - Math.abs(a.disagreement_spread))
      .slice(0, 40);

    const graded = (await db.prepare(
      `SELECT COUNT(*) as n,
        AVG(ABS(champion_spread - (actual_away-actual_home))) as champ_spread_mae,
        AVG(ABS(core_spread - (actual_away-actual_home))) as core_spread_mae,
        AVG(ABS(champion_total - (actual_home+actual_away))) as champ_total_mae,
        AVG(ABS(core_total - (actual_home+actual_away))) as core_total_mae
       FROM cfb_core_shadow_predictions
       WHERE final_verified=1 AND eligibility='eligible_projected'
         AND champion_spread IS NOT NULL AND core_spread IS NOT NULL`
    ).first()) || {};

    const coverageRow = (await db.prepare(
      `SELECT
        COUNT(*) as shadow_n,
        SUM(CASE WHEN eligibility='eligible_projected' THEN 1 ELSE 0 END) as eligible_n,
        SUM(CASE WHEN eligibility!='eligible_projected' THEN 1 ELSE 0 END) as flagged_n,
        SUM(CASE WHEN final_verified=1 THEN 1 ELSE 0 END) as settled_n,
        MAX(core_through_week) as max_through_week,
        MAX(generation_at) as latest_generation
       FROM cfb_core_shadow_predictions`
    ).first()) || {};

    const latestReport = await db.prepare(
      `SELECT report_id,report_type,season,week,generated_at,sample_n,classification,summary_json
       FROM cfb_core_evaluation_reports ORDER BY generated_at DESC LIMIT 1`
    ).first();

    const gate = await db.prepare(
      `SELECT gate_version,status,auto_promote,can_qualify,can_authorize,rules_json
       FROM cfb_core_promotion_gate WHERE gate_version='CFB-CORE-PROMOTION-GATE-v1'`
    ).first();

    const accuracy = Number(graded.n) > 0 ? {
      n: Number(graded.n),
      championSpreadMae: graded.champ_spread_mae,
      coreSpreadMae: graded.core_spread_mae,
      championTotalMae: graded.champ_total_mae,
      coreTotalMae: graded.core_total_mae,
      note: "Prospective settled sample only. Not a multi-season OOS claim.",
    } : {
      n: 0,
      championSpreadMae: null,
      coreSpreadMae: null,
      championTotalMae: null,
      coreTotalMae: null,
      note: "No settled prospective shadow rows yet.",
    };

    let reportSummary = null;
    if (latestReport?.summary_json) {
      try { reportSummary = JSON.parse(latestReport.summary_json); } catch { reportSummary = null; }
    }

    return {
      ok: true,
      authority: "research_only",
      canAuthorizeWager: false,
      canInfluenceProduction: false,
      challengerId: CFB_CORE_SHADOW_ID,
      coverage: {
        shadowProjections: Number(coverageRow.shadow_n || 0),
        eligibleProjected: Number(coverageRow.eligible_n || 0),
        flaggedMissing: Number(coverageRow.flagged_n || 0),
        settled: Number(coverageRow.settled_n || 0),
        maxThroughWeek: coverageRow.max_through_week ?? null,
        latestGeneration: coverageRow.latest_generation || null,
      },
      upcoming: upcoming.map(mapShadowRow),
      disagreements: disagreements.map(mapShadowRow),
      accuracy,
      bettingEdge: {
        status: reportSummary?.marketSummary ? "from_latest_report" : "unavailable",
        note: "Historical market edge requires timestamped PinnOdds on PIT-eligible rows. Unproven signals are never shown as approved bets.",
        summary: reportSummary?.marketSummary || null,
        prospective: accuracy.n > 0 ? { n: accuracy.n, note: "Settled prospective comparison only." } : null,
      },
      health: {
        promotionGate: gate ? {
          version: gate.gate_version,
          status: gate.status,
          autoPromote: false,
          canQualify: false,
          canAuthorize: false,
        } : { status: "UNAVAILABLE" },
        classification: latestReport?.classification || "Unable to evaluate due to data limitations",
      },
      latestReport: latestReport ? {
        reportId: latestReport.report_id,
        type: latestReport.report_type,
        season: latestReport.season,
        week: latestReport.week,
        generatedAt: latestReport.generated_at,
        sampleN: latestReport.sample_n,
        classification: latestReport.classification,
        summary: reportSummary,
      } : null,
    };
  } catch (err) {
    return unavailable(String(err?.message || err));
  }
}

function mapShadowRow(r) {
  return {
    id: r.id,
    gameId: r.game_id,
    season: r.season,
    week: r.week,
    kickoff: r.kickoff,
    homeTeam: r.home_team,
    awayTeam: r.away_team,
    homeTeamId: r.home_team_id,
    awayTeamId: r.away_team_id,
    homeConference: r.home_conference,
    awayConference: r.away_conference,
    eligibility: r.eligibility,
    missingReason: r.missing_reason,
    champion: {
      modelId: r.champion_model_id,
      spread: r.champion_spread,
      total: r.champion_total,
      home: r.champion_home,
      away: r.champion_away,
      pHomeWin: r.champion_p_home_win,
      pinnSpreadGap: (r.champion_spread != null && r.market_spread != null)
        ? r.champion_spread - r.market_spread : null,
      pinnTotalGap: (r.champion_total != null && r.market_total != null)
        ? r.champion_total - r.market_total : null,
    },
    core: {
      modelId: r.core_model_id,
      version: r.core_model_version,
      spread: r.core_spread,
      total: r.core_total,
      home: r.core_home,
      away: r.core_away,
      pHomeWin: r.core_p_home_win,
      throughWeek: r.core_through_week,
      crossMargin: r.core_cross_margin,
      crossTotal: r.core_cross_total,
      homeOffense: r.home_core_offense,
      homeDefense: r.home_core_defense,
      awayOffense: r.away_core_offense,
      awayDefense: r.away_core_defense,
      pinnSpreadGap: (r.core_spread != null && r.market_spread != null)
        ? r.core_spread - r.market_spread : null,
      pinnTotalGap: (r.core_total != null && r.market_total != null)
        ? r.core_total - r.market_total : null,
    },
    disagreement: {
      spread: r.disagreement_spread,
      total: r.disagreement_total,
      driver: r.disagreement_driver,
      provenEdge: false,
    },
    market: {
      spread: r.market_spread,
      total: r.market_total,
      capturedAt: r.market_captured_at,
      source: r.market_source,
      closingSpread: r.closing_spread,
      closingTotal: r.closing_total,
    },
    hfaPoints: r.hfa_points,
    settled: r.final_verified === 1,
    actualHome: r.actual_home,
    actualAway: r.actual_away,
    generationAt: r.generation_at,
  };
}

/**
 * Load CFB team CORE snapshots from primary DB (read-only) for freeze candidates.
 */
export async function loadCfbCoreTeamIndex(env, season) {
  if (!env?.DB?.prepare || !Number.isInteger(Number(season))) return { ok: false, byTeam: new Map(), reason: "DB_UNAVAILABLE" };
  try {
    const res = await env.DB.prepare(
      `SELECT team_id,as_of,features_json FROM team_feature_snapshots
       WHERE sport='cfb' AND season=? ORDER BY as_of DESC LIMIT 500`
    ).bind(Number(season)).all();
    const byTeam = new Map();
    for (const row of res?.results || []) {
      if (byTeam.has(row.team_id)) continue;
      const feat = parseFeatures(row.features_json) || {};
      byTeam.set(row.team_id, { ...feat, asOf: row.as_of, teamId: row.team_id });
    }
    const rated = [...byTeam.values()].filter(t => t.core != null && t.coreWeekBounded === true);
    const throughWeeks = rated.map(t => num(t.coreThroughWeek)).filter(Number.isFinite);
    return {
      ok: true,
      byTeam,
      ratedTeams: rated.length,
      totalSnapshots: byTeam.size,
      maxThroughWeek: throughWeeks.length ? Math.max(...throughWeeks) : null,
      latestAsOf: rated[0]?.asOf || null,
    };
  } catch (err) {
    return { ok: false, byTeam: new Map(), reason: String(err?.message || err) };
  }
}

function normalizeTeamName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseMatchup(matchup) {
  const raw = String(matchup || "");
  const m = raw.match(/^(.+?)\s+@\s+(.+)$/);
  if (!m) return { awayTeam: null, homeTeam: null };
  return { awayTeam: m[1].trim(), homeTeam: m[2].trim() };
}

function parsePalMeta(raw) {
  try { return typeof raw === "string" ? JSON.parse(raw || "{}") : (raw || {}); }
  catch { return {}; }
}

function findTeamFeat(teamIndex, name) {
  if (!name || !teamIndex?.byName) return null;
  return teamIndex.byName.get(normalizeTeamName(name)) || null;
}

/**
 * Cache-only freeze from prediction_snapshots / predictions + CORE team snapshots.
 * Does not call CFBD. model_predictions is optional (often absent on primary).
 */
export async function runCfbCoreShadowFreeze(env, { now = null, limit = 120 } = {}) {
  const generationAt = now || new Date().toISOString();
  const artifact = await loadCfbCoreResearchArtifact(env);
  if (!env?.DB?.prepare) {
    return { ok: false, reason: "PRIMARY_DB_UNAVAILABLE", inserted: 0, noProviderCalls: true };
  }

  const cap = Math.min(500, Math.max(1, limit));
  let preds = [];
  let source = "prediction_snapshots";
  try {
    preds = (await env.DB.prepare(
      `SELECT game_id,date,matchup,model_version,proj_home,proj_away,p_home_final,frozen_at,
              pin_home_ml,pin_away_ml,pal_json,projection_kind
       FROM prediction_snapshots
       WHERE sport='cfb' AND actual_home IS NULL AND date >= date('now','-1 day')
       ORDER BY date ASC, frozen_at DESC LIMIT ?`
    ).bind(cap).all())?.results || [];
  } catch {
    preds = [];
  }
  if (!preds.length) {
    try {
      preds = (await env.DB.prepare(
        `SELECT game_id,date,matchup,model_version,proj_home,proj_away,p_home_final as p_home_final,
                as_of as frozen_at, pin_home_ml, pin_away_ml, pal_json, projection_kind
         FROM predictions
         WHERE sport='cfb' AND actual_home IS NULL AND date >= date('now','-1 day')
         ORDER BY date ASC, as_of DESC LIMIT ?`
      ).bind(cap).all())?.results || [];
      source = "predictions";
    } catch (err) {
      return { ok: false, reason: String(err?.message || err), inserted: 0, noProviderCalls: true };
    }
  }

  const season = new Date().getUTCFullYear();
  const teamIndex = await loadCfbCoreTeamIndex(env, season);
  // Name index for matchup parsing (canonical team_id map alone is insufficient).
  teamIndex.byName = new Map();
  for (const feat of teamIndex.byTeam.values()) {
    const key = normalizeTeamName(feat.team || feat.school || feat.displayName);
    if (key && !teamIndex.byName.has(key)) teamIndex.byName.set(key, feat);
  }

  const records = [];
  const seen = new Set();
  for (const p of preds) {
    const gid = String(p.game_id);
    if (seen.has(gid)) continue;
    seen.add(gid);
    const pal = parsePalMeta(p.pal_json);
    const parsed = parseMatchup(p.matchup);
    const homeTeam = pal.homeName || parsed.homeTeam;
    const awayTeam = pal.awayName || parsed.awayTeam;
    const homeFeat = findTeamFeat(teamIndex, homeTeam);
    const awayFeat = findTeamFeat(teamIndex, awayTeam);
    const kickoff = pal.start || pal.kickoff || (p.date ? `${p.date}T19:00:00Z` : p.frozen_at);
    const week = num(pal.week) ?? estimateCfbWeekFromDate(p.date || kickoff, season);
    const kickMs = Date.parse(String(kickoff || ""));
    // Ungraded snapshots remain freeze-eligible. CORE PIT still requires
    // throughWeek < gameWeek and CORE observed before kickoff.
    const frozenAfterKickoff = Number.isFinite(kickMs) && kickMs < Date.parse(generationAt);

    const marketSpread = num(pal.pinSpread);
    const marketTotal = num(pal.pinTotal);
    const marketCapturedAt = (marketSpread != null || marketTotal != null)
      ? (p.frozen_at || generationAt) : null;

    const rec = buildCfbCoreShadowRecord({
      gameId: gid,
      season: num(pal.season) || season,
      week,
      kickoff,
      homeTeamId: homeFeat?.teamId || homeFeat?.canonicalId || null,
      awayTeamId: awayFeat?.teamId || awayFeat?.canonicalId || null,
      homeTeam,
      awayTeam,
      homeConference: homeFeat?.conference || null,
      awayConference: awayFeat?.conference || null,
      neutralSite: false,
      championModelId: p.projection_kind === "FBIS" ? "CFB-FBIS-v2" : (p.model_version || "CFB-CHAMPION"),
      championModelVersion: p.model_version,
      championHome: num(p.proj_home),
      championAway: num(p.proj_away),
      championPHomeWin: num(p.p_home_final),
      homeFeatures: homeFeat,
      awayFeatures: awayFeat,
      home: homeFeat,
      away: awayFeat,
    }, {
      artifact,
      market: marketCapturedAt ? {
        spread: marketSpread,
        total: marketTotal,
        mlHome: num(p.pin_home_ml),
        mlAway: num(p.pin_away_ml),
        capturedAt: marketCapturedAt,
        source: "PinnOdds",
      } : null,
      now: generationAt,
    });
    if (frozenAfterKickoff) {
      rec.provenance = {
        ...rec.provenance,
        frozenAfterKickoff: true,
        note: "Ungraded snapshot freeze; CORE still week-bounded and pre-kickoff observed.",
      };
    }
    records.push(rec);
  }
  const freeze = await freezeCfbCoreShadowRecords(env, records);
  return {
    ...freeze,
    source,
    candidates: records.length,
    eligibleProjected: records.filter(r => r.eligibility === "eligible_projected").length,
    flagged: records.filter(r => r.eligibility !== "eligible_projected").length,
    artifactLoaded: Boolean(artifact),
    teamCoverage: {
      ratedTeams: teamIndex.ratedTeams ?? null,
      maxThroughWeek: teamIndex.maxThroughWeek ?? null,
      reason: teamIndex.reason || null,
    },
    noProviderCalls: true,
    authority: "research_only",
    canAuthorizeWager: false,
  };
}

export async function runCfbCoreShadowSettle(env, { now = null } = {}) {
  if (!env?.DB?.prepare) return { ok: false, reason: "PRIMARY_DB_UNAVAILABLE", settled: 0 };
  let graded = [];
  try {
    graded = (await env.DB.prepare(
      `SELECT game_id,actual_home,actual_away FROM prediction_snapshots
       WHERE sport='cfb' AND actual_home IS NOT NULL AND actual_away IS NOT NULL
       ORDER BY frozen_at DESC LIMIT 400`
    ).all())?.results || [];
  } catch {
    graded = [];
  }
  if (!graded.length) {
    try {
      graded = (await env.DB.prepare(
        `SELECT game_id,actual_home,actual_away FROM predictions
         WHERE sport='cfb' AND actual_home IS NOT NULL AND actual_away IS NOT NULL
         ORDER BY as_of DESC LIMIT 400`
      ).all())?.results || [];
    } catch (err) {
      return { ok: false, reason: String(err?.message || err), settled: 0 };
    }
  }
  const settlements = graded.map(g => ({
    gameId: g.game_id,
    actualHome: num(g.actual_home),
    actualAway: num(g.actual_away),
    finalVerified: true,
  }));
  return settleCfbCoreShadowRecords(env, settlements);
}

export async function persistCfbCoreEvaluationReport(env, report, { reportType = "walkforward", season = null, week = null } = {}) {
  const db = tier3(env);
  if (!db?.prepare) return { ok: false, reason: "TIER3_DB_UNAVAILABLE" };
  const reportId = `core-eval-${reportType}-${Date.now()}`;
  const now = new Date().toISOString();
  try {
    await db.prepare(
      `INSERT INTO cfb_core_evaluation_reports
      (report_id,report_type,season,week,generated_at,sample_n,classification,summary_json,folds_json,market_json,ablation_json,coverage_json,residual_risks_json,authority,can_authorize_wager,artifact_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'research_only',0,?,?)`
    ).bind(
      reportId, reportType, season, week, now,
      report.eligibleRows || 0,
      report.classification || "Unable to evaluate due to data limitations",
      j({
        comparison: report.comparison,
        decision: report.decision,
        dataLimitations: report.dataLimitations,
        verifiedOos: report.verifiedOos,
        marketSummary: report.marketSummary,
      }),
      j(report.folds || []),
      j(report.marketSummary || null),
      j(report.ablation || null),
      j({ eligibleRows: report.eligibleRows, excluded: report.excluded, seasons: report.seasons }),
      j(report.dataLimitations || []),
      report.artifact?.artifactId || null,
      now
    ).run();
    if (report.artifact?.verifiedOos) {
      await saveCfbCoreResearchArtifact(env, { ...report.artifact, artifactId: report.artifact.artifactId || `core-art-${reportId}` }, reportId);
    }
    return { ok: true, reportId };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function runCfbCoreWeeklyEvaluation(env, { rows = null } = {}) {
  // Prefer explicit offline rows; otherwise build a limitation report from live coverage.
  if (Array.isArray(rows) && rows.length) {
    const report = evaluateCfbCoreResearch(rows);
    const saved = await persistCfbCoreEvaluationReport(env, report, { reportType: "weekly_walkforward" });
    return { ok: true, report, saved };
  }
  const dash = await loadCfbCoreShadowDashboard(env, { limit: 20 });
  const teamIndex = await loadCfbCoreTeamIndex(env, new Date().getUTCFullYear());
  const limitationReport = {
    modelId: CFB_CORE_SHADOW_ID,
    authority: "research_only",
    canAuthorizeWager: false,
    eligibleRows: 0,
    excluded: { LIVE_MULTI_SEASON_PIT_CORE_UNAVAILABLE: 1 },
    seasons: [],
    folds: [],
    comparison: { n: 0, champion: {}, coreOnly: {}, combined: {} },
    ablation: { n: 0 },
    marketSummary: { folds: 0, note: "No eligible PIT historical CORE+market rows in live D1." },
    dataLimitations: [
      "NO_ELIGIBLE_PIT_CORE_ROWS",
      "INSUFFICIENT_MULTI_SEASON_COVERAGE",
      "CURRENT_CORE_THROUGH_WEEK_IS_NOT_HISTORICAL_ARCHIVE",
      teamIndex.maxThroughWeek != null
        ? `LIVE_CORE_THROUGH_WEEK_${teamIndex.maxThroughWeek}_ONLY`
        : "LIVE_CORE_THROUGH_WEEK_UNKNOWN",
    ],
    classification: "Unable to evaluate due to data limitations",
    verifiedOos: false,
    artifact: null,
    decision: "INSUFFICIENT_OR_NO_INCREMENTAL_OOS_EDGE",
    coverageLive: {
      ratedTeams: teamIndex.ratedTeams,
      maxThroughWeek: teamIndex.maxThroughWeek,
      shadow: dash.coverage,
    },
    residualRisks: [
      "Week-bounded CORE currently available only for the active season snapshot window.",
      "Retrospectively revised season ratings must not be treated as pregame features.",
      "Prospective shadow must accumulate before any promotion proposal.",
    ],
  };
  const saved = await persistCfbCoreEvaluationReport(env, limitationReport, { reportType: "weekly_limitation" });
  return { ok: true, report: limitationReport, saved, dashboard: dash };
}
