/**
 * CBBD Shooting Profile Explorer -> FBIS CBB research-only team snapshots.
 * Never calls CBBD. The ONLY network entry is the scheduled college collector,
 * using one league-wide /stats/team/leaderboard response per season.
 * Snapshot observed_at is retrieval time, NEVER a historical pregame cutoff.
 */
import { mapSourceTeam, hashPayload } from "./collegeIdentity.js";

export const CBB_TEAM_PROFILE_VERSION = "cbb-team-profile-v1";
export const CBB_TEAM_PROFILE_ENDPOINT = "/stats/team/leaderboard";

const num = (value) => {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const safe = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : {};
const nameKey = (v) => String(v || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g," ").trim();

function fourFactors(v) {
  const unit = safe(v);
  const f = safe(unit.fourFactors);
  return {
    effectiveFieldGoalPct: num(f.effectiveFieldGoalPct ?? unit.effectiveFieldGoalPct),
    turnoverRatio: num(f.turnoverRatio ?? unit.turnoverRatio),
    offensiveReboundPct: num(f.offensiveReboundPct ?? unit.offensiveReboundPct),
    freeThrowRate: num(f.freeThrowRate ?? unit.freeThrowRate),
  };
}
function unitSummary(value) {
  const u = safe(value);
  return {
    points: num(safe(u.points).total),
    possessions: num(u.possessions),
    rawOffensiveRating: num(u.rawOffensiveRating ?? u.rating),
    trueShootingPct: num(u.trueShootingPct ?? u.trueShooting),
    threePointPct: num(safe(u.threePointFieldGoals).pct),
    threePointAttempts: num(safe(u.threePointFieldGoals).attempted),
    twoPointPct: num(safe(u.twoPointFieldGoals).pct),
    freeThrowPct: num(safe(u.freeThrows).pct),
    offensiveRebounds: num(safe(u.rebounds).offensive),
    defensiveRebounds: num(safe(u.rebounds).defensive),
    turnovers: num(safe(u.turnovers).total),
    fourFactors: fourFactors(u),
  };
}

/**
 * Only explicit, provider-present values. No default-to-zero or retrospective
 * "as of game" semantics. Unrecognized identities are quarantined, not guessed.
 */
export function buildCbbTeamProfiles(rows, {season, observedAt} = {}) {
  const year = Number(season);
  const when = Date.parse(observedAt || "");
  if (!Number.isInteger(year) || year < 2014 || !Number.isFinite(when)) {
    throw new Error("CBB_PROFILE_SEASON_OR_OBSERVED_AT_REQUIRED");
  }
  if (!Array.isArray(rows)) throw new Error("CBB_PROFILE_LEADERBOARD_ARRAY_REQUIRED");
  const profiles = [], unresolved = [], seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    if (Number(row.season) !== year) {
      unresolved.push({team:row.team ?? null,reason:"season-mismatch"});
      continue;
    }
    const team = String(row.team || "").trim();
    // Resolve by full team name, not a potentially non-ESPN provider ID.
    const mapped = mapSourceTeam("cbb",{school:team},year);
    if (!mapped.ok || !team || !mapped.canonicalId) {
      unresolved.push({team:team||null,providerTeamId:row.teamId??null,reason:"canonical-identity-unresolved"});
      continue;
    }
    // A name collision must not overwrite another team's snapshot.
    if (seen.has(mapped.canonicalId)) {
      unresolved.push({team,providerTeamId:row.teamId??null,reason:"duplicate-canonical-identity"});
      continue;
    }
    seen.add(mapped.canonicalId);
    const shot = safe(row.shotProfile), distribution = safe(shot.distribution);
    const adjusted = safe(row.adjustedEfficiency);
    const r = safe(row.record), summary = safe(row.summary);
    const sample = num(summary.trackedShots);
    const profile = {
      version:CBB_TEAM_PROFILE_VERSION,
      source:"cbbd",
      sourceEndpoint:CBB_TEAM_PROFILE_ENDPOINT,
      season:year,
      observedAt:new Date(when).toISOString(),
      canonicalTeamId:mapped.canonicalId,
      providerTeamId:row.teamId==null?null:String(row.teamId),
      team:mapped.school,
      providerTeamName:team,
      conference:safe(row.conference).abbreviation ?? (typeof row.conference === "string"?row.conference:null),
      record:{games:num(r.games),wins:num(r.wins),losses:num(r.losses)},
      pace:num(summary.pace),
      trackedShots:sample,
      rawNetRating:num(summary.rawNetRating),
      adjustedEfficiency:{
        offense:num(adjusted.offensiveRating),
        defense:num(adjusted.defensiveRating),
        net:num(adjusted.netRating),
        ranks:{
          offense:num(safe(adjusted.rankings).offense),
          defense:num(safe(adjusted.rankings).defense),
          net:num(safe(adjusted.rankings).net),
        },
      },
      offense:unitSummary(row.teamStats),
      defenseAllowed:unitSummary(row.opponentStats),
      shooting:{
        atRim:{rate:num(safe(shot.atRim).rate),pct:num(safe(shot.atRim).pct)},
        twoPointJumper:{rate:num(safe(shot.twoPointJumper).rate),pct:num(safe(shot.twoPointJumper).pct)},
        threePointJumper:{rate:num(safe(shot.threePointJumper).rate),pct:num(safe(shot.threePointJumper).pct)},
        threeRate:num(distribution.threeRate),
        jumperRate:num(distribution.jumperRate),
        midrangeRate:num(distribution.midrangeRate),
        assistedPct:num(shot.assistedPct),
      },
      quality:{
        sampleTrackedShots:sample,
        shootingAvailable:sample !== null && sample > 0,
        // Opponent shot-location profile is not in this endpoint.
        opponentShotLocationAvailable:false,
        staleForHistoricalPregame:true,
      },
      governance:{mode:"RESEARCH",canInfluenceProjection:false,canQualify:false,canAuthorizeWager:false},
    };
    profiles.push(profile);
  }
  return {profiles,unresolved,total:rows.length,matched:profiles.length,unresolvedCount:unresolved.length};
}

export async function persistCbbTeamProfiles(env,rows,{season,observedAt=new Date().toISOString(),jobRunId=null}={}) {
  if (!env?.DB?.prepare || !env?.DB?.batch)
    return {ok:false,reason:"CBB_PROFILE_D1_REQUIRED",networkCalls:0};
  const built=buildCbbTeamProfiles(rows,{season,observedAt});
  if (!built.profiles.length)
    return {ok:false,reason:"CBB_PROFILE_NO_MATCHED_TEAMS",...built,networkCalls:0};
  try {
    // Abort rather than reporting success when migration has not landed.
    const table=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cbb_team_profile_snapshots'").first();
    if (!table?.name) return {ok:false,reason:"CBB_PROFILE_SCHEMA_NOT_APPLIED",...built,networkCalls:0};
    let inserted=0, already=0;
    for (let offset=0;offset<built.profiles.length;offset+=40) {
      const group=built.profiles.slice(offset,offset+40);
      const stmt=[];
      for (const p of group) {
        const hash=await hashPayload(p);
        const id=`cbb-profile:${p.canonicalTeamId}:${p.season}:${p.observedAt.slice(0,10)}:${hash.slice(0,20)}`;
        stmt.push(env.DB.prepare(`INSERT OR IGNORE INTO cbb_team_profile_snapshots
          (snapshot_id,canonical_team_id,provider_team_id,season,observed_at,source,
           source_endpoint,profile_version,profile_json,content_hash,job_run_id,
           research_only,can_influence_projection,can_qualify,can_authorize_wager,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,1,0,0,0,?)`)
          .bind(id,p.canonicalTeamId,p.providerTeamId,p.season,p.observedAt,"cbbd",
            CBB_TEAM_PROFILE_ENDPOINT,CBB_TEAM_PROFILE_VERSION,JSON.stringify(p),hash,
            jobRunId,p.observedAt));
      }
      const result=await env.DB.batch(stmt);
      if (!Array.isArray(result) || result.length !== group.length)
        throw new Error("CBB_PROFILE_D1_BATCH_RESULT_INCOMPLETE");
      for (const entry of result) {
        const n=Number(entry?.meta?.changes||0);
        if (n > 0) inserted+=n;else already+=1;
      }
    }
    return {ok:true,source:"cbbd",season:Number(season),matched:built.matched,
      unresolvedCount:built.unresolvedCount,unresolvedExamples:built.unresolved.slice(0,10),
      inserted,already,networkCalls:0,researchOnly:true,canInfluenceProjection:false};
  } catch (err) {
    return {ok:false,reason:String(err?.message||err),matched:built.matched,
      unresolvedCount:built.unresolvedCount,networkCalls:0,researchOnly:true};
  }
}
