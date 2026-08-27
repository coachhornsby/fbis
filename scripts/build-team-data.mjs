/**
 * One-shot builder: ESPN public APIs → canonical team files + CFB prior.
 * Sources: ESPN site/core/FPI/scoreboard only. No paid APIs.
 */
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "teams");
const CFB_OUT = join(ROOT, "data", "cfb");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const ESPN_LOGO = {
  nfl: (id, abbr) => `https://a.espncdn.com/i/teamlogos/nfl/500/${String(abbr || "").toLowerCase()}.png`,
  mlb: (id, abbr) => `https://a.espncdn.com/i/teamlogos/mlb/500/${String(abbr || "").toLowerCase()}.png`,
  nba: (id, abbr) => `https://a.espncdn.com/i/teamlogos/nba/500/${String(abbr || "").toLowerCase()}.png`,
  cfb: (id) => `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`,
  cbb: (id) => `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`,
};

async function espnJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://www.espn.com/" },
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function teamFromEspn(sport, t, extra = {}) {
  const id = String(t.id || "");
  const espnAbbr = String(t.abbreviation || "").toUpperCase();
  const abbr = extra.abbr || CANONICAL_ABBR[sport]?.[espnAbbr] || espnAbbr;
  const displayName = t.displayName || t.name || "";
  const college = sport === "cfb" || sport === "cbb";
  const school = extra.school || (college
    ? t.shortDisplayName || t.nickname || t.location || displayName
    : t.location || t.name || displayName);
  const nickname = college ? t.name || t.nickname || "" : t.nickname || t.shortDisplayName || "";
  const logoFn = ESPN_LOGO[sport];
  const logo = (t.logos || []).find((l) => (l.rel || []).includes("default"))?.href
    || (college ? logoFn(id) : logoFn(id, espnAbbr));
  const names = unique([
    displayName,
    school,
    college ? school : `${school} ${nickname}`.trim(),
    extra.aliases || [],
  ].flat());
  return {
    id: `${sport}-${id}`,
    sport,
    league: extra.league || sport.toUpperCase(),
    espnId: id,
    displayName,
    school,
    nickname,
    city: college ? school : (t.location || extra.city || school),
    abbr,
    conference: extra.conference || t.conferenceId || null,
    division: extra.division || null,
    classification: extra.classification || null,
    logo,
    color: t.color || null,
    altColor: t.alternateColor || null,
    sources: {
      espn: { id, abbr: espnAbbr, name: displayName },
      parlay: { names },
      heritage: { names: unique([displayName, school]) },
      kalshi: { names: unique([displayName, school]) },
      pal: extra.pal || null,
      savant: extra.savant || null,
    },
  };
}

const CANONICAL_ABBR = {
  nfl: { WSH: "WAS", JAC: "JAX" },
};

const NBA_STATIC = [
  ["1", "ATL", "Atlanta Hawks", "Hawks", "Atlanta"],
  ["2", "BOS", "Boston Celtics", "Celtics", "Boston"],
  ["17", "BKN", "Brooklyn Nets", "Nets", "Brooklyn"],
  ["30", "CHA", "Charlotte Hornets", "Hornets", "Charlotte"],
  ["4", "CHI", "Chicago Bulls", "Bulls", "Chicago"],
  ["5", "CLE", "Cleveland Cavaliers", "Cavaliers", "Cleveland"],
  ["6", "DAL", "Dallas Mavericks", "Mavericks", "Dallas"],
  ["7", "DEN", "Denver Nuggets", "Nuggets", "Denver"],
  ["8", "DET", "Detroit Pistons", "Pistons", "Detroit"],
  ["9", "GS", "Golden State Warriors", "Warriors", "Golden State"],
  ["10", "HOU", "Houston Rockets", "Rockets", "Houston"],
  ["11", "IND", "Indiana Pacers", "Pacers", "Indiana"],
  ["12", "LAC", "LA Clippers", "Clippers", "Los Angeles"],
  ["13", "LAL", "Los Angeles Lakers", "Lakers", "Los Angeles"],
  ["29", "MEM", "Memphis Grizzlies", "Grizzlies", "Memphis"],
  ["14", "MIA", "Miami Heat", "Heat", "Miami"],
  ["15", "MIL", "Milwaukee Bucks", "Bucks", "Milwaukee"],
  ["16", "MIN", "Minnesota Timberwolves", "Timberwolves", "Minnesota"],
  ["3", "NO", "New Orleans Pelicans", "Pelicans", "New Orleans"],
  ["18", "NY", "New York Knicks", "Knicks", "New York"],
  ["25", "OKC", "Oklahoma City Thunder", "Thunder", "Oklahoma City"],
  ["19", "ORL", "Orlando Magic", "Magic", "Orlando"],
  ["20", "PHI", "Philadelphia 76ers", "76ers", "Philadelphia"],
  ["21", "PHX", "Phoenix Suns", "Suns", "Phoenix"],
  ["22", "POR", "Portland Trail Blazers", "Trail Blazers", "Portland"],
  ["23", "SAC", "Sacramento Kings", "Kings", "Sacramento"],
  ["24", "SA", "San Antonio Spurs", "Spurs", "San Antonio"],
  ["28", "TOR", "Toronto Raptors", "Raptors", "Toronto"],
  ["26", "UTAH", "Utah Jazz", "Jazz", "Utah"],
  ["27", "WAS", "Washington Wizards", "Wizards", "Washington"],
];

function unique(xs) {
  return [...new Set(xs.map((s) => String(s || "").trim()).filter(Boolean))];
}

function parseSiteTeams(json, sport, extra = {}) {
  const leagues = json?.sports?.[0]?.leagues || json?.leagues || [];
  const teams = [];
  for (const lg of leagues) {
    for (const row of lg.teams || []) {
      const t = row.team || row;
      teams.push(teamFromEspn(sport, t, extra));
    }
  }
  return teams;
}

async function loadNflMlbNbaCbb() {
  const [nfl, mlb, nba, cbb] = await Promise.all([
    espnJson("https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams?limit=50"),
    espnJson("https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams?limit=50"),
    espnJson("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams?limit=50"),
    espnJson("https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams?limit=400"),
  ]);
  let nbaTeams = parseSiteTeams(nba, "nba", { league: "NBA" }).filter((t) =>
    NBA_STATIC.some((row) => row[0] === t.espnId)
  );
  if (nbaTeams.length < 30) {
    nbaTeams = NBA_STATIC.map(([id, abbr, display, nick, city]) =>
      teamFromEspn("nba", { id, abbreviation: abbr, displayName: display, nickname: nick, location: city, name: nick }, { league: "NBA" })
    );
  }
  return {
    nfl: parseSiteTeams(nfl, "nfl", { league: "NFL" }),
    mlb: parseSiteTeams(mlb, "mlb", { league: "MLB" }),
    nba: nbaTeams,
    cbb: parseSiteTeams(cbb, "cbb", { league: "NCAA", classification: "D1" }),
  };
}

async function loadCfbFromFpiAndScoreboards() {
  const byId = new Map();
  try {
    const fpi = await espnJson("https://site.web.api.espn.com/apis/fitt/v3/sports/football/college-football/powerindex?limit=400");
    for (const row of fpi?.teams || []) {
      const t = row.team || {};
      if (!t?.id) continue;
      const fpiCat = (row.categories || []).find((c) => c.name === "fpi");
      const rec = teamFromEspn("cfb", t, {
        league: "NCAAF",
        classification: "FBS",
        conference: t.conferenceId || null,
      });
      rec.fpi = num(fpiCat?.values?.[0]);
      rec.fpiRank = num(fpiCat?.values?.[1]);
      byId.set(rec.espnId, rec);
    }
  } catch (err) {
    console.warn("FPI team list failed", err.message);
  }
  for (const week of range(0, 16)) {
    try {
      const json = await espnJson(
        `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=2025&seasontype=2&week=${week}&limit=300`
      );
      for (const ev of json.events || []) {
        const comp = ev.competitions?.[0] || {};
        for (const c of comp.competitors || []) {
          const t = c.team || {};
          if (!t.id) continue;
          const rec = teamFromEspn("cfb", t, {
            league: "NCAAF",
            conference: t.conferenceId || null,
          });
          if (!byId.has(rec.espnId)) byId.set(rec.espnId, rec);
          else {
            const prev = byId.get(rec.espnId);
            prev.conference = prev.conference || rec.conference;
            prev.logo = prev.logo || rec.logo;
          }
        }
      }
    } catch (err) {
      console.warn(`CFB 2025 week ${week} failed`, err.message);
    }
  }
  return [...byId.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

async function loadCfbGames2025() {
  const games = [];
  const seen = new Set();
  const dates = [];
  for (let d = new Date("2025-08-23T12:00:00Z"); d <= new Date("2025-12-20T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 7)) {
    dates.push(d.toISOString().slice(0, 10).replaceAll("-", ""));
  }
  for (const stamp of dates) {
    try {
      const json = await espnJson(
        `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${stamp}&limit=300`
      );
      for (const ev of json.events || []) {
        const comp = ev.competitions?.[0] || {};
        const home = (comp.competitors || []).find((c) => c.homeAway === "home");
        const away = (comp.competitors || []).find((c) => c.homeAway === "away");
        const hs = Number(home?.score);
        const as = Number(away?.score);
        if (!home?.team?.id || !away?.team?.id || !Number.isFinite(hs) || !Number.isFinite(as)) continue;
        if (comp.status?.type?.completed !== true && comp.status?.type?.state !== "post") continue;
        const gid = String(ev.id);
        if (seen.has(gid)) continue;
        seen.add(gid);
        games.push({
          id: gid,
          week: json.week?.number ?? null,
          homeId: String(home.team.id),
          awayId: String(away.team.id),
          homeAbbr: home.team.abbreviation,
          awayAbbr: away.team.abbreviation,
          homeName: home.team.displayName || home.team.location,
          awayName: away.team.displayName || away.team.location,
          homeConf: home.team.conferenceId || null,
          awayConf: away.team.conferenceId || null,
          home: hs,
          away: as,
          neutral: Boolean(comp.neutralSite),
        });
      }
    } catch (err) {
      console.warn(`scores week ${week}`, err.message);
    }
  }
  return games;
}

function range(a, b) {
  return Array.from({ length: b - a }, (_, i) => a + i);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function computeSrs(games, hfa = 2.5, iterations = 12) {
  const ids = new Set();
  for (const g of games) {
    ids.add(g.homeId);
    ids.add(g.awayId);
  }
  const rating = {};
  const off = {};
  const def = {};
  const conf = {};
  const nGames = {};
  const pf = {};
  const pa = {};
  for (const id of ids) {
    rating[id] = 0;
    off[id] = 0;
    def[id] = 0;
    nGames[id] = 0;
    pf[id] = 0;
    pa[id] = 0;
  }
  for (const g of games) {
    nGames[g.homeId] += 1;
    nGames[g.awayId] += 1;
    pf[g.homeId] += g.home;
    pa[g.homeId] += g.away;
    pf[g.awayId] += g.away;
    pa[g.awayId] += g.home;
    conf[g.homeId] = g.homeConf;
    conf[g.awayId] = g.awayConf;
  }
  for (let i = 0; i < iterations; i++) {
    const next = {};
    const nextOff = {};
    const nextDef = {};
    const acc = {};
    const accOff = {};
    const accDef = {};
    const cnt = {};
    for (const id of ids) {
      acc[id] = 0;
      accOff[id] = 0;
      accDef[id] = 0;
      cnt[id] = 0;
    }
    for (const g of games) {
      const hfaPts = g.neutral ? 0 : hfa;
      const homeMargin = g.home - g.away - hfaPts;
      acc[g.homeId] += homeMargin + rating[g.awayId];
      acc[g.awayId] += -homeMargin + rating[g.homeId];
      accOff[g.homeId] += g.home - (26.5 + def[g.awayId]);
      accOff[g.awayId] += g.away - (26.5 + def[g.homeId]);
      accDef[g.homeId] += g.away - (26.5 + off[g.awayId]);
      accDef[g.awayId] += g.home - (26.5 + off[g.homeId]);
      cnt[g.homeId] += 1;
      cnt[g.awayId] += 1;
    }
    let mean = 0;
    for (const id of ids) {
      next[id] = cnt[id] ? acc[id] / cnt[id] : 0;
      nextOff[id] = cnt[id] ? accOff[id] / cnt[id] : 0;
      nextDef[id] = cnt[id] ? accDef[id] / cnt[id] : 0;
      mean += next[id];
    }
    mean /= ids.size || 1;
    for (const id of ids) {
      rating[id] = next[id] - mean;
      off[id] = nextOff[id];
      def[id] = nextDef[id];
    }
  }
  const confSum = {};
  const confN = {};
  for (const id of ids) {
    const c = conf[id] || "unk";
    confSum[c] = (confSum[c] || 0) + rating[id];
    confN[c] = (confN[c] || 0) + 1;
  }
  const out = {};
  for (const id of ids) {
    const c = conf[id] || "unk";
    const confAvg = confN[c] ? confSum[c] / confN[c] : 0;
    const n = nGames[id] || 0;
    const wTeam = n / (n + 4);
    const wConf = 4 / (n + 8);
    const wFbs = 1 - wTeam - wConf * 0.5;
    const shrunk = wTeam * rating[id] + wConf * 0.5 * confAvg;
    out[id] = {
      espnId: id,
      n,
      rating: round2(rating[id]),
      shrunk: round2(shrunk),
      off: round2(26.5 + off[id] * 0.6),
      def: round2(26.5 + def[id] * 0.6),
      pfPg: n ? round2(pf[id] / n) : null,
      paPg: n ? round2(pa[id] / n) : null,
      conference: c,
      provisional: n < 6,
    };
  }
  return out;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function dumpJs(name, value, extra = "") {
  return `/** Auto-generated canonical ${name} registry. ESPN IDs and verified abbreviations. Do not invent abbrs. */\n${extra}export default ${JSON.stringify(value, null, 2)};\n`;
}

function applyNflAliases(teams) {
  const extra = {
    PIT: ["Pittsburgh Steelers", "Steelers", "PIT"],
    BUF: ["Buffalo Bills", "Bills", "BUF"],
    NE: ["New England Patriots", "NE Patriots", "Patriots", "NEP"],
    CAR: ["Carolina Panthers", "Panthers", "CAR"],
    SF: ["San Francisco 49ers", "SF 49ers", "49ers", "Niners"],
    LV: ["Las Vegas Raiders", "LV Raiders", "Raiders", "Oakland Raiders", "LVR"],
    WAS: ["Washington Commanders", "Commanders", "Washington", "Washington Football Team"],
    BAL: ["Baltimore Ravens", "Ravens", "BAL"],
    JAX: ["Jacksonville Jaguars", "Jaguars", "JAC", "JAX"],
    NYG: ["New York Giants", "NY Giants", "Giants"],
    NYJ: ["New York Jets", "NY Jets", "Jets"],
    TB: ["Tampa Bay Buccaneers", "Buccaneers", "TB"],
    LAR: ["Los Angeles Rams", "LA Rams", "Rams", "St. Louis Rams"],
    LAC: ["Los Angeles Chargers", "LA Chargers", "Chargers", "San Diego Chargers"],
  };
  for (const t of teams) {
    const add = extra[t.abbr] || [];
    t.sources.parlay.names = unique([...(t.sources.parlay.names || []), ...add]);
    t.sources.heritage.names = unique([...(t.sources.heritage.names || []), ...add]);
    t.sources.kalshi.names = unique([...(t.sources.kalshi.names || []), ...add]);
  }
  return teams;
}

function applyMlbPalSavant(teams) {
  for (const t of teams) {
    t.sources.pal = { abbr: t.abbr, names: t.sources.parlay.names };
    t.sources.savant = { abbr: t.abbr, names: t.sources.parlay.names };
  }
  return teams;
}

const main = async () => {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(CFB_OUT, { recursive: true });
  console.log("fetching ESPN team lists…");
  const lists = await loadNflMlbNbaCbb();
  lists.nfl = applyNflAliases(lists.nfl);
  lists.mlb = applyMlbPalSavant(lists.mlb);
  console.log(`NFL ${lists.nfl.length} MLB ${lists.mlb.length} NBA ${lists.nba.length} CBB ${lists.cbb.length}`);
  console.log("fetching CFB identity…");
  const cfb = await loadCfbFromFpiAndScoreboards();
  console.log(`CFB ${cfb.length}`);
  console.log("fetching 2025 CFB results for SRS prior…");
  const games = await loadCfbGames2025();
  console.log(`CFB 2025 games ${games.length}`);
  const srs = computeSrs(games);
  const byEspnId = {};
  for (const team of cfb) {
    const hist = srs[team.espnId] || null;
    const fpi = Number.isFinite(team.fpi) ? team.fpi : null;
    const n = hist?.n || 0;
    const fpiOff = fpi == null ? null : clamp(26.5 + fpi, 8, 55);
    const fpiDef = fpi == null ? null : clamp(26.5 - fpi, 8, 55);
    const wHist = n / (n + 6);
    let off;
    let def;
    let source;
    if (hist && fpiOff != null) {
      off = (1 - wHist) * fpiOff + wHist * hist.off;
      def = (1 - wHist) * fpiDef + wHist * hist.def;
      source = "srs+fpi";
    } else if (hist) {
      off = hist.off;
      def = hist.def;
      source = "srs";
    } else if (fpiOff != null) {
      off = fpiOff;
      def = fpiDef;
      source = "fpi";
    } else {
      continue;
    }
    byEspnId[team.espnId] = {
      espnId: team.espnId,
      abbr: team.abbr,
      school: team.school,
      n,
      fpi,
      srs: hist?.shrunk ?? null,
      off: round2(off),
      def: round2(def),
      pfPg: hist?.pfPg ?? null,
      paPg: hist?.paPg ?? null,
      conference: hist?.conference || team.conference,
      classification: team.classification || (fpi != null ? "FBS" : "FCS"),
      provisional: n < 6 && fpi == null,
      source,
    };
  }
  writeFileSync(join(OUT, "nfl.js"), dumpJs("NFL", lists.nfl));
  writeFileSync(join(OUT, "mlb.js"), dumpJs("MLB", lists.mlb));
  writeFileSync(join(OUT, "nba.js"), dumpJs("NBA", lists.nba));
  writeFileSync(join(OUT, "cbb.js"), dumpJs("CBB", lists.cbb));
  writeFileSync(join(OUT, "cfb.js"), dumpJs("CFB", cfb));
  writeFileSync(
    join(CFB_OUT, "prior-v1.js"),
    dumpJs("CFB prior", {
      version: "cfb-prior-v1",
      season: 2025,
      methodology:
        "Team-specific preseason prior for every FBS club. ESPN FPI (public powerindex API) is expected margin vs an average opponent on a neutral field and is mapped to off/def as 26.5±FPI. Opponent-adjusted SRS is computed from ESPN 2025 Saturday finals (HFA 2.5, shrunk toward conference). Blend w_srs = n/(n+6). FCS/new FBS without FPI are provisional conference/FBS residuals. Not SP+. Champion HFA remains 2.5/0.",
      source: "ESPN FPI + ESPN college-football scoreboard 2025 Saturdays",
      hfa: 2.5,
      leaguePpg: 26.5,
      builtAt: new Date().toISOString(),
      nGames: games.length,
      nTeams: Object.keys(byEspnId).length,
      byEspnId,
    })
  );
  console.log("wrote data/teams and data/cfb/prior-v1.js");
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
