/**
 * Format only verified feed clock/period context: never infer elapsed time
 * from kickoff or the browser wall clock.
 */
const FOOTBALL_QUARTER = new Set(["cfb", "nfl", "nba", "wnba"]);
const normalize = v => String(v == null ? "" : v).trim();
function periodFromDetail(detail) {
  const q = detail.match(/\bQ(?:UARTER\s*)?([1-4])\b/i);
  if (q) return Number(q[1]);
  const word = detail.match(/\b([1-4])(?:st|nd|rd|th)\s*(?:quarter|qtr)?\b/i);
  return word ? Number(word[1]) : null;
}
function readClock(value, detail) {
  const raw = normalize(value);
  if (/^\d{1,3}:[0-5]\d$/.test(raw)) return raw;
  // ESPN fallback shortDetail is frequently "7:42 - 3rd".
  const matched = detail.match(/\b(\d{1,3}:[0-5]\d)\b/);
  return matched?.[1] || null;
}
function inningOrdinal(n) {
  const v = Math.abs(n) % 100;
  const suffix = v >= 11 && v <= 13 ? "TH"
    : n % 10 === 1 ? "ST"
    : n % 10 === 2 ? "ND"
    : n % 10 === 3 ? "RD" : "TH";
  return `${n}${suffix}`;
}

/** Baseball is inning-based. Never render a football-style clock for a live inning. */
function formatBaseballInning(game, detail) {
  const rawStatus = game?.status;
  const rawInning = game?.statusInning ?? rawStatus?.inning ?? game?.statusPeriod ?? null;
  let inning = rawInning == null || rawInning === "" ? NaN : Number(rawInning);
  const found = detail.match(/\\b(?:top|bottom|bot|middle|mid|end)\\s+(?:of\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\b/i);
  if (!Number.isInteger(inning) && found) inning = Number(found[1]);
  if (!Number.isInteger(inning) || inning < 1 || inning > 30) inning = null;
  const explicit = String(game?.statusInningHalf ?? rawStatus?.inningHalf ?? "").trim().toLowerCase();
  const rawHalf = explicit || detail.match(/\\b(top|bottom|bot|middle|mid|end)\\b/i)?.[1]?.toLowerCase() || "";
  const half = rawHalf === "top" ? "TOP" : ["bottom","bot"].includes(rawHalf) ? "BOT"
    : ["middle","mid"].includes(rawHalf) ? "MID" : rawHalf === "end" ? "END" : null;
  if (half && inning) return `${half} · ${inningOrdinal(inning)}`;
  if (inning) return `INNING · ${inningOrdinal(inning)}`;
  return "INNING N/A";
}
export function formatLiveGameClock(game = {}) {
  const raw = game?.status;
  const live = raw === "live" || raw === "halftime" ||
    raw?.live === true || raw?.state === "in";
  if (!live) return null;
  const detail = normalize(game?.statusDetail || raw?.detail);
  const sport = normalize(game?.sport).toLowerCase();
  if (["mlb","npb","kbo"].includes(sport)) return formatBaseballInning(game, detail);
  if (/\bhalf\s*time\b/i.test(detail) || raw === "halftime") return "HALFTIME";
  const end = detail.match(/\bend\s+of\s+(?:the\s+)?([1-4])(?:st|nd|rd|th)\b/i);
  if (end) return `END Q${end[1]}`;
  const rawPeriod = game?.statusPeriod ?? raw?.period;
  const period = Number.isInteger(Number(rawPeriod)) && Number(rawPeriod) >= 1
    ? Number(rawPeriod) : periodFromDetail(detail);
  const clock = readClock(game?.statusClock ?? raw?.clock, detail);
  const label = period
    ? FOOTBALL_QUARTER.has(sport) ? period <= 4 ? `Q${period}` : period === 5 ? "OT" : `${period - 4}OT`
      : sport === "cbb" ? `H${period}`
      : sport === "nhl" ? `P${period}`
      : `PERIOD ${period}`
    : "LIVE";
  if (!clock) return period ? `${label} · CLOCK N/A` : "CLOCK N/A";
  if (period && FOOTBALL_QUARTER.has(sport) && period > 4)
    return `${label} · ${clock}`;
  return `${label} · ${clock} LEFT`;
}
