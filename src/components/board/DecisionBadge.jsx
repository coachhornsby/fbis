export default function DecisionBadge({ tier, label, pick }) {
  const display = String(label || tier || "PASS").toUpperCase();
  const cssTier = String(tier || "PASS").toUpperCase().replace(/\s+/g, "_");
  return (
    <div
      className={`decision-badge decision-${cssTier}`}
      aria-label={`Decision ${display}${pick ? `: ${pick}` : ""}`}
    >
      <span className="decision-badge-tier">{display}</span>
      {pick ? <span className="decision-badge-pick">{pick}</span> : null}
    </div>
  );
}
