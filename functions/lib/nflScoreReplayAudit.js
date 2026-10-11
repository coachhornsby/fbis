/**
 * NFL-PRO-v1.2 audit-only score replay.
 * Consumes the frozen model result and its original pregame decomposition.
 * Never writes to projection, qualification, or wager authority.
 */
const finite = value => typeof value === "number" && Number.isFinite(value);
const round1 = value => Math.round((value + Number.EPSILON) * 10) / 10;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export function replayNflProScore(projection, { tolerance = 0.11 } = {}) {
  if (!projection?.ok || !projection?.decomposition) {
    return { ok: false, reconciled: false, reason: "frozen-decomposition-unavailable" };
  }
  const d = projection.decomposition;
  const base = d.baseLeaguePpg;
  if (!finite(base)) return { ok: false, reconciled: false, reason: "missing-league-baseline" };
  const replaySide = (side) => {
    const row = d[side];
    if (!row || !finite(row.teamPower) || !finite(row.qb?.value) || !finite(row.context) || !finite(row.hfa))
      return { ok: false, reason: "missing-core-components" };
    const matchup = row.matchup || {};
    const keys = ["pass", "rush", "explosive", "pressure", "trenches"];
    const parts = keys.map(k => finite(matchup[k]) ? matchup[k] : 0);
    const matchTotal = parts.reduce((s, x) => s + x, 0);
    if (!finite(matchup.total) || Math.abs(matchTotal - matchup.total) > 1e-7)
      return { ok: false, reason: "matchup-subtotal-mismatch" };
    const terms = {
      baseline: base, teamPower: row.teamPower, matchup: matchTotal,
      quarterback: row.qb.value * 0.55, tracking: row.tracking?.value ?? 0,
      specialTeams: row.specialTeams ?? 0, context: row.context, homeField: row.hfa,
    };
    if (Object.values(terms).some(v => !finite(v)))
      return { ok: false, reason: "invalid-component" };
    const raw = Object.values(terms).reduce((s, n) => s + n, 0);
    const preWeather = round1(clamp(raw, 8, 42));
    const factor = projection.weatherTotalFactor;
    const final = finite(factor) && factor > 0 && factor !== 1
      ? round1(preWeather * factor) : preWeather;
    return { ok: true, terms, raw, preWeather, final, clampEffect: clamp(raw, 8, 42) - raw };
  };
  const home = replaySide("home");
  const away = replaySide("away");
  if (!home.ok || !away.ok) {
    return { ok: false, reconciled: false, reason: home.reason || away.reason, home, away };
  }
  const reconstructed = {
    home: home.final, away: away.final,
    margin: round1(home.final - away.final),
    total: round1(home.final + away.final),
  };
  const differences = Object.fromEntries(
    Object.entries(reconstructed).map(([k, v]) =>
      [k, finite(projection[k]) ? round1(v - projection[k]) : null])
  );
  const reconciled = Object.values(differences).every(v => v !== null && Math.abs(v) <= tolerance);
  return {
    ok: true, reconciled, modelId: projection.modelId, version: projection.version,
    inputStatus: "provided-projection-only", sourcePITVerified: false,
    home, away, reconstructed, differences,
    reason: reconciled ? null : "published-score-mismatch",
    note: "Arithmetic reconciliation is not proof of pregame input provenance; verify immutable PIT record separately.",
  };
}
