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

/**
 * NHL club branding fallback when the scoreboard supplies only one team color.
 * Curated from NHL team metadata in the October 13, 2026 Action diagnostic
 * (team identity fields only — NOT lines, picks, or wagering evidence).
 * Prefer event-bound team colors when they are present and valid.
 */
const NHL_SIGNAL_PALETTE=Object.freeze({
  ANA: ["#000000","#91764B"],
  BOS: ["#000000","#FFC422"],
  BUF: ["#003087","#FDBB2F"],
  CAR: ["#E03A3E","#000000"],
  CBJ: ["#00285C","#E03A3E"],
  CGY: ["#E03A3E","#FFC758"],
  CHI: ["#E3263A","#000000"],
  COL: ["#8B2942","#01548A"],
  DAL: ["#006A4E","#000000"],
  DET: ["#EC1F26","#000000"],
  EDM: ["#003777","#E66A20"],
  FLA: ["#C8213F","#002E5F"],
  LA: ["#000000","#AFB7BA"],
  MIN: ["#025736","#BF2B37"],
  MTL: ["#BF2F38","#213770"],
  NJ: ["#E03A3E","#000000"],
  NSH: ["#FDBB2F","#002E62"],
  NYI: ["#00529B","#F57D31"],
  NYR: ["#0161AB","#E6393F"],
  OTT: ["#000000","#E4173E"],
  PHI: ["#F47940","#000000"],
  PIT: ["#000000","#D1BD80"],
  SEA: ["#FFFFFF","#000000"],
  SJ: ["#05535D","#F38F20"],
  STL: ["#0172B8","#FCB71B"],
  TB: ["#013E7D","#000000"],
  TOR: ["#003777","#000000"],
  UTA: ["#010101","#6CACE4"],
  VAN: ["#07346F","#047A4A"],
  VGK: ["#010101","#B4975A"],
  WPG: ["#002E62","#0168AB"],
  WSH: ["#CF132B","#00214E"],
});
const NHL_ALIASES=Object.freeze({LAK:"LA",SJS:"SJ",TBL:"TB",NJD:"NJ",UTAH:"UTA"});

/** UI-only brand selection. The team itself is chosen solely by matchup-side evidence. */
export function matchupSignalColors(team,sport) {
  const actual=matchupTeamColors(team);
  if(String(sport||"").toLowerCase()!=="nhl")return actual;
  const raw=String(team?.abbr||team?.abbreviation||"").trim().toUpperCase();
  const key=NHL_ALIASES[raw]||raw;
  const colors=NHL_SIGNAL_PALETTE[key]||null;
  return {primary:actual.primary||colors?.[0]||null,
    secondary:actual.secondary||colors?.[1]||null};
}
