/**
 * Semantic production smoke checks. HTTP 200 is not sufficient.
 */

const SHA_RE = /^[a-f0-9]{40}$/i;

function jsonShape(body, contentType) {
  return Boolean(body) && typeof body === "object" && String(contentType || "").includes("application/json");
}

export function evaluateProductionSmoke({
  expectedSha,
  health,
  today,
  bets,
  strategy,
  contentTypes = {},
} = {}) {
  const failures = [];
  const sha = String(health?.deploymentCommit || health?.build?.commitSha || "");
  if (!SHA_RE.test(sha)) failures.push("sha-not-full-40");
  if (expectedSha && sha.toLowerCase() !== String(expectedSha).toLowerCase()) failures.push("sha-mismatch");
  if (health?.build?.migrationStatus !== "VERIFIED") failures.push("migration-not-verified");
  if (health?.build?.schemaVersion && !String(health.build.schemaVersion).includes("0013")) {
    failures.push("migration-version-mismatch");
  }
  if (health?.d1?.writeVerification !== "VERIFIED") failures.push("d1-write-readback-unverified");
  if (health?.d1?.readOk !== true) failures.push("d1-read-failed");
  const paused =
    health?.convictionQualificationPaused === true ||
    strategy?.convictionQualification?.paused === true;
  if (!paused) failures.push("pause-not-reported");
  if (!jsonShape(health, contentTypes.health || "application/json")) failures.push("health-not-json");
  if (!jsonShape(today, contentTypes.today || "application/json")) failures.push("today-not-json");
  if (!jsonShape(bets, contentTypes.bets || "application/json")) failures.push("bets-not-json");
  if (!jsonShape(strategy, contentTypes.strategy || "application/json")) failures.push("strategy-not-json");

  const todaySport = today?.health?.todayFocusSport || today?.sport || today?.population?.board?.sport;
  const mlbGames = (today?.games || []).filter((g) => g.sport === "mlb");
  const foreign = mlbGames.filter((g) => g.sport && g.sport !== "mlb");
  if (foreign.length) failures.push("cross-sport-contamination");
  if (today && today.error && /<!doctype html/i.test(String(today.error))) failures.push("html-parsed-as-json");
  if (today && today.date && todaySport === "mlb") {
    const nonMlb = (today.games || []).filter((g) => g.sport && g.sport !== "mlb");
    if (nonMlb.length) failures.push("today-wrong-sport");
  }

  const integrity = strategy?.integrity || {};
  const recon = strategy?.historicalProbabilityReconstruction || {};
  const missingP = Number(integrity.originalProbabilityMissing || integrity.quarantined || 0);
  if (missingP > 0 && Number(integrity.invalid || 0) === 0 && Number(integrity.quarantined || 0) === 0) {
    failures.push("placeholder-zero-under-unavailable");
  }
  if (Number(recon.recoveredVerifiedN || 0) > 0 && integrity.quarantined === 0 && missingP > 0) {
    failures.push("integrity-zero-while-quarantined");
  }

  const openHeritage = Number(bets?.summary?.open || 0);
  const settlementBacklog = Number(strategy?.settlementBacklog?.heritageOpen || today?.health?.heritageOpen || 0);
  if (openHeritage > 0 && settlementBacklog === 0 && bets?.summary && strategy?.settlementBacklog) {
    failures.push("zero-settlement-backlog-while-open");
  }

  return {
    ok: failures.length === 0,
    failures,
    sha: sha || null,
    paused,
  };
}
