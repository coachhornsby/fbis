/**
 * Canonical team logo resolver for board/cards.
 * Presentation only — never invents identity.
 *
 * Priority:
 *  1. Existing approved team.logo / logoUrl on the object
 *  2. Safe existing provider URL already attached
 *  3. null → polished abbreviation badge (caller renders fallback)
 */

export function resolveTeamLogo(team = {}) {
  if (!team || typeof team !== "object") {
    return {
      url: null,
      abbr: "—",
      name: "Team",
      available: false,
      source: "none",
    };
  }

  const abbr = String(team.abbr || team.abbreviation || "").trim().toUpperCase() || "—";
  const name =
    String(team.fullName || team.displayName || team.name || team.school || abbr || "Team").trim() ||
    "Team";

  const candidates = [team.logo, team.logoUrl, team.logoURL, team.img, team.image]
    .map((u) => String(u || "").trim())
    .filter(Boolean);

  const url = candidates.find((u) => isUsableLogoUrl(u)) || null;

  return {
    url,
    abbr,
    name,
    available: Boolean(url),
    source: url ? inferSource(url) : "none",
  };
}

function isUsableLogoUrl(url) {
  if (!url) return false;
  if (url.startsWith("/")) return true;
  if (url.startsWith("data:image/")) return true;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    // Block obviously broken placeholders
    if (/placeholder|missing|null\.png|undefined/i.test(u.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

function inferSource(url) {
  const s = String(url).toLowerCase();
  if (s.includes("espncdn.com") || s.includes("a.espncdn.com")) return "espn";
  if (s.includes("mlbstatic.com")) return "mlb";
  if (s.includes("cdn.nba.com")) return "nba";
  if (s.includes("nhle.com")) return "nhl";
  if (s.startsWith("/")) return "local";
  return "provider";
}
