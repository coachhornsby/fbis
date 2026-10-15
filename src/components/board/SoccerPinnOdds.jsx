export default function SoccerPinnOdds({game, className = "cgc-status-note"}) {
  if (game?.sport !== "soccer") return null;
  const offers = (game.market?.venueOffers || []).filter(o =>
    o.source === "PinnOdds" && o.period === "full_game" &&
    ["moneyline", "spread", "total"].includes(o.marketFamily) && o.decimalOdds > 1);
  if (!offers.length) return null;
  return <div className={className} aria-label="PinnOdds soccer market prices">
    <strong>PINNODDS · LAST CAPTURE</strong>
    {offers.slice(0, 12).map((o, i) => <span key={`${o.sourceMarketId}-${o.sourceOutcomeId}-${i}`}>
      {o.marketFamily} · {o.side}{o.line == null ? "" : ` ${o.line}`} · {o.decimalOdds.toFixed(2)} decimal
      {o.marketFamily === "moneyline" ? ` · implied ${(100 / o.decimalOdds).toFixed(1)}%` : ""}
      {o.historicalReference ? " · older capture" : ""}{` · collected ${o.collectedAt}`}{o.providerObservedAt ? ` · provider ${o.providerObservedAt}` : " · provider quote time unknown"}
    </span>)}
    <small>Observed book prices · implied probabilities include margin · all lines in Market Details</small>
  </div>;
}
