import { matchupSignalColors } from "./matchupTeamBrand.js";

/**
 * Display-only team branding for score/market comparison cards.
 * Teams are selected by verified source-side signals elsewhere; colors never imply
 * wager qualification, and unknown colors remain neutral.
 */
export function gapBrandColor(team, rawTeam, sport) {
  const primary = matchupSignalColors(team, sport);
  const raw = matchupSignalColors(rawTeam, sport);
  const chosen = {
    primary: primary.primary || raw.primary || null,
    secondary: primary.secondary || raw.secondary || null,
  };
  if (!chosen.primary) return chosen.secondary;
  // Black/white/near-gray primary marks produce weak accents on the dark board.
  // Prefer a documented secondary team color instead of fabricating a vivid color.
  const value = chosen.primary.replace("#", "");
  const full = value.length === 3 ? [...value].map(c => c + c).join("") : value;
  const rgb = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
  if (Math.max(...rgb) - Math.min(...rgb) < 38 && chosen.secondary) return chosen.secondary;
  return chosen.primary;
}

export function gapDirection(side) {
  const direction = String(side || "").trim().toLowerCase();
  return direction === "over" || direction === "under" ? direction : "even";
}
