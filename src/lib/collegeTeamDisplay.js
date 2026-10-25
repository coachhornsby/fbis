/**
 * Separate verified college school / nickname labels for board display.
 * Prefer the official full name minus a verified nickname to preserve
 * "San Diego State" instead of registry shorthand "San Diego St".
 * Never guess a mascot from the last word of an arbitrary name.
 */
const tidy = value => typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

export function collegeTeamDisplay(team = {}, sport = "") {
  const fallback = tidy(team.fullName || team.displayName || team.name || team.school || team.abbr) || "—";
  if (!["cfb", "cbb"].includes(String(sport).toLowerCase())) {
    return { school: fallback, mascot: null };
  }

  const mascot = tidy(team.nickname || team.mascot);
  const school = tidy(team.school);
  if (!mascot || !school || mascot.toLowerCase() === school.toLowerCase()) {
    // Missing/ambiguous identity: show the unsplit source label, not a fabricated nickname.
    return { school: fallback, mascot: null };
  }

  const fullName = tidy(team.fullName || team.displayName || "");
  const endsWithNickname = fullName.toLowerCase().endsWith(" " + mascot.toLowerCase());
  const expandedSchool = endsWithNickname ? fullName.slice(0, -(mascot.length + 1)).trim() : "";
  // Only prefer the expanded school when it has the same unambiguous identity root,
  // or the full name ends in the provider-verified nickname.
  return { school: expandedSchool || school, mascot };
}
