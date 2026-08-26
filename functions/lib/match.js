/**
 * Fail-closed team/event matching.
 * Never match on mascot last-word alone. Never match one team only.
 */

const STOP = new Set(["the", "of", "at", "and", "st", "saint", "university", "univ"]);
const MASCOT = new Set([
  "tigers", "bulldogs", "eagles", "wildcats", "panthers", "bears", "lions", "knights",
  "hawks", "wolves", "cougars", "mustangs", "gators", "seminoles", "spartans", "trojans",
  "huskies", "bruins", "buffaloes", "bison", "rams", "owls", "hornets", "wasps", "bees",
  "pirates", "rebels", "raiders", "warriors", "chiefs", "indians", "redhawks", "bluejays",
  "jayhawks", "sooners", "longhorns", "aggies", "mean", "green", "wave", "gamecocks",
  "tarheels", "tar", "heels", "demon", "deacons", "mountaineers", "volunteers", "commodores",
]);

export function normName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[.]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(st)\b/g, "saint")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s) {
  return normName(s).split(" ").filter((t) => t && !STOP.has(t));
}

function distinctive(s) {
  return tokens(s).filter((t) => t.length > 2 && !MASCOT.has(t));
}

/** True only when both names refer to the same club. Fail closed. */
export function namesMatch(a, b) {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const da = distinctive(a);
  const db = distinctive(b);
  if (!da.length || !db.length) return false;
  if (da.join(" ") === db.join(" ")) return true;
  if (da.every((t) => db.includes(t)) || db.every((t) => da.includes(t))) return true;
  const sa = new Set(da);
  const sb = new Set(db);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  const jaccard = inter / new Set([...sa, ...sb]).size;
  return jaccard >= 0.8 && inter >= 1;
}

export function abbrMatch(a, b) {
  const na = String(a || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const nb = String(b || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return Boolean(na && nb && na === nb && na.length >= 2);
}

export function teamsMatch(gameHome, gameAway, eventHome, eventAway) {
  const homeOk =
    namesMatch(gameHome?.name, eventHome) ||
    namesMatch(gameHome?.abbr, eventHome) ||
    abbrMatch(gameHome?.abbr, eventHome);
  const awayOk =
    namesMatch(gameAway?.name, eventAway) ||
    namesMatch(gameAway?.abbr, eventAway) ||
    abbrMatch(gameAway?.abbr, eventAway);
  return Boolean(homeOk && awayOk);
}

export function kickoffProximity(aIso, bIso, maxHours = 18) {
  if (!aIso || !bIso) return true;
  const da = new Date(aIso).getTime();
  const db = new Date(bIso).getTime();
  if (!Number.isFinite(da) || !Number.isFinite(db)) return true;
  return Math.abs(da - db) <= maxHours * 3600 * 1000;
}

/** First event that matches BOTH teams (and kickoff when known). No one-team fallback. */
export function matchEvent(game, events) {
  const list = events || [];
  const both = list.filter((e) =>
    teamsMatch(
      game.home,
      game.away,
      e.homeTeam || e.home_team || e.home?.name,
      e.awayTeam || e.away_team || e.away?.name
    )
  );
  if (!both.length) return null;
  const timed = both.filter((e) =>
    kickoffProximity(game.start, e.commence || e.commence_time || e.start)
  );
  return (timed.length ? timed : both)[0] || null;
}
