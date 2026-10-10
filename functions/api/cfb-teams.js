import { toFbsTeamList, toFbsTeamProfile, toTeamFeatureSummary, toLegacyFormSummary } from "../lib/cfbTeamProfiles.js";

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
      "SELECT as_of,feature_version,features_json,missingness_json FROM team_feature_snapshots WHERE sport='cfb' AND team_id=? ORDER BY as_of DESC LIMIT 1"
    ).bind(teamId).first();
    return toTeamFeatureSummary(row);
  } catch (error) {
    return { ...toTeamFeatureSummary(), state: "PERSISTENCE_UNAVAILABLE",
      reason: "team_feature_snapshots not readable" };
  }
}
async function optionalTeamForm(db, espnId) {
  if (!espnId) return null;
  try {
    const row = await db.prepare(
      "SELECT games,points_for,points_against,updated_at FROM team_form WHERE sport='cfb' AND season=2026 AND team_key=?"
    ).bind("id:" + espnId).first();
    return toLegacyFormSummary(row);
  } catch { return null; }
}
export async function loadFbsTeamDirectory(db, requestedTeamId = null) {
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
      const [featureState, legacyForm] = await Promise.all([
        optionalTeamFeatures(db, team.teamId), optionalTeamForm(db, team.espnId),
      ]);
      return { status: 200, body: {
        ok: true, team, featureState, legacyForm, modelAuthority: noModelAuthority,
        storage: "PERSISTENT_D1_READ_ONLY", externalProviderRequests: 0,
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
  const result = await loadFbsTeamDirectory(context.env?.DB, teamId);
  return json(result.body, result.status);
}