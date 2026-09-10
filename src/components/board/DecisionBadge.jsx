export default function DecisionBadge({ tier, pick }) {
  const label = String(tier || "PASS").toUpperCase();
  return (
    <div className={`decision-badge decision-${label}`} aria-label={`Decision ${label}${pick ? `: ${pick}` : ""}`}>
      <span className="decision-badge-tier">{label}</span>
      {pick ? <span className="decision-badge-pick">{pick}</span> : null}
    </div>
  );
}
