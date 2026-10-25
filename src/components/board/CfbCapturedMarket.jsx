import "./cfbCapturedMarket.css";

/**
 * Captured PRE-GAME PinnOdds and Polymarket US thresholds.
 * Never present archival captures as current execution prices.
 */
export default function CfbCapturedMarket({ game }) {
  if (String(game?.sport || "").toLowerCase() !== "cfb") return null;
  const item = game?.cfbCapturedMarket;
  if (!item || item.pregameReferenceOnly !== true) return null;
  const pin = item.pinnodds || {};
  const captures = [
    pin.spread ? { label: "PINNODDS SPREAD · HOME", line: pin.spread.homeLine, at: pin.spread.capturedAt, signed: true } : null,
    pin.total ? { label: "PINNODDS TOTAL", line: pin.total.line, at: pin.total.capturedAt } : null,
    item.source === "Polymarket US" && item.total != null ? { label: "POLYMARKET US TOTAL", line: item.total, at: item.capturedAt } : null
  ].filter(Boolean);
  if (!captures.length) return null;
  const dateCt = (at) => {
    const ts = Date.parse(at || "");
    return Number.isFinite(ts)
      ? new Date(ts).toLocaleString("en-US", {
          timeZone: "America/Chicago", month: "short", day: "numeric",
          hour: "numeric", minute: "2-digit",
        }) + " CT"
      : "Capture time unavailable";
  };
  return (
    <section className="cfb-captured-market" aria-label="Captured pregame market reference">
      <div className="cfb-captured-market-heading">
        <strong>CAPTURED PREGAME MARKET LINES</strong>
        <span>REFERENCE · NOT LIVE</span>
      </div>
      <div className="cfb-captured-market-values">
        {captures.map((quote) => (
          <div key={quote.label}>
            <span>{quote.label}</span>
            <strong>{quote.signed && Number(quote.line) > 0 ? "+" : ""}{quote.line}</strong>
            <small>{dateCt(quote.at)}</small>
          </div>
        ))}
      </div>
      <small>Matched two-sided pregame captures. Captures do not establish a current sportsbook line, executable price, or wagering authorization.</small>
    </section>
  );
}
