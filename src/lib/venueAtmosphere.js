/** Sport → shared venue atmosphere class for game cards. */
export function venueAtmosphereClass(sport) {
  const s = String(sport || "").toLowerCase();
  if (s === "mlb") return "venue-bg venue-bg--mlb";
  if (s === "cfb") return "venue-bg venue-bg--cfb";
  if (s === "nfl") return "venue-bg venue-bg--football";
  if (s === "nba") return "venue-bg venue-bg--nba";
  if (s === "cbb") return "venue-bg venue-bg--basketball";
  if (s === "nhl") return "venue-bg venue-bg--nhl";
  return "";
}

/** Use real game/team venue art when supplied; otherwise CSS keeps the sport fallback. */
export function venueAtmosphereStyle(game) {
  const venue = game?.venue && typeof game.venue === "object" ? game.venue : null;
  const candidates = [
    game?.venueImage,
    game?.stadiumImage,
    game?.backgroundImage,
    game?.context?.venueImage,
    venue?.image,
    venue?.imageUrl,
    venue?.photo,
    game?.home?.venueImage,
    game?.home?.stadiumImage,
  ];
  const url = candidates.find(isSafeImageUrl);
  return url ? { "--venue-image": `url("${String(url).replace(/["\\]/g, "")}")` } : undefined;
}

function isSafeImageUrl(value) {
  return typeof value === "string" && (/^https:\/\//i.test(value) || /^\/(?!\/)/.test(value));
}
