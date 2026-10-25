/** Source-backed inning context from MLB StatsAPI hydrated linescore.
 * Inning side is never determined by clock, score, or home/away batting guess.
 */
export function readMlbInningState(linescore = {}) {
  const rawInning = linescore?.currentInning;
  const numeric = rawInning === "" || rawInning == null ? NaN : Number(rawInning);
  const inning = Number.isInteger(numeric) && numeric > 0 && numeric <= 30 ? numeric : null;
  const rawHalf = String(linescore?.inningState || linescore?.inningHalf || "").trim().toLowerCase();
  let inningHalf = rawHalf === "top" ? "TOP"
    : ["bottom", "bot"].includes(rawHalf) ? "BOT"
    : ["middle", "mid"].includes(rawHalf) ? "MID"
    : rawHalf === "end" ? "END" : null;
  if (!inningHalf && typeof linescore?.isTopInning === "boolean") {
    inningHalf = linescore.isTopInning ? "TOP" : "BOT";
  }
  return { inning, inningHalf };
}
