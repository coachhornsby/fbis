/** Presentation-only treatment for the verified NHL Washington Capitals mark.
 * Restrict by sport before abbreviation: WSH occurs in other sports and feeds.
 */
export function isWashingtonCapitalsLogo(team, {abbr, name} = {}) {
  const sport = String(team?.sport || "").trim().toLowerCase();
  const canonicalId = String(team?.canonicalId || "").trim().toLowerCase();
  if (sport !== "nhl" && !canonicalId.startsWith("nhl-")) return false;
  const code = String(abbr || team?.abbr || "").trim().toUpperCase();
  const label = String(name || team?.name || team?.fullName || team?.displayName || "").trim();
  return code === "WSH" || /\bwashington capitals\b/i.test(label);
}
