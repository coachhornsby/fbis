import { decisionClass } from "./formatters.js";

export default function DecisionChip({ state, reasonCodes = [] }) {
  const label = state || "RESEARCH";
  const reason = reasonCodes?.[0] ? String(reasonCodes[0]).replace(/_/g, " ") : null;
  return (
    <span className={decisionClass(label)} title={reason || label}>
      <span className="decision-chip-label">{label}</span>
      {reason ? <span className="decision-chip-reason">{reason}</span> : null}
    </span>
  );
}
