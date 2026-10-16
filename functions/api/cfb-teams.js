import { loadCfbPublicTeamFacts } from "../lib/cfbTeamPublicFacts.js";
import { toFbsTeamList, toFbsTeamProfile, toTeamFeatureSummary, toLegacyFormSummary } from "../lib/cfbTeamProfiles.js";
import {loadFbsTeamSeasonEvidence,validProfileSeason,validProfilePlayer} from "../lib/cfbTeamSeasonEvidence.js";
import { buildCfbTeamResearchPanels } from "../lib/cfbTeamResearchPanels.js";
import { flattenFeatures, latestSnapshotPerTeam } from "../lib/cfbTeamResearchRanking.js";

const headers = { "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=180" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
const baseSql = "FROM cfb_canonical_teams WHERE active=1 AND upper(trim(subdivision))='FBS'";
const validId = (v) => /^cfb:espn:\d{1,12}$/.test(String(v || ""));
const noModelAuthority = { canInfluenceProjection: false, canQualify: false, canAuthorizeWager: false };

async function optionalTeamFeatures(db, teamId) {
  // PR #927 proposes restoring team_feature_snapshots. Until then, never
  // synthesize a state or trigger acquisition just to render a profile.
  try {
    const row = await db.prepare(
      "SELECT as_of,feature_version,features_json,missingness_json,season FROM team_feature_snapshots WHERE sport='cfb' AND team_id=? ORDER BY as_of DESC LIMIT 1"
    ).bind(teamId).first();
    return toTeamFeatureSummary(row);
  } catch (error) {
    return { ...toTeamFeatureSummary(), state: "PERSISTENCE_UNAVAILABLE",
      reason: "team_feature_snapshots not readable" };
  }
}

/**
 * Read latest same-season/version FBS snapshots for FBIS research ranks.
 * Fail-closed: empty peers if table missing — never fabricates ranks or hits CFBD.
 */
async function loadFbsResearchPeers(db, { season, featureVersion, conferenceByTeam = null } = {}) {
  if (!db?.prepare || season == null || !featureVersion) return [];
  try {
    const result = await db.prepare(
      "SELECT team_id,as_of,feature_version,features_json,season FROM team_feature_snapshots WHERE sport='cfb' AND season=? AND feature_version=? ORDER BY as_of DESC LIMIT 500"
    ).bind(Number(season), String(featureVersion)).all();
    const latest = latestSnapshotPerTeam(result?.results || []);
    let conferences = conferenceByTeam;
    if (!conferences) {
      const confRows = await db.prepare(
        "SELECT team_id,current_conference " + baseSql
      ).all();
      conferences = new Map((confRows?.results || []).map((r) => [r.team_id, r.current_conference || null]));
    }
    return latest.map((row) => {
      let features = null;
      try { features = row.features_json ? JSON.parse(row.features_json) : null; } catch { features = null; }
      return {
        teamId: row.team_id,
        conference: conferences.get?.(row.team_id) ?? conferences[row.team_id] ?? null,
        features,
        flat: flattenFeatures(features || {}),
        asOf: row.as_of || null,
      };
    }).filter((p) => p.teamId && p.flat && Object.keys(p.flat).length);
  } catch {
    return [];
  }
}
async function optionalTeamForm(db, espnId, season=2026) {
  if (!espnId) return null;
  try {
    const row = await db.prepare(
      "SELECT games,points_for,points_against,updated_at FROM team_form WHERE sport='cfb' AND season=? AND team_key=?"
    ).bind(season,"id:" + espnId).first();
    return toLegacyFormSummary(row);
  } catch { return null; }
}
export async function loadFbsTeamDirectory(db, requestedTeamId = null, options = {}) {
  if (!db?.prepare) return { status: 503, body: { ok: false, error: "database-unavailable" } };
  try {
    if (requestedTeamId != null) {
      if (!validId(requestedTeamId)) {
        return { status: 400, body: { ok: false, error: "invalid-canonical-team-id" } };
      }
      const row = await db.prepare("SELECT * " + baseSql + " AND team_id=? LIMIT 1")
        .bind(requestedTeamId).first();
      const team = toFbsTeamProfile(row);
      if (!team) return { status: 404, body: { ok: false, error: "fbs-team-not-found" } };
      const season = options.season ?? 2026;
      if (!validProfileSeason(season))return {status:400,body:{ok:false,error:"invalid-season"}};
      const playerId=options.playerId||null;
      if (playerId && !validProfilePlayer(playerId))return {status:400,body:{ok:false,error:"invalid-player-id"}};
      const [featureState, legacyForm, evidence] = await Promise.all([
        optionalTeamFeatures(db, team.teamId), optionalTeamForm(db, team.espnId,season),
        loadFbsTeamSeasonEvidence(db,team,season,playerId),
      ]);
      const snapshotSeason = featureState?.season != null ? Number(featureState.season) : Number(season);
      const peers = featureState?.state === "RESEARCH_SNAPSHOT" && featureState.featureVersion
        ? await loadFbsResearchPeers(db, {
          season: snapshotSeason,
          featureVersion: featureState.featureVersion,
        })
        : [];
      const publicFacts = await (options.publicFactsLoader || loadCfbPublicTeamFacts)(team.espnId, Number(season));
      evidence.schedule = publicFacts.schedule;
      const researchPanels = buildCfbTeamResearchPanels({
        featureState, evidence,
        teamId: team.teamId,
        conference: team.conference,
        season: Number(season),
        peers,
      });
      return { status: 200, body: {
        ok: true, team, featureState, legacyForm, evidence, researchPanels,
        apRanking:publicFacts.apRanking, modelAuthority: noModelAuthority,
        storage: "PERSISTENT_D1_READ_ONLY", externalProviderRequests: 2,
      } };
    }
    const results = await db.prepare("SELECT * " + baseSql + " ORDER BY school_name ASC LIMIT 180").all();
    const teams = toFbsTeamList(results?.results || []);
    return { status: 200, body: {
      ok: true, season: 2026, subdivision: "FBS", teams, count: teams.length,
      modelAuthority: noModelAuthority, storage: "PERSISTENT_D1_READ_ONLY",
      externalProviderRequests: 0,
    } };
  } catch {
    return { status: 503, body: { ok: false, error: "cfb-team-directory-unavailable" } };
  }
}
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const teamId = url.searchParams.get("team");
  const result = await loadFbsTeamDirectory(context.env?.DB, teamId, {
    season: url.searchParams.get("season") || 2026,
    playerId: url.searchParams.get("player") || null,
    publicFactsLoader: context.publicFactsLoader,
  });
  return json(result.body, result.status);
}