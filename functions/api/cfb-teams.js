import { productSportDbHandle } from "../lib/databaseTopology.js";
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

/** Canonical team page IDs are `cfb:espn:N`; snapshots may use `cfb-N` or bare N. */
function teamFeatureIdCandidates(teamId) {
  const raw = String(teamId || "");
  const ids = new Set([raw]);
  const espn = /^(?:cfb:espn:|cfb-)?(\d{1,12})$/.exec(raw);
  if (espn) {
    ids.add(espn[1]);
    ids.add(`cfb-${espn[1]}`);
    ids.add(`cfb:espn:${espn[1]}`);
  }
  return [...ids];
}

async function optionalTeamFeatures(db, teamId, season) {
  // Never synthesize a state or trigger acquisition just to render a profile.
  // Try dual ID forms so page stats and the projection engine share one source.
  try {
    for (const id of teamFeatureIdCandidates(teamId)) {
      const row = await db.prepare(
        "SELECT as_of,feature_version,features_json,missingness_json,season FROM team_feature_snapshots WHERE sport='cfb' AND team_id=? AND season=? ORDER BY as_of DESC LIMIT 1"
      ).bind(id, Number(season)).first();
      if (row) return toTeamFeatureSummary(row);
    }
    return toTeamFeatureSummary();
  } catch (error) {
    return { ...toTeamFeatureSummary(), state: "PERSISTENCE_UNAVAILABLE",
      reason: "team_feature_snapshots not readable" };
  }
}

/**
 * Read latest same-season/version FBS snapshots for FBIS research ranks.
 * Fail-closed: empty peers if table missing — never fabricates ranks or hits CFBD.
 */
function canonicalEspnTeamId(teamId) {
  const espn = /^(?:cfb:espn:|cfb-)?(\d{1,12})$/.exec(String(teamId || ""));
  return espn ? `cfb:espn:${espn[1]}` : String(teamId || "");
}

async function loadFbsResearchPeers(db, { season, featureVersion, conferenceByTeam = null, sportDb = db } = {}) {
  if (!db?.prepare || season == null || !featureVersion) return { peers: [], totalFbs: null, conferenceCounts: {} };
  try {
    const result = await db.prepare(
      "SELECT team_id,as_of,feature_version,features_json,season FROM team_feature_snapshots WHERE sport='cfb' AND season=? AND feature_version=? ORDER BY as_of DESC LIMIT 500"
    ).bind(Number(season), String(featureVersion)).all();
    const latest = latestSnapshotPerTeam(result?.results || []);
    let conferences = conferenceByTeam;
    if (!conferences) {
      const confRows = await sportDb.prepare(
        "SELECT team_id,current_conference " + baseSql
      ).all();
      conferences = new Map((confRows?.results || []).map((r) => [r.team_id, r.current_conference || null]));
    }
    const conferenceCounts = {};
    for (const conf of conferences.values()) {
      if (conf) conferenceCounts[conf] = (conferenceCounts[conf] || 0) + 1;
    }
    const peers = latest.map((row) => {
      const canonicalId = canonicalEspnTeamId(row.team_id);
      if (!conferences.has(canonicalId) && !conferences.has(row.team_id)) return null;
      let features = null;
      try { features = row.features_json ? JSON.parse(row.features_json) : null; } catch { features = null; }
      return {
        teamId: canonicalId,
        sourceTeamId: row.team_id,
        conference: conferences.get?.(canonicalId) ?? conferences.get?.(row.team_id) ?? conferences[canonicalId] ?? conferences[row.team_id] ?? null,
        features,
        flat: flattenFeatures(features || {}),
        asOf: row.as_of || null,
      };
    }).filter((p) => p && p.teamId && p.flat && Object.keys(p.flat).length);
    return { peers, totalFbs: conferences.size, conferenceCounts };
  } catch {
    return { peers: [], totalFbs: null, conferenceCounts: {} };
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
  const sportDb = options.sportDb || db;
  if (!db?.prepare || !sportDb?.prepare) return { status: 503, body: { ok: false, error: "database-unavailable" } };
  try {
    if (requestedTeamId != null) {
      if (!validId(requestedTeamId)) {
        return { status: 400, body: { ok: false, error: "invalid-canonical-team-id" } };
      }
      const row = await sportDb.prepare("SELECT * " + baseSql + " AND team_id=? LIMIT 1")
        .bind(requestedTeamId).first();
      const team = toFbsTeamProfile(row);
      if (!team) return { status: 404, body: { ok: false, error: "fbs-team-not-found" } };
      const season = options.season ?? 2026;
      if (!validProfileSeason(season))return {status:400,body:{ok:false,error:"invalid-season"}};
      const playerId=options.playerId||null;
      if (playerId && !validProfilePlayer(playerId))return {status:400,body:{ok:false,error:"invalid-player-id"}};
      const [featureState, legacyForm, evidence] = await Promise.all([
        optionalTeamFeatures(db, team.teamId,season), optionalTeamForm(sportDb, team.espnId,season),
        loadFbsTeamSeasonEvidence(db,team,season,playerId,{sportDb}),
      ]);
      const snapshotSeason = featureState?.season != null ? Number(featureState.season) : Number(season);
      const peerPopulation = featureState?.state === "RESEARCH_SNAPSHOT" && featureState.featureVersion
        ? await loadFbsResearchPeers(db, {
          season: snapshotSeason,
          featureVersion: featureState.featureVersion,
           sportDb,
        })
        : { peers: [], totalFbs: null, conferenceCounts: {} };
      const publicFacts = await (options.publicFactsLoader || loadCfbPublicTeamFacts)(team.espnId, Number(season));
      evidence.schedule = publicFacts.schedule;
      const researchPanels = buildCfbTeamResearchPanels({
        featureState, evidence,
        teamId: team.teamId,
        conference: team.conference,
        season: Number(season),
        peers: peerPopulation.peers,
        expectedNationalCount: peerPopulation.totalFbs,
        expectedConferenceCount: peerPopulation.conferenceCounts[team.conference] ?? null,
      });
      return { status: 200, body: {
        ok: true, team, featureState, legacyForm, evidence, researchPanels,
        apRanking:publicFacts.apRanking, modelAuthority: noModelAuthority,
        storage: "PERSISTENT_D1_READ_ONLY", externalProviderRequests: 2,
      } };
    }
    const results = await sportDb.prepare("SELECT * " + baseSql + " ORDER BY school_name ASC LIMIT 180").all();
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
    sportDb: productSportDbHandle(context.env,"cfb").db,
    season: url.searchParams.get("season") || 2026,
    playerId: url.searchParams.get("player") || null,
    publicFactsLoader: context.publicFactsLoader,
  });
  return json(result.body, result.status);
}