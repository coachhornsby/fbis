/**
 * Read-only NHL moneyline provenance check shared by snapshot learning and
 * ledger accuracy reports. A generic/mislabelled NHL probability cannot be
 * evaluated as an NHL-PRO-v2 full-game head.
 *
 * NEVER mutate frozen snapshot rows. Market benchmark columns remain usable
 * independently of model-probability validation.
 */
export function nhlMoneylineSnapshotEvidence(row = {}) {
  if (String(row.sport || "").toLowerCase() !== "nhl")
    return { ok: true, reason: null, scope: "NON_NHL" };
  const layer = row.layers || {};
  const eventId = String(row.gameId || row.id || "");
  const cutoff = Date.parse(layer.probabilityFeatureCutoffTimestamp || "");
  const frozen = Date.parse(row.frozenAt || "");
  const start = Date.parse(row.start || "");
  const p = row.pHomeFinal ?? row.pHome;
  const probability = p == null || p === "" ? null : Number(p);
  const home = String(layer.probabilityHomeTeam || "").toUpperCase();
  const away = String(layer.probabilityAwayTeam || "").toUpperCase();
  if (
    String(row.engine || "") !== "NHL-PRO-v2" ||
    layer.probabilitySource !== "NHL-PRO-v2:FULL_GAME_INCLUDING_OT_SHOOTOUT" ||
    !eventId || String(layer.probabilitySourceEventId || "") !== eventId ||
    !home || !away || home === away ||
    (row.homeAbbr && String(row.homeAbbr).toUpperCase() !== home) ||
    (row.awayAbbr && String(row.awayAbbr).toUpperCase() !== away) ||
    !layer.probabilityModelVersion ||
    String(layer.probabilityModelVersion) !== String(row.modelVersion || "") ||
    !Number.isFinite(cutoff) || !Number.isFinite(frozen) ||
    !Number.isFinite(start) || cutoff > frozen || frozen >= start ||
    !Number.isFinite(probability) || probability < 0 || probability > 1
  ) {
    return {
      ok: false,
      reason: "NHL_FULL_GAME_PROBABILITY_PROVENANCE_UNVERIFIED",
      scope: "FULL_GAME_INCLUDING_OT_SHOOTOUT",
    };
  }
  return { ok: true, reason: null, scope: "FULL_GAME_INCLUDING_OT_SHOOTOUT" };
}

/** A separate, immutable view for accuracy/diagnostics. */
export function verifiedNhlProbabilityView(row = {}) {
  const evidence = nhlMoneylineSnapshotEvidence(row);
  if (evidence.ok) return row;
  return { ...row, pHome: null, pHomeFinal: null, pScore: null };
}
