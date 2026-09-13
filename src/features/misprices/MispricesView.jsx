import { useEffect, useState } from "react";

/** Misprices board — disagreement vs calibrated edge. Never invents EV. */
export default function MispricesView({ sportFilter = "all" }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const sport = sportFilter === "all" ? "all" : sportFilter;
        const res = await fetch(`/api/misprices?sport=${encodeURIComponent(sport)}`, {
          credentials: "same-origin",
        });
        const json = await res.json();
        if (!cancelled) {
          if (!res.ok || json?.ok === false) setError(json?.error || `HTTP ${res.status}`);
          else setData(json);
        }
      } catch (err) {
        if (!cancelled) setError(String(err?.message || err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sportFilter]);

  const rows = data?.misprices || [];

  return (
    <section className="panel canonical-misprices" aria-label="Misprices">
      <header className="panel-header">
        <div>
          <h2 className="panel-title">Misprices</h2>
          <p className="muted">
            FBIS projection vs ACTION market snapshots (market intelligence only). Uncalibrated
            rows stay labeled <strong>Model disagreement</strong>. EV only after calibrated edge.
            ACTION never qualifies or authorizes wagers.
          </p>
        </div>
      </header>
      {loading ? <p className="muted">Loading…</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
      {data ? (
        <>
          <div className="canonical-chip-row">
            <span className="canonical-chip">Freshness: {data.freshness}</span>
            <span className="canonical-chip">Quality: {data.qualityStatus}</span>
            <span className="canonical-chip">
              Auto-promote: {data.policy?.autoPromoteAllowed ? "ON" : "OFF"}
            </span>
          </div>
          <div className="canonical-card-grid">
            {rows.map((r) => (
              <article key={r.id || `${r.modelId}-${r.marketLine}-${r.projection}`} className="canonical-card">
                <h3>{r.label || r.state}</h3>
                <p className="canonical-meta">
                  {(r.sport || "").toUpperCase()} · {r.marketType || "market"} · {r.modelId}
                </p>
                <p className="canonical-stat">
                  Projection {r.projection ?? "—"} vs line {r.marketLine ?? "—"}
                </p>
                <p className="canonical-stat">
                  Delta {r.disagreementUnits == null ? "—" : Number(r.disagreementUnits).toFixed(2)}
                </p>
                <p className="muted small">
                  {r.canShowEv
                    ? `EV eligible · P ${r.modelProbability ?? "—"}`
                    : "Probability/EV withheld (uncalibrated)"}
                </p>
                {r.note ? <p className="muted small">{r.note}</p> : null}
              </article>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
