import { recommendBundle } from "../../functions/lib/slateEngine.js";

export function withRecommendations(slate, weights) {
  if (!slate?.games) return slate;
  return {
    ...slate,
    games: slate.games.map((game) => {
      const bundle = recommendBundle(slate.sport, game, game.model, weights);
      return {
        ...game,
        rec: bundle.qualified,
        lean: bundle.lean,
      };
    }),
  };
}

export function fmtAmerican(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  return v > 0 ? `+${v}` : String(v);
}

export function fmtNum(n, d = 1) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toFixed(d);
}

export function fmtPct(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `${(Number(n) * 100).toFixed(1)}%`;
}

export function fmtMetric(n, value, format = fmtPct) {
  if (n == null || Number(n) === 0) return "N=0 — unavailable";
  return format(value);
}

export function fmtVig(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `${(Number(n) * 100).toFixed(1)}%`;
}

export function fmtSigned(n, d = 1) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  return `${v >= 0 ? "+" : ""}${v.toFixed(d)}`;
}

export function formatMarketPeriod(market, period) {
  const m = market || "—";
  if (!period) return m;
  const p = String(period) === "FULL_GAME" ? "FG" : String(period);
  return `${m} · ${p}`;
}

export function formatClv(clv, status) {
  if (status === "unavailable" || clv == null || Number.isNaN(Number(clv))) return "—";
  return fmtSigned(clv, 3);
}

export function edgeClass(n) {
  if (n == null) return "edge-neutral";
  if (n > 4) return "edge-pos-hh";
  if (n > 2) return "edge-pos-h";
  if (n > 0) return "edge-pos";
  if (n < 0) return "edge-neg";
  return "edge-neutral";
}

export function kickoff(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}
