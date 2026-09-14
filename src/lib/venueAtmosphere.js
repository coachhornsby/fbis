/** Sport → shared venue atmosphere class for game cards. */
export function venueAtmosphereClass(sport) {
  const s = String(sport || "").toLowerCase();
  if (s === "mlb") return "venue-bg venue-bg--mlb";
  if (s === "cfb") return "venue-bg venue-bg--cfb";
  if (s === "nfl") return "venue-bg venue-bg--football";
  if (s === "nba" || s === "cbb") return "venue-bg venue-bg--basketball";
  if (s === "nhl") return "venue-bg venue-bg--nhl";
  return "";
}
