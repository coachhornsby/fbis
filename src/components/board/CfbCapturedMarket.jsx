import "./cfbCapturedMarket.css";

/**
 * An observed pregame Polymarket threshold, NOT a current sportsbook spread
 * or executable quote. It must never become model/market EV authority.
 */
export default function CfbCapturedMarket({ game }) {
  if (String(game?.sport || "").toLowerCase() !== "cfb") return null;
  const item = game?.cfbCapturedMarket;
  if (!item || item.pregameReferenceOnly !== true || item.total == null) return null;
  const timestamp = Date.parse(item.capturedAt || "");
  const ct = Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleString("en-US", {
        timeZone: "America/Chicago",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }) + " CT"
    : "capture time unavailable";
  const actual = game?.score || null;
  return (
    <section className="cfb-captured-market" aria-label="Captured pregame market reference">
      <div className="cfb-captured-market-heading">
        <strong>CAPTURED PREGAME MARKET</strong>
        <span>POLYMARKET US · REFERENCE</span>
      </div>
      <div className="cfb-captured-market-values">
        <div><span>OBSERVED GAME TOTAL</span><strong>{item.total}</strong></div>
        <div><span>CAPTURED</span><strong>{ct}</strong></div>
      </div>
      <small>Matched two-sided exchange threshold. Not a live price, sportsbook consensus, or wagering authorization.</small>
    </section>
  );
}
