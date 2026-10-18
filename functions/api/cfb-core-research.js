/**
 * CFB CORE research dashboard API.
 * Read-only. Research-only authority. Never triggers CFBD acquisition.
 */
import {loadCfbCoreShadowDashboard, loadCfbCoreTeamIndex, loadCfbCoreResearchArtifact} from "../lib/cfbCoreShadowLedger.js";
import {CFB_CORE_SHADOW_ID} from "../lib/cfbCoreChallenger.js";
import {CFB_CORE_PROMOTION_GATE_V1} from "../lib/cfbCorePromotion.js";
import {CHAMPION_CFB} from "../lib/collegeModels.js";

const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=60",
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });

async function allowanceHint(env) {
  // Independent provider allowance is optional; never invent remaining calls.
  try {
    if (!env?.DB?.prepare) return { available: false, reason: "primary-db-unavailable" };
    // Prefer acquisition health table if present; otherwise unavailable.
    const row = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='cfbd_acquisition_state' LIMIT 1`
    ).first();
    if (!row) return { available: false, reason: "acquisition-state-unavailable" };
    const state = await env.DB.prepare(
      `SELECT provider_remaining, month, updated_at FROM cfbd_acquisition_state ORDER BY updated_at DESC LIMIT 1`
    ).first();
    if (!state) return { available: false, reason: "no-acquisition-rows" };
    return {
      available: true,
      providerRemaining: state.provider_remaining ?? null,
      month: state.month || null,
      updatedAt: state.updated_at || null,
    };
  } catch {
    return { available: false, reason: "allowance-query-failed" };
  }
}

export async function onRequestGet(context) {
  const env = context.env || {};
  const url = new URL(context.request.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 80));
  const season = Number(url.searchParams.get("season")) || new Date().getUTCFullYear();

  const [dash, teamIndex, artifact, allowance] = await Promise.all([
    loadCfbCoreShadowDashboard(env, { limit }),
    loadCfbCoreTeamIndex(env, season),
    loadCfbCoreResearchArtifact(env),
    allowanceHint(env),
  ]);

  const health = {
    ratedFbsTeams: teamIndex.ok ? teamIndex.ratedTeams : null,
    totalTeamSnapshots: teamIndex.ok ? teamIndex.totalSnapshots : null,
    currentCoreThroughWeek: teamIndex.maxThroughWeek,
    teamIndexReason: teamIndex.reason || null,
    staleOrMissingNote: teamIndex.maxThroughWeek != null
      ? `CORE through-week ${teamIndex.maxThroughWeek} is not automatically valid for later weeks without a newer week-bounded publish.`
      : "CORE through-week unavailable",
    shadowProjectionCoverage: dash.coverage || null,
    evaluationSampleSize: dash.accuracy?.n ?? 0,
    providerAllowance: allowance,
    successfulIngestion: teamIndex.ok && teamIndex.ratedTeams > 0,
    failedIngestion: teamIndex.ok ? null : teamIndex.reason,
    fittedArtifact: artifact ? {
      artifactId: artifact.artifactId,
      verifiedOos: true,
      lastTrainingSeason: artifact.lastTrainingSeason,
      version: artifact.version,
    } : {
      artifactId: null,
      verifiedOos: false,
      reason: "FITTED_RESEARCH_ARTIFACT_NOT_VERIFIED",
    },
    preKickoffFeatureValidity: "Week-bounded CORE must satisfy throughWeek < gameWeek and source observed before kickoff.",
  };

  return json({
    ok: Boolean(dash.ok),
    reason: dash.ok ? null : dash.reason,
    sport: "cfb",
    challengerId: CFB_CORE_SHADOW_ID,
    championId: CHAMPION_CFB,
    authority: "research_only",
    canQualify: false,
    canAuthorizeWager: false,
    canInfluenceProduction: false,
    sections: {
      vsFbis: {
        title: "CORE vs FBIS",
        rows: dash.upcoming || [],
        note: "Side-by-side research projections. Disagreement is not proven edge.",
      },
      disagreements: {
        title: "Where CORE Disagrees",
        rows: dash.disagreements || [],
        note: "Ranked by absolute spread disagreement. Proven edge requires settled OOS + market evidence.",
      },
      predictiveAccuracy: {
        title: "Predictive Accuracy",
        prospective: dash.accuracy || null,
        historical: dash.latestReport?.summary?.comparison || null,
        classification: dash.health?.classification || dash.latestReport?.classification || null,
        sampleSizesRequired: true,
      },
      bettingEdge: {
        title: "Betting Edge Research",
        ...(dash.bettingEdge || { status: "unavailable" }),
        gameLinesOnly: true,
        playerPropsExcluded: true,
        approvedBets: false,
      },
      dataCoverage: {
        title: "Data Coverage and Health",
        ...health,
        promotionGate: CFB_CORE_PROMOTION_GATE_V1.gateVersion,
        autoPromote: false,
      },
    },
    latestReport: dash.latestReport || null,
    generatedAt: new Date().toISOString(),
  });
}
