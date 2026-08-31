/** MLB player-prop contract matching and fail-closed conviction qualification. */

const MIN_PROBABILITY = 0.62;
const MIN_EV = 0.10;
const MAX_PRICE_AGE_MS = 90 * 60 * 1000;
const SPORTSBOOKS = ["pinnacle", "fanduel", "draftkings", "betmgm", "caesars", "bet365", "betrivers", "bovada"];

function clean(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

export function canonicalPropMarket(value) {
  const x = clean(value);
  if (/hits runs rbi|hrrbi|hits\+runs/.test(x)) return null;
  if (/batter/.test(x) && /strikeout/.test(x)) return null;
  if (/hits allowed|pitcher.*hit/.test(x)) return null;
  if (/pitcher.*strikeout|player strikeout/.test(x)) return "pitcher_strikeouts";
  if (/pitcher.*out|recorded outs/.test(x)) return "pitcher_outs";
  if (/total base/.test(x)) return "batter_total_bases";
  if (/\brbi/.test(x)) return "batter_rbis";
  if (/home run/.test(x)) return "batter_home_runs";
  if (/stolen base/.test(x)) return "batter_stolen_bases";
  if (/double/.test(x)) return "batter_doubles";
  if (/triple/.test(x)) return "batter_triples";
  if (/walk/.test(x)) return "batter_walks";
  if (/batter_runs|player_runs|runs scored/.test(x) && !/\brbi/.test(x)) return "batter_runs";
  if (/player hits|batter.*hit|^hits$/.test(x)) return "batter_hits";
  return null;
}

export function samePlayer(a, b) {
  const aa = clean(a);
  const bb = clean(b);
  if (!aa || !bb) return false;
  if (aa === bb) return true;
  const ap = aa.split(" ");
  const bp = bb.split(" ");
  return ap.at(-1) === bp.at(-1) && ap[0]?.[0] === bp[0]?.[0];
}

function decimalProfit(price) {
  const n = Number(price);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? n / 100 : 100 / Math.abs(n);
}

export function propEv(probability, price) {
  const profit = decimalProfit(price);
  if (profit == null || probability == null) return null;
  const p = Number(probability);
  return p * profit - (1 - p);
}

function freshEnough(snapshotAt, now) {
  if (!snapshotAt) return false;
  const ts = Date.parse(snapshotAt);
  return Number.isFinite(ts) && now - ts >= 0 && now - ts <= MAX_PRICE_AGE_MS;
}

function conventionalSportsbook(value) {
  const x = clean(value).replace(/\s+/g, "");
  if (/pick6|prizepicks|underdog|sleeper|pickem/.test(x)) return false;
  return SPORTSBOOKS.some((book) => x.includes(book));
}

function fullGameContract(book) {
  const label = clean(`${book.marketKey || ""} ${book.marketLabel || ""}`);
  return !/(1st|first) inn|first inning|nrfi|yrfi/.test(label);
}

export function buildPropConvictions({ palProps = [], sportsbookProps = [], lineupsOfficial = false, confirmedPitcherIds = [], now = Date.now() } = {}) {
  const starterIds = new Set((confirmedPitcherIds || []).map(Number).filter(Number.isFinite));
  const out = [];
  for (const book of sportsbookProps) {
    if (!conventionalSportsbook(book.bookmaker || book.bookmakerKey) || !fullGameContract(book)) continue;
    const market = canonicalPropMarket(book.marketKey || book.marketLabel);
    if (!market || book.line == null || book.overPrice == null || book.underPrice == null || !freshEnough(book.snapshotAt, now)) continue;
    const matches = palProps.filter((pal) => canonicalPropMarket(pal.displayName || pal.marketId) === market && samePlayer(pal.playerName, book.playerName) && Number(pal.line) === Number(book.line));
    if (matches.length !== 1) continue;
    const pal = matches[0];
    const pitcherMarket = market.startsWith("pitcher_");
    const confirmedStarter = pitcherMarket && starterIds.has(Number(pal.playerId));
    if (pitcherMarket && !lineupsOfficial && !confirmedStarter) continue;
    const lineupNote = confirmedStarter ? "confirmed starter" : lineupsOfficial ? "confirmed lineup" : "unofficial lineup";
    for (const side of ["over", "under"]) {
      const probability = Number(pal[side]);
      const price = Number(side === "over" ? book.overPrice : book.underPrice);
      const ev = propEv(probability, price);
      if (!Number.isFinite(probability) || probability < MIN_PROBABILITY || ev == null || ev < MIN_EV) continue;
      out.push({ playerName: book.playerName, market, marketLabel: book.marketLabel || pal.displayName, side: side.toUpperCase(), line: Number(book.line), price,
        projection: pal.average, probability, ev, book: book.bookmaker, snapshotAt: book.snapshotAt, tag: "CONVICTION",
        reason: `Exact player, statistic and line matched; ${lineupNote}; p=${(probability * 100).toFixed(1)}%; EV=${(ev * 100).toFixed(1)}%` });
    }
  }
  const best = new Map();
  for (const row of out) {
    const key = [clean(row.playerName), row.market, row.side, row.line].join(":");
    if (!best.has(key) || row.ev > best.get(key).ev) best.set(key, row);
  }
  return [...best.values()].sort((a, b) => b.ev - a.ev);
}

export function summarizeMlbPropWatch(games = [], parlayMeta = {}) {
  const mlb = (games || []).filter((g) => g.sport === "mlb" || g.sport == null);
  const convictions = mlb.reduce((n, g) => n + (g.propConvictions || []).length, 0);
  const sportsbookContracts = mlb.reduce((n, g) => n + Number(g.sportsbookPropCount || 0), 0);
  const palProps = mlb.reduce((n, g) => n + Number(g.palPropCount || 0), 0);
  const skipped = Boolean(parlayMeta.skipped) || parlayMeta.propFeedStatus === "skipped";
  let status = parlayMeta.propFeedStatus || "not-applicable";
  if (skipped) status = "skipped";
  else if (!status || status === "not-applicable") {
    if (parlayMeta.propFeedError) status = "error";
    else if (sportsbookContracts > 0) status = "available";
    else status = "empty";
  }
  return {
    status,
    error: parlayMeta.propFeedError || null,
    skipped,
    cached: Boolean(parlayMeta.cached),
    sportsbookContracts,
    palProps,
    convictions,
  };
}

/** Operator-facing feed errors — never dump vendor JSON onto the board. */
export function shortenFeedError(err) {
  const s = String(err || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (/CREDIT_LIMIT_REACHED|OUT_OF_USAGE_CREDITS|MONTHLY CREDIT LIMIT/i.test(s)) return "Parlay credits exhausted this period";
  const http = s.match(/^(Parlay \d{3})/i);
  if (http) return http[1];
  return s.length > 90 ? `${s.slice(0, 87)}…` : s;
}

/** Honest empty copy. Zero contracts is not the same as zero qualified edges. */
export function propWatchEmptyCopy(watch) {
  if (!watch) return "No conviction player props currently qualify.";
  if (watch.skipped || watch.status === "skipped") {
    return "Sportsbook prop feed is not on this view yet. TODAY is cache-only; collect fills it.";
  }
  if (watch.status === "error") {
    const detail = watch.error ? `: ${shortenFeedError(watch.error)}` : "";
    return `Sportsbook prop feed error${detail}. Zero does not mean no edge.`;
  }
  if (watch.status === "empty" || Number(watch.sportsbookContracts || 0) === 0) {
    return "No sportsbook prop contracts to compare — not an evaluated empty board.";
  }
  return "No conviction player props currently qualify.";
}

export function propWatchSummary(watch) {
  if (!watch) return "";
  if (watch.convictions) {
    return `${watch.convictions} conviction ${watch.convictions === 1 ? "prop" : "props"} · ${watch.sportsbookContracts} sportsbook contracts · Pal ${watch.palProps}`;
  }
  return propWatchEmptyCopy(watch);
}

/** TODAY health sentence. Omit empty Pal/props fragments so the line never ends in "MLB props: ." */
export function todayFeedNote(health = {}, mlbPropWatch) {
  const pal = health.pal || {};
  const bits = [health?.todayCacheOnly === false
    ? "Live odds requested for the selected sport. Missing Pinnacle still means no eligible market."
    : "Cache-only odds on this page. Missing Pinnacle is context, not a bet."];
  const hasPal =
    pal.matched != null ||
    pal.unmatched != null ||
    pal.mlbGames != null ||
    pal.recordsReturned != null ||
    pal.usable != null ||
    pal.reason ||
    pal.error;
  if (hasPal) {
    const palBits = [`${pal.matched ?? 0} matched / ${pal.unmatched ?? 0} unmatched`];
    if (pal.mlbGames != null) palBits.push(`of ${pal.mlbGames} MLB games`);
    const extras = [];
    if (pal.recordsReturned != null) extras.push(`Pal records ${pal.recordsReturned}`);
    if (pal.usable != null) extras.push(`usable ${pal.usable}`);
    if (pal.ambiguous) extras.push(`ambiguous ${pal.ambiguous}`);
    if (pal.reason) extras.push(String(pal.reason));
    if (pal.error) extras.push(shortenFeedError(pal.error));
    let line = `Pal last collect: ${palBits.join(" ")}`;
    if (extras.length) line += ` · ${extras.join(" · ")}`;
    bits.push(`${line}.`);
  }
  const props = propWatchSummary(mlbPropWatch);
  if (props) {
    if (mlbPropWatch?.convictions) bits.push(`MLB props: ${props}.`);
    else bits.push(props.endsWith(".") ? props : `${props}.`);
  }
  return bits.join(" ");
}

/** Compute convictions then drop raw prop arrays from the client payload. */
export function compactMlbClientGame(game, now = Date.now()) {
  if (!game) return game;
  const sportsbookProps = game.odds?.playerProps || [];
  const palProps = game.bpp?.props || [];
  const propConvictions =
    game.propConvictions ||
    buildPropConvictions({
      palProps,
      sportsbookProps,
      lineupsOfficial: Boolean(game.bpp?.lineupsOfficial || game.lineupsOfficial),
      confirmedPitcherIds: [game.bpp?.homeSp?.id, game.bpp?.awaySp?.id],
      now,
    });
  return {
    ...game,
    propConvictions,
    sportsbookPropCount: game.sportsbookPropCount ?? sportsbookProps.length,
    palPropCount: game.palPropCount ?? palProps.length,
    odds: game.odds ? { ...game.odds, playerProps: [] } : game.odds,
    bpp: game.bpp ? { ...game.bpp, props: [] } : game.bpp,
  };
}

export function compactMlbSlatePayload(payload, now = Date.now()) {
  if (!payload || payload.sport !== "mlb") return payload;
  return {
    ...payload,
    games: (payload.games || []).map((g) => compactMlbClientGame(g, now)),
  };
}
