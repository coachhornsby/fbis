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
import {evaluateCfbProspectiveHybridRows} from "./cfbCoreProspectiveEvidence.js";
import {CHAMPION_HFA} from "./collegeModels.js";
import {estimateCfbWeekFromDate} from "./cfbCoreAdvancedPlumbing.js";
import {fetchEspnCfFinals} from "./cfbTier3WeeklyEvaluation.js";

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
  const coreProj = useMarginHybrid && vector.ok && vector.coreSourceEndpoint !== "fbis_weekly_training_document"
    ? { ok: false, reason: "HYBRID_REQUIRES_WEEKLY_TRAINING_DOCUMENT" }
    : useMarginHybrid
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
    // Source receipt time proves when the document was observed, not when its
    // statistical features were cut off. A feature cutoff is only populated
    // from explicit verification evidence supplied by the source audit.
    featureCutoffAt: str(game.featureCutoffAt || null),
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
    // Margin-only hybrid intentionally has no win-probability head; bind SQL NULL, never undefined.
    corePHomeWin: coreProj.ok ? num(coreProj.pHomeWin) : null,
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
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0,?)`
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
    if (!s?.gameId || s.finalVerified !== true || !s.sourceUrl ||
        s.scoreOrientation !== "home_away_by_competitor_homeAway" ||
        !/^https:\/\/site\.api\.espn\.com\//i.test(String(s.sourceUrl))) continue;
    const ah = num(s.actualHome), aa = num(s.actualAway);
    if (ah == null || aa == null) continue;
    const settlement = {
      actualMargin: ah - aa,
      actualTotal: ah + aa,
      settledAt: now,
      source: s.source || "espn-public-summary",
      sourceUrl: String(s.sourceUrl),
      scoreOrientation: s.scoreOrientation,
      researchOnly: true,
    };
    try {
      const res = await db.prepare(
        `UPDATE cfb_core_shadow_predictions SET
          actual_home=?, actual_away=?, final_verified=1, settled_at=?,
          settlement_source=?, settlement_source_url=?, settlement_orientation=?,
          settlement_verified_at=?,
          closing_spread=COALESCE(?, closing_spread),
          closing_total=COALESCE(?, closing_total),
          closing_captured_at=COALESCE(?, closing_captured_at),
          settlement_json=?
         WHERE game_id=? AND datetime(kickoff) < datetime(?)
           AND (final_verified=0 OR settlement_source_url IS NULL OR settlement_verified_at IS NULL)`
      ).bind(
        ah, aa, now,
        settlement.source, settlement.sourceUrl, settlement.scoreOrientation, now,
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

    // Count one genuinely pregame, settled prediction per game. Multiple
    // scheduled freezes must NEVER inflate prospective performance or n=200.
    const graded = (await db.prepare(
      `WITH ranked AS (
         SELECT *, ROW_NUMBER() OVER (
           PARTITION BY game_id ORDER BY generation_at ASC, id ASC
         ) AS game_freeze_rank
         FROM cfb_core_shadow_predictions
         WHERE core_model_id=? AND eligibility='eligible_projected'
           AND datetime(generation_at) < datetime(kickoff)
           AND champion_spread IS NOT NULL AND core_spread IS NOT NULL
       )
       SELECT COUNT(*) AS n,
         AVG(ABS(champion_spread - (actual_away-actual_home))) AS champ_spread_mae,
         AVG(ABS(core_spread - (actual_away-actual_home))) AS core_spread_mae,
         AVG(ABS(champion_total - (actual_home+actual_away))) AS champ_total_mae,
         AVG(ABS(core_total - (actual_home+actual_away))) AS core_total_mae
       FROM ranked WHERE game_freeze_rank=1 AND final_verified=1`
    ).bind(CFB_CORE_MARGIN_HYBRID_ID).first()) || {};

    const coverageRow = (await db.prepare(
      `SELECT
        COUNT(*) as shadow_n,
        SUM(CASE WHEN eligibility='eligible_projected' THEN 1 ELSE 0 END) as eligible_n,
        SUM(CASE WHEN eligibility!='eligible_projected' THEN 1 ELSE 0 END) as flagged_n,
        SUM(CASE WHEN final_verified=1 THEN 1 ELSE 0 END) as settled_n,
        COUNT(DISTINCT CASE WHEN core_model_id=? AND eligibility='eligible_projected'
           AND datetime(generation_at) < datetime(kickoff) THEN game_id END) AS unique_pregame_hybrid_n,
        MAX(core_through_week) as max_through_week,
        MAX(generation_at) as latest_generation
       FROM cfb_core_shadow_predictions`
    ).bind(CFB_CORE_MARGIN_HYBRID_ID).first()) || {};

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
        uniquePregameHybridGames: Number(coverageRow.unique_pregame_hybrid_n || 0),
        settledUniquePregameHybridGames: Number(graded.n || 0),
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
 * Exact game-ID join to the archived weekly FBIS/Tier3 training document.
 * The historical hybrid was fitted on adjusted EPA × 100, NOT CFBD /ratings/core.
 * Never substitute different provider ratings into the fitted coefficients.
 * received_at is the conservative first-observed timestamp; the report week
 * states the throughWeek cutoff (week - 1). Research-only until source audit.
 */
async function loadFbisWeeklyMatchups(env, season, weeks, beforeIso) {
  const db = tier3(env);
  const byGame = new Map();
  if (!db?.prepare) return byGame;
  for (const week of [...new Set(weeks)].filter(w => Number.isInteger(w) && w > 1)) {
    try {
      const rs = await db.prepare(
        `SELECT g.game_id,g.season,g.week,g.home_team_source,g.away_team_source,
                g.home_canonical_id,g.away_canonical_id,g.identity_status,
                g.point_in_time_status,g.features_json,
                s.received_at,s.provider_published_at,s.source_filename,s.source_url
         FROM cfb_tier3_training_games g
         JOIN cfb_tier3_training_snapshots s ON s.snapshot_id=g.snapshot_id
         WHERE g.season=? AND g.week=? AND s.status='research_only'
         ORDER BY CASE WHEN lower(s.source_filename) LIKE '%updated%' THEN 0 ELSE 1 END,
                  s.received_at DESC LIMIT 180`
      ).bind(season, week).all();
      for (const g of rs?.results || []) {
        if (byGame.has(String(g.game_id))) continue;
        const received=Date.parse(String(g.received_at || ""));
        if (!Number.isFinite(received) || received > Date.parse(beforeIso)) continue;
        if (!String(g.identity_status || "").startsWith("matched")) continue;
        const feat=parseFeatures(g.features_json);
        const vals=["home_adjusted_epa","home_adjusted_epa_allowed",
          "away_adjusted_epa","away_adjusted_epa_allowed"];
        if (!feat || vals.some(k => num(feat[k]) == null)) continue;
        const side=(prefix, team, canonicalId)=>({
          team, canonicalId,
          coreYear:season, coreThroughWeek:week-1,
          coreOffense:num(feat[`${prefix}_adjusted_epa`])*100,
          coreDefense:-num(feat[`${prefix}_adjusted_epa_allowed`])*100,
          coreWeekBounded:true,
          coreSourceEndpoint:"fbis_weekly_training_document",
          coreSourceAsOf:g.received_at,
          coreThroughSeasonType:"regular",
        });
        byGame.set(String(g.game_id),{
          home:side("home",g.home_team_source,g.home_canonical_id),
          away:side("away",g.away_team_source,g.away_canonical_id),
          snapshotReceivedAt:g.received_at,
          featureCutoffAt:null,
          providerPublishedAt:g.provider_published_at || null,
          sourceUrl:g.source_url || null,
          featureStatus:g.point_in_time_status,
          sourceFilename:g.source_filename,
        });
      }
    } catch { /* no row: research fail closed for this week */ }
  }
  return byGame;
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
  const targetWeeks = preds.map(p => {
    const meta = parsePalMeta(p.pal_json);
    return num(meta.week) ?? estimateCfbWeekFromDate(p.date, season);
  });
  const weeklyMatchups = await loadFbisWeeklyMatchups(env, season, targetWeeks, generationAt);
  const hybridArtifact = artifact?.modelId === CFB_CORE_MARGIN_HYBRID_ID;
  const teamIndex = hybridArtifact
    ? { byTeam: new Map(), ratedTeams: 0, reason: "FBIS_WEEKLY_REPORT_GAME_ID_SOURCE" }
    : await loadCfbCoreTeamIndex(env, season);
  // Name index for matchup parsing (canonical team_id map alone is insufficient).
  teamIndex.byName = new Map();
  for (const feat of teamIndex.byTeam.values()) {
    const key = normalizeTeamName(feat.team || feat.school || feat.displayName);
    if (key && !teamIndex.byName.has(key)) teamIndex.byName.set(key, feat);
  }

  const records = [];
  const seen = new Set();
  let skippedMissingKickoff = 0;
  let skippedAfterKickoff = 0;
  let skippedLateChampion = 0;
  let skippedMissingWeeklyMatchup = 0;
  for (const p of preds) {
    const gid = String(p.game_id);
    if (seen.has(gid)) continue;
    seen.add(gid);
    const pal = parsePalMeta(p.pal_json);
    const parsed = parseMatchup(p.matchup);
    const homeTeam = pal.homeName || parsed.homeTeam;
    const awayTeam = pal.awayName || parsed.awayTeam;
    const weekly = weeklyMatchups.get(gid);
    if (hybridArtifact && !weekly) { skippedMissingWeeklyMatchup += 1; continue; }
    const homeFeat = weekly?.home || findTeamFeat(teamIndex, homeTeam);
    const awayFeat = weekly?.away || findTeamFeat(teamIndex, awayTeam);
    // Prospective claims require an actual provider kickoff and a champion
    // snapshot recorded BEFORE that kickoff. Never synthesize a time from date.
    const kickoff = pal.start || pal.kickoff || null;
    const kickMs = Date.parse(String(kickoff || ""));
    const genMs = Date.parse(generationAt);
    const championFrozenMs = Date.parse(String(p.frozen_at || ""));
    if (!Number.isFinite(kickMs)) { skippedMissingKickoff += 1; continue; }
    if (!Number.isFinite(genMs) || genMs >= kickMs) { skippedAfterKickoff += 1; continue; }
    if (!Number.isFinite(championFrozenMs) || championFrozenMs > genMs || championFrozenMs >= kickMs) {
      skippedLateChampion += 1;
      continue;
    }
    const week = num(pal.week) ?? estimateCfbWeekFromDate(p.date || kickoff, season);

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
      featureCutoffAt: weekly?.featureCutoffAt || null,
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
    if (weekly) {
      rec.provenance = {
        ...rec.provenance,
        weeklySourceFilename:weekly.sourceFilename,
        weeklySourceUrl:weekly.sourceUrl,
        weeklyObservedAt:weekly.snapshotReceivedAt,
        sourceFeatureCutoffStatus:weekly.featureStatus,
        sourceCutoffDerivation:"report_schedule_week_minus_one",
        sourceFeatureCutoffVerified:false,
        externalProviderPublicationTimestampCaptured:Boolean(weekly.providerPublishedAt),
        providerPublishedAt:weekly.providerPublishedAt||null,
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
    skippedMissingKickoff,
    skippedAfterKickoff,
    skippedLateChampion,
    skippedMissingWeeklyMatchup,
    weeklyMatchupsAvailable: weeklyMatchups.size,
    weeklyReportSourceRequired:hybridArtifact,
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
  const db=tier3(env);
  if (!db?.prepare) return { ok: false, reason: "TIER3_DB_UNAVAILABLE", settled: 0 };
  const at=now||new Date().toISOString();
  let games=[];
  try {
    games=(await db.prepare(
      `SELECT p.game_id,p.season,p.week,p.kickoff,p.home_team,p.away_team,
              p.actual_home,p.actual_away,p.final_verified
       FROM cfb_core_shadow_predictions p
       WHERE (p.final_verified=0 OR p.settlement_source_url IS NULL OR p.settlement_verified_at IS NULL)
         AND datetime(p.kickoff)<datetime(?)
         AND datetime(p.kickoff)>=datetime(?,'-90 days')
         AND NOT EXISTS (SELECT 1 FROM cfb_core_shadow_settlement_attempts a
                         WHERE a.game_id=p.game_id AND datetime(a.last_attempt_at)>datetime(?,'-12 hours'))
       GROUP BY p.game_id ORDER BY p.kickoff DESC LIMIT 400`
    ).bind(at,at,at).all())?.results||[];
  } catch(err) {
    return {ok:false,reason:String(err?.message||err),settled:0,source:"espn-public-summary"};
  }
  if(!games.length)return {ok:true,settled:0,attempted:0,unverified:0,source:"espn-public-summary",authority:"research_only"};
  const candidates=games.slice(0,30);
  const finals=await fetchEspnCfFinals(candidates.map(g=>g.game_id),{concurrency:8});
  const settlements=[],attempts=[];
  let unverified=0,identityMismatch=0,scoreConflict=0;
  for(const g of candidates){
    const f=finals.get(String(g.game_id));
    if(!f?.completed||f.homePoints==null||f.awayPoints==null||!f.sourceUrl){unverified++;attempts.push([g.game_id,"unverified",null]);continue;}
    const expectedHome=normalizeTeamName(g.home_team),expectedAway=normalizeTeamName(g.away_team);
    const observedHome=normalizeTeamName(f.homeName),observedAway=normalizeTeamName(f.awayName);
    if(!expectedHome||!expectedAway||expectedHome!==observedHome||expectedAway!==observedAway){identityMismatch++;attempts.push([g.game_id,"identity_mismatch",f.sourceUrl]);continue;}
    if(g.final_verified===1 && (num(g.actual_home)!==f.homePoints||num(g.actual_away)!==f.awayPoints)){
      scoreConflict++;attempts.push([g.game_id,"score_conflict",f.sourceUrl]);continue;
    }
    settlements.push({gameId:g.game_id,actualHome:f.homePoints,actualAway:f.awayPoints,
      finalVerified:true,source:f.source,sourceUrl:f.sourceUrl,
      scoreOrientation:f.scoreOrientation});
    attempts.push([g.game_id,"verified_candidate",f.sourceUrl]);
  }
  const saved=await settleCfbCoreShadowRecords(env,settlements);
  if(db.batch&&attempts.length){
    const statements=attempts.map(([gameId,outcome,url])=>db.prepare(
      `INSERT INTO cfb_core_shadow_settlement_attempts(game_id,last_attempt_at,outcome,source_url,updated_at)
       VALUES(?,?,?,?,?) ON CONFLICT(game_id) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,
       outcome=excluded.outcome,source_url=excluded.source_url,updated_at=excluded.updated_at`
    ).bind(String(gameId),at,outcome,url,at));
    try{await db.batch(statements);}catch{}
  }
  return {...saved,attempted:candidates.length,queued:games.length,verifiedCandidates:settlements.length,
    unverified,identityMismatch,scoreConflict,source:"espn-public-summary",sourceUrlStored:true,
    authority:"research_only",canAuthorizeWager:false,canInfluenceProduction:false};
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
        prospective: report.prospective ? {
          artifactId: report.prospective.artifactId,
          featureDistributionRisk: report.prospective.featureDistributionRisk,
          cutoffQualifiedGames: report.prospective.prospectiveSettledN,
          sourceCutoffUnverified: report.prospective.excluded?.source_cutoff_unverified || 0,
          finalSourceUnverified: report.prospective.excluded?.final_source_unverified || 0,
          frozenUniqueGames: report.prospective.frozenUniqueGames,
          prospectiveSettledN: report.prospective.prospectiveSettledN,
          weekClusters: report.prospective.weekClusters,
          metrics: report.prospective.metrics,
          gate: {
            decision: report.prospective.gate?.decision,
            fail: report.prospective.gate?.fail,
            autoPromote: false,
          },
        } : null,
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
  // Preserve existing explicit walk-forward evaluator when provided research rows.
  if (Array.isArray(rows) && rows.length) {
    const report = evaluateCfbCoreResearch(rows);
    const saved = await persistCfbCoreEvaluationReport(env, report, { reportType: "weekly_walkforward" });
    return { ok: saved?.ok === true, report, saved };
  }
  // First-class operational gate: genuinely prospective, immutable hybrid
  // forecasts matched against the same frozen production A/A scores.
  const artifact = await loadCfbCoreResearchArtifact(env);
  if (artifact?.modelId === CFB_CORE_MARGIN_HYBRID_ID && tier3(env)?.prepare) {
    try {
      const db = tier3(env);
      const rs = await db.prepare(
        `SELECT id,game_id,season,week,kickoff,generation_at,feature_cutoff_at,
          core_model_id,core_artifact_id,core_source_endpoint,core_through_week,eligibility,
          champion_home,champion_away,core_home,core_away,
          final_verified,actual_home,actual_away,provenance_json,
          settlement_source,settlement_source_url,settlement_orientation,settlement_verified_at
         FROM cfb_core_shadow_predictions
         WHERE core_model_id=? AND core_artifact_id=?
         ORDER BY generation_at ASC, id ASC LIMIT 3000`
      ).bind(CFB_CORE_MARGIN_HYBRID_ID, artifact.artifactId).all();
      const evidence = evaluateCfbProspectiveHybridRows(rs?.results || [], {
        artifactId: artifact.artifactId,
        historicalHoldoutN: 149,
      });
      const report = {
        eligibleRows: evidence.prospectiveSettledN,
        classification: evidence.classification,
        seasons: [2026],
        excluded: evidence.excluded,
        decision: evidence.gate.decision,
        comparison: evidence.metrics,
        verifiedOos: evidence.prospectiveSettledN > 0,
        dataLimitations: [
          ...(evidence.prospectiveSettledN < 200 ? ["PROSPECTIVE_N_BELOW_200"] : []),
          ...(Number(evidence.excluded?.source_cutoff_unverified || 0) > 0 ? ["SOURCE_FEATURE_CUTOFF_UNVERIFIED"] : []),
          ...(Number(evidence.excluded?.final_source_unverified || 0) > 0 ? ["FINAL_SCORE_SOURCE_UNVERIFIED"] : []),
          ...(evidence.gate?.fail?.includes("train-eval-baseline-mismatch-undocumented") ? ["TRAINING_VS_AA_FEATURE_DISTRIBUTION_MISMATCH_OPEN"] : []),
          "KEEP_PRODUCTION_AA_CHAMPION",
        ],
        marketSummary: null,
        folds: [],
        ablation: null,
        prospective: evidence,
      };
      const saved = await persistCfbCoreEvaluationReport(env, report, {
        reportType: "prospective_margin_hybrid",
        season: 2026,
      });
      return {
        ok: saved?.ok === true,
        report,
        saved,
        prospective: evidence,
        authority: "research_only",
        canAuthorizeWager: false,
        canInfluenceProduction: false,
      };
    } catch (err) {
      return { ok: false, reason: "PROSPECTIVE_LEDGER_EVALUATION_FAILED", detail: String(err?.message || err), authority: "research_only" };
    }
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
