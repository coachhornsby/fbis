/**
 * Canonical MLB identity for Pal matching.
 * Pal team IDs may be MLB Stats ids; ESPN ids are accepted as a second key.
 * City-only labels (NY / CHI / LA) are rejected as ambiguous.
 */

export const MLB_STATS_ID = {
  ARI: 109,
  ATL: 144,
  BAL: 110,
  BOS: 111,
  CHC: 112,
  CHW: 145,
  CIN: 113,
  CLE: 114,
  COL: 115,
  DET: 116,
  HOU: 117,
  KC: 118,
  LAA: 108,
  LAD: 119,
  MIA: 146,
  MIL: 158,
  MIN: 142,
  NYM: 121,
  NYY: 147,
  ATH: 133,
  PHI: 143,
  PIT: 134,
  SD: 135,
  SEA: 136,
  SF: 137,
  STL: 138,
  TB: 139,
  TEX: 140,
  TOR: 141,
  WSH: 120,
};

export const ESPN_MLB_ID = {
  ARI: 29,
  ATL: 15,
  BAL: 1,
  BOS: 2,
  CHC: 16,
  CHW: 4,
  CIN: 17,
  CLE: 5,
  COL: 27,
  DET: 6,
  HOU: 18,
  KC: 7,
  LAA: 3,
  LAD: 19,
  MIA: 28,
  MIL: 8,
  MIN: 9,
  NYM: 21,
  NYY: 10,
  ATH: 11,
  PHI: 22,
  PIT: 23,
  SD: 25,
  SEA: 12,
  SF: 26,
  STL: 24,
  TB: 30,
  TEX: 13,
  TOR: 14,
  WSH: 20,
};

/** Alias → canonical abbr. Null means ambiguous (do not match). */
export const MLB_ABBR_CANON = {
  ARI: "ARI",
  AZ: "ARI",
  ATL: "ATL",
  BAL: "BAL",
  BOS: "BOS",
  CHC: "CHC",
  CHI: null,
  CWS: "CHW",
  CHW: "CHW",
  CIN: "CIN",
  CLE: "CLE",
  COL: "COL",
  DET: "DET",
  HOU: "HOU",
  KC: "KC",
  KCR: "KC",
  LAA: "LAA",
  ANA: "LAA",
  LAD: "LAD",
  LA: null,
  MIA: "MIA",
  FLA: "MIA",
  MIL: "MIL",
  MIN: "MIN",
  NYM: "NYM",
  NYY: "NYY",
  NY: null,
  ATH: "ATH",
  OAK: "ATH",
  OAKLAND: "ATH",
  PHI: "PHI",
  PIT: "PIT",
  SD: "SD",
  SDP: "SD",
  SEA: "SEA",
  SF: "SF",
  SFG: "SF",
  STL: "STL",
  TB: "TB",
  TBR: "TB",
  TAM: "TB",
  TEX: "TEX",
  TOR: "TOR",
  WSH: "WSH",
  WAS: "WSH",
  WSN: "WSH",
};

const NAME_TO_CANON = {
  "arizona diamondbacks": "ARI",
  diamondbacks: "ARI",
  dbacks: "ARI",
  "atlanta braves": "ATL",
  braves: "ATL",
  "baltimore orioles": "BAL",
  orioles: "BAL",
  "boston red sox": "BOS",
  "red sox": "BOS",
  "chicago cubs": "CHC",
  cubs: "CHC",
  "chicago white sox": "CHW",
  "white sox": "CHW",
  "cincinnati reds": "CIN",
  reds: "CIN",
  "cleveland guardians": "CLE",
  guardians: "CLE",
  "colorado rockies": "COL",
  rockies: "COL",
  "detroit tigers": "DET",
  tigers: "DET",
  "houston astros": "HOU",
  astros: "HOU",
  "kansas city royals": "KC",
  royals: "KC",
  "los angeles angels": "LAA",
  angels: "LAA",
  "los angeles dodgers": "LAD",
  dodgers: "LAD",
  "miami marlins": "MIA",
  marlins: "MIA",
  "milwaukee brewers": "MIL",
  brewers: "MIL",
  "minnesota twins": "MIN",
  twins: "MIN",
  "new york mets": "NYM",
  mets: "NYM",
  "new york yankees": "NYY",
  yankees: "NYY",
  athletics: "ATH",
  "oakland athletics": "ATH",
  "philadelphia phillies": "PHI",
  phillies: "PHI",
  "pittsburgh pirates": "PIT",
  pirates: "PIT",
  "san diego padres": "SD",
  padres: "SD",
  "seattle mariners": "SEA",
  mariners: "SEA",
  "san francisco giants": "SF",
  giants: "SF",
  "st louis cardinals": "STL",
  "saint louis cardinals": "STL",
  cardinals: "STL",
  "tampa bay rays": "TB",
  rays: "TB",
  "texas rangers": "TEX",
  rangers: "TEX",
  "toronto blue jays": "TOR",
  "blue jays": "TOR",
  "washington nationals": "WSH",
  nationals: "WSH",
};

const ID_TO_CANON = new Map();
for (const [abbr, id] of Object.entries(MLB_STATS_ID)) ID_TO_CANON.set(Number(id), abbr);
for (const [abbr, id] of Object.entries(ESPN_MLB_ID)) ID_TO_CANON.set(Number(id), abbr);

export function canonAbbr(value) {
  const raw = String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!raw) return null;
  if (Object.prototype.hasOwnProperty.call(MLB_ABBR_CANON, raw)) return MLB_ABBR_CANON[raw];
  if (MLB_STATS_ID[raw]) return raw;
  return null;
}

export function canonFromName(name) {
  const key = String(name || "")
    .toLowerCase()
    .replace(/[.]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(st)\b/g, "saint")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!key) return null;
  if (NAME_TO_CANON[key]) return NAME_TO_CANON[key];
  if (key === "new york" || key === "chicago" || key === "los angeles") return null;
  return null;
}

export function canonFromTeamId(id) {
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return null;
  return ID_TO_CANON.get(n) || null;
}

/** Resolve a Pal or MLB team to a canonical abbr. Fail closed on city-only / mascot-only. */
export function resolveMlbCanon(team = {}) {
  const fromId = canonFromTeamId(team.mlbId ?? team.espnId ?? team.teamId ?? team.id);
  const fromAbbr = canonAbbr(team.abbr || team.abv || team.team);
  const fromName = canonFromName(team.name || team.displayName || team.city);
  const hits = [fromId, fromAbbr, fromName].filter(Boolean);
  if (!hits.length) return null;
  const uniq = [...new Set(hits)];
  if (uniq.length > 1) return null;
  return uniq[0];
}

export function sameMlbTeam(a, b) {
  const x = resolveMlbCanon(typeof a === "object" ? a : { abbr: a });
  const y = resolveMlbCanon(typeof b === "object" ? b : { abbr: b });
  return Boolean(x && y && x === y);
}
