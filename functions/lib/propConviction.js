/** MLB player-prop contract matching and fail-closed conviction qualification. */

const MIN_PROBABILITY = 0.62;
const MIN_EV = 0.10;
const MAX_PRICE_AGE_MS = 90 * 60 * 1000;

function clean(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

export function canonicalPropMarket(value) {
  const x = clean(value);
  if (/pitcher.*strikeout|strikeouts.*pitcher/.test(x)) return "pitcher_strikeouts";
  if (/pitcher.*out|recorded outs/.test(x)) return "pitcher_outs";
  if (/home run/.test(x)) return "batter_home_runs";
  if (/stolen base/.test(x)) return "batter_stolen_bases";
  if (/double/.test(x)) return "batter_doubles";
  if (/triple/.test(x)) return "batter_triples";
  if (/walk/.test(x)) return "batter_walks";
  if (/batter.*run|player.*run|runs scored/.test(x)) return "batter_runs";
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

export function buildPropConvictions({ palProps = [], sportsbookProps = [], lineupsOfficial = false, now = Date.now() } = {}) {
  if (!lineupsOfficial) return [];
  const out = [];
  for (const book of sportsbookProps) {
    const market = canonicalPropMarket(book.marketKey || book.marketLabel);
    if (!market || book.line == null || book.overPrice == null || book.underPrice == null || !freshEnough(book.snapshotAt, now)) continue;
    const matches = palProps.filter((pal) => canonicalPropMarket(pal.displayName || pal.marketId) === market && samePlayer(pal.playerName, book.playerName) && Number(pal.line) === Number(book.line));
    if (matches.length !== 1) continue;
    const pal = matches[0];
    for (const side of ["over", "under"]) {
      const probability = Number(pal[side]);
      const price = Number(side === "over" ? book.overPrice : book.underPrice);
      const ev = propEv(probability, price);
      if (!Number.isFinite(probability) || probability < MIN_PROBABILITY || ev == null || ev < MIN_EV) continue;
      out.push({ playerName: book.playerName, market, marketLabel: book.marketLabel || pal.displayName, side: side.toUpperCase(), line: Number(book.line), price,
        projection: pal.average, probability, ev, book: book.bookmaker, snapshotAt: book.snapshotAt, tag: "CONVICTION",
        reason: `Exact player, statistic and line matched; confirmed lineup; p=${(probability * 100).toFixed(1)}%; EV=${(ev * 100).toFixed(1)}%` });
    }
  }
  return out.sort((a, b) => b.ev - a.ev);
}
