export default function PopulationDescriptor({ descriptor, title = "Population descriptor" }) {
  const d = descriptor || {};
  return (
    <details className="population-descriptor" style={{ marginTop: 8 }}>
      <summary>{title}</summary>
      <div className="muted" style={{ marginTop: 6 }}>
        type={d.populationType || "—"} · sport={d.sport || "—"} · market={d.marketFamily || "—"} · period={d.periodFamily || "—"}
      </div>
      <div className="muted">
        strategy={d.strategyId || "—"} v{d.strategyVersion ?? "—"} · model={d.modelVersion || "—"} · qual={d.qualificationRuleVersion || "—"} · cp={d.checkpoint || "—"}
      </div>
      <div className="muted">
        range={d.dateRange?.since || "—"}..{d.dateRange?.until || "—"} · settled={d.settledN ?? 0} · open={d.openN ?? 0} · push={d.pushN ?? 0} · void={d.voidN ?? 0} · unresolved={d.unresolvedN ?? 0} · clvN={d.clvN ?? 0}
      </div>
      <div className="muted">
        sourceHealth={d.sourceHealth || "unknown"} · freshness={d.freshness?.lastSuccessAt || d.freshness?.lastReadSuccessAt || "—"}
      </div>
    </details>
  );
}
