/**
 * Fail-closed team/event matching.
 * Never match on mascot last-word alone. Never match one team only.
 */

const STOP = new Set(["the", "of", "at", "and", "st", "saint", "university", "univ", "college"]);
const WEAK = new Set(["state", "tech", "forest", "university", "univ", "college", "st"]);
const MASCOT = new Set([
  "tigers", "bulldogs", "eagles", "wildcats", "panthers", "bears", "lions", "knights",
  "hawks", "wolves", "cougars", "mustangs", "gators", "seminoles", "spartans", "trojans",
  "huskies", "bruins", "buffaloes", "bison", "rams", "owls", "hornets", "wasps", "bees",
  "pirates", "rebels", "raiders", "warriors", "chiefs", "indians", "redhawks", "bluejays",
  "jayhawks", "sooners", "longhorns", "aggies", "mean", "green", "wave", "gamecocks",
  "tarheels", "tar", "heels", "demon", "deacons", "mountaineers", "volunteers", "commodores",
  // CFB identity fluff (Action often ships school+mascot; FBIS slate is school-only).
  "wolverines", "buckeyes", "crimson", "tide", "nittany", "fighting", "irish",
  "razorbacks", "hurricanes", "seminole", "boilermakers", "hoosiers", "badgers",
  "gophers", "illini", "cornhuskers", "cyclones", "sun", "devils", "utes", "cougar",
  // NFL nicknames so city↔full-name can resolve when abbrs are missing.
  "bills", "dolphins", "patriots", "jets", "ravens", "bengals", "browns", "steelers",
  "texans", "colts", "jaguars", "titans", "broncos", "chiefs", "chargers", "raiders",
  "cowboys", "giants", "eagles", "commanders", "bears", "lions", "packers", "vikings",
  "falcons", "panthers", "saints", "buccaneers", "bucs", "cardinals", "rams",
  "seahawks", "niners", "49ers", "fortyniners",
]);

export function normName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[''`´ʻʼ]/g, "")
    .replace(/[.]/g, "")
    .replace(/&/g, " and ")
    .replace(/\((oh|ohio)\)/g, " ohio ")
    .replace(/\b(st)\b/g, "saint")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extra lookup keys so Miami Ohio ↔ Miami OH without collapsing Miami (FL). */
export function nameLookupKeys(s) {
  const n = normName(s);
  if (!n) return [];
  const keys = new Set([n]);
  keys.add(n.replace(/\boh\b/g, "ohio"));
  keys.add(n.replace(/\bohio\b/g, "oh"));
  return [...keys];
}

function tokens(s) {
  return normName(s).split(" ").filter((t) => t && !STOP.has(t));
}

function distinctive(s) {
  return tokens(s).filter((t) => t.length >= 2 && !MASCOT.has(t));
}

function strong(tokensList) {
  return tokensList.filter((t) => !WEAK.has(t) && t.length >= 2);
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
  const sta = strong(da);
  const stb = strong(db);
  if (!sta.length || !stb.length) return false;
  const strongInter = sta.filter((t) => stb.includes(t));
  if (!strongInter.length) return false;
  if (da.join(" ") === db.join(" ")) return true;
  if (sta.every((t) => stb.includes(t)) || stb.every((t) => sta.includes(t))) return true;
  const sa = new Set(da);
  const sb = new Set(db);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  const jaccard = inter / new Set([...sa, ...sb]).size;
  return jaccard >= 0.8 && inter >= 1 && strongInter.length >= 1;
}

/**
 * Stricter club equality for provider↔FBIS event joins.
 * Builds on namesMatch, then requires:
 *   - identical WEAK school disambiguators (tech/state/forest)
 *   - identical non-fluff cores (rejects Miami ⊆ Miami Ohio; allows Georgia ⊆ Georgia Bulldogs)
 */
export function namesMatchStrict(a, b) {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (!namesMatch(a, b)) return false;
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return false;

  const aWeak = ta.filter((t) => WEAK.has(t)).slice().sort().join(" ");
  const bWeak = tb.filter((t) => WEAK.has(t)).slice().sort().join(" ");
  if (aWeak !== bWeak) return false;

  // Nickname / mascot fluff stripped only for this strict core check.
  // Keep school disambiguators (tech/state/forest) out of FLUFF — those are WEAK.
  const FLUFF = new Set([
    ...MASCOT,
    // Common Action full-name mascots (Liberty Flames, Kent State Golden Flashes,
    // Wofford Terriers, Gardner-Webb Runnin' Bulldogs, etc.).
    "flames",
    "flashes",
    "terriers",
    "golden",
    "runnin",
    "running",
  ]);
  const core = (toks) =>
    [...new Set(toks.filter((t) => t && !WEAK.has(t) && !FLUFF.has(t) && !STOP.has(t)))].sort();
  const ca = core(ta);
  const cb = core(tb);
  if (!ca.length || !cb.length) return false;
  if (ca.length !== cb.length) return false;
  return ca.every((t, i) => t === cb[i]);
}

export function abbrMatch(a, b) {
  const na = String(a || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const nb = String(b || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return Boolean(na && nb && na === nb && na.length >= 2);
}

function teamNameCandidates(team) {
  const names = [team?.name, team?.school, team?.fullName, team?.nickname, team?.abbr];
  const sources = team?.sources || {};
  for (const key of ["parlay", "heritage", "espn", "kalshi", "pal", "savant"]) {
    const src = sources[key];
    if (!src) continue;
    if (src.name) names.push(src.name);
    if (src.abbr) names.push(src.abbr);
    if (Array.isArray(src.names)) names.push(...src.names);
  }
  return [...new Set(names.filter(Boolean).map((n) => String(n)))];
}

export function teamsMatch(gameHome, gameAway, eventHome, eventAway) {
  const homeOk = teamNameCandidates(gameHome).some(
    (n) => namesMatch(n, eventHome) || abbrMatch(n, eventHome)
  );
  const awayOk = teamNameCandidates(gameAway).some(
    (n) => namesMatch(n, eventAway) || abbrMatch(n, eventAway)
  );
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
