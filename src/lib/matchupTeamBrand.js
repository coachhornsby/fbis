/**
 * Game Matchup badge identity: exact matchup-side evidence only.
 * UI branding is never evidence of advantage or wager qualification.
 */
export function teamHex(value) {
  const raw = String(value || "").trim();
  if (/^#?[0-9a-f]{6}$/i.test(raw) || /^#?[0-9a-f]{3}$/i.test(raw))
    return raw.startsWith("#") ? raw : `#${raw}`;
  return null;
}

export function matchupAdvantageTeam(factor, away, home) {
  const edge = String(factor?.edge || factor?.advantage || factor?.team || "").trim().toUpperCase();
  if (!edge || edge === "EVEN" || edge === "UNAVAILABLE" || edge === "UNKNOWN") return null;
  const identity = (team) => [team?.abbr, team?.fullName, team?.name]
    .filter(Boolean).some(value => String(value).trim().toUpperCase() === edge);
  const homeMatch = identity(home), awayMatch = identity(away);
  // Ambiguous identity is not a team edge and must not get an arbitrary logo.
  return homeMatch !== awayMatch ? (homeMatch ? { team: home, side: "home" } : { team: away, side: "away" }) : null;
}

export function matchupTeamColors(team) {
  return {
    primary: teamHex(team?.color || team?.primaryColor || team?.primary_color || team?.brandColor),
    secondary: teamHex(team?.secondaryColor || team?.secondary_color || team?.altColor || team?.alternateColor || team?.alternate_color),
  };
}
